import { describe, expect, it } from 'vitest';
import {
  RALLY_SLICK_FADE_SECONDS,
  RALLY_SLICK_POOL,
  rallyProvisionalSlickState,
  rallySlickInitialVisual,
  rallySlickListSame,
  rallySlickScale,
  rallySlickSheenSpin,
  rallySlickVisible,
  stepRallySlickVisual,
} from '../src/render/realm_racers_slicks_core';
import { REALM_RACERS_SLICK_ABILITY_ID } from '../src/sim/content/realm_racers';
import {
  REALM_RACERS_PRACTICE_CIRCUIT,
  realmRacersCompetitionCircuits,
} from '../src/sim/content/realm_racers_circuits';
import { vehicleProfile } from '../src/sim/content/vehicles';
import { realmRacersPickupBoxes } from '../src/sim/realm_racers_pickups';
import {
  type RallySlick,
  type RallySlickThrowInput,
  REALM_RACERS_SLICK_CAP,
  REALM_RACERS_SLICK_GRIP,
  REALM_RACERS_SLICK_GRIP_TICKS,
  REALM_RACERS_SLICK_LIFETIME_TICKS,
  REALM_RACERS_SLICK_PUSH,
  REALM_RACERS_SLICK_PUSH_SLIP_FLOOR,
  REALM_RACERS_SLICK_RADIUS,
  REALM_RACERS_SLICK_SLIP_CAP,
  realmRacersSlickThrow,
  stepRealmRacersSlicks,
} from '../src/sim/realm_racers_slicks';
import { realmRacersTrack } from '../src/sim/realm_racers_spline';
import type { Sim } from '../src/sim/sim';
import {
  REALM_RACERS_AUTO_RECOVERY_LOCK_TICKS,
  REALM_RACERS_COUNTDOWN_TICKS,
  REALM_RACERS_STUCK_TICKS,
  REALM_RACERS_VEHICLE_KEY,
  REALM_RACERS_WARD_AURA,
  REALM_RACERS_WARD_AURA_SECONDS,
  realmRacersForfeit,
  realmRacersSpendPickupEffect,
  realmRacersStartMatch,
  realmRacersToWorld,
  realmRacersWarded,
  updateRealmRacers,
} from '../src/sim/social/realm_racers';
import { startRealmRacersPractice } from '../src/sim/social/realm_racers_bots';
import { installScriptedRng, rallyPickupRollFor } from './helpers/realm_racers_rng';
import { addAt, makeWorld, teleport } from './realm_racers_util';

const RACE_CIRCUIT = realmRacersCompetitionCircuits()[0];

