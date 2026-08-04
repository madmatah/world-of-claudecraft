// The plan canvas's own arithmetic: the starter circuit, the fit, the two limit
// boxes, the hit tolerances and the colours it borrows from the stylesheet.
//
// All of it was inline in `main.ts`, which is the one thing the local CLAUDE.md
// says the page may not hold. Pinned here because each number is a decision:
// framing the ROOM a circuit has rather than a shape nobody drew, keeping the
// centerline a road-and-garden inside the wall, and reading a token once rather
// than spelling its hex twice.

import { describe, expect, it } from 'vitest';
import { ZOOM_MAX_SCALE, ZOOM_MIN_SCALE } from '../src/editor/circuit/layout_core';
import {
  blankCircuit,
  FIT_MARGIN_BLANK,
  FIT_MARGIN_DRAWN,
  fitHalfExtent,
  fitScale,
  HIT_TOLERANCE_PIXELS,
  labelledPieces,
  PLAN_PALETTE_FALLBACK,
  PLAN_PALETTE_VARS,
  PROP_LABEL_MIN_SCALE,
  planLimits,
  resolvePlanPalette,
  STARTER_OVAL,
  starterControlPoints,
  WHEEL_ZOOM_STEP,
  wheelZoomScale,
  withAlpha,
} from '../src/editor/circuit/plan_core';
import { REALM_RACERS_PRACTICE_CIRCUIT } from '../src/sim/content/realm_racers_circuits';
import { realmRacersCircuitMetrics } from '../src/sim/realm_racers_circuit_metrics';
import {
  REALM_RACERS_MAX_REGION_HALF_X,
  REALM_RACERS_MAX_REGION_HALF_Z,
  REALM_RACERS_RUNOFF_WIDTH,
  REALM_RACERS_VERGE_MARGIN,
} from '../src/sim/realm_racers_layout';
import { realmRacersTrack } from '../src/sim/realm_racers_spline';

describe('the starter oval', () => {
  it('is a closed counter-clockwise ring the spline can read', () => {
    const points = starterControlPoints();
    expect(points).toHaveLength(STARTER_OVAL.points);
    // Whole yards: the export rounds anyway, and a starter carrying fifteen
    // decimals reads as a shape somebody measured.
    for (const point of points) {
      expect(Number.isInteger(point.x)).toBe(true);
      expect(Number.isInteger(point.z)).toBe(true);
    }
    expect(Math.max(...points.map((p) => Math.abs(p.x)))).toBe(STARTER_OVAL.halfX);
    expect(Math.max(...points.map((p) => Math.abs(p.z)))).toBe(STARTER_OVAL.halfZ);
  });

  it('opens on geometry the readout does not complain about at all', () => {
    // The whole reason the starter is sized rather than arbitrary: a tool that
    // opens on a circuit its own panel is complaining about teaches the operator
    // to ignore the panel. So the assertion has to be the READOUT's own verdict:
    // measuring the spline instead passes with the oval wound backwards, which
    // is `reversed_winding` on screen from the first frame.
    const circuit = {
      ...REALM_RACERS_PRACTICE_CIRCUIT,
      id: 'test_starter',
      controlPoints: starterControlPoints(),
      widthBands: [
        { s: 0, halfWidth: 10 },
        { s: 1, halfWidth: 10 },
      ],
      props: undefined,
      scatters: undefined,
      ponds: undefined,
      basin: undefined,
    };
    expect(realmRacersCircuitMetrics(circuit).problems).toEqual([]);
    // Counter-clockwise, which is the winding the readout wants, named rather
    // than left to the empty-problems assertion alone.
    expect(realmRacersCircuitMetrics(circuit).winding).toBeGreaterThan(0);
    expect(realmRacersTrack(circuit).length).toBeGreaterThan(100);
  });

  it('fits inside the room a circuit has, garden and all', () => {
    const limits = planLimits([10]);
    expect(STARTER_OVAL.halfX).toBeLessThan(limits.inner.halfX);
    expect(STARTER_OVAL.halfZ).toBeLessThan(limits.inner.halfZ);
  });
});

