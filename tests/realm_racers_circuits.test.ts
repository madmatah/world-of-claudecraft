// The circuit RECORDS and the lane table: what says a circuit is well formed,
// where each one stands in the instance band, which pool it belongs to, and
// that turning one authored circuit into a table of them changed no geometry.
//
// The behavior-preserving suite below is the load-bearing one. Its numbers were
// computed from the PRE-MOVE code (the single-circuit `realm_racers_layout.ts`
// plus its spline, read out of git and run on their own) and pasted here, so
// they are evidence rather than a snapshot of the code that has to satisfy
// them: re-deriving them from today's records would pass no matter what the
// move broke.

import { describe, expect, it, vi } from 'vitest';
import {
  REALM_RACERS_CIRCUIT_LIST,
  REALM_RACERS_CIRCUITS,
  REALM_RACERS_PRACTICE_CIRCUIT,
  REALM_RACERS_PRACTICE_CIRCUIT_ID,
  realmRacersCircuitById,
  realmRacersCompetitionCircuits,
} from '../src/sim/content/realm_racers_circuits';
import { vehicleProfile } from '../src/sim/content/vehicles';
import { polygonContainsPoint } from '../src/sim/geometry2d';
import {
  REALM_RACERS_MIN_STRETCH_SEPARATION,
  realmRacersCircuitErrors,
  realmRacersCircuitMetrics,
} from '../src/sim/realm_racers_circuit_metrics';
import { realmRacersGroundShape } from '../src/sim/realm_racers_ground';
import {
  REALM_RACERS_GATE_SNAP_FRACTION,
  REALM_RACERS_GATE_SPACING,
  REALM_RACERS_GRID_SIZE,
  REALM_RACERS_LANE_CLEARANCE,
  REALM_RACERS_LANE_DZ,
  REALM_RACERS_LANES,
  REALM_RACERS_LAWN_OVERSHOOT,
  REALM_RACERS_MAX_REGION_HALF_X,
  REALM_RACERS_MAX_REGION_HALF_Z,
  REALM_RACERS_MIN_GATES,
  REALM_RACERS_MIN_HALF_WIDTH,
  REALM_RACERS_ORIGIN,
  realmRacersLaneAt,
  realmRacersLaneOffset,
  realmRacersPracticeLanes,
  realmRacersPublicLane,
} from '../src/sim/realm_racers_layout';
import {
  realmRacersPlacedPonds,
  realmRacersPlacements,
} from '../src/sim/realm_racers_props_resolve';
import {
  rallyGardenEdgeOffsetAt,
  realmRacersGates,
  realmRacersStarts,
  realmRacersTrack,
} from '../src/sim/realm_racers_spline';
import type { Sim } from '../src/sim/sim';
import {
  REALM_RACERS_CHASE_TICKS,
  type RealmRacersMatch,
  type RealmRacersProgress,
  realmRacersCircuitOf,
  realmRacersMatchOf,
  realmRacersStartMatch,
} from '../src/sim/social/realm_racers';
import { startRealmRacersDevRace } from '../src/sim/social/realm_racers_bots';
import { TICK_RATE } from '../src/sim/types';
import { addAt, makeWorld, readyAllRacers } from './realm_racers_util';

const GARDEN = REALM_RACERS_PRACTICE_CIRCUIT;

describe('Realm Racers circuits: the move preserved the garden circuit exactly', () => {
  // Every literal in this block was produced by the single-circuit code at
  // commit HEAD~, before the records existed.
  it('derives the same lap, sample count and step', () => {
    const track = realmRacersTrack(GARDEN);
    expect(track.length).toBeCloseTo(454.2988537163012, 10);
    expect(track.step).toBeCloseTo(1.0006582680975797, 12);
    expect(track.samples).toHaveLength(454);
  });

  // The gate pin that stood here is deliberately GONE. It held the eight
  // evenly spaced recovery anchors the record used to author, computed from the
  // pre-records code, as evidence that splitting one circuit into a table of
  // them changed no geometry. The anchors are derived from the curve now
  // (nothing about where one sits was ever a design decision), so that pin
  // holds a rule the tree no longer has. The three blocks around it still prove
  // the move: the lap, the start row, and the width and apron profile.

  it('derives the same four-abreast start row', () => {
    const before = [
      [113691.14013108554, -61.5798895747676, 1.5521876090491882],
      [113691.04709286665, -56.58075526072639, 1.5521876090491882],
      [113690.95405464774, -51.58162094668518, 1.5521876090491882],
      [113690.86101642884, -46.58248663264397, 1.5521876090491882],
    ];
    const starts = realmRacersStarts(GARDEN);
    expect(starts).toHaveLength(before.length);
    starts.forEach((slot, i) => {
      const [x, z, facing] = before[i];
      expect(slot.x, `slot ${i} x`).toBeCloseTo(x, 10);
      expect(slot.z, `slot ${i} z`).toBeCloseTo(z, 10);
      expect(slot.facing, `slot ${i} facing`).toBeCloseTo(facing, 12);
    });
  });

  it('derives the same road width around the lap', () => {
    const track = realmRacersTrack(GARDEN);
    const fractions = [0, 0.25, 0.5, 0.75];
    const widths = [10.5, 9.5, 10, 8.714285714285714];
    fractions.forEach((f, i) => {
      expect(track.halfWidthAt(f * track.length), `width at ${f}`).toBeCloseTo(widths[i], 12);
    });
  });
});

