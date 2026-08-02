// The Realm Racers driving brain, driven directly with no Sim: it is a pure
// leaf over the shared track model, so every claim here is checkable in plain
// numbers. What it must get right is the racing line's SIGN convention (shared
// with the projection's `lateral`, and invisible to an eye watching a bot drive
// past), braking BEFORE a corner rather than in it, recovering from a machine
// that is lost or wedged, and the tier separation that makes a rookie beatable.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REALM_RACERS_PRACTICE_CIRCUIT as GARDEN_CIRCUIT } from '../src/sim/content/realm_racers_circuits';
import {
  driveRealmRacers,
  RALLY_DRIVER_TIERS,
  type RallyDriverBlast,
  type RallyDriverInput,
  type RallyDriverTier,
  rallyDriverProfile,
  rallyRacingLineOffset,
} from '../src/sim/realm_racers_driver';
import { realmRacersTrack } from '../src/sim/realm_racers_spline';

const TOP_SPEED = 60;
/** Arc positions read off the real circuit: the start/finish straight, the fast
 *  sweeper onto the north straight, and the hairpin (its tightest corner). */
const START_STRAIGHT_S = 5;
const SWEEPER_S = 120;
const HAIRPIN_S = 340;

interface Placement {
  /** Signed offset from the centerline along the left normal (the infield side). */
  lateral?: number;
  /** Radians added to the tangent heading; 0 points straight down the circuit. */
  heading?: number;
  speed?: number;
  slip?: number;
  tier?: RallyDriverTier;
  rival?: { x: number; z: number; vx?: number; vz?: number } | null;
  incoming?: RallyDriverBlast[];
  weaponReady?: boolean;
  tick?: number;
  pid?: number;
}

/** Put a machine on the circuit at arc position `s` and build the brain's input. */
function at(s: number, place: Placement = {}): RallyDriverInput {
  const track = realmRacersTrack(GARDEN_CIRCUIT);
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
    track,
    projection: track.project(x, z),
    topSpeed: TOP_SPEED,
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
  const p = realmRacersTrack(GARDEN_CIRCUIT).pointAt(s);
  return { x: p.x - p.tz * lateral, z: p.z + p.tx * lateral };
}

