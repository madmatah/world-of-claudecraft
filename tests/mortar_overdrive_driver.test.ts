// The Mortar Overdrive driving brain, driven directly with no Sim: it is a pure
// leaf over the shared track model, so every claim here is checkable in plain
// numbers. What it must get right is the racing line's SIGN convention (shared
// with the projection's `lateral`, and invisible to an eye watching a bot drive
// past), braking BEFORE a corner rather than in it, recovering from a machine
// that is lost or wedged, and the tier separation that makes a rookie beatable.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MORTAR_OVERDRIVE_PRACTICE_CIRCUIT as GARDEN_CIRCUIT } from '../src/sim/content/mortar_overdrive/circuits';
import { vehicleProfile } from '../src/sim/content/vehicles';
import {
  driveMortarOverdrive,
  MORTAR_OVERDRIVE_DRIVER_TIERS,
  type MortarOverdriveDriverBlast,
  type MortarOverdriveDriverInput,
  type MortarOverdriveDriverTier,
  mortarOverdriveDriverProfile,
  mortarOverdriveRacingLineOffset,
  unstickCycleTicks,
} from '../src/sim/mortar_overdrive/driver';
import { mortarOverdriveTrack } from '../src/sim/mortar_overdrive/spline';
import { TICK_RATE } from '../src/sim/types';

const TOP_SPEED = 60;
/** The shipped machine's own wheel travel, read from the profile rather than
 *  copied, so re-tuning `steerRate` retunes the brain's rock-out with it. */
const LOANER_STEER_RATE = vehicleProfile('mo_loaner').steerRate;
/** Arc positions read off the real circuit: the start/finish straight, the fast
 *  sweeper onto the north straight, and the hairpin (its tightest corner). */
const START_STRAIGHT_S = 5;
/** The one point on the lap whose WHOLE aim window is straight (measured: the
 *  worst heading error over the next 30 yards is 0.005 rad, an order under the
 *  finest deadband). `START_STRAIGHT_S` above is straight where the machine
 *  STANDS but its aim window reaches the first corner, which at racing speed is
 *  turn-in rather than weaving now that the aim carries the wheel's travel. */
const FULLY_STRAIGHT_S = 440;
const SWEEPER_S = 120;
const HAIRPIN_S = 340;

interface Placement {
  /** Signed offset from the centerline along the left normal (the infield side). */
  lateral?: number;
  /** Radians added to the tangent heading; 0 points straight down the circuit. */
  heading?: number;
  speed?: number;
  slip?: number;
  tier?: MortarOverdriveDriverTier;
  rival?: { x: number; z: number; vx?: number; vz?: number } | null;
  yawRate?: number;
  steerAngle?: number;
  steerLockSeconds?: number;
  incoming?: MortarOverdriveDriverBlast[];
  weaponReady?: boolean;
  tick?: number;
  pid?: number;
}

/** Put a machine on the circuit at arc position `s` and build the brain's input. */
function at(s: number, place: Placement = {}): MortarOverdriveDriverInput {
  const track = mortarOverdriveTrack(GARDEN_CIRCUIT);
  const p = track.pointAt(s);
  const lateral = place.lateral ?? 0;
  const x = p.x - p.tz * lateral;
  const z = p.z + p.tx * lateral;
  return {
    pid: place.pid ?? 0,
    x,
    z,
    facing: Math.atan2(p.tx, p.tz) + (place.heading ?? 0),
    speed: place.speed ?? 0,
    slip: place.slip ?? 0,
    yawRate: place.yawRate ?? 0,
    track,
    projection: track.project(x, z),
    topSpeed: TOP_SPEED,
    steerAngle: place.steerAngle ?? 0,
    steerLockSeconds: place.steerLockSeconds ?? 1 / LOANER_STEER_RATE,
    rival: place.rival
      ? { x: place.rival.x, z: place.rival.z, vx: place.rival.vx ?? 0, vz: place.rival.vz ?? 0 }
      : null,
    incoming: place.incoming ?? [],
    weaponReady: place.weaponReady ?? false,
    tier: place.tier ?? 'driver',
    tick: place.tick ?? 0,
  };
}

/** A point `ahead` yards down the circuit from `s`, offset laterally. */
function pointOnTrack(s: number, lateral = 0): { x: number; z: number } {
  const p = mortarOverdriveTrack(GARDEN_CIRCUIT).pointAt(s);
  return { x: p.x - p.tz * lateral, z: p.z + p.tx * lateral };
}

