import { describe, expect, it } from 'vitest';
import { resolvePosition } from '../src/sim/colliders';
import { REALM_RACERS_PRACTICE_CIRCUIT as GARDEN_CIRCUIT } from '../src/sim/content/realm_racers_circuits';
import { DUNGEON_OVERFLOW_X_BASE, YUMI_BAND_X_MAX } from '../src/sim/data';
import { realmRacersColliders } from '../src/sim/realm_racers_colliders';
import {
  REALM_RACERS_APRON_MAX,
  REALM_RACERS_APRON_RADIUS_FRACTION,
  REALM_RACERS_ORIGIN,
  REALM_RACERS_RUNOFF_WIDTH,
  REALM_RACERS_VERGE_MARGIN,
} from '../src/sim/realm_racers_layout';
import {
  rallyBarrierKindAt,
  rallyContainmentGraceAt,
  rallyContainmentLimitAt,
  rallyContainmentLineAt,
  realmRacersTrack,
} from '../src/sim/realm_racers_spline';
import {
  REALM_RACERS_GARDEN_BAND,
  REALM_RACERS_VERGE_BAND,
  REALM_RACERS_WATER_BAND,
  realmRacersSpeedLoss,
} from '../src/sim/social/realm_racers';

const SEED = 42;
const track = realmRacersTrack(GARDEN_CIRCUIT);
const colliders = realmRacersColliders(GARDEN_CIRCUIT);

/** Samples a collider box's outline in world coordinates. */
function outline(collider: (typeof colliders)[number]): { x: number; z: number }[] {
  if (collider.type !== 'obb') throw new Error('rally boundaries are OBBs');
  const cos = Math.cos(collider.rot);
  const sin = Math.sin(collider.rot);
  const points: { x: number; z: number }[] = [];
  for (const lx of [-collider.hw, 0, collider.hw]) {
    for (const lz of [-collider.hd, collider.hd]) {
      points.push({
        x: REALM_RACERS_ORIGIN.x + collider.x + lx * cos + lz * sin,
        z: REALM_RACERS_ORIGIN.z + collider.z - lx * sin + lz * cos,
      });
    }
  }
  return points;
}

