// The post chain's third-party materials get stable names so the shader corpus
// can key its programs (three names a program after its material). Pinned
// over fakes for the walk's rules, and over the real bloom and N8AO passes
// (both construct in plain Node) so a three or n8ao bump that moves a material
// field fails here rather than silently unnaming part of the corpus.
import { PerspectiveCamera, Scene, Vector2 } from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { describe, expect, it } from 'vitest';
import { namePostPassMaterials } from '../src/render/post_pass_naming_core';

const material = (name = '') => ({ isShaderMaterial: true, name });

describe('namePostPassMaterials', () => {
  it('names a direct material field, an array of materials, and a quad holding one', () => {
    const pass = {
      edges: material(),
      blurs: [material(), material()],
      quad: { material: material(), geometry: {} },
      target: { texture: {} },
    };
    expect(namePostPassMaterials([{ name: 'smaa', pass }])).toEqual({ smaa: 4 });
    expect(pass.edges.name).toBe('smaa.edges');
    expect(pass.blurs.map((m) => m.name)).toEqual(['smaa.blurs[0]', 'smaa.blurs[1]']);
    expect(pass.quad.material.name).toBe('smaa.quad');
  });

  it('never renames a material that already has a name, and is idempotent', () => {
    const pass = { own: material('OutputGradeShader'), fresh: material() };
    expect(namePostPassMaterials([{ name: 'grade', pass }])).toEqual({ grade: 1 });
    expect(pass.own.name).toBe('OutputGradeShader');
    expect(namePostPassMaterials([{ name: 'grade', pass }])).toEqual({ grade: 0 });
    expect(pass.fresh.name).toBe('grade.fresh');
  });

  it('stops two levels down and ignores non-materials and cycles', () => {
    const deep = { a: { b: { c: material() } } };
    const cyclic: Record<string, unknown> = { plain: 1, text: 'x', mat: material() };
    cyclic.self = cyclic;
    expect(namePostPassMaterials([{ name: 'deep', pass: deep }])).toEqual({ deep: 0 });
    expect(namePostPassMaterials([{ name: 'cyc', pass: cyclic }])).toEqual({ cyc: 1 });
  });

  it('names every material of the real bloom pass (a three bump that moves one fails here)', () => {
    const bloom = new UnrealBloomPass(new Vector2(64, 64), 1, 0, 0);
    const counts = namePostPassMaterials([{ name: 'bloom', pass: bloom }]);
    // The high-pass filter, five separable blurs (one per mip), the composite and
    // the blend: the fields UnrealBloomPass owns in three 0.185.
    expect(counts).toEqual({ bloom: 8 });
    expect(bloom.materialHighPassFilter.name).toBe('bloom.materialHighPassFilter');
    expect(bloom.separableBlurMaterials.map((m) => m.name)).toEqual(
      [0, 1, 2, 3, 4].map((i) => `bloom.separableBlurMaterials[${i}]`),
    );
    expect(bloom.compositeMaterial.name).toBe('bloom.compositeMaterial');
    expect(bloom.blendMaterial.name).toBe('bloom.blendMaterial');
  });

  it('names the real N8AO pass materials it can reach (an n8ao bump that moves one fails here)', async () => {
    const { N8AOPass } = await import('n8ao');
    const pass = new N8AOPass(new Scene(), new PerspectiveCamera(), 64, 64);
    const counts = namePostPassMaterials([{ name: 'n8ao', pass }]);
    expect(counts.n8ao).toBe(N8AO_NAMED_MATERIALS);
  });
});

/** The count the walk reaches on n8ao 2.0.0: the two denoise materials and
 *  the two full-screen quads' materials the pass owns as direct fields (the
 *  rest of its 21 ShaderMaterials sit deeper, behind the pass's own render
 *  targets, and are minted lazily). */
const N8AO_NAMED_MATERIALS = 4;