const GRID = [
  { cls: 'warrior', name: 'Aster', x: -5, z: -40 },
  { cls: 'mage', name: 'Briar', x: 7, z: -42 },
  { cls: 'rogue', name: 'Cass', x: -9, z: -38 },
  { cls: 'priest', name: 'Dell', x: 11, z: -44 },
] as const;

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${label}`);
  return value;
}

function match(sim: Sim): NonNullable<Sim['realmRacers']['match']> {
  return required(sim.realmRacers.match, 'Realm Racers match');
}

function racingGrid(): { sim: Sim; pids: number[] } {
  const sim = makeWorld();
  const pids = GRID.map((row) => addAt(sim, row.cls, row.name, row.x, row.z));
  // Seated on the NAMED circuit rather than through the queue's draw: the pool
  // holds more than one competition circuit, and the geometry below is this
  // one's road.
  expect(realmRacersStartMatch(sim.ctx, pids, undefined, RACE_CIRCUIT.id)).toBe(true);
  sim.tick();
  for (let i = 0; i < REALM_RACERS_COUNTDOWN_TICKS; i++) sim.tick();
  expect(match(sim).phase).toBe('racing');
  expect(match(sim).circuitId).toBe(RACE_CIRCUIT.id);
  return { sim, pids };
}

/** Parks a machine on a circuit-local point, with the lap bookkeeping a machine
 *  that drove there would carry. */
function standAt(sim: Sim, pid: number, x: number, z: number): void {
  const live = match(sim);
  const world = realmRacersToWorld(live, x, z);
  teleport(sim, pid, world.x, world.z);
  const progress = required(live.progress.get(pid), `progress ${pid}`);
  const projection = realmRacersTrack(RACE_CIRCUIT).project(x, z, progress.trackIndex);
  progress.lastS = projection.s;
  progress.trackIndex = projection.index;
}

/** Parks a machine ON the road at a lap position, which is where a machine that
 *  has driven clear of a patch really is (a raw point 40 yards to the side is in
 *  the garden, and the garden has its own grip penalty). */
function standOnCenterline(sim: Sim, pid: number, s: number): void {
  const point = realmRacersTrack(RACE_CIRCUIT).pointAt(s);
  standAt(sim, pid, point.x, point.z);
}

/**
 * Have `pid` take a box, draw the OIL, and spend it where they are standing.
 *
 * Two steps since the operator's mid-review override: the box fills a held slot
 * and the CAST is what puts the patch on the road, under the machine.
 */
function dropSlickAt(sim: Sim, pid: number, x: number, z: number, box = 0): RallySlick {
  const rng = installScriptedRng(sim);
  rng.script(rallyPickupRollFor('leader', 'slick'));
  const point = realmRacersPickupBoxes(RACE_CIRCUIT)[box];
  standAt(sim, pid, point.x, point.z);
  sim.tick();
  expect(rng.consumed).toBe(1);
  expect(required(match(sim).progress.get(pid), 'progress').heldEffect).toBe('slick');
  standAt(sim, pid, x, z);
  sim.castAbility(REALM_RACERS_SLICK_ABILITY_ID, pid);
  const dropped = match(sim).slicks.at(-1);
  return required(dropped, 'slick');
}

describe('the oil slick step, on its own', () => {
  const slickAt = (id: number, x: number, ownerPid: number, ownerClear = false): RallySlick => ({
    id,
    x,
    z: 0,
    ownerPid,
    ownerClear,
    expiresTick: 100,
  });
  const racer = (pid: number, x: number, overrides = {}) => ({
    pid,
    fromX: x,
    fromZ: 0,
    toX: x,
    toZ: 0,
    eligible: true,
    ...overrides,
  });

  it('catches a rival and spares the machine still standing in its own oil', () => {
    const slicks = [slickAt(1, 0, 7)];
    const step = stepRealmRacersSlicks(slicks, {
      tick: 0,
      racers: [racer(7, 0), racer(8, 0)],
    });
    // The dropper is untouched while they have not left the patch, which is the
    // whole of what the immunity is for: the oil goes down under them.
    expect(step.hits).toEqual([{ pid: 8, slick: 1, x: 0, z: 0 }]);
    expect(slicks[0].ownerClear).toBe(false);
    // And it is not consumed by the machine that hit it.
    expect(slicks).toHaveLength(1);
  });

  it('arms a patch against its own dropper once they have driven clear of it', () => {
    const slicks = [slickAt(1, 0, 7)];
    // Still inside the radius: nothing arms, nothing bites.
    stepRealmRacersSlicks(slicks, {
      tick: 0,
      racers: [racer(7, REALM_RACERS_SLICK_RADIUS - 0.01)],
    });
    expect(slicks[0].ownerClear).toBe(false);
    // Out the far side: armed, and still not a hit on the tick it armed.
    const leaving = stepRealmRacersSlicks(slicks, {
      tick: 1,
      racers: [racer(7, REALM_RACERS_SLICK_RADIUS + 0.01)],
    });
    expect(slicks[0].ownerClear).toBe(true);
    expect(leaving.hits).toEqual([]);
    // Driving back into it is now an ordinary crossing.
    const returning = stepRealmRacersSlicks(slicks, { tick: 2, racers: [racer(7, 0)] });
    expect(returning.hits).toEqual([{ pid: 7, slick: 1, x: 0, z: 0 }]);
  });

  it('arms the owner off where the machine ENDED the tick, not the ground it drove', () => {
    // The swept segment from inside the patch to well outside it still touches
    // the patch, so a swept arming test would hold the immunity open forever and
    // the owner would never be catchable. The distinction is invisible in a
    // single-point test, which is why it has one of its own.
    const slicks = [slickAt(1, 0, 7)];
    stepRealmRacersSlicks(slicks, {
      tick: 0,
      racers: [racer(7, 0, { fromX: 0, toX: REALM_RACERS_SLICK_RADIUS * 4 })],
    });
    expect(slicks[0].ownerClear).toBe(true);
  });

  it("keeps one dropper's patches armed independently of each other", () => {
    // A pilot standing in the slick they just laid, with an older one of their
    // own three corners back: the new one is still theirs to stand in and the
    // old one is armed, so the flag has to be per PATCH.
    const fresh = slickAt(2, 0, 7);
    const old = slickAt(1, 40, 7, true);
    const step = stepRealmRacersSlicks([old, fresh], { tick: 0, racers: [racer(7, 0)] });
    expect(step.hits).toEqual([]);
    expect(fresh.ownerClear).toBe(false);
    expect(old.ownerClear).toBe(true);
  });

  it("arms the owner's patch even while they are not eligible to be caught", () => {
    // A machine the referee has just PUT somewhere is skipped for hits, but it
    // has still left the patch: without this the immunity would survive the
    // recovery that moved them and the patch would be safe for them forever.
    const slicks = [slickAt(1, 0, 7)];
    stepRealmRacersSlicks(slicks, {
      tick: 0,
      racers: [racer(7, REALM_RACERS_SLICK_RADIUS + 0.01, { eligible: false })],
    });
    expect(slicks[0].ownerClear).toBe(true);
  });

  it('catches a machine that drove THROUGH one between two ticks', () => {
    const slicks = [slickAt(1, 0, 7)];
    const step = stepRealmRacersSlicks(slicks, {
      tick: 0,
      racers: [racer(8, 0, { fromX: -20, toX: 20 })],
    });
    // Forty yards in one tick with neither end in the patch: only the swept
    // segment can see this.
    expect(step.hits).toEqual([{ pid: 8, slick: 1, x: 0, z: 0 }]);
  });

  it('measures the patch by its own radius', () => {
    const slicks = [slickAt(1, 0, 7)];
    const clear = stepRealmRacersSlicks(slicks, {
      tick: 0,
      racers: [racer(8, REALM_RACERS_SLICK_RADIUS + 0.01)],
    });
    expect(clear.hits).toEqual([]);
    const inside = stepRealmRacersSlicks(slicks, {
      tick: 0,
      racers: [racer(8, REALM_RACERS_SLICK_RADIUS - 0.01)],
    });
    expect(inside.hits).toEqual([{ pid: 8, slick: 1, x: 0, z: 0 }]);
  });

  it('hands over ONE grip loss where two patches overlap', () => {
    const slicks = [slickAt(1, 0, 7), slickAt(2, 1, 7)];
    const step = stepRealmRacersSlicks(slicks, { tick: 0, racers: [racer(8, 0.9)] });
    // The nearest one, so two puddles a machine straddles are still one hit.
    expect(step.hits).toEqual([{ pid: 8, slick: 2, x: 1, z: 0 }]);
  });

  it('offers nothing to a machine that is not driving', () => {
    const slicks = [slickAt(1, 0, 7)];
    const step = stepRealmRacersSlicks(slicks, {
      tick: 0,
      racers: [racer(8, 0, { eligible: false })],
    });
    expect(step.hits).toEqual([]);
  });

  it('sweeps a patch off the circuit when its lifetime is up', () => {
    const slicks = [slickAt(1, 0, 7)];
    const alive = stepRealmRacersSlicks(slicks, { tick: 99, racers: [racer(8, 0)] });
    expect(alive.expired).toBe(false);
    expect(alive.hits).toHaveLength(1);
    const gone = stepRealmRacersSlicks(slicks, { tick: 100, racers: [racer(8, 0)] });
    expect(gone.expired).toBe(true);
    expect(gone.hits).toEqual([]);
    expect(slicks).toEqual([]);
  });

  it('reports a machine PARKED in the oil on every tick it stays there', () => {
    // The leaf's half of the one-crossing-one-window rule: it answers honestly
    // (the machine really is still in the puddle) every tick, and the match
    // module is what decides a repeat means nothing. Without this the in-race
    // case below could pass on a leaf that had simply stopped reporting.
    const slicks = [slickAt(1, 0, 7)];
    for (let tick = 0; tick < 5; tick++) {
      expect(stepRealmRacersSlicks(slicks, { tick, racers: [racer(8, 0)] }).hits).toEqual([
        { pid: 8, slick: 1, x: 0, z: 0 },
      ]);
    }
  });

  it('pins the shipped tuning to literals', () => {
    // The twin of the pin in the effects suite, repeated HERE on purpose: a
    // cross-file pin unpins itself the day a suite is split or renamed, and
    // these four numbers are the whole feel of the hazard.
    expect(REALM_RACERS_SLICK_RADIUS).toBe(2.6);
    expect(REALM_RACERS_SLICK_LIFETIME_TICKS).toBe(240);
    expect(REALM_RACERS_SLICK_GRIP_TICKS).toBe(30);
    expect(REALM_RACERS_SLICK_GRIP).toBe(0.15);
    expect(REALM_RACERS_SLICK_CAP).toBe(16);
    expect(REALM_RACERS_SLICK_PUSH).toBe(12);
    expect(REALM_RACERS_SLICK_PUSH_SLIP_FLOOR).toBe(1.5);
    expect(REALM_RACERS_SLICK_SLIP_CAP).toBe(2);
    // Under the loaner's own slide ceiling, which is the load-bearing one: a
    // push over `maxSlip` would be silently rewritten by the kernel's grounded
    // clamp, so the shove a pilot feels would stop being the shove chosen here.
    expect(REALM_RACERS_SLICK_PUSH).toBeLessThanOrEqual(
      vehicleProfile(REALM_RACERS_VEHICLE_KEY).maxSlip,
    );
    // And the drawn pool is at least the cap, which is what makes "what bites is
    // what you can see" structural rather than a coincidence of two constants.
    expect(RALLY_SLICK_POOL).toBe(16);
    expect(RALLY_SLICK_POOL).toBeGreaterThanOrEqual(REALM_RACERS_SLICK_CAP);
  });
});

describe('the throw the oil puts into a machine', () => {
  /** A crossing dead through the middle of the patch, pointing along +z. */
  const crossing = (overrides: Partial<RallySlickThrowInput> = {}): RallySlickThrowInput => ({
    slip: 0,
    forwardSpeed: 60,
    topSpeed: 60,
    facing: 0,
    x: 0,
    z: 0,
    slickX: 0,
    slickZ: 0,
    slickId: 1,
    pid: 7,
    ...overrides,
  });

  /**
   * How far the throw carries the machine AWAY from the patch, yards per second.
   *
   * The rule this weapon is written to, stated in world terms rather than as a
   * sign convention: the push rides the body's right vector (-cos f, sin f), so
   * projecting it onto the offset from the patch says whether the machine is
   * thrown off the edge it clipped or dragged back across the oil. A test that
   * pinned the SIGN instead would pass just as happily on a machine sucked into
   * the puddle, which is the mistake worth catching here.
   */
  const awayFromPatch = (input: RallySlickThrowInput): number => {
    const { push } = realmRacersSlickThrow(input);
    const rx = -Math.cos(input.facing);
    const rz = Math.sin(input.facing);
    const dx = input.x - input.slickX;
    const dz = input.z - input.slickZ;
    const gap = Math.hypot(dx, dz) || 1;
    return (push * rx * dx) / gap + (push * rz * dz) / gap;
  };

  it('follows the slide a machine already has', () => {
    // The chosen rule: the oil takes the end that was already going. The push
    // shares its axis with `slip`, so amplifying is simply same-signed.
    expect(realmRacersSlickThrow(crossing({ slip: 4 })).push).toBeGreaterThan(0);
    expect(realmRacersSlickThrow(crossing({ slip: -4 })).push).toBeLessThan(0);
  });

  it('throws a machine crossing dead straight just as hard', () => {
    // The whole point of the push: this is the case grip alone cannot touch (no
    // lateral velocity means nothing for grip to take), so a magnitude that fell
    // away with the slide would leave the straight-line crossing free again.
    const sliding = realmRacersSlickThrow(crossing({ slip: 4 }));
    const straight = realmRacersSlickThrow(crossing({ slip: 0 }));
    expect(Math.abs(straight.push)).toBeCloseTo(Math.abs(sliding.push), 9);
    expect(Math.abs(straight.push)).toBeGreaterThan(0);
  });

  it('scales with how fast the machine crossed, and stops at the ceiling', () => {
    expect(realmRacersSlickThrow(crossing({ forwardSpeed: 60 })).strength).toBeCloseTo(1, 9);
    expect(Math.abs(realmRacersSlickThrow(crossing({ forwardSpeed: 60 })).push)).toBeCloseTo(
      REALM_RACERS_SLICK_PUSH,
      9,
    );
    const half = realmRacersSlickThrow(crossing({ forwardSpeed: 30 }));
    expect(half.strength).toBeCloseTo(0.5, 9);
    expect(Math.abs(half.push)).toBeCloseTo(REALM_RACERS_SLICK_PUSH / 2, 9);
    // Over the profile's own maximum (a nitro burst) it is still one crossing.
    expect(realmRacersSlickThrow(crossing({ forwardSpeed: 200 })).strength).toBe(1);
    // And a machine that is not moving is not thrown by a puddle.
    expect(realmRacersSlickThrow(crossing({ forwardSpeed: 0 }))).toEqual({ push: 0, strength: 0 });
  });

  it('throws a machine off the edge it clipped when there is no slide to follow', () => {
    // Below the slip floor the geometry decides, and it has to send the machine
    // AWAY on whichever side it went by: the two sides disagree about the sign
    // (which a hash-only answer could not do) and agree about the direction.
    const nudge = REALM_RACERS_SLICK_PUSH_SLIP_FLOOR - 0.01;
    const right = realmRacersSlickThrow(crossing({ slip: nudge, x: 2 })).push;
    const left = realmRacersSlickThrow(crossing({ slip: nudge, x: -2 })).push;
    expect(Math.sign(right)).toBe(-Math.sign(left));
    expect(awayFromPatch(crossing({ slip: nudge, x: 2 }))).toBeGreaterThan(0);
    expect(awayFromPatch(crossing({ slip: nudge, x: -2 }))).toBeGreaterThan(0);
    // Facing down the other axis too, or the projection above would agree with a
    // formula that had simply confused x for z.
    const east = Math.PI / 2;
    expect(awayFromPatch(crossing({ slip: nudge, facing: east, z: 2 }))).toBeGreaterThan(0);
    expect(awayFromPatch(crossing({ slip: nudge, facing: east, z: -2 }))).toBeGreaterThan(0);
  });

  it('still throws a crossing with nothing left to read, and the same way twice', () => {
    // Dead straight through the dead centre: no slide, no side. The hash is what
    // keeps this from being the one free crossing on the circuit, and it has to
    // answer identically on every host, so the same pair is the same answer.
    const centred = crossing();
    expect(realmRacersSlickThrow(centred).push).toBe(realmRacersSlickThrow(centred).push);
    expect(Math.abs(realmRacersSlickThrow(centred).push)).toBeCloseTo(REALM_RACERS_SLICK_PUSH, 9);
    // And it is a hash rather than a constant: both directions come out of the
    // space of (patch, pilot) pairs a race really produces.
    const signs = new Set<number>();
    for (let slickId = 1; slickId <= 16; slickId++) {
      for (let pid = 1; pid <= 4; pid++) {
        signs.add(Math.sign(realmRacersSlickThrow(crossing({ slickId, pid })).push));
      }
    }
    expect([...signs].sort()).toEqual([-1, 1]);
  });
});

describe('oil slicks, in a race', () => {
  it('takes the grip off a rival and leaves the dropper alone', () => {
    const { sim, pids } = racingGrid();
    const [dropper, rival] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    const point = track.pointAt(track.length * 0.25);
    const slick = dropSlickAt(sim, dropper, point.x, point.z);

    standAt(sim, rival, slick.x, slick.z);
    sim.tick();
    const rivalProgress = required(match(sim).progress.get(rival), 'rival progress');
    const dropperProgress = required(match(sim).progress.get(dropper), 'dropper progress');
    expect(rivalProgress.slickGripUntilTick).toBe(sim.tickCount + REALM_RACERS_SLICK_GRIP_TICKS);
    // The dropper is standing in it too (they spent it under themselves) and
    // keeps every bit of grip they had.
    expect(dropperProgress.slickGripUntilTick).toBe(0);

    // The surface pass runs before the hit inside a tick, so the grip lands on
    // the next one: the same tick of lag every surface fact in the rally has.
    sim.tick();
    const rivalDrive = required(sim.entities.get(rival)?.drive, 'rival drive');
    const dropperDrive = required(sim.entities.get(dropper)?.drive, 'dropper drive');
    expect(rivalDrive.gripMult).toBeCloseTo(REALM_RACERS_SLICK_GRIP, 9);
    expect(dropperDrive.gripMult).toBe(1);

    // And it wears off on its own clock once the machine is out of the oil.
    standOnCenterline(sim, rival, track.length * 0.5);
    while (sim.tickCount <= rivalProgress.slickGripUntilTick) sim.tick();
    sim.tick();
    expect(rivalDrive.gripMult).toBe(1);
  });

  it('slides a rival who crosses it, without touching the wheel, and says so', () => {
    const { sim, pids } = racingGrid();
    const [dropper, rival] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    const point = track.pointAt(track.length * 0.25);
    const slick = dropSlickAt(sim, dropper, point.x, point.z);

    standAt(sim, rival, slick.x, slick.z);
    // A parked machine is not crossing anything: the throw follows the speed, so
    // the drive state has to carry one for this to be the case it claims to be.
    const rivalDrive = required(sim.entities.get(rival)?.drive, 'rival drive');
    rivalDrive.speed = 40;
    rivalDrive.slip = 4;
    rivalDrive.spin = 0;
    const events = sim.tick();
    // The machine leaves with a great deal more sideways than it arrived with,
    // the same way it was already going: the oil takes the end that was going.
    // Read after the tick, so the kernel's own step is already in it.
    expect(rivalDrive.slip).toBeGreaterThan(10);
    expect(rivalDrive.slip).toBeLessThanOrEqual(vehicleProfile(REALM_RACERS_VEHICLE_KEY).maxSlip);
    // And it is a SLIDE, not a steering input: the oil never touches the yaw, so
    // the nose still points where the pilot aimed it while the machine leaves
    // the line. This is the one assertion that separates the shipped feel from
    // the version that read as the wheel being yanked out of the pilot's hands.
    expect(rivalDrive.spin).toBe(0);
    expect(events.filter((event) => event.type === 'realmRacersSlicked')).toMatchObject([
      { targetId: rival, impact: expect.any(Number) },
    ]);
  });

  it('lands the whole shove on a machine already at its slide ceiling', () => {
    // The regression that made the weapon feel inert: a pilot attacking a corner
    // sits AT `maxSlip` (measured over a real ace lap: 14.0 on one cornering
    // tick in ten, 13.4 at the third quartile), so a same-side shove was clamped
    // to nothing exactly against the machines worth shoving. The oil raises the
    // ceiling instead, which no value of `_PUSH` could ever have done.
    const { sim, pids } = racingGrid();
    const [dropper, rival] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    const point = track.pointAt(track.length * 0.25);
    const slick = dropSlickAt(sim, dropper, point.x, point.z);
    const tarmac = vehicleProfile(REALM_RACERS_VEHICLE_KEY).maxSlip;

    standAt(sim, rival, slick.x, slick.z);
    const rivalDrive = required(sim.entities.get(rival)?.drive, 'rival drive');
    rivalDrive.speed = 40;
    rivalDrive.slip = tarmac; // pinned to the road's ceiling, like a real corner
    sim.tick();

    // Past what the road itself allows, which is the whole claim.
    expect(rivalDrive.slip).toBeGreaterThan(tarmac);
    expect(rivalDrive.slipCap).toBe(2);
    expect(rivalDrive.slip).toBeLessThanOrEqual(tarmac * REALM_RACERS_SLICK_SLIP_CAP);

    // And the road takes its ceiling back when the oil lets go, or a machine
    // would keep an off-road slide budget for the rest of the race.
    const progress = required(match(sim).progress.get(rival), 'rival progress');
    standOnCenterline(sim, rival, track.length * 0.5);
    while (sim.tickCount <= progress.slickGripUntilTick) sim.tick();
    sim.tick();
    expect(rivalDrive.slipCap).toBe(1);
    expect(Math.abs(rivalDrive.slip)).toBeLessThanOrEqual(tarmac);
  });

  it('does not let lingering in one patch buy a free pass through the next', () => {
    // The contact deadline follows the patch, not the racer. Keyed on the racer
    // it would have meant a machine sitting in one slick was immune to every
    // OTHER slick for as long as it sat there, which on a chicane seeded with
    // two patches turns the second one off.
    const { sim, pids } = racingGrid();
    const [dropper, rival] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    const near = track.pointAt(track.length * 0.25);
    const first = dropSlickAt(sim, dropper, near.x, near.z);
    // The second patch is placed directly rather than drawn from a box: two
    // takes in one race need a respawn between them, and what is under test is
    // the contact rule, not the pickup lifecycle.
    const live = match(sim);
    const far = track.pointAt(track.length * 0.5);
    const second: RallySlick = {
      id: live.nextSlickId++,
      x: far.x,
      z: far.z,
      ownerPid: dropper,
      ownerClear: true,
      expiresTick: sim.tickCount + REALM_RACERS_SLICK_LIFETIME_TICKS,
    };
    live.slicks.push(second);
    expect(second.id).not.toBe(first.id);
    const progress = required(live.progress.get(rival), 'rival progress');
    const rivalDrive = required(sim.entities.get(rival)?.drive, 'rival drive');

    // Parked in the first patch, well inside the window it keeps refreshing.
    standAt(sim, rival, first.x, first.z);
    rivalDrive.speed = 40;
    sim.tick();
    expect(progress.slickContactId).toBe(first.id);
    const armed = progress.slickGripUntilTick;
    standAt(sim, rival, first.x, first.z);
    sim.tick();
    standAt(sim, rival, first.x, first.z);
    sim.tick();
    expect(progress.slickGripUntilTick).toBe(armed); // still one crossing

    // Straight into the OTHER patch, with the first one's deadline still open:
    // a different patch is a different crossing.
    standAt(sim, rival, second.x, second.z);
    rivalDrive.speed = 40;
    const events = sim.tick();
    expect(progress.slickContactId).toBe(second.id);
    expect(progress.slickGripUntilTick).toBe(sim.tickCount + REALM_RACERS_SLICK_GRIP_TICKS);
    expect(events.filter((event) => event.type === 'realmRacersSlicked')).toHaveLength(1);
  });

  it('reads two overlapping patches under one machine as one crossing', () => {
    // Two rivals oil the same corner: the patches overlap, and a machine
    // wobbling across the equidistance line flips which one is NEAREST every
    // tick. Each flip used to read as a fresh crossing: a throw and an
    // announcement per flip for as long as the machine sat in the overlap.
    // Leaving the remembered patch is what ends a crossing, not the tie
    // between two patches both under the wheels.
    const { sim, pids } = racingGrid();
    const [dropper, rival] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    const near = track.pointAt(track.length * 0.25);
    const first = dropSlickAt(sim, dropper, near.x, near.z);
    const live = match(sim);
    const second: RallySlick = {
      id: live.nextSlickId++,
      x: near.x + near.tx * 2,
      z: near.z + near.tz * 2,
      ownerPid: dropper,
      ownerClear: true,
      expiresTick: sim.tickCount + REALM_RACERS_SLICK_LIFETIME_TICKS,
    };
    live.slicks.push(second);
    const progress = required(live.progress.get(rival), 'rival progress');
    const rivalDrive = required(sim.entities.get(rival)?.drive, 'rival drive');

    // The dropper is still parked in the first patch, and the contact pass
    // would shove a rival teleported half a yard from their hull clean across
    // the overlap: park them well down the road before the rival enters.
    standOnCenterline(sim, dropper, track.length * 0.6);

    // Driven through updateRealmRacers directly: the geometry here is tighter
    // than the two yards a 40 yd/s machine covers between a teleport and the
    // slick pass inside a full tick.
    const slickedEvents = () =>
      sim.drainEvents().filter((event) => event.type === 'realmRacersSlicked');

    // Enter nearer the FIRST patch: one crossing, announced once.
    standAt(sim, rival, first.x + near.tx * 0.5, first.z + near.tz * 0.5);
    rivalDrive.speed = 40;
    sim.drainEvents();
    updateRealmRacers(sim.ctx);
    expect(progress.slickContactId).toBe(first.id);
    expect(slickedEvents()).toHaveLength(1);

    // Wobble across the midline and back: the SECOND patch keeps becoming the
    // nearest, but the machine never leaves the first, so nothing new resolves
    // and the remembered patch stays the first.
    for (const offset of [1.5, 0.5, 1.6, 0.4, 1.7]) {
      standAt(sim, rival, first.x + near.tx * offset, first.z + near.tz * offset);
      rivalDrive.speed = 40;
      updateRealmRacers(sim.ctx);
      expect(slickedEvents(), `offset ${offset}`).toHaveLength(0);
      expect(progress.slickContactId).toBe(first.id);
    }

    // Clear of the FIRST patch while still inside the second: leaving the
    // remembered patch is a real new crossing of the other one.
    standAt(sim, rival, first.x + near.tx * 3.5, first.z + near.tz * 3.5);
    rivalDrive.speed = 40;
    updateRealmRacers(sim.ctx);
    expect(progress.slickContactId).toBe(second.id);
    expect(slickedEvents()).toHaveLength(1);
  });

  it('says nothing at all when there is no shove to announce', () => {
    // A stopped machine is not thrown by a puddle. The event must not fire
    // either: it re-seeds the online predictor's whole drive state, so an
    // announcement of a zero shove pays that cost and plays the noise for
    // nothing.
    const { sim, pids } = racingGrid();
    const [dropper, rival] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    const point = track.pointAt(track.length * 0.25);
    const slick = dropSlickAt(sim, dropper, point.x, point.z);

    standAt(sim, rival, slick.x, slick.z);
    const rivalDrive = required(sim.entities.get(rival)?.drive, 'rival drive');
    rivalDrive.speed = 0;
    rivalDrive.slip = 0;
    const events = sim.tick();
    expect(events.filter((event) => event.type === 'realmRacersSlicked')).toEqual([]);
    expect(rivalDrive.slipCap).toBe(1);
  });

  it('takes the raised slide ceiling back at the flag', () => {
    // The ceiling rides the wire, so a machine left with a raised one at the
    // flag mirrors as free to slide twice as far for the whole tableau. Its
    // twin `speedCap` was already released here; this is the same clock.
    const { sim, pids } = racingGrid();
    const [dropper, rival] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    const point = track.pointAt(track.length * 0.25);
    const slick = dropSlickAt(sim, dropper, point.x, point.z);
    standAt(sim, rival, slick.x, slick.z);
    const rivalDrive = required(sim.entities.get(rival)?.drive, 'rival drive');
    rivalDrive.speed = 40;
    sim.tick();
    expect(rivalDrive.slipCap).toBe(2);

    realmRacersForfeit(sim.ctx, rival);
    for (const pid of pids) realmRacersForfeit(sim.ctx, pid);
    sim.tick();
    expect(rivalDrive.slipCap).toBe(1);
    expect(rivalDrive.speedCap).toBe(1);
  });

  it('catches the dropper with their own oil once they have driven clear of it', () => {
    const { sim, pids } = racingGrid();
    const [dropper] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    const point = track.pointAt(track.length * 0.25);
    const slick = dropSlickAt(sim, dropper, point.x, point.z);
    const progress = required(match(sim).progress.get(dropper), 'dropper progress');

    // Standing in it: still theirs, however many ticks they sit there.
    sim.tick();
    sim.tick();
    expect(progress.slickGripUntilTick).toBe(0);

    // Away down the circuit, which is what arms it.
    standOnCenterline(sim, dropper, track.length * 0.5);
    sim.tick();
    expect(match(sim).slicks.at(-1)?.ownerClear).toBe(true);

    // And back through it, on the lap or the hairpin that brings them round: a
    // patch they laid is ground like any other now.
    standAt(sim, dropper, slick.x, slick.z);
    sim.tick();
    expect(progress.slickGripUntilTick).toBe(sim.tickCount + REALM_RACERS_SLICK_GRIP_TICKS);
  });

  it('cannot bite anyone on the tick it is dropped', () => {
    // The drop happens on the CAST, which is resolved outside the slick pass (a
    // player's command lands between ticks; a bot's cast runs after the rally
    // phase). So a rival standing exactly where the oil lands is not caught by
    // the tick that was already running, only by the next one.
    const { sim, pids } = racingGrid();
    const [dropper, rival] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    const point = track.pointAt(track.length * 0.25);
    // The rival parked on the exact spot BEFORE the oil arrives.
    standAt(sim, rival, point.x, point.z);
    const rivalProgress = required(match(sim).progress.get(rival), 'rival progress');
    const slick = dropSlickAt(sim, dropper, point.x, point.z);
    expect(Math.hypot(slick.x - point.x, slick.z - point.z)).toBeLessThan(0.5);
    // Nothing yet: no tick has run since the patch appeared.
    expect(rivalProgress.slickGripUntilTick).toBe(0);

    // And the very next tick is when it bites: the hazard is real, it is just
    // never retroactive.
    standAt(sim, rival, slick.x, slick.z);
    sim.tick();
    expect(rivalProgress.slickGripUntilTick).toBe(sim.tickCount + REALM_RACERS_SLICK_GRIP_TICKS);
  });

  it('resolves one crossing once, however many ticks it takes', () => {
    const { sim, pids } = racingGrid();
    const [dropper, rival] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    const point = track.pointAt(track.length * 0.25);
    const slick = dropSlickAt(sim, dropper, point.x, point.z);
    standAt(sim, rival, slick.x, slick.z);
    sim.tick();
    const rivalProgress = required(match(sim).progress.get(rival), 'rival progress');
    const armed = rivalProgress.slickGripUntilTick;
    expect(armed).toBeGreaterThan(sim.tickCount);
    // Parked in the puddle: the leaf goes on reporting the contact every tick
    // (pinned above), and the GRIP window is not pushed back by any of them, or
    // a machine that stopped in the oil would never get the grip to drive out.
    for (let i = 0; i < 5; i++) sim.tick();
    expect(rivalProgress.slickGripUntilTick).toBe(armed);
    // The CONTACT deadline is the opposite: it follows the machine for as long
    // as it is touching oil, so it can only lapse once the machine is out.
    expect(rivalProgress.slickContactUntilTick).toBe(sim.tickCount + REALM_RACERS_SLICK_GRIP_TICKS);
  });

  it('never throws a machine a second time for sitting in the same patch', () => {
    // The regression that made a slick unplayable: the contact deadline used to
    // lapse under a machine that had never left the oil, so a pilot who spun to
    // a stop in a patch was thrown again every 1.5 s for the twelve seconds it
    // lived. Harmless while a crossing only cost grip; a fresh spin, a fresh
    // event and a fresh camera reaction once one shoved.
    const { sim, pids } = racingGrid();
    const [dropper, rival] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    const point = track.pointAt(track.length * 0.25);
    const slick = dropSlickAt(sim, dropper, point.x, point.z);
    standAt(sim, rival, slick.x, slick.z);
    const rivalRacer = required(sim.entities.get(rival), 'rival');
    // Moving, so this is a real crossing: a stopped machine is not thrown at all
    // and would make the assertion below vacuous.
    const rivalDrive = required(rivalRacer.drive, 'rival drive');
    rivalDrive.speed = 40;
    const first = sim.tick();
    expect(first.filter((event) => event.type === 'realmRacersSlicked')).toHaveLength(1);

    // Held in the patch well past the window, which is where the repeat used to
    // land, and past two more of them for good measure.
    let repeats = 0;
    for (let i = 0; i < REALM_RACERS_SLICK_GRIP_TICKS * 3; i++) {
      standAt(sim, rival, slick.x, slick.z);
      rivalDrive.speed = 40;
      repeats += sim.tick().filter((event) => event.type === 'realmRacersSlicked').length;
    }
    expect(repeats).toBe(0);
    // The patch is still there and still lethal to a machine that arrives fresh:
    // this is one crossing resolved once, not a hazard that switched itself off.
    expect(match(sim).slicks).toHaveLength(1);
    expect(rivalRacer.dead).toBe(false);
  });

  it('lets a ward eat the oil, once', () => {
    const { sim, pids } = racingGrid();
    const [dropper, rival] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    const point = track.pointAt(track.length * 0.25);
    const slick = dropSlickAt(sim, dropper, point.x, point.z);
    const rivalProgress = required(match(sim).progress.get(rival), 'rival progress');
    // Granted as the real AURA, which is the ward's source of truth.
    const rivalRacer = required(sim.entities.get(rival), 'rival');
    rivalRacer.auras.push({
      id: REALM_RACERS_WARD_AURA,
      name: 'Racing Ward',
      kind: 'rally_ward',
      remaining: REALM_RACERS_WARD_AURA_SECONDS,
      duration: REALM_RACERS_WARD_AURA_SECONDS,
      value: 0,
      sourceId: rival,
      school: 'physical',
    });

    standAt(sim, rival, slick.x, slick.z);
    const absorbed = sim.tick();
    expect(realmRacersWarded(rivalRacer)).toBe(false);
    expect(rivalProgress.slickGripUntilTick).toBe(0);
    expect(absorbed.filter((event) => event.type === 'realmRacersWardBroken')).toMatchObject([
      { pid: rival },
    ]);

    // Spent: the next crossing is a crossing like anyone else's. Driven clear of
    // the patch first, or the machine never stopped touching it and the window
    // it is standing in is the same one.
    standOnCenterline(sim, rival, track.length * 0.5);
    while (sim.tickCount < rivalProgress.slickContactUntilTick) sim.tick();
    standAt(sim, rival, slick.x, slick.z);
    sim.tick();
    expect(rivalProgress.slickGripUntilTick).toBe(sim.tickCount + REALM_RACERS_SLICK_GRIP_TICKS);
  });

  it('offers no grip loss to a racer who has pulled off', () => {
    const { sim, pids } = racingGrid();
    const [dropper, rival] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    const point = track.pointAt(track.length * 0.25);
    const slick = dropSlickAt(sim, dropper, point.x, point.z);
    realmRacersForfeit(sim.ctx, rival);
    const rivalProgress = required(match(sim).progress.get(rival), 'rival progress');
    expect(rivalProgress.retiredTick).not.toBeNull();
    standAt(sim, rival, slick.x, slick.z);
    updateRealmRacers(sim.ctx);
    // They keep the machine and may drive it anywhere; they are not in the race
    // any more, so the race's hazards are not theirs.
    expect(rivalProgress.slickGripUntilTick).toBe(0);
  });

  it('offers no grip loss to a machine the referee has just put back', () => {
    // The twin of the 22a pickup case, on the hazard side: automatic recovery
    // puts a machine somewhere, and a patch it lands in is not a patch it drove
    // into. (The lock is one tick, which is exactly what this guard needs.)
    const { sim, pids } = racingGrid();
    const [dropper, rival] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    const rivalProgress = required(match(sim).progress.get(rival), 'rival progress');
    // The recovery anchor, and the oil dropped exactly on it.
    const anchor = track.pointAt(track.length * 0.25);
    const slick = dropSlickAt(sim, dropper, anchor.x, anchor.z);
    rivalProgress.resetS = track.length * 0.25;
    rivalProgress.resetLap = rivalProgress.lap;
    rivalProgress.resetDistanceSinceWrap = rivalProgress.distanceSinceWrap;

    // Wedged off the road: three seconds stationary is what arms the automatic
    // recovery, which is the arm that used to hand back control with no lock at
    // all.
    const off = track.pointAt(track.length * 0.4);
    const outward = track.halfWidthAt(off.s) + 12;
    standAt(sim, rival, off.x - off.tz * outward, off.z + off.tx * outward);
    // Ticked only until the recovery FIRES: the lock is one tick long, so
    // running past it would be testing life after the lock rather than the lock.
    for (
      let i = 0;
      i < REALM_RACERS_STUCK_TICKS + 4 && rivalProgress.resetLockedUntilTick <= sim.tickCount;
      i++
    ) {
      sim.tick();
    }
    expect(rivalProgress.resetLockedUntilTick).toBeGreaterThan(sim.tickCount);
    expect(REALM_RACERS_AUTO_RECOVERY_LOCK_TICKS).toBe(1);
    // Standing in the oil, having been PUT there.
    expect(Math.hypot(slick.x - anchor.x, slick.z - anchor.z)).toBeLessThan(0.5);
    sim.tick();
    expect(rivalProgress.slickGripUntilTick).toBe(0);
  });

  it('holds the field to the cap the renderer can draw, oldest first', () => {
    const { sim, pids } = racingGrid();
    const [dropper] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    const live = match(sim);
    const racer = required(sim.entities.get(dropper), 'racer');
    const progress = required(live.progress.get(dropper), 'progress');
    // Driven through the REAL drop path, the one a cast reaches: filling the
    // slot by hand and spending it is the same code the pilot's button runs, and
    // it is where the cap lives. (Taking twenty boxes instead would be timing
    // the pickup cooldown, and the circuit does not carry twenty boxes.)
    for (let i = 0; i < REALM_RACERS_SLICK_CAP + 4; i++) {
      const point = track.pointAt((track.length * i) / (REALM_RACERS_SLICK_CAP + 4));
      standAt(sim, dropper, point.x, point.z);
      progress.heldEffect = 'slick';
      realmRacersSpendPickupEffect(sim.ctx, racer, 'slick');
    }
    expect(live.slicks).toHaveLength(REALM_RACERS_SLICK_CAP);
    // Oldest gone, newest kept: what is left is the tail of the id sequence, so
    // the patch a pilot just laid is never the one evicted.
    expect(live.slicks[0].id).toBe(5);
    expect(live.slicks.at(-1)?.id).toBe(REALM_RACERS_SLICK_CAP + 4);
    expect(sim.realmRacersInfoFor(dropper).match?.slicks).toHaveLength(REALM_RACERS_SLICK_CAP);
  });

  it('keeps every practice lane on its own oil', () => {
    const sim = makeWorld();
    const one = addAt(sim, 'warrior', 'Aster', -5, -40);
    const two = addAt(sim, 'mage', 'Briar', 7, -42);
    expect(startRealmRacersPractice(sim, 'driver', one)).toBe(true);
    expect(startRealmRacersPractice(sim, 'driver', two)).toBe(true);
    const [first, second] = sim.realmRacers.practices;
    first.phase = 'racing';
    second.phase = 'racing';
    // A patch on the FIRST lane's copy of the circuit only.
    const point = realmRacersTrack(REALM_RACERS_PRACTICE_CIRCUIT).pointAt(40);
    first.slicks.push({
      id: first.nextSlickId++,
      x: point.x,
      z: point.z,
      ownerPid: one,
      ownerClear: false,
      expiresTick: sim.tickCount + REALM_RACERS_SLICK_LIFETIME_TICKS,
    });
    updateRealmRacers(sim.ctx);
    expect(first.slicks).toHaveLength(1);
    expect(second.slicks).toEqual([]);
    expect(sim.realmRacersInfoFor(two).match?.slicks).toEqual([]);
    expect(sim.realmRacersInfoFor(one).match?.slicks).toHaveLength(1);
  });

  it('takes the patch off the road and off the readout when it expires', () => {
    const { sim, pids } = racingGrid();
    const [dropper, rival] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    const point = track.pointAt(track.length * 0.25);
    const slick = dropSlickAt(sim, dropper, point.x, point.z);
    expect(sim.realmRacersInfoFor(rival).match?.slicks).toHaveLength(1);
    // Parked well clear of the row so nothing else changes hands meanwhile.
    standOnCenterline(sim, rival, track.length * 0.5);
    while (sim.tickCount < slick.expiresTick) sim.tick();
    updateRealmRacers(sim.ctx);
    expect(match(sim).slicks).toEqual([]);
    expect(sim.realmRacersInfoFor(rival).match?.slicks).toEqual([]);
    // The lifetime is the constant, not a number this suite invented.
    expect(slick.expiresTick - REALM_RACERS_SLICK_LIFETIME_TICKS).toBeGreaterThan(0);
  });
});

describe('the oil slick visual core', () => {
  it('draws a new patch at FULL radius and soaks a gone one away', () => {
    let visual = rallySlickInitialVisual();
    expect(visual.phase).toBe('present');
    // Full size on the very first frame: the sim can report a grip loss for a
    // patch the tick it appears, so a disk still growing would be drawn smaller
    // than it bites.
    expect(rallySlickScale(visual)).toBe(1);
    for (let i = 0; i < 10; i++) visual = stepRallySlickVisual(visual, true, 0.05);
    expect(visual.phase).toBe('present');
    expect(rallySlickScale(visual)).toBe(1);
    expect(rallySlickVisible(visual)).toBe(true);

    visual = stepRallySlickVisual(visual, false, 0.05);
    // The transition itself carries no time, so the patch is still full size on
    // the frame it starts soaking away; the frame after is when it shrinks.
    expect(visual).toEqual({ phase: 'fading', t: 0 });
    expect(rallySlickScale(visual)).toBe(1);
    expect(rallySlickScale(stepRallySlickVisual(visual, false, 0.05))).toBeLessThan(1);
    for (let i = 0; i < 20; i++) visual = stepRallySlickVisual(visual, false, 0.05);
    expect(visual.phase).toBe('gone');
    expect(rallySlickVisible(visual)).toBe(false);
    expect(rallySlickScale(visual)).toBe(0);
  });

  it('is drawn at full radius on EVERY frame the race can still report a hit', () => {
    // The fairness pin, stated as the property rather than as a phase: for as
    // long as the readout says the patch is there, its drawn edge is its real
    // edge.
    let visual = rallySlickInitialVisual();
    for (let frame = 0; frame < 60; frame++) {
      expect(rallySlickScale(visual)).toBe(1);
      expect(rallySlickVisible(visual)).toBe(true);
      visual = stepRallySlickVisual(visual, true, 0.016);
    }
  });

  it('turns a re-used id mid fade straight back into a full patch', () => {
    let visual = rallySlickInitialVisual();
    visual = stepRallySlickVisual(visual, false, 0.05);
    visual = stepRallySlickVisual(visual, false, RALLY_SLICK_FADE_SECONDS / 2);
    expect(visual.phase).toBe('fading');
    visual = stepRallySlickVisual(visual, true, 0.01);
    expect(visual).toEqual({ phase: 'present', t: 0 });
    expect(rallySlickScale(visual)).toBe(1);
  });

  it('hands back the SAME state object in either resting phase', () => {
    // Identity, not equality: the painter decides whether a matrix has to be
    // written by comparing what came back with what it held.
    const present = rallySlickInitialVisual();
    expect(stepRallySlickVisual(present, true, 0.016)).toBe(present);
    let gone = stepRallySlickVisual(present, false, 0.016);
    for (let i = 0; i < 20; i++) gone = stepRallySlickVisual(gone, false, 0.05);
    expect(gone.phase).toBe('gone');
    expect(stepRallySlickVisual(gone, false, 0.016)).toBe(gone);
  });

  it('desynchronizes two patches from each other', () => {
    const time = 3.2;
    expect(rallySlickSheenSpin(time, 1)).not.toBeCloseTo(rallySlickSheenSpin(time, 2), 3);
    // A constant per id rather than noise: the same patch at the same moment is
    // always in the same place.
    expect(rallySlickSheenSpin(time + 1, 1) - rallySlickSheenSpin(time, 1)).toBeCloseTo(
      rallySlickSheenSpin(time + 1, 2) - rallySlickSheenSpin(time, 2),
      9,
    );
  });

  it('reads two patch lists as the same only when they are', () => {
    expect(rallySlickListSame([], [])).toBe(true);
    expect(rallySlickListSame([{ id: 3 }], [{ id: 3 }])).toBe(true);
    expect(rallySlickListSame([{ id: 3 }], [{ id: 4 }])).toBe(false);
    expect(rallySlickListSame([{ id: 3 }], [{ id: 3 }, { id: 4 }])).toBe(false);
    expect(rallySlickListSame([{ id: 4 }, { id: 3 }], [{ id: 3 }, { id: 4 }])).toBe(false);
  });
});

describe('the provisional slick, the local drop painted before the round trip', () => {
  const patch = (id: number, x: number, z: number) => ({ id, x, z });
  const none: ReadonlySet<number> = new Set();

  it('shows until the server patch lands nearby, then hands the road over', () => {
    expect(rallyProvisionalSlickState([], none, 10, 5, 0.2)).toBe('shown');
    // The server lays the patch under ITS pose, which trails the display at
    // race speed: yards off is still the same drop.
    expect(rallyProvisionalSlickState([patch(3, 16, 5)], none, 10, 5, 0.2)).toBe('adopted');
  });

  it('never adopts an unrelated patch across the road', () => {
    expect(rallyProvisionalSlickState([patch(3, 30, 5)], none, 10, 5, 0.2)).toBe('shown');
  });

  it('never adopts a patch that was already on the road at drop time', () => {
    // Oil clusters: the dropper's own previous lap, a rival's patch in the
    // same hairpin. A pre-existing patch nearby must not swallow the fresh
    // drop on its first frame, or the feature turns itself off exactly where
    // it is most wanted.
    const known: ReadonlySet<number> = new Set([3]);
    expect(rallyProvisionalSlickState([patch(3, 11, 5)], known, 10, 5, 0.2)).toBe('shown');
    // The NEW id arriving beside it is the drop, and adopts.
    expect(rallyProvisionalSlickState([patch(3, 11, 5), patch(9, 12, 5)], known, 10, 5, 0.3)).toBe(
      'adopted',
    );
  });

  it('expires a drop whose real patch never arrived (a refused cast)', () => {
    expect(rallyProvisionalSlickState([], none, 10, 5, 1.6)).toBe('expired');
    // Adoption wins over the timeout when both hold.
    expect(rallyProvisionalSlickState([patch(3, 10, 5)], none, 10, 5, 1.6)).toBe('adopted');
  });
});
