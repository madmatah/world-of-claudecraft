import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  releaseCharacterLease: vi.fn(async () => true),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { driveReconWire } from '../server/drive_recon_wire';
import { isUpdateDue } from '../server/entity_update_cadence';
import { GameServer, wireEntity } from '../server/game';
import { otherRealmRacersParticipantIds } from '../server/realm_racers_interest';
import { appendSnapshotEntity } from '../server/snapshot_entity_stream';
import { VEHICLE_PROFILES } from '../src/sim/content/vehicles';
import { createPlayer } from '../src/sim/entity';
import { REALM_RACERS_GRID_SIZE } from '../src/sim/realm_racers_layout';
import { REALM_RACERS_RETURN_TICKS } from '../src/sim/social/realm_racers';
import { REALM_RACERS_LOADING_MAX_TICKS } from '../src/sim/social/realm_racers_loading';
import { type Entity, TICK_RATE } from '../src/sim/types';
import { createVehicleDrive } from '../src/sim/vehicle_motion';
import { STABLE_TIMER_WIRE_VERSION } from '../src/world_api';

const LEGACY_INTEREST_RADIUS = 120;
const SNAPSHOTS_PER_SECOND = 20;
const PLAYERS = 30;
const WARMUP_TICKS = 5;
const MEASURE_TICKS = 200;

// Interest-scan constants re-typed from server/game.ts (module-private there). The
// inline reference below reproduces the exact per-viewer scan the shared-candidate
// path replaced, so it must use the same radii/rates the real body uses.
const INTEREST_RADIUS = 90;
const INTEREST_DROP_RADIUS = 100;
const NPC_INTEREST_RADIUS = 120;
const NPC_DROP_RADIUS = 130;
const INTEREST_QUERY_RADIUS = NPC_DROP_RADIUS; // widest radius any kind needs

interface RefSent {
  idVer: number;
  dynVer: number;
  auraVer: number;
  sentAtTick: number;
  settled: boolean;
}

// interestLimitSq re-typed verbatim from server/interest_policy.ts.
function refInterestLimitSq(e: Entity, known: boolean): number {
  if (e.kind === 'npc') {
    return known ? NPC_DROP_RADIUS * NPC_DROP_RADIUS : NPC_INTEREST_RADIUS * NPC_INTEREST_RADIUS;
  }
  return known ? INTEREST_DROP_RADIUS * INTEREST_DROP_RADIUS : INTEREST_RADIUS * INTEREST_RADIUS;
}

// The OLD per-viewer interest scan, replicated inline against the live grid: gather
// exactly what grid.forEachInRadius(anchor.pos, INTEREST_QUERY_RADIUS) used to gather
// and run the shared encoder over its own shadow sentEnts (never the real
// session.sentEnts). It calls the REAL private canObserveEntity/wireCacheFor via the
// cast server, so this proves byte neutrality of the old vs shared GATHERING while
// the encoder's correctness is held independently by snapshot_entity_stream tests.
// If the shared path is byte-neutral, the emitted ents/keep must match tick for tick.
// gatherRadius overrides the scan radius for the decisiveness self-check only.
function referenceEntsKeep(
  server: any,
  anchor: Entity,
  stableTimerWire: boolean,
  shadow: Map<number, RefSent>,
  tick: number,
  gatherRadius = INTEREST_QUERY_RADIUS,
  pinnedIds: readonly number[] = [],
): { ents: string[]; keep: number[] } {
  const ents: string[] = [];
  const keep: number[] = [];
  const present = new Set<number>();
  const pinnedSet = new Set(pinnedIds);
  const queryLimitSq = INTEREST_QUERY_RADIUS * INTEREST_QUERY_RADIUS;
  const append = (e: Entity, d2: number, fullRate: boolean): void => {
    const known = shadow.get(e.id);
    appendSnapshotEntity(
      e.id,
      tick,
      stableTimerWire,
      fullRate || isUpdateDue(tick, e, d2, anchor, known?.sentAtTick ?? tick),
      shadow,
      present,
      ents,
      keep,
      server.wireCacheFor(e, stableTimerWire),
    );
  };
  server.sim.grid.forEachInRadius(
    anchor.pos.x,
    anchor.pos.z,
    gatherRadius,
    (e: Entity, d2: number) => {
      if (d2 > queryLimitSq) return;
      if (e.id === anchor.id) return;
      const pinned = pinnedSet.has(e.id);
      if (!pinned && !server.canObserveEntity(anchor, e, d2)) return;
      const known = shadow.get(e.id);
      const limitSq =
        anchor.targetId === e.id
          ? NPC_DROP_RADIUS * NPC_DROP_RADIUS
          : refInterestLimitSq(e, known !== undefined);
      if (!pinned && d2 > limitSq) return;
      append(e, d2, pinned);
    },
  );
  for (const id of pinnedIds) {
    if (present.has(id)) continue;
    const e = server.sim.entities.get(id) as Entity | undefined;
    if (!e) continue;
    const dx = e.pos.x - anchor.pos.x;
    const dz = e.pos.z - anchor.pos.z;
    append(e, dx * dx + dz * dz, true);
  }
  for (const id of shadow.keys()) {
    if (!present.has(id)) shadow.delete(id);
  }
  return { ents, keep };
}

