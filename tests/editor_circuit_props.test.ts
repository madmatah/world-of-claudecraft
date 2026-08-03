// Placing the dressing in the circuit editor.
//
// Every case here is about the tool AUTHORING what the game will resolve: a
// click becomes a record entry, and the record entry is fed back through
// `realmRacersPlacements`, the one resolver, to say where the piece actually
// stands. Asserting the editor's own arithmetic instead would pass while the
// two disagree, which is the exact defect (a placement derived twice) the
// resolver exists to make impossible.

import { describe, expect, it } from 'vitest';
import {
  authorPlacement,
  convertedProp,
  type DressingRect,
  hitTestPlaced,
  hitTestPondHandle,
  hitTestPonds,
  movedProp,
  POND_MIN_RADIUS,
  POND_ROTATE_HANDLE_GAP,
  PROP_TRACK_SPACE_BAND,
  pondFromDrag,
  pondHandlePoints,
  pondWithHandleAt,
  propFrameOf,
  propPalette,
  propProjectionHint,
  removedAt,
  replacedAt,
  rotatedProp,
  scaledProp,
  scatterFromRect,
  tangentProp,
  toggledCollide,
} from '../src/editor/circuit/props_core';
import type { RallyProp, RealmRacersCircuit } from '../src/sim/content/realm_racers_circuits';
import {
  REALM_RACERS_PRACTICE_CIRCUIT as GARDEN,
  REALM_RACERS_CIRCUITS,
} from '../src/sim/content/realm_racers_circuits';
import { REALM_RACERS_PROPS } from '../src/sim/content/realm_racers_props';
import { REALM_RACERS_ORIGIN } from '../src/sim/realm_racers_layout';
import { realmRacersPlacements } from '../src/sim/realm_racers_props_resolve';
import { REALM_RACERS_PROJECTION_ENVELOPE, realmRacersTrack } from '../src/sim/realm_racers_spline';

const EXPRESS = REALM_RACERS_CIRCUITS.evergarden_express_tour;

/** A draft carrying one authored piece. A fresh id every time, because the
 *  resolver memoizes per circuit id and a fixture sharing the shipped one would
 *  evict the record the rest of the suite measures. */
let drafts = 0;
const withProps = (
  circuit: RealmRacersCircuit,
  props: readonly RallyProp[],
): RealmRacersCircuit => ({ ...circuit, id: `draft_props_${drafts++}`, props });

/** Where the one prop on a draft actually stands, straight off the resolver. */
const placedOn = (circuit: RealmRacersCircuit, prop: RallyProp) =>
  realmRacersPlacements(withProps(circuit, [prop])).props[0];

/** A point `offset` yards along the left normal at lap fraction `fraction`,
 *  circuit-local. The frame every assertion below is written in. */
function pointAt(circuit: RealmRacersCircuit, fraction: number, offset: number) {
  const track = realmRacersTrack(circuit);
  const point = track.pointAt(fraction * track.length);
  return {
    x: point.x - REALM_RACERS_ORIGIN.x - point.tz * offset,
    z: point.z - REALM_RACERS_ORIGIN.z + point.tx * offset,
  };
}