describe('Realm Racers circuits: every record is well formed', () => {
  it.each(REALM_RACERS_CIRCUIT_LIST.map((c) => [c.id, c] as const))(
    '%s is authorable geometry',
    (_id, circuit) => {
      // A closed loop needs enough control points to have a shape at all, and
      // the record's id must be the key it is filed under.
      expect(circuit.controlPoints.length).toBeGreaterThanOrEqual(8);
      expect(REALM_RACERS_CIRCUITS[circuit.id]).toBe(circuit);

      // Width bands: sorted, spanning the whole lap, never under the floor.
      const bands = circuit.widthBands;
      expect(bands[0].s).toBe(0);
      expect(bands[bands.length - 1].s).toBe(1);
      for (let i = 1; i < bands.length; i++) {
        expect(bands[i].s, `band ${i} of ${circuit.id}`).toBeGreaterThan(bands[i - 1].s);
      }
      for (const band of bands) {
        expect(band.halfWidth, `band at s=${band.s}`).toBeGreaterThanOrEqual(
          REALM_RACERS_MIN_HALF_WIDTH,
        );
      }

      // A pond is MADE of water, so a circuit placing one has to author a
      // basin, and a circuit placing none may author none. The record's rule is
      // an IFF and both halves are checked: a basin nothing is made of
      // re-exports as a literal the next reader takes for a lake.
      expect(Boolean(circuit.basin), `${circuit.id} basin`).toBe((circuit.ponds?.length ?? 0) > 0);
      for (const [i, pond] of (circuit.ponds ?? []).entries()) {
        expect(pond.rx, `pond ${i} of ${circuit.id}`).toBeGreaterThan(0);
        expect(pond.rz, `pond ${i} of ${circuit.id}`).toBeGreaterThan(0);
        if (pond.wobble !== undefined) {
          expect(pond.wobble, `pond ${i} of ${circuit.id}`).toBeGreaterThanOrEqual(0);
          expect(pond.wobble, `pond ${i} of ${circuit.id}`).toBeLessThanOrEqual(0.35);
        }
      }

      // The race has to be finishable, and the instance volume has to contain
      // the wall. Strictly, and that is the load-bearing half: the volume is
      // where the ground is flat and the world's colliders are off, and the
      // wall is the only thing keeping a pilot inside it.
      expect(circuit.laps).toBeGreaterThan(0);
      expect(circuit.practiceLaps).toBeGreaterThan(0);
      expect(circuit.timeLimitSeconds).toBeGreaterThan(0);
      expect(circuit.regionHalfX).toBeGreaterThan(circuit.perimeter.halfX);
      expect(circuit.regionHalfZ).toBeGreaterThan(circuit.perimeter.halfZ);

      // EVERY circuit carries the volume at its CEILING, and the record says so
      // in literals only because `realm_racers_layout.ts` imports the records
      // and importing it back would be a cycle. This is what makes it a rule
      // rather than a coincidence two authors happened to agree on.
      //
      // It is not authored because it carries no design decision: the gap it
      // used to leave to the wall was one constant in the editor's fit. It is
      // safe at the ceiling by construction rather than by luck, since the depth
      // ceiling IS half the lane spacing less the clearance, so two lanes both
      // at it still keep the air the layout was designed around (the test above
      // this file derives that floor independently).
      expect(circuit.regionHalfX, `${circuit.id} volume x`).toBe(REALM_RACERS_MAX_REGION_HALF_X);
      expect(circuit.regionHalfZ, `${circuit.id} volume z`).toBe(REALM_RACERS_MAX_REGION_HALF_Z);
    },
  );

  it.each(REALM_RACERS_CIRCUIT_LIST.map((c) => [c.id, c] as const))(
    '%s is drivable geometry by every measurement the editor draws against',
    (_id, circuit) => {
      // The same readout the circuit editor renders live, run here so a shipped
      // circuit can never be one the tool would have rejected: the loop closes
      // without crossing itself, it runs the way the apron and the basin are
      // built for, no corner folds its own road, no two stretches run close
      // enough to corrupt the projection, and the two shores never meet.
      const metrics = realmRacersCircuitMetrics(circuit);
      expect(realmRacersCircuitErrors(metrics), `${circuit.id} problems`).toEqual([]);
      // ERRORS only, deliberately. A count of `prop_in_camera_reach` used to be
      // pinned here beside them, and it was the wrong instrument: a warning is
      // a sentence the tool says to the author, whose whole point is that the
      // author may read it and place the piece anyway. Pinned, it turned every
      // such decision into a red suite and a number to edit somewhere else,
      // which is a test asking to be updated rather than one saying anything.
      // The geometry rules below are pinned because they are not opinions: a
      // circuit that fails one of them cannot be driven.
      // Not vacuous: the checks really did run over a measured lap.
      expect(metrics.sampleCount).toBeGreaterThan(100);
      expect(metrics.turningDegrees).toBeCloseTo(360, 3);
    },
  );

  it.each(REALM_RACERS_CIRCUIT_LIST.map((c) => [c.id, c] as const))(
    '%s parks a full grid on its own road',
    (_id, circuit) => {
      // The four-abreast row is derived, never pinned, so a narrower circuit
      // that cannot hold the grid fails HERE rather than by putting a machine
      // on the grass. The hull radius is the machine's, not a constant.
      const track = realmRacersTrack(circuit);
      const hull = vehicleProfile('rally_loaner').bodyRadius;
      const outermost = ((REALM_RACERS_GRID_SIZE - 1) / 2) * circuit.startSpacing;
      const startLineHalfWidth = track.halfWidthAt(track.length - circuit.startBack);
      expect(outermost + hull).toBeLessThan(startLineHalfWidth);
      // And neighbours do not overlap.
      expect(circuit.startSpacing).toBeGreaterThan(2 * hull);
      // The gates over-cover the road they stand on, or a racer hugging the
      // outer edge crosses the road without crossing the gate.
      for (const gate of realmRacersGates(circuit)) {
        expect(gate.halfWidth).toBeGreaterThan(track.halfWidthAt(gate.s));
      }
    },
  );
});

describe('Realm Racers circuits: the ground under them', () => {
  it.each(REALM_RACERS_CIRCUIT_LIST.map((c) => [c.id, c] as const))(
    '%s authors no ground shape, so its land is exactly the rectangle it always was',
    (_id, circuit) => {
      // The whole promise of the authored ground: a field the shipped records do
      // not carry changes nothing about them. Against the LITERAL rectangle the
      // renderer used to build from `regionHalf*` plus its own overshoot, not
      // against the resolver read back at itself.
      expect(circuit.groundOutline).toBeUndefined();
      const shape = realmRacersGroundShape(circuit);
      expect(shape.authored).toBe(false);
      const halfX = circuit.regionHalfX + REALM_RACERS_LAWN_OVERSHOOT;
      const halfZ = circuit.regionHalfZ + REALM_RACERS_LAWN_OVERSHOOT;
      expect([...shape.outline]).toEqual([
        { x: -halfX, z: -halfZ },
        { x: halfX, z: -halfZ },
        { x: halfX, z: halfZ },
        { x: -halfX, z: halfZ },
      ]);
      // And it really does cover the circuit: the rule that measures a road
      // against this shape can never fire on a record that authors none.
      const track = realmRacersTrack(circuit);
      for (const sample of track.samples) {
        expect(Math.abs(sample.x - REALM_RACERS_ORIGIN.x)).toBeLessThan(halfX);
        expect(Math.abs(sample.z - REALM_RACERS_ORIGIN.z)).toBeLessThan(halfZ);
      }
    },
  );
});

