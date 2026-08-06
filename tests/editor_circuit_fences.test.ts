// The TERRAIN tool's gestures, and the readout's three new refusals.
//
// Both halves of one feature: a barrier is drawn by a gesture that has to know
// when a run ends, and judged by rules the GAME depends on. The rules live in
// `src/sim/realm_racers_circuit_metrics.ts`, so they are asserted here against
// the same records the gesture produces rather than against a fixture written to
// suit them.

import { describe, expect, it } from 'vitest';
import type { FenceDraft } from '../src/editor/circuit/fences_core';
import {
  addFence,
  centerCircuitOffset,
  FENCE_POINT_TOLERANCE_YD,
  fenceColliderCount,
  fenceDraftClick,
  fenceHitAt,
  fenceRunClearOfSurface,
  finishFenceDraft,
  isBarrierKit,
  MAX_FENCES,
  moveCircuitContent,
  moveFence,
  moveFencePoint,
  removeFence,
  removeFencePoint,
  setFenceScale,
} from '../src/editor/circuit/fences_core';
import { REALM_RACERS_BARRIERS } from '../src/sim/content/realm_racers_barriers';
import type { RallyFence, RealmRacersCircuit } from '../src/sim/content/realm_racers_circuits';
import { REALM_RACERS_PRACTICE_CIRCUIT } from '../src/sim/content/realm_racers_circuits';
import { realmRacersCircuitMetrics } from '../src/sim/realm_racers_circuit_metrics';
import { REALM_RACERS_ORIGIN } from '../src/sim/realm_racers_layout';
import { rallyGardenEdgeOffsetAt, realmRacersTrack } from '../src/sim/realm_racers_spline';

let fixtureSeq = 0;

/** A circuit carrying exactly these fences. A fresh id every call: every derived
 *  geometry is memoized by id AND record identity, so a reused id in one file is
 *  how a test reads a stale answer. */
function withFences(fences: readonly RallyFence[]): RealmRacersCircuit {
  fixtureSeq += 1;
  return {
    ...REALM_RACERS_PRACTICE_CIRCUIT,
    id: `fence_fixture_${fixtureSeq}`,
    props: undefined,
    scatters: undefined,
    ponds: undefined,
    basin: undefined,
    pickupRows: undefined,
    fences,
  };
}

/** A point out in the lawn, clear of the road on the practice circuit: taken
 *  from the record's own enclosure rather than guessed, so it stays true if the
 *  circuit is ever redrawn. */
const LAWN = { x: REALM_RACERS_PRACTICE_CIRCUIT.perimeter.halfX - 6, z: 0 };

describe('drawing a barrier run', () => {
  it('lays a point per click, and ignores one on the point just laid', () => {
    let draft: FenceDraft = { kit: 'ironwork', points: [{ x: 0, z: 0 }] };
    const next = fenceDraftClick(draft, 20, 0, 2.5);
    expect(next.kind).toBe('point');
    if (next.kind !== 'point') return;
    draft = next.draft;
    expect(draft.points).toHaveLength(2);
    // A double click, or a hand that did not move: authoring it would put a
    // zero-length run in the record, which resolves to nothing at all.
    const repeat = fenceDraftClick(draft, 20.5, 0, 2.5);
    expect(repeat.kind).toBe('ignored');
  });

  it('closes the ring on a click back at the first point, and only past three', () => {
    const three = {
      kit: 'ironwork',
      points: [
        { x: 0, z: 0 },
        { x: 20, z: 0 },
        { x: 20, z: 20 },
      ],
    };
    const closed = fenceDraftClick(three, 0.5, 0.5, 2.5);
    expect(closed.kind).toBe('close');
    if (closed.kind === 'close') expect(closed.fence.closed).toBe(true);
    // The tolerance arrives from the caller as FENCE_POINT_TOLERANCE_YD over
    // the zoom, so zoomed in the same 0.7 yd miss is more pixels than the
    // tolerance covers and the click is an ordinary point, not a close.
    expect(fenceDraftClick(three, 0.5, 0.5, FENCE_POINT_TOLERANCE_YD / 4).kind).toBe('point');
    // Two points closed would lay the same ground twice back to back, so the
    // click is read as an ordinary point instead. At zoom 1 the caller's
    // tolerance is the constant itself and the click lands within it of the
    // first point, so what it must NOT be is a close.
    const two = {
      kit: 'ironwork',
      points: [
        { x: 0, z: 0 },
        { x: 20, z: 0 },
      ],
    };
    expect(fenceDraftClick(two, 0.5, 0.5, FENCE_POINT_TOLERANCE_YD).kind).toBe('point');
  });

  it('refuses to finish a run of one point', () => {
    expect(finishFenceDraft({ kit: 'ironwork', points: [{ x: 0, z: 0 }] })).toBeNull();
    const run = finishFenceDraft({
      kit: 'ironwork',
      points: [
        { x: 0, z: 0 },
        { x: 10, z: 0 },
      ],
    });
    expect(run?.points).toHaveLength(2);
    expect(run?.closed).toBeUndefined();
  });

  it('stops adding barriers at the ceiling', () => {
    const full = Array.from({ length: MAX_FENCES }, () => ({
      kit: 'ironwork',
      points: [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
      ],
    }));
    expect(
      addFence(full, {
        kit: 'ironwork',
        points: [
          { x: 0, z: 0 },
          { x: 1, z: 0 },
        ],
      }),
    ).toBeNull();
    expect(addFence(full.slice(0, -1), full[0])).not.toBeNull();
  });
});