describe('circuit editor props: which frame a click authors', () => {
  it('places trackside furniture in track-space, at the fraction and offset clicked', () => {
    const spot = pointAt(GARDEN, 0.3, 14);
    const placement = authorPlacement(GARDEN, spot.x, spot.z);
    expect('s' in placement.at).toBe(true);
    if (!('s' in placement.at)) return;
    expect(placement.at.s).toBeCloseTo(0.3, 3);
    expect(placement.at.offset).toBeCloseTo(14, 1);
  });

  it('places an infield landmark in circuit-local coordinates, verbatim', () => {
    // Well past the garden edge plus the margin: this is the fountain case, and
    // an absolute point is stored exactly as clicked with no projection in it.
    const spot = pointAt(GARDEN, 0.3, 60);
    const placement = authorPlacement(GARDEN, spot.x, spot.z);
    expect(placement.at).toEqual({ x: spot.x, z: spot.z });
  });

  it('switches frames at the spline projection envelope, not at a number of its own', () => {
    // The band is the sim's envelope because that is where a projection stops
    // being an answer; a margin invented here could sit outside it and author
    // placements the spline itself does not trust.
    const inside = pointAt(GARDEN, 0.3, PROP_TRACK_SPACE_BAND - 1);
    const outside = pointAt(GARDEN, 0.3, PROP_TRACK_SPACE_BAND + 1);
    expect(PROP_TRACK_SPACE_BAND).toBe(REALM_RACERS_PROJECTION_ENVELOPE);
    expect(
      propFrameOf({ asset: 'bench', at: authorPlacement(GARDEN, inside.x, inside.z).at }),
    ).toBe('track');
    expect(
      propFrameOf({ asset: 'bench', at: authorPlacement(GARDEN, outside.x, outside.z).at }),
    ).toBe('absolute');
  });

  it('honours an explicit frame over the distance rule, both ways', () => {
    const near = pointAt(GARDEN, 0.3, 14);
    const far = pointAt(GARDEN, 0.3, 60);
    expect(authorPlacement(GARDEN, near.x, near.z, 'absolute').at).toEqual({
      x: near.x,
      z: near.z,
    });
    expect('s' in authorPlacement(GARDEN, far.x, far.z, 'track').at).toBe(true);
  });
});

describe('circuit editor props: what the resolver does with what was authored', () => {
  it('stands a track-space piece where it was clicked', () => {
    const spot = pointAt(GARDEN, 0.62, 15);
    const placed = placedOn(GARDEN, {
      asset: 'bench',
      at: authorPlacement(GARDEN, spot.x, spot.z).at,
    });
    expect(placed.x).toBeCloseTo(spot.x, 1);
    expect(placed.z).toBeCloseTo(spot.z, 1);
  });

  it('stands an absolute piece where it was clicked', () => {
    const spot = pointAt(GARDEN, 0.62, 55);
    const placed = placedOn(GARDEN, {
      asset: 'fountain',
      at: authorPlacement(GARDEN, spot.x, spot.z).at,
    });
    expect(placed.x).toBeCloseTo(spot.x, 6);
    expect(placed.z).toBeCloseTo(spot.z, 6);
  });

  it('keeps a converted piece exactly where it stood, in the other frame', () => {
    const spot = pointAt(GARDEN, 0.62, 15);
    const authored: RallyProp = { asset: 'bench', at: authorPlacement(GARDEN, spot.x, spot.z).at };
    const placed = placedOn(GARDEN, authored);
    const converted = convertedProp(GARDEN, authored, placed.x, placed.z);
    expect(propFrameOf(converted)).toBe('absolute');
    const after = placedOn(GARDEN, converted);
    expect(after.x).toBeCloseTo(placed.x, 6);
    expect(after.z).toBeCloseTo(placed.z, 6);
    // ...and back, through the same call.
    const back = convertedProp(GARDEN, converted, after.x, after.z);
    expect(propFrameOf(back)).toBe('track');
    expect(placedOn(GARDEN, back).x).toBeCloseTo(placed.x, 1);
  });

  it('re-anchors a track-space piece when the centerline moves under it', () => {
    // The whole reason the frame exists: a bench at the hairpin is still at the
    // hairpin after the corner is redrawn, where an absolute point would be
    // left standing in the new road.
    const spot = pointAt(GARDEN, 0.5, 14);
    const authored: RallyProp = { asset: 'bench', at: authorPlacement(GARDEN, spot.x, spot.z).at };
    const before = placedOn(GARDEN, authored);
    const moved: RealmRacersCircuit = {
      ...GARDEN,
      controlPoints: GARDEN.controlPoints.map((point, i) =>
        i === 9 ? { x: point.x, z: point.z + 14 } : point,
      ),
    };
    const after = placedOn(moved, authored);
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(2);
    // It moved because the ROAD moved: the piece still sits the authored
    // fourteen yards off the centerline, on the redrawn curve.
    const movedTrack = realmRacersTrack(moved);
    const projection = movedTrack.project(
      after.x + REALM_RACERS_ORIGIN.x,
      after.z + REALM_RACERS_ORIGIN.z,
    );
    expect(projection.lateral).toBeCloseTo(14, 1);
  });
});

