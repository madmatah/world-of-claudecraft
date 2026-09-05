// The GLSL producer rule behind the shipped shader corpus's freshness hash
// (scripts/lib/shader_corpus_inputs.mjs): pinned over a scratch tree so the
// rule is what is tested, and over the real tree so the rule keeps reaching
// the known producers (the post chain, the renderer's material sources).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  hashShaderCorpusInputs,
  listShaderProducers,
  listThreePatches,
  normalizeProducerText,
  SHADER_PRODUCER_PATTERN,
  threeVersion,
} from '../scripts/lib/shader_corpus_inputs.mjs';

const repoRoot = join(__dirname, '..');
let scratch: string | null = null;

function scratchRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'shader-corpus-inputs-'));
  mkdirSync(join(root, 'src', 'render', 'deep'), { recursive: true });
  mkdirSync(join(root, 'patches'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { three: '0.185.1' } }));
  writeFileSync(join(root, 'patches', 'three@0.185.1.patch'), 'hunk\n');
  writeFileSync(join(root, 'src', 'render', 'a_shader_core.ts'), 'const s = /* glsl */ `x`;\n');
  writeFileSync(join(root, 'src', 'render', 'plain.ts'), 'export const n = 1;\n');
  writeFileSync(
    join(root, 'src', 'render', 'deep', 'post_thing.ts'),
    "material.onBeforeCompile = (shader) => { shader.fragmentShader = ''; };\n",
  );
  writeFileSync(join(root, 'src', 'render', 'types.d.ts'), 'declare const ShaderMaterial: 1;\n');
  scratch = root;
  return root;
}

afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

describe('listShaderProducers', () => {
  it('keeps the files whose text produces GLSL, recursing, and skips the rest', () => {
    const root = scratchRepo();
    expect(listShaderProducers(root)).toEqual([
      'src/render/a_shader_core.ts',
      'src/render/deep/post_thing.ts',
    ]);
  });

  it('recognizes each producer signature', () => {
    for (const text of [
      'new ShaderMaterial({})',
      'mat.onBeforeCompile = fn',
      '#include <common>',
      '/* glsl */ `void main(){}`',
      'gl_FragColor = vec4(1.0);',
      'pc_fragColor = vec4(1.0);',
    ]) {
      expect(SHADER_PRODUCER_PATTERN.test(text), text).toBe(true);
    }
    expect(SHADER_PRODUCER_PATTERN.test('const glslike = 1; // GLSLX')).toBe(false);
  });

  it('reaches the real producers of this tree', () => {
    const producers = listShaderProducers(repoRoot);
    for (const known of [
      'src/render/post.ts',
      'src/render/post_output_grade.ts',
      'src/render/pbr_fragment_shader.ts',
      'src/render/terrain.ts',
    ]) {
      expect(producers, known).toContain(known);
    }
    // The naming walk is a producer too: it decides the post chain's program
    // NAMES, which are the corpus's keys, so a change there demands a regen.
    expect(producers).toContain('src/render/post_pass_naming_core.ts');
    expect(producers).not.toContain('src/render/context_release.ts');
  });
});

describe('hashShaderCorpusInputs', () => {
  it('is stable, and moves with the three version, a patch, or a producer', () => {
    const root = scratchRepo();
    const base = hashShaderCorpusInputs(root);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(hashShaderCorpusInputs(root)).toBe(base);

    writeFileSync(join(root, 'src', 'render', 'plain.ts'), 'export const n = 2;\n');
    expect(hashShaderCorpusInputs(root)).toBe(base);

    writeFileSync(join(root, 'src', 'render', 'a_shader_core.ts'), 'const s = /* glsl */ `y`;\n');
    const afterProducer = hashShaderCorpusInputs(root);
    expect(afterProducer).not.toBe(base);

    writeFileSync(join(root, 'patches', 'three@0.185.1.patch'), 'hunk2\n');
    const afterPatch = hashShaderCorpusInputs(root);
    expect(afterPatch).not.toBe(afterProducer);

    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { three: '0.186.0' } }),
    );
    expect(hashShaderCorpusInputs(root)).not.toBe(afterPatch);
  });

  it('ignores a formatting or comment change over a producer (no regen for those)', () => {
    const root = scratchRepo();
    const base = hashShaderCorpusInputs(root);
    writeFileSync(
      join(root, 'src', 'render', 'a_shader_core.ts'),
      '// reworded\nconst s =   /* glsl */ `x`;\n\n',
    );
    expect(hashShaderCorpusInputs(root)).toBe(base);
    writeFileSync(join(root, 'src', 'render', 'a_shader_core.ts'), 'const s = /* glsl */ `x`;\r\n');
    expect(hashShaderCorpusInputs(root)).toBe(base);
  });

  it('normalizes comments and whitespace, keeping tokens and string contents', () => {
    expect(normalizeProducerText('a  /* c */ b\n// line\n c')).toBe('a b c');
    expect(normalizeProducerText("const u = 'https://x.y'; // note")).toBe(
      "const u = 'https://x.y';",
    );
    expect(normalizeProducerText('x=1;')).not.toBe(normalizeProducerText('x=2;'));
  });

  it('reads the pinned three version and its patch off the real tree', () => {
    expect(threeVersion(repoRoot)).toBe('0.185.1');
    expect(listThreePatches(repoRoot)).toEqual(['patches/three@0.185.1.patch']);
  });
});
