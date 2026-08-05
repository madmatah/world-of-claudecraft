// Where a Realm Racers circuit grows grass, and in what colour.
//
// A realm's meadow is mostly its BLADES: the Nightbloom's violet is almost
// entirely the near-field carpet in `blade_grass.ts`, and the card tufts in
// `foliage.ts` are the layer over the top. Neither reaches a circuit on its
// own, because both are gated on the overworld (`placeSlot` rejects anything
// past `WORLD_MAX_X`, and the tufts ride terrain chunks), so a themed circuit
// wore its zone's ground colour and none of its texture.
//
// The circuit answers with a FIXED scatter rather than the world's
// player-centred pool. The pool is what lets a zone be dense, and it was tried
// here first: out in the band it reads as a disc of grass moving with the
// camera, because there is no card-tuft layer beyond it to hide the rim the way
// a zone has. So the placement is baked once and never moves.
//
// Two derived sets, both memoized per circuit:
//   - the MASK, one byte per square yard, saying where a blade may stand. It is
//     a grid rather than a spline query because a scatter this size would
//     otherwise pay tens of thousands of projections;
//   - the TILES, the clusters themselves, grouped so the frustum can throw away
//     what is behind the camera.
//
// How thickly a realm grows blades, and in what colour, are both read through
// the overworld's own tables. That is what makes a circuit look like its zone:
// the Evergarden is MOWN LAWN and grows none at all (`GRASS_BIOME_DENSITY`),
// which is why its two shipped circuits carry no grass and are not meant to.
//
// Pure core: no three, no DOM, deterministic, and a plain Vitest drives it.

import {
  type RealmRacersCircuit,
  realmRacersCircuitById,
} from '../sim/content/realm_racers_circuits';
import { polygonContainsPoint } from '../sim/geometry2d';
import { realmRacersGroundShape, realmRacersGroundSpansAt } from '../sim/realm_racers_ground';
import { REALM_RACERS_ORIGIN } from '../sim/realm_racers_layout';
import { realmRacersPlacedPonds } from '../sim/realm_racers_props_resolve';
import {
  memoizePerCircuit,
  rallyGardenEdgeOffsetAt,
  realmRacersTrack,
} from '../sim/realm_racers_spline';
import { hash2 } from '../sim/rng';
import { biomeGrassTint, GRASS_BIOME_DENSITY } from './foliage_core';
import { realmRacersTheme } from './realm_racers_themes';

/** Yards per mask cell. One yard is finer than a blade cluster is wide, so a
 *  road edge reads as a clean line rather than a staircase. */
const MASK_CELL = 1;
/**
 * Extra yards of bare ground the mask keeps beyond the racing surface.
 *
 * It absorbs the two half-cells the grid costs: the rounding when a stamp
 * claims a cell, and the cluster jitter inside that cell. (The third thing it
 * used to be asked to hide, the fan between two samples' normals on the outside
 * of a corner, is closed properly by the quad stamp below rather than papered
 * over here.) The extra half yard of bare verge reads like the edge a kerb has
 * anyway.
 */
const MASK_MARGIN = 2;

/** The lawn's surface height, matching the track build's own `GRASS_Y`: the
 *  band's floor is flat, so this is a constant rather than a heightfield. */
export const REALM_RACERS_GRASS_Y = -0.12;

/**
 * A circuit's grass mask: one byte per square yard of the perimeter box, 1
 * where a blade may NOT stand.
 *
 * Blocked cells are everything off the authored LAND, the racing surface (road,
 * verge and run-off) and the ponds. The last two are the same reason twice:
 * grass on the tarmac reads as a bug, and a blade in a pond stands on water,
 * since the lawn is cut open under one. The first is that reason at the scale of
 * a circuit: this grid covers the perimeter BOX, and an island is not a box.
 */
export interface RealmRacersGrassMask {
  /** Half-extents of the covered box, circuit-local yards. */
  halfX: number;
  halfZ: number;
  columns: number;
  rows: number;
  blocked: Uint8Array;
}

