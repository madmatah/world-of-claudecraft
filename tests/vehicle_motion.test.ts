import { describe, expect, it } from 'vitest';
import { type VehicleProfile, vehicleProfile } from '../src/sim/content/vehicles';
import { type PlayerMotionDeps, stepPlayerMotion } from '../src/sim/player_motion';
import { REALM_RACERS_ORIGIN } from '../src/sim/realm_racers_layout';
import { DT, type Entity, type MoveInput, type VehicleDrive } from '../src/sim/types';
import {
  advanceVehicleDrive,
  applyAchievedVehicleVelocity,
  createVehicleDrive,
  resetVehicleDrive,
  steerAuthority,
  type VehicleStepInput,
  vehicleVelocityX,
  vehicleVelocityZ,
} from '../src/sim/vehicle_motion';

// The driving model, driven directly. Everything here is the PURE half
// (src/sim/vehicle_motion.ts) except the two cases that only exist once the
// kernel composes it with collision: the wall scrape and the handbrake reaching
// the model through the shared movement entry point.

const LOANER = vehicleProfile('rally_loaner');

const controls = (over: Partial<VehicleStepInput> = {}): VehicleStepInput => ({
  throttle: 0,
  steer: 0,
  handbrake: false,
  onGround: true,
  auraMult: 1,
  ...over,
});

/** Advance a drive state N ticks under one held control set; returns the yaw
 *  the caller would have integrated, so the rotation half is observable too. */
function run(
  drive: VehicleDrive,
  ticks: number,
  over: Partial<VehicleStepInput> = {},
  profile: VehicleProfile = LOANER,
): number {
  let facing = 0;
  for (let i = 0; i < ticks; i++) facing += advanceVehicleDrive(drive, profile, controls(over));
  return facing;
}

const mi = (over: Partial<MoveInput> = {}): MoveInput => ({
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
  jump: false,
  ...over,
});

// A pilot standing on the rally's instanced floor, where the kernel's
// horizontal step routes through PlayerMotionDeps.resolveMove and is therefore
// stubbable without a world.
function pilot(): Entity {
  return {
    pos: { x: REALM_RACERS_ORIGIN.x, y: 0, z: REALM_RACERS_ORIGIN.z },
    prevPos: { x: REALM_RACERS_ORIGIN.x, y: 0, z: REALM_RACERS_ORIGIN.z },
    facing: 0,
    onGround: true,
    jumping: false,
    vx: 0,
    vy: 0,
    vz: 0,
    fallStartY: 0,
    auras: [],
    sitting: false,
    maxHp: 100,
    mountKey: 'terrorspark_groundshaker',
    drive: createVehicleDrive('rally_loaner'),
  } as unknown as Entity;
}

function kernelDeps(
  resolveMove: PlayerMotionDeps['resolveMove'] = (_fx, _fz, nx, nz) => ({ x: nx, z: nz }),
): PlayerMotionDeps {
  return {
    seed: 1,
    moveSpeedMult: () => 1,
    resolveMove,
    resolvedAbility: () => null,
    cancelCast: () => {},
    standUp: () => {},
    dealDamage: () => {},
  };
}

