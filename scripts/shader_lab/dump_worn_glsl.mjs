// Dump the worn surface-detail fragment shader text per family and per tier,
// composed exactly as tests/worn_stone_shader.test.ts does (no GPU, no game).
//   node scripts/shader_lab/dump_worn_glsl.mjs [outDir]
// Output: <outDir>/worn_<family>_<tier>.frag.glsl (+ a vertex file per tier),
// default outDir tmp/worn_glsl.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const outDir = path.resolve(process.argv[2] ?? 'tmp/worn_glsl');
mkdirSync(outDir, { recursive: true });
const spec = path.resolve('scripts/shader_lab/_dump_worn_glsl.test.ts');
writeFileSync(
  spec,
  `import * as THREE from 'three';
import { writeFileSync } from 'node:fs';
import { it, vi } from 'vitest';
const FAMILIES = ['stone', 'rock', 'wood', 'plaster', 'bark', 'fabric', 'metal'];
const TIERS = ['high', 'ultra', 'insane'];
for (const tier of TIERS) for (const family of FAMILIES) {
  it(\`\${family} \${tier}\`, async () => {
    const pending: Promise<unknown>[] = [];
    vi.resetModules();
    vi.stubGlobal('location', { search: \`?gfx=\${tier}\` });
    vi.doMock('${path.resolve('src/render/assets/loader')}', () => ({
      loadTexture: () => Promise.resolve(new THREE.Texture()),
      loadKtx2Texture: () => Promise.resolve(new THREE.Texture()),
    }));
    vi.doMock('${path.resolve('src/render/assets/preload')}', () => ({
      registerPreload: (p: Promise<unknown>) => { pending.push(p); },
      registerDeferredPreload: (s: () => Promise<unknown>) => { pending.push(s()); },
    }));
    const { applySurfaceDetail } = await import('${path.resolve('src/render/worn_stone')}');
    await Promise.all(pending);
    const m = new THREE.MeshStandardMaterial();
    applySurfaceDetail(m, family as never);
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
    m.onBeforeCompile(shader as never, null as never);
    writeFileSync('${outDir}/worn_' + family + '_' + tier + '.frag.glsl', shader.fragmentShader);
    writeFileSync('${outDir}/worn_' + family + '_' + tier + '.vert.glsl', shader.vertexShader);
    writeFileSync('${outDir}/worn_' + family + '_' + tier + '.key.txt', m.customProgramCacheKey());
  });
}
`,
);
const r = spawnSync('npx', ['vitest', 'run', spec, '--reporter=dot'], { stdio: 'inherit' });
rmSync(spec, { force: true });
process.exit(r.status ?? 1);