describe('circuit editor props: dragging across the pinch', () => {
  /**
   * The Express Tour runs two stretches eleven yards apart, dead head on. It is
   * the shape that makes a drag dangerous: past the projection envelope the
   * nearest stretch is ambiguous, and an unhinted projection of a point in that
   * strip takes whichever the search reached first, so a piece dragged across
   * the corridor comes back anchored a quarter of a lap away and follows the
   * WRONG road the next time a control point moves.
   */
  const CORRIDOR_FRACTION = 0.185;

  it('drops a piece dragged out of the band rather than re-anchoring it anywhere', () => {
    const start = pointAt(EXPRESS, CORRIDOR_FRACTION, 12);
    const authored: RallyProp = {
      asset: 'bench',
      at: authorPlacement(EXPRESS, start.x, start.z).at,
    };
    expect(propFrameOf(authored)).toBe('track');
    const hint = propProjectionHint(EXPRESS, authored);
    expect(hint).toBeGreaterThanOrEqual(0);

    // Dragged across the strip, past the envelope and towards the facing
    // stretch. A projection at 30 yards is exactly what the sim distrusts: it
    // comes back on the far stretch at s = 0.457.
    const target = pointAt(EXPRESS, CORRIDOR_FRACTION, 30);
    const track = realmRacersTrack(EXPRESS);
    const raw = track.project(
      target.x + REALM_RACERS_ORIGIN.x,
      target.z + REALM_RACERS_ORIGIN.z,
      hint,
    );
    expect(Math.abs(raw.s / track.length - CORRIDOR_FRACTION)).toBeGreaterThan(0.1);

    // So the piece stops being track-space and stands exactly where it was
    // dropped instead.
    const dropped = movedProp(EXPRESS, authored, target.x, target.z, hint);
    expect(propFrameOf(dropped)).toBe('absolute');
    const placed = placedOn(EXPRESS, dropped);
    expect(placed.x).toBeCloseTo(target.x, 6);
    expect(placed.z).toBeCloseTo(target.z, 6);
  });

  it('keeps a piece dragged inside the band on the stretch it started on', () => {
    const start = pointAt(EXPRESS, CORRIDOR_FRACTION, 8);
    const authored: RallyProp = {
      asset: 'bench',
      at: authorPlacement(EXPRESS, start.x, start.z).at,
    };
    const target = pointAt(EXPRESS, CORRIDOR_FRACTION, 20);
    const moved = movedProp(
      EXPRESS,
      authored,
      target.x,
      target.z,
      propProjectionHint(EXPRESS, authored),
    );
    if (!('s' in moved.at)) throw new Error('inside the band it stays track-space');
    expect(moved.at.s).toBeCloseTo(CORRIDOR_FRACTION, 2);
    expect(moved.at.offset).toBeCloseTo(20, 1);
  });

  it('leaves an infield landmark absolute however near the road it is dragged', () => {
    const fountain: RallyProp = { asset: 'fountain', at: { x: 0, z: 0 } };
    const target = pointAt(EXPRESS, 0.4, 6);
    const moved = movedProp(EXPRESS, fountain, target.x, target.z);
    expect(moved.at).toEqual({ x: target.x, z: target.z });
  });
});

