import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// Postgres is mocked before the server/game import the harness pulls in
// (tests/CLAUDE.md, Server tests): the same factory as the other racer suites.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
  insertBankLedgerRow: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  loadRiftState: vi.fn(async () => null),
  saveRiftState: vi.fn(async () => {}),
  loadGuildBankRow: vi.fn(async () => null),
  loadGuildBankRows: vi.fn(async () => []),
  saveCharacterAndGuildBankState: vi.fn(async () => {}),
  GUILD_BANK_ROW_MAX_BYTES: 262144,
}));

import { REALM_RACERS_NITRO_ABILITY_ID } from '../src/sim/content/realm_racers';
import { vehicleProfile } from '../src/sim/content/vehicles';
import { GROUND_BLAST_SHOCK_TICKS } from '../src/sim/realm_racers_ground_blast';
import { REALM_RACERS_NITRO_TICKS } from '../src/sim/realm_racers_pickup_effects';
import {
  REALM_RACERS_SLICK_GRIP_TICKS,
  REALM_RACERS_SLICK_LIFETIME_TICKS,
} from '../src/sim/realm_racers_slicks';
import { realmRacersTrack } from '../src/sim/realm_racers_spline';
import {
  REALM_RACERS_GARDEN_BAND,
  REALM_RACERS_GROUND_BLAST_AURA,
  REALM_RACERS_OFF_TRACK_AURA,
  REALM_RACERS_RESET_LOCK_TICKS,
  REALM_RACERS_RETURN_TICKS,
  REALM_RACERS_VEHICLE_KEY,
  REALM_RACERS_VERGE_BAND,
  type RealmRacersMatch,
  realmRacersCircuitOf,
  realmRacersToCanonical,
} from '../src/sim/social/realm_racers';
import { DT, type MoveInput, type VehicleDrive } from '../src/sim/types';
import { vehicleVelocityX, vehicleVelocityZ } from '../src/sim/vehicle_motion';
import type { LatencyLinkConfig } from './helpers/latency_link';
import {
  createOnlineHarness,
  DEFAULT_FRAME_MS,
  type HarnessClient,
  SERVER_TICK_MS,
} from './helpers/online_harness';
import {
  type AutopilotDecisions,
  createRacerDuelHarness,
  createRacerHarness,
  type PilotAutopilot,
  type RacerHarness,
} from './helpers/racer_harness';
import {
  type OutcomeNote,
  type Phase,
  type PilotWatch,
  type TransitionField,
  watchPilot,
} from './helpers/racer_prediction_watch';
import { rallyPickupRollFor } from './helpers/realm_racers_rng';

// THE TWO-HOST PROOF that kart prediction (the v2 pipeline predicting a seated
// racer from the full drive recon, `predictDrivers`, on by default) is correct and
// fair, on the real client and server over the simulated link. Every run is
// deterministic: the virtual clock, seeded links, the scripted pickup stream.
//
// How a replay is judged. The watch (tests/helpers/racer_prediction_watch.ts)
// notes every server tick where something the kernel reads changed without
// the client's inputs (a surface multiplier, an aura, the lock, a bump), and
// this suite adds the ones it causes itself (a shove, a starved tick, a rival
// in reach). A reconcile covers the server ticks since the previous one; a
// replay is EXPLAINED when that window holds a transition. The pins: no
// unexplained replay anywhere, at most one replay per transition, and the
// derived number of replays at each effect's onset and expiry.
//
// Measured at this commit (V8):
//
//   clean lap on the predicted kart   60 ms   120 ms   200 ms
//     match rate                       1.000    1.000    1.000
//     replays / suspends in race       0 / 1    0 / 1    0 / 1
//     lap distance (yd, 16 s)          600      600      598
//   onset / expiry replays, every RTT: shell 2 / 1 (landing 0), oil 2 / 1,
//   nitro 1 / 1, shove 1, verge 1 / 1, garden deepen 1 / relax 1.
//   Shell and oil cost TWO at onset: the hit writes the pop or the throw in its
//   own tick, but the grip loss only lands at the next tick's surface pass, so
//   the acknowledgement of the tick after the hit is a second surprise.
//
// Engine note: the match is exact IEEE equality between the client's kernel
// and the server's. V8 (Chrome, Edge, Electron, Node) runs the same Math
// builtins on both sides. JavaScriptCore (Safari) may differ from V8 in the
// last ulp of the transcendental Math functions the kernel calls, so a Safari
// client can see a mismatch on acknowledgements that match here: each is a
// replay whose residual is a few ulps (harmless on screen, a replay's worth of
// CPU). The match rates below are V8's.

const RTTS = [60, 120, 200] as const;
type Rtt = (typeof RTTS)[number];

/** A clean lap's match rate floor (measured 1.000 at every RTT). */
const CLEAN_MATCH_FLOOR = 0.99;

