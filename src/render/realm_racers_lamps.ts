// The lamps a circuit is dressed with: the world's own streetlamp fixtures,
// standing on a verge instead of beside a road.
//
// This is the half of a night circuit that makes it RACEABLE. A circuit that
// names a dark hour (`RealmRacersCircuit.timeOfDay`) gets the grade a midnight
// world gets, and the night ambient floor was calibrated on the promise that
// roads carry lamps (`day_night_core.ts`, NIGHT_AMBIENT_FLOOR): out here there
// is no road network, so without these an authored night is exactly the black
// cutout that floor exists to prevent.
//
// It is deliberately thin, because every hard part is already solved:
//
//  - the FIXTURE comes prepared from `streetlamp_assets.ts` (parts at the
//    shipped 5.5 yard scale, an authored light socket, authored emissive
//    materials, the modelled flame), so a lamp on a circuit is the same object
//    the town square is lit by, down to the program its material links;
//  - the LIGHT is a night-light-field site (`night_light_field.ts`) built by the
//    shared `streetlamp_light_site.ts`, so the ground brightens because
//    something above it is burning, with real direction and falloff, rather than
//    because a sprite was laid over the track;
//  - the PLACEMENT is authored, like every other prop: `realm_racers_props.ts`
//    carries one catalog key per fixture style and the circuit record places
//    them by hand. Nothing here derives a row of lamps along the centerline,
//    which is the rule the editor's own dressing doctrine settled (a spacing
//    tuned on one circuit's shape is a bug on the next one's).
//
// TWO FRAMES, and mixing them is the mistake to avoid. The group is built in the
// band frame (world coordinates around `REALM_RACERS_ORIGIN`) and the track view
// MOVES it onto whichever lane the viewer stands on, so the night light field,
// which takes world positions, has to be told the lane offset: `setLaneOffset`
// re-registers the sites, and `clearLights` drops them when this circuit's copy
// is not the one being drawn.

import * as THREE from 'three';
import type { StreetlampStyleId } from '../sim/streetlamp_style';
import { floorVfxRenderOrder } from './floor_vfx_layer';
import { buildDrapedGlowGeometry, type GlowPatchSite } from './ground_glow_patch';
import { hasNightLightField, registerStaticNightLights } from './night_light_field';
import type { NightLightSite } from './night_light_field_core';
import { STREETLAMP_ASSET_DEFS, streetlampAsset } from './streetlamp_assets';
import { type StreetlampEmissiveState, updateStreetlampEmissive } from './streetlamp_emissive';
import {
  LAMP_POOL_OPACITY,
  LAMP_POOL_RADIUS,
  lampFlameBreath,
  streetlampLightSite,
} from './streetlamp_light_site';
import { radialGlowTexture } from './textures';

/** One authored lamp, in the band frame the track group is built in. */
export interface RallyLampPlacement {
  x: number;
  y: number;
  z: number;
  yaw: number;
  style: StreetlampStyleId;
}

export interface RallyLampsView {
  /** Instanced fixtures, for the caller to add to the track group. */
  group: THREE.Group;
  /** Move this circuit's copy onto a lane: re-registers the lights there. */
  setLaneOffset(x: number, z: number): void;
  /** This copy is not being drawn; its lamps light nothing. */
  clearLights(): void;
}

/**
 * Every rally lamp's authored emissive state, driven together.
 *
 * Module-level and shared with `streetlamps.ts` by VALUE rather than by
 * reference: a prepared asset is cached per style, so a style the world also
 * instances hands both views the same state objects, and both write the same
 * glow into them every frame. Writing it twice is free; writing a different
 * number in each would not be, which is why the caller passes the SAME
 * `lampGlowAmount` the world lamps take.
 */
const rallyGlowStates = new Set<StreetlampEmissiveState>();
/**
 * The Lambert tier's draped pools, module-level for the same reason.
 *
 * That tier compiles no standard splat material, so the night light field never
 * runs there and a lamp on it would light nothing. Everywhere else no pool is
 * built at all: where the field runs, the real light is the whole story.
 */
const rallyPoolMaterials = new Set<THREE.MeshBasicMaterial>();
const rallyPoolMeshes: THREE.Mesh[] = [];
let rallyLampsDarkened = false;
let rallyPoolsShown = false;

/**
 * Drive the glow of every lamp standing on a circuit. Called once per frame
 * from the renderer, beside the world's own lamp update and off the same
 * amount, so a pilot crossing into the band never sees the two disagree.
 */
export function updateRealmRacersLampGlow(glow: number, time: number): void {
  const lit = glow > 0.001;
  if (lit !== rallyPoolsShown) {
    rallyPoolsShown = lit;
    for (const pool of rallyPoolMeshes) pool.visible = lit;
  }
  if (!lit) {
    // Write-elided exactly as the world's lamps are: an unlit fixture has
    // nothing to be told, and a daylight circuit would otherwise rewrite the
    // same zero into every authored emitter every frame it draws.
    if (rallyLampsDarkened) return;
    rallyLampsDarkened = true;
    for (const state of rallyGlowStates) updateStreetlampEmissive(state, 0);
    for (const material of rallyPoolMaterials) material.opacity = 0;
    return;
  }
  rallyLampsDarkened = false;
  // The same breath the road's lamps take, off the same shared curve: these are
  // the same prepared fixtures, and two curves would beat against each other.
  const flicker = lampFlameBreath(time);
  for (const state of rallyGlowStates) updateStreetlampEmissive(state, glow * flicker);
  for (const material of rallyPoolMaterials) material.opacity = LAMP_POOL_OPACITY * glow;
}

