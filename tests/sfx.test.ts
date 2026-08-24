import { readdirSync, readFileSync, statSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FORGE_MAX_DISTANCE,
  LOOP_RATE_GLIDE,
  MAX_DISTANCE,
  REF_DISTANCE,
  sfx,
} from '../src/game/sfx';
import { SFX_CLIPS, type SfxEntry } from '../src/game/sfx_manifest.generated';
import {
  playRealmRacersEventAudio,
  playRealmRacersScrapeAudio,
  syncRealmRacersVehicleAudio,
} from '../src/render/realm_racers_audio';
import {
  realmRacersScrapeAudioCue,
  realmRacersSpatialAudioCue,
  realmRacersVehicleAudioAction,
} from '../src/render/realm_racers_audio_core';
import { MOUNT_KEYS } from '../src/sim/content/mounts';
import type { VehicleDrive } from '../src/sim/types';

// The footstep "jingling" bug: foot clips are ~0.48s but steps fire every ~0.22s
// at a run, so flat retriggers overlap two pitch-jittered copies of one sample and
// comb-filter into a metallic ring. footstep() must (a) shape each play into a
// short transient that is stopped before the next step and (b) alternate pitch
// per step. These tests pin both behaviours via a minimal WebAudio stub.

interface FakeSource {
  buffer: { duration: number } | null;
  playbackRate: {
    value: number;
    targets: number[];
    timeConstants: number[];
    setTargetAtTime(value: number, when: number, timeConstant: number): void;
  };
  onended: (() => void) | null;
  started: boolean;
  stopAt: number | null;
  connect(n: unknown): unknown;
  disconnect(): void;
  start(): void;
  stop(t?: number): void;
}

interface FakeGain {
  gain: { value: number; ramps: number[]; targets: number[] };
  connectedTo?: unknown;
}

interface FakePanner {
  refDistance: number;
  maxDistance: number;
  x: number;
  y: number;
  z: number;
  connectedTo?: unknown;
}

interface FakeCompressor {
  threshold: { value: number };
  knee: { value: number };
  ratio: { value: number };
  attack: { value: number };
  release: { value: number };
  connectedTo?: unknown;
}

const sources: FakeSource[] = [];
const gains: FakeGain[] = [];
const panners: FakePanner[] = [];
let nowT = 0;
let gainAutomationCalls: string[] = [];
const WOOD_BUFFER = { duration: 0.37 };
const RALLY_GROUND_BLAST_BUFFER = { duration: 3 };
const GROUND_SHAKER_IMPACT_BUFFER = { duration: 3.08 };
const ARCANE_IMPACT_BUFFER = { duration: 0.5 };

function lastSource(): FakeSource {
  const source = sources.at(-1);
  if (!source) throw new Error('expected an audio source');
  return source;
}

function installAudioStub(): void {
  sources.length = 0;
  gains.length = 0;
  panners.length = 0;
  gainAutomationCalls = [];
  nowT += 1000; // monotonic across tests so the singleton's cooldown map never blocks
  // The stub records BOTH shapes the suite reads: the release's automation-call
  // log (which method a fade went through) and the branch's per-param ramp and
  // target values (which level a racing loop was driven to).
  const param = () => ({
    value: 0,
    ramps: [] as number[],
    targets: [] as number[],
    setValueAtTime(value: number) {
      this.value = value;
      gainAutomationCalls.push('setValueAtTime');
    },
    linearRampToValueAtTime(value: number) {
      this.ramps.push(value);
    },
    setTargetAtTime(value: number) {
      this.value = value;
      this.targets.push(value);
      gainAutomationCalls.push('setTargetAtTime');
    },
  });
  class FakeCtx {
    get currentTime() {
      return nowT;
    }
    destination = {};
    listener = {} as Record<string, unknown>;
    createGain() {
      const gain = {
        gain: param(),
        connectedTo: undefined as unknown,
        connect(n: unknown) {
          this.connectedTo = n;
          return n;
        },
        disconnect() {},
      };
      gains.push(gain);
      return gain;
    }
    createPanner() {
      const panner = {
        panningModel: '',
        distanceModel: '',
        refDistance: 0,
        maxDistance: 0,
        rolloffFactor: 0,
        x: 0,
        y: 0,
        z: 0,
        connectedTo: undefined as unknown,
        setPosition(x: number, y: number, z: number) {
          this.x = x;
          this.y = y;
          this.z = z;
        },
        connect(n: unknown) {
          this.connectedTo = n;
          return n;
        },
        disconnect() {},
      };
      panners.push(panner);
      return panner;
    }
    createDynamicsCompressor() {
      const compressor: FakeCompressor & { connect(n: unknown): unknown; disconnect(): void } = {
        threshold: param(),
        knee: param(),
        ratio: param(),
        attack: param(),
        release: param(),
        connect(n: unknown) {
          this.connectedTo = n;
          return n;
        },
        disconnect() {},
      };
      return compressor;
    }
    createBufferSource(): FakeSource {
      const s: FakeSource = {
        buffer: null,
        // A live loop RAMPS its rate rather than assigning it, so the fake has to
        // record the ramp as well as the instant value a one-shot still sets.
        playbackRate: {
          value: 1,
          targets: [] as number[],
          timeConstants: [] as number[],
          setTargetAtTime(value: number, _when: number, timeConstant: number) {
            this.targets.push(value);
            this.timeConstants.push(timeConstant);
          },
        },
        onended: null,
        started: false,
        stopAt: null,
        connect(n: unknown) {
          return n;
        },
        disconnect() {},
        start() {
          this.started = true;
        },
        stop(t?: number) {
          this.stopAt = t ?? 0;
        },
      };
      sources.push(s);
      return s;
    }
    resume() {
      return Promise.resolve();
    }
  }
  (globalThis as never as { AudioContext: unknown }).AudioContext = FakeCtx;
}

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  installAudioStub();
  // Neutralize the ±jitter so alternation is the only pitch variable under test.
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  sfx.init();
  // The MAX_VOICES budget is only released by onended callbacks the audio stub
  // never fires, so voices leak across tests in this file; reset the counter so
  // each test starts with the full budget.
  (sfx as unknown as { active: number }).active = 0;
  // Footsteps are off by default (the footstepSfx setting); enable them so the
  // play-path behaviours below are exercised. The gate itself is tested separately.
  sfx.setFootstepsEnabled(true);
  // Inject decoded buffers directly (skip async fetch/decode in preload).
  const buffers = (sfx as unknown as { buffers: Map<string, { duration: number }> }).buffers;
  buffers.set('foot_grass', { duration: 0.48 });
  for (const [index, mountKey] of MOUNT_KEYS.entries()) {
    buffers.set(`mount_run_${mountKey}`, { duration: 0.5 + index / 100 });
  }
  buffers.set('move_groundshaker_engine', { duration: 4 });
  buffers.set('foot_wood', WOOD_BUFFER);
  buffers.set('foot_stone', { duration: 0.5 });
  buffers.set('foot_dirt', { duration: 0.5 });
  buffers.set('proj_groundshaker', RALLY_GROUND_BLAST_BUFFER);
  buffers.set('proj_groundshaker:1', RALLY_GROUND_BLAST_BUFFER);
  buffers.set('proj_groundshaker:2', RALLY_GROUND_BLAST_BUFFER);
  buffers.set('impact_groundshaker', GROUND_SHAKER_IMPACT_BUFFER);
  buffers.set('impact_arcane', ARCANE_IMPACT_BUFFER);
  buffers.set('impact_shadow', { duration: 0.7 });
  buffers.set('impact_bone', { duration: 0.5 });
  buffers.set('proj_shadow', { duration: 0.65 });
});