describe('framing the plan', () => {
  it('frames the ROOM a circuit has on a blank canvas, never the placeholder', () => {
    // The placeholder record has extents of its own and they are a shape nobody
    // drew, so a blank fit must not read them at all: the two road arguments are
    // ignored on that arm.
    const blank = fitHalfExtent(false, 5, 5);
    expect(blank).toBe(fitHalfExtent(false, 900, 900));
    expect(blank).toBeCloseTo(
      Math.max(REALM_RACERS_MAX_REGION_HALF_X, REALM_RACERS_MAX_REGION_HALF_Z) * FIT_MARGIN_BLANK,
      6,
    );
  });

  it('leaves a dressing margin around a drawn circuit, and a floor under a tiny one', () => {
    expect(fitHalfExtent(true, 200, 80)).toBeCloseTo(200 * FIT_MARGIN_DRAWN, 6);
    expect(fitHalfExtent(true, 80, 200)).toBeCloseTo(200 * FIT_MARGIN_DRAWN, 6);
    // A circuit smaller than the floor still frames at the floor: zooming to
    // 400% on a 3 yard loop is not a view of anything.
    expect(fitHalfExtent(true, 1, 1)).toBeCloseTo(20 * FIT_MARGIN_DRAWN, 6);
    expect(FIT_MARGIN_DRAWN).toBeGreaterThan(1);
  });

  it('never hands back a scale the plan cannot be drawn at', () => {
    // The regression this clamp exists for: at boot the plan measures zero, and
    // a scale of zero made every screen coordinate NaN and froze the first frame.
    expect(fitScale(0, 0, 100)).toBe(ZOOM_MIN_SCALE);
    expect(fitScale(4000, 4000, 1)).toBe(ZOOM_MAX_SCALE);
    // The binding axis is the SHORT one: framing on the long one puts half the
    // circuit off the side.
    expect(fitScale(1000, 400, 100)).toBe(fitScale(400, 1000, 100));
    expect(fitScale(1000, 400, 100)).toBeCloseTo(400 / 200, 6);
  });
});

describe('the two limit boxes', () => {
  it('keeps the wall inside the region and the road inside the wall', () => {
    const limits = planLimits([10]);
    expect(limits.outer.halfX).toBe(REALM_RACERS_MAX_REGION_HALF_X - 1);
    expect(limits.outer.halfZ).toBe(REALM_RACERS_MAX_REGION_HALF_Z - 1);
    const gardenEdge = 10 + REALM_RACERS_VERGE_MARGIN + REALM_RACERS_RUNOFF_WIDTH;
    expect(limits.inner.halfX).toBe(limits.outer.halfX - gardenEdge);
    expect(limits.inner.halfZ).toBe(limits.outer.halfZ - gardenEdge);
  });

  it('shrinks the inner box as the road widens, since the pen only draws the middle', () => {
    const narrow = planLimits([6]);
    const wide = planLimits([6, 24, 9]);
    expect(wide.inner.halfX).toBeLessThan(narrow.inner.halfX);
    expect(wide.inner.halfX).toBe(narrow.inner.halfX - 18);
    // The widest band binds, not the last one written.
    expect(planLimits([24, 6]).inner.halfX).toBe(wide.inner.halfX);
  });

  it('says both numbers in whole yards, in its own sentence', () => {
    const limits = planLimits([10]);
    expect(limits.outerLabel).toBe(
      `widest a circuit may be: ${limits.outer.halfX * 2} x ${limits.outer.halfZ * 2} yd`,
    );
    expect(limits.innerLabel).toBe(
      `keep the line you draw inside ${Math.round(limits.inner.halfX * 2)} x ${Math.round(limits.inner.halfZ * 2)} yd`,
    );
    expect(limits.innerLabel).not.toMatch(/\.\d/);
  });

  it('survives a record with no bands at all', () => {
    // A hand-pasted draft can arrive with anything; `Math.max()` of nothing is
    // -Infinity, which draws a box at infinity and takes the page with it.
    const limits = planLimits([]);
    expect(Number.isFinite(limits.inner.halfX)).toBe(true);
    expect(Number.isFinite(limits.inner.halfZ)).toBe(true);
  });
});

