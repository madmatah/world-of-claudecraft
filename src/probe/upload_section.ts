// Section 8, the runner: one upload per frame under the calibrated load,
// over the three paths the game takes. A compressed texture in the best
// format the context offers (BC7, else DXT5; skipped when neither is
// there); a texImage2D from a 2D canvas drawn just before, sized above
// Chromium's acceleration threshold so the upload takes the GPU-to-GPU
// path the game's procedural textures take; a multi-megabyte bufferData.
// Each upload is followed by a draw that samples or reads what it uploaded,
// so a driver cannot defer it past the frame.

import { runFrameLoop } from './frame_runner';
import type { LoadScene } from './load_scene';
import {
  summarizeUploadPass,
  type UploadPassSummary,
  type UploadPath,
  type UploadSample,
} from './upload_section_core';

const COMPRESSED_RGBA_BPTC_UNORM_EXT = 0x8e8c;
const COMPRESSED_RGBA_S3TC_DXT5_EXT = 0x83f3;

export interface UploadPassOptions {
  gl: WebGL2RenderingContext;
  scene: LoadScene | null;
  loadPasses: number;
  refreshMs: number;
  /** Uploads per path per pass. */
  perPath?: number;
  textureSize?: number;
  bufferBytes?: number;
  now?: () => number;
  document?: Document;
}

export interface UploadPassResult {
  summary: UploadPassSummary;
  samples: UploadSample[];
}

interface CompressedFormat {
  format: number;
  blockBytes: number;
}

function compressedFormatOf(gl: WebGL2RenderingContext): CompressedFormat | null {
  if (gl.getExtension('EXT_texture_compression_bptc')) {
    return { format: COMPRESSED_RGBA_BPTC_UNORM_EXT, blockBytes: 16 };
  }
  if (gl.getExtension('WEBGL_compressed_texture_s3tc')) {
    return { format: COMPRESSED_RGBA_S3TC_DXT5_EXT, blockBytes: 16 };
  }
  return null;
}

/** A tiny sampler program so an uploaded texture is READ by a draw. */
function createSampleProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.shaderSource(
    vs,
    '#version 300 es\nin vec2 position; out vec2 vUv; void main(){ vUv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }',
  );
  gl.compileShader(vs);
  gl.shaderSource(
    fs,
    '#version 300 es\nprecision highp float; in vec2 vUv; uniform sampler2D tex; out vec4 o; void main(){ o = texture(tex, vUv) * 0.001 + vec4(0.0, 0.0, 0.0, 1.0); }',
  );
  gl.compileShader(fs);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, 'position');
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return gl.getProgramParameter(program, gl.LINK_STATUS) === true ? program : null;
}

export async function runUploadPass(options: UploadPassOptions): Promise<UploadPassResult> {
  const { gl } = options;
  const now = options.now ?? (() => performance.now());
  const doc = options.document ?? document;
  const perPath = options.perPath ?? 6;
  const size = options.textureSize ?? 1024;
  const bufferBytes = options.bufferBytes ?? 8 * 1024 * 1024;
  const compressed = compressedFormatOf(gl);
  const skipped: UploadPath[] = compressed ? [] : ['compressed'];

  const program = createSampleProgram(gl);
  const texture = gl.createTexture();
  const buffer = gl.createBuffer();
  const vao = gl.createVertexArray();
  const quad = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  const texAt = program ? gl.getUniformLocation(program, 'tex') : null;

  const compressedBytes = compressed ? (size / 4) * (size / 4) * compressed.blockBytes : 0;
  const compressedData = new Uint8Array(compressedBytes);
  const canvas = doc.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx2d = canvas.getContext('2d');
  const bufferData = new Float32Array(bufferBytes / 4);
  const pixel = new Uint8Array(4);

  const plan: UploadPath[] = [];
  for (let i = 0; i < perPath; i++) {
    if (compressed) plan.push('compressed');
    plan.push('canvas');
    plan.push('buffer');
  }
  const samples: UploadSample[] = [];
  let index = 0;
  let frameStart = 0;
  // Held in an object: the frame hook reassigns it, which control-flow
  // analysis cannot see across the loop's await.
  const held: { pending: { path: UploadPath; callMs: number; bytes: number } | null } = {
    pending: null,
  };

  const drawSample = (): void => {
    if (!program) return;
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(texAt, 0);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.useProgram(null);
  };

  const upload = (path: UploadPath, seed: number): { callMs: number; bytes: number } => {
    const started = now();
    let bytes = 0;
    if (path === 'compressed' && compressed) {
      compressedData[seed % compressedData.length] = seed & 0xff;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.compressedTexImage2D(gl.TEXTURE_2D, 0, compressed.format, size, size, 0, compressedData);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      bytes = compressedBytes;
      drawSample();
    } else if (path === 'canvas' && ctx2d) {
      ctx2d.fillStyle = `hsl(${(seed * 37) % 360}, 60%, 50%)`;
      ctx2d.fillRect(0, 0, size, size);
      ctx2d.fillStyle = '#fff';
      ctx2d.fillRect((seed * 13) % size, (seed * 7) % size, 64, 64);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      bytes = size * size * 4;
      drawSample();
    } else if (path === 'buffer') {
      bufferData[seed % bufferData.length] = seed;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, bufferData, gl.DYNAMIC_DRAW);
      // A draw reading the buffer: attribute 1 over its first floats.
      gl.bindVertexArray(vao);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
      gl.disableVertexAttribArray(1);
      gl.bindVertexArray(null);
      bytes = bufferBytes;
      drawSample();
    }
    // The readback is what forces the upload and its draw to execute inside
    // this frame, so the frame time carries them.
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return { callMs: now() - started, bytes };
  };

  const loop = await runFrameLoop({
    gl,
    scene: options.scene,
    passes: options.loadPasses,
    frames: plan.length + 2,
    now,
    onFrame: (frame, t) => {
      if (held.pending) {
        samples.push({ ...held.pending, frameMs: t - frameStart });
        held.pending = null;
      }
      if (index >= plan.length) return false;
      frameStart = t;
      const path = plan[index];
      const done = upload(path, index + 1);
      held.pending = { path, callMs: done.callMs, bytes: done.bytes };
      index += 1;
      return true;
    },
  });
  if (held.pending) samples.push({ ...held.pending, frameMs: now() - frameStart });

  gl.deleteTexture(texture);
  gl.deleteBuffer(buffer);
  gl.deleteBuffer(quad);
  gl.deleteVertexArray(vao);
  if (program) gl.deleteProgram(program);
  return {
    summary: summarizeUploadPass(samples, loop.intervalsMs, options.refreshMs, skipped),
    samples,
  };
}
