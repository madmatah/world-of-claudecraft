// The probe's WebGL2 context: created exactly the way the game creates its
// world context (the same attributes, the same extension sweep in the same
// order), because the browser's program cache keys on both, and a probe that
// linked under another set would measure a cache the game never hits. Thin
// host code; the readout of what the context is comes from the shared
// classifier (src/render/gpu_backend_class_core.ts).

import { type GpuBackendReadout, readGpuBackend } from '../render/gpu_backend_class_core';
import { enableRendererExtensions } from '../render/renderer_extensions';
import { createWebGL2ContextWithFallback } from '../render/webgl_context_fallback';

export interface ProbeContext {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  /** The extensions the sweep enabled, in order. */
  extensions: string[];
  /** Whether KHR_parallel_shader_compile is on this context. */
  parallelCompile: boolean;
  readout: GpuBackendReadout;
  /** The power preference the context was granted. */
  powerPreference: string;
  dispose(): void;
}

/** Create the probe's context on a canvas of the given size; null when the
 *  page has no WebGL2 at all (the identity section reports it). */
export function createProbeContext(
  width: number,
  height: number,
  document: Document = globalThis.document,
): ProbeContext | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  let outcome: ReturnType<typeof createWebGL2ContextWithFallback>;
  try {
    outcome = createWebGL2ContextWithFallback(canvas);
  } catch {
    return null;
  }
  const gl = outcome.context;
  const sweep = enableRendererExtensions(gl);
  return {
    canvas,
    gl,
    extensions: sweep.enabled,
    parallelCompile: sweep.enabled.includes('KHR_parallel_shader_compile'),
    readout: readGpuBackend(gl),
    powerPreference: outcome.powerPreference,
    dispose() {
      const lose = gl.getExtension('WEBGL_lose_context');
      lose?.loseContext();
      canvas.width = 1;
      canvas.height = 1;
    },
  };
}
