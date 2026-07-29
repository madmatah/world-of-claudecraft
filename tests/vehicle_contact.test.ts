import { describe, expect, it } from 'vitest';
import { vehicleProfile } from '../src/sim/content/vehicles';
import {
  BUMP_NOSE_BONUS,
  BUMP_SPIN,
  BUMP_SPIN_ATTACKER,
  BUMP_SPIN_VICTIM,
  type ContactBody,
  MAX_BUMP_IMPULSE,
  MAX_BUMP_SPIN,
  resolveVehicleContact,
} from '../src/sim/vehicle_contact';
import { createVehicleDrive, vehicleVelocityX, vehicleVelocityZ } from '../src/sim/vehicle_motion';

// Wheel-to-wheel contact, driven directly. Everything here is the pure leaf:
// the rally module's use of it (the re-clamp through static collision, the
// throttled event) is covered in tests/realm_racers_match.test.ts.

const LOANER = vehicleProfile('rally_loaner');

interface BodyOptions {
  x: number;
  z: number;
  facing?: number;
  speed?: number;
  slip?: number;
  radius?: number;
  mass?: number;
}

function body(opts: BodyOptions): ContactBody {
  const drive = createVehicleDrive('rally_loaner');
  drive.speed = opts.speed ?? 0;
  drive.slip = opts.slip ?? 0;
  return {
    x: opts.x,
    z: opts.z,
    facing: opts.facing ?? 0,
    drive,
    radius: opts.radius ?? LOANER.bodyRadius,
    mass: opts.mass ?? LOANER.mass,
  };
}

const snapshot = (b: ContactBody) => ({
  x: b.x,
  z: b.z,
  speed: b.drive.speed,
  slip: b.drive.slip,
  yawRate: b.drive.yawRate,
  spin: b.drive.spin,
});

const gap = (a: ContactBody, b: ContactBody) => Math.hypot(b.x - a.x, b.z - a.z);

/** World velocity along the contact normal, the axis the impulse acts on. */
const alongNormal = (b: ContactBody, nx: number, nz: number) =>
  vehicleVelocityX(b.drive, b.facing) * nx + vehicleVelocityZ(b.drive, b.facing) * nz;

// Facing 0 points at +z, so a body facing 0 sitting to the left of another has
// the contact normal on its right axis: slip alone drives them together, which
// is what isolates the impulse from the forward scrub in several cases below.
const SIDE_BY_SIDE_NORMAL = { nx: 1, nz: 0 };

