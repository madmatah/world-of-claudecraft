import { afterAll, beforeAll, describe, expect, expectTypeOf, it, vi } from 'vitest';

// Postgres is mocked before server/game is imported (tests/CLAUDE.md, Server
// tests), for the online cases at the end of this file.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => ({ listings: [], collections: new Map() })),
  saveMarketState: vi.fn(async () => {}),
  loadMailState: vi.fn(async () => ({})),
  saveMailState: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  insertBankLedgerRow: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
}));

const prewarmIconCacheSpy = vi.hoisted(() => vi.fn(() => () => {}));
vi.mock('../src/ui/icon_prewarm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/icon_prewarm')>()),
  prewarmIconCache: prewarmIconCacheSpy,
}));

import { type ClientSession, GameServer } from '../server/game';
import {
  REALM_RACERS_EVENT_SFX,
  REALM_RACERS_VEHICLE_SFX,
  type RealmRacersSfxEvent,
} from '../src/game/realm_racers_sfx';
import { sfx } from '../src/game/sfx';
import { SFX_CLIPS, type SfxId } from '../src/game/sfx_manifest.generated';
import type { RealmRacersAudioEvent } from '../src/render/audio_sink';
import {
  REALM_RACERS_ABILITY_ID,
  REALM_RACERS_NITRO_ABILITY_ID,
  REALM_RACERS_SLICK_ABILITY_ID,
} from '../src/sim/content/realm_racers';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { GROUND_BLAST_CONTROL_SPEED_MULT } from '../src/sim/realm_racers_ground_blast';
import { REALM_RACERS_ORIGIN } from '../src/sim/realm_racers_layout';
import type { RallyPickupEffect } from '../src/sim/realm_racers_pickup_effects';
import {
  REALM_RACERS_GARDEN_BAND,
  REALM_RACERS_GROUND_BLAST_AURA,
  REALM_RACERS_OFF_TRACK_AURA,
  REALM_RACERS_VERGE_BAND,
  REALM_RACERS_WARD_AURA,
} from '../src/sim/social/realm_racers';
import type { Aura } from '../src/sim/types';
import { resolveHudAuraIconId, resolveHudAuraIconUrl } from '../src/ui/aura_icon_runtime';
import { auraApplyCue } from '../src/ui/combat_sfx';
import { actionBarIconBg } from '../src/ui/hud/action_bar/action_bar_icon_bg';
import { ABILITY_ICON_PREFIX } from '../src/ui/hud/action_bar/action_bar_view';
import { realmRacersSplashDeps, realmRacersUiDeps } from '../src/ui/hud/realm_racers';
import {
  REALM_RACERS_SELF_AURA_CUES,
  REALM_RACERS_SELF_AURAS,
  RealmRacersRaceWarm,
  realmRacersRaceSfx,
  realmRacersRaceWarmIcons,
  realmRacersRaceWarmSfx,
} from '../src/ui/hud/realm_racers/realm_racers_race_warm';
import { type IconPrewarmEntry, prewarmIconDataUrl } from '../src/ui/icon_prewarm';
import { makeWriterFacet } from '../src/ui/painter_host';
import { RealmRacersUi } from '../src/ui/realm_racers';
import {
  RALLY_SPLASH_ICON_SIZE,
  rallyPickupSplashView,
} from '../src/ui/realm_racers_pickup_splash_view';
import type { IWorld, RealmRacersInfo } from '../src/world_api';
import { bareClient } from './helpers/bare_client';
import { makeWorld } from './realm_racers_util';

const LAZY_RACE_SFX = [
  'buff_apply',
  'debuff_apply',
  'impact_arcane',
  'mount_run_stalkglider_snail',
  'move_groundshaker_engine',
  'proj_groundshaker',
];

function sinks() {
  return {
    preloadSfx: vi.fn<(key: SfxId) => void>(),
    prewarmIcons: vi.fn<(entries: IconPrewarmEntry[]) => void>(),
  };
}

function idleInfo(): RealmRacersInfo {
  return {
    queued: false,
    queuePosition: 0,
    queueSize: 0,
    match: null,
    practiceAvailable: true,
    queueViable: true,
  };
}

function fakeWorld(
  info: RealmRacersInfo,
  pos = { x: 0, y: 0, z: -40 },
): Pick<IWorld, 'realmRacersInfo' | 'player'> {
  return { realmRacersInfo: info, player: { pos } } as unknown as Pick<
    IWorld,
    'realmRacersInfo' | 'player'
  >;
}

