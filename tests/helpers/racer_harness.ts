// A seated Realm Racers pilot on the REAL online path: one ClientWorld and one
// GameServer over the simulated link (tests/helpers/online_harness.ts), racing
// a Practice grid of house pilots on the practice circuit.
//
// What the rig adds on top of the online harness, each for a stated reason:
//   - The stripped world the online racer suite races in
//     (tests/realm_racers_online.test.ts): no camps, npcs or ground objects,
//     so nothing but the race draws from the shared stream, and the scripted
//     stream (tests/helpers/realm_racers_rng.ts) can pin every pickup roll.
//   - The house pilots are parked off the racing line after every server
//     tick, well clear of the local machine: a rival contact is a real server
//     outcome, and a proof about the local pilot's own motion must not depend
//     on where a bot happened to steer.
//   - The loading lobby is closed the way a live client closes it: the
//     ClientWorld sends its ready command over the link.
//   - GO is pulled in (the shipped countdown is REALM_RACERS_COUNTDOWN_TICKS),
//     through the match's own `goTick`, the one field the countdown reads.
//   - A server-side shove, applied after a tick the way a contact applies its
//     impulse, for the later proofs about outcomes the client cannot predict.
//
// `createRacerDuelHarness` seats TWO human clients in one public heat instead,
// each over its own link, so what one pilot's screen shows of the other can be
// measured against the server (tests/realm_racers_rival_frames.test.ts):
//   - Both queue through their clients; the backfill that seats a short queue
//     is brought forward (the wait clock is rewound, the way GO is pulled in),
//     so the heat is the shipped one: the drawn competition circuit, its
//     public lane, two house pilots in the seats nobody claimed.
//   - The house pilots are parked (or left to drive), the boxes stripped
//     (realmRacersStripPickups) so no draw moves a scenario.
//   - Each pilot is held on scripted keys, or driven closed loop by the house
//     pilot brain (src/sim/realm_racers_driver.ts) reading only what that
//     client knows: its own mirrored pose and drive, on every new snapshot.
//   - Each pilot's screen can be recorded frame by frame: its drawn self and
//     the rival drawn through the renderer's own remote racing step
//     (stepRemoteRacerView, the call renderer.sync makes).
//
// A suite using this helper must mock Postgres itself, hoisted above its own
// import of this module (copy the factory at the top of
// tests/realm_racers_v2_prediction.test.ts).

import type { ClientWorld } from '../../src/net/online';
import {
  createRemoteVehicleDisplay,
  remoteRacerProjectionAgeMs,
  resetRemoteVehicleDisplay,
  stepRemoteRacerView,
} from '../../src/render/remote_vehicle_display_core';
import { REALM_RACERS_PRACTICE_CIRCUIT } from '../../src/sim/content/realm_racers_circuits';
import { vehicleProfile } from '../../src/sim/content/vehicles';
import { BUILTIN_WORLD, setActiveWorldContent } from '../../src/sim/data';
import { auraSpeedMult } from '../../src/sim/player_motion';
import { driveRealmRacers, type RallyDriverTier } from '../../src/sim/realm_racers_driver';
import { realmRacersStripPickups } from '../../src/sim/realm_racers_pickups';
import { type RallyTrackModel, realmRacersTrack } from '../../src/sim/realm_racers_spline';
import {
  type RealmRacersMatch,
  realmRacersCircuitOf,
  realmRacersToCanonical,
} from '../../src/sim/social/realm_racers';
import { REALM_RACERS_BACKFILL_TICKS } from '../../src/sim/social/realm_racers_bots';
import { DT, type SimEvent } from '../../src/sim/types';
import {
  addVehicleSlip,
  addVehicleSpin,
  resetVehicleDrive,
  vehicleMaxSlip,
  vehicleTopSpeedFor,
  vehicleVelocityX,
  vehicleVelocityZ,
} from '../../src/sim/vehicle_motion';
import type { LatencyLinkConfig } from './latency_link';
import {
  type ClientFrameInfo,
  createOnlineHarness,
  type HarnessClient,
  type OnlineHarness,
  SERVER_TICK_MS,
} from './online_harness';
import { installScriptedRng, type ScriptedRng } from './realm_racers_rng';