function buildMask(circuit: RealmRacersCircuit): RealmRacersGrassMask {
  const halfX = circuit.perimeter.halfX;
  const halfZ = circuit.perimeter.halfZ;
  const columns = Math.ceil((halfX * 2) / MASK_CELL) + 1;
  const rows = Math.ceil((halfZ * 2) / MASK_CELL) + 1;
  const blocked = new Uint8Array(columns * rows);
  const mark = (x: number, z: number): void => {
    const col = Math.round((x + halfX) / MASK_CELL);
    const row = Math.round((z + halfZ) / MASK_CELL);
    if (col < 0 || row < 0 || col >= columns || row >= rows) return;
    blocked[row * columns + col] = 1;
  };

  // Everything off the authored LAND is blocked outright, and this comes first
  // because it is the only thing here that bounds the fill rather than punching
  // a hole in it. The box this grid covers is the perimeter's, which is a
  // rectangle; an island is not, so without this pass a circuit that authored a
  // shore grew a rectangle of meadow out over the sea around it. Row by row
  // rather than cell by cell: the spans come from one walk of the outline per
  // row, against a walk per cell.
  //
  // Held back from the shore by about the margin the road keeps, and for the
  // same reason: a cluster is jittered anywhere inside its own cell, so blades
  // on the last cell of the land stand in the surf. Approximately, because the
  // erosion works on CELL CENTRES over a Chebyshev grid rather than on the
  // polygon: a diagonal shore is held back further than a square-on one, and a
  // cell can survive a little nearer the line than the margin says.
  if (realmRacersGroundShape(circuit).authored) {
    const land = new Uint8Array(columns * rows);
    for (let row = 0; row < rows; row++) {
      const spans = realmRacersGroundSpansAt(circuit, row * MASK_CELL - halfZ) ?? [];
      for (let col = 0; col < columns; col++) {
        const x = col * MASK_CELL - halfX;
        land[row * columns + col] = spans.some((span) => x >= span.x0 && x <= span.x1) ? 1 : 0;
      }
    }
    // Then eaten back from the shore by the margin, in BOTH axes: the spans
    // above answer for a line of constant z, so trimming them would only hold a
    // cluster off a shore that runs across the rows, and a beach on the other
    // tack would still be planted. Separable, and clamped at the box edge rather
    // than eroded there, because outside this grid is not water: it is simply
    // ground the mask has never had an opinion about.
    const reach = Math.max(1, Math.round(MASK_MARGIN / MASK_CELL));
    const inland = new Uint8Array(columns * rows);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        let keep = 1;
        for (let d = -reach; d <= reach && keep === 1; d++) {
          const c = Math.min(columns - 1, Math.max(0, col + d));
          keep = land[row * columns + c];
        }
        inland[row * columns + col] = keep;
      }
    }
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        let keep = 1;
        for (let d = -reach; d <= reach && keep === 1; d++) {
          const r = Math.min(rows - 1, Math.max(0, row + d));
          keep = inland[r * columns + col];
        }
        if (keep === 0) blocked[row * columns + col] = 1;
      }
    }
  }

  // The racing surface, stamped by walking the centerline rather than by
  // projecting every cell: one pass over the samples the road is swept from,
  // which is both cheaper and exactly the same curve.
  const track = realmRacersTrack(circuit);
  // Stamped as the QUAD between two neighbouring samples rather than as a line
  // out along one sample's normal. Walking one normal leaves fan-shaped gaps on
  // the OUTSIDE of a corner: the samples are a yard apart but their normals
  // diverge with distance, so at fourteen yards out on a forty-five yard radius
  // they are a third of a yard apart and a cell falls between them. Interpolating
  // between the two normals closes the fan by construction, at any curvature.
  const stride = MASK_CELL / 2;
  const samples = track.samples;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i];
    const b = samples[(i + 1) % samples.length];
    const reach = rallyGardenEdgeOffsetAt(circuit, a.s) + MASK_MARGIN;
    const steps = Math.ceil(reach / stride);
    for (let k = -steps; k <= steps; k++) {
      const across = (k / steps) * reach;
      const ax = a.x - REALM_RACERS_ORIGIN.x - a.tz * across;
      const az = a.z - REALM_RACERS_ORIGIN.z + a.tx * across;
      const bx = b.x - REALM_RACERS_ORIGIN.x - b.tz * across;
      const bz = b.z - REALM_RACERS_ORIGIN.z + b.tx * across;
      const span = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / stride));
      for (let t = 0; t <= span; t++) {
        mark(ax + ((bx - ax) * t) / span, az + ((bz - az) * t) / span);
      }
    }
  }

  // The ponds, by their own outlines: a handful of shapes over a box this size
  // is a bounded scan, and it runs once per circuit.
  for (const pond of realmRacersPlacedPonds(circuit)) {
    const minCol = Math.max(0, Math.floor((pond.x - pond.radius + halfX) / MASK_CELL));
    const maxCol = Math.min(columns - 1, Math.ceil((pond.x + pond.radius + halfX) / MASK_CELL));
    const minRow = Math.max(0, Math.floor((pond.z - pond.radius + halfZ) / MASK_CELL));
    const maxRow = Math.min(rows - 1, Math.ceil((pond.z + pond.radius + halfZ) / MASK_CELL));
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const x = col * MASK_CELL - halfX;
        const z = row * MASK_CELL - halfZ;
        if (!polygonContainsPoint(pond.outline, x, z)) continue;
        // The cell AND its neighbours. A cluster is jittered anywhere inside
        // its own cell, and a waterline can cross the middle of a free one, so
        // marking only the cells whose centre is under water leaves blades
        // standing on the surface along every rim. The road needs no such pass:
        // `MASK_MARGIN` already widens it.
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const r = row + dr;
            const c = col + dc;
            if (r < 0 || c < 0 || r >= rows || c >= columns) continue;
            blocked[r * columns + c] = 1;
          }
        }
      }
    }
  }
  return { halfX, halfZ, columns, rows, blocked };
}