describe('picking a barrier back up', () => {
  const fences: RallyFence[] = [
    {
      kit: 'ironwork',
      points: [
        { x: 0, z: 0 },
        { x: 40, z: 0 },
        { x: 40, z: 40 },
      ],
    },
  ];
  const circuit = withFences(fences);

  it('finds the POINT under the pointer before the run it belongs to', () => {
    // At a working zoom the tolerance around a corner reaches both runs meeting
    // there, so "whichever run was declared first" would make the corner itself
    // ungrabbable, which is the part of a fence an operator most wants to drag.
    expect(fenceHitAt(circuit, 40, 0.5, 2.5)).toEqual({ fence: 0, point: 1 });
  });

  it('finds the RUN when the pointer is between two points', () => {
    expect(fenceHitAt(circuit, 20, 0.4, 2.5)).toEqual({ fence: 0, point: null });
  });

  it('finds nothing out in the lawn', () => {
    expect(fenceHitAt(circuit, 200, 200, 2.5)).toBeNull();
  });

  it('takes the NEAREST point when two are inside the tolerance', () => {
    const tight = withFences([
      {
        kit: 'ironwork',
        points: [
          { x: 0, z: 0 },
          { x: 3, z: 0 },
        ],
      },
    ]);
    expect(fenceHitAt(tight, 2.6, 0, 4)).toEqual({ fence: 0, point: 1 });
    expect(fenceHitAt(tight, 0.4, 0, 4)).toEqual({ fence: 0, point: 0 });
  });
});

