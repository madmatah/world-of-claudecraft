// Section 2, capability parity: what the renderer needs from a context and
// what this backend gives it, host-agnostic. Zero measurement time,
// disqualifying power: a missing float render target breaks the post chain,
// a missing compressed format means the KTX2 path transcodes to RGBA (four
// times the memory, slower loads, invisible to fps).

export interface ContextLimits {
  maxTextureSize: number;
  maxCubeMapSize: number;
  max3dTextureSize: number;
  maxArrayTextureLayers: number;
  maxCombinedTextureUnits: number;
  maxVertexAttribs: number;
  maxVaryingVectors: number;
  maxFragmentUniformVectors: number;
  maxSamples: number;
  maxAnisotropy: number;
}

export interface CapabilityReport {
  /** Extensions the renderer sweeps that this context refused. */
  missingExtensions: string[];
  /** The compressed formats the KTX2 path can target here. */
  compressed: { bptc: boolean; s3tc: boolean; etc: boolean; astc: boolean };
  /** Half-float and float colour targets for the post chain. */
  halfFloatTargets: boolean;
  floatTargets: boolean;
  limits: ContextLimits;
  /** What disqualifies the backend outright. */
  critical: string[];
  /** What degrades the game without disqualifying. */
  degraded: string[];
}

/** The extensions the game cannot run its post chain or its textures
 *  without; the rest of the sweep degrades quality or speed. */
export const CRITICAL_EXTENSIONS: readonly string[] = ['EXT_color_buffer_half_float'];

/** The renderer's texture limits: what the biggest atlas and the shadow
 *  map need; below them the game would fail to allocate. */
export const MIN_TEXTURE_SIZE = 4096;
export const MIN_VARYING_VECTORS = 15;

export function capabilityReport(input: {
  swept: readonly string[];
  enabled: readonly string[];
  limits: ContextLimits;
}): CapabilityReport {
  const has = (name: string): boolean => input.enabled.includes(name);
  const missingExtensions = input.swept.filter((name) => !has(name));
  const compressed = {
    bptc: has('EXT_texture_compression_bptc'),
    s3tc: has('WEBGL_compressed_texture_s3tc'),
    etc: has('WEBGL_compressed_texture_etc'),
    astc: has('WEBGL_compressed_texture_astc'),
  };
  const halfFloatTargets = has('EXT_color_buffer_half_float') || has('EXT_color_buffer_float');
  const floatTargets = has('EXT_color_buffer_float');
  const critical: string[] = [];
  const degraded: string[] = [];
  if (!halfFloatTargets) critical.push('no half-float render targets');
  if (input.limits.maxTextureSize < MIN_TEXTURE_SIZE) {
    critical.push(`max texture size ${input.limits.maxTextureSize}`);
  }
  if (input.limits.maxVaryingVectors < MIN_VARYING_VECTORS) {
    critical.push(`max varying vectors ${input.limits.maxVaryingVectors}`);
  }
  if (!compressed.bptc && !compressed.s3tc && !compressed.etc && !compressed.astc) {
    degraded.push('no compressed texture format (RGBA transcode)');
  } else if (!compressed.bptc) {
    degraded.push('no BC7 (BPTC) textures');
  }
  if (!has('KHR_parallel_shader_compile')) degraded.push('no parallel shader compile');
  if (!has('EXT_texture_filter_anisotropic')) degraded.push('no anisotropic filtering');
  if (input.limits.maxAnisotropy < 8 && has('EXT_texture_filter_anisotropic')) {
    degraded.push(`anisotropy capped at ${input.limits.maxAnisotropy}`);
  }
  return {
    missingExtensions,
    compressed,
    halfFloatTargets,
    floatTargets,
    limits: input.limits,
    critical,
    degraded,
  };
}
