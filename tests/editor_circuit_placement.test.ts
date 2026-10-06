// The placement flow: where a dropped piece lands, whether the drop is legal,
// and what a drag ALONG the road lays down.
//
// Every case runs against the REAL circuit and the REAL spline. The snap has to
// be measured through `mortarOverdrivePlacements` rather than against the numbers
// the snap itself returned, or the whole point (the ghost shows what the record
// will hold) is asserted by restating it.

import { describe, expect, it } from 'vitest';
import {
  ALONG_ROAD_MAX_PIECES,
  ALONG_ROAD_MIN_SPACING,
  alongRoadProps,
  lapPositionAt,
  lateralAt,
  pendingYawText,
  placementLegality,
  pressWasDrag,
  ROAD_EDGE_CLEARANCE,
  ROAD_EDGE_SNAP_BAND,
  resolveSnap,
  rotatedPendingYaw,
  SCATTER_MIN_SPACING,
  spacingFloor,
  TILE_DRAG_SLOP,
} from '../src/editor/circuit/placement_core';
import { ghostPlacement, ghostRowPlacements } from '../src/editor/circuit/props_core';
import {
  MORTAR_OVERDRIVE_PRACTICE_CIRCUIT as GARDEN,
  type MortarOverdriveCircuit,
} from '../src/sim/content/mortar_overdrive/circuits';
import { MORTAR_OVERDRIVE_ORIGIN } from '../src/sim/mortar_overdrive/layout';
import { mortarOverdrivePlacements } from '../src/sim/mortar_overdrive/props_resolve';
import {
  mortarOverdriveGardenEdgeOffsetAt,
  mortarOverdriveTrack,
} from '../src/sim/mortar_overdrive/spline';

/** A fresh id every time: the resolver and the spline both memoize per circuit
 *  id, and a fixture sharing the shipped one evicts what the rest measures. */
let drafts = 0;
const draft = (over: Partial<MortarOverdriveCircuit> = {}): MortarOverdriveCircuit => ({
  ...GARDEN,
  id: `draft_place_${drafts++}`,
  props: undefined,
  scatters: undefined,
  ...over,
});

/** A point ON the road, and one far out in the lawn, both derived from the real
 *  curve rather than guessed at. */
function pointAtOffset(circuit: MortarOverdriveCircuit, s: number, offset: number) {
  const track = mortarOverdriveTrack(circuit);
  const point = track.pointAt(s);
  return {
    x: point.x - MORTAR_OVERDRIVE_ORIGIN.x - point.tz * offset,
    z: point.z - MORTAR_OVERDRIVE_ORIGIN.z + point.tx * offset,
  };
}