/** Test seam: the emissive states currently driven, and a way to forget them. */
export const realmRacersLampInternalsForTest = {
  glowStateCount: (): number => rallyGlowStates.size,
  poolCount: (): number => rallyPoolMeshes.length,
  reset: (): void => {
    rallyGlowStates.clear();
    rallyPoolMaterials.clear();
    rallyPoolMeshes.length = 0;
    rallyLampsDarkened = false;
    rallyPoolsShown = false;
  },
};

/**
 * Instance a circuit's lamps and prepare their lights.
 *
 * Returns null when the circuit places none, which is every circuit that races
 * in daylight: a view with nothing in it would still cost the track group a
 * child and the field an owner slot.
 *
 * A style whose model has not resolved yet is SKIPPED rather than substituted.
 * The world's network falls back to a procedural post because a road with no
 * lamps at all is a road nobody can walk at night; a circuit is built once, on
 * entry, well after the deferred preload lane these fixtures ride has opened,
 * and a stand-in lamp on a race track would be a different object at every
 * corner.
 */
export function buildRealmRacersLamps(
  owner: string,
  placements: readonly RallyLampPlacement[],
): RallyLampsView | null {
  if (placements.length === 0) return null;

  const group = new THREE.Group();
  group.name = 'realm-racers-lamps';
  const localSites: NightLightSite[] = [];

  const byStyle = new Map<StreetlampStyleId, RallyLampPlacement[]>();
  for (const lamp of placements) {
    const bucket = byStyle.get(lamp.style);
    if (bucket) bucket.push(lamp);
    else byStyle.set(lamp.style, [lamp]);
  }

  // The pool fallback below wants ONE colour and ONE ground height for the whole
  // circuit: a band is flat, and a circuit wears one zone's fixtures.
  const poolColour = STREETLAMP_ASSET_DEFS[placements[0].style].lightColor;
  const groundY = placements[0].y;

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);

  for (const [style, lamps] of byStyle) {
    const asset = streetlampAsset(style);
    if (!asset) continue;
    for (const state of asset.glowStates) rallyGlowStates.add(state);
    // A style whose emissive is newly driven must not stay latched dark.
    rallyLampsDarkened = false;

    const bodies = asset.parts.map((part) => {
      const body = new THREE.InstancedMesh(part.geometry, part.material, lamps.length);
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);
      return body;
    });

    lamps.forEach((lamp, index) => {
      quaternion.setFromAxisAngle(up, lamp.yaw);
      position.set(lamp.x, lamp.y, lamp.z);
      const instance = matrix.compose(position, quaternion, scale);
      for (const body of bodies) body.setMatrixAt(index, instance);
      localSites.push(
        streetlampLightSite(
          lamp.x,
          lamp.y,
          lamp.z,
          lamp.yaw,
          asset.socket,
          STREETLAMP_ASSET_DEFS[style].fieldColor,
        ),
      );
    });
    for (const body of bodies) {
      body.instanceMatrix.needsUpdate = true;
      body.computeBoundingBox();
      body.computeBoundingSphere();
    }
  }

  if (localSites.length === 0) return null;

  // The Lambert tier's fallback, built ONLY there: a flat radial disc under each
  // lantern, in the same band frame as the fixtures, so it rides the lane move
  // with them. The band is flat, so the "draped" geometry drapes over nothing;
  // what it buys is that the tier which cannot splice the field still shows the
  // road lit under an authored dark hour instead of the darkness alone.
  if (!hasNightLightField() && typeof document !== 'undefined') {
    const patches: GlowPatchSite[] = localSites.map((site) => ({
      x: site.x,
      z: site.z,
      radius: LAMP_POOL_RADIUS,
    }));
    const poolMaterial = new THREE.MeshBasicMaterial({
      map: radialGlowTexture(),
      color: poolColour,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pools = new THREE.Mesh(
      buildDrapedGlowGeometry(patches, () => groundY),
      poolMaterial,
    );
    pools.geometry.computeBoundingSphere();
    pools.renderOrder = floorVfxRenderOrder('ground', 0);
    pools.visible = false;
    rallyPoolMaterials.add(poolMaterial);
    rallyPoolMeshes.push(pools);
    group.add(pools);
  }

  let registeredX = Number.NaN;
  let registeredZ = Number.NaN;
  return {
    group,
    setLaneOffset(x, z) {
      if (x === registeredX && z === registeredZ) return;
      registeredX = x;
      registeredZ = z;
      registerStaticNightLights(
        owner,
        localSites.map((site) => ({ ...site, x: site.x + x, z: site.z + z })),
      );
    },
    clearLights() {
      if (Number.isNaN(registeredX)) return;
      registeredX = Number.NaN;
      registeredZ = Number.NaN;
      registerStaticNightLights(owner, []);
    },
  };
}
