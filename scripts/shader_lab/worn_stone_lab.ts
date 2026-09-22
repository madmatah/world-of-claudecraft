// Dev-only lab page: the real worn_stone.ts surface-detail layer on three
// flat-palette props (a wall, a boulder, a barrel) with no game around it.
// Open through the Vite dev server:
//   http://localhost:5173/scripts/shader_lab/worn_stone_lab.html?gfx=ultra
// The ?gfx= preset is what gfx.ts reads for GFX.surfaceDetail / taps, so the
// tier selector reloads the page with that query.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GFX, sharedUniforms } from '../../src/render/gfx';
import {
  applySurfaceDetail,
  prepareSurfaceDetailProfileAssets,
  type SurfaceFamily,
} from '../../src/render/worn_stone';

const FAMILIES: SurfaceFamily[] = ['stone', 'rock', 'wood', 'plaster', 'bark', 'fabric', 'metal'];
const PALETTE: Record<SurfaceFamily, number> = {
  stone: 0x7f8287,
  rock: 0x7d7368,
  wood: 0xa8763e,
  plaster: 0xcfc4ae,
  bark: 0x6b4a2e,
  fabric: 0xb0433a,
  metal: 0x6f757c,
};

const q = new URLSearchParams(location.search);
const tierSel = document.getElementById('tier') as HTMLSelectElement;
tierSel.value = q.get('gfx') ?? 'ultra';
tierSel.onchange = () => {
  q.set('gfx', tierSel.value);
  location.search = q.toString();
};
const famSel = document.getElementById('family') as HTMLSelectElement;
for (const f of FAMILIES) famSel.add(new Option(f, f));
famSel.value = (q.get('family') as SurfaceFamily) || 'stone';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87a9c9);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(
  new RoomEnvironment(),
  0.04,
).texture;
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.2, 0);
camera.position.set(0, 2.6, 10);

const sun = new THREE.DirectionalLight(0xfff1dc, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -12;
sun.shadow.camera.right = sun.shadow.camera.top = 12;
scene.add(sun, new THREE.HemisphereLight(0xbcd4ee, 0x5a4a35, 0.45));

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: 0x4f6b3a, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Props: one material each, applied twice (bare twin on the left, detailed on
// the right) so the toggle is an A/B in one frame. Beveled boxes and a low-poly
// sphere mimic the kits' flat facets.
const props = new THREE.Group();
scene.add(props);
interface Pair {
  bare: THREE.MeshStandardMaterial;
  detailed: THREE.MeshStandardMaterial;
}
let pair: Pair | null = null;

function buildProps(family: SurfaceFamily): void {
  props.clear();
  const color = PALETTE[family];
  const bare = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: family === 'metal' ? 0.6 : 0,
  });
  const detailed = bare.clone();
  applySurfaceDetail(detailed, family);
  pair = { bare, detailed };
  const geos: THREE.BufferGeometry[] = [
    new THREE.BoxGeometry(3, 2.4, 0.6),
    new THREE.IcosahedronGeometry(1.1, 1),
    new THREE.CylinderGeometry(0.6, 0.6, 1.4, 12),
  ];
  const y = [1.2, 1.1, 0.7];
  for (const [side, mat] of [
    [-1, bare],
    [1, detailed],
  ] as const) {
    geos.forEach((g, i) => {
      const m = new THREE.Mesh(g, mat);
      m.position.set((i - 1) * 7.4 + side * 1.75, y[i], 0);
      m.castShadow = m.receiveShadow = true;
      m.userData.detailedSide = side > 0;
      props.add(m);
    });
  }
  showInfo();
}

const layerBox = document.getElementById('layer') as HTMLInputElement;
function applyToggle(): void {
  if (!pair) return;
  for (const m of props.children as THREE.Mesh[]) {
    if (m.userData.detailedSide) m.material = layerBox.checked ? pair.detailed : pair.bare;
  }
}
layerBox.onchange = applyToggle;
addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    layerBox.checked = !layerBox.checked;
    applyToggle();
  }
});
famSel.onchange = () => {
  buildProps(famSel.value as SurfaceFamily);
  applyToggle();
};