describe('circuit editor props: transforms', () => {
  const BENCH: RallyProp = { asset: 'bench', at: { x: 20, z: 30 } };

  it('rotates by a fixed step from the angle the piece is drawn at', () => {
    const turned = rotatedProp(BENCH, 0, 1);
    expect(turned.yaw).toBeCloseTo(Math.PI / 12, 6);
    // A piece facing the racing direction rotates from THAT angle, not from
    // zero, so the first tick nudges it instead of snapping it north.
    const facing = rotatedProp(tangentProp(BENCH), 1.5, 1);
    expect(facing.yaw).toBeCloseTo(1.5 + Math.PI / 12, 6);
  });

  it('scales within the shared placement bounds', () => {
    expect(scaledProp(BENCH, -1).scale).toBeCloseTo(1.1, 6);
    let big: RallyProp = { ...BENCH, scale: 5 };
    for (let i = 0; i < 5; i++) big = scaledProp(big, -1);
    expect(big.scale).toBe(5);
    let small: RallyProp = { ...BENCH, scale: 0.2 };
    for (let i = 0; i < 5; i++) small = scaledProp(small, 1);
    expect(small.scale).toBe(0.2);
  });

  it('toggles a piece between the catalog default and no collision at all', () => {
    const off = toggledCollide(BENCH);
    expect(off.collide).toBe('none');
    expect(placedOn(GARDEN, off).solid).toBe(false);
    const on = toggledCollide(off);
    expect(on.collide).toBeUndefined();
    expect(placedOn(GARDEN, on).solid).toBe(REALM_RACERS_PROPS.bench.solid);
    // The keypress never eats a footprint typed into the inspector.
    const bespoke: RallyProp = { ...BENCH, collide: { kind: 'circle', r: 3 } };
    expect(toggledCollide(bespoke).collide).toBe('none');
  });

  it('edits and deletes list entries without touching the rest', () => {
    const list: RallyProp[] = [BENCH, { ...BENCH, asset: 'oak' }];
    expect(replacedAt(list, 1, { ...BENCH, asset: 'well' })[1].asset).toBe('well');
    expect(replacedAt(list, 1, { ...BENCH, asset: 'well' })[0]).toBe(BENCH);
    expect(removedAt(list, 0)).toEqual([{ ...BENCH, asset: 'oak' }]);
    // An empty dressing is an ABSENT field, not an empty array: the record's
    // own shape, and what the export omits.
    expect(removedAt([BENCH], 0)).toBeUndefined();
  });
});

describe('circuit editor props: what the pointer is over', () => {
  it('grabs a piece anywhere on its own footprint, and the topmost one first', () => {
    const placements = realmRacersPlacements(
      withProps(GARDEN, [
        { asset: 'fountain', at: { x: 0, z: 0 }, scale: 2 },
        { asset: 'bench', at: { x: 0, z: 0 } },
      ]),
    );
    // The fountain's basin is 3.3 yards at scale 1, so at scale 2 a click six
    // yards out is still on it and one ten yards out is on nothing.
    expect(hitTestPlaced(placements.props, 6, 0)).toBe(0);
    expect(hitTestPlaced(placements.props, 10, 0)).toBe(-1);
    // Both are under the origin; the one authored last wins, which is the one
    // drawn on top.
    expect(hitTestPlaced(placements.props, 0, 0)).toBe(1);
  });

  it('lets a pixel tolerance grab a piece too small to aim at', () => {
    const lone = realmRacersPlacements(withProps(GARDEN, [{ asset: 'bench', at: { x: 0, z: 0 } }]));
    // A bench is under a yard across, which at a wide zoom is a pixel.
    expect(hitTestPlaced(lone.props, 0, 2)).toBe(-1);
    expect(hitTestPlaced(lone.props, 0, 2, 3)).toBe(0);
  });

  it('grabs a pond by its resolved outline, wobble and all', () => {
    const ponds = realmRacersPlacements({
      ...GARDEN,
      id: 'draft_props_pond_hit',
      ponds: [{ x: 30, z: -10, rx: 12, rz: 8, seed: 7 }],
    }).ponds;
    expect(hitTestPonds(ponds, 30, -10)).toBe(0);
    expect(hitTestPonds(ponds, 30 + 12 + 8, -10)).toBe(-1);
    // Every outline point is ON the shape, so none of them may read as outside.
    for (const point of ponds[0].outline) {
      const inward = { x: point.x + (30 - point.x) * 0.05, z: point.z + (-10 - point.z) * 0.05 };
      expect(hitTestPonds(ponds, inward.x, inward.z)).toBe(0);
    }
  });
});