describe('Realm Racers boundaries', () => {
  it('never lets a corner cut along the apron beat the road', () => {
    // THE load-bearing property of the whole layout. A racer hugging the apron's
    // inner edge drives an arc of radius (R - apron) at the garden's reduced
    // speed instead of R at full speed, so the cut pays as soon as
    // apron > R * slow. Widening the apron or softening the garden without
    // re-deriving the other breaks the circuit, and fails here.
    // BOTH bands have to pass it, not just the deep one: a shallow cut that
    // stays in the gentle verge saves its own depth and pays only the verge's
    // price, so the verge's width is bounded by the verge's loss.
    const gardenLoss = realmRacersSpeedLoss(REALM_RACERS_GARDEN_BAND);
    const vergeLoss = realmRacersSpeedLoss(REALM_RACERS_VERGE_BAND);
    const waterLoss = realmRacersSpeedLoss(REALM_RACERS_WATER_BAND);
    const vergeDepth = REALM_RACERS_VERGE_MARGIN + REALM_RACERS_RUNOFF_WIDTH;
    let worst = Number.POSITIVE_INFINITY;
    let constrained = 0;
    let waded = 0;
    for (const sample of track.samples) {
      if (!(sample.turnRadius > 0) || !Number.isFinite(sample.turnRadius)) continue;
      const roadTime = sample.turnRadius;
      // Deep cut, along the apron's edge, at the garden's price.
      expect((sample.turnRadius - sample.apron) / (1 - gardenLoss)).toBeGreaterThan(roadTime);
      // Shallow cut, staying inside the verge, at the verge's gentler price.
      expect(
        (sample.turnRadius - Math.min(vergeDepth, sample.apron)) / (1 - vergeLoss),
      ).toBeGreaterThan(roadTime);
      // DEEPEST cut: on through the apron and as far past the containment line
      // as the barrier standing there allows, paying that band's price for the
      // whole arc. Over water the margin buys a racer four more yards of
      // shortcut, so it has to be covered or "the water replaces the wall" is
      // only half true; over anything SOLID the reachable depth is the apron
      // alone, which is the arm above and strictly stronger.
      const grace = rallyContainmentGraceAt(GARDEN_CIRCUIT, sample.s);
      const price = grace > 0 ? waterLoss : gardenLoss;
      expect((sample.turnRadius - sample.apron - grace) / (1 - price)).toBeGreaterThan(roadTime);
      if (rallyBarrierKindAt(GARDEN_CIRCUIT, sample.s) === 'shore') {
        expect(grace, `grace at ${sample.s.toFixed(1)}`).toBeGreaterThan(0);
        waded++;
      } else {
        expect(grace, `grace at ${sample.s.toFixed(1)}`).toBe(0);
      }
      worst = Math.min(worst, sample.turnRadius * gardenLoss - sample.apron);
      if (sample.apron < REALM_RACERS_APRON_MAX - 1e-6) constrained++;
    }
    expect(worst).toBeGreaterThan(0);
    // ...and the cap is not doing all the work: real corners pull the apron in.
    expect(constrained).toBeGreaterThan(20);
    // The practice circuit is all shore, so the wading arm really was the one
    // under test here rather than the cheaper solid one.
    expect(waded).toBeGreaterThan(100);
    expect(REALM_RACERS_APRON_RADIUS_FRACTION).toBeLessThan(gardenLoss);
    // The bands are ordered: running further out always costs more.
    expect(vergeLoss).toBeLessThan(gardenLoss);
    expect(gardenLoss).toBeLessThan(waterLoss);
  });

  it('runs both per-kind arms of the sweep, on a circuit that HAS a barrier', () => {
    // On the all-shore practice circuit above, the solid arm of the sweep is
    // dead code: every sample takes the wading branch. This is the same
    // inequality over a flipped fixture, where both branches are live.
    const gardenLoss = realmRacersSpeedLoss(REALM_RACERS_GARDEN_BAND);
    const waterLoss = realmRacersSpeedLoss(REALM_RACERS_WATER_BAND);
    const flipped = {
      ...GARDEN_CIRCUIT,
      id: 'colliders_sweep_flipped',
      barrierBands: [
        { s: 0, kind: 'shore' },
        { s: 0.05, kind: 'hedge_low' },
        { s: 0.12, kind: 'shore' },
        { s: 0.6, kind: 'wall_low' },
        { s: 0.7, kind: 'shore' },
      ],
    } as const;
    let solidArm = 0;
    let waterArm = 0;
    for (const sample of realmRacersTrack(flipped).samples) {
      if (!(sample.turnRadius > 0) || !Number.isFinite(sample.turnRadius)) continue;
      const grace = rallyContainmentGraceAt(flipped, sample.s);
      const price = grace > 0 ? waterLoss : gardenLoss;
      expect(
        (sample.turnRadius - sample.apron - grace) / (1 - price),
        `at ${sample.s.toFixed(1)}`,
      ).toBeGreaterThan(sample.turnRadius);
      if (rallyBarrierKindAt(flipped, sample.s) === 'shore') waterArm++;
      else {
        // Over a barrier the reachable cut is the apron ALONE, which is the
        // cheaper arm 1 above and strictly stronger than the wading one.
        expect(grace, `grace at ${sample.s.toFixed(1)}`).toBe(0);
        solidArm++;
      }
    }
    // Both arms really ran, which is the whole reason this case exists.
    expect(solidArm).toBeGreaterThan(50);
    expect(waterArm).toBeGreaterThan(200);
  });

  it('only ever TIGHTENS the cut when a span is flipped from water to a barrier', () => {
    // What makes flipping a span safe without re-proving the sweep on the
    // circuit it is flipped on: a solid kind removes grace and never adds any,
    // so every reachable cut depth on the flipped record is at most what the
    // same sample allowed as open shore, and strictly less where it was flipped.
    const flipped = {
      ...GARDEN_CIRCUIT,
      id: 'colliders_flip_tightens',
      barrierBands: [
        { s: 0, kind: 'shore' },
        { s: 0.3, kind: 'hedge_low' },
        { s: 0.45, kind: 'shore' },
      ],
    } as const;
    let tightened = 0;
    for (const sample of track.samples) {
      const before = rallyContainmentLimitAt(GARDEN_CIRCUIT, sample.s);
      const after = rallyContainmentLimitAt(flipped, sample.s);
      expect(after, `limit at ${sample.s.toFixed(1)}`).toBeLessThanOrEqual(before + 1e-12);
      // The LINE itself never moves: the apron rule and every proof written
      // against it are untouched by what stands on it.
      expect(rallyContainmentLineAt(flipped, sample.s)).toBe(
        rallyContainmentLineAt(GARDEN_CIRCUIT, sample.s),
      );
      if (after < before - 1e-9) tightened++;
    }
    expect(tightened).toBeGreaterThan(60);
  });

  it('holds a racer out of the basin past the wading margin', () => {
    // The infield's whole anti-shortcut story, now that the stone rim is gone.
    // A racer slides ALONG the shore rather than being stopped dead, so a bad
    // line into the water costs time instead of ending the moment.
    for (let i = 0; i < track.samples.length; i += 13) {
      const sample = track.samples[i];
      const limit = rallyContainmentLimitAt(GARDEN_CIRCUIT, sample.s);
      // Wading is allowed, right up to the margin.
      for (const offset of [rallyContainmentLineAt(GARDEN_CIRCUIT, sample.s) + 0.5, limit - 0.2]) {
        const x = sample.x - sample.tz * offset;
        const z = sample.z + sample.tx * offset;
        const resolved = resolvePosition(SEED, x, z, 0.5);
        expect(Math.hypot(resolved.x - x, resolved.z - z)).toBeLessThan(1e-6);
      }
      // Past it, no. Including a point right out in the middle of the lake,
      // which is where a cheater aims.
      for (const offset of [limit + 3, limit + 30]) {
        const x = sample.x - sample.tz * offset;
        const z = sample.z + sample.tx * offset;
        const resolved = resolvePosition(SEED, x, z, 0.5);
        const projection = track.project(resolved.x, resolved.z);
        // To the millimetre. The clamp walks back along the PROJECTION's own
        // normal, so the arc position is preserved and the limit it lands on
        // is the limit it was measured against.
        expect(projection.lateral).toBeLessThanOrEqual(
          rallyContainmentLimitAt(GARDEN_CIRCUIT, projection.s) + 1e-3,
        );
        // ...and pushed straight out, not shoved down the circuit: the arc
        // position is what a shortcut would be stealing.
        expect(Math.abs(projection.s - sample.s)).toBeLessThan(track.length / 2);
      }
    }
  });

  it('gives the garden real room while the apron still reaches its cap', () => {
    const aprons = track.samples.map((sample) => sample.apron);
    expect(Math.max(...aprons)).toBeCloseTo(REALM_RACERS_APRON_MAX, 6);
    // The tightest corner keeps a usable apron rather than collapsing onto the
    // road: this is the "you can run wide anywhere" half of the design.
    expect(Math.min(...aprons)).toBeGreaterThan(5);
  });

  it('leaves the whole racing surface clear', () => {
    // The reported "bars in the middle of the track": nothing solid may reach
    // the road, on either side.
    let worst = Number.POSITIVE_INFINITY;
    for (const collider of colliders) {
      for (const point of outline(collider)) {
        const projection = track.project(point.x, point.z);
        worst = Math.min(worst, Math.abs(projection.lateral) - track.halfWidthAt(projection.s));
      }
    }
    expect(worst).toBeGreaterThan(0);
  });

  it('resolves a point on the centerline to itself', () => {
    for (let i = 0; i < track.samples.length; i += 11) {
      const sample = track.samples[i];
      const resolved = resolvePosition(SEED, sample.x, sample.z, 0.5);
      expect(resolved.x).toBeCloseTo(sample.x, 9);
      expect(resolved.z).toBeCloseTo(sample.z, 9);
    }
  });

  it('lets a racer run wide on BOTH sides, right to the water', () => {
    // The whole garden is drivable: a mistake, a nudge or a shell has to be able
    // to put a racer off the road without a wall ending the moment. The circuit
    // has shipped the opposite twice, first with a wall hugging both road edges,
    // then with a stone rim around the basin.
    for (let i = 0; i < track.samples.length; i += 17) {
      const sample = track.samples[i];
      for (const [offset, side] of [
        [track.halfWidthAt(sample.s) + 6, -1],
        [rallyContainmentLineAt(GARDEN_CIRCUIT, sample.s) - 0.5, 1],
      ] as const) {
        const x = sample.x - sample.tz * offset * side;
        const z = sample.z + sample.tx * offset * side;
        const resolved = resolvePosition(SEED, x, z, 0.5);
        expect(Math.hypot(resolved.x - x, resolved.z - z)).toBeLessThan(1e-6);
      }
    }
  });

  it('closes the garden at the perimeter wall, which is the ONLY thing that does', () => {
    // Vacuity guard for the test above: something in this region must still
    // push, or "nothing stopped the racer" would prove nothing (the region used
    // to short-circuit to `return { x, z }` and collide with nothing at all).
    const probe = GARDEN_CIRCUIT.perimeter.halfX - 0.2;
    const pushed = resolvePosition(SEED, REALM_RACERS_ORIGIN.x + probe, REALM_RACERS_ORIGIN.z, 0.5);
    expect(pushed.x - REALM_RACERS_ORIGIN.x).toBeLessThan(probe);
    for (const [x, z] of [
      [GARDEN_CIRCUIT.perimeter.halfX + 4, 0],
      [-GARDEN_CIRCUIT.perimeter.halfX - 4, 0],
      [0, GARDEN_CIRCUIT.perimeter.halfZ + 4],
      [0, -GARDEN_CIRCUIT.perimeter.halfZ - 4],
    ]) {
      const resolved = resolvePosition(
        SEED,
        REALM_RACERS_ORIGIN.x + x,
        REALM_RACERS_ORIGIN.z + z,
        0.5,
      );
      expect(Math.abs(resolved.x - REALM_RACERS_ORIGIN.x)).toBeLessThanOrEqual(
        GARDEN_CIRCUIT.perimeter.halfX + 4,
      );
      expect(Math.abs(resolved.z - REALM_RACERS_ORIGIN.z)).toBeLessThanOrEqual(
        GARDEN_CIRCUIT.perimeter.halfZ + 4,
      );
    }
  });

  it('caches the built set (one build serves every Sim in the process)', () => {
    expect(realmRacersColliders(GARDEN_CIRCUIT)).toBe(colliders);
    // The four perimeter slabs and nothing else: no rim, no hedge, no gantry.
    expect(colliders).toHaveLength(4);
  });

  it('keeps the region envelope strictly inside its reserved instance band', () => {
    expect(REALM_RACERS_ORIGIN.x - GARDEN_CIRCUIT.regionHalfX).toBeGreaterThan(YUMI_BAND_X_MAX);
    expect(REALM_RACERS_ORIGIN.x + GARDEN_CIRCUIT.regionHalfX).toBeLessThan(
      DUNGEON_OVERFLOW_X_BASE - 300,
    );
    // ...and the envelope really does cover every collider, or a racer could be
    // stopped by geometry that collision has already stopped owning.
    for (const collider of colliders) {
      for (const point of outline(collider)) {
        expect(Math.abs(point.x - REALM_RACERS_ORIGIN.x)).toBeLessThan(GARDEN_CIRCUIT.regionHalfX);
        expect(Math.abs(point.z - REALM_RACERS_ORIGIN.z)).toBeLessThan(GARDEN_CIRCUIT.regionHalfZ);
      }
    }
  });

  it('models every boundary as an OBB carrying its visual top', () => {
    for (const collider of colliders) {
      expect(collider.type).toBe('obb');
      if (collider.type !== 'obb') continue;
      expect(collider.hd).toBeGreaterThan(0);
      // The chase camera rides over a wall instead of being pulled inside it.
      expect(collider.cameraTopY).toBeGreaterThan(0);
      // Nothing on the circuit is standable: a racer cannot mantle the wall.
      expect(collider.standable).toBeUndefined();
    }
  });
});