interface CrowdMember {
  pid: number;
  characterId: number;
  session: any;
  lastFrame: string;
  shadow: Map<number, RefSent>;
}

// Join a session whose fake socket records its latest raw snapshot frame, and place
// its entity at (x, z). Positions are re-bucketed by the caller (a tick, or an
// explicit grid.refresh) before the scan reads them.
function joinAt(server: GameServer, characterId: number, name: string, x: number, z: number) {
  const member: CrowdMember = {
    pid: 0,
    characterId,
    session: null,
    lastFrame: '',
    shadow: new Map(),
  };
  const ws = {
    readyState: 1,
    send: (payload: string) => {
      const snap = JSON.parse(payload);
      if (snap.t === 'snap') member.lastFrame = payload;
    },
  };
  const session = server.join(ws as any, characterId, characterId, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  member.pid = session.pid;
  member.session = session;
  session.blockListLoaded = true;
  const e = server.sim.entities.get(session.pid)!;
  e.pos.x = x;
  e.pos.z = z;
  return member;
}

function refreshGrids(server: GameServer): void {
  server.sim.grid.refresh(server.sim.entities.values());
  server.sim.playerGrid.refresh((server as any).sim.playerEntities());
}

function stableWire(session: any): boolean {
  return session.timerWireVersion === STABLE_TIMER_WIRE_VERSION;
}

// Byte-exact assertion that the real frame's ents array equals the reference's, plus
// its keep list. The ents array appears verbatim as `"ents":[...]` in the raw frame,
// so a substring match is byte-exact; keep is compared as a parsed array (order and
// membership both matter).
function expectFrameMatches(member: CrowdMember, ref: { ents: string[]; keep: number[] }): void {
  expect(member.lastFrame).toContain(`"ents":[${ref.ents.join(',')}]`);
  const snap = JSON.parse(member.lastFrame);
  expect(snap.keep ?? []).toEqual(ref.keep);
}

// deterministic LCG so the walk pattern is reproducible
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

describe('crowd bandwidth', () => {
  it('cuts entity-stream bytes by more than half for a walking town crowd', () => {
    const server = new GameServer();
    const rng = makeRng(42);
    const sessions: { pid: number; bytes: number }[] = [];

    for (let i = 0; i < PLAYERS; i++) {
      const holder = { pid: 0, bytes: 0 };
      const ws = {
        readyState: 1,
        send: (payload: string) => {
          const snap = JSON.parse(payload);
          if (snap.t !== 'snap') return;
          // measure only the entity stream; self is identical in both protocols
          holder.bytes +=
            JSON.stringify(snap.ents).length + (snap.keep ? JSON.stringify(snap.keep).length : 0);
        },
      };
      const session = server.join(ws as any, i + 1, i + 1, `Walker${i}`, 'warrior', null);
      if ('error' in session) throw new Error(session.error);
      holder.pid = session.pid;
      sessions.push(holder);
      // every player walks in their own direction across the starter town
      const meta = server.sim.meta(session.pid)!;
      meta.moveInput.forward = true;
      const e = server.sim.entities.get(session.pid)!;
      e.facing = rng() * Math.PI * 2;
    }

    const broadcast = () => (server as any).broadcastSnapshots();
    for (let i = 0; i < WARMUP_TICKS; i++) {
      server.sim.tick();
      broadcast();
    }
    for (const s of sessions) s.bytes = 0;

    let legacyBytes = 0;
    for (let i = 0; i < MEASURE_TICKS; i++) {
      server.sim.tick();
      // legacy protocol: every entity within 120yd, full record, every tick
      for (const s of sessions) {
        const p = server.sim.entities.get(s.pid)!;
        const ents: string[] = [];
        server.sim.grid.forEachInRadius(p.pos.x, p.pos.z, LEGACY_INTEREST_RADIUS, (e) => {
          if (e.id === s.pid) return;
          ents.push(JSON.stringify(wireEntity(e)));
        });
        legacyBytes += `[${ents.join(',')}]`.length;
      }
      broadcast();
    }

    const newBytes = sessions.reduce((sum, s) => sum + s.bytes, 0);
    const seconds = MEASURE_TICKS / SNAPSHOTS_PER_SECOND;
    const perClient = (b: number) => b / PLAYERS / seconds / 1024;
    console.log(
      `entity-stream bandwidth, ${PLAYERS} players walking in town: ` +
        `legacy ${perClient(legacyBytes).toFixed(1)} KB/s/client -> ` +
        `new ${perClient(newBytes).toFixed(1)} KB/s/client ` +
        `(${(100 - (newBytes / legacyBytes) * 100).toFixed(0)}% reduction)`,
    );

    expect(newBytes).toBeLessThan(legacyBytes * 0.5);
  }, 30000);
});

// The set of entity ids a session currently sees: those streamed in full/lite (ents)
// plus those kept alive by a bare id (keep).
function framePresentIds(frame: string): Set<number> {
  const snap = JSON.parse(frame);
  const ids = new Set<number>();
  for (const e of snap.ents ?? []) ids.add(e.id);
  for (const id of snap.keep ?? []) ids.add(id);
  return ids;
}

// Count grid.forEachInRadius calls during exactly one broadcast pass. The interest
// scan is the only grid query in the pass (frost rings / hourglasses are plain array
// filters, not grid queries), so this counts distinct occupied anchor cells: one per
// session when sparse, fewer when co-located viewers share a cell.
function countGridQueries(server: GameServer): number {
  const grid = (server as any).sim.grid;
  const orig = grid.forEachInRadius.bind(grid);
  let count = 0;
  grid.forEachInRadius = (x: number, z: number, r: number, cb: unknown) => {
    count++;
    return orig(x, z, r, cb);
  };
  try {
    (server as any).broadcastSnapshots();
  } finally {
    grid.forEachInRadius = orig;
  }
  return count;
}

describe('shared interest-candidate gathering', () => {
  // The shared per-cell query replaces the per-viewer grid scan. Each test drives the
  // real GameServer.broadcastSnapshots and pins its per-session ents/keep byte-for-byte
  // against an inline reference that gathers the OLD per-viewer way and runs the exact
  // unchanged body (calling the real private canObserveEntity/wireCacheFor) over its own
  // shadow sentEnts. Byte-identity proves the gathering change is output-neutral.
  it('is byte-identical to the per-viewer scan for a co-located crowd across ticks', () => {
    const server = new GameServer();
    const rng = makeRng(7);
    // 8 players spread across two adjacent cells (cellSize 32): x in {0,20,40,60}.
    const crowd: CrowdMember[] = [];
    for (let i = 0; i < 8; i++) {
      const m = joinAt(server, i + 1, `Dense${i}`, (i % 4) * 20, Math.floor(i / 4) * 20);
      server.sim.meta(m.pid)!.moveInput.forward = true;
      server.sim.entities.get(m.pid)!.facing = rng() * Math.PI * 2;
      crowd.push(m);
    }
    for (let t = 0; t < 12; t++) {
      server.sim.tick();
      // reference first: it primes the tick-memoized wire cache identically, then the
      // real broadcast reads the same memoized JSON.
      const refs = crowd.map((m) =>
        referenceEntsKeep(
          server,
          server.sim.entities.get(m.pid)!,
          stableWire(m.session),
          m.shadow,
          server.sim.tickCount,
        ),
      );
      (server as any).broadcastSnapshots();
      crowd.forEach((m, i) => {
        expectFrameMatches(m, refs[i]);
      });
    }
  });

  it('still matches the per-viewer scan after a same-tick displacement across a cell boundary', () => {
    const server = new GameServer();
    const viewer = joinAt(server, 1, 'Viewer', 0, 0);
    const target = joinAt(server, 2, 'Target', 31, 0); // cell 0 (x < 32)
    const other = joinAt(server, 3, 'Other', 5, 5);
    const all = [viewer, target, other];
    const runTick = () => {
      const refs = all.map((m) =>
        referenceEntsKeep(
          server,
          server.sim.entities.get(m.pid)!,
          stableWire(m.session),
          m.shadow,
          server.sim.tickCount,
        ),
      );
      (server as any).broadcastSnapshots();
      all.forEach((m, i) => {
        expectFrameMatches(m, refs[i]);
      });
    };
    for (let t = 0; t < 3; t++) {
      server.sim.tick();
      runTick();
    }
    // Same-tick displacement: advance the tick, then shove the target across the x=32
    // cell boundary and re-bucket (the end-of-tick refresh the real server relies on)
    // BEFORE this tick's first broadcast, so the wire re-serializes the new position.
    server.sim.tick();
    const cellSize = server.sim.grid.cellSize;
    const te = server.sim.entities.get(target.pid)!;
    const beforeCx = Math.floor(te.pos.x / cellSize);
    te.pos.x = 60; // cell 1
    // exercise the real displacement mechanism too: applyKnockback walks pos directly
    // with no grid call of its own, relying on the same end-of-tick refresh below.
    (server as any).sim.applyKnockback(
      server.sim.entities.get(viewer.pid),
      server.sim.entities.get(other.pid),
      3,
    );
    refreshGrids(server);
    expect(Math.floor(te.pos.x / cellSize)).not.toBe(beforeCx); // crossed a cell boundary
    runTick();
    // decisive: the displaced target (now ~60yd from the viewer) is still found by the
    // viewer's shared-cell query.
    expect(framePresentIds(viewer.lastFrame).has(target.pid)).toBe(true);
  });

  it('preserves stealth visibility (a party mate sees the sneak, a distant viewer does not)', () => {
    const server = new GameServer();
    const sneak = joinAt(server, 1, 'Sneak', 0, 0);
    const mate = joinAt(server, 2, 'Mate', 10, 0); // same party, close
    const stranger = joinAt(server, 3, 'Stranger', 110, 0); // not party, beyond stealth detection
    server.sim.partyInvite(mate.pid, sneak.pid);
    server.sim.partyAccept(mate.pid);
    const all = [sneak, mate, stranger];
    for (let t = 0; t < 4; t++) {
      server.sim.tick();
      // updateAuras recomputes e.stealthed from auras each tick; force it on after the
      // tick and before the scan so the scenario stays stealthed.
      server.sim.entities.get(sneak.pid)!.stealthed = true;
      const refs = all.map((m) =>
        referenceEntsKeep(
          server,
          server.sim.entities.get(m.pid)!,
          stableWire(m.session),
          m.shadow,
          server.sim.tickCount,
        ),
      );
      (server as any).broadcastSnapshots();
      all.forEach((m, i) => {
        expectFrameMatches(m, refs[i]);
      });
    }
    // decisive: the shared path did not change who can observe a stealthed player.
    expect(framePresentIds(mate.lastFrame).has(sneak.pid)).toBe(true);
    expect(framePresentIds(stranger.lastFrame).has(sneak.pid)).toBe(false);
  });

  it('anchors a spectator on its target: its stream matches a viewer at the target position', () => {
    const server = new GameServer();
    const target = joinAt(server, 1, 'Target', 50, 50);
    const bystander = joinAt(server, 2, 'Bystand', 60, 55); // near the target, shares its cell region
    const mod = joinAt(server, 3, 'Mod', 500, 500); // far from the target
    // mod spectates target: its interest anchor becomes the target entity.
    mod.session.spectating = {
      characterId: target.characterId,
      name: 'Target',
      savedPos: { ...server.sim.entities.get(mod.pid)!.pos },
      priorGm: false,
      stowedPet: null,
    };
    for (let t = 0; t < 4; t++) {
      server.sim.tick();
      // the spectator's reference anchor is the TARGET entity, not mod's own.
      const modRef = referenceEntsKeep(
        server,
        server.sim.entities.get(target.pid)!,
        stableWire(mod.session),
        mod.shadow,
        server.sim.tickCount,
      );
      const bystanderRef = referenceEntsKeep(
        server,
        server.sim.entities.get(bystander.pid)!,
        stableWire(bystander.session),
        bystander.shadow,
        server.sim.tickCount,
      );
      (server as any).broadcastSnapshots();
      expectFrameMatches(mod, modRef);
      expectFrameMatches(bystander, bystanderRef);
    }
  });

  it('issues one grid query per occupied cell: one per viewer when sparse, shared when dense', () => {
    // sparse: each anchor in a distinct, non-adjacent cell -> one query per viewer, no
    // overhead versus the old one-query-per-viewer cost.
    const sparse = new GameServer();
    const sparseCrowd = [0, 1, 2, 3].map((i) => joinAt(sparse, i + 1, `Far${i}`, i * 500, 0));
    refreshGrids(sparse);
    expect(countGridQueries(sparse)).toBe(sparseCrowd.length);

    // dense: every anchor in one cell -> a single shared query for all of them.
    const dense = new GameServer();
    const denseCrowd = [0, 1, 2, 3, 4, 5].map((i) => joinAt(dense, i + 1, `Near${i}`, i * 4, 0));
    refreshGrids(dense);
    const denseQueries = countGridQueries(dense);
    expect(denseQueries).toBe(1);
    expect(denseQueries).toBeLessThan(denseCrowd.length);
  });

  it('reveals a moderator leaving spectate to co-located viewers this tick (new hoisted ordering)', () => {
    // The one intentional non-byte-identical behavior change: hoisting all anchor
    // resolution (including the vanished-spectate exitSpectate fallback) ahead of the
    // shared-candidate build makes a moderator leaving spectate limbo visible to
    // co-located viewers one tick earlier, never later. Gameplay-neutral. This pin is
    // DECISIVE against the hoist because the NEIGHBOR joins BEFORE the moderator: under
    // the old single-pass inline ordering the neighbor's snapshot is built while the
    // moderator is still in limbo (its exitSpectate fallback runs later, during the
    // moderator's own iteration), so it would NOT see the moderator this tick. Only the
    // hoisted resolve pass, which restores the moderator before any snapshot builds,
    // reveals it now, so the final assertion passes only with the hoist in place.
    const server = new GameServer();
    const neighbor = joinAt(server, 1, 'Neighbor', 18, 18); // joins FIRST, near mod's savedPos
    const mod = joinAt(server, 2, 'Mod', 20, 20);
    const target = joinAt(server, 3, 'Target', 400, 400);
    (server as any).enterSpectate(mod.session, target.session); // mod -> limbo, savedPos = (20,20)
    // while spectating, the moderator sits in limbo and the neighbor cannot see it.
    server.sim.tick();
    (server as any).broadcastSnapshots();
    expect(framePresentIds(neighbor.lastFrame).has(mod.pid)).toBe(false);
    // target goes offline this tick: mod's broadcast-pass exitSpectate fallback restores
    // mod to savedPos in the hoisted resolve pass, before the neighbor's snapshot builds.
    target.session.left = true;
    server.sim.tick();
    (server as any).broadcastSnapshots();
    expect(framePresentIds(neighbor.lastFrame).has(mod.pid)).toBe(true);
  });

  it('isolates a per-session throw across both the resolve and build passes', () => {
    // The rewire split the single guarded snapshot loop into two guarded passes
    // (anchor resolve, then build), each with its own onError. A throw building one
    // session's anchor or snapshot must not starve any other session this tick, and the
    // build-pass handler now reports resolved.session.pid. Force a throw in EACH pass
    // and confirm a clean co-located sibling still gets its frame and both handlers fire.
    const server = new GameServer();
    const resolveThrower = joinAt(server, 1, 'BadResolve', 0, 0);
    const buildThrower = joinAt(server, 2, 'BadBuild', 4, 0);
    const sibling = joinAt(server, 3, 'Sibling', 8, 0); // co-located, joins LAST
    // pass 1 (anchor resolution) throws for resolveThrower: reading spectating.name throws.
    (resolveThrower.session as any).spectating = {
      get name() {
        throw new Error('resolve boom');
      },
    };
    // pass 2 (build) throws for buildThrower: sentEnts.get throws mid-build.
    (buildThrower.session as any).sentEnts = {
      get() {
        throw new Error('build boom');
      },
    };
    refreshGrids(server);
    server.sim.tick();
    refreshGrids(server);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => (server as any).broadcastSnapshots()).not.toThrow();
      // the clean sibling still received its snapshot despite both throwers.
      expect(sibling.lastFrame).not.toBe('');
      // both guarded passes reported their failure (build handler via resolved.session.pid).
      const messages = errSpy.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => m.includes('failed to resolve anchor'))).toBe(true);
      expect(messages.some((m) => m.includes('failed to build snapshot'))).toBe(true);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('counts bcVisits as the exact per-viewer in-range set (self included), invariant to sharing', () => {
    const server = new GameServer();
    const crowd = [0, 1, 2, 3, 4, 5].map((i) =>
      joinAt(server, i + 1, `V${i}`, (i % 3) * 15, Math.floor(i / 3) * 15),
    );
    refreshGrids(server);
    server.sim.tick();
    refreshGrids(server);
    // independent expectation: entities within INTEREST_QUERY_RADIUS of each anchor,
    // self included (grid's own d2 <= radius^2 cutoff, and d2(self) = 0).
    let expected = 0;
    for (const m of crowd) {
      const a = server.sim.entities.get(m.pid)!;
      server.sim.grid.forEachInRadius(a.pos.x, a.pos.z, INTEREST_QUERY_RADIUS, () => {
        expected++;
      });
    }
    (server as any).perfDetailActive = true;
    (server as any).bcVisits = 0;
    (server as any).broadcastSnapshots();
    expect((server as any).bcVisits).toBe(expected);
  });

  it('is decisive: shrinking the reference gather radius diverges from the real frames', () => {
    // Guards against a vacuous pin: with a deliberately too-small gather radius the
    // reference misses in-interest candidates the real shared path still finds, so the
    // frames must NOT match. If this ever passes, the equality pins above prove nothing.
    const server = new GameServer();
    const crowd = [0, 1, 2].map((i) => joinAt(server, i + 1, `S${i}`, i * 40, 0)); // 0, 40, 80
    refreshGrids(server);
    server.sim.tick();
    (server as any).broadcastSnapshots();
    let anyMismatch = false;
    for (const m of crowd) {
      const shrunk = referenceEntsKeep(
        server,
        server.sim.entities.get(m.pid)!,
        stableWire(m.session),
        new Map(),
        server.sim.tickCount,
        INTEREST_QUERY_RADIUS - 75, // 55: drops the far-but-in-interest neighbor at 80yd
      );
      if (!m.lastFrame.includes(`"ents":[${shrunk.ents.join(',')}]`)) anyMismatch = true;
    }
    expect(anyMismatch).toBe(true);
  });
});

