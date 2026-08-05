// Where a circuit's hand-placed scenery actually STANDS: the one function that
// turns authored `props`, `scatters` and `ponds` into positions, and the only
// one allowed to.
//
// That is the whole point of the module. Every consumer reads its output and
// none re-derives placement: the renderer instances what it returns, the
// collision set appends what it marks solid, and the readout measures the same
// pieces. A renderer working out a position for itself is exactly how the
// tiered fountain came to be drawn in the middle of a road the collision set
// knew nothing about.
//
// Coordinates out are CIRCUIT-LOCAL, the frame `controlPoints` are authored in
// and the frame `realm_racers_colliders.ts` builds in. The renderer adds
// `REALM_RACERS_ORIGIN`; the lane transform in `colliders.ts` adds whichever
// copy of the circuit the viewer stands on.
//
// Pure leaf: no SimContext, no rng, no clock, no DOM, no three. Every scattered
// point and every pond outline comes out of `hash2`, because content resolves
// at import time on three hosts and a shared-stream draw here would fork them.

import type {
  RallyPond,
  RallyProp,
  RallyScatter,
  RealmRacersCircuit,
} from './content/realm_racers_circuits';
import { type RallyPropDef, realmRacersPropDef } from './content/realm_racers_props';
import { realmRacersOnGround } from './realm_racers_ground';
import type { RallyPoint } from './realm_racers_layout';
import { REALM_RACERS_ORIGIN } from './realm_racers_layout';
import {
  memoizePerCircuit,
  rallyGardenEdgeOffsetAt,
  realmRacersTrack,
} from './realm_racers_spline';
import { hash2 } from './rng';

/** A footprint placed on the circuit: yards, circuit-local, absolute yaw. */
export type RallyPlacedFootprint =
  | { kind: 'circle'; r: number }
  | { kind: 'obb'; hw: number; hd: number; rot: number };

export interface RallyPlacedProp {
  /** Catalog key, for the renderer to resolve a visual with. */
  asset: string;
  /** Circuit-local position. */
  x: number;
  z: number;
  yaw: number;
  scale: number;
  /** Whether it stops a machine. */
  solid: boolean;
  /** Visual height at the placed scale, yards. */
  height: number;
  footprint: RallyPlacedFootprint;
}

export interface RallyPlacedPond {
  /** Circuit-local centre. */
  x: number;
  z: number;
  /** The closed outline, one point per step, first point NOT repeated. */
  outline: readonly RallyPoint[];
  /** Greatest distance from the centre to the outline, yards. */
  radius: number;
}

export interface RallyPlacements {
  /** The authored props, in authored order. */
  props: readonly RallyPlacedProp[];
  /** The seeded fills, in scatter order. Never solid; see `resolveScatter`. */
  scattered: readonly RallyPlacedProp[];
  ponds: readonly RallyPlacedPond[];
  /**
   * Catalog keys the record names that nothing authors, deduped, in the order
   * they were met. The resolver SKIPS them rather than throwing, so a
   * half-typed draft still draws; naming them is the readout's job
   * (`unknown_prop_asset`).
   */
  unknownAssets: readonly string[];
}

/** Clear yards a seeded piece leaves between itself and the racing surface, on
 *  top of its own footprint: a scatter that grazes the run-off reads as sown on
 *  the track even when nothing collides. */
export const SCATTER_SURFACE_CLEARANCE = 1.5;
/** Points on a pond outline. Enough that the shore ring the renderer lerps
 *  inward from is smooth at the scale a pond is actually seen from, and few
 *  enough that a big infield of them is not a mesh budget. */
const POND_OUTLINE_STEPS = 64;
/** Default fraction of the radius a pond's outline wanders by. */
const POND_DEFAULT_WOBBLE = 0.15;
/** The wobble's harmonics and their share of it. Integer harmonics on purpose:
 *  the outline has to CLOSE, and a per-point hash would both jag and leave a
 *  seam where it wraps. */
const POND_WOBBLE_HARMONICS: readonly { harmonic: number; weight: number }[] = [
  { harmonic: 2, weight: 0.55 },
  { harmonic: 3, weight: 0.3 },
  { harmonic: 5, weight: 0.15 },
];

/** The radius a footprint occupies whichever shape it is: what the region,
 *  perimeter and racing-surface tests measure against. */
export function rallyFootprintRadius(footprint: RallyPlacedFootprint): number {
  return footprint.kind === 'circle' ? footprint.r : Math.hypot(footprint.hw, footprint.hd);
}