describe('footstep audio', () => {
  it('shapes each footfall into a transient stopped before the next step', () => {
    sfx.footstep(0, 0, 0, 'grass', true, true);
    const src = lastSource();
    expect(src.started).toBe(true);
    // running release 0.17s + tail margin → stopped well under the ~0.22s gap,
    // and far under the raw 0.48s clip that caused the overlap ring.
    expect(src.stopAt).not.toBeNull();
    if (src.stopAt === null) throw new Error('expected the footstep to schedule a stop');
    expect(src.stopAt - nowT).toBeLessThan(0.22);
  });

  it('alternates pitch between consecutive steps (left/right foot)', () => {
    sfx.footstep(0, 0, 0, 'grass', false, true);
    const a = lastSource().playbackRate.value;
    nowT += 0.5; // clear the per-key cooldown so the next step actually plays
    sfx.footstep(0, 0, 0, 'grass', false, true);
    const b = lastSource().playbackRate.value;
    expect(Math.abs(a - b)).toBeGreaterThan(0.05);
  });

  it('layers the authored playback rate underneath foot alternation', () => {
    const entry = SFX_CLIPS.foot_grass;
    const original = entry.playbackRate;
    entry.playbackRate = 1.2;
    try {
      sfx.footstep(0, 0, 0, 'grass', false, true);
      const first = lastSource().playbackRate.value;
      nowT += 0.5;
      sfx.footstep(0, 0, 0, 'grass', false, true);
      const second = lastSource().playbackRate.value;
      expect([first, second].sort()).toEqual([1.2 * 0.97, 1.2 * 1.04].sort());
    } finally {
      entry.playbackRate = original;
    }
  });

  it('selects the sampled wood clip for wooden surfaces', () => {
    sfx.footstep(0, 0, 0, 'wood', false, true);
    expect(sources.at(-1)?.buffer).toBe(WOOD_BUFFER);
  });
});

// hasVariants() is the predicate that drives mobSfxKey() in hud.ts:
// mob_${fam}_${templateId}_${action} is preferred when hasVariants() returns
// true, otherwise the family-level key mob_${fam}_${action} is used.
describe('hasVariants', () => {
  it('returns false for an unloaded key', () => {
    // mob_beast_wolf_attack now has real discovered takes (a genuine
    // subfamily voice, not a placeholder), so it no longer demonstrates
    // "unloaded"; a key with no catalog or discovered entry at all does.
    expect(sfx.hasVariants('mob_nonexistent_family_action')).toBe(false);
  });

  it('recognizes a release-discovered subfamily entry before its lazy audio loads', () => {
    const key = 'mob_beast_bear_attack';
    const state = sfx as unknown as {
      clips: Record<string, SfxEntry>;
      failedLoads: Set<string>;
    };
    state.clips = {
      ...state.clips,
      [key]: {
        ...SFX_CLIPS.mob_beast_attack,
        variants: [SFX_CLIPS.mob_beast_attack.variants[0]],
      },
    };

    expect(sfx.hasVariants(key)).toBe(true);
    state.failedLoads.add(key);
    expect(sfx.hasVariants(key)).toBe(false);
  });

  it('recognizes an injected procedural buffer and safely ignores unknown string keys', () => {
    const buffers = (sfx as unknown as { buffers: Map<string, { duration: number }> }).buffers;
    buffers.set('procedural_test', { duration: 0.8 });

    expect(sfx.hasVariants('procedural_test')).toBe(true);
    expect(() => sfx.playAt('not_in_manifest', 0, 0, 0)).not.toThrow();
  });
});

// isBuffered/preload back the mob-voice cold-buffer fallback in hud.ts (a
// crit-only cue like hurt has exactly one trigger, so it can lose the race
// to fetch+decode unless warmed ahead of time or checked before playing).
// Both must account for EVERY variant a key can have, not just index 0:
// playAt no-repeat-randoms across variants, so a two-take family
// (mob_dragonkin_hurt, mob_spider_hurt) can have variant 0 warm and variant 1
// still cold.
describe('isBuffered/preload', () => {
  it('reports false until every variant of a multi-take key is buffered', () => {
    const key = 'mob_dragonkin_hurt';
    expect(SFX_CLIPS[key].variants.length).toBe(2);
    expect(sfx.isBuffered(key)).toBe(false);
    const buffers = (sfx as unknown as { buffers: Map<string, { duration: number }> }).buffers;
    buffers.set(key, { duration: 0.5 });
    expect(sfx.isBuffered(key)).toBe(false); // variant 1 still cold
    buffers.set(`${key}:1`, { duration: 0.5 });
    expect(sfx.isBuffered(key)).toBe(true);
  });

  it('reports true immediately for a single-variant key once buffered', () => {
    const key = 'mob_beast_hurt';
    expect(SFX_CLIPS[key].variants.length).toBe(1);
    expect(sfx.isBuffered(key)).toBe(false);
    const buffers = (sfx as unknown as { buffers: Map<string, { duration: number }> }).buffers;
    buffers.set(key, { duration: 0.5 });
    expect(sfx.isBuffered(key)).toBe(true);
  });

  it('preload warms every variant of a multi-take key, not just the first', async () => {
    const key = 'mob_spider_hurt';
    expect(SFX_CLIPS[key].variants.length).toBe(2);
    sfx.preload(key);
    // loadBuffer is async (fetch+decode); flush microtasks so both loads settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const loading = (sfx as unknown as { loading: Map<string, unknown> }).loading;
    expect(loading.has(key)).toBe(false);
    expect(loading.has(`${key}:1`)).toBe(false);
  });
});

describe('mount running audio', () => {
  it('ships one generated manifest entry for every catalog mount', () => {
    // terrorspark_groundshaker's mount_run_ entry is the sustain take of an
    // engine mount's windup/loop/winddown set (see the "mount engine audio"
    // suite below): it is genuinely driven through Sfx.loop() at runtime, so
    // its manifest entry correctly carries loop: true, unlike every other
    // mount's plain per-stride gait clip.
    const ENGINE_LOOP_MOUNTS = new Set(['terrorspark_groundshaker']);
    for (const mountKey of MOUNT_KEYS) {
      const entry = SFX_CLIPS[`mount_run_${mountKey}`];
      expect(entry).toMatchObject({
        loop: ENGINE_LOOP_MOUNTS.has(mountKey),
        spatial: true,
      });
      expect(entry.url).toMatch(
        new RegExp(`^/audio/sfx/mount_run_${mountKey}\\.mp3\\?v=[0-9a-f]{12}$`),
      );
    }
  });

  // The tank mount (terrorspark_groundshaker) has a dedicated windup/loop/
  // winddown take set (see mount_engine_state.ts), so it ships two extra
  // clips beyond the base loop every other mount has.
  const ENGINE_MOUNT_EXTRA_SUFFIXES: Partial<Record<string, string[]>> = {
    terrorspark_groundshaker: ['_start', '_stop'],
  };

  it('ships one non-empty MP3 asset for every catalog mount and no orphan mount clips', () => {
    const directory = new URL('../public/audio/sfx/', import.meta.url);
    const expected = MOUNT_KEYS.flatMap((mountKey) => [
      `mount_run_${mountKey}.mp3`,
      ...(ENGINE_MOUNT_EXTRA_SUFFIXES[mountKey] ?? []).map(
        (suffix) => `mount_run_${mountKey}${suffix}.mp3`,
      ),
    ]).sort();
    const actual = readdirSync(directory)
      .filter((file) => file.startsWith('mount_run_') && file.endsWith('.mp3'))
      .sort();

    expect(actual).toEqual(expected);
    for (const file of expected) {
      const url = new URL(file, directory);
      expect(statSync(url).size).toBeGreaterThan(5_000);
      const header = readFileSync(url).subarray(0, 3).toString('ascii');
      expect(header).toBe('ID3');
    }
  });

  it('plays a distinct custom clip for every catalog mount', () => {
    const buffers = (sfx as unknown as { buffers: Map<string, { duration: number }> }).buffers;
    const played = new Set<unknown>();

    for (const mountKey of MOUNT_KEYS) {
      nowT += 0.5;
      sfx.mountRun(0, 0, 0, mountKey, true);
      const src = sources.at(-1)!;
      expect(src.buffer).toBe(buffers.get(`mount_run_${mountKey}`));
      played.add(src.buffer);
    }

    expect(played.size).toBe(MOUNT_KEYS.length);
  });

  it('plays independently of the optional on-foot footstep toggle', () => {
    sfx.setFootstepsEnabled(false);
    sfx.mountRun(0, 0, 0, 'valorsteed', true);
    expect(sources.at(-1)!.started).toBe(true);
  });

  it('truncates each stride before the next mounted running beat', () => {
    sfx.mountRun(0, 0, 0, 'valorsteed', true);
    const src = sources.at(-1)!;
    expect(src.stopAt).not.toBeNull();
    expect(src.stopAt! - nowT).toBeLessThan(0.5);
  });

  it('ignores unknown mount keys', () => {
    const before = sources.length;
    sfx.mountRun(0, 0, 0, 'unknown_mount', true);
    expect(sources.length).toBe(before);
  });
});