describe('circuit editor props: ponds', () => {
  it('fills the box a drag describes, never smaller than a pond can be', () => {
    expect(pondFromDrag(10, 20, 30, 40, 3)).toEqual({ x: 20, z: 30, rx: 10, rz: 10, seed: 3 });
    // Drawn backwards, and drawn tiny.
    expect(pondFromDrag(30, 40, 10, 20, 3)).toEqual({ x: 20, z: 30, rx: 10, rz: 10, seed: 3 });
    const pinched = pondFromDrag(10, 20, 11, 21, 3);
    expect(pinched.rx).toBe(POND_MIN_RADIUS);
    expect(pinched.rz).toBe(POND_MIN_RADIUS);
  });

  it('puts the handles on the axes the pond itself is drawn on', () => {
    const points = pondHandlePoints({ x: 0, z: 0, rx: 10, rz: 6, rot: Math.PI / 2 });
    // Rotated a quarter turn, the rx handle is along +z and the rz handle
    // along -x.
    expect(points.rx.x).toBeCloseTo(0, 6);
    expect(points.rx.z).toBeCloseTo(10, 6);
    expect(points.rz.x).toBeCloseTo(-6, 6);
    expect(points.rz.z).toBeCloseTo(0, 6);
    expect(points.rot.z).toBeCloseTo(10 + POND_ROTATE_HANDLE_GAP, 6);
  });

  it('resizes along the axis the handle sits on and rotates to the pointer', () => {
    const pond = { x: 0, z: 0, rx: 10, rz: 6, rot: Math.PI / 2 };
    // The rx handle dragged out along +z, which is the pond's own +x.
    expect(pondWithHandleAt(pond, 'rx', 0, 18).rx).toBeCloseTo(18, 6);
    expect(pondWithHandleAt(pond, 'rx', 0, 18).rz).toBe(6);
    expect(pondWithHandleAt(pond, 'rz', -14, 0).rz).toBeCloseTo(14, 6);
    expect(pondWithHandleAt(pond, 'rot', 0, 5).rot).toBeCloseTo(Math.PI / 2, 6);
    // A radius is never dragged below what the tool will author.
    expect(pondWithHandleAt(pond, 'rx', 0, 0.5).rx).toBe(POND_MIN_RADIUS);
  });

  it('finds the handle under the pointer and nothing else', () => {
    const pond = { x: 5, z: 5, rx: 10, rz: 6 };
    const points = pondHandlePoints(pond);
    expect(hitTestPondHandle(pond, points.rz.x, points.rz.z, 1)).toBe('rz');
    expect(hitTestPondHandle(pond, points.rot.x, points.rot.z, 1)).toBe('rot');
    expect(hitTestPondHandle(pond, pond.x, pond.z, 1)).toBeNull();
  });
});

