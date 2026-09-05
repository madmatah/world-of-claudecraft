// The salt over the committed corpora: every shipped program salts in both
// stages, two nonces give two different texts per stage, the salt term is
// zero at the uniform's default, and the added varying leaves the WebGL2
// floor. Pinned over the real corpus files so an unsaltable program can
// never ship.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { isProbeCorpus, type ProbeCorpus } from '../src/probe/corpus_core';
import {
  findFragmentOutput,
  findMain,
  nonceLiteral,
  passNonce,
  saltProgram,
  saltPrograms,
  saltUniformName,
} from '../src/probe/salt_core';

const corpusDir = join(__dirname, '..', 'src', 'probe', 'corpus');

function corpora(): ProbeCorpus[] {
  return readdirSync(corpusDir)
    .filter((name) => name.endsWith('.corpus.json.gz'))
    .sort()
    .map((name) => {
      const parsed: unknown = JSON.parse(
        gunzipSync(readFileSync(join(corpusDir, name))).toString(),
      );
      if (!isProbeCorpus(parsed)) throw new Error(`${name} is not a probe corpus`);
      return parsed;
    });
}

const tiny = {
  type: 'ShaderMaterial',
  name: 'x',
  cacheKey: 'k',
  index0Attribute: 'position',
  vertex: '#version 300 es\nin vec3 position;\nvoid main() { gl_Position = vec4(position, 1.0); }',
  fragment:
    '#version 300 es\nprecision highp float;\nlayout(location = 0) out highp vec4 pc_fragColor;\nvoid main() { pc_fragColor = vec4(1.0); }',
};

describe('the salt primitives', () => {
  it('finds main and its closing brace, skipping braces in comments', () => {
    const source = 'void main() { // }\n /* } */ if (true) { } }\nvoid other() {}';
    const span = findMain(source);
    expect(span).not.toBeNull();
    expect(source[span?.end ?? -1]).toBe('}');
    expect(source.slice(span?.end ?? 0)).toBe('}\nvoid other() {}');
    expect(findMain('float f() { return 1.0; }')).toBeNull();
    expect(findMain('void main() { ')).toBeNull();
  });

  it('reads the fragment output name and type', () => {
    expect(findFragmentOutput(tiny.fragment)).toEqual({ name: 'pc_fragColor', type: 'vec4' });
    expect(findFragmentOutput('  out vec4 pc_fragColor;\nvoid main(){}')).toEqual({
      name: 'pc_fragColor',
      type: 'vec4',
    });
    expect(findFragmentOutput('out float depth;\nvoid main(){}')).toEqual({
      name: 'depth',
      type: 'float',
    });
    expect(findFragmentOutput('void main(){ gl_FragColor = vec4(1.0); }')).toBeNull();
  });

  it('turns a nonce into a float literal and a GLSL identifier', () => {
    expect(nonceLiteral('a')).toMatch(/^\d+\.0$/);
    expect(nonceLiteral('a')).not.toBe(nonceLiteral('b'));
    expect(saltUniformName('run-r1-s4-p0')).toBe('wocSalt_run_2d_r1_2d_s4_2d_p0');
    expect(saltUniformName('a b')).not.toBe(saltUniformName('a_b'));
    expect(passNonce('run', 1, 'links', 0)).toBe('run-r1-links-p0');
  });

  it('salts both stages with the nonce literal in a used expression', () => {
    const salted = saltProgram(tiny, 'n1');
    expect(salted).not.toBeNull();
    const literal = nonceLiteral('n1');
    expect(salted?.vertex).toContain(`uniform highp float ${salted?.uniform};`);
    expect(salted?.vertex).toContain('out float vWocSalt;');
    expect(salted?.vertex).toContain(`vWocSalt = ${salted?.uniform} * ${literal};`);
    expect(salted?.fragment).toContain(`uniform highp float ${salted?.uniform};`);
    expect(salted?.fragment).toContain('in float vWocSalt;');
    expect(salted?.fragment).toContain(
      `pc_fragColor += vec4(vWocSalt * ${literal} + ${salted?.uniform});`,
    );
    // The declarations sit before main, the statements inside it, and the
    // rest of the text is untouched.
    expect(salted?.vertex.indexOf('uniform highp float')).toBeLessThan(
      salted?.vertex.indexOf('void main') ?? -1,
    );
    expect(salted?.vertex.endsWith('}')).toBe(true);
    expect(salted?.fragment.startsWith('#version 300 es\n')).toBe(true);
  });

  it('two nonces give two different texts in BOTH stages', () => {
    const a = saltProgram(tiny, 'n1');
    const b = saltProgram(tiny, 'n2');
    expect(a?.vertex).not.toBe(b?.vertex);
    expect(a?.fragment).not.toBe(b?.fragment);
  });

  it('casts the salt term to the output type', () => {
    const floatOut = {
      ...tiny,
      fragment: tiny.fragment.replace('highp vec4 pc_fragColor', 'float depth'),
    };
    expect(saltProgram(floatOut, 'n')?.fragment).toContain('depth += vWocSalt *');
    const vec3Out = {
      ...tiny,
      fragment: tiny.fragment.replace('highp vec4 pc_fragColor', 'vec3 c'),
    };
    expect(saltProgram(vec3Out, 'n')?.fragment).toContain('c += vec3(vWocSalt *');
  });

  it('refuses a stage without main or without an output', () => {
    expect(saltProgram({ ...tiny, vertex: 'float f() { return 1.0; }' }, 'n')).toBeNull();
    expect(saltProgram({ ...tiny, fragment: 'void main() { discard; }' }, 'n')).toBeNull();
    expect(saltPrograms([tiny, { ...tiny, fragment: 'void main() {}' }], 'n')).toHaveLength(1);
  });
});

describe('the salt over the committed corpora', () => {
  it('salts every shipped program in both stages', () => {
    for (const corpus of corpora()) {
      const salted = saltPrograms(corpus.programs, 'pin');
      expect(salted, corpus.tier).toHaveLength(corpus.programs.length);
      const again = saltPrograms(corpus.programs, 'pin2');
      for (let i = 0; i < salted.length; i++) {
        const label = `${corpus.tier} ${corpus.programs[i].type} ${corpus.programs[i].name}`;
        expect(salted[i].vertex, label).not.toBe(again[i].vertex);
        expect(salted[i].fragment, label).not.toBe(again[i].fragment);
        expect(salted[i].vertex, label).toContain('vWocSalt = ');
        expect(salted[i].fragment, label).toContain('+= vec4(vWocSalt *');
      }
    }
  });
});
