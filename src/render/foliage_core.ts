import { isEastbrookGrandArmoury } from '../sim/building_layout';
import { EASTBROOK_LAYOUT } from '../sim/eastbrook_layout';
import { FENBRIDGE_LAYOUT } from '../sim/fenbridge_layout';
import type { BiomeId, BuildingDef, NoticeboardDef } from '../sim/types';

export type EastbrookGrassExclusion =
  | {
      kind: 'obb';
      id: string;
      x: number;
      z: number;
      halfWidth: number;
      halfDepth: number;
      rotation: number;
    }
  | { kind: 'circle'; id: string; x: number; z: number; radius: number };

/** True when a grass candidate falls inside a hub owned by the active world. */
export function insideGrassHubExclusion(
  zones: readonly { hub: { x: number; z: number } }[],
  x: number,
  z: number,
  radius = 15,
): boolean {
  const radiusSq = radius * radius;
  for (const zone of zones) {
    const dx = x - zone.hub.x;
    const dz = z - zone.hub.z;
    if (dx * dx + dz * dz < radiusSq) return true;
  }
  return false;
}

/** Hub and camp clearings for bushes/ferns, sourced from the active world only. */
export function insideDressingExclusion(
  zones: readonly { hub: { x: number; z: number; radius: number } }[],
  camps: readonly { center: { x: number; z: number }; radius: number }[],
  x: number,
  z: number,
): boolean {
  for (const zone of zones) {
    if (Math.hypot(x - zone.hub.x, z - zone.hub.z) < zone.hub.radius + 4) return true;
  }
  for (const camp of camps) {
    if (Math.hypot(x - camp.center.x, z - camp.center.z) < camp.radius + 2) return true;
  }
  return false;
}

function layoutObb(
  id: string,
  footprint: {
    center: { x: number; z: number };
    halfWidth: number;
    halfDepth: number;
    rotation: number;
  },
): EastbrookGrassExclusion {
  return {
    kind: 'obb',
    id,
    x: footprint.center.x,
    z: footprint.center.z,
    halfWidth: footprint.halfWidth,
    halfDepth: footprint.halfDepth,
    rotation: footprint.rotation,
  };
}

function buildingObb(building: BuildingDef): EastbrookGrassExclusion {
  return {
    kind: 'obb',
    id: building.id ?? building.landmark ?? `${building.x}:${building.z}`,
    x: building.x,
    z: building.z,
    halfWidth: building.w / 2,
    halfDepth: building.d / 2,
    rotation: building.rot,
  };
}

/**
 * Snapshot the geometry that must remain grass-free. Built-in towns use their
 * canonical layouts (including walls, civic furniture, repeated boardwalks,
 * and service aprons), while custom worlds only honor landmarks explicitly
 * present in their own prop table and never inherit fixed world coordinates.
 */
