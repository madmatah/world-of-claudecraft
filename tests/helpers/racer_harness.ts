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
// A suite using this helper must mock Postgres itself, hoisted above its own
// import of this module (copy the factory at the top of
// tests/realm_racers_v2_prediction.test.ts).

import { REALM_RACERS_PRACTICE_CIRCUIT } from '../../src/sim/content/realm_racers_circuits';
import { vehicleProfile } from '../../src/sim/content/vehicles';
import { BUILTIN_WORLD, setActiveWorldContent } from '../../src/sim/data';
import { realmRacersTrack } from '../../src/sim/realm_racers_spline';
import type { RealmRacersMatch } from '../../src/sim/social/realm_racers';
import { DT } from '../../src/sim/types';
import {
  addVehicleSlip,
  addVehicleSpin,
  resetVehicleDrive,
  vehicleMaxSlip,
} from '../../src/sim/vehicle_motion';
import type { LatencyLinkConfig } from './latency_link';
import { createOnlineHarness, type OnlineHarness, SERVER_TICK_MS } from './online_harness';
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