describe('vehicle contact', () => {
  it('leaves two machines that are not touching completely alone', () => {
    const a = body({ x: 0, z: 0, speed: 30 });
    const b = body({ x: 2 * LOANER.bodyRadius + 0.01, z: 0, speed: 30 });
    const before = [snapshot(a), snapshot(b)];
    const result = resolveVehicleContact(a, b);
    expect(result.contacted).toBe(false);
    expect(result.impact).toBe(0);
    expect([snapshot(a), snapshot(b)]).toEqual(before);
  });

  it('separates overlapping machines to exactly their combined radii, evenly', () => {
    const a = body({ x: 0, z: 0 });
    const b = body({ x: 2, z: 0 });
    resolveVehicleContact(a, b);
    expect(gap(a, b)).toBeCloseTo(2 * LOANER.bodyRadius, 9);
    // Equal masses give ground equally: each moved half the overlap.
    const moved = 2 * LOANER.bodyRadius - 2;
    expect(a.x).toBeCloseTo(-moved / 2, 9);
    expect(b.x).toBeCloseTo(2 + moved / 2, 9);
    expect(a.z).toBe(0);
    expect(b.z).toBe(0);
  });

  it('costs both machines speed in a head-on, and never produces a NaN', () => {
    const a = body({ x: 0, z: 0, facing: 0, speed: 30 });
    const b = body({ x: 0, z: 3, facing: Math.PI, speed: 30 });
    const result = resolveVehicleContact(a, b);
    expect(result.contacted).toBe(true);
    expect(result.impact).toBeCloseTo(60, 6);
    expect(a.drive.speed).toBeLessThan(30);
    expect(b.drive.speed).toBeLessThan(30);
    expect(a.drive.speed).toBeCloseTo(b.drive.speed, 9); // mirror image
    for (const value of [a.drive.speed, a.drive.slip, b.drive.speed, b.drive.slip, a.x, b.z]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    // The event anchor is the contact point, not either machine.
    expect(result.x).toBeCloseTo(0, 9);
    expect(result.z).toBeCloseTo(1.5, 9);
  });

  it('caps the exchanged impulse however hard the two machines close', () => {
    const { nx, nz } = SIDE_BY_SIDE_NORMAL;
    // Broadside: both machines are stopped and closing purely sideways, so the
    // impulse lands entirely on the lateral axis and is read off it directly
    // (a forward scrub of a standing machine is a no-op).
    const gentle = [body({ x: 0, z: 0, slip: -3 }), body({ x: 3, z: 0, slip: 0 })] as const;
    resolveVehicleContact(gentle[0], gentle[1]);
    const gentleImpulse = alongNormal(gentle[1], nx, nz);
    expect(gentleImpulse).toBeGreaterThan(0);
    expect(gentleImpulse).toBeLessThan(MAX_BUMP_IMPULSE);

    const violent = [body({ x: 0, z: 0, slip: -400 }), body({ x: 3, z: 0, slip: 0 })] as const;
    resolveVehicleContact(violent[0], violent[1]);
    expect(alongNormal(violent[1], nx, nz)).toBeCloseTo(MAX_BUMP_IMPULSE, 9);
  });

  it('pushes a side-by-side rub apart without launching either machine', () => {
    const a = body({ x: 0, z: 0, speed: 30, slip: -2 });
    const b = body({ x: 3, z: 0, speed: 30, slip: 2 });
    resolveVehicleContact(a, b);
    // Opposite lateral velocities: each is pushed out of the other's line.
    expect(a.drive.slip).toBeGreaterThan(0);
    expect(b.drive.slip).toBeLessThan(0);
    expect(a.drive.slip).toBeCloseTo(-b.drive.slip, 9);
    // A rub costs a little speed and nothing more: at a 4 yd/s closing rate
    // neither machine is thrown anywhere.
    expect(a.drive.speed).toBeLessThan(30);
    expect(a.drive.speed).toBeGreaterThan(28);
    expect(Math.abs(a.drive.slip)).toBeLessThan(2);
    expect(Math.abs(b.drive.slip)).toBeLessThan(2);
  });

  it('separates machines already moving apart, but never accelerates them', () => {
    const a = body({ x: 0, z: 0, speed: 20, slip: 4 });
    const b = body({ x: 2.5, z: 0, speed: 20, slip: -4 });
    const drives = [{ ...a.drive }, { ...b.drive }];
    const result = resolveVehicleContact(a, b);
    expect(result.contacted).toBe(true);
    expect(result.impact).toBe(0);
    expect(gap(a, b)).toBeCloseTo(2 * LOANER.bodyRadius, 9);
    expect(a.drive).toEqual(drives[0]);
    expect(b.drive).toEqual(drives[1]);
  });

  it('lets the machine with its nose in the contact keep more of its speed', () => {
    const { nx, nz } = SIDE_BY_SIDE_NORMAL;
    // Read the impulse off a pair that is broadside on both sides, where the
    // scrub cannot reach it (their forward speed is untouched by the normal).
    const gauge = [body({ x: 0, z: 0, slip: -12 }), body({ x: 3, z: 0 })] as const;
    resolveVehicleContact(gauge[0], gauge[1]);
    const impulse = alongNormal(gauge[1], nx, nz);

    // Same closing speed, but A now points its nose straight at B while B stays
    // broadside. The impulse is unchanged (it reads only the closing speed and
    // the masses), so subtracting it leaves each machine's scrub.
    const speed = 25;
    const a = body({ x: 0, z: 0, facing: Math.PI / 2, speed: 12 });
    const b = body({ x: 3, z: 0, facing: 0, speed });
    resolveVehicleContact(a, b);
    const scrubA = 12 - impulse - a.drive.speed;
    const scrubB = speed - b.drive.speed;
    expect(scrubA).toBeGreaterThan(0);
    expect(scrubA).toBeLessThan(scrubB);
    expect(scrubA).toBeCloseTo(scrubB * (1 - BUMP_NOSE_BONUS), 9);

    // Neither nose in the contact: the same closing speed costs both the same.
    const c = body({ x: 0, z: 0, speed, slip: -12 });
    const d = body({ x: 3, z: 0, speed });
    resolveVehicleContact(c, d);
    expect(speed - c.drive.speed).toBeCloseTo(speed - d.drive.speed, 9);
  });

  it('hands scrape yaw to the receiver and lets the aggressor keep their heading', () => {
    // Side by side, same heading: A closes on B from the right (aggressor) and
    // is also faster, so the SCRAPE is the pace difference along the road.
    const scrape = 14;
    const a = body({ x: 0, z: 0, speed: 30 + scrape, slip: -6 });
    const b = body({ x: 3, z: 0, speed: 30 });
    resolveVehicleContact(a, b);
    const kick = BUMP_SPIN * scrape;
    // A is the only body closing along the normal, so it takes the aggressor
    // scale (small push-off) and B takes the full victim yaw (nudged wide).
    expect(a.drive.spin).toBeCloseTo((kick * BUMP_SPIN_ATTACKER) / a.mass, 9);
    expect(b.drive.spin).toBeCloseTo((kick * BUMP_SPIN_VICTIM) / b.mass, 9);
    expect(Math.abs(b.drive.spin)).toBeGreaterThan(Math.abs(a.drive.spin));
    // A on B's right: positive victim kick turns B away from A. A's attacker
    // scale is negative, so A is nudged away from B rather than pulled in.
    expect(b.drive.spin).toBeGreaterThan(0);
    expect(a.drive.spin).toBeLessThan(0);

    // Nose-in dive: A points at B, B is broadside. Same closing feel, A keeps
    // heading, B takes the yaw.
    const diver = body({ x: 0, z: 0, facing: Math.PI / 2, speed: 20 });
    const broadside = body({ x: 3, z: 0, facing: 0, speed: 20 });
    resolveVehicleContact(diver, broadside);
    expect(Math.abs(broadside.drive.spin)).toBeGreaterThan(Math.abs(diver.drive.spin));

    // The same closing speed with no pace difference is a pure push: nothing
    // slides along the contact, so nothing rotates.
    const c = body({ x: 0, z: 0, speed: 30, slip: -6 });
    const d = body({ x: 3, z: 0, speed: 30 });
    resolveVehicleContact(c, d);
    expect(c.drive.spin).toBe(0);
    expect(d.drive.spin).toBe(0);
  });

  it('caps total carried spin, and turns a heavy machine less when roles match', () => {
    const violent = body({ x: 0, z: 0, speed: 400, slip: -2 });
    const parked = body({ x: 3, z: 0 });
    resolveVehicleContact(violent, parked);
    expect(Math.abs(parked.drive.spin)).toBeCloseTo(MAX_BUMP_SPIN, 9);
    expect(Math.abs(violent.drive.spin)).toBeLessThanOrEqual(MAX_BUMP_SPIN);

    // Pre-loaded spin plus another contact must not exceed the ceiling: the
    // clamp is on the TOTAL, not on each added delta alone.
    const stacked = body({ x: 0, z: 0, speed: 80, slip: -4 });
    const target = body({ x: 3, z: 0, speed: 20 });
    stacked.drive.spin = MAX_BUMP_SPIN - 0.1;
    resolveVehicleContact(stacked, target);
    expect(Math.abs(stacked.drive.spin)).toBeLessThanOrEqual(MAX_BUMP_SPIN);
    expect(Math.abs(target.drive.spin)).toBeLessThanOrEqual(MAX_BUMP_SPIN);

    // Equal aggressor weight (both lean in) with a pace scrape: mass alone
    // decides the spin split.
    const light = body({ x: 0, z: 0, speed: 50, slip: -6, mass: 1 });
    const heavy = body({ x: 3, z: 0, speed: 30, slip: 6, mass: 2 });
    resolveVehicleContact(light, heavy);
    expect(light.drive.spin).toBeCloseTo(heavy.drive.spin * 2, 9);
  });

  it('resolves an exact overlap deterministically', () => {
    const run = () => {
      const a = body({ x: 5, z: 5, facing: 0.7, speed: 18 });
      const b = body({ x: 5, z: 5, facing: 2.1, speed: 18 });
      const result = resolveVehicleContact(a, b);
      return { result, a: snapshot(a), b: snapshot(b) };
    };
    const first = run();
    expect(first.result.contacted).toBe(true);
    expect(gap(body({ ...first.a, facing: 0 }), body({ ...first.b, facing: 0 }))).toBeCloseTo(
      2 * LOANER.bodyRadius,
      9,
    );
    for (const value of Object.values(first.a)) expect(Number.isFinite(value)).toBe(true);
    expect(run()).toEqual(first);
  });

  it('conserves momentum along the normal and mirrors when the pair is swapped', () => {
    const { nx, nz } = SIDE_BY_SIDE_NORMAL;
    // Both broadside and stopped: the scrub has no forward speed to take, so
    // what is left is the impulse alone and it must balance exactly.
    const a = body({ x: 0, z: 0, slip: -14 });
    const b = body({ x: 2.4, z: 0, slip: -2 });
    const before = alongNormal(a, nx, nz) + alongNormal(b, nx, nz);
    resolveVehicleContact(a, b);
    expect(alongNormal(a, nx, nz) + alongNormal(b, nx, nz)).toBeCloseTo(before, 9);

    // Swapping the pair mirrors the result rather than changing it: the racer
    // order comes from the match, and it may not decide who gets shoved.
    const c = body({ x: 0, z: 0, slip: -14 });
    const d = body({ x: 2.4, z: 0, slip: -2 });
    resolveVehicleContact(d, c);
    expect(snapshot(c)).toEqual(snapshot(a));
    expect(snapshot(d)).toEqual(snapshot(b));
  });

  it('shoves the lighter machine further and faster, in proportion to the ratio', () => {
    const { nx, nz } = SIDE_BY_SIDE_NORMAL;
    // Closing gently enough that the impulse ceiling never bites: what is
    // measured here is the mass split itself, not the cap.
    const shove = (massA: number, massB: number) => {
      const a = body({ x: 0, z: 0, slip: -8, mass: massA });
      const b = body({ x: 2.4, z: 0, mass: massB });
      const before = [alongNormal(a, nx, nz), alongNormal(b, nx, nz)];
      resolveVehicleContact(a, b);
      return {
        movedA: -a.x,
        movedB: b.x - 2.4,
        slowedA: before[0] - alongNormal(a, nx, nz),
        pushedB: alongNormal(b, nx, nz) - before[1],
      };
    };
    const uneven = shove(1, 2);
    expect(uneven.movedA).toBeCloseTo(uneven.movedB * 2, 9);
    expect(uneven.slowedA).toBeCloseTo(uneven.pushedB * 2, 9);
    expect(uneven.slowedA).toBeGreaterThan(0);
    expect(uneven.slowedA).toBeLessThan(MAX_BUMP_IMPULSE);

    // ...and equal masses collapse the same formula onto an even split, so a
    // roster of machines with different masses is a data change, not a rewrite.
    const even = shove(1, 1);
    expect(even.movedA).toBeCloseTo(even.movedB, 9);
    expect(even.slowedA).toBeCloseTo(even.pushedB, 9);
  });

  it('produces byte-identical output from the same input twice', () => {
    const run = () => {
      const a = body({ x: -1.2, z: 0.4, facing: 1.1, speed: 34, slip: -5 });
      const b = body({ x: 0.9, z: 1.6, facing: 0.3, speed: 21, slip: 2 });
      const result = resolveVehicleContact(a, b);
      return { result, a: snapshot(a), b: snapshot(b) };
    };
    expect(run()).toEqual(run());
  });
});
