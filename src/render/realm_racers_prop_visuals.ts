// What a Realm Racers prop LOOKS like: one entry per catalog key, resolving
// either to a model in the world's own prop registry or to a procedural builder
// the Evergarden already uses elsewhere.
//
// It is a lookup, not a registry. Every GLB-backed entry points at
// `PROP_ASSET_DEFS` (`props.ts`), so a circuit wears the vocabulary the zone
// itself is built from, the media manifest keeps covering it, and a piece
// missing from that catalog is registered THERE rather than here. The keys are
// the sim catalog's (`src/sim/content/realm_racers_props.ts`), which is what
// carries footprints and heights; `tests/realm_racers_props.test.ts` fails on a
// key only one of the two knows.
//
// The two shapes matter for DISPOSAL, and they are not interchangeable:
//
//  - `group` mints its geometry per instance, so the track group owns it and
//    `realm_racers_track_dispose_core.ts` frees it;
//  - `instanced` draws a geometry and material out of a shared cache, so it may
//    only ever be drawn through an `InstancedMesh`. Drawing one as a plain Mesh
//    would let a disposed draft take every authored circuit's statues with it.
//
// A model is seated at its own authored origin, not re-based to its lowest
// vertex the way `propAsset` re-bases the world's placed props, so a piece whose
// GLB sinks below y = 0 (the torch does, by about four tenths of a yard) sits
// that much low in the lawn. Several kit pieces are also authored near UNIT
// size rather than at world scale, so a record places them with an explicit
// `scale`; the sim catalog's heights and footprints are the same authored size,
// so both scale together and the readout measures what is drawn.

import type * as THREE from 'three';
import { buildTieredFountain, gardenStatueGeo, gardenStatueMaterial } from './garden_stonework';
import { PROP_ASSET_DEFS } from './props';

export type RallyPropVisual =
  | { kind: 'gltf'; url: string }
  | { kind: 'group'; build(x: number, y: number, z: number, scale: number): THREE.Group }
  | {
      kind: 'instanced';
      geometry(): THREE.BufferGeometry;
      material(): THREE.Material;
    };

const gltf = (key: keyof typeof PROP_ASSET_DEFS): RallyPropVisual => ({
  kind: 'gltf',
  url: PROP_ASSET_DEFS[key].url,
});

export const REALM_RACERS_PROP_VISUALS: Record<string, RallyPropVisual> = {
  // Adapted rather than handed over directly: the stonework builder takes
  // (x, z, y), the garden's own order, and this seam takes (x, y, z) like every
  // other placement in the renderer. Two argument orders that both compile is
  // exactly the kind of mistake nothing but a position test can see.
  fountain: {
    kind: 'group',
    build: (x, y, z, scale) => buildTieredFountain(x, z, y, scale),
  },
  statue: { kind: 'instanced', geometry: gardenStatueGeo, material: gardenStatueMaterial },

  well: gltf('well'),
  column: gltf('column'),
  columnBroken: gltf('columnBroken'),
  statueBlock: gltf('statueBlock'),
  statueHead: gltf('statueHead'),
  gardenArch: gltf('gardenArch'),
  gardenIronFence: gltf('gardenIronFence'),
  gardenIronPillar: gltf('gardenIronPillar'),
  bench: gltf('kcasBench'),
  postLantern: gltf('kcasTorch'),
  banner: gltf('hexFlag'),
  haybale: gltf('hexHaybale'),
  leafyFoxStatue: gltf('leafyFoxStatue'),
  goldenHorseStatue: gltf('goldenHorseStatue'),

  giantMushroom: gltf('mushroomGiantPurple'),
  amethyst: gltf('crystalAmethystCluster'),
  glowCluster: gltf('mushroomGlowCluster'),
  glowFlower: gltf('flowerGlow'),

  oak: gltf('oakTree'),
  shrub: gltf('shrubFlowering'),
  bedRound: gltf('flowerBedRound'),
  bedSquareA: gltf('flowerBedSquareA'),
  bedSquareB: gltf('flowerBedSquareB'),
  reeds: gltf('marshReeds'),
  lilyRaft: gltf('fenLilies'),
};

/** Every model a circuit's dressing can ask for. The track builder preloads
 *  this whole set: an authored prop whose url misses the preload lane draws
 *  nothing at all on a cold client, and fails no test that does not look. */
export const REALM_RACERS_PROP_URLS: readonly string[] = Object.values(REALM_RACERS_PROP_VISUALS)
  .filter((visual): visual is { kind: 'gltf'; url: string } => visual.kind === 'gltf')
  .map((visual) => visual.url);