function preloaded(spy: { mock: { calls: [SfxId][] } }): string[] {
  return spy.mock.calls.map(([key]) => key as string).sort();
}

describe('the race sounds the warm preloads', () => {
  it('preloads exactly the race clips the manifest leaves lazy', () => {
    const all = realmRacersRaceSfx();
    expect(realmRacersRaceWarmSfx().sort()).toEqual(LAZY_RACE_SFX);
    for (const key of LAZY_RACE_SFX) expect(SFX_CLIPS[key as SfxId].preload).toBe('lazy');
    // Already resident from the startup preload, so not the warm's to fetch.
    for (const key of ['impact_groundshaker', 'foot_stone', 'foot_dirt'] as const) {
      expect(all).toContain(key);
      expect(SFX_CLIPS[key].preload).toBe('startup');
    }
  });

  it('follows the manifest: a race clip loaded at startup is never preloaded again', () => {
    const clips = Object.fromEntries(
      realmRacersRaceSfx().map((key) => [
        key,
        { preload: key === 'impact_arcane' ? 'startup' : SFX_CLIPS[key].preload },
      ]),
    );
    expect(realmRacersRaceWarmSfx(clips)).not.toContain('impact_arcane');
    expect(realmRacersRaceWarmSfx(clips)).toContain('proj_groundshaker');
  });

  it('is the table the engine plays the rally events and the vehicle mix from', () => {
    // One event union on both sides of the audio sink, so a new kind cannot
    // compile past the table and play nothing.
    expectTypeOf<RealmRacersAudioEvent>().toEqualTypeOf<RealmRacersSfxEvent>();
    const playAt = vi.spyOn(sfx, 'playAt').mockReturnValue(false);
    const loop = vi.spyOn(sfx, 'loop').mockImplementation(() => {});
    try {
      for (const kind of Object.keys(
        REALM_RACERS_EVENT_SFX,
      ) as (keyof typeof REALM_RACERS_EVENT_SFX)[]) {
        playAt.mockClear();
        sfx.realmRacersEvent(kind, 0, 0, 0, 1);
        expect(playAt.mock.calls[0]?.[0]).toBe(REALM_RACERS_EVENT_SFX[kind]);
      }
      // A sliding machine on the verge: the engine, the skid and the dirt roll.
      sfx.vehicle(900, false, 0, 0, 0, 0.8, 0.5, 9, true);
      sfx.vehicle(900, false, 0, 0, 0, 0.8, 0.5, 0, false);
      const looped = loop.mock.calls.map((call) => call[1]);
      expect(looped).toContain(REALM_RACERS_VEHICLE_SFX.engine);
      expect(looped).toContain(REALM_RACERS_VEHICLE_SFX.skid);
      expect(looped).toContain(REALM_RACERS_VEHICLE_SFX.rollDirt);
      expect(looped).toContain(REALM_RACERS_VEHICLE_SFX.rollRoad);
    } finally {
      sfx.stopVehicle(900);
      playAt.mockRestore();
      loop.mockRestore();
    }
  });

  it('covers the apply cue the HUD plays for every aura a race grants the viewer', () => {
    const aura = (id: string, kind: Aura['kind'], value: number): Aura =>
      ({
        id,
        name: id,
        kind,
        remaining: 1,
        duration: 1,
        value,
        sourceId: 1,
        school: 'physical',
      }) as Aura;
    const granted = [
      aura(REALM_RACERS_WARD_AURA, 'rally_ward', 0),
      aura(REALM_RACERS_GROUND_BLAST_AURA, 'slow', GROUND_BLAST_CONTROL_SPEED_MULT),
      aura(REALM_RACERS_OFF_TRACK_AURA, 'slow', REALM_RACERS_VERGE_BAND.speedMult),
      aura(REALM_RACERS_OFF_TRACK_AURA, 'slow', REALM_RACERS_GARDEN_BAND.speedMult),
    ];
    const cues = granted.map((a) =>
      auraApplyCue({ type: 'aura', targetId: 1, name: a.name, gained: true }, a),
    );
    expect(cues).toEqual(['buff_apply', 'debuff_apply', 'debuff_apply', 'debuff_apply']);
    for (const cue of cues) expect(REALM_RACERS_SELF_AURA_CUES).toContain(cue);
  });
});