describe('editing a barrier', () => {
  const base: RallyFence[] = [
    {
      kit: 'hedge',
      points: [
        { x: 0, z: 0 },
        { x: 20, z: 0 },
        { x: 20, z: 20 },
      ],
    },
  ];

  it('moves one point and leaves the rest alone', () => {
    const moved = moveFencePoint(base, 0, 1, 25, 5);
    expect(moved[0].points).toEqual([
      { x: 0, z: 0 },
      { x: 25, z: 5 },
      { x: 20, z: 20 },
    ]);
  });

  it('moves the whole run by an offset', () => {
    const moved = moveFence(base, 0, 3, -4);
    expect(moved[0].points).toEqual([
      { x: 3, z: -4 },
      { x: 23, z: -4 },
      { x: 23, z: 16 },
    ]);
  });

  it('deletes a point, and the whole barrier when it is down to its last two', () => {
    expect(removeFencePoint(base, 0, 1)[0].points).toHaveLength(2);
    // A run needs two points, so removing one from a two-point fence is a
    // request to remove the fence: refusing would leave `del` doing nothing on
    // the commonest barrier there is.
    const two: RallyFence[] = [
      {
        kit: 'hedge',
        points: [
          { x: 0, z: 0 },
          { x: 9, z: 0 },
        ],
      },
    ];
    expect(removeFencePoint(two, 0, 0)).toEqual([]);
    expect(removeFence(base, 0)).toEqual([]);
  });

  it('clamps a scale, and drops an explicit 1 rather than writing it out', () => {
    expect(setFenceScale(base, 0, 2)[0].scale).toBe(2);
    expect(setFenceScale(base, 0, 99)[0].scale).toBe(4);
    expect(setFenceScale(base, 0, 0)[0].scale).toBe(0.25);
    expect(setFenceScale(setFenceScale(base, 0, 2), 0, 1)[0].scale).toBeUndefined();
  });

  it('knows a kit the catalog authors from one it does not', () => {
    expect(isBarrierKit('ironwork')).toBe(true);
    expect(isBarrierKit('nothingAuthorsThis')).toBe(false);
  });

  it('counts one collider per run, not per point', () => {
    expect(fenceColliderCount(withFences(base))).toBe(2);
    expect(fenceColliderCount(withFences([{ ...base[0], closed: true }]))).toBe(3);
    expect(fenceColliderCount(withFences([]))).toBe(0);
  });
});

describe('the ghost tint asks the readout its own question', () => {
  it('says clear out in the lawn and blocked across the road', () => {
    const circuit = withFences([]);
    const track = realmRacersTrack(circuit);
    const onRoad = track.samples[0];
    const local = { x: onRoad.x - REALM_RACERS_ORIGIN.x, z: onRoad.z - REALM_RACERS_ORIGIN.z };
    const half = REALM_RACERS_BARRIERS.ironwork.halfThickness;
    expect(fenceRunClearOfSurface(circuit, LAWN, { x: LAWN.x, z: LAWN.z + 20 }, half)).toBe(true);
    expect(fenceRunClearOfSurface(circuit, local, { x: local.x + 5, z: local.z }, half)).toBe(
      false,
    );
  });

  it('catches a run whose two ENDS are clear but which crosses between them', () => {
    // The whole reason a run is SAMPLED rather than tested at its endpoints, and
    // the fixture has to earn that. The version this replaced used two points
    // that both sat ON the centerline, so an endpoint-only implementation was
    // caught at its very first sample and the case proved nothing.
    //
    // This one steps out along the road's own NORMAL in both directions from one
    // centerline point, so both ends measure comfortably clear and the crossing
    // is strictly between them.
    const circuit = withFences([]);
    const { from, to } = crossingChord(circuit);
    // The precondition, asserted rather than assumed.
    for (const end of [from, to]) {
      expect(endIsClear(circuit, end), `${end.x}, ${end.z}`).toBe(true);
    }
    expect(fenceRunClearOfSurface(circuit, from, to, 0.25)).toBe(false);
  });
});

/**
 * A run whose two ends are clear of the racing surface and which crosses it in
 * the middle: out along the road's normal, both ways, from one centerline point.
 */
function crossingChord(circuit: RealmRacersCircuit): {
  from: { x: number; z: number };
  to: { x: number; z: number };
} {
  const track = realmRacersTrack(circuit);
  const sample = track.samples[0];
  // The normal is a plain +90 degree rotation of the tangent in (x, z).
  const nx = -sample.tz;
  const nz = sample.tx;
  const reach = rallyGardenEdgeOffsetAt(circuit, sample.s) + 4;
  const x = sample.x - REALM_RACERS_ORIGIN.x;
  const z = sample.z - REALM_RACERS_ORIGIN.z;
  return {
    from: { x: x + nx * reach, z: z + nz * reach },
    to: { x: x - nx * reach, z: z - nz * reach },
  };
}

/** Whether one point is clear of the racing surface, measured the way the
 *  readout measures it. */
function endIsClear(circuit: RealmRacersCircuit, point: { x: number; z: number }): boolean {
  const track = realmRacersTrack(circuit);
  const projection = track.project(
    point.x + REALM_RACERS_ORIGIN.x,
    point.z + REALM_RACERS_ORIGIN.z,
  );
  return Math.abs(projection.lateral) > rallyGardenEdgeOffsetAt(circuit, projection.s);
}