describe('what a gesture may miss by', () => {
  it('gives the curve a wider catch than the handles sitting on it', () => {
    // Otherwise a click meant for the line between two handles lands on neither:
    // the handle test runs first, so its tolerance has to be the tighter one.
    expect(HIT_TOLERANCE_PIXELS.segment).toBeGreaterThan(HIT_TOLERANCE_PIXELS.handle);
    expect(HIT_TOLERANCE_PIXELS.dressing).toBeGreaterThan(0);
    // Literals as well as the ordering, so a sweeping retune has to come through
    // here rather than sliding under a relative assertion that holds either way.
    expect(HIT_TOLERANCE_PIXELS).toEqual({ handle: 8, segment: 10, dressing: 7 });
    expect(PROP_LABEL_MIN_SCALE).toBe(1.6);
  });

  it('writes a key beside a piece only where there is room for one', () => {
    // A zoom threshold alone stopped being enough the moment one gesture could
    // lay a row: eleven lanterns eight yards apart are eleven labels on top of
    // each other, which is less readable than none at all.
    const row = Array.from({ length: 11 }, (_, i) => ({ x: 100 + i * 12, y: 200 }));
    const granted = labelledPieces(row);
    expect(granted[0]).toBe(true);
    expect(granted.filter(Boolean).length).toBeLessThan(row.length);
    expect(granted.filter(Boolean).length).toBeGreaterThan(0);
    // Spread out, everyone gets one.
    const spread = Array.from({ length: 5 }, (_, i) => ({ x: i * 400, y: 200 }));
    expect(labelledPieces(spread).every(Boolean)).toBe(true);
    // Stacked vertically they do not collide: the gap is mostly horizontal,
    // because a label is a wide short thing.
    const column = Array.from({ length: 5 }, (_, i) => ({ x: 100, y: i * 60 }));
    expect(labelledPieces(column).every(Boolean)).toBe(true);
  });

  it('grants labels first-come, so a hover does not reshuffle them', () => {
    // Stability matters more than optimality here: the pointer moves and the
    // canvas repaints, and labels that swapped between pieces every frame would
    // be unreadable however few of them there were.
    const row = Array.from({ length: 8 }, (_, i) => ({ x: i * 20, y: 0 }));
    expect(labelledPieces(row)).toEqual(labelledPieces(row));
    expect(labelledPieces(row)[0]).toBe(true);
    // A tighter gap grants fewer, a looser one grants more.
    expect(labelledPieces(row, 200).filter(Boolean).length).toBeLessThan(
      labelledPieces(row, 20).filter(Boolean).length,
    );
    expect(labelledPieces([])).toEqual([]);
  });

  it('zooms symmetrically about a notch, and stops at both bounds', () => {
    const up = wheelZoomScale(2, -1);
    expect(up).toBeCloseTo(2 * WHEEL_ZOOM_STEP, 6);
    expect(wheelZoomScale(up, 1)).toBeCloseTo(2, 6);
    expect(wheelZoomScale(ZOOM_MAX_SCALE, -1)).toBe(ZOOM_MAX_SCALE);
    expect(wheelZoomScale(ZOOM_MIN_SCALE, 1)).toBe(ZOOM_MIN_SCALE);
  });
});

