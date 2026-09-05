// Section 9, the runner: the game-shaped frame on the probe's context.
//
//   shadow pass   a depth-only target, `shadowDraws` small triangles with a
//                 corpus depth twin (or the first heavy program when the tier
//                 ships no twin)
//   colour pass   a half-float target, `colourDraws` small triangles cycling
//                 the corpus's heavy programs, then `skeletons` characters of
//                 `drawsPerSkeleton` draws each, one 64x64 float bone-texture
//                 update per skeleton per frame (three uploads one bone
//                 texture per skeleton, not per draw)
//   post chain    `postPasses` full-screen passes ping-ponging two half-float
//                 targets through a sampler, then the pattern pass to the
//                 default framebuffer
//
// Every corpus program draws with its samplers on their own units (a texture
// of each kind) and its other attributes constant: what is paid is the
// submission and the fill, the two costs that differ between backends. The
// checksum reads the pattern pass (a gradient with a CPU reference) and a
// magnified 4x4 texture through a sampler; both with a tolerance.

import type { ProbeProgram } from './corpus_core';
import { runFrameLoop } from './frame_runner';
import {
  type ChecksumSample,
  checksumVerdict,
  type FramePassSummary,
  type FrameShape,
  GAME_FRAME_SHAPE,
  patternReference,
  summarizeFramePass,
} from './frame_section_core';
import { createSamplerRig, type SamplerRig } from './sampler_rig';

export interface FramePassOptions {
  gl: WebGL2RenderingContext;
  refreshMs: number;
  /** The programs to draw with, already LINKED on this context. */
  colourPrograms: readonly WebGLProgram[];
  shadowProgram: WebGLProgram | null;
  shape?: FrameShape;
  frames?: number;
  width: number;
  height: number;
  now?: () => number;
}

export interface FramePassResult {
  summary: FramePassSummary;
  intervalsMs: number[];
  submitMs: number[];
}

const PATTERN_VERTEX = `#version 300 es
in vec2 position;
out vec2 vUv;
void main() { vUv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }`;

const PATTERN_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
void main() { o = vec4(vUv, 0.5, 1.0); }`;

const SAMPLE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D tex;
out vec4 o;
void main() { o = texture(tex, vUv); }`;

function link(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram | null {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.shaderSource(vs, vertex);
  gl.compileShader(vs);
  gl.shaderSource(fs, fragment);
  gl.compileShader(fs);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, 'position');
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return gl.getProgramParameter(program, gl.LINK_STATUS) === true ? program : null;
}

/** Link a corpus program on the context for the frame to draw with. */
export function linkCorpusProgram(
  gl: WebGL2RenderingContext,
  program: ProbeProgram,
): WebGLProgram | null {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  const handle = gl.createProgram();
  if (!vs || !fs || !handle) return null;
  gl.shaderSource(vs, program.vertex);
  gl.compileShader(vs);
  gl.shaderSource(fs, program.fragment);
  gl.compileShader(fs);
  gl.attachShader(handle, vs);
  gl.attachShader(handle, fs);
  if (program.index0Attribute) gl.bindAttribLocation(handle, 0, program.index0Attribute);
  gl.linkProgram(handle);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return gl.getProgramParameter(handle, gl.LINK_STATUS) === true ? handle : null;
}

interface Target {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
}

function colourTarget(gl: WebGL2RenderingContext, width: number, height: number): Target {
  const texture = gl.createTexture() as WebGLTexture;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, width, height);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const framebuffer = gl.createFramebuffer() as WebGLFramebuffer;
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { framebuffer, texture };
}

function depthTarget(gl: WebGL2RenderingContext, size: number): Target {
  const texture = gl.createTexture() as WebGLTexture;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const framebuffer = gl.createFramebuffer() as WebGLFramebuffer;
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, texture, 0);
  gl.drawBuffers([gl.NONE]);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { framebuffer, texture };
}

/** `count` small triangles scattered over the screen, one draw each. */
function scatteredTriangles(gl: WebGL2RenderingContext, count: number): WebGLBuffer {
  const data = new Float32Array(count * 9);
  for (let i = 0; i < count; i++) {
    const cx = ((i * 0.618033) % 1) * 1.8 - 0.9;
    const cy = ((i * 0.381966) % 1) * 1.8 - 0.9;
    const s = 0.06;
    data.set([cx, cy, 0, cx + s, cy, 0, cx, cy + s, 0], i * 9);
  }
  const buffer = gl.createBuffer() as WebGLBuffer;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buffer;
}