/** Where along the lap (a share of its length) each house pilot is parked:
 *  the tail of the lap is taken, far from a grid the local pilot leaves. */
const PARK_SHARES = [0.45, 0.6, 0.75] as const;

export interface RacerHarnessOptions {
  latency: LatencyLinkConfig;
  frameMs?: number;
  warmupMs?: number;
  /** Server ticks from the seat to GO (test speed; clamped to the shipped
   *  countdown, never longer). */
  goAfterTicks?: number;
  /** Compose the frame's facing from main.ts's producers (the default), or
   *  take the online harness's direct resolved-intent seam. */
  keyTimeline?: boolean;
  /** The negotiated movement wire (browsers negotiate 2, the default). */
  movementWire?: 1 | 2;
  /** Predict the seated pilot on wire v2 (the pipeline flag, off by default). */
  predictDrivers?: boolean;
}

/** A contact-shaped impulse on the local machine. */
export interface RacerShove {
  /** Lateral velocity added, yd/s (held inside the slide ceiling). */
  slip?: number;
  /** Carried spin added, rad/s (held inside the shared spin ceiling). */
  spin?: number;
  /** Forward speed added, yd/s. */
  speed?: number;
}

export interface RacerHarness {
  harness: OnlineHarness;
  rng: ScriptedRng;
  /** The local pilot's practice match (throws before the seat). */
  match(): RealmRacersMatch;
  /** Where each house pilot is parked, in world coordinates. */
  parkedPilots(): { pid: number; x: number; z: number }[];
  /** Ask for a Practice race through the client and advance until the mirror
   *  has the local pilot seated. */
  seat(): void;
  /** Send the client's lobby ready, then advance until the race is running and
   *  the mirror has the controls. */
  advanceToGo(): void;
  /** Apply an impulse to the local machine after the next server tick. */
  shove(impulse: RacerShove): void;
  /** Advance the virtual clock one server tick at a time until `done` holds. */
  advanceUntil(done: () => boolean, maxMs: number, what: string): void;
  dispose(): void;
}