describe('Realm Racers recovery anchors: derived, never authored', () => {
  it.each(REALM_RACERS_CIRCUIT_LIST.map((c) => [c.id, c] as const))(
    '%s spaces its anchors by lap length rather than by a per-circuit count',
    (_id, circuit) => {
      const track = realmRacersTrack(circuit);
      const gates = realmRacersGates(circuit);
      expect(gates.length).toBeGreaterThanOrEqual(REALM_RACERS_MIN_GATES);
      // The COUNT follows the lap, which is the whole reason the field went
      // away: a longer circuit gets more anchors without anyone remembering to.
      expect(gates).toHaveLength(
        Math.max(REALM_RACERS_MIN_GATES, Math.round(track.length / REALM_RACERS_GATE_SPACING)),
      );
      // Ordered, the first ON the start line, and none of them past the lap.
      expect(gates[0].s).toBe(0);
      for (let i = 1; i < gates.length; i++) {
        expect(gates[i].s, `anchor ${i} of ${circuit.id}`).toBeGreaterThan(gates[i - 1].s);
        expect(gates[i].s).toBeLessThan(track.length);
      }
    },
  );

  it('never lets two anchors drift into each other, whatever the snapping does', () => {
    for (const circuit of REALM_RACERS_CIRCUIT_LIST) {
      const track = realmRacersTrack(circuit);
      const gates = realmRacersGates(circuit);
      const spacing = track.length / gates.length;
      // Each one may slide up to SNAP_FRACTION of the spacing, so the closest
      // two can ever come is what is left of it. Under a half, or the snapping
      // could reorder them.
      const floor = spacing * (1 - 2 * REALM_RACERS_GATE_SNAP_FRACTION);
      expect(REALM_RACERS_GATE_SNAP_FRACTION).toBeLessThan(0.5);
      for (let i = 1; i < gates.length; i++) {
        expect(
          gates[i].s - gates[i - 1].s,
          `${circuit.id} anchors ${i - 1} to ${i}`,
        ).toBeGreaterThan(floor);
      }
    }
  });

  it('puts the anchors on STRAIGHTER road than plain even spacing would', () => {
    // The reason the snapping exists. A reset restarts a racer at a standstill
    // facing along the track, so an anchor in a corner restarts them stopped on
    // an apex. On the garden circuit, plain even spacing put one anchor in the
    // hairpin; this is what says the derivation actually improves on it.
    const track = realmRacersTrack(GARDEN);
    const gates = realmRacersGates(GARDEN);
    const radiusAt = (s: number): number => Math.abs(track.pointAt(s).turnRadius);
    let better = 0;
    for (let i = 1; i < gates.length; i++) {
      const even = (i / gates.length) * track.length;
      expect(radiusAt(gates[i].s)).toBeGreaterThanOrEqual(radiusAt(even));
      if (radiusAt(gates[i].s) > radiusAt(even) * 1.5) better++;
    }
    // Not vacuous: several anchors really moved somewhere much straighter.
    expect(better).toBeGreaterThanOrEqual(3);
    // And the tightest anchor is no longer sitting in a corner.
    const tightest = Math.min(...gates.map((gate) => radiusAt(gate.s)));
    expect(tightest).toBeGreaterThan(50);
  });

  it('is a pure function of the curve: same circuit, same anchors', async () => {
    // Three hosts run this sim and a circuit is rebuilt on every boot, so a
    // derivation that drifted would put two realms' resets in different places.
    const before = realmRacersGates(GARDEN).map((gate) => gate.s);
    vi.resetModules();
    const rebuilt = (await import('../src/sim/realm_racers_spline')).realmRacersGates(GARDEN);
    expect(rebuilt.map((gate) => gate.s)).toEqual(before);
  });

  it('follows the curve when the curve moves', () => {
    // The anchors are geometry now, not data: reshaping the circuit has to
    // reshape them, with nothing to edit by hand.
    const stretched = {
      ...GARDEN,
      id: 'anchors_follow_the_curve',
      controlPoints: GARDEN.controlPoints.map((p) => ({ x: p.x * 2, z: p.z * 2 })),
    };
    const longer = realmRacersTrack(stretched);
    expect(longer.length).toBeGreaterThan(realmRacersTrack(GARDEN).length * 1.8);
    expect(realmRacersGates(stretched).length).toBeGreaterThan(realmRacersGates(GARDEN).length);
  });
});

describe('Realm Racers circuits: the Express Tour pinch strip', () => {
  const EXPRESS = realmRacersCompetitionCircuits().find(
    (circuit) => circuit.id === 'evergarden_express_tour',
  );
  if (!EXPRESS) throw new Error('the Express Tour is the competition circuit this pins');
  const track = realmRacersTrack(EXPRESS);

  it('keeps the strip its two stretches flank as open LAWN, with no water near it', () => {
    // The design outcome, not the authoring: the corridor between the two
    // facing stretches is one piece of lawn rather than a canal eleven yards
    // wide. It carried two knee-high hedges for one shipped revision, when a
    // solid line either side was what stopped anyone crossing, and then two
    // rows of a water table whose only job was painting the strip dry. Placed
    // water needs neither, so what this checks is the strip itself.
    const metrics = realmRacersCircuitMetrics(EXPRESS);
    expect(metrics.shootingCorridorYards).toBeGreaterThan(30);
    // The strip itself, walked: for every sample of one facing stretch, the
    // straight line across to the nearest sample of the other one crosses no
    // water at any point. That is what "you can see and shell a rival across
    // it" means, and it is the claim the two deleted `waterBands` rows used to
    // buy by painting this stretch of the ribbon away.
    const local = (sample: { x: number; z: number }) => ({
      x: sample.x - REALM_RACERS_ORIGIN.x,
      z: sample.z - REALM_RACERS_ORIGIN.z,
    });
    const inWindow = (sample: { s: number }, from: number, to: number): boolean =>
      sample.s / track.length >= from && sample.s / track.length <= to;
    const near = track.samples.filter((sample) => inWindow(sample, 0.15, 0.22));
    const far = track.samples.filter((sample) => inWindow(sample, 0.42, 0.49));
    expect(near.length).toBeGreaterThan(40);
    expect(far.length).toBeGreaterThan(40);
    const ponds = realmRacersPlacedPonds(EXPRESS);
    let probed = 0;
    for (const sample of near) {
      const a = local(sample);
      let closest = local(far[0]);
      let best = Number.POSITIVE_INFINITY;
      for (const other of far) {
        const b = local(other);
        const distance = Math.hypot(b.x - a.x, b.z - a.z);
        if (distance < best) {
          best = distance;
          closest = b;
        }
      }
      for (let step = 0; step <= 20; step++) {
        const t = step / 20;
        const x = a.x + (closest.x - a.x) * t;
        const z = a.z + (closest.z - a.z) * t;
        for (const pond of ponds) {
          expect(
            polygonContainsPoint(pond.outline, x, z),
            `across from ${sample.s.toFixed(0)}`,
          ).toBe(false);
        }
        probed++;
      }
    }
    expect(probed).toBeGreaterThan(800);
  });

  it('places two pools, both of them clear of the racing surface', () => {
    const ponds = realmRacersPlacedPonds(EXPRESS);
    expect(ponds).toHaveLength(2);
    for (const pond of ponds) expect(pond.outline.length).toBeGreaterThan(16);
    expect(realmRacersCircuitErrors(realmRacersCircuitMetrics(EXPRESS))).toEqual([]);
  });

  it('put the water where it is without reshaping the circuit', () => {
    // The dressing is what changed, and only that: the shore line is derived
    // from the control points and the apron rule, both untouched, so the two
    // stretches face each other at exactly the distance they always did.
    const bare = { ...EXPRESS, id: 'express_before_the_ponds', ponds: undefined, basin: undefined };
    const bareMetrics = realmRacersCircuitMetrics(bare);
    const afterMetrics = realmRacersCircuitMetrics(EXPRESS);
    expect(afterMetrics.lapLength).toBe(bareMetrics.lapLength);
    expect(afterMetrics.nearestApproach).toEqual(bareMetrics.nearestApproach);
    expect(afterMetrics.shootingCorridorYards).toBe(bareMetrics.shootingCorridorYards);
    for (const sample of realmRacersTrack(bare).samples) {
      expect(rallyGardenEdgeOffsetAt(EXPRESS, sample.s)).toBe(
        rallyGardenEdgeOffsetAt(bare, sample.s),
      );
    }
    expect(realmRacersCircuitErrors(afterMetrics)).toEqual([]);
  });

  it('leaves the practice circuit a lake circuit, in two pools around its fountain', () => {
    // The other half of the acceptance: the circuit a player learns on still
    // reads as water in the middle, and the fountain still stands on ground.
    const ponds = realmRacersPlacedPonds(GARDEN);
    expect(ponds).toHaveLength(2);
    expect(GARDEN.basin).toBeDefined();
    const fountain = realmRacersPlacements(GARDEN).props[0];
    expect(fountain.asset).toBe('fountain');
    for (const pond of ponds) {
      expect(polygonContainsPoint(pond.outline, fountain.x, fountain.z)).toBe(false);
    }
  });
});