const vehicleDrive = (): VehicleDrive => ({
  profileKey: 'rally_loaner',
  speed: 0,
  slip: 0,
  steerAngle: 0,
  yawRate: 0,
  spin: 0,
  handbrake: 0,
  gripMult: 1,
  dragMult: 1,
  speedCap: 1,
  slipCap: 1,
  collisionImpact: 0,
  controlsLocked: false,
});

describe('Realm Racers vehicle loops', () => {
  beforeEach(() => sfx.setListener(0, 0, 0, 0, 0, 1));

  it('keeps one engine source and raises its pitch with speed', () => {
    sfx.vehicle(77, false, 2, 0, 0, 0.2, 0.2, 0, false);
    const loops = (
      sfx as unknown as {
        loops: Map<string, { src: FakeSource }>;
      }
    ).loops;
    const first = loops.get('realm-racers-engine-77')?.src;
    expect(first).toBeDefined();
    const lowRate = first?.playbackRate.value ?? 0;
    sfx.vehicle(77, false, 3, 0, 0, 0.85, 0.8, 5, false);
    const second = loops.get('realm-racers-engine-77')?.src;
    expect(second).toBe(first);
    expect(second?.playbackRate.targets.at(-1) ?? 0).toBeGreaterThan(lowRate);
    expect(sfx.hasLoop('realm-racers-skid-77')).toBe(true);
    const buffers = (sfx as unknown as { buffers: Map<string, { duration: number }> }).buffers;
    expect(loops.get('realm-racers-engine-77')?.src.buffer).toBe(
      buffers.get('move_groundshaker_engine'),
    );
    expect(loops.get('realm-racers-skid-77')?.src.buffer).toBe(
      buffers.get('mount_run_stalkglider_snail'),
    );
    expect(loops.get('realm-racers-roll-77')?.src.buffer).toBe(buffers.get('foot_stone'));

    sfx.vehicle(77, false, 3, 0, 0, 0.85, 0.8, 0, true);
    expect(loops.get('realm-racers-roll-77')?.src.buffer).toBe(buffers.get('foot_dirt'));
  });

  it('pins the validated engine response to speed and acceleration load', () => {
    sfx.vehicle(85, false, 2, 0, 0, 0, 0, 0, false);
    const loops = (
      sfx as unknown as {
        loops: Map<string, { src: FakeSource; gain: FakeGain }>;
      }
    ).loops;
    const engine = loops.get('realm-racers-engine-85');
    // A fresh loop opens AT its rate; every later change is a commanded ramp
    // target, which is what the formula is pinned against from here on.
    expect(engine?.src.playbackRate.value).toBeCloseTo(0.35, 6);
    expect(engine?.gain.gain.targets.at(-1)).toBeCloseTo(1.7 * 0.26, 6);

    sfx.vehicle(85, false, 2, 0, 0, 1, 0, 0, false);
    expect(engine?.src.playbackRate.targets.at(-1)).toBeCloseTo(0.35 + 0.6, 6);
    expect(engine?.gain.gain.targets.at(-1)).toBeCloseTo(1.7 * (0.26 + 0.48), 6);

    sfx.vehicle(85, false, 2, 0, 0, 1, 1, 0, false);
    expect(engine?.src.playbackRate.targets.at(-1)).toBeCloseTo(0.35 + 0.6 + 0.3, 6);
    expect(engine?.gain.gain.targets.at(-1)).toBeCloseTo(1.7 * (0.26 + 0.48 + 0.22), 6);
  });

  it('glides a live loop rate instead of stepping it', () => {
    // The corner bug: drive.speed reaches the client in 20 Hz snapshot steps and
    // the rate was assigned raw, so the pitch climbed a staircase (~4% of rate in
    // one tick coming out of a corner, measured on the real driving kernel). The
    // gain beside it has always ramped; the rate now does too.
    sfx.vehicle(93, false, 2, 0, 0, 0.2, 0, 0, false);
    const engine = (
      sfx as unknown as {
        loops: Map<string, { src: FakeSource }>;
      }
    ).loops.get('realm-racers-engine-93');
    const opened = engine?.src.playbackRate.value ?? 0;
    expect(engine?.src.playbackRate.targets).toHaveLength(0);

    sfx.vehicle(93, false, 2, 0, 0, 0.9, 0.9, 0, false);
    const target = engine?.src.playbackRate.targets.at(-1) ?? 0;
    expect(target).toBeGreaterThan(opened);
    // The commanded value is a ramp target, never a jump: the raw value stays put.
    expect(engine?.src.playbackRate.value).toBe(opened);
    expect(engine?.src.playbackRate.timeConstants.at(-1)).toBe(LOOP_RATE_GLIDE);
    // Re-commanding the same rate must not re-arm the ramp every frame.
    sfx.vehicle(93, false, 2, 0, 0, 0.9, 0.9, 0, false);
    expect(engine?.src.playbackRate.targets).toHaveLength(1);
  });

  it('reads speed over the ground, so a drift does not dive the engine pitch', () => {
    // The kernel conserves velocity through the body rotation: in a drift part of
    // it lives in `slip`, so the forward component alone under-reads the machine's
    // actual pace. src/sim/vehicle_motion.ts already refuses that mistake for
    // steering authority; the engine and the tyre roll follow the same rule.
    const straight = { speed: 30, slip: 0 };
    const drifting = { speed: 30, slip: 24 };
    const calls: number[] = [];
    const sink = {
      vehicle: (
        _id: number,
        _self: boolean,
        _x: number,
        _y: number,
        _z: number,
        speedFraction: number,
      ) => calls.push(speedFraction),
      stopVehicle: () => {},
      realmRacersEvent: () => {},
    };
    for (const state of [straight, drifting]) {
      syncRealmRacersVehicleAudio(
        sink,
        94,
        false,
        true,
        { ...vehicleDrive(), speed: state.speed, slip: state.slip },
        true,
        0,
        0,
        0,
        0,
      );
    }
    // rally_loaner tops out at 60 yd/s.
    expect(calls[0]).toBeCloseTo(30 / 60, 6);
    expect(calls[1]).toBeCloseTo(Math.hypot(30, 24) / 60, 6);
    expect(calls[1]).toBeGreaterThan(calls[0]);
  });

  it('preserves the engine target, ducks contacts to the per-vehicle budget, and limits the vehicle bus', () => {
    sfx.vehicle(86, false, 2, 0, 0, 1, 1, 12, true);
    const internals = sfx as unknown as {
      loops: Map<string, { gain: FakeGain; panner: FakePanner | null; output: unknown }>;
      vehicleLimiter: FakeCompressor;
      master: FakeGain;
    };
    const engine = internals.loops.get('realm-racers-engine-86');
    const skid = internals.loops.get('realm-racers-skid-86');
    const roll = internals.loops.get('realm-racers-roll-86');
    const targets = [engine, skid, roll].map((loop) => loop?.gain.gain.targets.at(-1) ?? 0);
    expect(targets[0]).toBeCloseTo(1.7 * (0.26 + 0.48 + 0.22), 6);
    expect(targets.reduce((sum, target) => sum + target, 0)).toBeCloseTo(2.25, 6);
    expect(skid?.gain.gain.targets.at(-1)).toBeLessThan(
      0.42 * SFX_CLIPS.mount_run_stalkglider_snail.gain,
    );
    expect(roll?.gain.gain.targets.at(-1)).toBeLessThan(0.2 * SFX_CLIPS.foot_dirt.gain);

    expect(internals.vehicleLimiter.threshold.value).toBe(0);
    expect(internals.vehicleLimiter.knee.value).toBe(0);
    expect(internals.vehicleLimiter.ratio.value).toBe(20);
    expect(internals.vehicleLimiter.attack.value).toBe(0);
    expect(internals.vehicleLimiter.release.value).toBe(0.1);
    expect(internals.vehicleLimiter.connectedTo).toBe(internals.master);
    for (const loop of [engine, skid, roll]) {
      expect(loop?.output).toBe(internals.vehicleLimiter);
      expect(loop?.panner?.connectedTo).toBe(internals.vehicleLimiter);
    }
  });

  it('does not duck tyre contact while the vehicle mix remains under budget', () => {
    sfx.vehicle(87, false, 2, 0, 0, 0.2, 0, 3, false);
    const loops = (sfx as unknown as { loops: Map<string, { gain: FakeGain }> }).loops;
    expect(loops.get('realm-racers-skid-87')?.gain.gain.targets.at(-1)).toBeCloseTo(
      0.042 * SFX_CLIPS.mount_run_stalkglider_snail.gain,
      6,
    );
    expect(loops.get('realm-racers-roll-87')?.gain.gain.targets.at(-1)).toBeCloseTo(
      0.2 * 0.12 * SFX_CLIPS.foot_stone.gain,
      6,
    );
  });

  it('leaves the pilot engine unpanned while rivals and track contact stay spatial', () => {
    sfx.setListener(15, 8, 28, 0, 0, 1, 10, 2, 20);
    sfx.vehicle(83, true, 12, 3, 24, 0.5, 0.4, 5, false);
    sfx.vehicle(84, false, 18, 3, 26, 0.5, 0.4, 5, false);

    const internals = sfx as unknown as {
      loops: Map<string, { panner: FakePanner | null; output: unknown }>;
      vehicleLimiter: FakeCompressor;
    };
    const loops = internals.loops;
    // The pilot's own engine carries no listener-relative direction at all, so
    // nothing can steer it into one ear. Rival engines stay world-positioned:
    // distance and panning are how you hear where the other racers are.
    expect(loops.get('realm-racers-engine-83')?.panner).toBeNull();
    // Losing the panner must not also lose the vehicle bus: the pilot engine is
    // the loudest layer in the mix and the limiter is what holds it under unity.
    expect(loops.get('realm-racers-engine-83')?.output).toBe(internals.vehicleLimiter);
    expect(loops.get('realm-racers-roll-83')?.panner).toMatchObject({ x: 12, y: 3, z: 24 });
    expect(loops.get('realm-racers-skid-83')?.panner).toMatchObject({ x: 12, y: 3, z: 24 });
    expect(loops.get('realm-racers-engine-84')?.panner).toMatchObject({ x: 18, y: 3, z: 26 });
    expect(loops.get('realm-racers-roll-84')?.panner).toMatchObject({ x: 18, y: 3, z: 26 });
    expect(loops.get('realm-racers-skid-84')?.panner).toMatchObject({ x: 18, y: 3, z: 26 });
  });

  it('holds the pilot engine steady through a corner whichever way the chase pivot swings', () => {
    // The corner bug this pins: the engine used to be placed at the listener
    // offset by (machine - chase pivot), and in a corner that pivot sits yards
    // to the inside or outside of the machine (spring-arm lag plus look-ahead).
    // A panner reads DIRECTION only, never length, so a source sitting all but
    // on top of the listener panned hard into whichever ear the residual
    // pointed at: turn left, hear it left. Both corners below drive that
    // residual to opposite sides of the machine.
    const engineSlot = () =>
      (
        sfx as unknown as {
          loops: Map<string, { panner: FakePanner | null }>;
        }
      ).loops.get('realm-racers-engine-91');

    sfx.setListener(0, 5, 0, 0, 0, 1, 4, 2, -3);
    sfx.vehicle(91, true, 0, 2, 0, 0.9, 0.8, 0, false);
    const cornering = engineSlot();
    expect(cornering?.panner).toBeNull();

    sfx.setListener(0, 5, 0, 0, 0, 1, -4, 2, -3);
    sfx.vehicle(91, true, 0, 2, 0, 0.9, 0.8, 0, false);
    // Same slot, still unpanned: the opposite corner changes nothing about
    // where the pilot hears their own engine.
    expect(engineSlot()).toBe(cornering);
    expect(engineSlot()?.panner).toBeNull();
  });

  it('rebuilds the engine loop when a machine changes hands between pilot and rival', () => {
    // Renderer-side `self` is `entity.id === sim.playerId`, so it flips under
    // the eye a spectator follows. Reusing the slot across that flip would keep
    // a stale panner wired in (or leave a rival's engine unpanned), because the
    // loop cache keys on clip and output bus alone.
    const engineSlot = () =>
      (
        sfx as unknown as {
          loops: Map<string, { panner: FakePanner | null }>;
        }
      ).loops.get('realm-racers-engine-92');

    sfx.setListener(15, 8, 28, 0, 0, 1, 10, 2, 20);
    sfx.vehicle(92, false, 18, 3, 26, 0.5, 0.4, 0, false);
    expect(engineSlot()?.panner).toMatchObject({ x: 18, y: 3, z: 26 });

    sfx.vehicle(92, true, 18, 3, 26, 0.5, 0.4, 0, false);
    expect(engineSlot()?.panner).toBeNull();

    sfx.vehicle(92, false, 19, 3, 26, 0.5, 0.4, 0, false);
    expect(engineSlot()?.panner).toMatchObject({ x: 19, y: 3, z: 26 });
  });

  it('tears every loop down on race exit and on leaving audible range', () => {
    const drive: VehicleDrive = {
      profileKey: 'rally_loaner',
      speed: 30,
      slip: 4,
      steerAngle: 0,
      yawRate: 0,
      spin: 0,
      handbrake: 0,
      gripMult: 1,
      dragMult: 1.8,
      speedCap: 1,
      slipCap: 1,
      collisionImpact: 0,
      controlsLocked: false,
    };
    expect(syncRealmRacersVehicleAudio(sfx, 78, true, false, drive, true, 2, 0, 0, 6)).toBe(true);
    expect(realmRacersVehicleAudioAction(true, false, true)).toBe('stop');
    expect(syncRealmRacersVehicleAudio(sfx, 78, true, true, null, true, 2, 0, 0, 0)).toBe(false);
    expect(sfx.hasLoop('realm-racers-engine-78')).toBe(false);
    expect(sfx.hasLoop('realm-racers-skid-78')).toBe(false);
    expect(sfx.hasLoop('realm-racers-roll-78')).toBe(false);

    expect(syncRealmRacersVehicleAudio(sfx, 79, false, false, drive, true, 2, 0, 0, 0)).toBe(true);
    expect(sfx.hasLoop('realm-racers-engine-79')).toBe(true);
    expect(realmRacersVehicleAudioAction(true, true, false)).toBe('stop');
    expect(syncRealmRacersVehicleAudio(sfx, 79, false, true, drive, false, 2, 0, 0, 0)).toBe(false);
    expect(sfx.hasLoop('realm-racers-engine-79')).toBe(false);
    expect(realmRacersVehicleAudioAction(false, false, true)).toBe('none');
    expect(realmRacersVehicleAudioAction(false, true, true)).toBe('run');
  });

  it('mixes the bed over the race music and still leaves the bus headroom', () => {
    const loopTarget = (id: string): number => {
      const slot = (sfx as unknown as { loops: Map<string, { target: number }> }).loops.get(id);
      if (!slot) throw new Error(`expected loop ${id}`);
      return slot.target; // the commanded target already multiplied by the catalog trim
    };

    // full tilt: top speed, full throttle load, drifting, off the racing surface
    sfx.vehicle(80, false, 0, 0, 0, 1, 1, 12, true);
    const engine = loopTarget('realm-racers-engine-80');
    const skid = loopTarget('realm-racers-skid-80');
    const roll = loopTarget('realm-racers-roll-80');

    // the engine is the bed: it must clear the race music, which plays at a flat
    // 0.5 x the music slider (music.ts) and, unlike this, never fades with distance
    expect(engine).toBeGreaterThan(0.5);
    expect(engine).toBeGreaterThan(skid);
    expect(skid).toBeGreaterThan(roll);

    // headroom: every clip conforms to a -6 dBFS true peak or below
    // (docs/design/sound_effects.md) and the SFX bus has no limiter, so the three
    // loops at once must stay under unity with the slider wide open (master = SAMPLE_GAIN).
    expect((engine + skid + roll) * 0.5 * 0.85).toBeLessThan(1);
  });

  it('keeps an idling machine audible and rolls quieter on the road than off it', () => {
    const loopTarget = (id: string): number =>
      (sfx as unknown as { loops: Map<string, { target: number }> }).loops.get(id)?.target ?? 0;

    sfx.vehicle(81, false, 0, 0, 0, 0, 0, 0, false);
    expect(loopTarget('realm-racers-engine-81')).toBeGreaterThan(0);
    expect(sfx.hasLoop('realm-racers-skid-81')).toBe(false);

    sfx.vehicle(82, false, 0, 0, 0, 1, 0, 0, false);
    const onRoad = loopTarget('realm-racers-roll-82');
    sfx.vehicle(82, false, 0, 0, 0, 1, 0, 0, true);
    expect(loopTarget('realm-racers-roll-82')).toBeGreaterThan(onRoad);
  });

  it('maps live shell/contact events and scrape telemetry to the intended one-shots', () => {
    expect(
      realmRacersSpatialAudioCue({
        type: 'realmRacersGroundBlastFired',
        sourceId: 1,
        x: 2,
        z: 3,
        targetX: 4,
        targetZ: 5,
        flightSeconds: 0.8,
      }),
    ).toEqual({ kind: 'groundBlastFire', x: 2, z: 3, heightOffset: 1 });
    expect(
      realmRacersSpatialAudioCue({
        type: 'realmRacersGroundBlastHit',
        sourceId: 1,
        targetId: null,
        x: 4,
        z: 5,
        impact: 0.7,
      }),
    ).toEqual({ kind: 'groundBlastImpact', x: 4, z: 5, heightOffset: 0, impact: 0.7 });
    expect(
      realmRacersSpatialAudioCue({
        type: 'realmRacersBump',
        aId: 1,
        bId: 2,
        x: 6,
        z: 7,
        impact: 12,
      }),
    ).toEqual({ kind: 'bump', x: 6, z: 7, heightOffset: 0.5, impact: 0.5 });
    // Oil borrows the scrape voice rather than a sample of its own, at tyre
    // height and with the impact already normalized at the emit site.
    expect(
      realmRacersSpatialAudioCue({
        type: 'realmRacersSlicked',
        targetId: 3,
        x: 10,
        z: 11,
        impact: 0.6,
      }),
    ).toEqual({ kind: 'scrape', x: 10, z: 11, heightOffset: 0.3, impact: 0.6 });
    expect(realmRacersScrapeAudioCue(8, 9, 0.4)).toEqual({
      kind: 'scrape',
      x: 8,
      z: 9,
      heightOffset: 0.5,
      impact: 0.4,
    });
    expect(realmRacersSpatialAudioCue({ type: 'realmRacersGo' })).toBeNull();

    const before = sources.length;
    const ground = (x: number, z: number): number => x + z;
    // Camera and player deliberately differ: only groundBlastImpact should translate
    // around the camera so WebAudio receives the player-to-impact vector.
    sfx.setListener(15, 8, 28, 0, 0, 1, 10, 2, 20);
    const shellGainIndex = gains.length;
    const shellPannerIndex = panners.length;
    // An extreme random value proves groundBlastFire bypasses the generic +10% gain jitter.
    vi.mocked(Math.random).mockReturnValue(1);
    playRealmRacersEventAudio(sfx, ground, {
      type: 'realmRacersGroundBlastFired',
      sourceId: 1,
      x: 2,
      z: 3,
      targetX: 4,
      targetZ: 5,
      flightSeconds: 0.8,
    });
    expect(gains[shellGainIndex]?.gain.value).toBe(1.25 * SFX_CLIPS.proj_groundshaker.gain);
    expect(panners[shellPannerIndex]?.refDistance).toBe(24);
    expect(panners[shellPannerIndex]?.maxDistance).toBe(46);
    expect(panners[shellPannerIndex]).toMatchObject({ x: 2, y: 6, z: 3 });
    // -6 dBTP asset ceiling x runtime gain x +4.5 dB catalog trim x sample master.
    expect(10 ** (-6 / 20) * 1.25 * SFX_CLIPS.proj_groundshaker.gain * 0.85).toBeLessThan(1);
    vi.mocked(Math.random).mockReturnValue(0.5);

    const impactGainIndex = gains.length;
    const impactPannerIndex = panners.length;
    vi.mocked(Math.random).mockReturnValue(1);
    playRealmRacersEventAudio(sfx, ground, {
      type: 'realmRacersGroundBlastHit',
      sourceId: 1,
      targetId: null,
      x: 4,
      z: 5,
      impact: 0.7,
    });
    expect(gains[impactGainIndex]?.gain.value).toBe(
      0.825 * 1.5 * SFX_CLIPS.impact_groundshaker.gain,
    );
    expect(panners[impactPannerIndex]?.refDistance).toBe(5);
    expect(panners[impactPannerIndex]).toMatchObject({ x: 9, y: 15, z: 13 });
    // Current -7.2 dBTP asset x max-strength runtime gain x +5 dB catalog trim x master.
    expect(10 ** (-7.2 / 20) * 0.9 * 1.5 * SFX_CLIPS.impact_groundshaker.gain * 0.85).toBeLessThan(
      1,
    );
    vi.mocked(Math.random).mockReturnValue(0.5);

    const bumpGainIndex = gains.length;
    const bumpPannerIndex = panners.length;
    playRealmRacersEventAudio(sfx, ground, {
      type: 'realmRacersBump',
      aId: 1,
      bId: 2,
      x: 6,
      z: 7,
      impact: 12,
    });
    expect(gains[bumpGainIndex]?.gain.value).toBe(0.775 * SFX_CLIPS.impact_arcane.gain);
    expect(panners[bumpPannerIndex]?.refDistance).toBe(5);
    expect(panners[bumpPannerIndex]).toMatchObject({ x: 6, y: 13.5, z: 7 });

    nowT += 1;
    const scrapeGainIndex = gains.length;
    const scrapePannerIndex = panners.length;
    playRealmRacersScrapeAudio(sfx, ground, 8, 9, 0.4);
    expect(gains[scrapeGainIndex]?.gain.ramps).toContain(0.55 * SFX_CLIPS.impact_arcane.gain);
    expect(panners[scrapePannerIndex]?.refDistance).toBe(5);
    playRealmRacersEventAudio(sfx, ground, { type: 'realmRacersGo' });
    expect(sources.slice(before).map((source) => source.buffer)).toEqual([
      RALLY_GROUND_BLAST_BUFFER,
      GROUND_SHAKER_IMPACT_BUFFER,
      ARCANE_IMPACT_BUFFER,
      ARCANE_IMPACT_BUFFER,
    ]);
  });
});