function placedFootprint(prop: RallyProp, def: RallyPropDef, scale: number, yaw: number) {
  const collide = prop.collide;
  if (collide && collide !== 'default' && collide !== 'none') {
    return collide.kind === 'circle'
      ? ({ kind: 'circle', r: collide.r } as const)
      : ({ kind: 'obb', hw: collide.hw, hd: collide.hd, rot: collide.rot } as const);
  }
  return def.footprint.kind === 'circle'
    ? ({ kind: 'circle', r: def.footprint.r * scale } as const)
    : ({
        kind: 'obb',
        hw: def.footprint.hw * scale,
        hd: def.footprint.hd * scale,
        rot: yaw,
      } as const);
}

function resolveProp(
  circuit: RealmRacersCircuit,
  prop: RallyProp,
  def: RallyPropDef,
): RallyPlacedProp {
  const track = realmRacersTrack(circuit);
  let x: number;
  let z: number;
  let tangentYaw = 0;
  if ('s' in prop.at) {
    const fraction = ((prop.at.s % 1) + 1) % 1;
    const point = track.pointAt(fraction * track.length);
    // The sample is WORLD (the spline bakes the origin in); the record and the
    // collision set are both circuit-local, so it comes straight back out.
    x = point.x - REALM_RACERS_ORIGIN.x - point.tz * prop.at.offset;
    z = point.z - REALM_RACERS_ORIGIN.z + point.tx * prop.at.offset;
    tangentYaw = Math.atan2(point.tx, point.tz);
  } else {
    x = prop.at.x;
    z = prop.at.z;
    if (prop.yaw === 'tangent') {
      const projection = track.project(x + REALM_RACERS_ORIGIN.x, z + REALM_RACERS_ORIGIN.z);
      tangentYaw = Math.atan2(projection.tangentX, projection.tangentZ);
    }
  }
  const yaw = prop.yaw === 'tangent' ? tangentYaw : (prop.yaw ?? 0);
  const scale = prop.scale ?? 1;
  return {
    asset: prop.asset,
    x,
    z,
    yaw,
    scale,
    solid:
      prop.collide === 'none'
        ? false
        : prop.collide && prop.collide !== 'default'
          ? true
          : def.solid,
    height: def.height * scale,
    footprint: placedFootprint(prop, def, scale, yaw),
  };
}

/**
 * One seeded fill, as a jittered grid over the perimeter box.
 *
 * A grid rather than sampled points, on the flower beds' own precedent: the
 * density comes out even, the walk is deterministic without carrying state, and
 * the same seed lands the same pieces on every host.
 *
 * Nothing a scatter places is ever SOLID, whatever the catalog says about the
 * kind. A fill is dressing by definition, and a field of hand-placed colliders
 * an author never looked at one by one is the invisible-wall surprise the
 * circuit design outlawed. A solid piece is authored one at a time, seen, and
 * warned about.
 */
function resolveScatter(
  circuit: RealmRacersCircuit,
  scatter: RallyScatter,
  def: RallyPropDef,
): RallyPlacedProp[] {
  const track = realmRacersTrack(circuit);
  const out: RallyPlacedProp[] = [];
  const spacing = Math.max(1, scatter.spacing);
  const side = scatter.zone === 'infield' ? 1 : -1;
  const halfX = circuit.perimeter.halfX;
  const halfZ = circuit.perimeter.halfZ;
  const cols = Math.floor((halfX * 2) / spacing);
  const rows = Math.floor((halfZ * 2) / spacing);
  const unitRadius = rallyFootprintRadius(
    def.footprint.kind === 'circle'
      ? { kind: 'circle', r: def.footprint.r }
      : { kind: 'obb', hw: def.footprint.hw, hd: def.footprint.hd, rot: 0 },
  );
  let hint: number | undefined;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const jitterX = hash2(col, row, scatter.seed);
      const jitterZ = hash2(row, col, scatter.seed + 1);
      const x = -halfX + (col + 0.2 + jitterX * 0.6) * spacing;
      const z = -halfZ + (row + 0.2 + jitterZ * 0.6) * spacing;
      const spin = hash2(col * 131 + row, scatter.seed, 0x51f3);
      // The piece's own size is settled BEFORE it is tested against anything,
      // so a big draw of the jitter is rejected on the footprint it will
      // actually have rather than on an average one.
      const scale = 0.8 + hash2(row * 131 + col, scatter.seed, 0x2b9d) * 0.4;
      const radius = unitRadius * scale + SCATTER_SURFACE_CLEARANCE;
      if (Math.abs(x) + radius > halfX || Math.abs(z) + radius > halfZ) continue;
      const projection = track.project(x + REALM_RACERS_ORIGIN.x, z + REALM_RACERS_ORIGIN.z, hint);
      hint = projection.index;
      if (Math.sign(projection.lateral) !== side) continue;
      if (Math.abs(projection.lateral) - radius < rallyGardenEdgeOffsetAt(circuit, projection.s))
        continue;
      // The piece has to FIT on the land, not merely start on it: the box this
      // grid walks is the perimeter's, and a circuit that authored a shore is not
      // a box. The margin is the same `radius` the two rejects above use, which
      // is the piece's own footprint PLUS the surface clearance: a scatter that
      // grazes the waterline reads as sown in it for the same reason one that
      // grazes the run-off reads as sown on the track.
      //
      // Tested AFTER the projection rather than before it, cheap as it would be
      // to bail earlier: the walk carries a projection HINT from cell to cell, so
      // an early return would change which stretch a later cell projects onto and
      // the clip would MOVE pieces instead of only removing them.
      if (!realmRacersOnGround(circuit, x, z, radius)) continue;
      if (scatter.span) {
        const fraction = projection.s / track.length;
        const { s0, s1 } = scatter.span;
        // Wrapping window: a span whose end is before its start runs across the
        // start line, which is the only way to dress the pit straight.
        const inside =
          s0 <= s1 ? fraction >= s0 && fraction <= s1 : fraction >= s0 || fraction <= s1;
        if (!inside) continue;
      }
      out.push({
        asset: scatter.asset,
        x,
        z,
        yaw: spin * Math.PI * 2,
        scale,
        solid: false,
        height: def.height * scale,
        footprint:
          def.footprint.kind === 'circle'
            ? { kind: 'circle', r: def.footprint.r * scale }
            : {
                kind: 'obb',
                hw: def.footprint.hw * scale,
                hd: def.footprint.hd * scale,
                rot: spin * Math.PI * 2,
              },
      });
    }
  }
  return out;
}

