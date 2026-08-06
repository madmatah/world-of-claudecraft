// The Ground Blast. Two halves, tested at the level each one actually lives at:
// the pure leaf (where a shot lands, what the blast does to a machine) driven
// directly with plain numbers, then the whole weapon driven through a live Sim
// (the charge budget, the phase gate, the impact tick, the grip loss).
//
// The claim that needs the most care is the AIM CLAMP. The player places the
// circle themselves, and the same pure function runs on the client (to draw it)
// and on the server (to trust it), so every rule about where a shell may go is
// checked here in plain numbers rather than by eye through a reticle.

import { describe, expect, it } from 'vitest';
import {
  REALM_RACERS_ABILITY_ID,
  REALM_RACERS_WEAPON_CHARGES,
  resolveRealmRacersKit,
} from '../src/sim/content/realm_racers';
import { REALM_RACERS_PRACTICE_CIRCUIT as GARDEN_CIRCUIT } from '../src/sim/content/realm_racers_circuits';
import { vehicleProfile } from '../src/sim/content/vehicles';
import { GRAVITY } from '../src/sim/player_motion';
import {
  GROUND_BLAST_AIM_CONE_RAD,
  GROUND_BLAST_BLIND_RANGE,
  GROUND_BLAST_MAX_FLIGHT,
  GROUND_BLAST_MAX_RANGE,
  GROUND_BLAST_MIN_FLIGHT,
  GROUND_BLAST_MIN_RANGE,
  GROUND_BLAST_POP_VELOCITY,
  GROUND_BLAST_PUSH,
  GROUND_BLAST_RADIUS,
  GROUND_BLAST_SHOCK_GRIP,
  GROUND_BLAST_SHOCK_TICKS,
  GROUND_BLAST_SPEED,
  GROUND_BLAST_YAW_KICK,
  resolveGroundBlastAim,
  resolveGroundBlastImpact,
} from '../src/sim/realm_racers_ground_blast';
import { REALM_RACERS_GRID_SIZE } from '../src/sim/realm_racers_layout';
import { realmRacersTrack } from '../src/sim/realm_racers_spline';
import type { Sim } from '../src/sim/sim';
import {
  REALM_RACERS_RETURN_TICKS,
  realmRacersFireGroundBlast,
  updateRealmRacers,
} from '../src/sim/social/realm_racers';
import { type Entity, TICK_RATE, type VehicleDrive } from '../src/sim/types';
import { createVehicleDrive, vehicleVelocityX, vehicleVelocityZ } from '../src/sim/vehicle_motion';
import { addAt, makeWorld, teleport } from './vale_cup_util';