export function createRacerHarness(opts: RacerHarnessOptions): RacerHarness {
  setActiveWorldContent({ ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] });
  let harness: OnlineHarness;
  try {
    harness = createOnlineHarness({
      latency: opts.latency,
      movementWire: opts.movementWire ?? 2,
      frameMs: opts.frameMs,
      warmupMs: opts.warmupMs,
      keyTimeline: opts.keyTimeline ?? true,
      predictDrivers: opts.predictDrivers,
    });
  } catch (error) {
    setActiveWorldContent(null);
    throw error;
  }
  const { server, client, pid, clock } = harness;
  const rng = installScriptedRng(server.sim);
  const track = realmRacersTrack(REALM_RACERS_PRACTICE_CIRCUIT);
  const goAfterTicks = opts.goAfterTicks ?? 20;
  let goPulledFor: RealmRacersMatch | null = null;
  let seatSeen: { match: RealmRacersMatch; tick: number } | null = null;

  function currentMatch(): RealmRacersMatch | null {
    return server.sim.realmRacers.practices.find((m) => m.pids.includes(pid)) ?? null;
  }

  function match(): RealmRacersMatch {
    const found = currentMatch();
    if (!found) throw new Error('the local pilot is not seated in a practice race');
    return found;
  }

  function parkedPilots(): { pid: number; x: number; z: number }[] {
    const seated = currentMatch();
    if (!seated) return [];
    return seated.pids
      .filter((other) => other !== pid)
      .map((other, i) => {
        const at = track.pointAt(track.length * PARK_SHARES[i % PARK_SHARES.length]);
        return { pid: other, x: seated.origin.x + at.x, z: seated.origin.z + at.z };
      });
  }

  harness.onServerTick(() => {
    const seated = currentMatch();
    if (!seated) return;
    if (seatSeen?.match !== seated) seatSeen = { match: seated, tick: server.sim.tickCount };
    if (goPulledFor !== seated && seated.phase === 'countdown') {
      goPulledFor = seated;
      // Counted from the SEAT, so the lobby's ready round trip does not move GO.
      // The race clock runs from GO, so its deadline moves with it.
      const goAt = Math.max(server.sim.tickCount + 1, seatSeen.tick + goAfterTicks);
      const pulledBy = Math.max(0, seated.goTick - goAt);
      seated.goTick -= pulledBy;
      seated.deadlineTick -= pulledBy;
    }
    for (const parked of parkedPilots()) {
      const other = server.sim.entities.get(parked.pid);
      if (!other) continue;
      other.pos.x = parked.x;
      other.pos.z = parked.z;
      other.prevPos = { ...other.pos };
      if (other.drive) resetVehicleDrive(other.drive);
    }
  });

  function advanceUntil(done: () => boolean, maxMs: number, what: string): void {
    const deadline = clock.now() + maxMs;
    while (!done()) {
      if (clock.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
      clock.advanceTo(clock.now() + SERVER_TICK_MS);
    }
  }

  function mirrorDrive() {
    return client.entities.has(client.playerId) ? client.player.drive : null;
  }

  return {
    harness,
    rng,
    match,
    parkedPilots,
    seat(): void {
      client.startRealmRacersPractice('rookie');
      advanceUntil(
        () => currentMatch() !== null && mirrorDrive() != null,
        5000,
        'the practice seat to reach the mirror',
      );
    },
    advanceToGo(): void {
      if (match().phase === 'loading') client.readyRealmRacers();
      advanceUntil(
        () => match().phase === 'racing' && mirrorDrive()?.controlsLocked === false,
        (goAfterTicks + 40) * SERVER_TICK_MS,
        'GO to reach the mirror',
      );
    },
    shove(impulse: RacerShove): void {
      const remove = harness.onServerTick(() => {
        remove();
        const drive = harness.serverEntity.drive;
        if (!drive) return;
        if (impulse.speed) drive.speed += impulse.speed;
        if (impulse.slip) {
          addVehicleSlip(
            drive,
            impulse.slip,
            vehicleMaxSlip(vehicleProfile(drive.profileKey), drive),
          );
        }
        if (impulse.spin) addVehicleSpin(drive, impulse.spin);
      });
    },
    advanceUntil,
    dispose(): void {
      try {
        harness.dispose();
      } finally {
        setActiveWorldContent(null);
      }
    },
  };
}

/** The farthest a parked house pilot can roll inside one tick before it is
 *  parked again, yd: its machine's top speed over one tick. */
export function parkedPilotReachYd(profileKey: string): number {
  return vehicleProfile(profileKey).maxSpeed * DT;
}

/** A pilot's scripted keys, held until changed. `steer` -1 is the left key. */
export interface PilotKeys {
  throttle?: boolean;
  brake?: boolean;
  steer?: -1 | 0 | 1;
  handbrake?: boolean;
}

/** The closed-loop pilot: the house-pilot brain on the client's own mirror. */
export interface PilotAutopilot {
  /** The brain's tier (default 'ace', the tidiest line at the highest pace). */
  tier?: RallyDriverTier;
  /** Yards left of the brain's own line the machine is held (negative: right).
   *  The brain is handed its pose shifted the other way, so it corrects onto
   *  a line offset by this much. */
  lineOffsetYd?: number;
  /** Scale on the top speed the brain is handed (1: race pace). */
  speedScale?: number;
  /**
   * What the brain reads: 'mirror' (default) is only what this client knows,
   * its newest mirrored pose and drive. 'server' reads the authoritative
   * machine instead, a test-side oracle that keeps a scripted line clean
   * under latency; its keys still ride this client's wire, so the server
   * still acts on them an uplink late.
   */
  observe?: 'mirror' | 'server';
}