/** Built once per circuit, and rebuilt when a dev draft replaces the record
 *  behind an id (the same identity guard every other derived set uses). */
export const realmRacersGrassMask = memoizePerCircuit(buildMask);

/** Whether a blade may stand at this circuit-local point. Outside the mask's
 *  own box the answer is NO: past the perimeter wall is the lawn's overshoot,
 *  which no racer reaches and which the carpet would only pay for. */
export function realmRacersGrassAllowed(
  circuit: RealmRacersCircuit,
  localX: number,
  localZ: number,
): boolean {
  const mask = realmRacersGrassMask(circuit);
  const col = Math.round((localX + mask.halfX) / MASK_CELL);
  const row = Math.round((localZ + mask.halfZ) / MASK_CELL);
  if (col < 0 || row < 0 || col >= mask.columns || row >= mask.rows) return false;
  return mask.blocked[row * mask.columns + col] === 0;
}

/** Test-only window onto the id resolution the mask memoizes against. */
export const realmRacersGrassInternalsForTest = {
  circuitById: realmRacersCircuitById,
  maskCell: MASK_CELL,
};

/** Yards of tile edge. Each tile becomes its own instanced draw so the frustum
 *  can throw away what is behind the camera: one mesh for a whole circuit would
 *  be submitted in full from every corner of it. */
export const REALM_RACERS_GRASS_TILE_YARDS = 40;
/** Square yards of free lawn per cluster at density 1. The world's own carpet
 *  sits a cluster every 0.46 yards, which is four an area this size; a fixed
 *  scatter cannot afford that over a whole circuit, so the clusters are fewer
 *  and correspondingly larger (`CLUSTER_SCALE`). */
export const REALM_RACERS_GRASS_YARDS_PER_CLUSTER = 1.1;
/** Size band a cluster is drawn at, before the per-cluster jitter. The pool
 *  uses 0.22 to 0.56; a sparser scatter needs a wider blade to close the same
 *  ground. */
const CLUSTER_SCALE = 1.9;

export interface RealmRacersGrassCluster {
  x: number;
  z: number;
  rot: number;
  scale: number;
  /** Radians of whole-cluster lean, and the axis it leans about. */
  lean: number;
  leanAxisX: number;
  leanAxisZ: number;
}

/**
 * How far a tile's own sphere has to reach: its half-diagonal plus the tallest
 * blade that can stand at a corner. The painter builds the sphere from this and
 * the tile centre rather than walking a thousand instance matrices per tile.
 */