describe('mount engine audio (windup/loop/winddown)', () => {
  const KEY = 'terrorspark_groundshaker';
  const START_KEY = `mount_run_${KEY}_start`;
  const LOOP_KEY = `mount_run_${KEY}`;
  const STOP_KEY = `mount_run_${KEY}_stop`;
  const START_BUF = { duration: 0.9 };
  const STOP_BUF = { duration: 0.7 };

  // One-shot playback increments Sfx's MAX_VOICES concurrency counter on play
  // and only decrements it via the real AudioBufferSourceNode's `ended`
  // event, which this suite's FakeSource never fires (it only records
  // `stopAt`); left alone, this suite's extra one-shots would push the
  // shared `sfx` singleton's counter toward the 24-voice cap and starve
  // later tests in this FILE. Reset it directly instead. Also resets the
  // per-entity engine and loop maps: entity id 1 is reused test to test.
  beforeEach(() => {
    const buffers = (sfx as unknown as { buffers: Map<string, { duration: number }> }).buffers;
    buffers.set(START_KEY, START_BUF);
    buffers.set(STOP_KEY, STOP_BUF);
    (sfx as unknown as { mountEngines: Map<number, unknown> }).mountEngines.clear();
    (sfx as unknown as { loops: Map<string, unknown> }).loops.clear();
  });

  afterEach(() => {
    (sfx as unknown as { active: number }).active = 0;
  });

  it('falls through (returns false) for a mount with no engine take set', () => {
    expect(sfx.mountEngine(0, 0, 0, 'valorsteed', true, 1)).toBe(false);
  });

  it('plays the windup one-shot on the moving edge and reports the mount as handled', () => {
    const handled = sfx.mountEngine(0, 0, 0, KEY, true, 1);
    expect(handled).toBe(true);
    expect(lastSource().buffer).toBe(START_BUF);
    expect(lastSource().started).toBe(true);
  });

  it('starts the sustain loop once the windup duration elapses while still moving', () => {
    const buffers = (sfx as unknown as { buffers: Map<string, unknown> }).buffers;
    sfx.mountEngine(0, 0, 0, KEY, true, 1);
    nowT += 0.9;
    sfx.mountEngine(0, 0, 0, KEY, true, 1);
    // The loop path (Sfx.loop) creates its own source with `loop = true`.
    const loopSrc = sources.at(-1) as unknown as { loop?: boolean; buffer: unknown };
    expect(loopSrc.loop).toBe(true);
    expect(loopSrc.buffer).toBe(buffers.get(LOOP_KEY));
  });

  it('splices into the loop at full volume, no fade-in ramp at the windup/loop seam', () => {
    sfx.mountEngine(0, 0, 0, KEY, true, 1);
    nowT += 0.9;
    gainAutomationCalls = []; // isolate just the loop-entry gain call
    sfx.mountEngine(0, 0, 0, KEY, true, 1);
    const loops = (sfx as unknown as { loops: Map<string, { gain: { gain: { value: number } } }> })
      .loops;
    const slot = loops.get('mountEngine:1');
    expect(slot?.gain.gain.value).toBeGreaterThan(0); // snapped straight to target
    expect(gainAutomationCalls).toEqual(['setValueAtTime']); // never setTargetAtTime (the ramp)
  });

  it('a quick tap plays the windup and winddown back to back with no loop ever engaging', () => {
    sfx.mountEngine(0, 0, 0, KEY, true, 1);
    const beforeLoop = sources.length;
    // Released well before the 0.9s windup naturally ends.
    nowT += 0.1;
    sfx.mountEngine(0, 0, 0, KEY, false, 1);
    expect(sources.length).toBe(beforeLoop); // no new source yet: windup still playing
    // At the windup's natural end, moving is still false: chains to winddown.
    nowT += 0.8;
    sfx.mountEngine(0, 0, 0, KEY, false, 1);
    expect(lastSource().buffer).toBe(STOP_BUF);
    // Never entered the loop.
    expect(sources.some((s) => (s as unknown as { loop?: boolean }).loop)).toBe(false);
  });

  it('stops the loop and plays the winddown one-shot on the stop edge', () => {
    sfx.mountEngine(0, 0, 0, KEY, true, 1);
    nowT += 0.9;
    sfx.mountEngine(0, 0, 0, KEY, true, 1); // enters the loop
    nowT += 1;
    sfx.mountEngine(0, 0, 0, KEY, false, 1);
    expect(lastSource().buffer).toBe(STOP_BUF);
    const loops = (sfx as unknown as { loops: Map<string, unknown> }).loops;
    expect(loops.has('mountEngine:1')).toBe(false);
  });

  it('tracks each entity independently', () => {
    sfx.mountEngine(0, 0, 0, KEY, true, 1);
    const rider1Start = lastSource();
    sfx.mountEngine(0, 0, 0, KEY, false, 2); // rider 2 was never moving: no-op
    expect(sources.at(-1)).toBe(rider1Start);
  });

  it('mountEngineReset silences an in-progress loop and clears state', () => {
    sfx.mountEngine(0, 0, 0, KEY, true, 1);
    nowT += 0.9;
    sfx.mountEngine(0, 0, 0, KEY, true, 1);
    const loops = (sfx as unknown as { loops: Map<string, unknown> }).loops;
    expect(loops.has('mountEngine:1')).toBe(true);
    sfx.mountEngineReset(1);
    expect(loops.has('mountEngine:1')).toBe(false);
    // A fresh moving edge after reset starts clean from the windup again.
    nowT += 1;
    sfx.mountEngine(0, 0, 0, KEY, true, 1);
    expect(lastSource().buffer).toBe(START_BUF);
  });

  it('a mount swap resets to a clean windup instead of carrying the old moving state', () => {
    // Enter the sustain loop on the engine mount.
    sfx.mountEngine(0, 0, 0, KEY, true, 1);
    nowT += 0.9;
    sfx.mountEngine(0, 0, 0, KEY, true, 1);
    const loops = (sfx as unknown as { loops: Map<string, unknown> }).loops;
    expect(loops.has('mountEngine:1')).toBe(true);
    // renderer.ts calls mountEngineReset(e.id) on every mountKey transition,
    // including a live swap to a different mount (here, an ordinary mount
    // with no engine take set of its own).
    sfx.mountEngineReset(1);
    expect(loops.has('mountEngine:1')).toBe(false);
    expect(sfx.mountEngine(0, 0, 0, 'valorsteed', true, 1)).toBe(false);
    // Swapping back to the engine mount must start a fresh windup, not skip
    // straight to the loop because the old 'moving' state carried over.
    nowT += 1;
    const handled = sfx.mountEngine(0, 0, 0, KEY, true, 1);
    expect(handled).toBe(true);
    expect(lastSource().buffer).toBe(START_BUF);
    expect(loops.has('mountEngine:1')).toBe(false); // still winding up, no loop yet
  });

  it('reusing the same entity id for a fresh mount (e.g. a new summon) starts clean', () => {
    sfx.mountEngine(0, 0, 0, KEY, true, 1);
    nowT += 0.9;
    sfx.mountEngine(0, 0, 0, KEY, true, 1); // entity 1 is now in the sustain loop
    const loops = (sfx as unknown as { loops: Map<string, unknown> }).loops;
    expect(loops.has('mountEngine:1')).toBe(true);
    // The entity id is reused for a brand-new mount (dismount + fresh
    // summon reusing the id): renderer.ts resets before the new mount's
    // first mountEngine call.
    sfx.mountEngineReset(1);
    nowT += 1;
    const handled = sfx.mountEngine(0, 0, 0, KEY, true, 1);
    expect(handled).toBe(true);
    expect(lastSource().buffer).toBe(START_BUF); // windup, not an inherited loop
    expect(loops.has('mountEngine:1')).toBe(false);
  });

  it('plays the windup with jitter disabled so its actual duration matches the nominal duration the loop splice is scheduled against', () => {
    const playAtSpy = vi.spyOn(sfx, 'playAt');
    sfx.mountEngine(0, 0, 0, KEY, true, 1);
    const startCall = playAtSpy.mock.calls.find((call) => call[0] === START_KEY);
    expect(startCall).toBeDefined();
    expect(startCall?.[4]).toMatchObject({ jitter: false });
    playAtSpy.mockRestore();
  });

  it('preloadMountEngine warms all three engine clip keys for a mount with an engine take set', () => {
    const loading = (sfx as unknown as { loading: Map<string, unknown> }).loading;
    const buffers = (sfx as unknown as { buffers: Map<string, unknown> }).buffers;
    const failedLoads = (sfx as unknown as { failedLoads: Set<string> }).failedLoads;
    // loadBuffer short-circuits (skipping the `loading` map entirely) when a
    // buffer is already cached, so force all three cold to observe the fetch
    // actually get kicked off for each one.
    for (const key of [START_KEY, LOOP_KEY, STOP_KEY]) {
      buffers.delete(key);
      failedLoads.delete(key);
    }
    loading.clear();
    sfx.preloadMountEngine(KEY);
    expect(loading.has(START_KEY)).toBe(true);
    expect(loading.has(LOOP_KEY)).toBe(true);
    expect(loading.has(STOP_KEY)).toBe(true);
    // Restore for later tests in this file that assume these are cached.
    buffers.set(START_KEY, START_BUF);
    buffers.set(STOP_KEY, STOP_BUF);
  });

  it('preloadMountEngine is a no-op for a mount with no engine take set', () => {
    const loading = (sfx as unknown as { loading: Map<string, unknown> }).loading;
    loading.clear();
    sfx.preloadMountEngine('valorsteed');
    expect(loading.size).toBe(0);
  });

  it('threads the immediate flag through the cold pendingLoops path so a resumed loop still snaps to target gain instead of falling back to a fade-in', () => {
    const buffers = (sfx as unknown as { buffers: Map<string, unknown> }).buffers;
    const failedLoads = (sfx as unknown as { failedLoads: Set<string> }).failedLoads;
    const coldKey = 'mount_run_never_cached_test_key';
    buffers.delete(coldKey);
    failedLoads.delete(coldKey);
    sfx.loop('cold-loop-immediate', coldKey, 0.85, 0, 0, 0, undefined, true);
    const pendingLoops = (sfx as unknown as { pendingLoops: Map<string, { immediate?: boolean }> })
      .pendingLoops;
    expect(pendingLoops.get('cold-loop-immediate')?.immediate).toBe(true);
  });

  it('actually passes the immediate flag through to the resumed loop() call, snapping gain via setValueAtTime rather than ramping via setTargetAtTime', async () => {
    // Storing `immediate` on the pending entry (the test above) is necessary
    // but not sufficient: a mutant that stores it and then drops
    // `pending.immediate` from the resumed `loop(...)` call below (line 738)
    // would still pass that test. This test forces the cold path all the way
    // through to a resolved buffer and inspects the actual gain automation
    // call the resumed loop() makes, which is the only observable difference
    // `immediate` produces (see the `justCreated && immediate` branch).
    const coldKey = 'mount_run_never_cached_test_key_resumed';
    const buffers = (sfx as unknown as { buffers: Map<string, unknown> }).buffers;
    const failedLoads = (sfx as unknown as { failedLoads: Set<string> }).failedLoads;
    buffers.delete(coldKey);
    failedLoads.delete(coldKey);
    // Real fetch/decode isn't available in this test's WebAudio stub, so stub
    // loadBuffer directly to resolve with a fake decoded buffer, simulating
    // the fetch finishing successfully while the loop is still pending.
    const fakeBuffer = { duration: 1 };
    // Populate the buffer cache as a side effect of the mocked resolution, so
    // the resumed loop() call (which re-checks `buffers` itself) finds it
    // cached instead of falling back to ANOTHER cold path and recursing.
    const loadBufferSpy = vi
      .spyOn(
        sfx as unknown as { loadBuffer: (key: string, variantIndex?: number) => Promise<unknown> },
        'loadBuffer',
      )
      .mockImplementation(async (key: string, variantIndex = 0) => {
        buffers.set(variantIndex === 0 ? key : `${key}:${variantIndex}`, fakeBuffer);
        return fakeBuffer;
      });
    const id = 'cold-loop-immediate-resumed';
    sfx.loop(id, coldKey, 0.85, 0, 0, 0, undefined, true);
    // Let the mocked loadBuffer promise (and its .then() resume callback) settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    loadBufferSpy.mockRestore();
    const loops = (sfx as unknown as { loops: Map<string, { gain: { gain: { value: number } } }> })
      .loops;
    const slot = loops.get(id);
    expect(slot).toBeDefined();
    expect(slot?.gain.gain.value).toBeCloseTo(0.85);
    expect(gainAutomationCalls).toContain('setValueAtTime');
    expect(gainAutomationCalls).not.toContain('setTargetAtTime');
  });
});