export interface DuelPilot {
  name: string;
  peer: HarnessClient;
  pid: number;
  client: ClientWorld;
  /** Hold scripted keys (the autopilot, if any, is switched off). */
  keys(keys: PilotKeys): void;
  /** Drive closed loop from the next snapshot on; null releases every key. */
  autopilot(options: PilotAutopilot | null): void;
}

/** One frame of what a pilot's screen showed. */
export interface ScreenFrame {
  /** Virtual wall time of the frame, ms. */
  tMs: number;
  /** The drawn self (the renderer's self pose). */
  selfX: number;
  selfZ: number;
  selfPredicted: boolean;
  /** The rival as renderer.sync draws a remote racing machine, or null on a
   *  frame its projection branch does not run. */
  rivalX: number | null;
  rivalZ: number | null;
  rivalFacing: number | null;
  /** The age the projection was handed, ms. */
  rivalAgeMs: number | null;
  /** The newest mirrored pose of the rival (the projection's start). */
  rivalMirrorX: number | null;
  rivalMirrorZ: number | null;
  /** Racer events this frame drained off the client. */
  events: SimEvent[];
}

/** A racer's authoritative pose after one server tick. */
export interface ServerRacerPose {
  x: number;
  z: number;
  facing: number;
  vx: number;
  vz: number;
}

export interface ServerTickRow {
  /** Virtual wall time the tick ran at, ms. */
  tMs: number;
  tick: number;
  poses: Record<number, ServerRacerPose>;
  /** The tick's Realm Racers events. */
  events: SimEvent[];
}

export interface DuelRecording {
  /** Per pilot pid, every frame its screen drew while recording. */
  screens: Record<number, ScreenFrame[]>;
  ticks: ServerTickRow[];
}

export interface RacerDuelOptions {
  /** Pilot A's link (the primary client) and pilot B's (a peer). */
  latencyA: LatencyLinkConfig;
  latencyB: LatencyLinkConfig;
  frameMs?: number;
  warmupMs?: number;
  goAfterTicks?: number;
  keyTimeline?: boolean;
  movementWire?: 1 | 2;
  /** 'parked' (default): the two house pilots are held off the racing line;
   *  'driving': they race. */
  housePilots?: 'parked' | 'driving';
  /** Predict both seated pilots on wire v2 (the pipeline flag). */
  predictDrivers?: boolean;
}

export interface RacerDuelHarness {
  harness: OnlineHarness;
  rng: ScriptedRng;
  a: DuelPilot;
  b: DuelPilot;
  /** The heat both pilots are seated in (throws before the seat). */
  match(): RealmRacersMatch;
  /** The heat's circuit model (canonical frame; see toCanonical). */
  track(): RallyTrackModel;
  toCanonical(x: number, z: number): { x: number; z: number };
  /** Both queue through their clients; advance until both mirrors are seated. */
  seat(): void;
  /** Both send the lobby ready; advance until the race runs on both mirrors. */
  advanceToGo(): void;
  advanceFor(ms: number): void;
  /** The wall instant of the server tick that dropped the flag, ms (throws
   *  before it has). Scenario scripts are timed from here, so the same step
   *  lands at the same SERVER race time whatever the links. */
  goWallMs(): number;
  /** Advance to `raceMs` after the server's GO (never backwards). */
  advanceToRaceMs(raceMs: number): void;
  advanceUntil(done: () => boolean, maxMs: number, what: string): void;
  /** Start recording both screens and the server; returns the live record. */
  record(): DuelRecording;
  /** Stop recording (the record keeps what it has). */
  stopRecording(): void;
  dispose(): void;
}

const RACER_EVENT_PREFIX = 'realmRacers';

function racerEvents(events: readonly SimEvent[]): SimEvent[] {
  return events.filter((ev) => ev.type.startsWith(RACER_EVENT_PREFIX));
}

