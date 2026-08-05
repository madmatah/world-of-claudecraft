// The plan canvas's own numbers: what a blank circuit opens on, how much room a
// fit frames, which named boxes a circuit lives inside and what each one says,
// where the legend naming them sits, how far a click may miss and still land,
// and which of the stylesheet's colours the canvas borrows.
//
// None of it is a rule about a CIRCUIT (those are the sim's readout) and none of
// it is about the shell (that is `layout_core.ts`); it is the arithmetic the page
// was carrying inline, which is the one thing the local CLAUDE.md says the page
// may not do. Pure and DOM-free: the caller hands in a reader and turns what
// comes back into pixels.

import type { RealmRacersCircuit } from '../../sim/content/realm_racers_circuits';
import type { RallyPoint } from '../../sim/realm_racers_layout';
import {
  REALM_RACERS_LAWN_OVERSHOOT,
  REALM_RACERS_MAX_REGION_HALF_X,
  REALM_RACERS_MAX_REGION_HALF_Z,
  REALM_RACERS_RUNOFF_WIDTH,
  REALM_RACERS_VERGE_MARGIN,
} from '../../sim/realm_racers_layout';
import { clampScale } from './layout_core';

// ---- the circuit a blank canvas stands on ----

/** How many control points the starter oval carries, and its two half-extents,
 *  yards. Sized to clear the template's perimeter wall with its road on: a tool
 *  that opens on a circuit its own panel is complaining about teaches the
 *  operator to ignore the panel. */
export const STARTER_OVAL = { points: 12, halfX: 95, halfZ: 55 } as const;

/** An oval a new circuit opens on, so the tool never starts on geometry the
 *  spline cannot read. Local yards, counter-clockwise. */
export function starterControlPoints(): RallyPoint[] {
  return Array.from({ length: STARTER_OVAL.points }, (_, i) => {
    const angle = (i / STARTER_OVAL.points) * Math.PI * 2;
    return {
      x: Math.round(Math.cos(angle) * STARTER_OVAL.halfX),
      z: Math.round(Math.sin(angle) * STARTER_OVAL.halfZ),
    };
  });
}

/**
 * The valid record a BLANK canvas stands on, borrowed from a shipped circuit for
 * the numbers a record cannot be well formed without and stripped of everything
 * that circuit's author PLACED.
 *
 * A blank canvas is a state, not a shape: a circuit with no curve is not
 * something the spline, the readout or the export can represent, so the page
 * keeps this underneath and shows none of it until the first stroke.
 *
 * **Everything placed on the template is cleared, and that is the whole
 * responsibility of this function.** Inheriting any of it is a defect that has
 * now landed twice: first the practice circuit's infield fountain, which arrived
 * on every new circuit and became a metrics error the operator did not author and
 * could not see the source of; then its three PICKUP ROWS, which were added to
 * the record after the fountain was fixed and were simply never added to the
 * list, so drawing a fresh circuit laid twelve boxes nobody placed. The basin
 * goes with the ponds because the record's rule is an IFF, and a basin with
 * nothing to shade is a payload the save endpoint refuses.
 *
 * It lives here rather than in the page for that reason: a rule with a history
 * of being forgotten needs somewhere a test can reach it.
 */
export function blankCircuit(template: RealmRacersCircuit): RealmRacersCircuit {
  return {
    ...template,
    id: 'draft_circuit',
    controlPoints: starterControlPoints(),
    widthBands: [
      { s: 0, halfWidth: 10 },
      { s: 1, halfWidth: 10 },
    ],
    props: undefined,
    scatters: undefined,
    ponds: undefined,
    basin: undefined,
    pickupRows: undefined,
    fences: undefined,
    groundOutline: undefined,
    roles: ['competition'],
    practiceCopies: 0,
  };
}

// ---- framing ----

/** Breathing room a fit leaves around what it frames. Two numbers rather than
 *  one because they frame two different things: a DRAWN circuit is framed with
 *  its dressing margin around it, and a blank canvas frames the ROOM a circuit
 *  has, whose own edge is the thing being shown. */
export const FIT_MARGIN_DRAWN = 1.15;
export const FIT_MARGIN_BLANK = 1.12;

/**
 * The half-extent a fit frames, yards.
 *
 * A blank canvas frames the room a circuit HAS: the placeholder record's own
 * extents would be framing a shape nobody drew.
 */