describe('Realm Racers circuits: the Nightbloom Moonwell Run', () => {
  const MOONWELL = realmRacersCompetitionCircuits().find(
    (circuit) => circuit.id === 'nightbloom_moonwell_run',
  );
  if (!MOONWELL) throw new Error('the Moonwell Run is the competition circuit this pins');
  const track = realmRacersTrack(MOONWELL);
  const metrics = realmRacersCircuitMetrics(MOONWELL);

  it('is a competition circuit wearing its own zone, raced at night', () => {
    // The whole point of the record: the first circuit outside the Evergarden,
    // and the first to name a dark hour. Both are plain strings the render
    // registries resolve, so a typo here would silently race the garden at the
    // world's clock; the readout is what says the ids exist.
    expect(MOONWELL.roles).toEqual(['competition']);
    expect(MOONWELL.practiceCopies).toBe(0);
    expect(MOONWELL.theme).toBe('nightbloom');
    expect(MOONWELL.timeOfDay).toBe('night');
    expect(realmRacersCircuitErrors(metrics)).toEqual([]);
  });

  it('carries ONE pickup row, on straight road and off the start line', () => {
    // The design says one row, and where it stands is what makes it one a
    // pilot can aim at: straight road, so the four boxes read as four lanes
    // rather than a scatter across a corner. WHICH straight is the author's
    // call at the seat and is deliberately not pinned; the readout's own
    // row-fit rule (zero errors above) is what says the row fits its road.
    const rows = MOONWELL.pickupRows ?? [];
    expect(rows).toHaveLength(1);
    const s = rows[0].s * track.length;
    expect(Math.abs(track.pointAt(s).turnRadius)).toBeGreaterThan(200);
    expect(rows[0].s).toBeGreaterThan(0.05);
    expect(rows[0].s).toBeLessThan(0.95);
  });

  it('runs its barrow straight head on against the start straight, in Ground Blast reach', () => {
    // The Express Tour's pinch in another realm: two opposed stretches close
    // enough to shell a rival across the meadow between them, and far enough
    // apart that the projection never confuses them.
    expect(metrics.shootingCorridorYards).toBeGreaterThan(30);
    expect(metrics.nearestApproach.tangentDot).toBeLessThan(-0.8);
    expect(metrics.nearestApproach.distance).toBeGreaterThanOrEqual(
      REALM_RACERS_MIN_STRETCH_SEPARATION,
    );
  });

  it('is lit by the Nightbloom moonflower lamp and by nothing else', () => {
    // A night circuit is raceable because of its lamps, and a circuit wears
    // its zone's fixture rather than any of the other thirteen. Counted off
    // the resolver rather than the record, so a track-space lamp that failed
    // to resolve would count as missing here.
    const lamps = realmRacersPlacements(MOONWELL).props.filter((prop) =>
      prop.asset.startsWith('lamp'),
    );
    expect(lamps.length).toBeGreaterThanOrEqual(24);
    for (const lamp of lamps) expect(lamp.asset).toBe('lampNightbloomMoonflower');
  });

  it('keeps its dressing inside the budget the eager build was priced at', () => {
    // The first shipped circuit to sow scatters, and the largest lap: the
    // build cost tracks the scatter (one spline projection per candidate
    // cell), so the count is pinned as a ceiling rather than left to a prose
    // budget in `src/render/realm_racers_track.ts`. Raising it is a decision
    // to re-measure that build, not a free edit.
    const placements = realmRacersPlacements(MOONWELL);
    expect(placements.scattered.length).toBeGreaterThan(500);
    expect(placements.scattered.length).toBeLessThanOrEqual(1800);
    expect(placements.props.filter((prop) => prop.solid).length).toBeLessThanOrEqual(130);
    // Nothing a scatter sows is ever solid, so the collider set is the
    // hand-placed pieces alone.
    for (const piece of placements.scattered) expect(piece.solid).toBe(false);
  });

  it('keeps the Moonwell outside the hairpin and clear of the road', () => {
    // One tarn, placed rather than derived, wrapped by the slow corner rather
    // than sitting in the infield: the hairpin apex (the tightest point of the
    // lap) is the nearest road to it, and the water never touches the surface.
    const ponds = realmRacersPlacedPonds(MOONWELL);
    expect(ponds).toHaveLength(1);
    const pond = ponds[0];
    const apex = track.pointAt(metrics.minRadiusOverWidthAtS);
    const apexLocal = { x: apex.x - REALM_RACERS_ORIGIN.x, z: apex.z - REALM_RACERS_ORIGIN.z };
    expect(Math.hypot(apexLocal.x - pond.x, apexLocal.z - pond.z)).toBeLessThan(70);
    for (const sample of track.samples) {
      expect(
        polygonContainsPoint(
          pond.outline,
          sample.x - REALM_RACERS_ORIGIN.x,
          sample.z - REALM_RACERS_ORIGIN.z,
        ),
      ).toBe(false);
    }
  });
});