export function createRacerDuelHarness(opts: RacerDuelOptions): RacerDuelHarness {
  setActiveWorldContent({ ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] });
  let harness: OnlineHarness;
  let peer: HarnessClient;
  try {
    harness = createOnlineHarness({
      latency: opts.latencyA,
      movementWire: opts.movementWire ?? 2,
      frameMs: opts.frameMs,
      warmupMs: opts.warmupMs,
      keyTimeline: opts.keyTimeline ?? true,
      predictDrivers: opts.predictDrivers,
    });
  } catch (error) {
    setActiveWorldContent(null);
    throw error;
  }
  try {
    peer = harness.addPeer({
      latency: opts.latencyB,
      characterId: 2,
      keyTimeline: opts.keyTimeline ?? true,
      warmupMs: opts.warmupMs,
      predictDrivers: opts.predictDrivers,
    });
  } catch (error) {
    harness.dispose();
    setActiveWorldContent(null);
    throw error;
  }
  const { server, clock } = harness;
  const primary: HarnessClient = {
    link: harness.link,
    session: harness.session,
    client: harness.client,
    pid: harness.pid,
    serverEntity: harness.serverEntity,
    holdIntent: harness.holdIntent,
    onFrame: harness.onClientFrame,
    reconcileOutcomes: harness.reconcileOutcomes,
  };
  const rng = installScriptedRng(server.sim);
  const goAfterTicks = opts.goAfterTicks ?? 20;
  const humans = [primary.pid, peer.pid];
  let seatRequested = false;
  let seatSeen: { match: RealmRacersMatch; tick: number } | null = null;
  let goPulledFor: RealmRacersMatch | null = null;
  let recording: DuelRecording | null = null;
  // The wall instant of the server tick that dropped the flag.
  let goWallMs: number | null = null;

  function currentMatch(): RealmRacersMatch | null {
    const heat = server.sim.realmRacers.match;
    return heat && humans.every((pid) => heat.pids.includes(pid)) ? heat : null;
  }

  function match(): RealmRacersMatch {
    const found = currentMatch();
    if (!found) throw new Error('the two pilots are not seated in one heat');
    return found;
  }

  harness.onServerTick((events) => {
    const rally = server.sim.realmRacers;
    const heat = currentMatch();
    if (!heat && seatRequested && rally.match === null) {
      // Bring the backfill forward: once both are queued, their wait clock is
      // rewound so the next tick's backfill seats them, through the same path
      // a short queue takes after REALM_RACERS_BACKFILL_TICKS.
      if (humans.every((pid) => rally.queue.includes(pid))) {
        for (const pid of humans) {
          rally.queuedAtTick.set(pid, server.sim.tickCount - REALM_RACERS_BACKFILL_TICKS);
        }
      }
    }
    if (heat) {
      if (seatSeen?.match !== heat) {
        seatSeen = { match: heat, tick: server.sim.tickCount };
        realmRacersStripPickups(heat.pickups);
      }
      if (goPulledFor !== heat && heat.phase === 'countdown') {
        goPulledFor = heat;
        const goAt = Math.max(server.sim.tickCount + 1, seatSeen.tick + goAfterTicks);
        const pulledBy = Math.max(0, heat.goTick - goAt);
        heat.goTick -= pulledBy;
        heat.deadlineTick -= pulledBy;
      }
      if (goWallMs === null && heat.phase === 'racing') goWallMs = clock.now();
      if ((opts.housePilots ?? 'parked') === 'parked') {
        const lap = realmRacersTrack(realmRacersCircuitOf(heat));
        let parkedIndex = 0;
        for (const other of heat.pids) {
          if (humans.includes(other)) continue;
          const at = lap.pointAt(lap.length * PARK_SHARES[parkedIndex % PARK_SHARES.length]);
          parkedIndex++;
          const e = server.sim.entities.get(other);
          if (!e) continue;
          e.pos.x = heat.origin.x + at.x;
          e.pos.z = heat.origin.z + at.z;
          e.prevPos = { ...e.pos };
          if (e.drive) resetVehicleDrive(e.drive);
        }
      }
    }
    if (!recording) return;
    const poses: Record<number, ServerRacerPose> = {};
    for (const pid of humans) {
      const e = server.sim.entities.get(pid);
      if (!e) continue;
      poses[pid] = {
        x: e.pos.x,
        z: e.pos.z,
        facing: e.facing,
        vx: e.drive ? vehicleVelocityX(e.drive, e.facing) : 0,
        vz: e.drive ? vehicleVelocityZ(e.drive, e.facing) : 0,
      };
    }
    recording.ticks.push({
      tMs: clock.now(),
      tick: server.sim.tickCount,
      poses,
      events: racerEvents(events),
    });
  });

  function makePilot(name: string, self: HarnessClient, rivalPid: number): DuelPilot {
    const client = self.client;
    // The renderer keeps one projection state per remote view and steps it on
    // every frame the view exists, so this one runs from the start, recorded
    // or not.
    const rivalDisplay = createRemoteVehicleDisplay();
    let autopilot: PilotAutopilot | null = null;
    let decidedOnSnapAt = -1;
    let hintIndex = 0;
    let decisions = 0;

    function drive(): void {
      if (!autopilot) return;
      if (client.lastSnapAt === decidedOnSnapAt) return;
      decidedOnSnapAt = client.lastSnapAt;
      const heat = currentMatch();
      if (!heat || !client.entities.has(client.playerId)) return;
      const pe = autopilot.observe === 'server' ? self.serverEntity : client.player;
      const machine = pe.drive;
      if (!machine || machine.controlsLocked) return;
      const lap = realmRacersTrack(realmRacersCircuitOf(heat));
      const here = realmRacersToCanonical(heat, pe.pos.x, pe.pos.z);
      const onLine = lap.project(here.x, here.z, hintIndex);
      hintIndex = onLine.index;
      const offset = autopilot.lineOffsetYd ?? 0;
      // The left normal is (-tz, tx): the brain sees the machine shifted right
      // by the offset, and steering that pose onto its line holds the real one
      // `offset` to the left.
      const x = here.x + onLine.tangentZ * offset;
      const z = here.z - onLine.tangentX * offset;
      const projection = offset === 0 ? onLine : lap.project(x, z, hintIndex);
      const out = driveRealmRacers({
        pid: pe.id,
        x,
        z,
        facing: pe.facing,
        speed: machine.speed,
        slip: machine.slip,
        yawRate: machine.yawRate + machine.spin,
        track: lap,
        projection,
        topSpeed: vehicleTopSpeedFor(machine, auraSpeedMult(pe)) * (autopilot.speedScale ?? 1),
        steerAngle: machine.steerAngle,
        steerLockSeconds: 1 / vehicleProfile(machine.profileKey).steerRate,
        rival: null,
        incoming: [],
        weaponReady: false,
        tier: autopilot.tier ?? 'ace',
        tick: decisions++,
      });
      self.holdIntent({
        forward: out.forward,
        back: out.back,
        turnLeft: out.turnLeft,
        turnRight: out.turnRight,
        jump: out.handbrake,
      });
    }

    self.onFrame((frame: ClientFrameInfo) => {
      // renderer.sync's remote racing branch, through the same step it calls
      // (stepRemoteRacerView) with the same entity, display frame, clock and
      // frame dt. A rival gone from the mirror has no view to project.
      const e = client.entities.get(rivalPid);
      let projected = false;
      if (e)
        projected = stepRemoteRacerView(
          rivalDisplay,
          e,
          frame.selfMotion,
          frame.nowMs,
          frame.frameDtSec,
        );
      else if (rivalDisplay.active) resetRemoteVehicleDisplay(rivalDisplay);
      const ageMs =
        projected && e?.netUpdatedAt !== undefined
          ? remoteRacerProjectionAgeMs(frame.nowMs, e.netUpdatedAt, frame.selfMotion)
          : null;
      if (recording) {
        recording.screens[self.pid]?.push({
          tMs: frame.nowMs,
          selfX: frame.drawn.x,
          selfZ: frame.drawn.z,
          selfPredicted: frame.predictorActive,
          rivalX: projected ? rivalDisplay.x : null,
          rivalZ: projected ? rivalDisplay.z : null,
          rivalFacing: projected ? rivalDisplay.facing : null,
          rivalAgeMs: ageMs,
          rivalMirrorX: e ? e.pos.x : null,
          rivalMirrorZ: e ? e.pos.z : null,
          events: racerEvents(frame.events),
        });
      }
      drive();
    });

    return {
      name,
      peer: self,
      pid: self.pid,
      client,
      keys(keys: PilotKeys): void {
        autopilot = null;
        const steer = keys.steer ?? 0;
        self.holdIntent({
          forward: keys.throttle ?? false,
          back: keys.brake ?? false,
          turnLeft: steer < 0,
          turnRight: steer > 0,
          jump: keys.handbrake ?? false,
        });
      },
      autopilot(options: PilotAutopilot | null): void {
        autopilot = options;
        decidedOnSnapAt = -1;
        if (!options) {
          self.holdIntent({
            forward: false,
            back: false,
            turnLeft: false,
            turnRight: false,
            jump: false,
          });
        }
      },
    };
  }

  const a = makePilot('A', primary, peer.pid);
  const b = makePilot('B', peer, primary.pid);

  function advanceUntil(done: () => boolean, maxMs: number, what: string): void {
    const deadline = clock.now() + maxMs;
    while (!done()) {
      if (clock.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
      clock.advanceTo(clock.now() + SERVER_TICK_MS);
    }
  }

  function seatedOnMirror(pilot: DuelPilot): boolean {
    const c = pilot.client;
    return c.entities.has(c.playerId) && c.player.drive != null;
  }

  function racingOnMirror(pilot: DuelPilot): boolean {
    const c = pilot.client;
    return c.entities.has(c.playerId) && c.player.drive?.controlsLocked === false;
  }

  return {
    harness,
    rng,
    a,
    b,
    match,
    track: () => realmRacersTrack(realmRacersCircuitOf(match())),
    toCanonical: (x: number, z: number) => realmRacersToCanonical(match(), x, z),
    seat(): void {
      seatRequested = true;
      // A queues first and B once A is in, so A takes grid slot 0 at every
      // pair of links rather than whichever command landed first.
      a.client.joinRealmRacersQueue();
      advanceUntil(
        () => server.sim.realmRacers.queue.includes(a.pid),
        5000,
        'pilot A to reach the queue',
      );
      b.client.joinRealmRacersQueue();
      advanceUntil(
        () => currentMatch() !== null && seatedOnMirror(a) && seatedOnMirror(b),
        5000,
        'the heat seat to reach both mirrors',
      );
    },
    advanceToGo(): void {
      if (match().phase === 'loading') {
        a.client.readyRealmRacers();
        b.client.readyRealmRacers();
      }
      advanceUntil(
        () => match().phase === 'racing' && racingOnMirror(a) && racingOnMirror(b),
        (goAfterTicks + 40) * SERVER_TICK_MS,
        'GO to reach both mirrors',
      );
    },
    advanceFor(ms: number): void {
      clock.advanceTo(clock.now() + ms);
    },
    goWallMs(): number {
      if (goWallMs === null) throw new Error('the server has not dropped the flag yet');
      return goWallMs;
    },
    advanceToRaceMs(raceMs: number): void {
      if (goWallMs === null) throw new Error('the server has not dropped the flag yet');
      clock.advanceTo(Math.max(clock.now(), goWallMs + raceMs));
    },
    advanceUntil,
    record(): DuelRecording {
      recording = { screens: { [a.pid]: [], [b.pid]: [] }, ticks: [] };
      return recording;
    },
    stopRecording(): void {
      recording = null;
    },
    dispose(): void {
      try {
        harness.dispose();
      } finally {
        setActiveWorldContent(null);
      }
    },
  };
}