describe('the vehicle driving model', () => {
  it('spools up to nearly top speed under full throttle, gradually and without exceeding it', () => {
    const drive = createVehicleDrive('rally_loaner');
    let ticksTo90 = -1;
    for (let tick = 0; tick < 20 * 12; tick++) {
      advanceVehicleDrive(drive, LOANER, controls({ throttle: 1 }));
      expect(drive.speed).toBeLessThanOrEqual(LOANER.maxSpeed);
      if (ticksTo90 < 0 && drive.speed >= LOANER.maxSpeed * 0.9) ticksTo90 = tick + 1;
    }
    // A pull, not a snap: comfortably more than a few ticks, comfortably less
    // than a lap. The first second must already carry real speed.
    expect(ticksTo90).toBeGreaterThan(20 * 2);
    expect(ticksTo90).toBeLessThan(20 * 6);
    expect(drive.speed).toBeGreaterThan(LOANER.maxSpeed * 0.9);
  });

  it('brakes to a stop in a short distance and never overshoots into reverse', () => {
    const drive = createVehicleDrive('rally_loaner');
    run(drive, 20 * 12, { throttle: 1 });
    const entrySpeed = drive.speed;
    let distance = 0;
    let ticks = 0;
    while (drive.speed > 0 && ticks < 20 * 10) {
      advanceVehicleDrive(drive, LOANER, controls({ throttle: -1 }));
      expect(drive.speed).toBeGreaterThanOrEqual(0); // braking never becomes reverse
      distance += drive.speed * DT;
      ticks++;
    }
    expect(drive.speed).toBe(0);
    // Bounded by the profile, not by a hand-picked number of ticks: braking
    // alone would take entry/brakeDecel seconds and cover entry^2/2a yards, and
    // drag can only make both smaller. The lower bound is what fails a machine
    // that simply teleports to a standstill.
    expect(ticks).toBeLessThanOrEqual(Math.ceil(entrySpeed / LOANER.brakeDecel / DT));
    const brakingDistance = entrySpeed ** 2 / (2 * LOANER.brakeDecel);
    expect(distance).toBeLessThanOrEqual(brakingDistance);
    expect(distance).toBeGreaterThan(brakingDistance * 0.5);
  });

  it('reverses from a standstill, capped at the profile reverse speed', () => {
    const drive = createVehicleDrive('rally_loaner');
    run(drive, 20 * 10, { throttle: -1 });
    expect(drive.speed).toBeLessThan(0);
    expect(drive.speed).toBeGreaterThanOrEqual(-LOANER.reverseMax);
    expect(Math.abs(drive.speed + LOANER.reverseMax)).toBeLessThan(1);
  });

  it('coasts down monotonically and settles at a standstill', () => {
    const drive = createVehicleDrive('rally_loaner');
    run(drive, 20 * 12, { throttle: 1 });
    let previous = drive.speed;
    for (let tick = 0; tick < 20 * 30; tick++) {
      advanceVehicleDrive(drive, LOANER, controls());
      expect(drive.speed).toBeLessThanOrEqual(previous);
      expect(drive.speed).toBeGreaterThanOrEqual(0); // never rolls backwards on its own
      previous = drive.speed;
    }
    expect(drive.speed).toBe(0);
  });

  it('gives no steering authority at rest, most in the mid range and less at top speed', () => {
    expect(steerAuthority(0)).toBe(0);
    expect(steerAuthority(0.35)).toBeCloseTo(1, 6);
    expect(steerAuthority(1)).toBeLessThan(steerAuthority(0.35));
    expect(steerAuthority(1)).toBeGreaterThan(0);

    // The same taper as the model actually applies, measured on yaw rate.
    const yawAt = (speed: number): number => {
      const drive = createVehicleDrive('rally_loaner');
      drive.speed = speed;
      // Held long enough for the yaw response to settle on its target.
      for (let tick = 0; tick < 20; tick++) {
        advanceVehicleDrive(drive, LOANER, controls({ steer: 1 }));
        drive.speed = speed; // hold the speed: this measures steering, not drag
      }
      return drive.yawRate;
    };
    const standing = yawAt(0);
    const mid = yawAt(LOANER.maxSpeed * 0.35);
    const flat = yawAt(LOANER.maxSpeed);
    expect(Math.abs(standing)).toBeLessThan(1e-9);
    expect(mid).toBeGreaterThan(flat);
    expect(flat).toBeGreaterThan(0);
  });

  it('holds a cornering line on the road and breaks it loose on the handbrake', () => {
    // What the handbrake DOES is cut grip, so the measurement is how much of a
    // slide survives once the steering goes neutral. Comparing the peaks of the
    // two slides would measure the profile's slide CEILING instead: at racing
    // speed both saturate it, and a saturated comparison says nothing about
    // grip at all.
    const slide = (handbrake: boolean): { kept: number; travelOff: number } => {
      const drive = createVehicleDrive('rally_loaner');
      run(drive, 20 * 12, { throttle: 1 });
      let facing = run(drive, 12, { throttle: 1, steer: 1, handbrake });
      const peak = Math.abs(drive.slip);
      facing += run(drive, 10, { handbrake }); // half a second, steering neutral
      const travel = Math.atan2(vehicleVelocityX(drive, facing), vehicleVelocityZ(drive, facing));
      return {
        kept: Math.abs(drive.slip) / peak,
        travelOff: Math.abs(Math.atan2(Math.sin(travel - facing), Math.cos(travel - facing))),
      };
    };
    const road = slide(false);
    const pulled = slide(true);
    // On the road the grip eats most of the slide in half a second.
    expect(road.kept).toBeLessThan(0.6);
    // Held, the handbrake keeps the machine loose for as long as the player
    // wants it loose, and it is visibly travelling across its own nose.
    expect(pulled.kept).toBeGreaterThan(0.9);
    expect(pulled.travelOff).toBeGreaterThan(road.travelOff * 2);
    expect(pulled.travelOff).toBeGreaterThan(0.25); // over 14 degrees of drift
  });

  it('bleeds a slide away at the profile grip rate once the steering is neutral', () => {
    const drive = createVehicleDrive('rally_loaner');
    drive.speed = 20;
    drive.slip = 6;
    advanceVehicleDrive(drive, LOANER, controls());
    // One tick of pure exponential decay at the road grip (the yaw rate is 0,
    // so the body rotation leaves the components alone).
    expect(drive.slip).toBeCloseTo(6 * Math.exp(-LOANER.roadGrip * DT), 6);
    // ...and the window to settle comes from that same rate rather than a
    // hand-picked second, so re-tuning the grip cannot silently invalidate it.
    const ticksToSettle = Math.ceil(Math.log(20) / LOANER.roadGrip / DT);
    for (let tick = 0; tick < ticksToSettle; tick++) advanceVehicleDrive(drive, LOANER, controls());
    expect(Math.abs(drive.slip)).toBeLessThan(6 * 0.05);
  });

  it('reads the surface: a loose, draggy runoff slows a machine and holds its slide', () => {
    const settled = (gripMult: number, dragMult: number): { speed: number; kept: number } => {
      const drive = createVehicleDrive('rally_loaner');
      drive.gripMult = gripMult;
      drive.dragMult = dragMult;
      run(drive, 20 * 12, { throttle: 1 });
      run(drive, 12, { throttle: 1, steer: 1 });
      const peak = Math.abs(drive.slip);
      run(drive, 10, { throttle: 1 });
      return { speed: drive.speed, kept: Math.abs(drive.slip) / peak };
    };
    const road = settled(1, 1);
    const runoff = settled(0.45, 3);
    // Draggier: a real price, though a strong engine narrows it (the band's
    // slow aura owns the top-speed half of the penalty, not this).
    expect(runoff.speed).toBeLessThan(road.speed * 0.95);
    // Looser: the same slide survives markedly longer on it.
    expect(runoff.kept).toBeGreaterThan(road.kept * 1.4);

    // Back on the road, the same state recovers rather than staying punished.
    const drive = createVehicleDrive('rally_loaner');
    drive.gripMult = 0.45;
    drive.dragMult = 3;
    run(drive, 20 * 12, { throttle: 1 });
    const offRoad = drive.speed;
    drive.gripMult = 1;
    drive.dragMult = 1;
    run(drive, 20 * 6, { throttle: 1 });
    expect(drive.speed).toBeGreaterThan(offRoad);
  });

  it('sinks onto a ceiling that drops under it, instead of snapping to it', () => {
    // Driving off the circuit (or taking a snare) drops the ceiling by more than
    // a third of the machine's speed in one tick. Assigning it outright deletes
    // 22 yd/s between two frames, which reads as hitting a wall rather than as
    // ground going soft; capDecel is what turns that into a fall the player can
    // see and correct.
    const drive = createVehicleDrive('rally_loaner');
    run(drive, 20 * 12, { throttle: 1 });
    const roadSpeed = drive.speed;
    const ceiling = LOANER.maxSpeed * 0.6;
    expect(roadSpeed - ceiling).toBeGreaterThan(LOANER.capDecel * DT * 3); // a real drop

    let previous = roadSpeed;
    let ticksToCeiling = -1;
    for (let tick = 0; tick < 20 * 4; tick++) {
      advanceVehicleDrive(drive, LOANER, controls({ throttle: 1, auraMult: 0.6 }));
      // No tick may fall faster than the profile allows (drag rides on top of
      // it, so the bound carries the surface's own braking too).
      const worstDrag = (LOANER.rollDrag + LOANER.airDrag * previous) * drive.dragMult * DT;
      expect(previous - drive.speed).toBeLessThanOrEqual(LOANER.capDecel * DT + worstDrag + 1e-9);
      if (ticksToCeiling < 0 && drive.speed <= ceiling) ticksToCeiling = tick + 1;
      previous = drive.speed;
    }
    // ...and it really does land on the ceiling, in about the time the rate says.
    expect(ticksToCeiling).toBeGreaterThan(1);
    expect(ticksToCeiling).toBeLessThanOrEqual(
      Math.ceil((roadSpeed - ceiling) / LOANER.capDecel / DT),
    );
    expect(drive.speed).toBeLessThanOrEqual(ceiling);

    // On a clean road the rate is INERT: the engine never exceeds its own
    // ceiling, so nothing about ordinary driving passes through this arm.
    const clean = createVehicleDrive('rally_loaner');
    run(clean, 20 * 12, { throttle: 1 });
    expect(clean.speed).toBe(roadSpeed);
    expect(clean.speed).toBeLessThanOrEqual(LOANER.maxSpeed);
  });

  it('caps the top speed when a snare bites, without taxing the engine twice', () => {
    const snared = createVehicleDrive('rally_loaner');
    run(snared, 20 * 20, { throttle: 1, auraMult: 0.48 });
    const clean = createVehicleDrive('rally_loaner');
    run(clean, 20 * 20, { throttle: 1 });
    expect(snared.speed).toBeLessThanOrEqual(LOANER.maxSpeed * 0.48);
    expect(snared.speed).toBeGreaterThan(LOANER.maxSpeed * 0.48 * 0.85);
    expect(snared.speed).toBeLessThan(clean.speed * 0.55);

    // The engine itself is NOT scaled, deliberately: a snare caps a runner's
    // speed rather than their acceleration, and scaling both would let a heavy
    // surface out-drag the engine and strand a snared machine outright.
    const cleanStart = createVehicleDrive('rally_loaner');
    const snaredStart = createVehicleDrive('rally_loaner');
    advanceVehicleDrive(cleanStart, LOANER, controls({ throttle: 1 }));
    advanceVehicleDrive(snaredStart, LOANER, controls({ throttle: 1, auraMult: 0.48 }));
    expect(snaredStart.speed).toBeCloseTo(cleanStart.speed, 9);

    // The worst band in the game (harshest snare on the draggiest surface)
    // still moves a machine off a standstill and keeps it moving.
    const worst = createVehicleDrive('rally_loaner');
    worst.gripMult = 0.35;
    worst.dragMult = 4;
    run(worst, 20 * 20, { throttle: 1, auraMult: 0.4 });
    expect(worst.speed).toBeGreaterThan(4);
  });

  it('keeps its momentum airborne: no throttle, no grip, the velocity vector preserved', () => {
    const drive = createVehicleDrive('rally_loaner');
    run(drive, 20 * 12, { throttle: 1 });
    run(drive, 20, { throttle: 1, steer: 1 }); // enter the air mid-drift
    const facing = 0;
    const beforeX = vehicleVelocityX(drive, facing);
    const beforeZ = vehicleVelocityZ(drive, facing);
    const yaw = run(drive, 10, { throttle: 1, steer: 1, onGround: false });
    // The world velocity is untouched in both magnitude and direction: no
    // throttle, no drag, no grip once the wheels leave the ground.
    expect(vehicleVelocityX(drive, facing + yaw)).toBeCloseTo(beforeX, 6);
    expect(vehicleVelocityZ(drive, facing + yaw)).toBeCloseTo(beforeZ, 6);
    expect(Math.hypot(drive.speed, drive.slip)).toBeCloseTo(Math.hypot(beforeX, beforeZ), 6);
    // The BODY still rotated under that fixed velocity (air steering), which is
    // what makes the components move while the vector does not.
    expect(Math.abs(yaw)).toBeGreaterThan(0);
  });

  it('is deterministic and draws nothing from a clock or an rng', () => {
    const trace = (): string => {
      const drive = createVehicleDrive('rally_loaner');
      const out: number[] = [];
      for (let tick = 0; tick < 200; tick++) {
        const yaw = advanceVehicleDrive(
          drive,
          LOANER,
          controls({
            throttle: tick < 120 ? 1 : -1,
            steer: tick % 3 === 0 ? 1 : -1,
            handbrake: tick > 60 && tick < 90,
            onGround: tick < 150 || tick > 160,
          }),
        );
        out.push(drive.speed, drive.slip, drive.yawRate, drive.handbrake, yaw);
      }
      return JSON.stringify(out);
    };
    expect(trace()).toBe(trace());
  });

  it('takes every handling number from the profile, never from the module', () => {
    const brisk: VehicleProfile = { ...LOANER, engineAccel: LOANER.engineAccel * 2 };
    const stock = createVehicleDrive('rally_loaner');
    const quick = createVehicleDrive('rally_loaner');
    run(stock, 10, { throttle: 1 });
    run(quick, 10, { throttle: 1 }, brisk);
    expect(quick.speed).toBeGreaterThan(stock.speed * 1.8);

    const gripless: VehicleProfile = { ...LOANER, roadGrip: LOANER.roadGrip / 4 };
    const held = createVehicleDrive('rally_loaner');
    const loose = createVehicleDrive('rally_loaner');
    held.speed = 20;
    loose.speed = 20;
    held.slip = 6;
    loose.slip = 6;
    advanceVehicleDrive(held, LOANER, controls());
    advanceVehicleDrive(loose, gripless, controls());
    expect(Math.abs(loose.slip)).toBeGreaterThan(Math.abs(held.slip));
  });

  it('zeroes the motion on reset without touching the surface under the machine', () => {
    const drive = createVehicleDrive('rally_loaner');
    run(drive, 20 * 5, { throttle: 1, steer: 1, handbrake: true });
    drive.gripMult = 0.5;
    drive.dragMult = 3;
    resetVehicleDrive(drive);
    expect(drive.speed).toBe(0);
    expect(drive.slip).toBe(0);
    expect(drive.yawRate).toBe(0);
    expect(drive.handbrake).toBe(0);
    expect(drive.gripMult).toBe(0.5);
    expect(drive.dragMult).toBe(3);
  });
});