describe('amb_forge: its own narrower audible distance', () => {
  beforeEach(() => {
    const buffers = (sfx as unknown as { buffers: Map<string, { duration: number }> }).buffers;
    buffers.set('amb_forge', { duration: 3 });
    buffers.set('amb_campfire', { duration: 3 });
    sfx.setListener(0, 0, 0, 0, 0, 1);
  });

  function forgeSlot() {
    const loops = (sfx as unknown as { loops: Map<string, { panner: unknown }> }).loops;
    return loops.get('forge-1');
  }

  it('uses FORGE_MAX_DISTANCE on its panner, not the shared MAX_DISTANCE every other sound uses', () => {
    const withinRange = FORGE_MAX_DISTANCE - 1;
    sfx.ambience('vale', false, null, false, 0, [
      { id: 'forge-1', kind: 'forge', x: withinRange, y: 0, z: 0 },
    ]);
    const slot = forgeSlot();
    expect(slot).toBeDefined();
    const panner = slot?.panner as { refDistance: number; maxDistance: number };
    expect(panner.maxDistance).toBe(FORGE_MAX_DISTANCE); // not the shared MAX_DISTANCE
    expect(panner.refDistance).toBe(REF_DISTANCE); // unchanged
  });

  it('stops playing beyond its own cutoff, well inside the shared MAX_DISTANCE (46)', () => {
    // Halfway between the forge's own cutoff and the shared MAX_DISTANCE:
    // guaranteed past the forge's cutoff and comfortably under the shared
    // ceiling every other positional sound still uses, at any tuned value.
    // If this were using the shared default, it would still be audible here.
    const beyondForgeRange = (FORGE_MAX_DISTANCE + MAX_DISTANCE) / 2;
    sfx.ambience('vale', false, null, false, 0, [
      { id: 'forge-1', kind: 'forge', x: beyondForgeRange, y: 0, z: 0 },
    ]);
    expect(forgeSlot()).toBeUndefined();
  });

  it('a campfire at the same distance is unaffected, still using the shared MAX_DISTANCE', () => {
    const beyondForgeRange = (FORGE_MAX_DISTANCE + MAX_DISTANCE) / 2;
    sfx.ambience('vale', false, null, false, 0, [
      { id: 'campfire-1', kind: 'campfire', x: beyondForgeRange, y: 0, z: 0 },
    ]);
    const loops = (sfx as unknown as { loops: Map<string, unknown> }).loops;
    expect(loops.get('campfire-1')).toBeDefined();
  });

  it('re-syncs an already-live loop panner to its override every frame, not only on creation', () => {
    const withinRange = FORGE_MAX_DISTANCE - 1;
    sfx.ambience('vale', false, null, false, 0, [
      { id: 'forge-1', kind: 'forge', x: withinRange, y: 0, z: 0 },
    ]);
    const panner = forgeSlot()?.panner as { refDistance: number; maxDistance: number };
    // Simulate drift: something else on the panner left maxDistance stale.
    panner.maxDistance = MAX_DISTANCE;
    expect(panner.maxDistance).not.toBe(FORGE_MAX_DISTANCE);

    // ambience() calls loop() again next frame for the same live source.
    sfx.ambience('vale', false, null, false, 0, [
      { id: 'forge-1', kind: 'forge', x: withinRange, y: 0, z: 0 },
    ]);
    expect(panner.maxDistance).toBe(FORGE_MAX_DISTANCE);
  });

  it('carries the maxDistance override through the pending-load round trip', () => {
    // A distinct id: the singleton sfx's loops/pendingLoops maps persist
    // across tests, so reusing 'forge-1' here would hit the still-live slot
    // from a sibling test's resync path instead of the pending-load branch.
    const id = 'forge-pending';
    // The outer beforeEach preloads amb_forge; remove it so this call takes
    // the pending-load branch instead of creating the panner immediately.
    const buffers = (sfx as unknown as { buffers: Map<string, { duration: number }> }).buffers;
    buffers.delete('amb_forge');
    sfx.loop(id, 'amb_forge', 1, 5, 0, 5, FORGE_MAX_DISTANCE);
    const pendingLoops = (sfx as unknown as { pendingLoops: Map<string, { maxDistance?: number }> })
      .pendingLoops;
    const pending = pendingLoops.get(id);
    expect(pending?.maxDistance).toBe(FORGE_MAX_DISTANCE);

    // The buffer finishes loading; replay loop() with exactly what the
    // pending record carried, the same value the real load callback reads.
    buffers.set('amb_forge', { duration: 3 });
    sfx.loop(id, 'amb_forge', 1, 5, 0, 5, pending?.maxDistance);
    const loops = (sfx as unknown as { loops: Map<string, { panner: unknown }> }).loops;
    const panner = loops.get(id)?.panner as { refDistance: number; maxDistance: number };
    expect(panner.maxDistance).toBe(FORGE_MAX_DISTANCE);
    expect(panner.refDistance).toBe(REF_DISTANCE);
  });
});