describe('Mortar Overdrive driver: holding the line', () => {
  it('asks for no steering on the start straight, centred and aligned', () => {
    for (const tier of MORTAR_OVERDRIVE_DRIVER_TIERS) {
      const out = driveMortarOverdrive(at(FULLY_STRAIGHT_S, { tier, speed: 40 }));
      expect(out.mode, tier).toBe('race');
      expect({ tier, left: out.turnLeft, right: out.turnRight }).toEqual({
        tier,
        left: false,
        right: false,
      });
    }
  });

  it('steers back toward the line from either side of it', () => {
    // `lateral` is signed by the spline's normal, a plain +90 degree rotation in
    // (x, z), which under the facing convention is the pilot's RIGHT-hand side.
    // So a positive offset is a machine running wide to the right, and coming
    // back is a left-hand correction.
    const infield = driveMortarOverdrive(at(START_STRAIGHT_S, { lateral: 5, speed: 30 }));
    expect({ left: infield.turnLeft, right: infield.turnRight }).toEqual({
      left: true,
      right: false,
    });
    const outfield = driveMortarOverdrive(at(START_STRAIGHT_S, { lateral: -5, speed: 30 }));
    expect({ left: outfield.turnLeft, right: outfield.turnRight }).toEqual({
      left: false,
      right: true,
    });
  });

  // The wheel takes real time to travel (VehicleProfile.steerRate), so a brain
  // that steered on the error as it stands would keep full lock held through a
  // turn it has already made and correct into a fresh overshoot: a bang-bang
  // controller against a lagging actuator is a limit cycle. It steers on the
  // error it will STILL have once the rotation already underway has run its
  // course, which is what a human does with the horizon.
  it('lets go of the wheel once the rotation underway will finish the correction', () => {
    // The same machine, running wide to the right, wheel already held at full
    // left lock: only the rotation reading changes, the geometry is identical.
    const wide = { lateral: 5, speed: 30, steerAngle: 1 };
    const still = driveMortarOverdrive(at(START_STRAIGHT_S, { ...wide, yawRate: 0 }));
    expect({ left: still.turnLeft, right: still.turnRight }).toEqual({ left: true, right: false });

    // Coming round gently: the correction is still wanted, so the wheel stays.
    const easing = driveMortarOverdrive(at(START_STRAIGHT_S, { ...wide, yawRate: 0.2 }));
    expect(easing.turnLeft).toBe(true);

    // Coming round fast enough to finish the job on its own: the brain is off
    // the wheel entirely rather than holding a correction that has already been
    // made.
    const swinging = driveMortarOverdrive(at(START_STRAIGHT_S, { ...wide, yawRate: 0.5 }));
    expect({ left: swinging.turnLeft, right: swinging.turnRight }).toEqual({
      left: false,
      right: false,
    });

    // Faster still, and it is winding the OTHER way to catch the overshoot
    // before it arrives.
    const spinning = driveMortarOverdrive(at(START_STRAIGHT_S, { ...wide, yawRate: 1 }));
    expect(spinning.turnRight).toBe(true);

    // And the anticipation is the WHEEL's, not a constant: with the wheel
    // already straight there is nothing to unwind, so the same rotation buys no
    // hesitation at all and the correction is held. A brain that led by a fixed
    // horizon instead would let go here too, which is measurably slower on a
    // machine whose wheel is quick (it under-steers every corner it enters).
    const centred = driveMortarOverdrive(
      at(START_STRAIGHT_S, { ...wide, steerAngle: 0, yawRate: 1 }),
    );
    expect(centred.turnLeft).toBe(true);
  });

  it('runs the racing line to the INSIDE of a corner and not the outside', () => {
    // The circuit's turnRadius is positive where it bends toward the infield,
    // and `lateral` is positive on that same side, so an inside apex carries the
    // radius's sign. Getting this backwards apexes every corner on its outside.
    const track = mortarOverdriveTrack(GARDEN_CIRCUIT);
    let checked = 0;
    for (let s = 0; s < track.length; s += 5) {
      const radius = track.pointAt(s).turnRadius;
      if (!Number.isFinite(radius) || Math.abs(radius) > 50) continue;
      const offset = mortarOverdriveRacingLineOffset(track, s);
      expect(Math.sign(offset), `apex side at s=${s.toFixed(0)}`).toBe(Math.sign(radius));
      expect(Math.abs(offset), `apex depth at s=${s.toFixed(0)}`).toBeLessThan(
        track.halfWidthAt(s),
      );
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('leaves the racing line ON the centerline down a straight', () => {
    // The start/finish "straight" reads about 480 yards of radius, not infinity,
    // so an unramped apex-seek would still pull the aim half the road off centre
    // and the bot would weave the length of every straight.
    expect(
      mortarOverdriveRacingLineOffset(mortarOverdriveTrack(GARDEN_CIRCUIT), START_STRAIGHT_S),
    ).toBe(0);
  });
});

describe('Mortar Overdrive driver: speed', () => {
  it('brakes BEFORE the hairpin, not in it', () => {
    const straight = driveMortarOverdrive(at(START_STRAIGHT_S, { tier: 'ace', speed: 55 }));
    const approach = driveMortarOverdrive(at(HAIRPIN_S - 40, { tier: 'ace', speed: 55 }));
    const apex = driveMortarOverdrive(at(HAIRPIN_S, { tier: 'ace', speed: 55 }));
    // Near the ceiling on the straight (the ace is already easing a little for
    // the sweeper at the end of it), well down 40 yards out, and lowest at the
    // corner itself.
    expect(straight.speedTarget).toBeGreaterThan(TOP_SPEED * 0.9);
    expect(approach.speedTarget).toBeLessThan(straight.speedTarget);
    expect(apex.speedTarget).toBeLessThan(approach.speedTarget);
    // And the demand is acted on: at 55 yd/s into a target well under it, the
    // brake is held rather than the throttle.
    expect({ forward: approach.forward, back: approach.back }).toEqual({
      forward: false,
      back: true,
    });
  });

  it('does not brake on the start straight at racing speed', () => {
    const out = driveMortarOverdrive(at(START_STRAIGHT_S, { tier: 'ace', speed: 50 }));
    expect(out.back).toBe(false);
    expect(out.forward).toBe(true);
  });

  it('never lets a gentler tier out-drive a harder one, anywhere on the lap', () => {
    const track = mortarOverdriveTrack(GARDEN_CIRCUIT);
    let strictlySlower = 0;
    for (let s = 0; s < track.length; s += 5) {
      const targets = MORTAR_OVERDRIVE_DRIVER_TIERS.map(
        (tier) => driveMortarOverdrive(at(s, { tier, speed: 40 })).speedTarget,
      );
      expect(targets[0], `rookie vs driver at s=${s.toFixed(0)}`).toBeLessThanOrEqual(targets[1]);
      expect(targets[1], `driver vs ace at s=${s.toFixed(0)}`).toBeLessThanOrEqual(targets[2]);
      if (targets[0] < targets[2]) strictlySlower++;
    }
    // Not a vacuous pass: the tiers really do differ around most of the lap.
    expect(strictlySlower).toBeGreaterThan(60);
  });

  it('pulls the handbrake only at the tiers that know how, and only with speed on', () => {
    const hard = { heading: 1.2, speed: 30 } as const;
    expect(driveMortarOverdrive(at(HAIRPIN_S, { ...hard, tier: 'rookie' })).handbrake).toBe(false);
    expect(driveMortarOverdrive(at(HAIRPIN_S, { ...hard, tier: 'ace' })).handbrake).toBe(true);
    // Crawling, the handbrake only spins the machine, so it stays off.
    expect(
      driveMortarOverdrive(at(HAIRPIN_S, { heading: 1.2, speed: 5, tier: 'ace' })).handbrake,
    ).toBe(false);
  });
});

describe('Mortar Overdrive driver: recovery', () => {
  it('turns a machine that is pointing back up the circuit around', () => {
    const out = driveMortarOverdrive(at(SWEEPER_S, { heading: Math.PI, speed: 12 }));
    expect(out.mode).toBe('turnAround');
    // Braking, not driving on: every yard the wrong way is a yard the gates will
    // not credit, and the wrong-way machine has to stop before it can turn.
    expect({ forward: out.forward, back: out.back }).toEqual({ forward: false, back: true });
    expect(out.turnLeft || out.turnRight).toBe(true);
  });

  it('rocks a wedged machine out, alternating drive and reverse', () => {
    // Far past the road edge and barely moving: a stopped machine has no
    // steering authority, so the only way out is to move.
    const wedged = (tick: number) =>
      driveMortarOverdrive(at(SWEEPER_S, { lateral: 24, heading: 1.4, speed: 0.2, tick }));
    const half = unstickCycleTicks(1 / LOANER_STEER_RATE) / 2;
    const first = wedged(0);
    const later = wedged(half);
    expect(first.mode).toBe('unstick');
    expect(later.mode).toBe('unstick');
    expect(first.forward).not.toBe(later.forward);
    expect(first.back).not.toBe(later.back);
    for (const out of [first, later]) expect(out.turnLeft || out.turnRight).toBe(true);
    // Same half, same direction: the alternation is the CYCLE's, not the tick's.
    expect(wedged(half - 1).forward).toBe(first.forward);
  });

  // The rock-out is the one manoeuvre timed by the wheel rather than by the
  // road: the kernel inverts the yaw demand in reverse, so each half of the
  // cycle has to carry the wheel all the way from one lock to the other before
  // any of it bites. A flat tick count cannot say that for every machine, and a
  // half sized under the crossing leaves a wedged pilot rocking with its
  // steering permanently in transit.
  it('sizes the rock-out so the wheel arrives at lock and still has time to bite', () => {
    for (const steerRate of [2, 3.5, 8]) {
      const lockSeconds = 1 / steerRate;
      const halfSeconds = unstickCycleTicks(lockSeconds) / 2 / TICK_RATE;
      // A full lock-to-lock crossing is two lock travels, and what is left over
      // is the part of the half-cycle that actually pushes.
      expect(halfSeconds, `steerRate ${steerRate}`).toBeGreaterThan(2 * lockSeconds);
      expect(halfSeconds - 2 * lockSeconds, `bite at steerRate ${steerRate}`).toBeGreaterThan(0.25);
    }
    // A heavier wheel earns a longer cycle; it is not one constant for all.
    expect(unstickCycleTicks(1 / 2)).toBeGreaterThan(unstickCycleTicks(1 / 8));
    // Even and never zero, so the two halves are equal and the modulo is safe.
    for (const lockSeconds of [0, 1 / 3.5, 5]) {
      expect(unstickCycleTicks(lockSeconds) % 2).toBe(0);
      expect(unstickCycleTicks(lockSeconds)).toBeGreaterThanOrEqual(2);
    }
  });

  it('steers a machine out in the garden back toward the road while it still rolls', () => {
    // Wide but pointing the right way and still moving: that is ordinary racing
    // with a penalty, not a recovery, and the racing line brings it back. Out
    // toward the infield (positive lateral, the pilot's right), so the
    // correction is a left-hand one.
    const out = driveMortarOverdrive(at(SWEEPER_S, { lateral: 24, speed: 18 }));
    expect(out.mode).toBe('race');
    expect({ left: out.turnLeft, right: out.turnRight }).toEqual({ left: true, right: false });
  });
});

describe('Mortar Overdrive driver: the weapon', () => {
  const shotOn = (place: Placement) =>
    driveMortarOverdrive(at(START_STRAIGHT_S, { weaponReady: true, speed: 30, ...place })).fire;

  it('fires only with the rival in the cone, in range, and the weapon ready', () => {
    const ahead = pointOnTrack(START_STRAIGHT_S + 8);
    expect(shotOn({ tier: 'ace', rival: ahead })).toBe(true);
    expect(shotOn({ tier: 'ace', rival: ahead, weaponReady: false })).toBe(false);
    // Out of range: the shell would fall short of it.
    expect(shotOn({ tier: 'ace', rival: pointOnTrack(START_STRAIGHT_S + 30) })).toBe(false);
    // In range but well off the nose.
    expect(shotOn({ tier: 'ace', rival: pointOnTrack(START_STRAIGHT_S - 8) })).toBe(false);
  });

  it('gives a rookie strictly worse trigger discipline than an ace', () => {
    // The same scripted approach, the rival swinging through the nose: the
    // rookie's narrower cone and slower decisions cost it most of the windows.
    const counts = new Map<MortarOverdriveDriverTier, number>();
    for (const tier of MORTAR_OVERDRIVE_DRIVER_TIERS) {
      let shots = 0;
      for (let tick = 0; tick < 400; tick++) {
        const swing = Math.sin(tick / 23) * 0.5;
        const rival = pointOnTrack(START_STRAIGHT_S + 8, Math.tan(swing) * 8);
        if (shotOn({ tier, rival, tick, weaponReady: true })) shots++;
      }
      counts.set(tier, shots);
    }
    expect(counts.get('rookie') as number).toBeLessThan(counts.get('ace') as number);
    expect(counts.get('rookie') as number).toBeLessThanOrEqual(counts.get('driver') as number);
    expect(counts.get('ace') as number).toBeGreaterThan(0);
  });
});

describe('Mortar Overdrive driver: the dodge', () => {
  /** A shell marked to land where this machine is heading. At 30 yd/s over ten
   *  ticks it covers 15 yards, so the marker sits right on its nose. */
  const DODGE_SPEED = 30;
  const DODGE_TICKS = 10;

  function markedAhead(offset = 0): MortarOverdriveDriverBlast {
    const flight = DODGE_TICKS / 20;
    const here = mortarOverdriveTrack(GARDEN_CIRCUIT).pointAt(START_STRAIGHT_S);
    return {
      x: here.x + here.tx * DODGE_SPEED * flight - here.tz * offset,
      z: here.z + here.tz * DODGE_SPEED * flight + here.tx * offset,
      ticksToImpact: DODGE_TICKS,
    };
  }

  it('swerves the tiers that can read a marker, and no others', () => {
    const incoming = [markedAhead()];
    // Straight, centred and aligned: without the shell nobody steers at all, so
    // any steering here IS the dodge.
    const clean = driveMortarOverdrive(at(START_STRAIGHT_S, { tier: 'ace', speed: DODGE_SPEED }));
    expect(clean.turnLeft || clean.turnRight).toBe(false);
    const ace = driveMortarOverdrive(
      at(START_STRAIGHT_S, { tier: 'ace', speed: DODGE_SPEED, incoming }),
    );
    expect(ace.turnLeft || ace.turnRight).toBe(true);
    const rookie = driveMortarOverdrive(
      at(START_STRAIGHT_S, { tier: 'rookie', speed: DODGE_SPEED, incoming }),
    );
    expect(rookie.turnLeft || rookie.turnRight).toBe(false);
  });

  it('steps off the side the marker is not on', () => {
    // Marked a little to the pilot's left (the spline normal is their RIGHT, so
    // a negative offset is left): the escape must go the other way.
    const left = driveMortarOverdrive(
      at(START_STRAIGHT_S, { tier: 'ace', speed: DODGE_SPEED, incoming: [markedAhead(-2)] }),
    );
    const right = driveMortarOverdrive(
      at(START_STRAIGHT_S, { tier: 'ace', speed: DODGE_SPEED, incoming: [markedAhead(2)] }),
    );
    expect({ left: left.turnLeft, right: left.turnRight }).toEqual({ left: false, right: true });
    expect({ left: right.turnLeft, right: right.turnRight }).toEqual({ left: true, right: false });
  });

  it('ignores a marker this machine was never going to be standing on', () => {
    const wide = markedAhead(40);
    const out = driveMortarOverdrive(
      at(START_STRAIGHT_S, { tier: 'ace', speed: DODGE_SPEED, incoming: [wide] }),
    );
    expect(out.turnLeft || out.turnRight).toBe(false);
  });

  it('ignores a marker still further out than the tier can read', () => {
    const early: MortarOverdriveDriverBlast = {
      ...markedAhead(),
      ticksToImpact: mortarOverdriveDriverProfile('driver').dodgeLeadTicks + 1,
    };
    const out = driveMortarOverdrive(
      at(START_STRAIGHT_S, { tier: 'driver', speed: DODGE_SPEED, incoming: [early] }),
    );
    expect(out.turnLeft || out.turnRight).toBe(false);
  });
});

describe('Mortar Overdrive driver: purity', () => {
  it('returns byte-identical output for identical input', () => {
    const input = at(HAIRPIN_S - 20, { tier: 'ace', speed: 44, lateral: 2.5, tick: 137 });
    expect(driveMortarOverdrive(input)).toEqual(driveMortarOverdrive(input));
  });

  it('reads no clock and draws no randomness', () => {
    const src = readFileSync(
      new URL('../src/sim/mortar_overdrive/driver.ts', import.meta.url),
      'utf8',
    );
    for (const banned of ['Math.random', 'Date.now', 'performance.now', 'new Date(']) {
      expect(src, banned).not.toContain(banned);
    }
    // And it imports only the track model, the weapon's own aim rules, and the
    // shared numeric helpers: an rng or a SimContext would make the bot a source
    // of draw-order drift.
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(['../types', './ground_blast', './spline']);
  });

  it('exposes a profile for every tier', () => {
    for (const tier of MORTAR_OVERDRIVE_DRIVER_TIERS) {
      const profile = mortarOverdriveDriverProfile(tier);
      expect(profile.speedFraction, tier).toBeGreaterThan(0);
      expect(profile.speedFraction, tier).toBeLessThanOrEqual(1);
    }
    expect(mortarOverdriveDriverProfile('rookie').speedFraction).toBeLessThan(
      mortarOverdriveDriverProfile('ace').speedFraction,
    );
  });
});