describe('where a dropped piece lands', () => {
  it('pulls a drop ON the road out to the verge, rather than leaving it illegal', () => {
    // The defect this closes: a click on the road placed the piece on the racing
    // surface and the readout refused it. The operator meant the roadside, so
    // the roadside is what they get, and there is no ambiguity to respect: every
    // point inside the garden edge is surface.
    const circuit = draft();
    const on = pointAtOffset(circuit, 100, 2);
    const snap = resolveSnap(circuit, on.x, on.z, { grid: false, free: false });
    expect(snap.kind).toBe('roadEdge');
    const lateral = Math.abs(lateralAt(circuit, snap.x, snap.z));
    const edge = mortarOverdriveGardenEdgeOffsetAt(circuit, lapPositionAt(circuit, snap.x, snap.z));
    expect(lateral).toBeCloseTo(edge + ROAD_EDGE_CLEARANCE, 1);
    expect(snap.label).toContain('road edge');
  });

  it('keeps the side the pointer was on', () => {
    // Otherwise a bench meant for the outside of a corner jumps across the road.
    const circuit = draft();
    for (const side of [1, -1] as const) {
      const near = pointAtOffset(circuit, 140, 18 * side);
      const snap = resolveSnap(circuit, near.x, near.z, { grid: false, free: false });
      expect(snap.kind).toBe('roadEdge');
      expect(Math.sign(lateralAt(circuit, snap.x, snap.z))).toBe(side);
    }
  });

  it('lets go once the pointer is well past the verge', () => {
    // A band, not always-on: snapping a fountain to the verge because the
    // infield happens to project onto a nearby stretch would be the tool
    // overruling a placement nobody made near the road at all.
    const circuit = draft();
    const s = 100;
    const edge = mortarOverdriveGardenEdgeOffsetAt(circuit, s);
    const far = pointAtOffset(circuit, s, edge + ROAD_EDGE_CLEARANCE + ROAD_EDGE_SNAP_BAND + 6);
    expect(resolveSnap(circuit, far.x, far.z, { grid: false, free: false }).kind).not.toBe(
      'roadEdge',
    );
    // At a LITERAL distance too, because every probe above is computed from the
    // constant and moves with it: widening the band to a hundred yards would
    // make the grid and free arms dead code that nothing here noticed. The
    // garden's own edge is under fifteen yards, so sixty is unambiguously lawn.
    const lawn = pointAtOffset(circuit, s, 60);
    expect(resolveSnap(circuit, lawn.x, lawn.z, { grid: false, free: false }).kind).toBe('free');
    expect(resolveSnap(circuit, lawn.x, lawn.z, { grid: true, free: false }).kind).toBe('grid');
  });

  it('holds the two numbers the magnet is made of', () => {
    // Both are load-bearing and both are otherwise only ever quoted back at
    // themselves. A clearance of fifty yards would put every roadside bench
    // fifty yards into the lawn, and a band of a thousand would swallow the
    // grid, with every other case in this file still green.
    expect(ROAD_EDGE_CLEARANCE).toBe(1.5);
    expect(ROAD_EDGE_SNAP_BAND).toBe(7);
    // And the clearance really is enough for the common piece to land legal,
    // which is the reason it is not zero.
    const circuit = draft();
    const on = pointAtOffset(circuit, 100, 0);
    const snap = resolveSnap(circuit, on.x, on.z, { grid: false, free: false });
    expect(
      placementLegality(circuit, ghostPlacement(circuit, 'bench', snap.x, snap.z))?.legal,
    ).toBe(true);
  });

  it('rounds to the grid out in the lawn, and only when the grid is on', () => {
    const circuit = draft();
    const s = 100;
    const edge = mortarOverdriveGardenEdgeOffsetAt(circuit, s);
    const far = pointAtOffset(circuit, s, edge + ROAD_EDGE_CLEARANCE + ROAD_EDGE_SNAP_BAND + 20);
    const gridded = resolveSnap(circuit, far.x, far.z, { grid: true, free: false });
    expect(gridded.kind).toBe('grid');
    expect(gridded.x % 10).toBeCloseTo(0, 6);
    expect(gridded.z % 10).toBeCloseTo(0, 6);
    const free = resolveSnap(circuit, far.x, far.z, { grid: false, free: false });
    expect(free.kind).toBe('free');
    expect(free.x).toBeCloseTo(far.x, 6);
  });

  it('gives alt the last word over every magnet', () => {
    // The operator saying "not that, THERE". It has to beat the road edge too,
    // which is the strongest of the three.
    const circuit = draft();
    const on = pointAtOffset(circuit, 100, 2);
    const snap = resolveSnap(circuit, on.x, on.z, { grid: true, free: true });
    expect(snap.kind).toBe('free');
    expect(snap.x).toBeCloseTo(on.x, 6);
    expect(snap.z).toBeCloseTo(on.z, 6);
    expect(snap.label).toContain('alt');
  });
});