function link(rttMs: number, jitterMs = 10, seed = 1337): LatencyLinkConfig {
  return {
    toServer: { baseMs: rttMs / 2, jitterMs, seed },
    toClient: { baseMs: rttMs / 2, jitterMs, seed: seed + 2905 },
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Every reconcile of one pilot in order, with the server tick window it
 *  covers: the ticks after the previous reconcile's, up to its own. */
interface Reconcile {
  note: OutcomeNote;
  fromTick: number;
  toTick: number;
}

function reconciles(watch: PilotWatch): Reconcile[] {
  const all = [...watch.notes, ...watch.matches]
    .filter((n) => n.kind === 'match' || n.kind === 'replayed')
    .sort((a, b) => a.tMs - b.tMs);
  const out: Reconcile[] = [];
  let previous = Number.NEGATIVE_INFINITY;
  for (const note of all) {
    if (note.tick === null) continue;
    out.push({ note, fromTick: previous + 1, toTick: note.tick });
    previous = note.tick;
  }
  return out;
}

/** Reconciles in the race, from the first predicted racing frame on, leaving
 *  out a re-seed's first reconcile (the frames in flight across a suspend). */
function racingReconciles(watch: PilotWatch): Reconcile[] {
  return reconciles(watch).filter(
    (r) => r.note.phase === 'race' && !r.note.afterSuspend && !r.note.beforePredictedRace,
  );
}

function transitionTicksIn(watch: PilotWatch, from: number, to: number): number[] {
  return [...watch.transitions].filter((t) => t >= from && t <= to).sort((a, b) => a - b);
}

interface ReplayAccount {
  replays: Reconcile[];
  matches: number;
  /** Replays whose tick window holds no server transition. */
  unexplained: Reconcile[];
  /** Per transition tick, how many replays its window explains. */
  perTransition: Map<number, number>;
  xz: number[];
  yaw: number[];
}

function accountReplays(watch: PilotWatch): ReplayAccount {
  const recs = racingReconciles(watch);
  const replays = recs.filter((r) => r.note.kind === 'replayed');
  const unexplained: Reconcile[] = [];
  const perTransition = new Map<number, number>();
  for (const r of replays) {
    const ticks = transitionTicksIn(watch, r.fromTick, r.toTick);
    if (ticks.length === 0) unexplained.push(r);
    for (const t of ticks) perTransition.set(t, (perTransition.get(t) ?? 0) + 1);
  }
  return {
    replays,
    matches: recs.length - replays.length,
    unexplained,
    perTransition,
    xz: replays.map((r) => r.note.residual?.xz ?? 0),
    yaw: replays.map((r) => r.note.residual?.yaw ?? 0),
  };
}

function matchRate(account: ReplayAccount): number {
  return account.matches / Math.max(1, account.matches + account.replays.length);
}

/** Replays whose window holds a tick in [from, to]. */
function replaysAt(account: ReplayAccount, from: number, to = from): number {
  return account.replays.filter((r) => r.fromTick <= to && r.toTick >= from).length;
}

/** Replays that sit on an effect's own ticks, and the rest, which must each
 *  sit on an off-track band edge (only a band change writes `dragMult`): a
 *  thrown machine running onto the verge. */
function splitEffectReplays(
  run: SoloRun,
  account: ReplayAccount,
  effectTicks: readonly number[],
): { effect: Reconcile[]; bandEdgeOnly: Reconcile[]; other: Reconcile[] } {
  const touches = (r: Reconcile) => effectTicks.some((t) => r.fromTick <= t && r.toTick >= t);
  const effect = account.replays.filter(touches);
  const rest = account.replays.filter((r) => !touches(r));
  const onBandEdge = (r: Reconcile) =>
    transitionTicksIn(run.watch, r.fromTick, r.toTick).some((t) =>
      (run.watch.transitionFields.get(t) ?? []).includes('dragMult'),
    );
  return {
    effect,
    bandEdgeOnly: rest.filter(onBandEdge),
    other: rest.filter((r) => !onBandEdge(r)),
  };
}

const MULTIPLIER_FIELDS: readonly TransitionField[] = [
  'gripMult',
  'dragMult',
  'speedCap',
  'slipCap',
];

/** Transition ticks where a surface multiplier the kernel reads moved. */
function multiplierTicks(watch: PilotWatch, from: number, to: number): number[] {
  return transitionTicksIn(watch, from, to).filter((t) =>
    (watch.transitionFields.get(t) ?? []).some((f) =>
      MULTIPLIER_FIELDS.includes(f as TransitionField),
    ),
  );
}

function max(values: readonly number[]): number {
  return values.reduce((a, b) => Math.max(a, b), 0);
}

function suspendsOf(watch: PilotWatch, phase?: Phase): OutcomeNote[] {
  return watch.notes.filter(
    (n) => n.kind === 'suspend' && (phase === undefined || n.phase === phase),
  );
}

/** The accounting every predicted racing run must pass. */
function expectEveryReplayExplained(watch: PilotWatch, from: number, to: number): void {
  // The pipeline reconciles once per frame, so the watch's one note per
  // frame never folds two outcomes into one.
  expect(watch.maxReconcilesPerFrame).toBeLessThanOrEqual(1);
  const account = accountReplays(watch);
  expect(account.unexplained.map((r) => [r.fromTick, r.toTick])).toEqual([]);
  // One surprise, one replay: the replay adopts what the surprise changed.
  expect(max([...account.perTransition.values()])).toBeLessThanOrEqual(1);
  // A multiplier change is always a surprise (the client never computes the
  // surface), so each explains exactly one replay, unless nothing was
  // predicted across it (a race lock or a suspend stood the prediction down).
  const covered = racingReconciles(watch);
  for (const tick of multiplierTicks(watch, from, to)) {
    if (!covered.some((r) => r.fromTick <= tick && r.toTick >= tick)) continue;
    expect({ tick, replays: account.perTransition.get(tick) ?? 0 }).toEqual({ tick, replays: 1 });
  }
}

/** Predicted on every racing frame from the first it owns (the frames before
 *  it are the GO suspend and the re-seed's first sample). */
function expectPredictedRace(watch: PilotWatch): void {
  const first = watch.racingFrames.indexOf(true);
  expect(first).toBeGreaterThanOrEqual(0);
  expect(first).toBeLessThanOrEqual(3);
  expect(watch.racingFrames.slice(first).filter((active) => !active)).toEqual([]);
}

/** One suspend at GO and one at the race end, none in between. */
function expectGoAndEndSuspendsOnly(watch: PilotWatch): void {
  const suspends = suspendsOf(watch);
  expect(suspends.filter((n) => n.phase === 'seat')).toEqual([]);
  expect(
    suspends.filter((n) => n.phase === 'go' || (n.phase === 'race' && n.beforePredictedRace)),
  ).toHaveLength(1);
  expect(suspends.filter((n) => n.phase === 'race' && !n.beforePredictedRace)).toEqual([]);
  expect(suspends.filter((n) => n.phase === 'end')).toHaveLength(1);
}

// ---------------------------------------------------------------------------
// The solo rig: one racer on the practice circuit, house pilots parked in the
// infield (never in reach), the brain driving the predicted kart.
// ---------------------------------------------------------------------------

/** One server tick of the local racer, after the tick. */
interface ServerRow {
  tick: number;
  ct: number;
  x: number;
  y: number;
  z: number;
  facing: number;
  vy: number;
  onGround: boolean;
  drive: VehicleDrive | null;
  offTrack: number | null;
  speed: number;
  travelled: number;
}

/** The predicted head the first time a client tick is predicted. */
interface HeadRow {
  x: number;
  z: number;
  facing: number;
  speed: number;
  slip: number;
}

interface SoloContext {
  rh: RacerHarness;
  watch: PilotWatch;
  match: RealmRacersMatch;
  tick: number;
  mark(name: string, tick?: number): void;
}

interface SoloOptions {
  rttMs: number;
  jitterMs?: number;
  frameMs?: number;
  raceMs: number;
  /** The closed-loop pilot (the default), or keys keyed by client tick. */
  autopilot?: PilotAutopilot;
  keysAtCt?: (ct: number) => Partial<MoveInput>;
  /** The pickup rolls the stream hands back first; every later take draws
   *  the refill (a roll of 0 is the refill on every table), which moves
   *  nothing the kernel reads. */
  rolls?: number[];
  /** Server-side side effects after the race tick (0 is the GO tick). */
  atRaceTick?: Record<number, (ctx: SoloContext) => void>;
  /** Client-side actions at a virtual ms after the race phase opens. */
  atRaceMs?: Record<number, (ctx: SoloContext) => void>;
  /** A congestion burst on the uplink every `everyMs`, `stallMs` long. */
  stalls?: { everyMs: number; stallMs: number; fromMs: number };
}

interface SoloRun {
  watch: PilotWatch;
  rows: ServerRow[];
  heads: Map<number, HeadRow>;
  goTick: number;
  lapLength: number;
  decisions: AutopilotDecisions;
  resets: number;
  takes: number;
  rngConsumed: number;
  starvedTicks: number[];
  /** Server ticks a named effect started or lapsed on (absolute). */
  marks: Record<string, number>;
  extrapolated: number;
  discardedLate: number;
  resyncs: number;
}

const solos = new Map<string, SoloRun>();

/** Runs are shared between the pins that read them (keyed by case). */
function solo(key: string, opts: SoloOptions): SoloRun {
  const cached = solos.get(key);
  if (cached) return cached;
  const run = runSolo(opts);
  solos.set(key, run);
  return run;
}

function runSolo(opts: SoloOptions): SoloRun {
  const rh = createRacerHarness({
    latency: link(opts.rttMs, opts.jitterMs ?? 10),
    frameMs: opts.frameMs,
    parking: 'infield',
  });
  try {
    const { harness } = rh;
    rh.rng.script(...(opts.rolls ?? []), ...Array.from({ length: 64 }, () => 0));
    let phase: Phase = 'seat';
    const primary: HarnessClient = {
      link: harness.link,
      session: harness.session,
      client: harness.client,
      pid: harness.pid,
      serverEntity: harness.serverEntity,
      holdIntent: harness.holdIntent,
      onFrame: harness.onClientFrame,
      reconcileOutcomes: harness.reconcileOutcomes,
      lastSentClientTick: harness.lastSentClientTick,
      predictionHead: harness.predictionHead,
    };
    const watch = watchPilot(harness, primary, () => phase);
    rh.seat();
    if (opts.keysAtCt) {
      const keysAtCt = opts.keysAtCt;
      // The held keys for the NEXT client tick, set at the end of every
      // frame: at 30 fps and above a frame samples at most one tick, so each
      // client tick carries exactly keysAtCt(ct).
      harness.onClientFrame(() => {
        harness.holdIntent({
          forward: false,
          back: false,
          turnLeft: false,
          turnRight: false,
          jump: false,
          ...keysAtCt(harness.lastSentClientTick() + 1),
        });
      });
    } else {
      rh.autopilot(opts.autopilot ?? { observe: 'predicted' });
    }
    phase = 'go';
    rh.advanceToGo();
    const match = rh.match();
    const goTick = match.goTick;
    const rows: ServerRow[] = [];
    const heads = new Map<number, HeadRow>();
    const marks: Record<string, number> = {};
    const starvedTicks: number[] = [];
    const clocks: Record<string, number> = {};
    let resets = 0;
    let takes = 0;
    const timeline = () => harness.session.movementTimeline;
    let starvedBefore = timeline()?.starved ?? 0;
    let lastCt = harness.session.lastConsumedCt;
    let gapPending = false;
    const noteTransition = (tick: number, field: string) => {
      watch.transitions.add(tick);
      const fields = watch.transitionFields.get(tick) ?? [];
      if (!fields.includes(field)) fields.push(field);
      watch.transitionFields.set(tick, fields);
    };
    const context = (tick: number): SoloContext => ({
      rh,
      watch,
      match,
      tick,
      mark(name, at = tick) {
        if (marks[name] === undefined) marks[name] = at;
      },
    });
    harness.onServerTick((events) => {
      const tick = harness.server.sim.tickCount;
      const ct = harness.session.lastConsumedCt;
      const starved = timeline()?.starved ?? 0;
      if (gapPending) {
        // The tick after a starved tick that consumed no client tick: the
        // body moved on an empty input the client never sent, and the first
        // acknowledgement that can show it is this tick's.
        noteTransition(tick, 'starved');
        gapPending = false;
      }
      if (phase === 'race' && starved > starvedBefore) {
        starvedTicks.push(tick);
        // A starved tick drives the body with an input the client never sent
        // for it (the last one extrapolated, or none): a server transition.
        noteTransition(tick, 'starved');
        if (ct === lastCt) gapPending = true;
      }
      starvedBefore = starved;
      lastCt = ct;
      const ctx = context(tick);
      for (const ev of events) {
        if (ev.type === 'realmRacersReset' && ev.pid === harness.pid) {
          resets++;
          ctx.mark('reset');
        }
        if (ev.type === 'realmRacersPickup' && ev.pid === harness.pid) {
          takes++;
          ctx.mark(`take:${ev.effect}`);
        }
        if (ev.type === 'realmRacersSlicked' && ev.targetId === harness.pid) ctx.mark('slicked');
        if (ev.type === 'realmRacersGroundBlastHit' && ev.targetId === harness.pid) {
          ctx.mark('blastHit');
        }
      }
      // The rally's effect clocks: the onset is the tick one is written, the
      // expiry the tick it lapses (the surface pass stops applying it).
      const progress = match.progress.get(harness.pid);
      if (progress) {
        for (const [name, until] of [
          ['nitro', progress.nitroUntilTick],
          ['oil', progress.slickGripUntilTick],
          ['shock', progress.groundBlastShockUntilTick],
        ] as const) {
          if (until > (clocks[name] ?? 0)) {
            ctx.mark(`${name}On`);
            marks[`${name}Off`] = until;
          }
          clocks[name] = until;
        }
      }
      const e = harness.serverEntity;
      if (e.auras.some((a) => a.id === REALM_RACERS_GROUND_BLAST_AURA)) ctx.mark('blastAuraOn');
      else if (marks.blastAuraOn !== undefined) ctx.mark('blastAuraOff');
      if (phase === 'race' && !e.onGround) ctx.mark('airborne');
      if (e.onGround && marks.airborne !== undefined) ctx.mark('landed');
      const offTrack = e.auras.find((a) => a.id === REALM_RACERS_OFF_TRACK_AURA)?.value ?? null;
      if (offTrack === REALM_RACERS_VERGE_BAND.speedMult) ctx.mark('verge');
      if (offTrack === REALM_RACERS_GARDEN_BAND.speedMult) ctx.mark('garden');
      opts.atRaceTick?.[tick - goTick]?.(ctx);
      if (phase !== 'race') return;
      rows.push({
        tick,
        ct,
        x: e.pos.x,
        y: e.pos.y,
        z: e.pos.z,
        facing: e.facing,
        vy: e.vy,
        onGround: e.onGround,
        drive: e.drive ? { ...e.drive } : null,
        offTrack,
        speed: e.drive
          ? Math.hypot(vehicleVelocityX(e.drive, e.facing), vehicleVelocityZ(e.drive, e.facing))
          : 0,
        travelled: progress?.travelled ?? 0,
      });
    });
    harness.onClientFrame(() => {
      const head = harness.predictionHead();
      if (phase !== 'race' || !head?.state.drive || heads.has(head.ct)) return;
      heads.set(head.ct, {
        x: head.state.pos.x,
        z: head.state.pos.z,
        facing: head.state.facing,
        speed: head.state.drive.speed,
        slip: head.state.drive.slip,
      });
    });
    phase = 'race';
    const raceStart = harness.clock.now();
    for (const [ms, run] of Object.entries(opts.atRaceMs ?? {})) {
      harness.clock.schedule(raceStart + Number(ms), () =>
        run(context(harness.server.sim.tickCount)),
      );
    }
    if (opts.stalls) {
      const { everyMs, stallMs, fromMs } = opts.stalls;
      for (let at = fromMs; at < opts.raceMs; at += everyMs) {
        harness.clock.schedule(raceStart + at, () =>
          harness.link.stall('toServer', harness.clock.now() + stallMs),
        );
      }
    }
    harness.clock.advanceTo(raceStart + opts.raceMs);
    phase = 'end';
    rh.autopilot(null);
    harness.client.forfeitRealmRacers();
    harness.clock.advanceTo(
      harness.clock.now() + REALM_RACERS_RETURN_TICKS * SERVER_TICK_MS + 1500,
    );
    return {
      watch,
      rows,
      heads,
      goTick,
      lapLength: realmRacersTrack(realmRacersCircuitOf(match)).length,
      decisions: rh.autopilotDecisions(),
      resets,
      takes,
      rngConsumed: rh.rng.consumed,
      starvedTicks,
      marks,
      extrapolated: timeline()?.extrapolated ?? 0,
      discardedLate: timeline()?.discardedLate ?? 0,
      resyncs: timeline()?.resyncs ?? 0,
    };
  } finally {
    rh.dispose();
  }
}

// ---------------------------------------------------------------------------
// Effects, injected where the server's own tick would make them
// ---------------------------------------------------------------------------

/** A parked house pilot, the owner of anything injected on the local one. */
function housePilot(ctx: SoloContext): number {
  const other = ctx.match.pids.find((pid) => pid !== ctx.rh.harness.pid);
  if (other === undefined) throw new Error('no house pilot in the practice');
  return other;
}

/** Where the local machine will be `aheadSec` from now at its velocity. */
function aheadOf(ctx: SoloContext, aheadSec: number): { x: number; z: number } {
  const e = ctx.rh.harness.serverEntity;
  const drive = e.drive;
  if (!drive) throw new Error('the local pilot is not driving');
  return {
    x: e.pos.x + vehicleVelocityX(drive, e.facing) * aheadSec,
    z: e.pos.z + vehicleVelocityZ(drive, e.facing) * aheadSec,
  };
}

/** A house pilot's shell landing dead centre on the local machine next tick
 *  (the landing half of a real shot; the firing is not under test). */
function landShell(ctx: SoloContext): void {
  const at = aheadOf(ctx, DT);
  ctx.match.groundBlasts.push({
    ownerPid: housePilot(ctx),
    x: at.x,
    z: at.z,
    impactTick: ctx.tick + 1,
  });
}

/** A house pilot's oil on the local machine's line, a few yards ahead. */
function layOil(ctx: SoloContext): void {
  const at = aheadOf(ctx, 0.1);
  const local = realmRacersToCanonical(ctx.match, at.x, at.z);
  ctx.match.slicks.push({
    id: ctx.match.nextSlickId++,
    x: local.x,
    z: local.z,
    ownerPid: housePilot(ctx),
    ownerClear: true,
    expiresTick: ctx.tick + REALM_RACERS_SLICK_LIFETIME_TICKS,
  });
}

/** A contact-shaped impulse after the next tick (a rival's shove without
 *  the rival), flagged as the transition it is. */
function shoveNow(ctx: SoloContext): void {
  ctx.rh.shove({ slip: 6, spin: 1.2 });
  const remove = ctx.rh.harness.onServerTick(() => {
    remove();
    const tick = ctx.rh.harness.server.sim.tickCount;
    ctx.mark('shove', tick);
    ctx.watch.transitions.add(tick);
    ctx.watch.transitionFields.set(tick, [...(ctx.watch.transitionFields.get(tick) ?? []), 'bump']);
  });
}

/** Hold the brain's line `pastEdgeYd` beyond the road's edge (null: back on
 *  its own line). */
function holdLane(ctx: SoloContext, pastEdgeYd: number | null): void {
  if (pastEdgeYd === null) {
    ctx.rh.autopilot({ observe: 'predicted' });
    return;
  }
  const lap = realmRacersTrack(realmRacersCircuitOf(ctx.match));
  const e = ctx.rh.harness.serverEntity;
  const here = realmRacersToCanonical(ctx.match, e.pos.x, e.pos.z);
  const s = lap.project(here.x, here.z).s;
  ctx.rh.autopilot({ observe: 'predicted', lineOffsetYd: lap.halfWidthAt(s) + pastEdgeYd });
}

/** Every effect starts at 4 s of racing, on the same stretch at every RTT. */
const EFFECT_AT_TICK = 80;
const EFFECT_RACE_MS = 10000;

type EffectName = 'shell' | 'oil' | 'nitro' | 'shove' | 'verge' | 'garden';

const EFFECTS: Record<EffectName, Partial<SoloOptions>> = {
  shell: { atRaceTick: { [EFFECT_AT_TICK]: landShell } },
  oil: { atRaceTick: { [EFFECT_AT_TICK]: layOil } },
  shove: { atRaceTick: { [EFFECT_AT_TICK]: shoveNow } },
  // The first box of the lap draws the nitro (the scripted roll), and the
  // pilot spends it through the real cast over its own uplink.
  nitro: {
    rolls: [rallyPickupRollFor('leader', 'nitro')],
    atRaceMs: {
      [EFFECT_AT_TICK * SERVER_TICK_MS]: (ctx) => {
        ctx.mark('nitroCast');
        ctx.rh.harness.client.castAbility(REALM_RACERS_NITRO_ABILITY_ID);
      },
    },
  },
  // Out onto the mown verge for three seconds, then back.
  verge: {
    atRaceTick: {
      [EFFECT_AT_TICK]: (ctx) => holdLane(ctx, 3),
      [EFFECT_AT_TICK + 60]: (ctx) => holdLane(ctx, null),
    },
  },
  // Through the verge into the garden lawn and back again.
  garden: {
    atRaceTick: {
      [EFFECT_AT_TICK]: (ctx) => holdLane(ctx, 14),
      [EFFECT_AT_TICK + 40]: (ctx) => holdLane(ctx, null),
    },
  },
};

function effectRun(effect: EffectName, rttMs: Rtt): SoloRun {
  return solo(`effect:${effect}:${rttMs}`, { rttMs, raceMs: EFFECT_RACE_MS, ...EFFECTS[effect] });
}

/**
 * The correction a single replay may make, per effect and RTT: the measured
 * worst case plus a fifth, rounded UP to two significant figures (xz yd, yaw
 * rad). A replay replays one
 * round trip of predicted ticks, so the bound grows with the RTT; the shell
 * is the largest because the pop, the 22 yd/s push and the yaw kick all land
 * in one tick.
 */
const RESIDUAL_BOUNDS: Record<EffectName | 'starve', Record<Rtt, { xz: number; yaw: number }>> = {
  shell: {
    60: { xz: 2.4, yaw: 0.4 },
    120: { xz: 3.3, yaw: 0.59 },
    200: { xz: 5.1, yaw: 0.88 },
  },
  oil: {
    60: { xz: 1.7, yaw: 0.0056 },
    120: { xz: 2.6, yaw: 0.0078 },
    200: { xz: 4.3, yaw: 0.029 },
  },
  nitro: {
    60: { xz: 0.74, yaw: 0.011 },
    120: { xz: 1.5, yaw: 0.02 },
    200: { xz: 2.3, yaw: 0.036 },
  },
  shove: {
    60: { xz: 0.31, yaw: 0.072 },
    120: { xz: 0.74, yaw: 0.2 },
    200: { xz: 0.87, yaw: 0.3 },
  },
  verge: {
    60: { xz: 0.086, yaw: 0.0007 },
    120: { xz: 0.25, yaw: 0.0035 },
    200: { xz: 0.44, yaw: 0.0062 },
  },
  garden: {
    60: { xz: 0.11, yaw: 0.00088 },
    120: { xz: 0.24, yaw: 0.0024 },
    200: { xz: 0.6, yaw: 0.0051 },
  },
  starve: {
    60: { xz: 1.7, yaw: 0.13 },
    120: { xz: 1.6, yaw: 0.19 },
    200: { xz: 1.6, yaw: 0.24 },
  },
};

// ---------------------------------------------------------------------------
// 1 + 3 + 4. The closed loop on the predicted kart, clean racing
// ---------------------------------------------------------------------------

/** One lap and a third of the practice circuit at race pace. */
const LAP_MS = 16000;

function cleanLap(rttMs: Rtt): SoloRun {
  return solo(`clean:${rttMs}`, { rttMs, raceMs: LAP_MS });
}

describe.each(RTTS)('the house-pilot brain on the predicted kart (%i ms RTT)', (rttMs) => {
  it('keeps a whole lap on the road at racing speed', () => {
    const run = cleanLap(rttMs);
    expect(run.rows.at(-1)?.travelled ?? 0).toBeGreaterThan(run.lapLength);
    expect(run.resets).toBe(0);
    expect(run.rows.filter((r) => r.offTrack !== null)).toEqual([]);
    const meanSpeed = run.rows.reduce((a, r) => a + r.speed, 0) / run.rows.length;
    // Measured 37.4 to 37.5 yd/s, the practice circuit's race pace.
    expect(meanSpeed).toBeGreaterThan(35);
    // Every take drew the refill, and nothing else ate a scripted roll.
    expect(run.takes).toBeGreaterThan(0);
    expect(run.rngConsumed).toBe(run.takes);
  });

  it('decides on the predicted kart, the way a human reacts to the screen', () => {
    const { decisions } = cleanLap(rttMs);
    expect(decisions.server).toBe(0);
    // One decision per predicted client tick; the mirror only stands in for
    // the frames the prediction re-seeds across GO.
    expect(decisions.mirror).toBeLessThanOrEqual(2);
    expect(decisions.predicted).toBeGreaterThan((LAP_MS / SERVER_TICK_MS) * 0.99);
  });

  it('predicts every racing frame and suspends only at GO and race end', () => {
    const { watch } = cleanLap(rttMs);
    expectPredictedRace(watch);
    expectGoAndEndSuspendsOnly(watch);
  });

  it('matches the acknowledged state exactly on clean racing', () => {
    const run = cleanLap(rttMs);
    const account = accountReplays(run.watch);
    expect(account.matches).toBeGreaterThan(300);
    // Measured 1.000: not one replay. The floor documents the claim; the
    // empty list is the pin.
    expect(account.replays).toEqual([]);
    expect(matchRate(account)).toBeGreaterThanOrEqual(CLEAN_MATCH_FLOOR);
    expectEveryReplayExplained(run.watch, run.goTick, run.goTick + LAP_MS / SERVER_TICK_MS);
  });

  it('home on foot, the runner is predicted again with no replay after the race', () => {
    const { watch } = cleanLap(rttMs);
    const home = watch.endFrames.findIndex((f) => !f.driving);
    expect(home).toBeGreaterThan(0);
    const seedFrames = Math.ceil((DT * 1000) / DEFAULT_FRAME_MS) + 1;
    const settled = watch.endFrames.slice(home + seedFrames);
    expect(settled.length).toBeGreaterThan(20);
    expect(settled.filter((f) => !f.predictorActive)).toEqual([]);
    const endSuspend = watch.notes.findIndex((n) => n.phase === 'end' && n.kind === 'suspend');
    expect(watch.notes.slice(endSuspend).filter((n) => n.kind === 'replayed')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2 + 4 + 7. Pickups, contacts and surfaces, each counted per transition
// ---------------------------------------------------------------------------

function markOf(run: SoloRun, name: string): number {
  const at = run.marks[name];
  if (at === undefined) throw new Error(`the run never reached ${name}`);
  return at;
}

describe.each(RTTS)('server outcomes the client cannot predict (%i ms RTT)', (rttMs) => {
  it.each(Object.keys(EFFECTS) as EffectName[])(
    '%s: every replay sits on a transition, one at most each, the residual bounded',
    (effect) => {
      const run = effectRun(effect, rttMs);
      expectPredictedRace(run.watch);
      expectGoAndEndSuspendsOnly(run.watch);
      expectEveryReplayExplained(run.watch, run.goTick, run.goTick + EFFECT_RACE_MS / 50);
      const account = accountReplays(run.watch);
      expect(account.replays.length).toBeGreaterThan(0);
      const bound = RESIDUAL_BOUNDS[effect][rttMs];
      expect(max(account.xz)).toBeLessThanOrEqual(bound.xz);
      expect(max(account.yaw)).toBeLessThanOrEqual(bound.yaw);
      expect(run.resets).toBe(0);
    },
  );

  it('shell shock: two replays at the hit, none at the landing, one at the expiry', () => {
    const run = effectRun('shell', rttMs);
    const account = accountReplays(run.watch);
    const hit = markOf(run, 'blastHit');
    // The pop, the push and the control aura land in the hit's own tick; the
    // grip loss only at the next tick's surface pass: two surprises.
    expect(markOf(run, 'shockOn')).toBe(hit);
    expect(markOf(run, 'airborne')).toBe(hit);
    expect(replaysAt(account, hit)).toBe(1);
    expect(replaysAt(account, hit + 1)).toBe(1);
    // Two DISTINCT replays: one spanning both ticks would read 1 here.
    expect(replaysAt(account, hit, hit + 1)).toBe(2);
    expect(run.watch.transitionFields.get(hit + 1)).toEqual(['gripMult']);
    // Airborne for the whole flight and predicted through it: the landing is
    // the kernel's own, so no replay has only the landing in its window.
    const landed = markOf(run, 'landed');
    expect(landed - hit).toBeGreaterThan(20);
    const landingOnly = account.replays.filter((r) => {
      const ticks = transitionTicksIn(run.watch, r.fromTick, r.toTick);
      return (
        ticks.length > 0 &&
        ticks.every((t) => t === landed) &&
        (run.watch.transitionFields.get(landed) ?? []).every((f) => f === 'onGround')
      );
    });
    expect(landingOnly).toEqual([]);
    // The shock and the control aura lapse on the same tick: one replay.
    const off = markOf(run, 'shockOff');
    expect(off).toBe(hit + GROUND_BLAST_SHOCK_TICKS);
    expect(markOf(run, 'blastAuraOff')).toBe(off);
    expect(replaysAt(account, off)).toBe(1);
    // Three for the shell itself; every other replay sits on a band edge the
    // thrown machine crossed (measured four at every RTT).
    const split = splitEffectReplays(run, account, [hit, hit + 1, off]);
    expect(split.effect).toHaveLength(3);
    expect(split.other).toEqual([]);
    expect(account.replays).toHaveLength(3 + split.bandEdgeOnly.length);
  });

  it('oil: two replays as it bites, one as the grip comes back', () => {
    const run = effectRun('oil', rttMs);
    const account = accountReplays(run.watch);
    const bite = markOf(run, 'slicked');
    expect(markOf(run, 'oilOn')).toBe(bite);
    // The throw and the raised slide ceiling in the bite's tick, the grip
    // loss one surface pass later.
    expect(replaysAt(account, bite)).toBe(1);
    expect(run.watch.transitionFields.get(bite)).toContain('slipCap');
    expect(replaysAt(account, bite + 1)).toBe(1);
    expect(replaysAt(account, bite, bite + 1)).toBe(2);
    expect(run.watch.transitionFields.get(bite + 1)).toContain('gripMult');
    const off = markOf(run, 'oilOff');
    expect(off).toBe(bite + REALM_RACERS_SLICK_GRIP_TICKS);
    expect(replaysAt(account, off)).toBe(1);
    // Three for the oil itself, the rest on band edges (measured four).
    const split = splitEffectReplays(run, account, [bite, bite + 1, off]);
    expect(split.effect).toHaveLength(3);
    expect(split.other).toEqual([]);
    expect(account.replays).toHaveLength(3 + split.bandEdgeOnly.length);
  });

  it('nitro: one replay at the burst, one as it runs out', () => {
    const run = effectRun('nitro', rttMs);
    const account = accountReplays(run.watch);
    // The box really handed it over and the pilot's own cast spent it.
    expect(markOf(run, 'take:nitro')).toBeLessThan(markOf(run, 'nitroCast'));
    const on = markOf(run, 'nitroOn');
    expect(on).toBeGreaterThan(markOf(run, 'nitroCast'));
    expect(replaysAt(account, on)).toBe(1);
    const off = markOf(run, 'nitroOff');
    // The spend lands between ticks and writes `tickCount + NITRO_TICKS` off
    // the tick before the first one it boosts: the burst is seen on exactly
    // NITRO_TICKS - 1 post-tick states (measured 39 at every RTT).
    expect(off - on).toBe(REALM_RACERS_NITRO_TICKS - 1);
    expect(replaysAt(account, off)).toBe(1);
    expect(account.replays).toHaveLength(2);
  });

  it('a contact shove: one replay', () => {
    const run = effectRun('shove', rttMs);
    const account = accountReplays(run.watch);
    expect(replaysAt(account, markOf(run, 'shove'))).toBe(1);
    expect(account.replays).toHaveLength(1);
  });

  it('the verge slow aura: one replay onto it, one off it', () => {
    const run = effectRun('verge', rttMs);
    const account = accountReplays(run.watch);
    const onto = markOf(run, 'verge');
    expect(replaysAt(account, onto)).toBe(1);
    // Every band change on the way out and back, one replay each.
    const bandTicks = multiplierTicks(run.watch, run.goTick, run.goTick + EFFECT_RACE_MS / 50);
    expect(bandTicks.length).toBeGreaterThanOrEqual(2);
    expect(account.replays).toHaveLength(bandTicks.length);
  });

  it('the garden band: one replay deeper, one back out, one per band edge', () => {
    const run = effectRun('garden', rttMs);
    const account = accountReplays(run.watch);
    expect(markOf(run, 'verge')).toBeLessThan(markOf(run, 'garden'));
    // Road to verge, verge to garden, garden to verge, verge to road.
    const bandTicks = multiplierTicks(run.watch, run.goTick, run.goTick + EFFECT_RACE_MS / 50);
    expect(bandTicks).toHaveLength(4);
    expect(account.replays).toHaveLength(4);
  });
});

// The rally has no stun and no root: the only controls it takes are the
// grid, recovery and cut locks (the race lock below), and the Ground Blast
// control effect is a slow aura (the shell case above).

// ---------------------------------------------------------------------------
// 7. Discontinuities: a manual recovery, the race end
// ---------------------------------------------------------------------------

function recoveryRun(rttMs: Rtt): SoloRun {
  return solo(`recovery:${rttMs}`, {
    rttMs,
    raceMs: EFFECT_RACE_MS,
    atRaceMs: { 4000: (ctx) => ctx.rh.harness.client.resetRealmRacersPosition() },
  });
}

describe.each(RTTS)('a manual recovery (%i ms RTT)', (rttMs) => {
  it('suspends once, is drawn from the server through the lock, then re-seeds', () => {
    const run = recoveryRun(rttMs);
    expect(run.resets).toBe(1);
    const suspends = suspendsOf(run.watch, 'race').filter((n) => !n.beforePredictedRace);
    // One suspend, as the lock lifts (the reset and the lock start share the
    // override that stands the prediction down).
    expect(suspends).toHaveLength(1);
    expect(suspends[0].tick).toBe(markOf(run, 'reset') + REALM_RACERS_RESET_LOCK_TICKS);
    const frames = run.watch.racingFrames;
    const first = frames.indexOf(true);
    const gaps: number[][] = [];
    for (let i = first; i < frames.length; i++) {
      if (frames[i]) continue;
      const last = gaps.at(-1);
      if (last && last[1] === i - 1) last[1] = i;
      else gaps.push([i, i]);
    }
    // One stretch of fallback frames, the length of the lock plus the round
    // trip and the re-seed's first sample.
    expect(gaps).toHaveLength(1);
    const lockFrames = (REALM_RACERS_RESET_LOCK_TICKS * SERVER_TICK_MS) / DEFAULT_FRAME_MS;
    const length = gaps[0][1] - gaps[0][0] + 1;
    expect(length).toBeGreaterThanOrEqual(lockFrames - 2);
    expect(length).toBeLessThanOrEqual(
      lockFrames + (rttMs + 2 * SERVER_TICK_MS) / DEFAULT_FRAME_MS,
    );
    expect(accountReplays(run.watch).replays).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. Input starvation: a jittery uplink with congestion bursts
// ---------------------------------------------------------------------------

function starvationRun(rttMs: Rtt): SoloRun {
  return solo(`starve:${rttMs}`, {
    rttMs,
    jitterMs: 40,
    raceMs: LAP_MS,
    stalls: { everyMs: 2000, stallMs: 180, fromMs: 1500 },
  });
}

/** Consecutive starved ticks, grouped. */
function episodes(ticks: readonly number[]): number[][] {
  const out: number[][] = [];
  for (const tick of ticks) {
    const last = out.at(-1);
    if (last && last[last.length - 1] === tick - 1) last.push(tick);
    else out.push([tick]);
  }
  return out;
}

describe.each(RTTS)('input starvation (%i ms RTT, 40 ms jitter, 180 ms bursts)', (rttMs) => {
  it('costs at most one replay per starved tick and never suspends', () => {
    const run = starvationRun(rttMs);
    // The case really starves: the server extrapolated the last input.
    expect(run.extrapolated).toBeGreaterThan(10);
    expect(run.resyncs).toBe(0);
    const eps = episodes(run.starvedTicks);
    // One episode per burst (seven bursts in the lap), each a tick to three.
    expect(eps.length).toBeGreaterThanOrEqual(7);
    expect(max(eps.map((e) => e.length))).toBeLessThanOrEqual(3);
    const account = accountReplays(run.watch);
    for (const ep of eps) {
      const cost = replaysAt(account, ep[0], ep[ep.length - 1] + 1);
      // Measured 0 to 2 per episode at every RTT.
      expect({ ep, cost: Math.min(cost, 2) }).toEqual({ ep, cost });
      expect(cost).toBeLessThanOrEqual(ep.length);
    }
    expectEveryReplayExplained(run.watch, run.goTick, run.goTick + LAP_MS / SERVER_TICK_MS);
    expectPredictedRace(run.watch);
    expectGoAndEndSuspendsOnly(run.watch);
    const bound = RESIDUAL_BOUNDS.starve[rttMs];
    expect(max(account.xz)).toBeLessThanOrEqual(bound.xz);
    expect(max(account.yaw)).toBeLessThanOrEqual(bound.yaw);
  });
});

// ---------------------------------------------------------------------------
// 6. Fairness: identical per-client-tick outcomes at 30 and 144 fps
// ---------------------------------------------------------------------------

/** Keys keyed by client tick: full throttle, the wheel swept left, centre,
 *  right in blocks of 16 ticks. A key change at a fixed wall instant would
 *  land on different client ticks at different frame rates, so the proof
 *  compares per client tick for identical per-client-tick inputs. */
function sweepKeys(ct: number): Partial<MoveInput> {
  const block = Math.floor(ct / 16) % 4;
  return { forward: true, turnLeft: block === 1, turnRight: block === 3 };
}

function fpsRun(rttMs: Rtt, fps: 30 | 144, jitterMs: number): SoloRun {
  return solo(`fps:${rttMs}:${fps}:${jitterMs}`, {
    rttMs,
    jitterMs,
    frameMs: 1000 / fps,
    raceMs: 8000,
    keysAtCt: sweepKeys,
  });
}

function byCt<T>(rows: readonly (T & { ct: number })[]): Map<number, T> {
  return new Map(rows.map((row) => [row.ct, row]));
}

describe.each(RTTS)('frame-rate fairness (%i ms RTT)', (rttMs) => {
  it('gives identical server outcomes and predictions per client tick at 30 and 144 fps', () => {
    // A link without jitter: every client tick reaches the server in time at
    // both frame rates, so both servers consume the same inputs.
    const slow = fpsRun(rttMs, 30, 0);
    const fast = fpsRun(rttMs, 144, 0);
    expect(slow.goTick).toBe(fast.goTick);
    expect(slow.starvedTicks).toEqual([]);
    expect(fast.starvedTicks).toEqual([]);
    // The whole row, the server tick that consumed each client tick included.
    const a = byCt(slow.rows);
    const b = byCt(fast.rows);
    expect(a.size).toBeGreaterThan(150);
    expect([...a.keys()]).toEqual([...b.keys()]);
    for (const [ct, row] of a) expect(b.get(ct)).toEqual(row);
    // The client's own prediction of each tick, the first time it is made,
    // over a bounded overlap (only the GO seam may differ).
    const shared = [...slow.heads.keys()].filter((ct) => fast.heads.has(ct));
    expect(shared.length).toBeGreaterThan(130);
    for (const ct of shared) {
      expect({ ct, ...fast.heads.get(ct) }).toEqual({ ct, ...slow.heads.get(ct) });
    }
    // And the same reconcile outcome per acknowledged tick (the server tick
    // that consumed it: the tick mapping is pinned identical above).
    const outcomes = (run: SoloRun) =>
      racingReconciles(run.watch).map((r) => [r.toTick, r.note.kind]);
    // Measured 125 at 200 ms, where the sweep crosses a cut and the
    // referee's lock stands the prediction down for a stretch; more elsewhere.
    expect(outcomes(slow).length).toBeGreaterThanOrEqual(120);
    expect(outcomes(fast)).toEqual(outcomes(slow));
    expectEveryReplayExplained(slow.watch, slow.goTick, slow.goTick + 160);
    expectEveryReplayExplained(fast.watch, fast.goTick, fast.goTick + 160);
  });
});

// A BASELINE DEFECT, pinned so its fix shows (it is the v2 input timeline's,
// for every player, not the kart's). The sampler takes
// a client tick at the first FRAME past its deadline, so at 30 fps a tick
// leaves up to 33 ms late while at 144 fps it leaves within 7 ms. The server
// consumes one client tick per tick with no playout margin beyond the phase
// its first frame set, and only resyncs after three starved ticks in a row: a
// 30 fps client whose late ticks miss that margin has them extrapolated (and
// the real one discarded) indefinitely. Both still reconcile exactly: every
// replay sits on a starved tick.
describe('frame-rate fairness under jitter (baseline: the v2 input timeline)', () => {
  it('extrapolates a 30 fps client far more than a 144 fps one on the same link', () => {
    const slow = fpsRun(60, 30, 10);
    const fast = fpsRun(60, 144, 10);
    // Measured 125 extrapolated of about 160 race ticks at 30 fps, 0 at 144.
    expect(slow.extrapolated).toBeGreaterThan(80);
    expect(fast.extrapolated).toBe(0);
    // Each extrapolated tick throws the client's real frame away when it
    // lands: the input is not late, it is lost.
    expect(Math.abs(slow.discardedLate - slow.extrapolated)).toBeLessThanOrEqual(2);
    expect(fast.discardedLate).toBe(0);
    expectEveryReplayExplained(slow.watch, slow.goTick, slow.goTick + 160);
    expectEveryReplayExplained(fast.watch, fast.goTick, fast.goTick + 160);
  });

  it('is the timeline, not the kart: a 30 fps runner starves the same way', () => {
    const extrapolated = (fps: number) => {
      const h = createOnlineHarness({ latency: link(60, 10), frameMs: 1000 / fps });
      try {
        return (
          h.runScript({ durationMs: 8000, script: [{ atMs: 0, mi: { forward: true }, facing: 0 }] })
            .movementTimeline?.extrapolated ?? -1
        );
      } finally {
        h.dispose();
      }
    };
    // Measured 59 of 178 ticks at 30 fps, 0 at 60 and 144.
    expect(extrapolated(30)).toBeGreaterThan(30);
    expect(extrapolated(60)).toBe(0);
    expect(extrapolated(144)).toBe(0);
  });
});

/** The relative module specifiers a source imports: static and re-export
 *  `from`, side-effect `import '...'`, and dynamic `import('...')`, with
 *  comments stripped first (a quoted path in a comment is not an edge). */
function importSpecifiers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  const out: string[] = [];
  const forms = [
    // `[^;]` spans a multi-line import list.
    /^\s*(?:import|export)\b[^;]*?\bfrom\s+['"](\.[^'"]+)['"]/gm,
    /^\s*import\s+['"](\.[^'"]+)['"]/gm,
    /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  ];
  for (const form of forms) for (const match of code.matchAll(form)) out.push(match[1]);
  return out;
}

/** Every local module a source file reaches through its imports. */
function importClosure(entries: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...entries];
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
      const target = resolve(dirname(file), specifier);
      if (target.endsWith('.ts')) stack.push(target);
      else if (existsSync(`${target}.ts`)) stack.push(`${target}.ts`);
      else stack.push(resolve(target, 'index.ts'));
    }
  }
  return seen;
}

describe('the import scan reads every import form', () => {
  it('finds static, re-export, side-effect and dynamic imports, and skips comments', () => {
    const source = [
      "import { a } from './static';",
      'import {',
      '  b,',
      "} from './multi_line';",
      "import type { C } from './type_only';",
      "export { d } from './re_export';",
      "import './side_effect';",
      "const lazy = () => import('./dynamic');",
      "// import { e } from './line_comment';",
      "/* import './block_comment'; */",
      "const url = 'http://example.test'; import('./after_url');",
      "import { f } from 'three';",
    ].join('\n');
    expect(importSpecifiers(source).sort()).toEqual(
      [
        './after_url',
        './dynamic',
        './multi_line',
        './re_export',
        './side_effect',
        './static',
        './type_only',
      ].sort(),
    );
  });
});

describe('frame-rate fairness: nothing on the prediction path reads the graphics tier', () => {
  it('imports no tier, preset, governor or cadence module', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const closure = importClosure(
      [
        'src/render/self_prediction.ts',
        'src/render/self_render_position_core.ts',
        'src/render/deck_frame.ts',
        'src/game/input_tick_sampler.ts',
      ].map((p) => resolve(root, p)),
    );
    const files = [...closure].map((f) => f.slice(root.length + 1));
    expect(files).toContain('src/render/self_prediction_core.ts');
    expect(files).toContain('src/sim/vehicle_motion.ts');
    const tierReaders = files.filter((f) =>
      /ui_effects_profile|ui_tier_knobs|graphics|governor|frame_cadence|chosen_cadence|post_shed|render_budget|perf_/.test(
        f,
      ),
    );
    expect(tierReaders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 8. The duel: two humans predicted at asymmetric RTTs, a rear ram
// ---------------------------------------------------------------------------

interface DuelRun {
  watches: { a: PilotWatch; b: PilotWatch };
  goTick: number;
  bumpTicks: number[];
  contactTicks: number[];
}

/** The rear ram of the rival-frames suite with both pilots on the brain
 *  reading their OWN predicted kart: B leads, A leaves the grid 0.4 s later
 *  and runs into B when B lifts to 40 pct pace at 3 s. */
function runDuelRam(rttA: number, rttB: number): DuelRun {
  const d = createRacerDuelHarness({
    latencyA: link(rttA, 10, 1337),
    latencyB: link(rttB, 10, 7331),
  });
  try {
    const { harness, a, b } = d;
    let phase: Phase = 'seat';
    const watches = {
      a: watchPilot(harness, a.peer, () => phase),
      b: watchPilot(harness, b.peer, () => phase),
    };
    d.seat();
    const reachYd =
      2 *
      vehicleProfile(a.peer.serverEntity.drive?.profileKey ?? REALM_RACERS_VEHICLE_KEY).bodyRadius;
    const bumpTicks: number[] = [];
    const contactTicks: number[] = [];
    harness.onServerTick((events) => {
      if (phase !== 'race') return;
      const tick = harness.server.sim.tickCount;
      if (events.some((ev) => ev.type === 'realmRacersBump')) bumpTicks.push(tick);
      const pa = a.peer.serverEntity.pos;
      const pb = b.peer.serverEntity.pos;
      // Within the reach plus a margin: a tick the server may settle or
      // shove the pair without an announced bump.
      if (Math.hypot(pa.x - pb.x, pa.z - pb.z) < reachYd + 2) {
        contactTicks.push(tick);
        for (const w of [watches.a, watches.b]) {
          w.transitions.add(tick);
          w.transitionFields.set(tick, [...(w.transitionFields.get(tick) ?? []), 'bump']);
        }
      }
    });
    b.autopilot({ observe: 'predicted' });
    a.keys({});
    phase = 'go';
    d.advanceToGo();
    const goTick = d.match().goTick;
    phase = 'race';
    d.advanceToRaceMs(400);
    a.autopilot({ observe: 'predicted' });
    d.advanceToRaceMs(3000);
    b.autopilot({ observe: 'predicted', speedScale: 0.4 });
    d.advanceToRaceMs(7000);
    phase = 'end';
    a.autopilot(null);
    b.autopilot(null);
    a.client.forfeitRealmRacers();
    b.client.forfeitRealmRacers();
    d.advanceFor(REALM_RACERS_RETURN_TICKS * SERVER_TICK_MS + 1500);
    return { watches, goTick, bumpTicks, contactTicks };
  } finally {
    d.dispose();
  }
}

/** Residual ceiling after the ram, yd: measured 1.63 worst (the 200 ms
 *  rammer), rounded up with margin. */
const DUEL_RESIDUAL_XZ = 2;
const DUEL_RESIDUAL_YAW = 0.6;

describe.each([
  [60, 60],
  [120, 120],
  [200, 200],
  [60, 200],
  [200, 60],
] as const)('a rear ram between two predicted humans (A %i ms, B %i ms)', (rttA, rttB) => {
  it('both converge after the bump with bounded residuals', () => {
    const run = runDuelRam(rttA, rttB);
    expect(run.bumpTicks.length).toBeGreaterThan(0);
    const lastContact = max(run.contactTicks);
    expect(lastContact).toBeGreaterThanOrEqual(run.bumpTicks[0]);
    for (const watch of [run.watches.a, run.watches.b]) {
      expectPredictedRace(watch);
      expectGoAndEndSuspendsOnly(watch);
      expectEveryReplayExplained(watch, run.goTick, run.goTick + 140);
      const account = accountReplays(watch);
      // The ram itself (measured one replay each, three for the 200 ms
      // rammer while the hulls rub).
      expect(account.replays.length).toBeGreaterThan(0);
      expect(account.replays.length).toBeLessThanOrEqual(4);
      expect(max(account.xz)).toBeLessThanOrEqual(DUEL_RESIDUAL_XZ);
      expect(max(account.yaw)).toBeLessThanOrEqual(DUEL_RESIDUAL_YAW);
      // Converged: once the hulls are apart, every acknowledgement matches
      // but where a surface edge changed a multiplier (a thrown machine
      // running onto the verge).
      const after = racingReconciles(watch).filter((r) => r.fromTick > lastContact);
      expect(after.length).toBeGreaterThan(20);
      const surprises = after.filter(
        (r) => r.note.kind !== 'match' && multiplierTicks(watch, r.fromTick, r.toTick).length === 0,
      );
      expect(surprises).toEqual([]);
    }
  });
});