describe('the race icons the warm composes', () => {
  it('names the splash of every effect, the rally slots and the race auras', () => {
    const effects: RallyPickupEffect[] = ['charge', 'nitro', 'ward', 'slick'];
    const entries = realmRacersRaceWarmIcons();
    for (const effect of effects) {
      const { icon } = rallyPickupSplashView(effect);
      expect(entries).toContainEqual({
        kind: icon.kind,
        id: icon.id,
        size: RALLY_SPLASH_ICON_SIZE,
      });
    }
    for (const id of [
      REALM_RACERS_ABILITY_ID,
      REALM_RACERS_NITRO_ABILITY_ID,
      REALM_RACERS_SLICK_ABILITY_ID,
    ]) {
      expect(entries).toContainEqual({ kind: 'ability', id });
    }
    for (const aura of REALM_RACERS_SELF_AURAS) {
      expect(entries).toContainEqual({
        kind: 'aura',
        id: resolveHudAuraIconId(aura),
        mode: 'procedural',
      });
    }
    expect(entries.filter((entry) => entry.kind === 'aura' && entry.mode === 'procedural')).toEqual(
      [
        { kind: 'aura', id: 'aura_rally_ward', mode: 'procedural' },
        { kind: 'aura', id: 'aura_rally_ghost', mode: 'procedural' },
        { kind: 'aura', id: 'aura_slow', mode: 'procedural' },
      ],
    );
    expect(entries).toHaveLength(10);
  });

  it('leaves the first pickup nothing to build: splash, slot and buff bar read the warm cache', async () => {
    const bridge = {
      requestIcon: () => Promise.resolve(new Blob(['race-warm'])),
      toDataUrl: (blob: Blob) => blob.text().then((text) => `data:${text}`),
    };
    for (const entry of realmRacersRaceWarmIcons()) {
      await prewarmIconDataUrl(entry.kind, entry.id, entry.size, entry.mode, bridge);
    }
    // Plain Node has no canvas: a cache miss would compose and throw here.
    const splash = realmRacersSplashDeps({ writerFacet: {} });
    for (const effect of ['charge', 'nitro', 'ward', 'slick'] as const) {
      expect(splash.iconUrl(rallyPickupSplashView(effect).icon)).toBe('data:race-warm');
    }
    for (const id of [
      REALM_RACERS_ABILITY_ID,
      REALM_RACERS_NITRO_ABILITY_ID,
      REALM_RACERS_SLICK_ABILITY_ID,
    ]) {
      expect(actionBarIconBg(`${ABILITY_ICON_PREFIX}${id}`)).toBe('url(data:race-warm)');
    }
    for (const aura of REALM_RACERS_SELF_AURAS) {
      expect(resolveHudAuraIconUrl(resolveHudAuraIconId(aura))).toBe('url(data:race-warm)');
    }
  });
});