describe('whether the drop is legal', () => {
  it('answers with the READOUT own rule, not a second opinion', () => {
    // The whole promise of the tint: a ghost that reads green cannot be a
    // placement the panel then refuses. Driven both ways through the real
    // metrics, on the same record.
    const circuit = draft();
    const onRoad = pointAtOffset(circuit, 100, 0);
    const illegal = placementLegality(
      circuit,
      ghostPlacement(circuit, 'bench', onRoad.x, onRoad.z),
    );
    expect(illegal?.legal).toBe(false);
    expect(illegal?.label).toContain('racing surface');

    const snap = resolveSnap(circuit, onRoad.x, onRoad.z, { grid: false, free: false });
    const legal = placementLegality(circuit, ghostPlacement(circuit, 'bench', snap.x, snap.z));
    expect(legal?.legal).toBe(true);
    expect(legal?.label).toContain('clear by');
  });

  it('has nothing to say about a piece that does not resolve', () => {
    expect(placementLegality(draft(), null)).toBeNull();
  });
});

describe('telling a click from a drag on a library tile', () => {
  it('takes a small wander as a click and a real one as a drag', () => {
    // The browser sends a click after every drop. Taking it would disarm the
    // piece the drop had just placed, so the second one could not be placed by
    // clicking at all, which is how this gesture died the first time.
    expect(pressWasDrag({ x: 100, y: 100 }, { x: 102, y: 101 })).toBe(false);
    expect(pressWasDrag({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(false);
    expect(pressWasDrag({ x: 100, y: 100 }, { x: 140, y: 260 })).toBe(true);
    // Diagonal, so the slop is a radius rather than a per-axis box.
    expect(pressWasDrag({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(true);
    // A press with no recorded start is a click: nothing to have wandered from.
    expect(pressWasDrag(null, { x: 999, y: 999 })).toBe(false);
    // A literal, because a slop of zero makes every click a drag and the tiles
    // stop arming at all.
    expect(TILE_DRAG_SLOP).toBe(4);
  });
});

describe('the yaw the next piece goes down at', () => {
  const step = (from: number, deltaY: number): number => from + deltaY * 0.25;

  it('steps the angle, and starts from the catalog default', () => {
    expect(rotatedPendingYaw(null, false, step)).toBeCloseTo(0.25, 6);
    expect(rotatedPendingYaw(0.25, false, step)).toBeCloseTo(0.5, 6);
    // Stepping from `tangent` starts over at zero rather than at a number the
    // road happened to hand back: `tangent` is not an angle the operator chose.
    expect(rotatedPendingYaw('tangent', false, step)).toBeCloseTo(0.25, 6);
  });

  it('TOGGLES facing the racing direction rather than accumulating it', () => {
    // Facing the road is a different KIND of answer, re-read wherever the piece
    // ends up, so pressing it twice has to give the angle back rather than
    // leaving the operator with no way out of it.
    expect(rotatedPendingYaw(null, true, step)).toBe('tangent');
    expect(rotatedPendingYaw('tangent', true, step)).toBeNull();
    expect(rotatedPendingYaw(1.2, true, step)).toBe('tangent');
    expect(rotatedPendingYaw(rotatedPendingYaw(1.2, true, step), true, step)).toBeNull();
  });

  it('says which of the three states it is in', () => {
    expect(pendingYawText(null)).toContain('default');
    expect(pendingYawText('tangent')).toContain('racing direction');
    expect(pendingYawText(0.5)).toContain('0.50 rad');
    expect(new Set([pendingYawText(null), pendingYawText('tangent'), pendingYawText(1)]).size).toBe(
      3,
    );
  });
});

describe('how dense a gesture may sow or lay', () => {
  it('gives a scatter a higher floor than a row, because it walks a GRID', () => {
    // Not taste. The resolver walks `(2*halfX/spacing) x (2*halfZ/spacing)` cells
    // with a spline projection in each, so halving the spacing quadruples the
    // work; the field this control replaced carried a floor of two for exactly
    // that reason and sharing the row's floor of one gave it away.
    expect(spacingFloor('scatter')).toBe(SCATTER_MIN_SPACING);
    expect(spacingFloor('alongRoad')).toBe(ALONG_ROAD_MIN_SPACING);
    expect(spacingFloor('single')).toBe(ALONG_ROAD_MIN_SPACING);
    expect(SCATTER_MIN_SPACING).toBeGreaterThan(ALONG_ROAD_MIN_SPACING);
    expect(SCATTER_MIN_SPACING).toBe(2);
  });
});

describe('a row laid along the road', () => {
  const options = {
    asset: 'postLantern',
    spacing: 8,
    offset: 14,
    alignToRoad: true,
    solid: true,
  };

  it('lays one piece per spacing, in track space so it follows a later edit', () => {
    const circuit = draft();
    const run = alongRoadProps(circuit, 100, 180, options);
    // Roughly one per spacing over the run, and deliberately NOT exactly: the
    // row is measured along ITSELF, and this one sits inside a corner where the
    // offset curve is shorter than the eighty yards of lap it spans.
    expect(run.props.length).toBeGreaterThanOrEqual(6);
    expect(run.props.length).toBeLessThanOrEqual(11);
    for (const prop of run.props) {
      // TRACK space is the point: a row of world coordinates leaves the verge
      // the first time a corner moves.
      expect('s' in prop.at).toBe(true);
      if ('s' in prop.at) {
        expect(prop.at.offset).toBe(options.offset);
        expect(prop.at.s).toBeGreaterThanOrEqual(0);
        expect(prop.at.s).toBeLessThan(1);
      }
      expect(prop.yaw).toBe('tangent');
      expect(prop.collide).toBeUndefined();
    }
    expect(run.label).toContain(`laid ${run.props.length} postLantern at 8 yd`);
  });

  it('really is evenly spaced, measured on the ground rather than in fractions', () => {
    const circuit = draft();
    const run = alongRoadProps(circuit, 100, 180, options);
    const placed = ghostRowPlacements(circuit, run.props);
    expect(placed).toHaveLength(run.props.length);
    for (let i = 1; i < placed.length; i++) {
      const gap = Math.hypot(placed[i].x - placed[i - 1].x, placed[i].z - placed[i - 1].z);
      // The point of walking the OFFSET curve: the gap between PIECES is the
      // spacing, on the inside of a corner as much as down a straight. A row
      // stepped by lap distance instead read 5.0 yd through the hairpin.
      expect(gap).toBeGreaterThan(options.spacing * 0.92);
      expect(gap).toBeLessThan(options.spacing * 1.08);
    }
  });

  it('runs in the direction dragged, both ways', () => {
    const circuit = draft();
    const forward = alongRoadProps(circuit, 100, 160, options).props;
    const back = alongRoadProps(circuit, 160, 100, options).props;
    expect(forward).toHaveLength(back.length);
    const at = (props: typeof forward, i: number) => ('s' in props[i].at ? props[i].at.s : -1);
    expect(at(forward, 1)).toBeGreaterThan(at(forward, 0));
    expect(at(back, 1)).toBeLessThan(at(back, 0));
  });

  it('takes the SHORT way over the start line rather than round the lap', () => {
    // The pit straight is where a row of banners belongs, and it is exactly the
    // stretch the lap fraction wraps on.
    const circuit = draft();
    const lap = mortarOverdriveTrack(circuit).length;
    const run = alongRoadProps(circuit, lap - 20, 20, options);
    expect(run.props.length).toBeLessThanOrEqual(Math.floor(40 / 8) + 1);
    const fractions = run.props.map((prop) => ('s' in prop.at ? prop.at.s : -1));
    // It really crossed the line: some before it, some after.
    expect(fractions.some((s) => s > 0.9)).toBe(true);
    expect(fractions.some((s) => s < 0.1)).toBe(true);
  });

  it('authors the solid toggle, both ways', () => {
    const circuit = draft();
    const decorative = alongRoadProps(circuit, 100, 140, { ...options, solid: false }).props;
    for (const prop of decorative) expect(prop.collide).toBe('none');
    const solid = alongRoadProps(circuit, 100, 140, { ...options, solid: true }).props;
    for (const prop of solid) expect(prop.collide).toBeUndefined();
  });

  it('authors the align toggle, both ways', () => {
    const circuit = draft();
    const free = alongRoadProps(circuit, 100, 140, { ...options, alignToRoad: false }).props;
    for (const prop of free) expect(prop.yaw).toBeUndefined();
    const aligned = alongRoadProps(circuit, 100, 140, { ...options, alignToRoad: true }).props;
    for (const prop of aligned) expect(prop.yaw).toBe('tangent');
  });

  it('refuses a spacing that would weld the row into a hedge', () => {
    const circuit = draft();
    const run = alongRoadProps(circuit, 100, 110, { ...options, spacing: 0 });
    expect(run.label).toContain(`at ${ALONG_ROAD_MIN_SPACING} yd`);
    // A ten yard run at the floor is about eleven pieces, never one welded blob.
    expect(run.props.length).toBeGreaterThan(5);
  });

  it('caps the row, and SAYS how many it dropped', () => {
    // A drag over a whole lap at a two yard spacing is hundreds of props nobody
    // meant to author; a silent cap would read as the tool losing the gesture.
    const circuit = draft();
    const lap = mortarOverdriveTrack(circuit).length;
    const run = alongRoadProps(circuit, 0, lap / 2 - 1, {
      ...options,
      spacing: ALONG_ROAD_MIN_SPACING,
    });
    expect(run.props).toHaveLength(ALONG_ROAD_MAX_PIECES);
    expect(run.label).toContain('past the');
    expect(run.label).toContain(String(ALONG_ROAD_MAX_PIECES));
    // Literals, or a cap of five and a floor of a thousandth of a yard would
    // pass everything above: the cap is what stops a two hundred prop record and
    // the floor is what stops a row welding into one hedge.
    expect(ALONG_ROAD_MAX_PIECES).toBe(120);
    expect(ALONG_ROAD_MIN_SPACING).toBe(1);
  });

  it('lays a single piece for a drag that never moved', () => {
    const run = alongRoadProps(draft(), 120, 120, options);
    expect(run.props).toHaveLength(1);
    expect(run.label).not.toContain('past the');
  });
});

describe('the row preview', () => {
  it('previews the PENDING pieces, never the ones already standing there', () => {
    // The along-road preview resolves a throwaway record carrying both, and
    // taking "the tail" of that would show the circuit's own last props for a
    // row of an unknown key.
    const circuit = draft({ props: [{ asset: 'fountain', at: { x: -70, z: -30 } }] });
    const pending = alongRoadProps(circuit, 100, 130, {
      asset: 'bench',
      spacing: 10,
      offset: 16,
      alignToRoad: true,
      solid: true,
    }).props;
    const preview = ghostRowPlacements(circuit, pending);
    expect(preview).toHaveLength(pending.length);
    for (const piece of preview) expect(piece.asset).toBe('bench');
    // And the record it was resolved on is untouched.
    expect(circuit.props).toHaveLength(1);
  });

  it('previews nothing for a row of a key the catalog does not author', () => {
    const circuit = draft({ props: [{ asset: 'fountain', at: { x: -70, z: -30 } }] });
    const preview = ghostRowPlacements(circuit, [
      { asset: 'notAThing', at: { s: 0.1, offset: 12 } },
      { asset: 'notAThing', at: { s: 0.2, offset: 12 } },
    ]);
    expect(preview).toHaveLength(0);
    // Specifically NOT the fountain that was already standing there.
    expect(mortarOverdrivePlacements(circuit).props).toHaveLength(1);
  });

  it('answers an empty pending list without resolving anything', () => {
    expect(ghostRowPlacements(draft(), [])).toEqual([]);
  });
});