describe('what the readout says about a barrier', () => {
  const codes = (circuit: RealmRacersCircuit): string[] =>
    realmRacersCircuitMetrics(circuit).problems.map((problem) => problem.code);

  it('says nothing at all about a barrier standing out in the lawn', () => {
    const clean = codes(
      withFences([{ kit: 'ironwork', points: [LAWN, { x: LAWN.x, z: LAWN.z + 30 }] }]),
    );
    expect(clean).not.toContain('fence_blocks_racing_surface');
    expect(clean).not.toContain('fence_outside_region');
    expect(clean).not.toContain('unknown_barrier_kit');
  });

  it('names a barrier crossing the racing surface, even one whose ENDS are clear', () => {
    // The readout's own sampling, pinned on the case that needs it: a fence
    // drawn from clear ground to clear ground straight across the road. Judged
    // by its two endpoints it is spotless.
    const { from, to } = crossingChord(withFences([]));
    expect(codes(withFences([{ kit: 'ironwork', points: [from, to] }]))).toContain(
      'fence_blocks_racing_surface',
    );
  });

  it('names a barrier that leaves the collision region', () => {
    const far = REALM_RACERS_PRACTICE_CIRCUIT.regionHalfX + 50;
    expect(
      codes(
        withFences([
          {
            kit: 'ironwork',
            points: [
              { x: far, z: 0 },
              { x: far, z: 30 },
            ],
          },
        ]),
      ),
    ).toContain('fence_outside_region');
  });

  it('names a kit nothing authors', () => {
    expect(
      codes(
        withFences([{ kit: 'nothingAuthorsThis', points: [LAWN, { x: LAWN.x, z: LAWN.z + 20 }] }]),
      ),
    ).toContain('unknown_barrier_kit');
  });
});