// playAt's boolean return is the load-bearing contract behind the mob
// idle-bark per-entity cooldown (src/ui/mob_idle_sfx.ts, hud.ts): a caller
// stamps its own cooldown only when this returns true, so a false positive
// here (returning true on a cooldown-blocked or unbuffered attempt) would
// silently bench a mob for the full cooldown window over a bark that never
// actually played, the exact bug the design's own doc comment warns about.
describe('playAt return value', () => {
  it('returns false for an unbuffered key (kicks off the async load instead)', () => {
    expect(sfx.playAt('mob_beast_idle', 0, 0, 0)).toBe(false);
  });

  it('returns true for a scheduled play, then false for an immediate repeat blocked by the per-key cooldown', () => {
    const buffers = (sfx as unknown as { buffers: Map<string, { duration: number }> }).buffers;
    buffers.set('foot_stone', { duration: 0.3 });

    expect(sfx.playAt('foot_stone', 0, 0, 0)).toBe(true);
    expect(sfx.playAt('foot_stone', 0, 0, 0)).toBe(false); // same instant, default 0.03s cooldown blocks it

    nowT += 1; // clear the cooldown
    expect(sfx.playAt('foot_stone', 0, 0, 0)).toBe(true);
  });
});

describe('timedGroundLoop (Blizzard storm)', () => {
  beforeEach(() => {
    const buffers = (sfx as unknown as { buffers: Map<string, { duration: number }> }).buffers;
    buffers.set('blizzard', { duration: 8 });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts a loop and auto-stops it after the given duration', () => {
    sfx.timedGroundLoop('groundZone:blizzard', 'blizzard', 0, 0, 0, 6.5);
    const loops = (sfx as unknown as { loops: Map<string, unknown> }).loops;
    expect(loops.has('groundZone:blizzard')).toBe(true);
    vi.advanceTimersByTime(6500);
    expect(loops.has('groundZone:blizzard')).toBe(false);
  });

  it('a fresh call before expiry reschedules the stop instead of stacking timers', () => {
    sfx.timedGroundLoop('groundZone:blizzard', 'blizzard', 0, 0, 0, 6.5);
    vi.advanceTimersByTime(5000); // most of the way through, still alive
    sfx.timedGroundLoop('groundZone:blizzard', 'blizzard', 10, 0, 10, 6.5); // zone lands again
    const loops = (sfx as unknown as { loops: Map<string, unknown> }).loops;
    vi.advanceTimersByTime(5000); // the ORIGINAL timer would have fired by now
    expect(loops.has('groundZone:blizzard')).toBe(true); // still alive: rescheduled
    vi.advanceTimersByTime(1500);
    expect(loops.has('groundZone:blizzard')).toBe(false);
  });

  it('ignores an unknown key entirely', () => {
    const before = sources.length;
    sfx.timedGroundLoop('groundZone:nope', 'not_a_real_key', 0, 0, 0, 5);
    const loops = (sfx as unknown as { loops: Map<string, unknown> }).loops;
    expect(loops.has('groundZone:nope')).toBe(false);
    expect(sources.length).toBe(before);
  });
});

