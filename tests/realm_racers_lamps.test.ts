// The lamps a Realm Racers circuit is dressed with.
//
// The property that actually matters is the FRAME. A circuit's group is built
// once in the band frame and then MOVED onto whichever copy of the circuit the
// viewer stands on, while the night light field takes world positions, so the
// lights have to be re-registered per lane and given back when this copy is not
// the one being drawn. Left unmoved, a circuit's lamps light the ground of a
// lane nobody is on; left registered, they light it forever.

import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The Lambert tier's glow pool paints a canvas texture, which this host has no
// canvas for.
vi.mock('../src/render/textures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/textures')>()),
  radialGlowTexture: () =>
    new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat),
}));

import { programVariantOf } from '../src/render/compile_gate_pieces';
import {
  ensureNightLightField,
  hasNightLightField,
  nightLightStaticCount,
  nightLightUniforms,
  resetNightLightFieldForTest,
  updateNightLightField,
} from '../src/render/night_light_field';
import { materialProgramSignature } from '../src/render/prewarm_policy';
import { buildRealmRacersCommonRoot } from '../src/render/realm_racers_circuit_prepare';
import { realmRacersCommonBuild } from '../src/render/realm_racers_common_pieces';
import {
  buildRealmRacersLamps,
  type RallyLampPlacement,
  realmRacersLampInternalsForTest,
  updateRealmRacersLampGlow,
} from '../src/render/realm_racers_lamps';
import { REALM_RACERS_PROP_VISUALS } from '../src/render/realm_racers_prop_visuals';
import { createRealmRacersTrackPalette } from '../src/render/realm_racers_track_palette';
import {
  LIGHT_SOCKET_NODE,
  STREETLAMP_ASSET_DEFS,
  streetlampAsset,
  streetlampPreloadInternalsForTest,
} from '../src/render/streetlamp_assets';
import { LAMP_SOURCE_MATERIAL } from '../src/render/streetlamp_emissive';
import { LAMP_FIELD_RADIUS } from '../src/render/streetlamp_light_site';
import { REALM_RACERS_CIRCUIT_LIST } from '../src/sim/content/realm_racers_circuits';
import type { StreetlampStyleId } from '../src/sim/streetlamp_style';

afterEach(() => {
  resetNightLightFieldForTest();
  streetlampPreloadInternalsForTest.reset();
  realmRacersLampInternalsForTest.reset();
  vi.unstubAllGlobals();
});

/** A stand-in fixture with the two things the preparer reads: a mesh to scale,
 *  and a socket node saying where its light hangs. */
function installFixture(style: StreetlampStyleId, socketX = 1.2): void {
  const source = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ name: LAMP_SOURCE_MATERIAL }),
  );
  mesh.position.y = 0.5;
  source.add(mesh);
  const socket = new THREE.Object3D();
  socket.name = LIGHT_SOCKET_NODE;
  socket.position.set(socketX, 0.9, 0);
  source.add(socket);
  streetlampPreloadInternalsForTest.installSource(style, source);
}

const lamp = (x: number, z: number, yaw = 0): RallyLampPlacement => ({
  x,
  y: 0,
  z,
  yaw,
  style: 'evergarden_flower',
});

describe('a circuit with no lamps', () => {
  it('builds no view at all', () => {
    expect(buildRealmRacersLamps('rally:empty', [])).toBeNull();
    expect(nightLightStaticCount()).toBe(0);
  });

  it('builds no view when the fixture has not loaded, rather than a stand-in', () => {
    // A circuit is built well after the preload lane these fixtures ride has
    // opened; a substitute post at one corner of a race track would be a
    // different object every lap.
    expect(buildRealmRacersLamps('rally:cold', [lamp(10, 0)])).toBeNull();
  });
});