/** A pond's outline: an ellipse whose radius breathes with a few integer
 *  harmonics, so five authored numbers give a shape that reads as natural and
 *  still closes on itself exactly. */
function resolvePond(pond: RallyPond): RallyPlacedPond {
  const seed = pond.seed ?? 0;
  const wobble = Math.min(0.35, Math.max(0, pond.wobble ?? POND_DEFAULT_WOBBLE));
  const rot = pond.rot ?? 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const phases = POND_WOBBLE_HARMONICS.map(
    (term) => hash2(seed, term.harmonic, 0x9d2b) * Math.PI * 2,
  );
  const outline: RallyPoint[] = [];
  let radius = 0;
  for (let k = 0; k < POND_OUTLINE_STEPS; k++) {
    const theta = (k / POND_OUTLINE_STEPS) * Math.PI * 2;
    let wave = 0;
    POND_WOBBLE_HARMONICS.forEach((term, i) => {
      wave += term.weight * Math.sin(term.harmonic * theta + phases[i]);
    });
    const grow = 1 + wobble * wave;
    const ex = Math.cos(theta) * pond.rx * grow;
    const ez = Math.sin(theta) * pond.rz * grow;
    const x = pond.x + ex * cos - ez * sin;
    const z = pond.z + ex * sin + ez * cos;
    outline.push({ x, z });
    radius = Math.max(radius, Math.hypot(x - pond.x, z - pond.z));
  }
  return { x: pond.x, z: pond.z, outline, radius };
}

/**
 * Everything a circuit's dressing resolves to, memoized per circuit id and held
 * only while the RECORD behind that id is the same object: the discipline the
 * spline and the collision set already run on, so a draft redrawn on every drag
 * gets the geometry of the record it actually passed.
 */
export const realmRacersPlacements: (circuit: RealmRacersCircuit) => RallyPlacements =
  memoizePerCircuit((circuit) => {
    const unknown: string[] = [];
    const note = (asset: string): void => {
      if (!unknown.includes(asset)) unknown.push(asset);
    };
    const props: RallyPlacedProp[] = [];
    for (const prop of circuit.props ?? []) {
      const def = realmRacersPropDef(prop.asset);
      if (!def) {
        note(prop.asset);
        continue;
      }
      props.push(resolveProp(circuit, prop, def));
    }
    const scattered: RallyPlacedProp[] = [];
    for (const scatter of circuit.scatters ?? []) {
      const def = realmRacersPropDef(scatter.asset);
      if (!def) {
        note(scatter.asset);
        continue;
      }
      scattered.push(...resolveScatter(circuit, scatter, def));
    }
    return {
      props,
      scattered,
      ponds: (circuit.ponds ?? []).map(resolvePond),
      unknownAssets: unknown,
    };
  });

/** Every placed piece, authored then seeded: what the renderer draws and what
 *  the collision set filters. */
export function realmRacersPlacedProps(circuit: RealmRacersCircuit): readonly RallyPlacedProp[] {
  const placements = realmRacersPlacements(circuit);
  return [...placements.props, ...placements.scattered];
}

/** The placed ponds. */
export function realmRacersPlacedPonds(circuit: RealmRacersCircuit): readonly RallyPlacedPond[] {
  return realmRacersPlacements(circuit).ponds;
}