describe('Realm Racers circuits: the pools', () => {
  it('has exactly one practice circuit, and it is the one practice resolves to', () => {
    const practice = REALM_RACERS_CIRCUIT_LIST.filter((c) => c.roles.includes('practice'));
    expect(practice).toHaveLength(1);
    expect(practice[0].id).toBe(REALM_RACERS_PRACTICE_CIRCUIT_ID);
    // A practice circuit with no private copies would hand every practice start
    // the public lane and let one player's lap block another's.
    expect(practice[0].practiceCopies).toBeGreaterThan(0);
  });

  it('never draws from an empty competition pool', () => {
    const pool = realmRacersCompetitionCircuits();
    expect(pool.length).toBeGreaterThan(0);
    for (const circuit of pool) expect(circuit.roles).toContain('competition');
  });

  it('resolves a record by id, and reports an unauthored one', () => {
    expect(realmRacersCircuitById(GARDEN.id)).toBe(GARDEN);
    expect(realmRacersCircuitById('no_such_circuit')).toBeUndefined();
  });
});

describe('Realm Racers lanes: where the circuits stand in the band', () => {
  it('gives every circuit its public lane first, then its private copies', () => {
    let expected = 0;
    for (const circuit of REALM_RACERS_CIRCUIT_LIST) {
      if (circuit.roles.includes('competition')) {
        expect(REALM_RACERS_LANES[expected].circuit.id).toBe(circuit.id);
        expect(REALM_RACERS_LANES[expected].practice).toBe(false);
        expect(realmRacersPublicLane(circuit)).toBe(expected);
        expected++;
      }
      for (let copy = 0; copy < circuit.practiceCopies; copy++) {
        expect(REALM_RACERS_LANES[expected].circuit.id).toBe(circuit.id);
        expect(REALM_RACERS_LANES[expected].practice).toBe(true);
        expected++;
      }
    }
    expect(REALM_RACERS_LANES).toHaveLength(expected);
    // Lane 0 is the frame the circuits are authored in, so its offset is zero
    // and that path is byte-identical to a single-lane world.
    expect(realmRacersLaneOffset(0)).toEqual({ x: 0, z: 0 });
  });

  it('resolves the centre of every lane to the circuit standing there', () => {
    for (const lane of REALM_RACERS_LANES) {
      const z = REALM_RACERS_ORIGIN.z + lane.index * REALM_RACERS_LANE_DZ;
      const found = realmRacersLaneAt(REALM_RACERS_ORIGIN.x, z);
      expect(found?.index, `centre of lane ${lane.index}`).toBe(lane.index);
      expect(found?.circuit.id).toBe(lane.circuit.id);
    }
  });

  it('resolves the plane between two lanes, and past the last one, to nothing', () => {
    for (const lane of REALM_RACERS_LANES) {
      const centre = REALM_RACERS_ORIGIN.z + lane.index * REALM_RACERS_LANE_DZ;
      const edge = lane.circuit.regionHalfZ;
      expect(realmRacersLaneAt(REALM_RACERS_ORIGIN.x, centre + edge + 1)).toBeNull();
      expect(realmRacersLaneAt(REALM_RACERS_ORIGIN.x, centre - edge - 1)).toBeNull();
    }
    const past = REALM_RACERS_ORIGIN.z + REALM_RACERS_LANES.length * REALM_RACERS_LANE_DZ;
    expect(realmRacersLaneAt(REALM_RACERS_ORIGIN.x, past)).toBeNull();
    expect(realmRacersLaneAt(REALM_RACERS_ORIGIN.x, -REALM_RACERS_LANE_DZ)).toBeNull();
  });

  it('rejects a point inside a lane band but outside that circuit x envelope', () => {
    for (const lane of REALM_RACERS_LANES) {
      const z = REALM_RACERS_ORIGIN.z + lane.index * REALM_RACERS_LANE_DZ;
      const x = REALM_RACERS_ORIGIN.x + lane.circuit.regionHalfX + 1;
      expect(realmRacersLaneAt(x, z), `x edge of lane ${lane.index}`).toBeNull();
      expect(realmRacersLaneAt(REALM_RACERS_ORIGIN.x - lane.circuit.regionHalfX - 1, z)).toBeNull();
    }
  });

  it('spaces the lanes wider than the deepest circuit plus interest clearance', () => {
    // DERIVED from the records, not pinned: authoring a deeper circuit has to
    // fail here rather than quietly letting one lane see into the next.
    const deepest = Math.max(...REALM_RACERS_CIRCUIT_LIST.map((c) => c.regionHalfZ));
    expect(REALM_RACERS_LANE_DZ).toBeGreaterThanOrEqual(2 * deepest + REALM_RACERS_LANE_CLEARANCE);
  });

  it('keeps every practice lane private and out of the public one', () => {
    const practice = realmRacersPracticeLanes();
    expect(practice).toHaveLength(REALM_RACERS_PRACTICE_CIRCUIT.practiceCopies);
    for (const lane of practice) {
      expect(lane.practice).toBe(true);
      expect(lane.circuit.id).toBe(REALM_RACERS_PRACTICE_CIRCUIT_ID);
      expect(lane.index).not.toBe(realmRacersPublicLane(REALM_RACERS_PRACTICE_CIRCUIT));
    }
  });
});