describe('Realm Racers driver: holding the line', () => {
  it('asks for no steering on the start straight, centred and aligned', () => {
    for (const tier of RALLY_DRIVER_TIERS) {
      const out = driveRealmRacers(at(START_STRAIGHT_S, { tier, speed: 40 }));
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
    const infield = driveRealmRacers(at(START_STRAIGHT_S, { lateral: 5, speed: 30 }));
    expect({ left: infield.turnLeft, right: infield.turnRight }).toEqual({
      left: true,
      right: false,
    });
    const outfield = driveRealmRacers(at(START_STRAIGHT_S, { lateral: -5, speed: 30 }));
    expect({ left: outfield.turnLeft, right: outfield.turnRight }).toEqual({
      left: false,
      right: true,
    });
  });

  it('runs the racing line to the INSIDE of a corner and not the outside', () => {
    // The circuit's turnRadius is positive where it bends toward the infield,
    // and `lateral` is positive on that same side, so an inside apex carries the
    // radius's sign. Getting this backwards apexes every corner on its outside.
    const track = realmRacersTrack(GARDEN_CIRCUIT);
    let checked = 0;
    for (let s = 0; s < track.length; s += 5) {
      const radius = track.pointAt(s).turnRadius;
      if (!Number.isFinite(radius) || Math.abs(radius) > 50) continue;
      const offset = rallyRacingLineOffset(track, s);
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
    expect(rallyRacingLineOffset(realmRacersTrack(GARDEN_CIRCUIT), START_STRAIGHT_S)).toBe(0);
  });
});

describe('Realm Racers driver: speed', () => {
  it('brakes BEFORE the hairpin, not in it', () => {
    const straight = driveRealmRacers(at(START_STRAIGHT_S, { tier: 'ace', speed: 55 }));
    const approach = driveRealmRacers(at(HAIRPIN_S - 40, { tier: 'ace', speed: 55 }));
    const apex = driveRealmRacers(at(HAIRPIN_S, { tier: 'ace', speed: 55 }));
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
    const out = driveRealmRacers(at(START_STRAIGHT_S, { tier: 'ace', speed: 50 }));
    expect(out.back).toBe(false);
    expect(out.forward).toBe(true);
  });

  it('never lets a gentler tier out-drive a harder one, anywhere on the lap', () => {
    const track = realmRacersTrack(GARDEN_CIRCUIT);
    let strictlySlower = 0;
    for (let s = 0; s < track.length; s += 5) {
      const targets = RALLY_DRIVER_TIERS.map(
        (tier) => driveRealmRacers(at(s, { tier, speed: 40 })).speedTarget,
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
    expect(driveRealmRacers(at(HAIRPIN_S, { ...hard, tier: 'rookie' })).handbrake).toBe(false);
    expect(driveRealmRacers(at(HAIRPIN_S, { ...hard, tier: 'ace' })).handbrake).toBe(true);
    // Crawling, the handbrake only spins the machine, so it stays off.
    expect(driveRealmRacers(at(HAIRPIN_S, { heading: 1.2, speed: 5, tier: 'ace' })).handbrake).toBe(
      false,
    );
  });
});

describe('Realm Racers driver: recovery', () => {
  it('turns a machine that is pointing back up the circuit around', () => {
    const out = driveRealmRacers(at(SWEEPER_S, { heading: Math.PI, speed: 12 }));
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
      driveRealmRacers(at(SWEEPER_S, { lateral: 24, heading: 1.4, speed: 0.2, tick }));
    const first = wedged(0);
    const later = wedged(12);
    expect(first.mode).toBe('unstick');
    expect(later.mode).toBe('unstick');
    expect(first.forward).not.toBe(later.forward);
    expect(first.back).not.toBe(later.back);
    for (const out of [first, later]) expect(out.turnLeft || out.turnRight).toBe(true);
  });

  it('steers a machine out in the garden back toward the road while it still rolls', () => {
    // Wide but pointing the right way and still moving: that is ordinary racing
    // with a penalty, not a recovery, and the racing line brings it back. Out
    // toward the infield (positive lateral, the pilot's right), so the
    // correction is a left-hand one.
    const out = driveRealmRacers(at(SWEEPER_S, { lateral: 24, speed: 18 }));
    expect(out.mode).toBe('race');
    expect({ left: out.turnLeft, right: out.turnRight }).toEqual({ left: true, right: false });
  });
});

describe('Realm Racers driver: the weapon', () => {
  const shotOn = (place: Placement) =>
    driveRealmRacers(at(START_STRAIGHT_S, { weaponReady: true, speed: 30, ...place })).fire;

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
    const counts = new Map<RallyDriverTier, number>();
    for (const tier of RALLY_DRIVER_TIERS) {
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

describe('Realm Racers driver: the dodge', () => {
  /** A shell marked to land where this machine is heading. At 30 yd/s over ten
   *  ticks it covers 15 yards, so the marker sits right on its nose. */
  const DODGE_SPEED = 30;
  const DODGE_TICKS = 10;

  function markedAhead(offset = 0): RallyDriverBlast {
    const flight = DODGE_TICKS / 20;
    const here = realmRacersTrack(GARDEN_CIRCUIT).pointAt(START_STRAIGHT_S);
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
    const clean = driveRealmRacers(at(START_STRAIGHT_S, { tier: 'ace', speed: DODGE_SPEED }));
    expect(clean.turnLeft || clean.turnRight).toBe(false);
    const ace = driveRealmRacers(
      at(START_STRAIGHT_S, { tier: 'ace', speed: DODGE_SPEED, incoming }),
    );
    expect(ace.turnLeft || ace.turnRight).toBe(true);
    const rookie = driveRealmRacers(
      at(START_STRAIGHT_S, { tier: 'rookie', speed: DODGE_SPEED, incoming }),
    );
    expect(rookie.turnLeft || rookie.turnRight).toBe(false);
  });

  it('steps off the side the marker is not on', () => {
    // Marked a little to the pilot's left (the spline normal is their RIGHT, so
    // a negative offset is left): the escape must go the other way.
    const left = driveRealmRacers(
      at(START_STRAIGHT_S, { tier: 'ace', speed: DODGE_SPEED, incoming: [markedAhead(-2)] }),
    );
    const right = driveRealmRacers(
      at(START_STRAIGHT_S, { tier: 'ace', speed: DODGE_SPEED, incoming: [markedAhead(2)] }),
    );
    expect({ left: left.turnLeft, right: left.turnRight }).toEqual({ left: false, right: true });
    expect({ left: right.turnLeft, right: right.turnRight }).toEqual({ left: true, right: false });
  });

  it('ignores a marker this machine was never going to be standing on', () => {
    const wide = markedAhead(40);
    const out = driveRealmRacers(
      at(START_STRAIGHT_S, { tier: 'ace', speed: DODGE_SPEED, incoming: [wide] }),
    );
    expect(out.turnLeft || out.turnRight).toBe(false);
  });

  it('ignores a marker still further out than the tier can read', () => {
    const early: RallyDriverBlast = {
      ...markedAhead(),
      ticksToImpact: rallyDriverProfile('driver').dodgeLeadTicks + 1,
    };
    const out = driveRealmRacers(
      at(START_STRAIGHT_S, { tier: 'driver', speed: DODGE_SPEED, incoming: [early] }),
    );
    expect(out.turnLeft || out.turnRight).toBe(false);
  });
});

describe('Realm Racers driver: purity', () => {
  it('returns byte-identical output for identical input', () => {
    const input = at(HAIRPIN_S - 20, { tier: 'ace', speed: 44, lateral: 2.5, tick: 137 });
    expect(driveRealmRacers(input)).toEqual(driveRealmRacers(input));
  });

  it('reads no clock and draws no randomness', () => {
    const src = readFileSync(new URL('../src/sim/realm_racers_driver.ts', import.meta.url), 'utf8');
    for (const banned of ['Math.random', 'Date.now', 'performance.now', 'new Date(']) {
      expect(src, banned).not.toContain(banned);
    }
    // And it imports only the track model, the weapon's own aim rules, and the
    // shared numeric helpers: an rng or a SimContext would make the bot a source
    // of draw-order drift.
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(['./realm_racers_ground_blast', './realm_racers_spline', './types']);
  });

  it('exposes a profile for every tier', () => {
    for (const tier of RALLY_DRIVER_TIERS) {
      const profile = rallyDriverProfile(tier);
      expect(profile.speedFraction, tier).toBeGreaterThan(0);
      expect(profile.speedFraction, tier).toBeLessThanOrEqual(1);
    }
    expect(rallyDriverProfile('rookie').speedFraction).toBeLessThan(
      rallyDriverProfile('ace').speedFraction,
    );
  });
});
