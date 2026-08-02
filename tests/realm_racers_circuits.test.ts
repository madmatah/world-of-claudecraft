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

import { describe, expect, it } from 'vitest';
import {
  REALM_RACERS_CIRCUIT_LIST,
  REALM_RACERS_CIRCUITS,
  REALM_RACERS_PRACTICE_CIRCUIT,
  REALM_RACERS_PRACTICE_CIRCUIT_ID,
  realmRacersCircuitById,
  realmRacersCompetitionCircuits,
} from '../src/sim/content/realm_racers_circuits';
import { vehicleProfile } from '../src/sim/content/vehicles';
import {
  REALM_RACERS_GRID_SIZE,
  REALM_RACERS_LANE_DZ,
  REALM_RACERS_LANES,
  REALM_RACERS_MIN_HALF_WIDTH,
  REALM_RACERS_ORIGIN,
  realmRacersLaneAt,
  realmRacersLaneOffset,
  realmRacersPracticeLanes,
  realmRacersPublicLane,
} from '../src/sim/realm_racers_layout';
import {
  realmRacersGates,
  realmRacersStarts,
  realmRacersTrack,
} from '../src/sim/realm_racers_spline';
import type { Sim } from '../src/sim/sim';
import {
  realmRacersCircuitOf,
  realmRacersMatchOf,
  realmRacersStartMatch,
} from '../src/sim/social/realm_racers';
import { TICK_RATE } from '../src/sim/types';
import { addAt, makeWorld } from './vale_cup_util';

const GARDEN = REALM_RACERS_PRACTICE_CIRCUIT;

/** Clear air between two lanes' region envelopes, yards. The interest scan is
 *  ~120 yd, so anything past that keeps a private copy genuinely private
 *  instead of merely far away. */
const LANE_CLEARANCE = 200;

describe('Realm Racers circuits: the move preserved the garden circuit exactly', () => {
  // Every literal in this block was produced by the single-circuit code at
  // commit HEAD~, before the records existed.
  it('derives the same lap, sample count and step', () => {
    const track = realmRacersTrack(GARDEN);
    expect(track.length).toBeCloseTo(454.2988537163012, 10);
    expect(track.step).toBeCloseTo(1.0006582680975797, 12);
    expect(track.samples).toHaveLength(454);
  });

  it('derives the same eight recovery gates', () => {
    const before = [
      [0, 113698, -54, 12],
      [56.78735671453765, 113754.30233460678, -48.488177083196476, 12],
      [113.5747134290753, 113784.15280953028, -4.414858797031457, 11],
      [170.36207014361295, 113757.02291995204, 41.53925609701661, 11.208333333333334],
      [227.1494268581506, 113701.94329758595, 40.82168968949675, 11.5],
      [283.9367835726882, 113647.05268376536, 45.75362075125248, 10.041666666666666],
      [340.7241402872259, 113614.09993902876, 2.0090594496661778, 10.214285714285714],
      [397.5114970017636, 113643.39890457637, -44.29757819711956, 9.5],
    ];
    const gates = realmRacersGates(GARDEN);
    expect(gates).toHaveLength(before.length);
    gates.forEach((gate, i) => {
      const [s, x, z, halfWidth] = before[i];
      expect(gate.s, `gate ${i} s`).toBeCloseTo(s, 10);
      expect(gate.x, `gate ${i} x`).toBeCloseTo(x, 10);
      expect(gate.z, `gate ${i} z`).toBeCloseTo(z, 10);
      expect(gate.halfWidth, `gate ${i} halfWidth`).toBeCloseTo(halfWidth, 12);
    });
  });

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

      // Recovery gates: ordered fractions, the first ON the start line.
      expect(circuit.gateFractions[0]).toBe(0);
      for (let i = 1; i < circuit.gateFractions.length; i++) {
        expect(circuit.gateFractions[i]).toBeGreaterThan(circuit.gateFractions[i - 1]);
        expect(circuit.gateFractions[i]).toBeLessThan(1);
      }

      // The race has to be finishable, and the region has to contain the wall.
      expect(circuit.laps).toBeGreaterThan(0);
      expect(circuit.practiceLaps).toBeGreaterThan(0);
      expect(circuit.timeLimitSeconds).toBeGreaterThan(0);
      expect(circuit.regionHalfX).toBeGreaterThan(circuit.perimeter.halfX);
      expect(circuit.regionHalfZ).toBeGreaterThan(circuit.perimeter.halfZ);
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
    expect(REALM_RACERS_LANE_DZ).toBeGreaterThanOrEqual(2 * deepest + LANE_CLEARANCE);
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