export function fitHalfExtent(drawn: boolean, roadHalfX: number, roadHalfZ: number): number {
  if (!drawn) {
    return (
      Math.max(REALM_RACERS_MAX_REGION_HALF_X, REALM_RACERS_MAX_REGION_HALF_Z) * FIT_MARGIN_BLANK
    );
  }
  return Math.max(roadHalfX, roadHalfZ, 20) * FIT_MARGIN_DRAWN;
}

/** The scale that frames a half-extent in a plan of this pixel size, clamped the
 *  way every other zoom writer is. */
export function fitScale(planWidth: number, planHeight: number, half: number): number {
  return clampScale(Math.min(planWidth, planHeight) / (2 * half));
}

// ---- the room a circuit has ----

/**
 * Where the CENTERLINE has to stay, and what to call it.
 *
 * The line under the pen carries a road and a garden either side of it, so the
 * box an operator aims at is the volume less the garden edge, not the volume.
 * It is SHAPE's alone: it is the only tool whose gesture puts that line down,
 * and a box about drawing shown while barriers are being placed is a fourth
 * rectangle with nothing to say.
 */
export interface CenterlineLimit {
  halfX: number;
  halfZ: number;
}

export function centerlineLimit(halfWidths: readonly number[]): CenterlineLimit {
  const road = halfWidths.length > 0 ? Math.max(...halfWidths) : 0;
  const gardenEdge = road + REALM_RACERS_VERGE_MARGIN + REALM_RACERS_RUNOFF_WIDTH;
  return {
    halfX: REALM_RACERS_MAX_REGION_HALF_X - gardenEdge,
    halfZ: REALM_RACERS_MAX_REGION_HALF_Z - gardenEdge,
  };
}

// ---- the bearings: which box is which, and what each one is ----

/**
 * The rectangles the plan draws around a circuit, as things with NAMES.
 *
 * They exist because the plan drew five of them and named one. The one an
 * operator was told about ("widest a circuit may be") showed only before the
 * first stroke, and the box that took its place afterwards wore the same colour
 * and the same dashes: two different objects, one drawing, so the mark that was
 * supposed to be the fixed reference read as a rectangle that shrank.
 *
 * Each has its own dash pattern, and every one of them is in the legend:
 * - `volume` is the instance volume, where the ground is flat and the world's
 *   colliders are off. Every circuit carries it at its ceiling, which is what
 *   makes it the FIXED reference the operator asked for: it is the same
 *   rectangle on a blank canvas and on a finished circuit.
 * - `centerline` is where the line under the pen has to stay, SHAPE's alone.
 * - `wall` is the perimeter, the only one that stops a machine.
 * - `ground` is the land, which is the rectangle a circuit gets when nobody
 *   draws one. It is on the plan because it is what the 3D dock stands on, and
 *   an operator looking at that floor had nothing anywhere saying what it was.
 *
 * **A box on the plan that is not in this list is the whole defect coming
 * back.** The aim box was drawn with a sentence floating at its own base
 * instead, and that failed in the seat exactly as the unnamed box before it
 * did: the operator read the sentence, could not tell which rectangle it
 * belonged to, and asked what the middle one was. One naming scheme, in one
 * place, for every box.
 */
export type PlanBearingId = 'volume' | 'centerline' | 'wall' | 'ground';

export interface PlanBearing {
  id: PlanBearingId;
  /** Half-extents, circuit-local yards. Null for a ground shape that is
   *  AUTHORED: it is a curve, drawn as itself, and no rectangle describes it. */
  half: { halfX: number; halfZ: number } | null;
  /** What it is called on screen. */
  label: string;
  /** Its size, or what it is instead of a size. */
  value: string;
  /** Dashes, so a legend swatch and the box it stands for cannot drift. */
  dash: readonly number[];
}

export const PLAN_BEARING_DASH: Readonly<Record<PlanBearingId, readonly number[]>> = {
  volume: [8, 6],
  centerline: [3, 3],
  wall: [],
  ground: [2, 5],
};

const size = (halfX: number, halfZ: number): string =>
  `${Math.round(halfX * 2)} x ${Math.round(halfZ * 2)} yd`;

/**
 * The bearings for this circuit, in the order they nest.
 *
 * A BLANK canvas gets the volume alone, and that is the same rule the rest of
 * the page follows: nothing of the placeholder record is shown until the first
 * stroke, and its wall belongs to whichever circuit the template was borrowed
 * from. The volume is not the placeholder's, though, which is why it survives
 * the rule: it is the ceiling, identical on every circuit that will ever be
 * drawn here.
 */