describe('the vehicle arm of the movement kernel', () => {
  it('slides along a wall it scrapes and stops dead against one it hits head on', () => {
    // A wall lying across +z: the solver keeps the x component and clamps z.
    const wallZ = REALM_RACERS_ORIGIN.z + 0.5;
    const deps = kernelDeps((_fx, _fz, nx, nz) => ({ x: nx, z: Math.min(nz, wallZ) }));

    const scraper = pilot();
    scraper.facing = Math.PI / 4; // 45 degrees into the wall
    (scraper.drive as VehicleDrive).speed = 20;
    stepPlayerMotion(deps, scraper, mi());
    const drive = scraper.drive as VehicleDrive;
    // The drive velocity is exactly what the sweep achieved, re-derived: the
    // into-the-wall half is gone, the along-the-wall half survives.
    const achievedX = (scraper.pos.x - REALM_RACERS_ORIGIN.x) / DT;
    const achievedZ = (scraper.pos.z - REALM_RACERS_ORIGIN.z) / DT;
    const check = createVehicleDrive('rally_loaner');
    applyAchievedVehicleVelocity(check, scraper.facing, achievedX, achievedZ);
    expect(drive.speed).toBeCloseTo(check.speed, 9);
    expect(drive.slip).toBeCloseTo(check.slip, 9);
    expect(Math.hypot(drive.speed, drive.slip)).toBeGreaterThan(5); // it kept moving
    expect(Math.hypot(drive.speed, drive.slip)).toBeLessThan(20); // but paid for the angle

    const headOn = pilot();
    headOn.facing = 0; // straight at the wall
    (headOn.drive as VehicleDrive).speed = 20;
    stepPlayerMotion(deps, headOn, mi());
    expect(
      Math.hypot((headOn.drive as VehicleDrive).speed, (headOn.drive as VehicleDrive).slip),
    ).toBeLessThan(11); // clamped to the half yard of gap, in one tick
  });

  it('reads Space as the handbrake and the turn or strafe keys as steering', () => {
    const braking = pilot();
    (braking.drive as VehicleDrive).speed = 20;
    const rolling = pilot();
    (rolling.drive as VehicleDrive).speed = 20;
    stepPlayerMotion(kernelDeps(), braking, mi({ jump: true }));
    stepPlayerMotion(kernelDeps(), rolling, mi());
    // The handbrake bites longitudinally and reads as engaged for the visuals.
    expect((braking.drive as VehicleDrive).speed).toBeLessThan(
      (rolling.drive as VehicleDrive).speed,
    );
    expect((braking.drive as VehicleDrive).handbrake).toBeGreaterThan(0);
    expect((rolling.drive as VehicleDrive).handbrake).toBe(0);

    for (const key of ['turnLeft', 'strafeLeft'] as const) {
      const steering = pilot();
      (steering.drive as VehicleDrive).speed = 12;
      for (let tick = 0; tick < 10; tick++) {
        stepPlayerMotion(kernelDeps(), steering, mi({ [key]: true }));
      }
      expect(steering.facing).toBeGreaterThan(0); // left turns increase facing
    }
  });

  it('turns the machine on a contact spin, and lets it decay rather than steering it back', () => {
    const drive = createVehicleDrive('rally_loaner');
    drive.speed = 30;
    drive.spin = 2.4;
    // No steering input at all: every degree here comes from the spin.
    const firstTick = advanceVehicleDrive(drive, LOANER, controls());
    expect(firstTick).toBeCloseTo(2.4 * DT, 9);
    expect(drive.spin).toBeCloseTo(2.4 * Math.exp(-LOANER.spinDecay * DT), 9);
    // The steering servo is NOT what removes it: yawRate stays at the wheel's
    // demand (nothing) throughout, so a spin cannot be cancelled by letting go.
    expect(drive.yawRate).toBe(0);

    let turned = firstTick;
    for (let tick = 0; tick < 60; tick++) turned += advanceVehicleDrive(drive, LOANER, controls());
    // The whole kick is spent as heading, and how MUCH heading is the sum of a
    // geometric series the kernel never computes: kick x DT over one minus the
    // per-tick decay (three seconds in, the tail left is under a few hundredths).
    const expected = (2.4 * DT) / (1 - Math.exp(-LOANER.spinDecay * DT));
    expect(turned).toBeCloseTo(expected, 1);
    expect(turned).toBeGreaterThan(1.4);
    expect(turned).toBeLessThan(1.6);
    expect(Math.abs(drive.spin)).toBeLessThan(0.03);
  });

  it('puts a spun machine sideways: the body turns under a velocity that does not', () => {
    const spun = createVehicleDrive('rally_loaner');
    spun.speed = 30;
    spun.spin = 1.2;
    const straight = createVehicleDrive('rally_loaner');
    straight.speed = 30;
    for (let tick = 0; tick < 6; tick++) {
      advanceVehicleDrive(spun, LOANER, controls());
      advanceVehicleDrive(straight, LOANER, controls());
    }
    // The velocity keeps pointing where it pointed while the body turns under
    // it, which is what being sideways IS: forward speed has become slide, and
    // the machine still carries nearly all the pace of the one nobody touched
    // (what little is missing is the grip eating the slide, not a brake).
    expect(Math.abs(spun.slip)).toBeGreaterThan(4);
    expect(straight.slip).toBe(0);
    expect(spun.speed).toBeLessThan(straight.speed);
    expect(Math.hypot(spun.speed, spun.slip)).toBeGreaterThan(0.97 * straight.speed);
  });

  it('holds a spin off the grid: the start lock zeroes it with the rest of the motion', () => {
    const drive = createVehicleDrive('rally_loaner');
    expect(drive.spin).toBe(0);
    drive.spin = 2;
    drive.speed = 10;
    resetVehicleDrive(drive);
    expect(drive.spin).toBe(0);
  });

  it('never jumps: the jump arm of the vertical pass is held down while driving', () => {
    const pilotEntity = pilot();
    for (let tick = 0; tick < 20; tick++) {
      stepPlayerMotion(kernelDeps(), pilotEntity, mi({ jump: true, forward: true }));
      expect(pilotEntity.onGround).toBe(true);
      expect(pilotEntity.vy).toBe(0);
    }
  });
});