describe('the race warm trigger', () => {
  const practice = (phase: 'loading' | 'countdown' | 'racing'): RealmRacersInfo => ({
    ...idleInfo(),
    match: { practice: true, phase } as unknown as RealmRacersInfo['match'],
  });

  it('does nothing before the viewer commits to racing', () => {
    const out = sinks();
    const warm = new RealmRacersRaceWarm(out);
    for (let i = 0; i < 10; i++) warm.step(fakeWorld(idleInfo()));
    expect(out.preloadSfx).not.toHaveBeenCalled();
    expect(out.prewarmIcons).not.toHaveBeenCalled();
    expect(warm.reason).toBeNull();
  });

  it('warms once, on the lobby frame, and never again for the rest of the race', () => {
    const out = sinks();
    const warm = new RealmRacersRaceWarm(out);
    warm.step(fakeWorld(idleInfo()));
    warm.step(fakeWorld(practice('loading')));
    expect(warm.reason).toBe('practice');
    expect(preloaded(out.preloadSfx)).toEqual(LAZY_RACE_SFX);
    expect(out.prewarmIcons).toHaveBeenCalledTimes(1);
    expect(out.prewarmIcons).toHaveBeenCalledWith(realmRacersRaceWarmIcons());
    for (const phase of ['loading', 'countdown', 'racing'] as const) {
      warm.step(fakeWorld(practice(phase)));
    }
    warm.step(fakeWorld(idleInfo()));
    warm.step(fakeWorld(practice('loading')));
    expect(out.preloadSfx).toHaveBeenCalledTimes(LAZY_RACE_SFX.length);
    expect(out.prewarmIcons).toHaveBeenCalledTimes(1);
  });

  it('covers the queue join, a login already seated, and a walker in the rally band', () => {
    const queued = sinks();
    const q = new RealmRacersRaceWarm(queued);
    q.step(fakeWorld({ ...idleInfo(), queued: true }));
    expect(q.reason).toBe('queue');
    expect(preloaded(queued.preloadSfx)).toEqual(LAZY_RACE_SFX);

    const login = sinks();
    const seated = new RealmRacersRaceWarm(login);
    seated.step(fakeWorld({ ...idleInfo(), match: { practice: false, phase: 'racing' } as never }));
    expect(seated.reason).toBe('seated');
    expect(login.prewarmIcons).toHaveBeenCalledTimes(1);

    const fence = sinks();
    const walker = new RealmRacersRaceWarm(fence);
    walker.step(
      fakeWorld(idleInfo(), { x: REALM_RACERS_ORIGIN.x, y: 0, z: REALM_RACERS_ORIGIN.z }),
    );
    expect(walker.reason).toBe('band');
    expect(preloaded(fence.preloadSfx)).toEqual(LAZY_RACE_SFX);
  });

  it('fires offline on the frame a practice race seats the player in its lobby', () => {
    const sim = makeWorld({ noPlayer: false, playerClass: 'hunter' });
    const out = sinks();
    const warm = new RealmRacersRaceWarm(out);
    warm.step(sim);
    expect(out.preloadSfx).not.toHaveBeenCalled();
    sim.startRealmRacersPractice('rookie');
    expect(sim.realmRacersInfo.match?.phase).toBe('loading');
    warm.step(sim);
    expect(preloaded(out.preloadSfx)).toEqual(LAZY_RACE_SFX);
    expect(out.prewarmIcons).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 40; i++) {
      sim.tick();
      warm.step(sim);
    }
    expect(out.preloadSfx).toHaveBeenCalledTimes(LAZY_RACE_SFX.length);
    expect(out.prewarmIcons).toHaveBeenCalledTimes(1);
    // The recovery ghost, as the race really grants it, is one the warm names.
    const match = sim.realmRacers.practices[0];
    if (!match) throw new Error('missing practice match');
    match.phase = 'racing';
    sim.resetRealmRacersPosition();
    const ghost = sim.player.auras.find((aura) => aura.kind === 'rally_ghost');
    expect(ghost).toBeDefined();
    expect(REALM_RACERS_SELF_AURAS).toContainEqual({ id: ghost?.id, kind: ghost?.kind });
  });
});

describe('the HUD wiring of the race warm', () => {
  it('runs from the race UI ready send, above the paint cut', () => {
    const out = sinks();
    const info: RealmRacersInfo = idleInfo();
    const world = {
      realmRacersInfo: info,
      player: { pos: { x: 0, y: 0, z: -40 } },
      readyRealmRacers: vi.fn(),
    } as unknown as IWorld;
    const noop = (): void => {};
    const ui = new RealmRacersUi({
      root: () => ({ style: {} }) as HTMLElement,
      layer: () => null,
      world: () => world,
      closeOthers: noop,
      captureFocus: () => null,
      restoreFocus: noop,
      controlKeys: () => [],
      isTouchHud: () => false,
      countdownTick: noop,
      showBanner: noop,
      clearPickupSplash: noop,
      writers: makeWriterFacet(new Map(), new Map(), new Map(), new Map(), noop, noop),
      prepareProgress: (progress) => Object.assign(progress, { done: 0, total: 1, settled: false }),
      connectionDropped: () => false,
      now: () => 0,
      raceWarm: out,
    });
    ui.sendReady();
    expect(out.preloadSfx).not.toHaveBeenCalled();
    world.realmRacersInfo.match = { practice: true, phase: 'loading' } as never;
    ui.sendReady();
    ui.sendReady();
    expect(preloaded(out.preloadSfx)).toEqual(LAZY_RACE_SFX);
    expect(out.prewarmIcons).toHaveBeenCalledTimes(1);
  });

  it('hands the engine preload and the eager icon warmer to the race UI', () => {
    const deps = realmRacersUiDeps({
      sim: {},
      renderer: { realmRacers: { prepare: { progress: (out: unknown) => out } } },
      keybinds: { primaryLabel: () => '' },
      writerFacet: {},
      realmRacersSplash: { clear: () => {} },
      closeOtherWindows: () => {},
      showBanner: () => {},
      windowFocus: () => ({ captureFocus: () => null, restoreFocus: () => {} }),
    });
    const preload = vi.spyOn(sfx, 'preload').mockImplementation(() => {});
    try {
      deps.raceWarm?.preloadSfx('impact_arcane');
      expect(preload).toHaveBeenCalledExactlyOnceWith('impact_arcane');
    } finally {
      preload.mockRestore();
    }
    const entries = realmRacersRaceWarmIcons();
    deps.raceWarm?.prewarmIcons(entries);
    expect(prewarmIconCacheSpy).toHaveBeenCalledExactlyOnceWith(entries, {
      eagerCount: entries.length,
    });
  });
});