describe('centring a circuit in its enclosure', () => {
  it('offsets a circuit shifted off its origin back onto it', () => {
    const shifted = moveCircuitContent(withFences([]), 40, -25);
    const offset = centerCircuitOffset(shifted);
    expect(offset.dx).toBeCloseTo(-40 + centerCircuitOffset(withFences([])).dx, 1);
    expect(offset.dz).toBeCloseTo(25 + centerCircuitOffset(withFences([])).dz, 1);
    // And applying it lands the road's footprint centred: the offset a second
    // pass asks for is nothing.
    const centred = moveCircuitContent(shifted, offset.dx, offset.dz);
    const again = centerCircuitOffset(centred);
    expect(Math.abs(again.dx)).toBeLessThan(0.05);
    expect(Math.abs(again.dz)).toBeLessThan(0.05);
  });

  it('moves EVERY circuit-local thing by the same offset, and no track-space one', () => {
    // The rule the whole action rests on: moving the road alone would walk it
    // out from under its own dressing. One of every kind on one record.
    const before: RealmRacersCircuit = {
      ...withFences([
        {
          kit: 'ironwork',
          points: [
            { x: 1, z: 2 },
            { x: 3, z: 4 },
          ],
        },
      ]),
      props: [
        { asset: 'bench', at: { x: 10, z: 20 } },
        { asset: 'bench', at: { s: 0.5, offset: 14 } },
      ],
      ponds: [{ x: -5, z: -6, rx: 8, rz: 9 }],
      basin: { waterY: -0.5, bankSlope: 0.8, depthMax: 6, wadeYards: 4 },
      scatters: [{ asset: 'bench', zone: 'outfield', spacing: 20, seed: 1 }],
      pickupRows: [{ s: 0.25 }],
      groundOutline: [
        { x: -100, z: -80 },
        { x: 100, z: -80 },
        { x: 100, z: 80 },
        { x: -100, z: 80 },
      ],
    };
    const after = moveCircuitContent(before, 7, -3);

    expect(after.controlPoints[0]).toEqual({
      x: before.controlPoints[0].x + 7,
      z: before.controlPoints[0].z - 3,
    });
    expect(after.fences?.[0].points).toEqual([
      { x: 8, z: -1 },
      { x: 10, z: 1 },
    ]);
    expect(after.props?.[0].at).toEqual({ x: 17, z: 17 });
    expect(after.ponds?.[0]).toMatchObject({ x: 2, z: -9 });
    // The LAND moves with the road too: an island left behind is the same defect
    // as a fountain left behind, one shape bigger.
    expect(after.groundOutline?.[0]).toEqual({ x: -93, z: -83 });
    expect(after.groundOutline?.[2]).toEqual({ x: 107, z: 77 });
    // Track space follows the centerline for free, so it must NOT be moved a
    // second time: doing so would slide the piece along its own road.
    expect(after.props?.[1].at).toEqual({ s: 0.5, offset: 14 });
    expect(after.scatters).toEqual(before.scatters);
    expect(after.pickupRows).toEqual(before.pickupRows);
  });

  it('leaves the enclosure alone, since centring the ROAD is the whole operation', () => {
    const before = withFences([]);
    const after = moveCircuitContent(before, 12, 9);
    expect(after.perimeter).toEqual(before.perimeter);
    expect(after.regionHalfX).toBe(before.regionHalfX);
    expect(after.regionHalfZ).toBe(before.regionHalfZ);
  });

  it('covers every list a record can carry, so a new one cannot be forgotten', () => {
    // The structural half, and the reason it is here: `pickupRows` was added to
    // the record after the blank-canvas clearing was written and was silently
    // left out of it, so a fresh circuit came with three rows nobody placed.
    // A field carrying circuit-local coordinates that this does not move is a
    // piece left behind when the road moves.
    //
    // Run over a POPULATED record, which is the whole difference between this
    // and the version it replaced: `withFences` nulls four of the five lists, so
    // `Array.isArray` never saw them and the sweep silently covered a third of
    // the surface it claimed to.
    const LOCAL_LISTS = ['controlPoints', 'props', 'ponds', 'fences', 'groundOutline'] as const;
    const FOLLOWS_THE_ROAD = ['scatters', 'pickupRows', 'widthBands'] as const;
    const record: RealmRacersCircuit = {
      ...withFences([
        {
          kit: 'ironwork',
          points: [
            { x: 0, z: 0 },
            { x: 5, z: 0 },
          ],
        },
      ]),
      props: [{ asset: 'bench', at: { x: 10, z: 20 } }],
      ponds: [{ x: -5, z: -6, rx: 8, rz: 9 }],
      basin: { waterY: -0.5, bankSlope: 0.8, depthMax: 6, wadeYards: 4 },
      scatters: [{ asset: 'bench', zone: 'outfield', spacing: 20, seed: 1 }],
      pickupRows: [{ s: 0.25 }],
      groundOutline: [
        { x: -50, z: -40 },
        { x: 50, z: -40 },
        { x: 50, z: 40 },
        { x: -50, z: 40 },
      ],
    };
    const listFields = Object.entries(record)
      .filter(([, value]) => Array.isArray(value))
      .map(([key]) => key);
    // Non-vacuity: every list the record can carry really is present, so the
    // classification below runs over the whole surface rather than a corner.
    for (const field of [...LOCAL_LISTS, ...FOLLOWS_THE_ROAD]) {
      expect(listFields, `${field} is populated on the fixture`).toContain(field);
    }
    for (const field of listFields) {
      expect(
        [...LOCAL_LISTS, ...FOLLOWS_THE_ROAD, 'roles'] as readonly string[],
        `${field} is a list on the record: decide whether centring moves it`,
      ).toContain(field);
    }
    // And CLASSIFYING a field is not the claim: every local list has to MOVE,
    // and every road-following one has to stay exactly as it was. A sweep that
    // only sorted names would pass over a `moveCircuitContent` that moved
    // nothing at all.
    const moved = moveCircuitContent(record, 11, -7) as unknown as Record<string, unknown>;
    const before = record as unknown as Record<string, unknown>;
    for (const field of LOCAL_LISTS) {
      expect(moved[field], `${field} moves with the road`).not.toEqual(before[field]);
    }
    for (const field of FOLLOWS_THE_ROAD) {
      expect(moved[field], `${field} follows the centerline for free`).toEqual(before[field]);
    }
  });
});