describe('Realm Racers circuits: which one a race lands on', () => {
  /** Four idle pilots standing outside the band. */
  function grid(sim: Sim): number[] {
    return [
      addAt(sim, 'warrior', 'Aster', -5, -40),
      addAt(sim, 'mage', 'Briar', 7, -42),
      addAt(sim, 'rogue', 'Cass', -9, -38),
      addAt(sim, 'priest', 'Dell', 11, -44),
    ];
  }

  it('runs a queued race on a competition circuit, on its public lane', () => {
    const sim = makeWorld();
    expect(realmRacersStartMatch(sim.ctx, grid(sim))).toBe(true);
    const match = sim.realmRacers.match;
    if (!match) throw new Error('no public race');
    const circuit = realmRacersCircuitOf(match);
    expect(circuit.roles).toContain('competition');
    expect(match.origin).toEqual(realmRacersLaneOffset(realmRacersPublicLane(circuit)));
    // The race length and its deadline come from the circuit, not a module
    // constant, which is what lets a longer lap carry a longer limit.
    expect(match.totalLaps).toBe(circuit.laps);
    expect(match.deadlineTick - match.goTick).toBe(circuit.timeLimitSeconds * TICK_RATE);
  });

  it('always runs practice on the practice circuit, on a private lane', () => {
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.realmRacersPracticeStart('ace', human);
    const match = realmRacersMatchOf(sim.ctx, human);
    if (!match) throw new Error('no practice race');
    expect(match.circuitId).toBe(REALM_RACERS_PRACTICE_CIRCUIT_ID);
    expect(match.totalLaps).toBe(REALM_RACERS_PRACTICE_CIRCUIT.practiceLaps);
    const lane = realmRacersPracticeLanes().find((l) => l.index === match.practice?.slot);
    expect(lane, 'practice runs on a private lane of the practice circuit').toBeDefined();
    expect(match.origin).toEqual(realmRacersLaneOffset(match.practice?.slot ?? -1));
  });

  it('tells the client which circuit it is racing on', () => {
    const sim = makeWorld();
    const pids = grid(sim);
    realmRacersStartMatch(sim.ctx, pids);
    const info = sim.realmRacersInfoFor(pids[0]).match;
    expect(info?.circuitId).toBe(sim.realmRacers.match?.circuitId);
    expect(realmRacersCircuitById(info?.circuitId ?? '')).toBeDefined();
  });

  it('drives on the curve the AUTHORED control points build, not a second one', () => {
    // The whole record is one array of control points plus numbers derived from
    // it, and everything the race reads (the grid, progress along the lap, the
    // lap length, the recovery anchors) comes back through the ONE derivation in
    // `realm_racers_spline.ts`. This walks that chain end to end on a LIVE race
    // rather than trusting the call graph.
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.realmRacersPracticeStart('ace', human);
    readyAllRacers(sim);
    const match = realmRacersMatchOf(sim.ctx, human);
    if (!match) throw new Error('no practice race');
    const circuit = realmRacersCircuitOf(match);
    const track = realmRacersTrack(circuit);

    // 1) The curve really is built from the record's own points: every authored
    // control point lies on the resampled centerline.
    for (const point of circuit.controlPoints) {
      const nearest = Math.min(
        ...track.samples.map((sample) =>
          Math.hypot(
            sample.x - REALM_RACERS_ORIGIN.x - point.x,
            sample.z - REALM_RACERS_ORIGIN.z - point.z,
          ),
        ),
      );
      expect(nearest, `control point ${point.x},${point.z}`).toBeLessThan(track.step);
    }

    // 2) The race SEATS the racer on the grid slot the spline derives from
    // those points, offset onto this practice copy's own lane.
    const racer = sim.entities.get(human);
    if (!racer) throw new Error('no racer');
    const slot = realmRacersStarts(circuit).find(
      (candidate) =>
        Math.hypot(
          candidate.x + match.origin.x - racer.pos.x,
          candidate.z + match.origin.z - racer.pos.z,
        ) < 0.5,
    );
    expect(slot, 'the racer stands on a derived grid slot').toBeDefined();

    // 3) Let the countdown run out and the machines drive most of a lap, then
    // the race's own record of where each is has to be the arc length THIS
    // curve gives for where it physically stands. Measured on the house pilots
    // rather than the human: a test player has no throttle, and a racer sitting
    // still on the grid would satisfy this without proving anything.
    const bots = match.pids.filter((pid) => pid !== human);
    if (bots.length === 0) throw new Error('no house pilot');
    const agreement = (bot: number): number => {
      const driver = sim.entities.get(bot);
      const progress = match.progress.get(bot);
      if (!driver || !progress) throw new Error('no progress');
      const projected = track.project(
        driver.pos.x - match.origin.x,
        driver.pos.z - match.origin.z,
        progress.trackIndex,
      );
      expect(progress.lastS).toBeCloseTo(projected.s, 6);
      return progress.travelled;
    };
    for (let tick = 0; tick < 20 * 8; tick++) sim.tick();
    const early = bots.map(agreement);
    for (let tick = 0; tick < 20 * 8; tick++) sim.tick();
    const later = bots.map(agreement);
    // Not vacuous: the machines really drove a stretch of the derived lap
    // between the two readings, and every one agreed with the curve both times.
    // One pilot may lose that stretch to a Ground Blast knock off the road,
    // which the track-limits referee takes a few seconds to recover.
    const drove = later.filter((travelled, i) => travelled - early[i] > 50);
    expect(drove.length).toBeGreaterThanOrEqual(bots.length - 1);

    // 4) And the race is run over the DERIVED lap, never a constant.
    expect(match.totalLaps).toBe(circuit.practiceLaps);
    expect(realmRacersGates(circuit).length).toBeGreaterThanOrEqual(REALM_RACERS_MIN_GATES);
  });

  it('falls back to the practice circuit for a race on an unauthored id', () => {
    // The one shape a live realm can hit: a race seated before a deploy that
    // dropped its circuit. It must keep driving on SOME geometry, not throw.
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.realmRacersPracticeStart('ace', human);
    const match = realmRacersMatchOf(sim.ctx, human);
    if (!match) throw new Error('no practice race');
    match.circuitId = 'a_circuit_that_shipped_last_week';
    expect(realmRacersCircuitOf(match).id).toBe(REALM_RACERS_PRACTICE_CIRCUIT_ID);
    expect(() => sim.tick()).not.toThrow();
  });
});