export function eastbrookGrassExclusions(
  buildings: readonly BuildingDef[],
  builtInWorld: boolean,
  noticeboards: readonly NoticeboardDef[] = [],
): EastbrookGrassExclusion[] {
  const exclusions: EastbrookGrassExclusion[] = builtInWorld
    ? []
    : buildings.filter(isEastbrookGrandArmoury).map(buildingObb);

  if (builtInWorld) {
    for (const building of [
      ...EASTBROOK_LAYOUT.preservedBuildings,
      ...EASTBROOK_LAYOUT.buildings,
    ]) {
      exclusions.push(layoutObb(building.id, building.footprint));
      exclusions.push({
        kind: 'circle',
        id: `${building.id}:serviceApron`,
        x: building.frontStandingPoint.x,
        z: building.frontStandingPoint.z,
        radius: 1.5,
      });
    }
    const well = EASTBROOK_LAYOUT.civic.wellBeacon;
    exclusions.push({
      kind: 'circle',
      id: well.id,
      x: well.position.x,
      z: well.position.z,
      radius: well.radius,
    });
    for (const bench of EASTBROOK_LAYOUT.civic.benches) {
      exclusions.push(layoutObb(bench.id, bench.footprint));
    }
    for (const stall of EASTBROOK_LAYOUT.market.stalls) {
      exclusions.push(layoutObb(stall.id, stall.footprint));
    }
    for (const fence of EASTBROOK_LAYOUT.fences) {
      exclusions.push(layoutObb(fence.id, fence.footprint));
    }
    for (const wall of EASTBROOK_LAYOUT.wall.segments) {
      exclusions.push(layoutObb(wall.id, wall.footprint));
    }

    for (const building of FENBRIDGE_LAYOUT.buildings) {
      exclusions.push(layoutObb(building.id, building.footprint));
      exclusions.push({
        kind: 'circle',
        id: `${building.id}:serviceApron`,
        x: building.frontStandingPoint.x,
        z: building.frontStandingPoint.z,
        radius: 1.5,
      });
    }
    const cistern = FENBRIDGE_LAYOUT.civic.cistern;
    exclusions.push({
      kind: 'circle',
      id: cistern.id,
      x: cistern.position.x,
      z: cistern.position.z,
      radius: cistern.radius,
    });
    exclusions.push(
      layoutObb(
        FENBRIDGE_LAYOUT.civic.provisionStall.id,
        FENBRIDGE_LAYOUT.civic.provisionStall.footprint,
      ),
    );
    for (const [id, point] of [
      [
        `${FENBRIDGE_LAYOUT.civic.provisionStall.id}:customerApron`,
        FENBRIDGE_LAYOUT.civic.provisionStall.customerStandingPoint,
      ],
      [
        `${FENBRIDGE_LAYOUT.civic.provisionStall.id}:vendorApron`,
        FENBRIDGE_LAYOUT.civic.provisionStall.vendorStandingPoint,
      ],
      [
        `${FENBRIDGE_LAYOUT.services.bank.teller.id}:serviceApron`,
        FENBRIDGE_LAYOUT.services.bank.teller.standingPoint,
      ],
      [
        'fenbridge_lantern_chapel_archive:serviceApron',
        FENBRIDGE_LAYOUT.services.npcs.find((npc) => npc.id === 'chronicler_osric_fenn')?.position,
      ],
      [
        `${FENBRIDGE_LAYOUT.services.stations[0].id}:serviceApron`,
        FENBRIDGE_LAYOUT.services.stations[0].position,
      ],
      [
        `${FENBRIDGE_LAYOUT.services.mailbox.id}:serviceApron`,
        FENBRIDGE_LAYOUT.services.mailbox.frontStandingPoint,
      ],
    ] as const) {
      if (!point) continue;
      exclusions.push({ kind: 'circle', id, x: point.x, z: point.z, radius: 1.2 });
    }
    exclusions.push(
      layoutObb(
        FENBRIDGE_LAYOUT.civic.musterBoard.id,
        FENBRIDGE_LAYOUT.civic.musterBoard.footprint,
      ),
    );
    exclusions.push({
      kind: 'circle',
      id: `${FENBRIDGE_LAYOUT.civic.musterBoard.id}:serviceApron`,
      x: FENBRIDGE_LAYOUT.civic.musterBoard.frontStandingPoint.x,
      z: FENBRIDGE_LAYOUT.civic.musterBoard.frontStandingPoint.z,
      radius: 1.2,
    });
    for (const wall of FENBRIDGE_LAYOUT.wall.segments) {
      exclusions.push(layoutObb(wall.id, wall.footprint));
    }
    for (const gate of FENBRIDGE_LAYOUT.wall.gates) {
      for (const jamb of gate.arch.jambs) exclusions.push(layoutObb(jamb.id, jamb));
    }
    for (const boardwalk of FENBRIDGE_LAYOUT.repeated.boardwalks) {
      exclusions.push({
        kind: 'obb',
        id: boardwalk.id,
        x: boardwalk.position.x,
        z: boardwalk.position.z,
        halfWidth: boardwalk.nativeDimensions.width / 2,
        halfDepth: boardwalk.nativeDimensions.depth / 2,
        rotation: boardwalk.rotation,
      });
    }
    for (const order of FENBRIDGE_LAYOUT.repeated.musterOrders) {
      exclusions.push({
        kind: 'circle',
        id: order.id,
        x: order.position.x,
        z: order.position.z,
        radius: 0.7,
      });
    }
  }

  for (const board of noticeboards) {
    exclusions.push({
      kind: 'obb',
      id: board.id,
      x: board.x,
      z: board.z,
      halfWidth: board.width / 2,
      halfDepth: board.depth / 2,
      rotation: board.rotation,
    });
    exclusions.push({
      kind: 'circle',
      id: `${board.id}:serviceApron`,
      x: board.frontStandingPoint.x,
      z: board.frontStandingPoint.z,
      radius: 1.2,
    });
  }
  return exclusions;
}