export function planBearings(
  circuit: RealmRacersCircuit,
  drawn: boolean,
  aiming = false,
): PlanBearing[] {
  const volumeHalf = { halfX: circuit.regionHalfX, halfZ: circuit.regionHalfZ };
  const ceiling =
    circuit.regionHalfX === REALM_RACERS_MAX_REGION_HALF_X &&
    circuit.regionHalfZ === REALM_RACERS_MAX_REGION_HALF_Z;
  const volume: PlanBearing = {
    id: 'volume',
    half: volumeHalf,
    label: 'volume',
    // A record from before the volume became the ceiling is legal and still
    // loads, so the plan says which of the two it is looking at rather than
    // printing a number that would be a guess on one of them.
    value: ceiling
      ? `${size(volumeHalf.halfX, volumeHalf.halfZ)}, the ceiling`
      : `${size(volumeHalf.halfX, volumeHalf.halfZ)} of ${size(REALM_RACERS_MAX_REGION_HALF_X, REALM_RACERS_MAX_REGION_HALF_Z)}`,
    dash: PLAN_BEARING_DASH.volume,
  };
  // The aim box goes in whether or not anything is drawn, and the BLANK arm is
  // the one that matters: it says where to put the first stroke, at the one
  // moment nothing else on the canvas does.
  const aim = centerlineLimit(circuit.widthBands.map((band) => band.halfWidth));
  const centerline: PlanBearing = {
    id: 'centerline',
    half: { halfX: aim.halfX, halfZ: aim.halfZ },
    label: 'centerline',
    // It says what to DO, unlike the other three, because it is the only box
    // that is about the gesture rather than about the circuit: what the pen
    // draws is the middle of a road, and the road and its garden need the rest.
    value: `${size(aim.halfX, aim.halfZ)}, keep your line inside`,
    dash: PLAN_BEARING_DASH.centerline,
  };
  const aimed = aiming ? [volume, centerline] : [volume];
  if (!drawn) return aimed;

  const authoredGround = (circuit.groundOutline?.length ?? 0) > 0;
  return [
    ...aimed,
    {
      id: 'wall',
      half: { halfX: circuit.perimeter.halfX, halfZ: circuit.perimeter.halfZ },
      label: 'wall',
      value: size(circuit.perimeter.halfX, circuit.perimeter.halfZ),
      dash: PLAN_BEARING_DASH.wall,
    },
    {
      id: 'ground',
      half: authoredGround
        ? null
        : {
            halfX: circuit.regionHalfX + REALM_RACERS_LAWN_OVERSHOOT,
            halfZ: circuit.regionHalfZ + REALM_RACERS_LAWN_OVERSHOOT,
          },
      label: 'ground',
      value: authoredGround
        ? 'the shape you drew'
        : size(
            circuit.regionHalfX + REALM_RACERS_LAWN_OVERSHOOT,
            circuit.regionHalfZ + REALM_RACERS_LAWN_OVERSHOOT,
          ),
      dash: PLAN_BEARING_DASH.ground,
    },
  ];
}

// ---- what a gesture may miss by ----

/**
 * Click tolerances, PIXELS, divided by the view scale at the call site so a
 * bench is grabbable at any zoom.
 *
 * Three rather than one because they are three different gestures: grabbing a
 * handle that is drawn as a 4 pixel dot, hitting the CURVE between two of them to
 * insert one, and grabbing a piece of dressing whose own footprint is usually
 * bigger than the tolerance anyway.
 */
export const HIT_TOLERANCE_PIXELS = { handle: 8, segment: 10, dressing: 7 } as const;

/**
 * The bearing legend's own geometry, PIXELS, since it is drawn in screen space
 * rather than in yards: a key that slid around with the view would be a fourth
 * thing to find.
 *
 * `bottomInset` is a real coupling and not a taste: the legend sits bottom left
 * and `#viewChips` is parked in that corner (`bottom: 10px` in the page's own
 * sheet), so this has to clear the chips or the two overlap at every zoom.
 * `tests/editor_circuit_page.test.ts` reads that rule and fails if they meet.
 */
export const PLAN_LEGEND = {
  left: 12,
  bottomInset: 44,
  rowHeight: 15,
  swatch: 22,
  gap: 8,
} as const;

/** Above this plan scale a placed piece is drawn with its catalog key beside it.
 *  Below it the labels are a wash of overlapping text. */