describe('Realm Racers competition circuits: raceable to the flag', () => {
  /**
   * The stand-in for workstream 09's lap-time balance gate, and the only thing
   * that can answer whether a circuit's LAP COUNT is right: a full field drives
   * the whole race distance on the real geometry, through the real vehicle
   * kernel, and the clock is read off the result.
   *
   * The band is the design target, about 80 seconds of driving for a
   * competition race, widened to what a standing start and four machines
   * trading paint really produce. It is two-sided, and the bounds are sized
   * against the NEIGHBOURING lap counts rather than around the shipped one.
   * Measured on the Express Tour at the ace tier, varying only `totalLaps`:
   *
   *   1 lap  26.1 s    2 laps  48.9 s    3 laps  71.7 s (shipped)
   *   4 laps 94.3 s    5 laps 117.0 s
   *
   * A first draft of this gate used 50 to 95 and was NOT decisive: 4 laps lands
   * at 94.3 s and passed the ceiling with 0.7 s to spare, so the one alternative
   * the record explicitly rejects would have shipped green. 60 to 85 fails both
   * neighbours by roughly ten seconds each.
   *
   * The neighbour assertions below make that reasoning self-checking rather than
   * a comment: they re-derive what one more and one fewer lap would cost from
   * the race's OWN measured lap split, so the band cannot silently stop
   * bracketing the count when the kernel or the geometry is tuned.
   */
  const RACE_FLOOR_SECONDS = 60;
  const RACE_CEILING_SECONDS = 85;

  it('has competition circuits to race', () => {
    // The `it.each` below registers ZERO cases over an empty pool and the file
    // still reports green, which would silently delete the only gate on the lap
    // count. Vacuity floor, per tests/CLAUDE.md.
    expect(realmRacersCompetitionCircuits().length).toBeGreaterThan(0);
  });

  it.each(realmRacersCompetitionCircuits().map((c) => [c.id, c] as const))(
    '%s runs to completion inside its own deadline, at the design length',
    (_id, circuit) => {
      const sim = makeWorld();
      const human = addAt(sim, 'warrior', 'Aster', -5, -40);
      expect(startRealmRacersDevRace(sim, circuit.id, 'ace', human)).toBe(true);
      readyAllRacers(sim);
      const match = realmRacersMatchOf(sim.ctx, human);
      if (!match) throw new Error('no race');
      expect(match.totalLaps).toBe(circuit.laps);
      const bots = match.pids.filter((pid) => sim.realmRacers.bots.has(pid));
      expect(bots).toHaveLength(REALM_RACERS_GRID_SIZE - 1);
      const progresses = bots.map((pid) => {
        const progress = match.progress.get(pid);
        if (!progress) throw new Error('no progress');
        return progress;
      });
      const done = (): boolean => progresses.every((p) => p.finishedTick !== null);
      // The leader's own lap splits, so one more or one fewer lap can be priced
      // from this race rather than from a remembered number.
      const laps = new Map<number, number[]>(bots.map((pid) => [pid, []]));
      const lastLap = new Map<number, number>(bots.map((pid) => [pid, 1]));
      // Run past the deadline on purpose: a race that only finishes because the
      // loop ran out of ticks must not read as a pass.
      const budget = (circuit.timeLimitSeconds + 30) * TICK_RATE;
      for (let tick = 0; tick < budget && !done(); tick++) {
        sim.tick();
        for (const pid of bots) {
          const progress = match.progress.get(pid) as RealmRacersProgress;
          if (progress.lap === lastLap.get(pid)) continue;
          lastLap.set(pid, progress.lap);
          (laps.get(pid) as number[]).push((sim.tickCount - match.goTick) / TICK_RATE);
        }
      }
      expect(done(), `${circuit.id}: not every pilot finished`).toBe(true);

      const seconds = new Map(
        bots.map((pid) => [
          pid,
          ((match.progress.get(pid) as RealmRacersProgress).finishedTick as number) / 1,
        ]),
      );
      const times = [...seconds.values()].map((tick) => (tick - match.goTick) / TICK_RATE);
      const winnerPid = bots[times.indexOf(Math.min(...times))];
      const winner = Math.min(...times);
      const last = Math.max(...times);
      // Every BOT crossed the line under the circuit's own deadline. The human
      // is excluded on purpose and is not "the field": a test player holds no
      // throttle and never finishes, which is also why the human cannot be the
      // one measured here.
      expect(last, `${circuit.id}: last house pilot home at ${last.toFixed(1)}s`).toBeLessThan(
        circuit.timeLimitSeconds,
      );
      // The deadline is a BACKSTOP and has to be sized like one: comfortably
      // past the whole field plus the chase window that actually closes the
      // classification, and not so far past that it stops meaning anything.
      const chaseSeconds = REALM_RACERS_CHASE_TICKS / TICK_RATE;
      expect(
        circuit.timeLimitSeconds,
        `${circuit.id}: deadline binds before the chase window closes`,
      ).toBeGreaterThan(last + chaseSeconds);
      expect(
        circuit.timeLimitSeconds,
        `${circuit.id}: deadline is so large it bounds nothing`,
      ).toBeLessThan(last * 3);

      // And the race is the length it was designed to be. This is what pins the
      // lap count: `laps` is the only record field that can move this number.
      expect(winner, `${circuit.id}: winner home at ${winner.toFixed(1)}s`).toBeGreaterThan(
        RACE_FLOOR_SECONDS,
      );
      expect(winner, `${circuit.id}: winner home at ${winner.toFixed(1)}s`).toBeLessThan(
        RACE_CEILING_SECONDS,
      );
      // The band BRACKETS this lap count rather than merely containing it: one
      // lap either side of the shipped count has to miss it. Priced off the
      // winner's own settled lap split, so tuning that moves the pace moves
      // this check with it instead of leaving it stale.
      const splits = laps.get(winnerPid) as number[];
      expect(splits.length, `${circuit.id}: no lap splits recorded`).toBeGreaterThanOrEqual(2);
      const settledLap = splits[splits.length - 1] - splits[splits.length - 2];
      expect(
        winner - settledLap,
        `${circuit.id}: ${circuit.laps - 1} laps would also pass the band`,
      ).toBeLessThan(RACE_FLOOR_SECONDS);
      expect(
        winner + settledLap,
        `${circuit.id}: ${circuit.laps + 1} laps would also pass the band`,
      ).toBeGreaterThan(RACE_CEILING_SECONDS);

      // Every lap really was driven, so the clock above is a race and not a
      // pilot who wrapped the line on the spot.
      for (const progress of progresses) expect(progress.lap).toBe(circuit.laps);
    },
  );
});

