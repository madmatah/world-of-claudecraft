// The representatives the race preparation's common client (`rallyCommon`,
// realm_racers_circuit_prepare.ts) links at the commitment trigger, before any
// circuit is known or built: one draw of every procedural program the authored
// circuits carry.
//
// It used to proxy the nodes of every BUILT circuit. Circuits are built only
// when a pilot commits to one now (realm_racers_track.ts), so the queue join,
// where the drawn circuit is still unknown, has nothing built to walk. The
// representatives are made from the circuit RECORDS instead (which theme, which
// water, which placed props) and from the pool's palette, whose recipes the
// circuit build draws too (realm_racers_track_palette.ts): the same material
// objects on a minimal geometry of the same program variant (instancing and
// its colour buffer, the geometry attributes). Nothing here resolves a
// placement, samples a spline or bakes a mask: that is a circuit build's work.
//
// Theme dressing models are not here, as before: their materials depend on the
// model (realm_racers_dressing_material.ts) and the circuit client gates them.
// The lamps are their prepared parts only: a representative registers no light.
//
// Drift is pinned where it would show: tests/realm_racers_circuit_prepare.test.ts
// builds every authored circuit, on every tier and both ground arms, and holds
// the programs linked here equal to the procedural programs those circuits draw.

import * as THREE from 'three';
import type { RealmRacersCircuit } from '../sim/content/realm_racers_circuits';
import { realmRacersGroundShape } from '../sim/realm_racers_ground';
import { REALM_RACERS_ORIGIN } from '../sim/realm_racers_layout';
import type { StreetlampStyleId } from '../sim/streetlamp_style';
import { biomeGroundTint, paintInstanceGround } from './instance_surface';
import { realmRacersGrassTint, realmRacersGrowsGrass } from './realm_racers_grass_core';
import { buildRealmRacersLampSample } from './realm_racers_lamps';
import { buildRealmRacersPickupSample } from './realm_racers_pickups';
import { REALM_RACERS_PROP_VISUALS } from './realm_racers_prop_visuals';
import { buildRealmRacersSlicks } from './realm_racers_slicks';
import { realmRacersTheme } from './realm_racers_themes';
import {
  rallyBladeGrassOnTier,
  rallyFlowerCardGeo,
  rallyGrassCluster,
  waterSheet,
} from './realm_racers_track';
import type { RealmRacersTrackPalette } from './realm_racers_track_palette';
import { layLowTierWaterUv, usesShaderWater } from './water';

export type RallyCommonPieceKind = 'surfaces' | 'fixtures' | 'water' | 'props' | 'pools';

export interface RallyCommonPiece {
  kind: RallyCommonPieceKind;
  run(): void;
}

/** The pieces that fill `sampler` with one representative per program. */
export interface RallyCommonBuild {
  readonly sampler: THREE.Group;
  readonly pieces: readonly RallyCommonPiece[];
}

/** A flat XZ quad: the attribute set of every swept surface a circuit draws
 *  (position, normal, uv, an index). */
function flatQuad(): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(1, 1)
    .rotateX(-Math.PI / 2)
    .translate(REALM_RACERS_ORIGIN.x, 0, REALM_RACERS_ORIGIN.z);
}

/** The prop assets an authored circuit places, by hand or by a scatter. */
function placedAssets(circuit: RealmRacersCircuit): string[] {
  return [
    ...(circuit.props ?? []).map((prop) => prop.asset),
    ...(circuit.scatters ?? []).map((scatter) => scatter.asset),
  ];
}

function hasWater(circuit: RealmRacersCircuit): boolean {
  const ponds = circuit.basin !== undefined && (circuit.ponds?.length ?? 0) > 0;
  return ponds || realmRacersGroundShape(circuit).authored;
}

export function realmRacersCommonBuild(
  circuits: readonly RealmRacersCircuit[],
  palette: RealmRacersTrackPalette,
): RallyCommonBuild {
  const sampler = new THREE.Group();
  sampler.name = 'realmRacersCommonSampler';
  const first = circuits[0];
  const pieces: RallyCommonPiece[] = [];
  if (!first) return { sampler, pieces };
  const theme = realmRacersTheme(first);

  pieces.push({
    kind: 'surfaces',
    run() {
      // Ground (the one material every lawn, runoff and road draws), kerb and
      // start grid: one swept-surface variant each.
      const tint = biomeGroundTint(theme.ground);
      const ground = paintInstanceGround(flatQuad(), REALM_RACERS_ORIGIN, 'grass', tint.grass);
      sampler.add(new THREE.Mesh(ground, palette.ground()));
      sampler.add(new THREE.Mesh(flatQuad(), palette.kerb(theme.kerb)));
      sampler.add(new THREE.Mesh(flatQuad(), palette.startGrid(theme.startGrid)));
    },
  });
  pieces.push({
    kind: 'fixtures',
    run() {
      const lights = palette.startLights();
      sampler.add(new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.68, 0.48), lights.housing));
      sampler.add(new THREE.Mesh(new THREE.CircleGeometry(0.24, 16), lights.off));
      // The flower card, instanced with its per-instance colour.
      const flowers = new THREE.InstancedMesh(
        rallyFlowerCardGeo(),
        palette.flower(theme.flowers.card),
        1,
      );
      flowers.setColorAt(0, new THREE.Color(0xffffff));
      sampler.add(flowers);
      const grassy = circuits.find(realmRacersGrowsGrass);
      if (grassy && rallyBladeGrassOnTier()) {
        const { geometry, material } = rallyGrassCluster(realmRacersGrassTint(grassy));
        sampler.add(new THREE.InstancedMesh(geometry, material, 1));
      }
    },
  });
  const wet = circuits.find(hasWater);
  if (wet) {
    pieces.push({
      kind: 'water',
      run() {
        const { x, z } = REALM_RACERS_ORIGIN;
        const sheet = waterSheet(
          {
            positions: new Float64Array([x, z, x + 1, z, x, z + 1]),
            depths: new Float64Array(3),
            index: [0, 2, 1],
            columns: 3,
            rings: 0,
          },
          0,
          1,
          palette.water(realmRacersTheme(wet)),
        );
        if (!usesShaderWater()) layLowTierWaterUv(sheet.geometry, x, z);
        sampler.add(sheet);
      },
    });
  }
  pieces.push({
    kind: 'props',
    run() {
      const seen = new Set<string>();
      const lampStyles = new Set<StreetlampStyleId>();
      for (const circuit of circuits) {
        for (const asset of placedAssets(circuit)) {
          if (seen.has(asset)) continue;
          seen.add(asset);
          const visual = REALM_RACERS_PROP_VISUALS[asset];
          if (!visual) continue;
          if (visual.kind === 'streetlamp') lampStyles.add(visual.style);
          else if (visual.kind === 'instanced') {
            sampler.add(new THREE.InstancedMesh(visual.geometry(), visual.material(), 1));
          } else if (visual.kind === 'group') {
            sampler.add(visual.build(REALM_RACERS_ORIGIN.x, 0, REALM_RACERS_ORIGIN.z, 1));
          }
        }
      }
      if (lampStyles.size > 0) sampler.add(buildRealmRacersLampSample(lampStyles));
    },
  });
  pieces.push({
    kind: 'pools',
    run() {
      // Every circuit's pickup boxes and oil slicks, which take no circuit.
      sampler.add(buildRealmRacersPickupSample());
      sampler.add(buildRealmRacersSlicks().group);
    },
  });
  return { sampler, pieces };
}