export const REALM_RACERS_GRASS_TILE_RADIUS = (REALM_RACERS_GRASS_TILE_YARDS * Math.SQRT2) / 2 + 2;

export interface RealmRacersGrassTile {
  /** Circuit-local centre, and with `REALM_RACERS_GRASS_TILE_RADIUS` the
   *  bounding sphere the painter culls this tile against. */
  x: number;
  z: number;
  clusters: RealmRacersGrassCluster[];
}

/**
 * The circuit's grass, placed once: tiles of clusters over every free cell of
 * the mask.
 *
 * Fixed rather than player-centred, which is the whole difference from the
 * world's carpet. The pool that follows a player is what lets the overworld be
 * dense, and out here it read as a moving disc of grass with a bare rim,
 * because the band has no card-tuft layer beyond it to hide the edge the way a
 * zone does.
 *
 * Deterministic: every point comes out of `hash2` over the mask's own grid, so
 * a circuit looks the same on every client and in every session.
 */
function buildTiles(circuit: RealmRacersCircuit): RealmRacersGrassTile[] {
  const theme = realmRacersTheme(circuit);
  const density = GRASS_BIOME_DENSITY[theme.ground] ?? 1;
  if (density <= 0) return [];
  const mask = realmRacersGrassMask(circuit);
  const perCell = (MASK_CELL * MASK_CELL * density) / REALM_RACERS_GRASS_YARDS_PER_CLUSTER;
  const tiles = new Map<string, RealmRacersGrassTile>();
  for (let row = 0; row < mask.rows; row++) {
    for (let col = 0; col < mask.columns; col++) {
      if (mask.blocked[row * mask.columns + col] === 1) continue;
      const cellX = col * MASK_CELL - mask.halfX;
      const cellZ = row * MASK_CELL - mask.halfZ;
      // A fractional count is spent as a probability, so a density under one
      // per cell thins evenly instead of rounding to nothing.
      const whole = Math.floor(perCell);
      const extra = hash2(col, row, 0x4d21) < perCell - whole ? 1 : 0;
      for (let n = 0; n < whole + extra; n++) {
        const jx = hash2(col * 31 + n, row, 0x7b09);
        const jz = hash2(row * 31 + n, col, 0x1ca7);
        const x = cellX + (jx - 0.5) * MASK_CELL;
        const z = cellZ + (jz - 0.5) * MASK_CELL;
        const key = `${Math.floor(x / REALM_RACERS_GRASS_TILE_YARDS)}:${Math.floor(z / REALM_RACERS_GRASS_TILE_YARDS)}`;
        let tile = tiles.get(key);
        if (!tile) {
          tile = {
            x:
              (Math.floor(x / REALM_RACERS_GRASS_TILE_YARDS) + 0.5) * REALM_RACERS_GRASS_TILE_YARDS,
            z:
              (Math.floor(z / REALM_RACERS_GRASS_TILE_YARDS) + 0.5) * REALM_RACERS_GRASS_TILE_YARDS,
            clusters: [],
          };
          tiles.set(key, tile);
        }
        const rLean = hash2(col, row * 31 + n, 0x2f66);
        tile.clusters.push({
          x,
          z,
          rot: jx * Math.PI * 2,
          // The pool's own size band, widened because this scatter is sparser:
          // fewer clusters have to close the same ground.
          scale: (0.22 + jz * 0.34) * CLUSTER_SCALE,
          // Whole-cluster lean, up to ~12 degrees about a hashed axis, so
          // neighbours tip different ways instead of standing in a uniform crop.
          lean: rLean * 0.21,
          leanAxisX: Math.sin(rLean * 41.3),
          leanAxisZ: Math.cos(rLean * 41.3),
        });
      }
    }
  }
  return [...tiles.values()];
}

export const realmRacersGrassTiles = memoizePerCircuit(buildTiles);

/** The colour every blade on a circuit is drawn in: its zone's own, lifted the
 *  same way the world lifts it (blades catch more sky than the soil). */
export function realmRacersGrassTint(circuit: RealmRacersCircuit): number {
  return biomeGrassTint(realmRacersTheme(circuit).ground);
}