describe('a circuit dressed with lamps', () => {
  it('draws one instanced body per fixture part and lights nothing until placed', () => {
    installFixture('evergarden_flower');
    const view = buildRealmRacersLamps('rally:garden', [lamp(10, 0), lamp(-10, 0)]);
    expect(view).not.toBeNull();
    const bodies = (view?.group.children ?? []).filter(
      (child) => (child as THREE.InstancedMesh).isInstancedMesh,
    );
    expect(bodies.length).toBe(1);
    expect((bodies[0] as THREE.InstancedMesh).count).toBe(2);
    // The lights are world positions and this group has not been put on a lane
    // yet, so nothing is registered.
    expect(nightLightStaticCount()).toBe(0);
  });

  it('registers a light per lamp at the lane it is moved onto', () => {
    installFixture('evergarden_flower');
    const view = buildRealmRacersLamps('rally:garden', [lamp(10, 0), lamp(-10, 4)]);
    view?.setLaneOffset(0, 300);
    expect(nightLightStaticCount()).toBe(2);
    // ...and moving to another lane REPLACES them rather than stacking a second
    // copy of the circuit's lighting on the band.
    view?.setLaneOffset(0, 600);
    expect(nightLightStaticCount()).toBe(2);
  });

  it('gives the lights back when this copy is not the one being drawn', () => {
    installFixture('evergarden_flower');
    const view = buildRealmRacersLamps('rally:garden', [lamp(10, 0)]);
    view?.setLaneOffset(0, 300);
    expect(nightLightStaticCount()).toBe(1);
    view?.clearLights();
    expect(nightLightStaticCount()).toBe(0);
    // ...and can be lit again on the next lane the viewer stands on.
    view?.setLaneOffset(0, 300);
    expect(nightLightStaticCount()).toBe(1);
  });

  it('keeps two circuits apart, so one lane does not wipe another', () => {
    installFixture('evergarden_flower');
    installFixture('frostveil_icicle');
    const garden = buildRealmRacersLamps('rally:garden', [lamp(10, 0)]);
    const frost = buildRealmRacersLamps('rally:frost', [
      { x: -10, y: 0, z: 0, yaw: 0, style: 'frostveil_icicle' },
    ]);
    garden?.setLaneOffset(0, 300);
    frost?.setLaneOffset(0, 900);
    expect(nightLightStaticCount()).toBe(2);
  });
});

describe('the light a circuit lamp casts', () => {
  it('leaves the LANTERN, carries the fixture colour, and rides the lane offset', () => {
    // The whole reason the fixture's authored socket exists: the light comes
    // from the lantern the fixture reaches out over the track, never from the
    // foot of its post. Read back out of the FIELD's own packed uniforms, which
    // is what the ground shader samples, rather than out of the view.
    ensureNightLightField();
    installFixture('evergarden_flower', 1.2);
    const view = buildRealmRacersLamps('rally:garden', [lamp(10, 0)]);
    const socket = streetlampAsset('evergarden_flower')?.socket;
    expect(socket).toBeDefined();
    const [socketX, socketY] = socket as readonly [number, number, number];
    // The socket is off-axis, or this case would pass with the light at the post.
    expect(Math.abs(socketX)).toBeGreaterThan(0.1);

    const laneX = 50;
    const laneZ = 300;
    view?.setLaneOffset(laneX, laneZ);
    updateNightLightField(10 + laneX, laneZ, 1, 0, 0, [], 0);
    const uniforms = nightLightUniforms();
    const posRadius = (uniforms.uNightLightPosR as { value: Float32Array }).value;
    const colour = (uniforms.uNightLightColor as { value: Float32Array }).value;
    expect((uniforms.uNightLightCount as { value: number }).value).toBe(1);
    // Yaw 0, so the socket's own x offset lands on world x unrotated.
    expect(posRadius[0]).toBeCloseTo(10 + laneX + socketX, 4);
    expect(posRadius[1]).toBeCloseTo(socketY, 4);
    expect(posRadius[2]).toBeCloseTo(laneZ, 4);
    expect(posRadius[3]).toBeCloseTo(LAMP_FIELD_RADIUS * LAMP_FIELD_RADIUS, 3);
    // The colour is the style's own flame, scaled by the glow level the frame
    // is burning at; the ratios are what make it that fixture's amber.
    const fieldColor = STREETLAMP_ASSET_DEFS.evergarden_flower.fieldColor;
    expect(colour[0] / colour[1]).toBeCloseTo(fieldColor[0] / fieldColor[1], 4);
    expect(colour[0] / colour[2]).toBeCloseTo(fieldColor[0] / fieldColor[2], 4);
    expect(colour[0]).toBeGreaterThan(0);
  });

  it('goes dark with the lamps rather than lighting an unlit road', () => {
    ensureNightLightField();
    installFixture('evergarden_flower');
    const view = buildRealmRacersLamps('rally:garden', [lamp(10, 0)]);
    view?.setLaneOffset(0, 0);
    updateNightLightField(10, 0, 0, 0, 0, [], 0);
    const colour = (nightLightUniforms().uNightLightColor as { value: Float32Array }).value;
    expect(colour[0]).toBe(0);
  });
});