/** A full four-pilot grid. Most cases below only lean on the first two, but the
 *  whole field is seated because a race is four abreast or it does not start. */
function startRealmRacersGrid(server: GameServer, idBase: number): CrowdMember[] {
  const grid = Array.from({ length: REALM_RACERS_GRID_SIZE }, (_, i) =>
    joinAt(server, idBase + i, `Racer${idBase + i}`, i * 4, 0),
  );
  for (const member of grid) server.sim.realmRacersQueueJoin(member.pid);
  server.sim.tick();
  expect(server.sim.realmRacers.match?.pids).toEqual(grid.map((member) => member.pid));
  return grid;
}

function moveMember(server: GameServer, member: CrowdMember, x: number, z: number): void {
  const e = requiredEntity(server, member.pid);
  e.pos.x = x;
  e.pos.z = z;
}

function requiredEntity(server: GameServer, pid: number): Entity {
  const e = server.sim.entities.get(pid);
  if (!e) throw new Error(`missing entity ${pid}`);
  return e;
}

describe('Realm Racers match-scoped interest', () => {
  it.each([150, 170])('directly pins both viewers across a %i yd gap', (gap) => {
    const server = new GameServer();
    const [a, b] = startRealmRacersGrid(server, 6000 + gap);
    moveMember(server, a, 113_700, 0);
    moveMember(server, b, 113_700 + gap, 0);
    requiredEntity(server, a.pid).stealthed = true;
    requiredEntity(server, b.pid).stealthed = true;
    refreshGrids(server);

    (server as any).broadcastSnapshots();

    expect(framePresentIds(a.lastFrame).has(b.pid)).toBe(true);
    expect(framePresentIds(b.lastFrame).has(a.pid)).toBe(true);
  });

  it('does not add a hidden distance ceiling to an authoritative match pin', () => {
    const server = new GameServer();
    const [a, b] = startRealmRacersGrid(server, 6300);
    moveMember(server, a, 113_700, 0);
    moveMember(server, b, 114_700, 0);
    refreshGrids(server);

    (server as any).broadcastSnapshots();

    expect(framePresentIds(a.lastFrame).has(b.pid)).toBe(true);
  });

  it('encodes a nearby targeted rival once across all inclusion paths', () => {
    const server = new GameServer();
    const [a, b] = startRealmRacersGrid(server, 6400);
    moveMember(server, a, 113_700, 0);
    moveMember(server, b, 113_710, 0);
    requiredEntity(server, a.pid).targetId = b.pid;
    refreshGrids(server);

    (server as any).broadcastSnapshots();

    const snap = JSON.parse(a.lastFrame);
    expect(snap.ents.filter((e: { id: number }) => e.id === b.pid)).toHaveLength(1);
    expect((snap.keep ?? []).filter((id: number) => id === b.pid)).toHaveLength(0);
  });

  it('keeps the pin through voluntary-forfeit results and drops it after teardown', () => {
    const server = new GameServer();
    const grid = startRealmRacersGrid(server, 6500);
    const [a, b] = grid;
    moveMember(server, a, 113_700, 0);
    moveMember(server, b, 113_870, 0);
    refreshGrids(server);

    // The whole field pulls off, so the race really is decided: one quitter no
    // longer ends it, and the pin has to survive the six-second tableau either
    // way. The quitter's own six seconds run from the tick THEY quit.
    for (const member of grid) server.sim.realmRacersForfeit(member.pid);
    (server as any).broadcastSnapshots();
    expect(server.sim.realmRacers.match?.phase).toBe('finished');
    expect(framePresentIds(a.lastFrame).has(b.pid)).toBe(true);

    expect(REALM_RACERS_RETURN_TICKS).toBe(120);
    for (let i = 0; i < 119; i++) server.sim.tick();
    refreshGrids(server);
    (server as any).broadcastSnapshots();
    expect(server.sim.realmRacers.match?.phase).toBe('finished');
    expect(framePresentIds(a.lastFrame).has(b.pid)).toBe(true);

    server.sim.tick();
    expect(server.sim.realmRacers.match).toBeNull();
    moveMember(server, a, 113_700, 0);
    moveMember(server, b, 113_870, 0);
    refreshGrids(server);
    (server as any).broadcastSnapshots();
    expect(framePresentIds(a.lastFrame).has(b.pid)).toBe(false);
  });

  it('keeps three other people racing when one pilot forfeits', () => {
    const server = new GameServer();
    const grid = startRealmRacersGrid(server, 6520);
    const [a, b] = grid;
    moveMember(server, a, 113_700, 0);
    moveMember(server, b, 113_870, 0);
    refreshGrids(server);

    server.sim.realmRacersForfeit(a.pid);
    (server as any).broadcastSnapshots();
    // The race is untouched, and the quitter is off it while the pins for the
    // rest of the field stay exactly where they were.
    expect(server.sim.realmRacers.match?.phase).toBe('loading');
    expect(server.sim.realmRacersInfoFor(a.pid).match?.result).toBe('forfeit');
    expect(server.sim.realmRacersInfoFor(b.pid).match?.result).toBeNull();
    expect(framePresentIds(a.lastFrame).has(b.pid)).toBe(true);
  });

  it('re-sends the rr readout about once a second through a whole loading lobby', () => {
    const server = new GameServer();
    const [a] = startRealmRacersGrid(server, 6530);
    const match = server.sim.realmRacers.match;
    if (!match) throw new Error('match missing');
    let resends = 0;
    let rrBytes = 0;
    let lobbyBytes = 0;
    let lobbyTicks = 0;
    while (match.phase === 'loading') {
      lobbyTicks++;
      a.lastFrame = '';
      (server as any).broadcastSnapshots();
      const rr = a.lastFrame ? JSON.parse(a.lastFrame).self?.rr : undefined;
      if (rr !== undefined) {
        resends++;
        rrBytes += JSON.stringify(rr).length;
        lobbyBytes = Math.max(lobbyBytes, JSON.stringify(rr.match?.loading ?? null).length);
      }
      server.sim.tick();
    }
    // Nobody sent ready, so the lobby ran to its cap.
    expect(lobbyTicks).toBe(REALM_RACERS_LOADING_MAX_TICKS);
    // One full send, then one per whole second the countdown to the cap moves:
    // never once a tick.
    expect(resends).toBeLessThanOrEqual(REALM_RACERS_LOADING_MAX_TICKS / TICK_RATE + 1);
    expect(lobbyBytes).toBeLessThanOrEqual(64);
    // Measured at 15 sends of about 1.24 KB (a four-row readout): about 1.2 KB/s
    // for the lobby, where a per-tick ticks-left field cost twenty times that.
    expect(rrBytes / resends).toBeLessThan(1400);
  });

  it('pins the field during the racing phase', () => {
    const server = new GameServer();
    const [a, b] = startRealmRacersGrid(server, 6550);
    const match = server.sim.realmRacers.match;
    if (!match) throw new Error('match missing');
    match.phase = 'racing';
    moveMember(server, a, 113_700, 0);
    moveMember(server, b, 113_870, 0);
    refreshGrids(server);

    (server as any).broadcastSnapshots();

    expect(framePresentIds(a.lastFrame).has(b.pid)).toBe(true);
  });

  it('tears down the pin through the server leave path on disconnect', async () => {
    const server = new GameServer();
    const [a, b] = startRealmRacersGrid(server, 6600);
    await server.leave(b.session, 'test disconnect');
    // The race carries on for the other three; only the pin on the pilot who
    // left comes down.
    expect(server.sim.realmRacers.match?.pids).toContain(b.pid);
    expect(server.sim.realmRacersInfoFor(b.pid).match).toBeNull();
    refreshGrids(server);

    (server as any).broadcastSnapshots();

    expect(framePresentIds(a.lastFrame).has(b.pid)).toBe(false);
  });

  it('skips a temporarily missing roster entity without failing the broadcast', () => {
    const server = new GameServer();
    const [a, b] = startRealmRacersGrid(server, 6650);
    const missing = requiredEntity(server, b.pid);
    server.sim.grid.remove(missing);
    server.sim.playerGrid.remove(missing);
    server.sim.entities.delete(b.pid);

    expect(() => (server as any).broadcastSnapshots()).not.toThrow();
    expect(framePresentIds(a.lastFrame).has(b.pid)).toBe(false);
  });

  it('isolates concurrent practice copies and does not pin a non-racer', () => {
    const server = new GameServer();
    const a = joinAt(server, 6700, 'PracticeA', 0, 0);
    const b = joinAt(server, 6701, 'PracticeB', 4, 0);
    const stranger = joinAt(server, 6702, 'Stranger', 8, 0);
    server.sim.realmRacersPracticeStart('rookie', a.pid);
    server.sim.realmRacersPracticeStart('driver', b.pid);
    const matchA = server.sim.realmRacers.practices.find((m) => m.pids.includes(a.pid));
    const matchB = server.sim.realmRacers.practices.find((m) => m.pids.includes(b.pid));
    if (!matchA || !matchB) throw new Error('practice matches missing');
    const botA = matchA.pids.find((pid) => pid !== a.pid);
    const botB = matchB.pids.find((pid) => pid !== b.pid);
    if (botA === undefined || botB === undefined) throw new Error('practice bots missing');
    const ae = requiredEntity(server, a.pid);
    moveMember(server, stranger, ae.pos.x + 170, ae.pos.z);
    refreshGrids(server);

    (server as any).broadcastSnapshots();

    expect(framePresentIds(a.lastFrame).has(botA)).toBe(true);
    expect(framePresentIds(a.lastFrame).has(b.pid)).toBe(false);
    expect(framePresentIds(a.lastFrame).has(botB)).toBe(false);
    expect(framePresentIds(a.lastFrame).has(stranger.pid)).toBe(false);
    expect(framePresentIds(b.lastFrame).has(botB)).toBe(true);
    expect(framePresentIds(b.lastFrame).has(a.pid)).toBe(false);
    expect(framePresentIds(b.lastFrame).has(botA)).toBe(false);
  });

  it('inherits the observed racer match without duplicating the observed body', () => {
    const server = new GameServer();
    const [target, rival] = startRealmRacersGrid(server, 6800);
    const mod = joinAt(server, 6820, 'Moderator', 1000, 1000);
    moveMember(server, target, 113_700, 0);
    moveMember(server, rival, 113_870, 0);
    mod.session.spectating = {
      characterId: target.characterId,
      name: 'Racer6800',
      savedPos: { ...requiredEntity(server, mod.pid).pos },
      priorGm: false,
      stowedPet: null,
    };
    refreshGrids(server);

    (server as any).broadcastSnapshots();

    const snap = JSON.parse(mod.lastFrame);
    expect(snap.self.id).toBe(target.pid);
    expect(framePresentIds(mod.lastFrame).has(rival.pid)).toBe(true);
    expect(framePresentIds(mod.lastFrame).has(target.pid)).toBe(false);
  });

  it('matches the shadow stream, updates moving pins every pass, and preserves bcVisits', () => {
    const server = new GameServer();
    const grid = startRealmRacersGrid(server, 6900);
    const [a, b] = grid;
    for (const member of grid) member.session.timerWireVersion = STABLE_TIMER_WIRE_VERSION;
    // The pair under test out on the instance plane, the rest of the field far
    // enough away that only the match pins reach them. All of it on the race's
    // OWN lane, since the sim ticks here and retires a racer found on any other.
    const laneZ = server.sim.realmRacers.match?.origin.z ?? 0;
    moveMember(server, a, 113_700, laneZ);
    moveMember(server, b, 113_870, laneZ);
    moveMember(server, grid[2], 113_420, laneZ + 140);
    moveMember(server, grid[3], 113_990, laneZ - 140);
    refreshGrids(server);

    for (let i = 0; i < 4; i++) {
      server.sim.tick();
      moveMember(server, b, 113_870 + i, laneZ);
      refreshGrids(server);
      const ref = referenceEntsKeep(
        server,
        requiredEntity(server, a.pid),
        stableWire(a.session),
        a.shadow,
        server.sim.tickCount,
        INTEREST_QUERY_RADIUS,
        grid.slice(1).map((member) => member.pid),
      );
      (server as any).broadcastSnapshots();
      expectFrameMatches(a, ref);
      const record = JSON.parse(a.lastFrame).ents.find((e: { id: number }) => e.id === b.pid);
      expect(record).toBeDefined();
      if (i === 0) expect(record.k).toBe('player');
      else {
        expect(record.k).toBeUndefined();
        expect(record.x).toBe(113_870 + i);
      }
    }

    server.sim.tick();
    refreshGrids(server);
    (server as any).broadcastSnapshots();
    const settle = JSON.parse(a.lastFrame);
    const settleRecord = settle.ents.find((e: { id: number }) => e.id === b.pid);
    expect(settleRecord).toBeDefined();
    expect(settleRecord.k).toBeUndefined();
    expect(settle.keep ?? []).not.toContain(b.pid);
    server.sim.tick();
    refreshGrids(server);
    (server as any).broadcastSnapshots();
    expect(JSON.parse(a.lastFrame).keep ?? []).toContain(b.pid);

    let expectedVisits = 0;
    for (const member of grid) {
      const anchor = requiredEntity(server, member.pid);
      server.sim.grid.forEachInRadius(anchor.pos.x, anchor.pos.z, INTEREST_QUERY_RADIUS, () => {
        expectedVisits++;
      });
    }
    (server as any).perfDetailActive = true;
    (server as any).bcVisits = 0;
    (server as any).broadcastSnapshots();
    expect((server as any).bcVisits).toBe(expectedVisits);
  });

  it('bounds a four-pilot grid to exactly three full rival records', () => {
    const server = new GameServer();
    const members = [0, 1, 2, 3].map((i) => joinAt(server, 7000 + i, `Grid${i}`, i * 4, 0));
    const pinnedIds = otherRealmRacersParticipantIds(
      members.map((member) => member.pid),
      members[0].pid,
    );
    const sent = new Map();
    const present = new Set<number>();
    const ents: string[] = [];
    const keep: number[] = [];
    for (const id of pinnedIds) {
      appendSnapshotEntity(
        id,
        server.sim.tickCount,
        false,
        true,
        sent,
        present,
        ents,
        keep,
        (server as any).wireCacheFor(requiredEntity(server, id), false),
      );
    }

    expect(pinnedIds).toEqual(members.slice(1).map((member) => member.pid));
    expect(ents).toHaveLength(3);
    expect(keep).toEqual([]);
    expect([...present]).toEqual(pinnedIds);
    // Re-measured at the release/v0.44.0 merge (1176 before): the release's
    // larger world shifts the joined pids, so the one rival that was pid 999
    // now carries a four-digit `id` and aura `src`; the record keys are unchanged.
    expect(Buffer.byteLength(`[${ents.join(',')}]`)).toBe(1178);
  });
});