/** Pure candidate check used by streamed chunks after the one-time snapshot. */
export function insideEastbrookGrassExclusion(
  exclusions: readonly EastbrookGrassExclusion[],
  x: number,
  z: number,
  padding: number,
): boolean {
  for (let index = 0; index < exclusions.length; index++) {
    const exclusion = exclusions[index];
    if (exclusion.kind === 'circle') {
      const dx = x - exclusion.x;
      const dz = z - exclusion.z;
      const radius = exclusion.radius + padding;
      if (dx * dx + dz * dz < radius * radius) return true;
      continue;
    }
    const dx = x - exclusion.x;
    const dz = z - exclusion.z;
    const cosine = Math.cos(exclusion.rotation);
    const sine = Math.sin(exclusion.rotation);
    const localX = dx * cosine - dz * sine;
    const localZ = dx * sine + dz * cosine;
    if (
      Math.abs(localX) < exclusion.halfWidth + padding &&
      Math.abs(localZ) < exclusion.halfDepth + padding
    ) {
      return true;
    }
  }
  return false;
}

// --- the realm grass palette -------------------------------------------------
//
// Which colour a realm's grass is and how thickly it grows. They live in the
// CORE rather than in `foliage.ts` because three consumers need them and only
// one of the three may load three.js: the card-tuft field and the near-field
// blade carpet are both renderers, but `realm_racers_grass_core.ts` is a
// registered pure core, and reaching these through `foliage.ts` would drag
// three and its module-level preload registrations in behind them.

export const GRASS_TINT: Record<BiomeId, number> = {
  vale: 0xdde4c0,
  marsh: 0xbfc492,
  peaks: 0xc2cec8,
  beach: 0xe8e2b0,
  desert: 0xdcc890,
  volcano: 0x8a7a68,
  cave: 0xa2a89c,
  dusk: 0xccc3da,
  ember: 0xd8c890,
  frost: 0xdde8f2,
  amber: 0xe8cf8a,
  fen: 0xcfe4b0,
  night: 0xe598ff, // orchid dream grass (green blade albedo mutes it)
  haunt: 0x99a382, // sickly pale grass
  jungle: 0xc4ec96, // bright wet tropical grass
  garden: 0xd0eeb0, // mown lawn
  gale: 0xb8d09a, // wind-silvered grass
};

// Exported: the near-field blade carpet (blade_grass.ts) follows the same
// per-biome bare/lush rules as the card tufts.
export const GRASS_BIOME_DENSITY: Partial<Record<BiomeId, number>> = {
  frost: 0,
  ember: 0, // the Drakelands are scorched waste: no blades in the cinders
  haunt: 1.55,
  // the Evergarden is mown lawn: no wild tufts, its flowers grow in the
  // authored parterre beds instead (garden_parterre_core.ts)
  garden: 0,
};

/**
 * A realm's own grass tint, for a scatter OUTSIDE the terrain chunks that has
 * to read as that realm's ground cover: the Realm Racers circuits, which sit in
 * an instance band no chunk ever reaches and would otherwise be the one place
 * in a zone's colour where its grass is missing.
 *
 * Read through rather than copied, so a retinted realm carries its circuit with
 * it. The band's own answer for "which realm am I in" is meaningless out there,
 * so the caller passes the biome its CONTENT names (a circuit theme's `ground`).
 */
export function biomeGrassTint(biome: BiomeId): number {
  return GRASS_TINT[biome];
}