const distIn = document.getElementById('dist') as HTMLInputElement;
const sunIn = document.getElementById('sun') as HTMLInputElement;
const spinBox = document.getElementById('spin') as HTMLInputElement;
// ?dist= and ?sun= pin the reference captures (the challenge brief lists them).
if (q.get('dist')) distIn.value = q.get('dist') as string;
if (q.get('sun')) sunIn.value = q.get('sun') as string;
if (q.get('layer') === 'off') layerBox.checked = false;
if (q.get('nopanel')) (document.getElementById('panel') as HTMLElement).style.display = 'none';
// ?focus=wall|rock|barrel aims the camera at that pair (the reference set).
const FOCUS_X: Record<string, number> = { wall: -7.4, rock: 0, barrel: 7.4 };
const focus = q.get('focus');
if (focus && focus in FOCUS_X) controls.target.set(FOCUS_X[focus], 1.1, 0);

function showInfo(): void {
  const el = document.getElementById('info') as HTMLElement;
  el.textContent = [
    `tier ${tierSel.value}: surfaceDetail=${GFX.surfaceDetail} taps=${GFX.surfaceDetailTaps} clampK=${GFX.surfaceDetailClampK}`,
    `live shed taps=${sharedUniforms.uWornDetailTaps.value}`,
    `programs=${renderer.info.programs?.length ?? 0}`,
    'left = bare palette, right = with the layer',
  ].join('\n');
}

/** The composed program texts, the same ones the GPU compiled. */
function composedSources(): { vertex: string; fragment: string } {
  const p = renderer.info.programs ?? [];
  const mat = pair?.detailed;
  const prog = p.find((x) => mat && x.cacheKey.includes(mat.customProgramCacheKey()));
  const gl = renderer.getContext();
  if (!prog) return { vertex: '', fragment: '' };
  return {
    vertex: gl.getShaderSource(prog.vertexShader as WebGLShader) ?? '',
    fragment: gl.getShaderSource(prog.fragmentShader as WebGLShader) ?? '',
  };
}
function composedFragment(): string {
  return composedSources().fragment;
}
// scripts/shader_lab/resolve_worn_glsl.mjs reads the resolved texts here.
(window as unknown as { wornLab: unknown }).wornLab = { composedSources };
(document.getElementById('dump') as HTMLButtonElement).onclick = () => {
  const text = composedFragment();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = `worn_${famSel.value}_${tierSel.value}.frag.glsl`;
  a.click();
};
(document.getElementById('shot') as HTMLButtonElement).onclick = () => {
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `worn_${famSel.value}_${tierSel.value}_${layerBox.checked ? 'on' : 'off'}.png`;
  a.click();
};

function resize(): void {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

prepareSurfaceDetailProfileAssets(GFX).then(() => {
  buildProps(famSel.value as SurfaceFamily);
  applyToggle();
});

let lastDist = -1;
renderer.setAnimationLoop((t) => {
  const d = Number(distIn.value);
  (document.getElementById('distv') as HTMLElement).textContent = ` ${d.toFixed(1)}`;
  if (d !== lastDist) {
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0.4, 0.5, 1);
    camera.position.copy(controls.target).add(dir.normalize().multiplyScalar(d));
    lastDist = d;
  }
  const el = (Number(sunIn.value) * Math.PI) / 180;
  (document.getElementById('sunv') as HTMLElement).textContent = ` ${sunIn.value} deg`;
  sun.position.set(Math.cos(el) * 30, Math.sin(el) * 30, 15);
  if (spinBox.checked) props.rotation.y = t * 0.0003;
  controls.update();
  renderer.render(scene, camera);
  if ((t | 0) % 30 === 0) showInfo();
});
