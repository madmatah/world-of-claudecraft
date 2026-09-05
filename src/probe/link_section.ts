// Section 4, cold links on the main thread: the heavy corpus programs,
// salted for this pass, each compiled, linked and RESOLVED (the LINK_STATUS
// read) in turn on the main thread, timed one by one; then the unsalted
// repeat, the same texts linked again, which is the hit cost (the in-process
// program cache; with a fresh profile per child the disk cache is empty by
// construction). The GL discipline is the warm-up's (shader_warmup_gl_core:
// the location-0 bind, a resolved link); the decisions are
// link_section_core's. Yields between links so the watchdog and the shell's
// window-state push can be heard.

import {
  deleteWarmProgram,
  releaseWarmShaders,
  resolveWarmProgram,
  submitWarmProgram,
} from '../render/shader_warmup_gl_core';
import {
  type LinkPassSummary,
  type LinkSample,
  linkCapMs,
  summarizeLinkPass,
} from './link_section_core';
import type { SaltedProgram } from './salt_core';
import { createSamplerRig } from './sampler_rig';

export interface LinkPassResult {
  cold: LinkPassSummary;
  hit: LinkPassSummary;
  coldSamples: LinkSample[];
  hitSamples: LinkSample[];
}

export interface LinkPassOptions {
  minimum?: number;
  /** Called between links; a returning false aborts the pass (disturbed). */
  yieldFrame?: () => Promise<boolean>;
  now?: () => number;
}

/** A full-screen triangle on attribute 0 (three binds `position` there on
 *  every corpus program) and a one-pixel readback: the immediate first draw
 *  that makes a linked program READY, executed for real. */
export interface FirstDrawRig {
  draw(program: WebGLProgram): void;
  /** The same draw in another state: blending on, into a half-float target. */
  drawSecondState(program: WebGLProgram): void;
  dispose(): void;
}

const PIXEL = new Uint8Array(4);

export function createFirstDrawRig(gl: WebGL2RenderingContext): FirstDrawRig {
  const samplers = createSamplerRig(gl);
  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  const target = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  gl.bindTexture(gl.TEXTURE_2D, target);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, 64, 64);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const halfPixel = new Float32Array(4);
  return {
    drawSecondState(program) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, 64, 64);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(program);
      samplers.bind(program);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, halfPixel);
      gl.bindVertexArray(null);
      gl.useProgram(null);
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    },
    draw(program) {
      gl.useProgram(program);
      // Every sampler on its own unit with a texture of its kind, or WebGL
      // refuses the draw and the first-draw cost is never paid.
      samplers.bind(program);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // The readback is what forces the draw to execute (and the pipeline to
      // exist) before the clock stops.
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, PIXEL);
      gl.bindVertexArray(null);
      gl.useProgram(null);
    },
    dispose() {
      samplers.dispose();
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(target);
      gl.deleteBuffer(vbo);
      gl.deleteVertexArray(vao);
    },
  };
}

const defaultYield = (): Promise<boolean> =>
  new Promise((resolve) => {
    const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => number })
      .requestAnimationFrame;
    if (raf) raf(() => resolve(true));
    else setTimeout(() => resolve(true), 0);
  });

async function linkAll(
  gl: WebGL2RenderingContext,
  rig: FirstDrawRig,
  programs: readonly SaltedProgram[],
  options: Required<Pick<LinkPassOptions, 'yieldFrame' | 'now'>> & { minimum: number },
): Promise<{ samples: LinkSample[]; capped: boolean; aborted: boolean }> {
  const samples: LinkSample[] = [];
  const timings: number[] = [];
  let capped = false;
  let aborted = false;
  for (const program of programs) {
    const started = options.now();
    const handle = submitWarmProgram(gl, program);
    if (!handle) {
      samples.push({
        cacheKey: program.cacheKey,
        ms: 0,
        linkMs: 0,
        drawMs: 0,
        draw2Ms: 0,
        linked: false,
      });
      continue;
    }
    // The resolve, then the immediate first draw: on a backend that links
    // off-thread the submit returns at once and the LINK_STATUS read waits
    // for it; on ANGLE Vulkan the resolve is cheap and the draw waits for the
    // driver's background pipeline compile.
    const linked = resolveWarmProgram(gl, handle) === 'linked';
    const resolved = options.now();
    if (linked) rig.draw(handle.program);
    const drawn = options.now();
    if (linked) rig.drawSecondState(handle.program);
    const drawn2 = options.now();
    const ms = drawn - started;
    releaseWarmShaders(gl, handle);
    deleteWarmProgram(gl, handle);
    samples.push({
      cacheKey: program.cacheKey,
      ms,
      linkMs: resolved - started,
      drawMs: drawn - resolved,
      draw2Ms: drawn2 - drawn,
      linked,
    });
    if (linked) {
      const cap = linkCapMs(timings);
      timings.push(ms);
      if (ms > cap) {
        capped = true;
        break;
      }
    }
    if (!(await options.yieldFrame())) {
      aborted = true;
      break;
    }
  }
  return { samples, capped, aborted };
}

/** One pass: the cold links, then the hit repeat over the same salted set. */
export async function runLinkPass(
  gl: WebGL2RenderingContext,
  programs: readonly SaltedProgram[],
  options: LinkPassOptions = {},
): Promise<LinkPassResult & { aborted: boolean }> {
  const settings = {
    minimum: options.minimum ?? 12,
    yieldFrame: options.yieldFrame ?? defaultYield,
    now: options.now ?? (() => performance.now()),
  };
  const rig = createFirstDrawRig(gl);
  const cold = await linkAll(gl, rig, programs, settings);
  const hitRun = cold.aborted
    ? { samples: [], capped: false, aborted: true }
    : await linkAll(gl, rig, programs, settings);
  rig.dispose();
  return {
    cold: summarizeLinkPass(cold.samples, { minimum: settings.minimum, capped: cold.capped }),
    hit: summarizeLinkPass(hitRun.samples, { minimum: settings.minimum, capped: hitRun.capped }),
    coldSamples: cold.samples,
    hitSamples: hitRun.samples,
    aborted: cold.aborted || hitRun.aborted,
  };
}