export const PROP_LABEL_MIN_SCALE = 1.6;

/** How much clear room a label needs before the next one, pixels. Roughly a
 *  catalog key's own width at the 11px the canvas draws them at. */
export const PROP_LABEL_MIN_GAP = 70;

/**
 * Which pieces get their key written beside them.
 *
 * A zoom threshold alone stopped being enough the moment one gesture could lay a
 * row: eleven lanterns eight yards apart are eleven labels on top of each other,
 * which is less readable than none at all. Greedy and FIRST-COME, so the answer
 * is stable while the pointer moves: a later piece never displaces a label
 * already granted, and the same set of pieces always gets the same set of labels.
 */
export function labelledPieces(
  points: readonly { x: number; y: number }[],
  minGap = PROP_LABEL_MIN_GAP,
): boolean[] {
  const taken: { x: number; y: number }[] = [];
  return points.map((point) => {
    const crowded = taken.some(
      (other) => Math.abs(other.x - point.x) < minGap && Math.abs(other.y - point.y) < minGap / 4,
    );
    if (crowded) return false;
    taken.push(point);
    return true;
  });
}

/** How much one wheel notch zooms. */
export const WHEEL_ZOOM_STEP = 1.12;

export function wheelZoomScale(scale: number, deltaY: number): number {
  return clampScale(scale * (deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP));
}

// ---- the colours the canvas borrows from the stylesheet ----

/**
 * Which custom property each shared canvas colour comes from.
 *
 * The canvas used to spell these as hex literals, which made eight of the
 * stylesheet's tokens exist twice with nothing keeping the copies in step: a
 * selected piece is `--pick` in CSS and was `#ffd479` in TypeScript, and
 * retinting one left the other saying something different about the same state.
 *
 * Every token the canvas SHARES with the sheet is here, and the page test checks
 * that claim by parsing `:root` rather than trusting it. A colour the canvas
 * alone uses (the road, the grid, the water, the stroke, the seeded pieces) has
 * no stylesheet twin to drift from and stays a local literal at its draw site.
 */
export const PLAN_PALETTE_VARS = {
  pick: '--pick',
  bad: '--bad',
  warn: '--warn',
  ok: '--ok',
  dim: '--dim',
  muted: '--muted',
  bg: '--bg',
  line: '--input-line',
} as const;

export type PlanPaletteId = keyof typeof PLAN_PALETTE_VARS;

/**
 * What the tokens hold today, used when nothing answers for them. A page with no
 * stylesheet applied (a test, a failed load) still has to draw, and
 * `fillStyle = ''` is a silent no-op that leaves whatever colour came before it.
 *
 * These are the ONLY hexes in this tool that exist twice, and
 * `tests/editor_circuit_page.test.ts` reads the sheet's own `:root` block and
 * fails if a pair drifts, which is what makes the duplication safe rather than
 * the thing this module was written to end.
 */
export const PLAN_PALETTE_FALLBACK: Readonly<Record<PlanPaletteId, string>> = {
  pick: '#ffd479',
  bad: '#e08a8a',
  warn: '#e0c48a',
  ok: '#7fd48a',
  dim: '#6f7890',
  muted: '#9aa3b5',
  bg: '#14161c',
  line: '#3a4054',
};

/**
 * The same colour, translucent.
 *
 * The canvas fills a selected piece with a wash of the colour it strokes it
 * with, and those two used to be a hex literal and a hand-written `rgba()` of
 * the same three channels. Derived, so retinting the token moves both.
 */
export function withAlpha(colour: string, alpha: number): string {
  const hex = colour.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!short && !long) return hex;
  const parts = short
    ? [short[1], short[2], short[3]].map((part) => Number.parseInt(part + part, 16))
    : [long?.[1], long?.[2], long?.[3]].map((part) => Number.parseInt(part ?? '0', 16));
  return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
}

/** The palette, read once at boot: `getComputedStyle` per draw would be a layout
 *  read inside the paint path, per colour, per frame. */
export function resolvePlanPalette(
  read: (property: string) => string,
): Readonly<Record<PlanPaletteId, string>> {
  const out = {} as Record<PlanPaletteId, string>;
  for (const [id, property] of Object.entries(PLAN_PALETTE_VARS) as [PlanPaletteId, string][]) {
    out[id] = read(property).trim() || PLAN_PALETTE_FALLBACK[id];
  }
  return Object.freeze(out);
}
