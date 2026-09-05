// The salt: what makes every link the probe measures a COLD one.
//
// To measure a cold link the driver must see a shader it never compiled; a
// returning player has a warm D3D11 cache and an empty Vulkan one, which would
// hand D3D11 the win. Every cache in play (Chromium's program cache, ANGLE's
// blob cache, the vendors' driver caches, Vulkan pipeline caches) keys on the
// TRANSLATED source or bytecode, PER STAGE; a uniform's runtime value is in no
// key, a name alone may not survive into SPIR-V, and ANGLE's translator prunes
// an unreferenced uniform. So the salt is textual and every stage carries a
// nonce LITERAL in a used expression:
//   vertex:   uniform highp float wocSalt_<nonce>;  out float vWocSalt;
//             ... vWocSalt = wocSalt_<nonce> * <literal>;        (end of main)
//   fragment: uniform highp float wocSalt_<nonce>;  in float vWocSalt;
//             ... <out> += <type>(vWocSalt * <literal> + wocSalt_<nonce>);
// The uniform is never set, so it stays 0.0 and the output is unchanged (the
// checksum scene's CPU reference holds). The nonce is per run, per round, per
// section AND per pass, so no section links what an earlier one linked. The
// salt adds one float varying; that every salted program still LINKS is the
// browser suite's pin (a textual varying count is meaningless under three's
// preprocessor guards), never this file's.
//
// Pure text over three's GLSL 300 es output (every corpus program declares
// `pc_fragColor` as its output, the raw post shaders included);
// tests/probe_salt_core.test.ts pins it over the committed corpus.

import type { ProbeProgram } from './corpus_core';

export interface SaltedProgram {
  cacheKey: string;
  index0Attribute: string;
  vertex: string;
  fragment: string;
  /** The uniform the salt declared, for a test to look for. */
  uniform: string;
}

/** The nonce as a float literal: a 24-bit hash printed as `<n>.0`, exact in
 *  a GLSL float, different for any two nonces that hash apart. */
export function nonceLiteral(nonce: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < nonce.length; i++) {
    hash = Math.imul(hash ^ nonce.charCodeAt(i), 0x01000193) >>> 0;
  }
  return `${(hash & 0xffffff) + 1}.0`;
}

/** The uniform's identifier: the nonce with anything GLSL refuses in a name
 *  folded into its char code, so two nonces never collide by sanitizing. */
export function saltUniformName(nonce: string): string {
  let out = 'wocSalt_';
  for (const char of nonce) {
    out += /[A-Za-z0-9]/.test(char) ? char : `_${char.charCodeAt(0).toString(16)}_`;
  }
  return out;
}

interface MainSpan {
  /** Index of `void main(`. */
  start: number;
  /** Index of the closing brace of main's body. */
  end: number;
}

/** Locate `void main(` and its closing brace, skipping comments (a brace in
 *  a comment must not close the body early). Null when there is no main or
 *  its braces do not balance. */
export function findMain(source: string): MainSpan | null {
  const start = source.search(/\bvoid\s+main\s*\(/);
  if (start < 0) return null;
  let i = source.indexOf('{', start);
  if (i < 0) return null;
  let depth = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      const eol = source.indexOf('\n', i);
      i = eol < 0 ? source.length : eol + 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const close = source.indexOf('*/', i + 2);
      i = close < 0 ? source.length : close + 2;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { start, end: i };
    }
    i++;
  }
  return null;
}

/** The fragment output: its name and GLSL type, from the `out` declaration
 *  (three's `pc_fragColor`, or a raw shader's own). Null when none. */
export function findFragmentOutput(fragment: string): { name: string; type: string } | null {
  const match = fragment.match(
    /^\s*(?:layout\s*\([^)]*\)\s*)?out\s+(?:highp|mediump|lowp\s+)?\s*(float|vec2|vec3|vec4|int|ivec2|ivec3|ivec4|uint|uvec2|uvec3|uvec4)\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/m,
  );
  if (!match) return null;
  return { type: match[1], name: match[2] };
}

function insertBeforeMain(source: string, declarations: string, main: MainSpan): string {
  return `${source.slice(0, main.start)}${declarations}\n${source.slice(main.start)}`;
}

function appendToMain(source: string, statement: string, main: MainSpan): string {
  return `${source.slice(0, main.end)}\n  ${statement}\n${source.slice(main.end)}`;
}

/** Salt one program for `nonce`; null when a stage cannot be salted (no
 *  main, no output), which the freshness pin over the corpus turns into a
 *  failure so an unsaltable program never ships. */
export function saltProgram(program: ProbeProgram, nonce: string): SaltedProgram | null {
  const uniform = saltUniformName(nonce);
  const literal = nonceLiteral(nonce);
  const vertexMain = findMain(program.vertex);
  const fragmentMain = findMain(program.fragment);
  const output = findFragmentOutput(program.fragment);
  if (!vertexMain || !fragmentMain || !output) return null;
  const glsl3 = /^\s*#version\s+300\s+es/.test(program.vertex);
  const outKeyword = glsl3 ? 'out' : 'varying';
  const inKeyword = glsl3 ? 'in' : 'varying';
  // The statement is appended to main AFTER the declarations were inserted
  // before it, so the span is re-found on the declared source.
  const vertexDeclared = insertBeforeMain(
    program.vertex,
    `uniform highp float ${uniform};\n${outKeyword} float vWocSalt;`,
    vertexMain,
  );
  const vertexSpan = findMain(vertexDeclared);
  const fragmentDeclared = insertBeforeMain(
    program.fragment,
    `uniform highp float ${uniform};\n${inKeyword} float vWocSalt;`,
    fragmentMain,
  );
  const fragmentSpan = findMain(fragmentDeclared);
  if (!vertexSpan || !fragmentSpan) return null;
  const cast = output.type === 'float' ? '' : output.type;
  const term = `vWocSalt * ${literal} + ${uniform}`;
  return {
    cacheKey: program.cacheKey,
    index0Attribute: program.index0Attribute,
    uniform,
    vertex: appendToMain(vertexDeclared, `vWocSalt = ${uniform} * ${literal};`, vertexSpan),
    fragment: appendToMain(
      fragmentDeclared,
      `${output.name} += ${cast ? `${cast}(${term})` : term};`,
      fragmentSpan,
    ),
  };
}

/** The whole set for one section and pass, in corpus order; a program that
 *  cannot be salted is left out (the pin over the corpus forbids the case). */
export function saltPrograms(programs: readonly ProbeProgram[], nonce: string): SaltedProgram[] {
  const salted: SaltedProgram[] = [];
  for (const program of programs) {
    const result = saltProgram(program, nonce);
    if (result) salted.push(result);
  }
  return salted;
}

/** The nonce of one pass: run, round, section and pass, joined so no two
 *  passes anywhere in a run share a salted text. */
export function passNonce(run: string, round: number, section: string, pass: number): string {
  return `${run}-r${round}-${section}-p${pass}`;
}
