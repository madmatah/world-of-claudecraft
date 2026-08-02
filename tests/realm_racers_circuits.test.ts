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
  isSolidBarrierKind,
  RALLY_BARRIER_KINDS,
  REALM_RACERS_CIRCUIT_LIST,
  REALM_RACERS_CIRCUITS,
  REALM_RACERS_PRACTICE_CIRCUIT,
  REALM_RACERS_PRACTICE_CIRCUIT_ID,
  realmRacersCircuitById,
  realmRacersCompetitionCircuits,
} from '../src/sim/content/realm_racers_circuits';
import { vehicleProfile } from '../src/sim/content/vehicles';
import {
  realmRacersCircuitErrors,
  realmRacersCircuitMetrics,
} from '../src/sim/realm_racers_circuit_metrics';
import {
  REALM_RACERS_GATE_SNAP_FRACTION,
  REALM_RACERS_GATE_SPACING,
  REALM_RACERS_GRID_SIZE,
  REALM_RACERS_LANE_CLEARANCE,
  REALM_RACERS_LANE_DZ,
  REALM_RACERS_LANES,
  REALM_RACERS_MIN_GATES,
  REALM_RACERS_MIN_HALF_WIDTH,
  REALM_RACERS_ORIGIN,
  realmRacersLaneAt,
  realmRacersLaneOffset,
  realmRacersPracticeLanes,
  realmRacersPublicLane,
} from '../src/sim/realm_racers_layout';
import {
  rallyBarrierKindAt,
  rallyContainmentGraceAt,
  rallyContainmentLineAt,
  realmRacersGates,
  realmRacersStarts,
  realmRacersTrack,
  realmRacersWaterOutlines,
  resolveRealmRacersContainment,
} from '../src/sim/realm_racers_spline';
import type { Sim } from '../src/sim/sim';
import {
  realmRacersCircuitOf,
  realmRacersMatchOf,
  realmRacersStartMatch,
} from '../src/sim/social/realm_racers';
import { startRealmRacersDevRace } from '../src/sim/social/realm_racers_bots';
import { TICK_RATE } from '../src/sim/types';
import { addAt, makeWorld } from './vale_cup_util';

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

  it('derives the same road width and apron around the lap', () => {
    const track = realmRacersTrack(GARDEN);
    const fractions = [0, 0.25, 0.5, 0.75];
    const widths = [10.5, 9.5, 10, 8.714285714285714];
    const aprons = [15, 15, 15, 7.639026439213784];
    fractions.forEach((f, i) => {
      expect(track.halfWidthAt(f * track.length), `width at ${f}`).toBeCloseTo(widths[i], 12);
      expect(track.apronAt(f * track.length), `apron at ${f}`).toBeCloseTo(aprons[i], 12);
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

      // An apron ceiling, where a circuit authors one, is the same band shape as
      // the road width: sorted, spanning the whole lap, and a positive number of
      // yards (a zero would delete the drivable garden rather than narrow it).
      const apronBands = circuit.apronBands;
      if (apronBands) {
        expect(apronBands.length).toBeGreaterThan(0);
        expect(apronBands[0].s).toBe(0);
        expect(apronBands[apronBands.length - 1].s).toBe(1);
        for (let i = 1; i < apronBands.length; i++) {
          expect(apronBands[i].s, `apron band ${i} of ${circuit.id}`).toBeGreaterThan(
            apronBands[i - 1].s,
          );
        }
        for (const band of apronBands) {
          expect(band.maxApron, `apron band at s=${band.s}`).toBeGreaterThan(0);
        }
      }

      // The barrier table, where a circuit authors one, is STEPWISE rather than
      // interpolated: sorted, first entry at 0, every entry in [0, 1) because
      // an entry at 1 would open a span of zero length, and every kind one the
      // spline knows how to stand on the line.
      const barrierBands = circuit.barrierBands;
      if (barrierBands) {
        expect(barrierBands.length).toBeGreaterThan(0);
        expect(barrierBands[0].s).toBe(0);
        for (let i = 0; i < barrierBands.length; i++) {
          const band = barrierBands[i];
          expect(band.s, `barrier band ${i} of ${circuit.id}`).toBeGreaterThanOrEqual(0);
          expect(band.s, `barrier band ${i} of ${circuit.id}`).toBeLessThan(1);
          if (i > 0) expect(band.s).toBeGreaterThan(barrierBands[i - 1].s);
          expect(RALLY_BARRIER_KINDS, `barrier band ${i} of ${circuit.id}`).toContain(band.kind);
        }
      }
      // Water is what a shore is MADE of, so a circuit authoring one has to
      // author a basin; a circuit whose whole line is solid may author none.
      const anyShore = !barrierBands || barrierBands.some((band) => !isSolidBarrierKind(band.kind));
      if (anyShore) expect(circuit.basin, `${circuit.id} basin`).toBeDefined();

      // The race has to be finishable, and the region has to contain the wall.
      expect(circuit.laps).toBeGreaterThan(0);
      expect(circuit.practiceLaps).toBeGreaterThan(0);
      expect(circuit.timeLimitSeconds).toBeGreaterThan(0);
      expect(circuit.regionHalfX).toBeGreaterThan(circuit.perimeter.halfX);
      expect(circuit.regionHalfZ).toBeGreaterThan(circuit.perimeter.halfZ);
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

    // 3) Let the countdown run out and a machine drive most of a lap, then the
    // race's own record of where it is has to be the arc length THIS curve
    // gives for where it physically stands. Measured on the house pilot rather
    // than the human: a test player has no throttle, and a racer sitting still
    // on the grid would satisfy this without proving anything.
    const bot = match.pids.find((pid) => pid !== human);
    if (bot === undefined) throw new Error('no house pilot');
    const agreement = (): { lastS: number; travelled: number } => {
      const driver = sim.entities.get(bot);
      const progress = match.progress.get(bot);
      if (!driver || !progress) throw new Error('no progress');
      const projected = track.project(
        driver.pos.x - match.origin.x,
        driver.pos.z - match.origin.z,
        progress.trackIndex,
      );
      expect(progress.lastS).toBeCloseTo(projected.s, 6);
      return { lastS: progress.lastS, travelled: progress.travelled };
    };
    for (let tick = 0; tick < 20 * 8; tick++) sim.tick();
    const early = agreement();
    for (let tick = 0; tick < 20 * 8; tick++) sim.tick();
    const later = agreement();
    // Not vacuous: the machine really drove a stretch of the derived lap
    // between the two readings, and both agreed with the curve.
    expect(later.travelled - early.travelled).toBeGreaterThan(50);

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