const LOANER = vehicleProfile('rally_loaner');

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${label}`);
  return value;
}

function entity(sim: Sim, pid: number): Entity {
  return required(sim.entities.get(pid), `entity ${pid}`);
}

function match(sim: Sim) {
  return required(sim.realmRacers.match, 'Realm Racers match');
}

/** A live public race with the whole grid seated and the flag already dropped. */
function racing(): { sim: Sim; a: number; b: number; pids: number[] } {
  const sim = makeWorld();
  const pids = Array.from({ length: REALM_RACERS_GRID_SIZE }, (_, i) =>
    addAt(sim, 'warrior', `Racer${i}`, -6 + i * 4, -40 - i),
  );
  for (const pid of pids) sim.realmRacersQueueJoin(pid);
  sim.tick();
  // The rest of the field is parked far around the lap. A blast catches EVERY
  // racer inside it, which is the point of the weapon, so a shell aimed at one
  // named rival has to be fired somewhere the others are not.
  const track = realmRacersTrack(GARDEN_CIRCUIT);
  pids.slice(2).forEach((pid, i) => {
    const away = track.pointAt(track.length * (0.4 + i * 0.2));
    teleport(sim, pid, away.x, away.z);
  });
  match(sim).phase = 'racing';
  // The phase drives the CONTROL LOCK, which the match module writes onto each
  // machine every tick. Flipping the phase by hand and not letting the module
  // run leaves every pilot still held on the grid, with every cast refused.
  updateRealmRacers(sim.ctx);
  return { sim, a: pids[0], b: pids[1], pids };
}

/** Aim from the origin facing +z at a requested ground point. Facing 0 points
 *  along +z (forward = (sin f, cos f)), so +z is straight ahead and +x is left. */
function shotAt(requested: { x: number; z: number } | null) {
  return resolveGroundBlastAim({ x: 0, z: 0, facing: 0 }, requested);
}

/** Angle of an aim off the caster's nose (facing 0), radians. */
function offNose(aim: { x: number; z: number }): number {
  return Math.atan2(aim.x, aim.z);
}

function body(over: Partial<{ x: number; z: number; facing: number; drive: VehicleDrive }> = {}) {
  return {
    x: over.x ?? 0,
    z: over.z ?? 0,
    facing: over.facing ?? 0,
    drive: over.drive ?? createVehicleDrive('rally_loaner'),
  };
}

describe('Ground Blast: where the player may place a shot', () => {
  it('lands exactly where it was aimed, inside the cone and the range band', () => {
    const aim = shotAt({ x: 6, z: 20 });
    expect(aim.x).toBeCloseTo(6, 9);
    expect(aim.z).toBeCloseTo(20, 9);
    expect(aim.clamped).toBe(false);
    const seconds = aim.flightTicks / TICK_RATE;
    expect(seconds).toBeGreaterThanOrEqual(GROUND_BLAST_MIN_FLIGHT);
    expect(seconds).toBeLessThanOrEqual(GROUND_BLAST_MAX_FLIGHT);
  });

  it('pulls an aim outside the cone onto the cone edge, keeping its distance', () => {
    // Straight out to the side: 90 degrees off the nose, well past the 45 the
    // barrel allows.
    const aim = shotAt({ x: 30, z: 0 });
    expect(offNose(aim)).toBeCloseTo(GROUND_BLAST_AIM_CONE_RAD, 9);
    expect(Math.hypot(aim.x, aim.z)).toBeCloseTo(30, 9);
    expect(aim.clamped).toBe(true);
  });

  it('clamps to the same edge on the other side, mirrored', () => {
    const left = shotAt({ x: 30, z: 0 });
    const right = shotAt({ x: -30, z: 0 });
    expect(offNose(right)).toBeCloseTo(-GROUND_BLAST_AIM_CONE_RAD, 9);
    expect(right.x).toBeCloseTo(-left.x, 9);
    expect(right.z).toBeCloseTo(left.z, 9);
  });

  it('pulls an aim behind the caster all the way round to the cone edge', () => {
    // The barrel is bolted to the chassis: there is no shot backwards, only the
    // furthest forward angle the machine can be pointed at.
    const aim = shotAt({ x: 0, z: -20 });
    expect(Math.abs(offNose(aim))).toBeCloseTo(GROUND_BLAST_AIM_CONE_RAD, 9);
    expect(aim.z).toBeGreaterThan(0);
    expect(aim.clamped).toBe(true);
  });

  it('clamps a point-blank aim out to the minimum range, clear of the caster', () => {
    const aim = shotAt({ x: 0, z: 4 });
    expect(aim.z).toBeCloseTo(GROUND_BLAST_MIN_RANGE, 9);
    expect(aim.clamped).toBe(true);
    // The caster's own centre sits outside the blast it just dropped.
    expect(Math.hypot(aim.x, aim.z)).toBeGreaterThan(GROUND_BLAST_RADIUS + LOANER.bodyRadius);
  });

  it('clamps an aim past the maximum range back onto the edge', () => {
    const aim = shotAt({ x: 0, z: GROUND_BLAST_MAX_RANGE + 40 });
    expect(aim.z).toBeCloseTo(GROUND_BLAST_MAX_RANGE, 9);
    expect(aim.clamped).toBe(true);
  });

  it('makes a longer shot a slower one, which is the whole trade', () => {
    // Derived from the constants, never pinned to today's numbers: which end of
    // the range band saturates the flight window is a pure accident of the
    // speed-to-range ratio, and the operator retunes both from the seat.
    const near = shotAt({ x: 0, z: GROUND_BLAST_MIN_RANGE });
    const far = shotAt({ x: 0, z: GROUND_BLAST_MAX_RANGE });
    expect(far.flightTicks).toBeGreaterThan(near.flightTicks);
    for (const [label, aim] of [
      ['near', near],
      ['far', far],
    ] as const) {
      const seconds = aim.flightTicks / TICK_RATE;
      expect(seconds, label).toBeGreaterThanOrEqual(GROUND_BLAST_MIN_FLIGHT - 1 / TICK_RATE);
      expect(seconds, label).toBeLessThanOrEqual(GROUND_BLAST_MAX_FLIGHT + 1 / TICK_RATE);
    }
    // And between the clamps the flight really tracks the distance rather than
    // sitting at one end of the window: a shot at the midpoint of whatever band
    // is unclamped is strictly slower than the shortest legal one.
    const unclamped = Math.min(
      GROUND_BLAST_MAX_RANGE,
      GROUND_BLAST_MAX_FLIGHT * GROUND_BLAST_SPEED,
    );
    const middle = shotAt({
      x: 0,
      z: (GROUND_BLAST_MIN_FLIGHT * GROUND_BLAST_SPEED + unclamped) / 2,
    });
    expect(middle.flightTicks).toBeGreaterThan(near.flightTicks);
    expect(middle.flightTicks).toBeLessThanOrEqual(far.flightTicks);
  });

  it('fires straight down the nose when no point was given at all', () => {
    for (const nothing of [null, { x: 0, z: 0 }]) {
      const aim = shotAt(nothing);
      expect(aim.x).toBeCloseTo(0, 9);
      expect(aim.z).toBeCloseTo(GROUND_BLAST_BLIND_RANGE, 9);
      expect(aim.clamped).toBe(false);
    }
  });

  it('reads the barrel, not the world axes', () => {
    const shooter = { x: 10, z: -3, facing: Math.PI / 2 }; // forward = (1, 0)
    const blind = resolveGroundBlastAim(shooter, null);
    expect(blind.x).toBeCloseTo(10 + GROUND_BLAST_BLIND_RANGE, 6);
    expect(blind.z).toBeCloseTo(-3, 6);
    // And the cone turns with the machine: a point due +z is 90 degrees off
    // THIS nose and clamps, though it would have been dead ahead at facing 0.
    const sideways = resolveGroundBlastAim(shooter, { x: 10, z: -3 + 20 });
    expect(sideways.clamped).toBe(true);
    expect(sideways.x).toBeGreaterThan(10);
  });
});

describe('Ground Blast: the blast', () => {
  it('pins the shipped blast tuning to literals', () => {
    // The behavioural cases below derive their expectations from these
    // constants, so on their own they move with a retune. The literal is what
    // says the shipped numbers are the shipped numbers.
    expect(GROUND_BLAST_RADIUS).toBe(6);
    expect(GROUND_BLAST_SHOCK_TICKS).toBe(30);
  });

  it('falls off with distance and stops at the rim', () => {
    const centre = resolveGroundBlastImpact(body({ x: 0, z: 0 }), 0, 0);
    const near = resolveGroundBlastImpact(body({ x: 0, z: GROUND_BLAST_RADIUS * 0.9 }), 0, 0);
    const rim = resolveGroundBlastImpact(body({ x: 0, z: GROUND_BLAST_RADIUS }), 0, 0);
    expect(centre.falloff).toBeCloseTo(1, 9);
    expect(near.falloff).toBeCloseTo(0.1, 9);
    expect(centre.pop).toBeCloseTo(GROUND_BLAST_POP_VELOCITY, 9);
    expect(centre.pop).toBeGreaterThan(near.pop);
    expect(rim).toEqual({ falloff: 0, pop: 0 });
  });

  it('shoves the machine directly away from the blast, scaled by the falloff', () => {
    const drive = createVehicleDrive('rally_loaner');
    // HALF the blast radius behind the impact, facing +z, so the falloff is
    // exactly one half whatever the radius is tuned to. The shove is straight
    // backwards, which in the body frame is pure negative forward speed.
    const result = resolveGroundBlastImpact(
      body({ x: 0, z: -GROUND_BLAST_RADIUS / 2, drive }),
      0,
      0,
    );
    expect(result.falloff).toBeCloseTo(0.5, 9);
    expect(vehicleVelocityZ(drive, 0)).toBeCloseTo(-GROUND_BLAST_PUSH * 0.5, 9);
    expect(vehicleVelocityX(drive, 0)).toBeCloseTo(0, 9);
  });

  it('leaves a machine outside the radius completely untouched', () => {
    const drive = createVehicleDrive('rally_loaner');
    drive.speed = 30;
    const result = resolveGroundBlastImpact(
      body({ x: 0, z: GROUND_BLAST_RADIUS + 0.5, drive }),
      0,
      0,
    );
    expect(result).toEqual({ falloff: 0, pop: 0 });
    expect(drive).toEqual({ ...createVehicleDrive('rally_loaner'), speed: 30 });
  });

  it('spins the machine away from whichever side the blast went off on', () => {
    // Facing +z, so the machine's right is -x. A blast at -x is on its right.
    const onRight = createVehicleDrive('rally_loaner');
    resolveGroundBlastImpact(body({ x: 0, z: 0, drive: onRight }), -1, 0);
    const onLeft = createVehicleDrive('rally_loaner');
    resolveGroundBlastImpact(body({ x: 0, z: 0, drive: onLeft }), 1, 0);
    expect(onRight.spin).toBeCloseTo(GROUND_BLAST_YAW_KICK * (1 - 1 / GROUND_BLAST_RADIUS), 9);
    expect(onLeft.spin).toBeCloseTo(-onRight.spin, 9);
    expect(onRight.spin).toBeGreaterThan(0);
  });

  it('spins nobody on a hit taken square on the nose', () => {
    const nose = createVehicleDrive('rally_loaner');
    const result = resolveGroundBlastImpact(body({ x: 0, z: 0, drive: nose }), 0, 2);
    expect(result.falloff).toBeGreaterThan(0);
    expect(nose.spin).toBeCloseTo(0, 9);
    // And it is a real hit, not a no-op: the shove is straight backwards.
    expect(nose.speed).toBeLessThan(0);
  });

  it('spins nobody, and throws nobody sideways, dead on the impact point', () => {
    const drive = createVehicleDrive('rally_loaner');
    const result = resolveGroundBlastImpact(body({ x: 0, z: 0, drive }), 0, 0);
    expect(result.falloff).toBeCloseTo(1, 9);
    expect(result.pop).toBeCloseTo(GROUND_BLAST_POP_VELOCITY, 9);
    expect(drive.spin).toBe(0);
    expect(drive.speed).toBe(0);
    expect(drive.slip).toBe(0);
  });
});

describe('Ground Blast: the weapon slot', () => {
  it('resolves the ability its argument names, not a hardcoded one', () => {
    const kit = resolveRealmRacersKit(REALM_RACERS_ABILITY_ID, REALM_RACERS_WEAPON_CHARGES);
    expect(kit).toHaveLength(1);
    expect(kit[0].def.id).toBe(REALM_RACERS_ABILITY_ID);
    expect(kit[0].charges).toBe(REALM_RACERS_WEAPON_CHARGES);
    // A weapon the table does not know resolves to no kit at all rather than
    // silently falling back to Ground Blast.
    expect(resolveRealmRacersKit('rally_moss_slick', 3)).toEqual([]);
  });

  it('puts the weapon FIRST in the kit, which is what the leftmost key fires', () => {
    // The HUD remaps the fixed attack slot to `known[0]` on the circuit, the
    // same way the pitch does for the first sport move. Without that remap the
    // key toggles an auto-attack with no target and answers "Invalid attack
    // target." mid-race, which is what a pilot actually got. The remap is one
    // HUD branch; the fact it rests on is this one, and it belongs here.
    const { sim, a } = racing();
    const known = required(sim.players.get(a)?.known, 'kit');
    expect(known[0]?.def.id).toBe(LOANER.weaponAbilityId);
    expect(known[0]?.def.targetMode).toBe('position');
  });

  it('omits the charge badge for a slot with no budget', () => {
    expect(resolveRealmRacersKit(REALM_RACERS_ABILITY_ID, null)[0].charges).toBeUndefined();
  });

  it('seats every racer with a full slot and publishes it to the action bar', () => {
    const { sim, a, b } = racing();
    const live = match(sim);
    for (const pid of [a, b]) {
      expect(live.progress.get(pid)?.heldWeapon).toEqual({
        abilityId: LOANER.weaponAbilityId,
        charges: REALM_RACERS_WEAPON_CHARGES,
      });
      expect(entity(sim, pid).abilityCharges?.[LOANER.weaponAbilityId]).toMatchObject({
        charges: REALM_RACERS_WEAPON_CHARGES,
        maxCharges: REALM_RACERS_WEAPON_CHARGES,
        // `fixed` is what marks a race budget apart from the refilling charge
        // model: the recharge tick skips it, and the cast gate reads it.
        fixed: true,
      });
      expect(sim.players.get(pid)?.known[0]?.charges).toBe(REALM_RACERS_WEAPON_CHARGES);
    }
  });

  it('spends one charge per shot and refuses the cast once the budget is gone', () => {
    const { sim, a } = racing();
    const live = match(sim);
    const held = required(live.progress.get(a)?.heldWeapon, 'held weapon');
    const caster = entity(sim, a);
    for (let shot = 1; shot <= REALM_RACERS_WEAPON_CHARGES; shot++) {
      caster.cooldowns.delete(REALM_RACERS_ABILITY_ID);
      sim.castAbility(REALM_RACERS_ABILITY_ID, a);
      expect(held.charges, `after shot ${shot}`).toBe(REALM_RACERS_WEAPON_CHARGES - shot);
    }
    caster.cooldowns.delete(REALM_RACERS_ABILITY_ID);
    const blastsBefore = live.groundBlasts.length;
    sim.castAbility(REALM_RACERS_ABILITY_ID, a);
    expect(held.charges).toBe(0);
    expect(live.groundBlasts).toHaveLength(blastsBefore);
    // Refused as EMPTY, never as cooling down: the two must not read alike.
    expect(caster.cooldowns.has(REALM_RACERS_ABILITY_ID)).toBe(false);
    expect(entity(sim, a).abilityCharges?.[REALM_RACERS_ABILITY_ID]?.charges).toBe(0);
  });

  it('never hands a spent charge back, however many ticks pass', () => {
    // The defect this pins, reported from the seat: the shared recharge tick
    // reads a pool with no recharge length as "every timer already due" and
    // refills it on the very next tick. The badge then reads 3 forever, the cast
    // gate never sees an empty pool, and shots four and up fire, arm their
    // cooldown and do nothing at all. `fixed` is what holds the budget spent.
    const { sim, a } = racing();
    const caster = entity(sim, a);
    sim.castAbility(REALM_RACERS_ABILITY_ID, a);
    const pool = required(caster.abilityCharges?.[REALM_RACERS_ABILITY_ID], 'charge pool');
    expect(pool.charges).toBe(REALM_RACERS_WEAPON_CHARGES - 1);
    for (let tick = 0; tick < 5 * TICK_RATE; tick++) sim.tick();
    expect(pool.charges).toBe(REALM_RACERS_WEAPON_CHARGES - 1);
    // And the ordinary cooldown still ran out in that time, so the two clocks
    // are genuinely independent: the budget is the ammunition, the cooldown is
    // only the pacing between shots.
    expect(caster.cooldowns.has(REALM_RACERS_ABILITY_ID)).toBe(false);
  });

  it('locks the controls off the racing phase, and unlocks them at the flag', () => {
    const { sim, a, b } = racing();
    const live = match(sim);
    for (const phase of ['countdown', 'finished', 'racing'] as const) {
      live.phase = phase;
      updateRealmRacers(sim.ctx);
      for (const pid of [a, b]) {
        expect(required(entity(sim, pid).drive, 'drive').controlsLocked, phase).toBe(
          phase !== 'racing',
        );
      }
    }
  });

  it('burns no cooldown and no charge on a trigger pull before the flag', () => {
    // Reported from the seat: pressing the key on the grid did nothing visible
    // AND put the weapon on cooldown, so a pilot who mashed it rolled onto the
    // circuit with nothing to fire. The phase gate used to live inside the shot,
    // which runs after the cast has already paid.
    const { sim, a } = racing();
    const live = match(sim);
    live.phase = 'countdown';
    updateRealmRacers(sim.ctx);
    const caster = entity(sim, a);
    const held = required(live.progress.get(a)?.heldWeapon, 'held weapon');
    sim.castAbility(REALM_RACERS_ABILITY_ID, a, { x: caster.pos.x, z: caster.pos.z + 20 });
    expect(caster.cooldowns.has(REALM_RACERS_ABILITY_ID)).toBe(false);
    expect(held.charges).toBe(REALM_RACERS_WEAPON_CHARGES);
    expect(live.groundBlasts).toHaveLength(0);

    // ...and the very same press works the moment the flag drops.
    live.phase = 'racing';
    updateRealmRacers(sim.ctx);
    sim.castAbility(REALM_RACERS_ABILITY_ID, a, { x: caster.pos.x, z: caster.pos.z + 20 });
    expect(held.charges).toBe(REALM_RACERS_WEAPON_CHARGES - 1);
    expect(live.groundBlasts).toHaveLength(1);
  });

  it('costs nothing for a trigger pull the phase gate refuses', () => {
    const { sim, a } = racing();
    const live = match(sim);
    const held = required(live.progress.get(a)?.heldWeapon, 'held weapon');
    live.phase = 'countdown';
    realmRacersFireGroundBlast(sim.ctx, entity(sim, a));
    expect(held.charges).toBe(REALM_RACERS_WEAPON_CHARGES);
    expect(live.groundBlasts).toHaveLength(0);
  });

  it('starts the next race at a full budget and leaves no residue behind', () => {
    const { sim, a, pids } = racing();
    realmRacersFireGroundBlast(sim.ctx, entity(sim, a));
    expect(match(sim).progress.get(a)?.heldWeapon?.charges).toBe(REALM_RACERS_WEAPON_CHARGES - 1);
    // The whole grid pulls off, so the race is decided and torn down; one pilot
    // quitting no longer ends anyone else's.
    for (const pid of pids) sim.realmRacersForfeit(pid);
    for (let tick = 0; tick <= REALM_RACERS_RETURN_TICKS; tick++) sim.tick();
    // The gameplay parenthesis closed: the racer is back to their own kit with
    // no rally charge pool left on them.
    expect(sim.realmRacers.match).toBeNull();
    expect(entity(sim, a).abilityCharges?.[REALM_RACERS_ABILITY_ID]).toBeUndefined();
    for (const pid of pids) sim.realmRacersQueueJoin(pid);
    sim.tick();
    expect(match(sim).progress.get(a)?.heldWeapon?.charges).toBe(REALM_RACERS_WEAPON_CHARGES);
  });
});

describe('Ground Blast: landing it in a live race', () => {
  /** Park both machines nose to tail, aim the circle at the rival's feet the way
   *  a player would, and fire. */
  function stagedShot(gap: number) {
    const { sim, a, b } = racing();
    const live = match(sim);
    const caster = entity(sim, a);
    const rival = entity(sim, b);
    caster.facing = 0;
    rival.facing = 0;
    teleport(sim, a, caster.pos.x, caster.pos.z);
    teleport(sim, b, caster.pos.x, caster.pos.z + gap);
    caster.castAim = { x: rival.pos.x, y: rival.pos.y, z: rival.pos.z };
    realmRacersFireGroundBlast(sim.ctx, caster);
    return { sim, a, b, live, caster, rival, shell: live.groundBlasts[0] };
  }

  it('holds the shell until its impact tick, then lands it exactly once', () => {
    const { sim, live, shell } = stagedShot(14);
    expect(live.groundBlasts).toHaveLength(1);
    const flightTicks = shell.impactTick - sim.tickCount;
    expect(flightTicks).toBeGreaterThanOrEqual(GROUND_BLAST_MIN_FLIGHT * TICK_RATE);
    let hits = 0;
    for (let tick = 0; tick < flightTicks + 4; tick++) {
      hits += sim.tick().filter((e) => e.type === 'realmRacersGroundBlastHit').length;
    }
    expect(hits).toBe(1);
    expect(live.groundBlasts).toHaveLength(0);
  });

  it('throws a rival that held its line into the air, off its line and onto ice', () => {
    const { sim, a, b, live, rival, shell } = stagedShot(14);
    const flightTicks = shell.impactTick - sim.tickCount;
    // A yard off the marked centre: near enough to be caught well inside the
    // blast, off-centre enough that the shove has a direction to be in (a hit
    // taken dead on the centre is symmetric and lifts straight up, which the
    // leaf suite above pins on its own).
    teleport(sim, b, rival.pos.x + 1, rival.pos.z);
    let hit: { targetId: number | null; impact: number } | null = null;
    for (let tick = 0; tick <= flightTicks; tick++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'realmRacersGroundBlastHit') hit = ev;
      }
    }
    expect(hit).toMatchObject({ targetId: b, sourceId: a });
    expect(required(hit, 'hit').impact).toBeCloseTo(1 - 1 / GROUND_BLAST_RADIUS, 6);
    expect(rival.onGround).toBe(false);
    expect(rival.vy).toBeGreaterThan(0);
    const lifted = rival.pos.y;
    // Shoved away from the blast, which sits on its left: facing +z, the
    // machine's right is -x, so a push toward +x is negative slip.
    expect(required(rival.drive, 'rival drive').slip).toBeLessThan(0);
    expect(required(rival.drive, 'rival drive').spin).not.toBe(0);
    expect(live.progress.get(b)?.groundBlastShockUntilTick).toBe(
      shell.impactTick + GROUND_BLAST_SHOCK_TICKS,
    );
    expect(
      rival.auras.find((aura) => aura.id === 'realm_racers_ground_blast_control'),
    ).toMatchObject({
      kind: 'slow',
    });
    // No damage: the rally is a race, not a duel.
    expect(rival.hp).toBe(rival.maxHp);

    // The hop is a real trip through the air on the shared vertical pass: it
    // rises, then comes back down and lands, with no fall damage billed for a
    // drop the shell caused.
    // The airtime is 2v/g, so the budget is derived from the pop rather than
    // guessed: raising GROUND_BLAST_POP_VELOCITY must not silently make this vacuous.
    const airTicks = Math.ceil((2 * GROUND_BLAST_POP_VELOCITY) / GRAVITY / (1 / TICK_RATE)) + 4;
    let apex = lifted;
    for (let tick = 0; tick < airTicks && !rival.onGround; tick++) {
      sim.tick();
      apex = Math.max(apex, rival.pos.y);
    }
    expect(apex).toBeGreaterThan(lifted);
    expect(rival.onGround).toBe(true);
    expect(rival.hp).toBe(rival.maxHp);
  });

  it('lets a rival that reacted drive out from under the marker', () => {
    const { sim, b, live, rival, shell } = stagedShot(14);
    const flightTicks = shell.impactTick - sim.tickCount;
    // Sidestep by more than the blast: the same escape a player makes by
    // steering off the marked ground during the flight.
    teleport(sim, b, rival.pos.x + GROUND_BLAST_RADIUS + 2, rival.pos.z);
    let hit: { targetId: number | null } | null = null;
    for (let tick = 0; tick <= flightTicks; tick++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'realmRacersGroundBlastHit') hit = ev;
      }
    }
    // The crater still happens, with nobody in it.
    expect(hit).toMatchObject({ targetId: null, impact: 0 });
    expect(rival.onGround).toBe(true);
    expect(live.progress.get(b)?.groundBlastShockUntilTick).toBe(0);
  });

  it('never catches the caster in its own blast', () => {
    const { sim, a, caster, shell } = stagedShot(4);
    const flightTicks = shell.impactTick - sim.tickCount;
    const before = { ...required(caster.drive, 'caster drive') };
    for (let tick = 0; tick <= flightTicks; tick++) sim.tick();
    expect(caster.onGround).toBe(true);
    expect(match(sim).progress.get(a)?.groundBlastShockUntilTick).toBe(0);
    expect(
      caster.auras.find((aura) => aura.id === 'realm_racers_ground_blast_control'),
    ).toBeUndefined();
    expect(required(caster.drive, 'caster drive').spin).toBe(before.spin);
  });

  it('cuts grip for exactly the shock window, then hands the road back', () => {
    const { sim, b, live, rival } = stagedShot(14);
    const shockUntil = sim.tickCount + 200;
    const progress = required(live.progress.get(b), 'progress');
    // The surface pass runs at the end of every racing tick, so one call is
    // enough to see the shock land on the drive state the kernel reads. It is
    // measured as a RATIO against the same machine unshocked, because the
    // surface it is standing on multiplies in too: a shock on the grass is both.
    updateRealmRacers(sim.ctx);
    const surfaceGrip = required(rival.drive, 'drive').gripMult;
    progress.groundBlastShockUntilTick = shockUntil;
    updateRealmRacers(sim.ctx);
    expect(required(rival.drive, 'drive').gripMult).toBeCloseTo(
      surfaceGrip * GROUND_BLAST_SHOCK_GRIP,
      9,
    );
    // Restored the exact tick it expires on, with nothing left to clean up.
    sim.tickCount = shockUntil;
    updateRealmRacers(sim.ctx);
    expect(required(rival.drive, 'drive').gripMult).toBeCloseTo(surfaceGrip, 9);
  });

  it('resolves identically twice from the same state, and draws no rng', () => {
    const rngDraws = (): number => {
      const { sim, shell } = stagedShot(14);
      const before = sim.rng.next();
      const flightTicks = shell.impactTick - sim.tickCount;
      for (let tick = 0; tick <= flightTicks; tick++) sim.tick();
      return before;
    };
    expect(rngDraws()).toBe(rngDraws());

    const first = stagedShot(14);
    const second = stagedShot(14);
    for (let tick = 0; tick < 12; tick++) {
      first.sim.tick();
      second.sim.tick();
    }
    expect(first.rival.pos).toEqual(second.rival.pos);
    expect(first.rival.drive).toEqual(second.rival.drive);
  });
});