describe('the race warm online', () => {
  beforeAll(() =>
    setActiveWorldContent({ ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] }),
  );
  afterAll(() => setActiveWorldContent(null));

  interface FakeClient {
    sent: Record<string, unknown>[];
    ws: { readyState: number; send(payload: string): void };
  }
  const fakeClient = (): FakeClient => {
    const sent: Record<string, unknown>[] = [];
    return {
      sent,
      ws: { readyState: 1, send: (payload) => sent.push(JSON.parse(payload)) },
    };
  };
  const join = (server: GameServer, client: FakeClient, id: number): ClientSession => {
    const joined = server.join(client.ws as never, id, id, 'Aster', 'hunter', null);
    if ('error' in joined) throw new Error(joined.error);
    joined.blockListLoaded = true;
    return joined;
  };
  const advance = (server: GameServer): void => {
    const host = server as unknown as {
      routeEvents(events: unknown): void;
      broadcastSnapshots(): void;
    };
    host.routeEvents(server.sim.tick());
    host.broadcastSnapshots();
  };
  const snaps = (client: FakeClient) => client.sent.filter((frame) => frame.t === 'snap');
  const apply = (world: ReturnType<typeof bareClient>, frame: unknown): void =>
    (world as unknown as { applySnapshot(frame: unknown): void }).applySnapshot(frame);

  it('fires once, on the mirrored frame that seats the pilot in the practice lobby', () => {
    const server = new GameServer();
    const client = fakeClient();
    const session = join(server, client, 1);
    const world = bareClient(session.pid);
    let applied = 0;
    const mirror = (): void => {
      const frames = snaps(client);
      for (; applied < frames.length; applied++) apply(world, frames[applied]);
    };
    const out = sinks();
    const warm = new RealmRacersRaceWarm(out);
    advance(server);
    mirror();
    warm.step(world);
    expect(world.player.id).toBe(session.pid);
    expect(out.preloadSfx).not.toHaveBeenCalled();

    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'realm_racers_practice', tier: 'rookie' }),
    );
    advance(server);
    mirror();
    expect(world.realmRacersInfo.match?.phase).toBe('loading');
    warm.step(world);
    expect(warm.reason).toBe('practice');
    expect(preloaded(out.preloadSfx)).toEqual(LAZY_RACE_SFX);
    expect(out.prewarmIcons).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) {
      advance(server);
      mirror();
      warm.step(world);
    }
    expect(out.preloadSfx).toHaveBeenCalledTimes(LAZY_RACE_SFX.length);
    expect(out.prewarmIcons).toHaveBeenCalledTimes(1);

    // A client that logs in with the race already running: its first mirrored
    // readout is the racing match, and that first frame warms.
    const match = server.sim.realmRacers.practices[0];
    if (!match) throw new Error('missing practice match');
    match.phase = 'racing';
    advance(server);
    const racingFrame = snaps(client)
      .filter(
        (frame) =>
          (frame.self as { rr?: { match?: { phase?: string } } } | undefined)?.rr?.match?.phase ===
          'racing',
      )
      .at(-1);
    const late = bareClient(session.pid);
    apply(late, racingFrame);
    expect(late.realmRacersInfo.match?.phase).toBe('racing');
    const lateOut = sinks();
    const lateWarm = new RealmRacersRaceWarm(lateOut);
    lateWarm.step(late);
    expect(lateWarm.reason).toBe('practice');
    expect(preloaded(lateOut.preloadSfx)).toEqual(LAZY_RACE_SFX);
    expect(lateOut.prewarmIcons).toHaveBeenCalledTimes(1);
  });
});