describe('circuit editor props: the scatter rectangle', () => {
  const rectAround = (
    circuit: RealmRacersCircuit,
    fraction: number,
    offset: number,
    half: number,
  ): DressingRect => {
    const centre = pointAt(circuit, fraction, offset);
    return {
      x0: centre.x - half,
      z0: centre.z - half,
      x1: centre.x + half,
      z1: centre.z + half,
    };
  };

  it('reads the side of the road the box is on', () => {
    expect(scatterFromRect(GARDEN, rectAround(GARDEN, 0.3, 25, 8), 'shrub', 6, 1).zone).toBe(
      'infield',
    );
    expect(scatterFromRect(GARDEN, rectAround(GARDEN, 0.3, -25, 8), 'shrub', 6, 1).zone).toBe(
      'outfield',
    );
  });

  it('covers the lap the box spans and no more', () => {
    const scatter = scatterFromRect(GARDEN, rectAround(GARDEN, 0.3, 25, 10), 'shrub', 6, 1);
    expect(scatter.span).toBeDefined();
    if (!scatter.span) return;
    expect(scatter.span.s0).toBeLessThan(0.3);
    expect(scatter.span.s1).toBeGreaterThan(0.3);
    expect(scatter.span.s1 - scatter.span.s0).toBeLessThan(0.25);
  });

  it('wraps a box drawn over the start line instead of taking the whole lap', () => {
    // The start line sits mid-straight on every circuit this tool draws, so a
    // box over the grid is the ordinary case, not the corner one.
    const scatter = scatterFromRect(GARDEN, rectAround(GARDEN, 0, 25, 12), 'shrub', 6, 1);
    expect(scatter.span).toBeDefined();
    if (!scatter.span) return;
    expect(scatter.span.s0).toBeGreaterThan(0.9);
    expect(scatter.span.s1).toBeLessThan(0.1);
  });

  it('fills only inside the span it was given', () => {
    const scatter = scatterFromRect(GARDEN, rectAround(GARDEN, 0.3, 25, 10), 'shrub', 4, 11);
    const track = realmRacersTrack(GARDEN);
    const placements = realmRacersPlacements({
      ...GARDEN,
      id: 'draft_props_scatter',
      scatters: [scatter],
    });
    expect(placements.scattered.length).toBeGreaterThan(0);
    const span = scatter.span;
    if (!span) return;
    for (const piece of placements.scattered) {
      const projection = track.project(
        piece.x + REALM_RACERS_ORIGIN.x,
        piece.z + REALM_RACERS_ORIGIN.z,
      );
      const fraction = projection.s / track.length;
      const inside =
        span.s0 <= span.s1
          ? fraction >= span.s0 && fraction <= span.s1
          : fraction >= span.s0 || fraction <= span.s1;
      expect(inside).toBe(true);
      expect(projection.lateral).toBeGreaterThan(0);
    }
  });
});

describe('circuit editor props: the palette', () => {
  /** A theme's vocabulary, as the page hands it in. */
  const VOCABULARY = ['bench', 'oak', 'reeds'];

  it('offers every key the sim catalog authors, exactly once', () => {
    const palette = propPalette(REALM_RACERS_PROPS, VOCABULARY);
    const assets = palette.map((entry) => entry.asset);
    expect(new Set(assets).size).toBe(assets.length);
    expect(new Set(assets)).toEqual(new Set(Object.keys(REALM_RACERS_PROPS)));
  });

  it("puts the theme's own vocabulary first, and features only it", () => {
    // The whole point of the list: hand-dressing a circuit is the hunt for the
    // pieces that look like THIS zone inside a catalog that holds every zone's,
    // so the theme's are what the folded palette offers.
    const palette = propPalette(REALM_RACERS_PROPS, VOCABULARY);
    expect(palette.slice(0, VOCABULARY.length).map((entry) => entry.asset)).toEqual(VOCABULARY);
    expect(palette.filter((entry) => entry.featured).map((entry) => entry.asset)).toEqual(
      VOCABULARY,
    );
    // ...and a featured piece keeps the group it belongs to, rather than being
    // filed under 'other' for having arrived by another door.
    expect(palette.find((entry) => entry.asset === 'oak')?.group).toBe('planting');
    // A different theme, a different fold: nothing here is the garden's by
    // default any more.
    const other = propPalette(REALM_RACERS_PROPS, ['amethyst', 'glowFlower']);
    expect(other.filter((entry) => entry.featured).map((entry) => entry.asset)).toEqual([
      'amethyst',
      'glowFlower',
    ]);
  });

  it('drops a vocabulary key the catalog does not author, and never twice-lists one', () => {
    const palette = propPalette(REALM_RACERS_PROPS, ['bench', 'notAThing', 'bench']);
    expect(palette.filter((entry) => entry.asset === 'bench')).toHaveLength(1);
    expect(palette.some((entry) => entry.asset === 'notAThing')).toBe(false);
  });

  it('files a key the tool has never heard of rather than dropping it', () => {
    const palette = propPalette({ ...REALM_RACERS_PROPS, brandNewThing: {} }, VOCABULARY);
    const entry = palette.find((row) => row.asset === 'brandNewThing');
    expect(entry).toBeDefined();
    expect(entry?.group).toBe('other');
  });
});