describe('the colours the canvas borrows', () => {
  it('reads every shared token off the sheet, trimmed', () => {
    const palette = resolvePlanPalette((property) =>
      property === '--pick' ? ' #abcdef ' : '#111111',
    );
    expect(palette.pick).toBe('#abcdef');
    expect(palette.bad).toBe('#111111');
    expect(Object.keys(palette).sort()).toEqual(Object.keys(PLAN_PALETTE_VARS).sort());
  });

  it('falls back rather than drawing with an empty colour', () => {
    // A page with no stylesheet applied still has to draw: `fillStyle = ''` is a
    // silent no-op that leaves the last colour set, which is a canvas painted in
    // whatever came before it.
    const palette = resolvePlanPalette(() => '');
    expect(palette).toEqual(PLAN_PALETTE_FALLBACK);
    expect(Object.isFrozen(palette)).toBe(true);
  });

  it('names a real custom property for every entry', () => {
    for (const property of Object.values(PLAN_PALETTE_VARS)) {
      expect(property.startsWith('--')).toBe(true);
    }
  });

  it('opens a blank canvas on the template NUMBERS and none of its content', () => {
    // The defect, twice over. The template is a shipped circuit, borrowed for the
    // fields a record cannot be well formed without; everything its author PLACED
    // on it belongs to its shape and not to the operator's. First the practice
    // circuit's infield fountain came through, which on a circuit whose road runs
    // through that point is a metrics error nobody authored. Then `pickupRows`
    // was added to the record after that fix and never added to the clearing, so
    // drawing a fresh circuit laid three rows of boxes, twelve crates, that the
    // operator did not place and could not see the source of.
    const blank = blankCircuit(REALM_RACERS_PRACTICE_CIRCUIT);
    // The template really does carry all of it: without this the assertions
    // below would pass over an empty source and prove nothing.
    expect(REALM_RACERS_PRACTICE_CIRCUIT.props?.length ?? 0).toBeGreaterThan(0);
    expect(REALM_RACERS_PRACTICE_CIRCUIT.ponds?.length ?? 0).toBeGreaterThan(0);
    expect(REALM_RACERS_PRACTICE_CIRCUIT.pickupRows?.length ?? 0).toBeGreaterThan(0);
    expect(REALM_RACERS_PRACTICE_CIRCUIT.basin).toBeDefined();
    expect(blank.props).toBeUndefined();
    expect(blank.scatters).toBeUndefined();
    expect(blank.ponds).toBeUndefined();
    expect(blank.basin).toBeUndefined();
    expect(blank.pickupRows).toBeUndefined();
    // And it did inherit the numbers, or it would be clearing the wrong thing.
    expect(blank.perimeter).toEqual(REALM_RACERS_PRACTICE_CIRCUIT.perimeter);
    expect(blank.laps).toBe(REALM_RACERS_PRACTICE_CIRCUIT.laps);
  });

  it('leaves NOTHING placed behind, whatever the record grows next', () => {
    // The list above is exactly what rotted: it was written for the dressing and
    // a later field walked straight past it. A structural sweep catches the next
    // one without anybody remembering to come back here, because every kind of
    // placed content on this record is a LIST. The three allowed are the geometry
    // and the roles, which a blank record cannot be valid without.
    const SHAPE_LISTS = ['controlPoints', 'widthBands', 'roles'];
    const kept = Object.entries(blankCircuit(REALM_RACERS_PRACTICE_CIRCUIT))
      .filter(([, value]) => Array.isArray(value))
      .map(([key]) => key);
    expect(kept.length).toBeGreaterThan(0);
    for (const key of kept) {
      expect(SHAPE_LISTS, `${key} is content a blank canvas kept from the template`).toContain(key);
    }
  });

  it('derives a wash from the colour it strokes with', () => {
    expect(withAlpha('#ffd479', 0.35)).toBe('rgba(255, 212, 121, 0.35)');
    expect(withAlpha('#fff', 1)).toBe('rgba(255, 255, 255, 1)');
    expect(withAlpha('#FFD479', 0.5)).toBe('rgba(255, 212, 121, 0.5)');
    // Anything it cannot read comes back untouched rather than as `rgba(NaN...)`,
    // which paints nothing at all.
    expect(withAlpha('rebeccapurple', 0.5)).toBe('rebeccapurple');
    expect(withAlpha('', 0.5)).toBe('');
  });
});