// Footstep sounds ship OFF by default and are toggleable via the footstepSfx
// setting. While disabled, footstep() must be a no-op (no source created) for
// self and other entities alike; re-enabling resumes playback.
describe('footstep toggle', () => {
  it('is a no-op when footsteps are disabled', () => {
    sfx.setFootstepsEnabled(false);
    const before = sources.length;
    sfx.footstep(0, 0, 0, 'grass', true, true); // self
    sfx.footstep(5, 0, 5, 'grass', false, false); // another entity
    expect(sources.length).toBe(before);
  });

  it('resumes playback once re-enabled', () => {
    sfx.setFootstepsEnabled(false);
    sfx.footstep(0, 0, 0, 'grass', true, true);
    const muted = sources.length;
    sfx.setFootstepsEnabled(true);
    nowT += 0.5; // clear the per-key cooldown
    sfx.footstep(0, 0, 0, 'grass', true, true);
    expect(sources.length).toBe(muted + 1);
    expect(lastSource().started).toBe(true);
  });
});

describe('necromancy audio', () => {
  it('uses distinct low-pitched cues for transformation, heartbeat, and soul consumption', () => {
    const before = sources.length;

    sfx.necromancy('lichTransform', 0, 0, 0, true);
    expect(lastSource().playbackRate.value).toBeCloseTo(0.68);
    expect(lastSource().buffer?.duration).toBe(0.7);
    nowT += 4;
    sfx.necromancy('lichHeartbeat', 0, 0, 0, true);
    expect(lastSource().playbackRate.value).toBeCloseTo(0.55);
    expect(lastSource().buffer?.duration).toBe(0.5);
    nowT += 1;
    sfx.necromancy('soulConsume', 0, 0, 0, true);
    expect(lastSource().playbackRate.value).toBeCloseTo(0.74);
    expect(lastSource().buffer?.duration).toBe(0.65);

    expect(sources.length).toBe(before + 3);
  });

  it('isolates necromancy cooldowns from shared samples and other Liches', () => {
    sfx.playAt('impact_shadow', 0, 0, 0, { cooldown: 10 });
    const afterOrdinaryImpact = sources.length;

    sfx.necromancy('lichTransform', 0, 0, 0, true);
    sfx.necromancy('lichTransform', 10, 0, 10, false);

    expect(sources.length).toBe(afterOrdinaryImpact + 2);
  });

  it('keys necromancy cooldowns by stable entity identity, not position', () => {
    const before = sources.length;

    sfx.necromancy('lichTransform', 4, 0, 4, false, 101);
    sfx.necromancy('lichTransform', 4, 0, 4, false, 202);

    expect(sources.length).toBe(before + 2);
  });

  it('prunes stale positional cooldown entries during a long session', () => {
    const cooldowns = (
      sfx as unknown as {
        lastPlay: Map<string, number>;
      }
    ).lastPlay;
    cooldowns.clear();

    for (let sourceId = 0; sourceId < 200; sourceId++) {
      sfx.necromancy('lichTransform', 0, 0, 0, false, sourceId);
      lastSource().onended?.();
    }
    expect(cooldowns.size).toBe(200);

    nowT += 61;
    sfx.necromancy('lichTransform', 0, 0, 0, false, 999);

    expect(cooldowns.size).toBe(1);
  });
});
