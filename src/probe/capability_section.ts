// Section 2, the runner: read the context's limits and hand them with the
// extension sweep to the core. Thin GL; nothing here decides.

import { RENDERER_CONTEXT_EXTENSIONS } from '../render/renderer_extensions';
import { type CapabilityReport, type ContextLimits, capabilityReport } from './capability_core';
import type { ProbeContext } from './probe_context';

const MAX_TEXTURE_MAX_ANISOTROPY_EXT = 0x84ff;

export function readContextLimits(gl: WebGL2RenderingContext): ContextLimits {
  const int = (pname: number): number => Number(gl.getParameter(pname)) || 0;
  const anisotropic = gl.getExtension('EXT_texture_filter_anisotropic');
  return {
    maxTextureSize: int(gl.MAX_TEXTURE_SIZE),
    maxCubeMapSize: int(gl.MAX_CUBE_MAP_TEXTURE_SIZE),
    max3dTextureSize: int(gl.MAX_3D_TEXTURE_SIZE),
    maxArrayTextureLayers: int(gl.MAX_ARRAY_TEXTURE_LAYERS),
    maxCombinedTextureUnits: int(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
    maxVertexAttribs: int(gl.MAX_VERTEX_ATTRIBS),
    maxVaryingVectors: int(gl.MAX_VARYING_VECTORS),
    maxFragmentUniformVectors: int(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
    maxSamples: int(gl.MAX_SAMPLES),
    maxAnisotropy: anisotropic ? int(MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 0,
  };
}

export function runCapabilitySection(context: ProbeContext): CapabilityReport {
  return capabilityReport({
    swept: RENDERER_CONTEXT_EXTENSIONS,
    enabled: context.extensions,
    limits: readContextLimits(context.gl),
  });
}