export async function runFramePass(options: FramePassOptions): Promise<FramePassResult> {
  const { gl, width, height } = options;
  const now = options.now ?? (() => performance.now());
  const shape = options.shape ?? GAME_FRAME_SHAPE;
  const frames = options.frames ?? 120;
  const samplers: SamplerRig = createSamplerRig(gl);
  const pattern = link(gl, PATTERN_VERTEX, PATTERN_FRAGMENT);
  const sample = link(gl, PATTERN_VERTEX, SAMPLE_FRAGMENT);
  const sampleTex = sample ? gl.getUniformLocation(sample, 'tex') : null;
  const targets = [colourTarget(gl, width, height), colourTarget(gl, width, height)];
  const shadow = depthTarget(gl, 1024);
  const triangles = scatteredTriangles(
    gl,
    Math.max(shape.shadowDraws, shape.colourDraws + shape.skeletons * shape.drawsPerSkeleton),
  );
  const quad = gl.createBuffer() as WebGLBuffer;
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  // Bone textures: one 64x64 RGBA float texture per skeleton, updated per frame.
  const boneData = new Float32Array(64 * 64 * 4);
  const bones: WebGLTexture[] = [];
  for (let i = 0; i < shape.skeletons; i++) {
    const texture = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 64, 64);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    bones.push(texture);
  }
  // The 4x4 pattern texture the texture checksum reads through a sampler.
  const patternTexture = gl.createTexture() as WebGLTexture;
  const patternTexels = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < 16; i++) {
    patternTexels.set([(i * 16) & 255, (255 - i * 16) & 255, 128, 255], i * 4);
  }
  gl.bindTexture(gl.TEXTURE_2D, patternTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, patternTexels);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.bindTexture(gl.TEXTURE_2D, null);

  const useTriangles = (): void => {
    gl.bindBuffer(gl.ARRAY_BUFFER, triangles);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  };
  const useQuad = (): void => {
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  };
  const drawWith = (program: WebGLProgram, index: number): void => {
    gl.useProgram(program);
    samplers.bind(program);
    gl.drawArrays(gl.TRIANGLES, index * 3, 3);
  };

  const submitMs: number[] = [];
  const loop = await runFrameLoop({
    gl,
    scene: null,
    passes: 0,
    frames,
    now,
    onFrame: (frame) => {
      const started = now();
      // Shadow pass.
      gl.bindFramebuffer(gl.FRAMEBUFFER, shadow.framebuffer);
      gl.viewport(0, 0, 1024, 1024);
      gl.enable(gl.DEPTH_TEST);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      useTriangles();
      const shadowProgram = options.shadowProgram ?? options.colourPrograms[0];
      if (shadowProgram) {
        for (let i = 0; i < shape.shadowDraws; i++) drawWith(shadowProgram, i);
      }
      // Colour pass.
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets[0].framebuffer);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.DEPTH_TEST);
      gl.clearColor(0.1, 0.1, 0.12, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      useTriangles();
      const programs = options.colourPrograms;
      for (let i = 0; i < shape.colourDraws && programs.length > 0; i++) {
        drawWith(programs[i % programs.length], i);
      }
      let draw = shape.colourDraws;
      for (let s = 0; s < shape.skeletons; s++) {
        boneData[(frame + s) % boneData.length] = frame;
        gl.bindTexture(gl.TEXTURE_2D, bones[s]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 64, gl.RGBA, gl.FLOAT, boneData);
        for (let d = 0; d < shape.drawsPerSkeleton && programs.length > 0; d++) {
          drawWith(programs[(s + d) % programs.length], draw++);
        }
      }
      // Post chain: ping-pong through the sampler.
      if (sample) {
        useQuad();
        gl.useProgram(sample);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(sampleTex, 0);
        for (let p = 0; p < shape.postPasses; p++) {
          const from = targets[p % 2];
          const to = targets[(p + 1) % 2];
          gl.bindFramebuffer(gl.FRAMEBUFFER, to.framebuffer);
          gl.bindTexture(gl.TEXTURE_2D, from.texture);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
      }
      // The pattern pass to the screen.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      if (pattern) {
        useQuad();
        gl.useProgram(pattern);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      submitMs.push(now() - started);
      return true;
    },
  });

  // The checksum: the pattern on screen, then the 4x4 texture magnified.
  const pixel = new Uint8Array(4);
  const patternSamples: ChecksumSample[] = [];
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (pattern) {
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const x = Math.floor(((i + 0.5) / 4) * width);
        const y = Math.floor(((j + 0.5) / 4) * height);
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        patternSamples.push({
          expected: patternReference((x + 0.5) / width, (y + 0.5) / height),
          actual: [pixel[0], pixel[1], pixel[2]],
        });
      }
    }
  }
  const textureSamples: ChecksumSample[] = [];
  if (sample) {
    useQuad();
    gl.useProgram(sample);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, patternTexture);
    gl.uniform1i(sampleTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const x = Math.floor(((i + 0.5) / 4) * width);
        const y = Math.floor(((j + 0.5) / 4) * height);
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        const texel = (j * 4 + i) * 4;
        textureSamples.push({
          expected: [patternTexels[texel], patternTexels[texel + 1], patternTexels[texel + 2]],
          actual: [pixel[0], pixel[1], pixel[2]],
        });
      }
    }
  }

  samplers.dispose();
  for (const target of targets) {
    gl.deleteFramebuffer(target.framebuffer);
    gl.deleteTexture(target.texture);
  }
  gl.deleteFramebuffer(shadow.framebuffer);
  gl.deleteTexture(shadow.texture);
  gl.deleteBuffer(triangles);
  gl.deleteBuffer(quad);
  for (const bone of bones) gl.deleteTexture(bone);
  gl.deleteTexture(patternTexture);
  if (pattern) gl.deleteProgram(pattern);
  if (sample) gl.deleteProgram(sample);
  gl.disable(gl.DEPTH_TEST);

  return {
    summary: summarizeFramePass({
      intervalsMs: loop.intervalsMs,
      submitMs,
      refreshMs: options.refreshMs,
      shape,
      checksum: checksumVerdict(patternSamples),
      textureChecksum: checksumVerdict(textureSamples),
    }),
    intervalsMs: loop.intervalsMs,
    submitMs,
  };
}
