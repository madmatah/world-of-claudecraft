// The representatives the race preparation's common client (`mortarOverdriveCommon`,
// mortar_overdrive/circuit_prepare.ts) links at the commitment trigger, before any
// circuit is known or built: one draw of every procedural program the authored
// circuits carry.
//
// It used to proxy the nodes of every BUILT circuit. Circuits are built only
// when a pilot commits to one now (mortar_overdrive/track.ts), so the queue join,
// where the drawn circuit is still unknown, has nothing built to walk. The
// representatives are made from the circuit RECORDS instead (which theme, which
// water, which placed props) and from the pool's palette, whose recipes the
// circuit build draws too (mortar_overdrive/track_palette.ts): the same material
// objects on a minimal geometry of the same program variant (instancing and
// its colour buffer, the geometry attributes). Nothing here resolves a
// placement, samples a spline or bakes a mask: that is a circuit build's work.
//
// Theme dressing models are not here, as before: their materials depend on the
// model (mortar_overdrive/dressing_material.ts) and the circuit client gates them.
// The lamps are their prepared parts only: a representative registers no light.
//
// Drift is pinned where it would show: tests/mortar_overdrive_circuit_prepare.test.ts
// builds every authored circuit, on every tier and both ground arms, and holds
// the programs linked here equal to the procedural programs those circuits draw.

import * as THREE from 'three';
import type { MortarOverdriveCircuit } from '../../sim/content/mortar_overdrive';
import { mortarOverdriveGroundShape } from '../../sim/mortar_overdrive/ground';
import { MORTAR_OVERDRIVE_ORIGIN } from '../../sim/mortar_overdrive/layout';
import type { StreetlampStyleId } from '../../sim/streetlamp_style';
import { biomeGroundTint, paintInstanceGround } from '../instance_surface';
import { layLowTierWaterUv, usesShaderWater } from '../water';
import { mortarOverdriveGrassTint, mortarOverdriveGrowsGrass } from './grass_core';
import { buildMortarOverdriveLampSample } from './lamps';
import { buildMortarOverdrivePickupSample } from './pickups';
import { MORTAR_OVERDRIVE_PROP_VISUALS } from './prop_visuals';
import { buildMortarOverdriveSlicks } from './slicks';
import { mortarOverdriveTheme } from './themes';
import {
  mortarOverdriveBladeGrassOnTier,
  mortarOverdriveFlowerCardGeo,
  mortarOverdriveGrassCluster,
  waterSheet,
} from './track';
import type { MortarOverdriveTrackPalette } from './track_palette';

export type MortarOverdriveCommonPieceKind = 'surfaces' | 'fixtures' | 'water' | 'props' | 'pools';

export interface MortarOverdriveCommonPiece {
  kind: MortarOverdriveCommonPieceKind;
  run(): void;
}

/** The pieces that fill `sampler` with one representative per program. */
export interface MortarOverdriveCommonBuild {
  readonly sampler: THREE.Group;
  readonly pieces: readonly MortarOverdriveCommonPiece[];
}

/** A flat XZ quad: the attribute set of every swept surface a circuit draws
 *  (position, normal, uv, an index). */
function flatQuad(): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(1, 1)
    .rotateX(-Math.PI / 2)
    .translate(MORTAR_OVERDRIVE_ORIGIN.x, 0, MORTAR_OVERDRIVE_ORIGIN.z);
}

/** The prop assets an authored circuit places, by hand or by a scatter. */
function placedAssets(circuit: MortarOverdriveCircuit): string[] {
  return [
    ...(circuit.props ?? []).map((prop) => prop.asset),
    ...(circuit.scatters ?? []).map((scatter) => scatter.asset),
  ];
}

function hasWater(circuit: MortarOverdriveCircuit): boolean {
  const ponds = circuit.basin !== undefined && (circuit.ponds?.length ?? 0) > 0;
  return ponds || mortarOverdriveGroundShape(circuit).authored;
}

export function mortarOverdriveCommonBuild(
  circuits: readonly MortarOverdriveCircuit[],
  palette: MortarOverdriveTrackPalette,
): MortarOverdriveCommonBuild {
  const sampler = new THREE.Group();
  sampler.name = 'mortarOverdriveCommonSampler';
  const first = circuits[0];
  const pieces: MortarOverdriveCommonPiece[] = [];
  if (!first) return { sampler, pieces };
  const theme = mortarOverdriveTheme(first);

  pieces.push({
    kind: 'surfaces',
    run() {
      // Ground (the one material every lawn, runoff and road draws), kerb and
      // start grid: one swept-surface variant each.
      const tint = biomeGroundTint(theme.ground);
      const ground = paintInstanceGround(flatQuad(), MORTAR_OVERDRIVE_ORIGIN, 'grass', tint.grass);
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
        mortarOverdriveFlowerCardGeo(),
        palette.flower(theme.flowers.card),
        1,
      );
      flowers.setColorAt(0, new THREE.Color(0xffffff));
      sampler.add(flowers);
      const grassy = circuits.find(mortarOverdriveGrowsGrass);
      if (grassy && mortarOverdriveBladeGrassOnTier()) {
        const { geometry, material } = mortarOverdriveGrassCluster(
          mortarOverdriveGrassTint(grassy),
        );
        sampler.add(new THREE.InstancedMesh(geometry, material, 1));
      }
    },
  });
  const wet = circuits.find(hasWater);
  if (wet) {
    pieces.push({
      kind: 'water',
      run() {
        const { x, z } = MORTAR_OVERDRIVE_ORIGIN;
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
          palette.water(mortarOverdriveTheme(wet)),
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
          const visual = MORTAR_OVERDRIVE_PROP_VISUALS[asset];
          if (!visual) continue;
          if (visual.kind === 'streetlamp') lampStyles.add(visual.style);
          else if (visual.kind === 'instanced') {
            sampler.add(new THREE.InstancedMesh(visual.geometry(), visual.material(), 1));
          } else if (visual.kind === 'group') {
            sampler.add(visual.build(MORTAR_OVERDRIVE_ORIGIN.x, 0, MORTAR_OVERDRIVE_ORIGIN.z, 1));
          }
        }
      }
      if (lampStyles.size > 0) sampler.add(buildMortarOverdriveLampSample(lampStyles));
    },
  });
  pieces.push({
    kind: 'pools',
    run() {
      // Every circuit's pickup boxes and oil slicks, which take no circuit.
      sampler.add(buildMortarOverdrivePickupSample());
      sampler.add(buildMortarOverdriveSlicks().group);
    },
  });
  return { sampler, pieces };
}