describe('the glow every circuit lamp burns at', () => {
  it('lights the authored emitters, and elides a repeated dark write', () => {
    installFixture('evergarden_flower');
    const view = buildRealmRacersLamps('rally:garden', [lamp(10, 0)]);
    expect(realmRacersLampInternalsForTest.glowStateCount()).toBeGreaterThan(0);
    const body = view?.group.children[0] as THREE.InstancedMesh;
    const material = body.material as THREE.MeshStandardMaterial;

    updateRealmRacersLampGlow(0.8, 0);
    const lit = material.emissiveIntensity;
    expect(lit).toBeGreaterThan(0);

    updateRealmRacersLampGlow(0, 0);
    expect(material.emissiveIntensity).toBe(0);

    // The elision: a second dark frame must not write again. Proven by moving
    // the material by hand and watching the elided call leave it alone, which
    // is the only way to tell "wrote 0" from "did not write".
    material.emissiveIntensity = 7;
    updateRealmRacersLampGlow(0, 0);
    expect(material.emissiveIntensity).toBe(7);

    // ...and a lit frame breaks the latch, so the lamps come back on at dusk.
    updateRealmRacersLampGlow(0.8, 0);
    expect(material.emissiveIntensity).toBeCloseTo(lit, 6);
  });
});

/** The lamp styles the shipped circuits place, off their records. */
function shippedLampStyles(): Set<StreetlampStyleId> {
  const styles = new Set<StreetlampStyleId>();
  for (const circuit of REALM_RACERS_CIRCUIT_LIST) {
    for (const asset of [
      ...(circuit.props ?? []).map((prop) => prop.asset),
      ...(circuit.scatters ?? []).map((scatter) => scatter.asset),
    ]) {
      const visual = REALM_RACERS_PROP_VISUALS[asset];
      if (visual?.kind === 'streetlamp') styles.add(visual.style);
    }
  }
  return styles;
}

/** The common client's root from the records, its prop piece run. */
function commonLampRoot(): THREE.Group {
  const build = realmRacersCommonBuild(REALM_RACERS_CIRCUIT_LIST, createRealmRacersTrackPalette());
  const props = build.pieces.find((piece) => piece.kind === 'props');
  if (!props) throw new Error('the common build has no prop piece');
  props.run();
  return buildRealmRacersCommonRoot([build.sampler]);
}

const POOL = 'realmRacersLamps:pool';

function poolsUnder(root: THREE.Object3D): THREE.Mesh[] {
  const pools: THREE.Mesh[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && (mesh.material as THREE.Material).name === POOL) pools.push(mesh);
  });
  return pools;
}

const programOf = (mesh: THREE.Mesh): string =>
  `${materialProgramSignature(mesh.material as THREE.Material)}#${programVariantOf(mesh)}`;

describe('the common preparation of the circuit lamps (rallyCommon)', () => {
  it('links the Lambert tier pool a lamp-lit circuit draws', () => {
    const styles = shippedLampStyles();
    // Non-vacuity: a shipped circuit places lamps, or there is no pool to link.
    expect(styles.size).toBeGreaterThan(0);
    for (const style of styles) installFixture(style);
    // The pool is drawn only on a DOM host and only where the night field does
    // not light the road (the Lambert tier).
    vi.stubGlobal('document', {});
    expect(hasNightLightField()).toBe(false);
    const common = poolsUnder(commonLampRoot());
    expect(common).toHaveLength(1);
    // ...and it is the very program a circuit's own pool draws.
    const [style] = styles;
    const circuit = buildRealmRacersLamps('rally:pool-probe', [
      { x: 10, y: 0, z: 0, yaw: 0, style },
    ]);
    const drawn = poolsUnder(circuit?.group ?? new THREE.Group());
    expect(drawn).toHaveLength(1);
    expect(programOf(common[0])).toBe(programOf(drawn[0]));
  });

  it('links no pool where the night field lights the road, as a circuit draws none', () => {
    for (const style of shippedLampStyles()) installFixture(style);
    vi.stubGlobal('document', {});
    ensureNightLightField();
    expect(hasNightLightField()).toBe(true);
    expect(poolsUnder(commonLampRoot())).toEqual([]);
  });
});