describe('the drive recon (rdv) byte bound', () => {
  // The longest JSON spelling a double has: a sign, "0.", five zeros and 17
  // significant digits. Every numeric field at this length, every sparse field
  // present, is the largest record the encoder can emit for this profile.
  const LONGEST = -0.0000012345678901234567;

  it('bounds the worst possible self record, and costs nothing on foot', () => {
    expect(JSON.stringify(LONGEST)).toHaveLength(25);
    const e = createPlayer(1, 'warrior', { x: 0, y: 0, z: 0 }, 'Pilot');
    expect(driveReconWire(e)).toBeUndefined();
    const longestKey = Object.keys(VEHICLE_PROFILES).reduce((a, b) =>
      b.length > a.length ? b : a,
    );
    const drive = createVehicleDrive(longestKey);
    for (const key of Object.keys(drive) as (keyof typeof drive)[]) {
      if (typeof drive[key] === 'number')
        (drive as unknown as Record<string, number>)[key] = LONGEST;
    }
    // The scrape reading rides only above 0.01, so its longest spelling is the
    // positive exponent form.
    drive.collisionImpact = 1.2345678901234567e300;
    drive.controlsLocked = true;
    e.drive = drive;
    e.onGround = false;
    e.vy = LONGEST;
    const rdv = driveReconWire(e);
    expect(Object.keys(rdv ?? {})).toHaveLength(15);
    // 12 numbers at 25 characters, the scrape at 23, the keys, the longest
    // profile key and the two flags. At 20 Hz that caps a seated racer at 8.2 KB/s; a measured
    // race runs at about 2.4 KB/s (tests/realm_racers_drive_recon_online.test.ts).
    const bytes = Buffer.byteLength(`,"rdv":${JSON.stringify(rdv)}`);
    expect(bytes).toBe(410);
    expect(bytes * SNAPSHOTS_PER_SECOND).toBeLessThanOrEqual(8200);
  });
});