describe('Realm Racers circuit draw: which circuit a queued race gets', () => {
  /** Four eligible pilots standing beside the Society, ready to be seated. */
  function grid(sim: Sim): number[] {
    return ['Aster', 'Bryn', 'Cael', 'Dara'].map((name, index) =>
      addAt(sim, 'warrior', name, -5 - index * 3, -40),
    );
  }

  /** Every rng value the shared stream produced while `body` ran. The observer
   *  is pure bookkeeping (src/sim/rng.ts), so installing it cannot move the
   *  draw it is counting. */
  function drawsDuring(sim: Sim, body: () => void): number[] {
    const seen: number[] = [];
    sim.rng.setObserver((value) => seen.push(value));
    try {
      body();
    } finally {
      sim.rng.setObserver(null);
    }
    return seen;
  }

  it('draws exactly one value, at seat time, and seats the circuit that value picks', () => {
    // The pool holds one circuit today, so WHICH circuit comes back would prove
    // nothing on its own: `pool[0]` and a draw are indistinguishable by result.
    // Two things are asserted instead, and both stay decisive as the pool grows:
    // the draw's COST in the shared stream (one value, once), and the MAPPING
    // from that value to the seated circuit. The mapping is what a reverted
    // draw, a reseeded generator, or an index computed differently would break.
    const sim = makeWorld();
    const pids = grid(sim);
    let seated = false;
    const draws = drawsDuring(sim, () => {
      seated = realmRacersStartMatch(sim.ctx, pids);
    });
    expect(seated).toBe(true);
    expect(draws).toHaveLength(1);
    const pool = realmRacersCompetitionCircuits();
    const picked = pool[Math.floor(draws[0] * pool.length)];
    expect((sim.realmRacers.match as RealmRacersMatch).circuitId).toBe(picked.id);
  });

  it('draws from the competition pool, never the practice circuit', () => {
    const sim = makeWorld();
    expect(realmRacersStartMatch(sim.ctx, grid(sim))).toBe(true);
    const match = sim.realmRacers.match;
    if (!match) throw new Error('no public race');
    const pool = realmRacersCompetitionCircuits().map((circuit) => circuit.id);
    expect(pool).toContain(match.circuitId);
    expect(match.circuitId).not.toBe(REALM_RACERS_PRACTICE_CIRCUIT_ID);
  });

  it('is deterministic: the same seed draws the same value, a different seed does not', () => {
    // Pinned on the drawn VALUE, not the resolved circuit. With one circuit in
    // the pool the resolved circuit is the same under every seed, so a test
    // over it would pass with the seed ignored entirely, or with `Math.random`.
    const drawsFor = (seed: number): number[] => {
      const sim = makeWorld({ seed });
      return drawsDuring(sim, () => {
        expect(realmRacersStartMatch(sim.ctx, grid(sim))).toBe(true);
      });
    };
    expect(drawsFor(1337)).toEqual(drawsFor(1337));
    // The half that proves the seed reaches the draw at all.
    expect(drawsFor(1337)).not.toEqual(drawsFor(4242));
  });

  it('never draws for a practice race, whatever the pool holds', () => {
    // A practice lap must cost the shared stream nothing: it runs offline, on
    // demand, as often as a player likes, and a draw here would put two realms'
    // worlds on different draw orders because somebody practised.
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    const pids = [
      human,
      ...['Bryn', 'Cael', 'Dara'].map((n, i) => addAt(sim, 'warrior', n, -8 - i * 3, -40)),
    ];
    let seated = false;
    const draws = drawsDuring(sim, () => {
      seated = realmRacersStartMatch(sim.ctx, pids, { ownerPid: human, slot: 1 });
    });
    expect(seated).toBe(true);
    expect((sim.realmRacers.practices[0] as RealmRacersMatch).circuitId).toBe(
      REALM_RACERS_PRACTICE_CIRCUIT_ID,
    );
    expect(draws).toEqual([]);
  });

  it('never draws for a race told which circuit to run', () => {
    // A caller that names its circuit must not be able to move the world's draw
    // order. Forced to the PRACTICE circuit deliberately: that is a circuit no
    // draw could ever return, so the seated-circuit half proves forcing really
    // happened rather than agreeing with what a one-circuit pool would give.
    const sim = makeWorld();
    const pids = grid(sim);
    let seated = false;
    const draws = drawsDuring(sim, () => {
      seated = realmRacersStartMatch(sim.ctx, pids, undefined, REALM_RACERS_PRACTICE_CIRCUIT_ID);
    });
    expect(seated).toBe(true);
    expect((sim.realmRacers.match as RealmRacersMatch).circuitId).toBe(
      REALM_RACERS_PRACTICE_CIRCUIT_ID,
    );
    expect(draws).toEqual([]);
  });

  it('DOES draw for a forced circuit that no longer resolves', () => {
    // The documented fallthrough, seen from the stream's side: an unauthored id
    // resolves to nothing and the ordinary resolution takes over, so the draw
    // happens. Pinned so the "a forced circuit never draws" shorthand cannot be
    // read as unconditional by a later determinism audit. No live caller hits
    // it (`startRealmRacersDevRace` validates the id first), which is exactly
    // why nothing else would notice if it changed.
    const sim = makeWorld();
    const pids = grid(sim);
    let seated = false;
    const draws = drawsDuring(sim, () => {
      seated = realmRacersStartMatch(sim.ctx, pids, undefined, 'a_circuit_that_shipped_last_week');
    });
    expect(seated).toBe(true);
    expect(draws).toHaveLength(1);
    expect(realmRacersCompetitionCircuits().map((c) => c.id)).toContain(
      (sim.realmRacers.match as RealmRacersMatch).circuitId,
    );
  });

  it('never draws for a start it refuses, on any of the four refusals', () => {
    // The claim is over ALL the refusals, so all four arms are exercised: a
    // grid that cannot be seated costs the shared stream nothing, and the
    // caller can put the pilots back. Two arms would leave a future edit free
    // to move the draw above the other two.
    const sim = makeWorld();
    const pids = grid(sim);
    const nothingDrawn = (label: string, body: () => void): void => {
      expect(drawsDuring(sim, body), label).toEqual([]);
    };
    // 1) Wrong grid size: a race is four abreast or it does not start.
    nothingDrawn('short grid', () => {
      expect(realmRacersStartMatch(sim.ctx, pids.slice(0, 2))).toBe(false);
    });
    // 2) The same pilot twice.
    nothingDrawn('duplicate pid', () => {
      expect(realmRacersStartMatch(sim.ctx, [pids[0], pids[0], pids[1], pids[2]])).toBe(false);
    });
    // 3) A pilot who cannot race. A dead one is the cheapest ineligible.
    const corpse = sim.entities.get(pids[3]);
    if (!corpse) throw new Error('no pilot');
    corpse.dead = true;
    nothingDrawn('ineligible pilot', () => {
      expect(realmRacersStartMatch(sim.ctx, pids)).toBe(false);
    });
    corpse.dead = false;
    // 4) The public circuit already claimed, which is the refusal a live realm
    // actually hits.
    expect(realmRacersStartMatch(sim.ctx, pids)).toBe(true);
    nothingDrawn('circuit busy', () => {
      expect(realmRacersStartMatch(sim.ctx, pids)).toBe(false);
    });
  });
});

describe('Realm Racers dev race: reaching a circuit without queueing', () => {
  it('seats the caller on the named circuit against a full grid of house pilots', () => {
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    const target = realmRacersCompetitionCircuits()[0];
    expect(startRealmRacersDevRace(sim, target.id, 'ace', human)).toBe(true);
    const match = realmRacersMatchOf(sim.ctx, human);
    if (!match) throw new Error('no race');
    expect(match.circuitId).toBe(target.id);
    expect(match.pids).toHaveLength(REALM_RACERS_GRID_SIZE);
    // The PUBLIC lane, not a private copy: that is the lane a real race drives
    // and therefore the one worth testing a circuit on.
    expect(match.practice).toBeNull();
    expect(match.origin).toEqual(realmRacersLaneOffset(realmRacersPublicLane(target)));
  });

  it('races the practice circuit too, which no queue can reach', () => {
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    expect(startRealmRacersDevRace(sim, REALM_RACERS_PRACTICE_CIRCUIT_ID, 'rookie', human)).toBe(
      true,
    );
    expect(realmRacersMatchOf(sim.ctx, human)?.circuitId).toBe(REALM_RACERS_PRACTICE_CIRCUIT_ID);
  });

  it('refuses an unauthored circuit, and a pilot already racing', () => {
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    expect(startRealmRacersDevRace(sim, 'no_such_circuit', 'ace', human)).toBe(false);
    expect(realmRacersMatchOf(sim.ctx, human)).toBeNull();
    // And it leaks no house pilot when it refuses.
    expect(sim.realmRacers.bots.size).toBe(0);

    expect(startRealmRacersDevRace(sim, REALM_RACERS_PRACTICE_CIRCUIT_ID, 'ace', human)).toBe(true);
    expect(startRealmRacersDevRace(sim, REALM_RACERS_PRACTICE_CIRCUIT_ID, 'ace', human)).toBe(
      false,
    );
  });
});
