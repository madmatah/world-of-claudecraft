import { describe, expect, it } from 'vitest';
import { type ContextLimits, capabilityReport } from '../src/probe/capability_core';

const limits: ContextLimits = {
  maxTextureSize: 16384,
  maxCubeMapSize: 16384,
  max3dTextureSize: 2048,
  maxArrayTextureLayers: 2048,
  maxCombinedTextureUnits: 32,
  maxVertexAttribs: 16,
  maxVaryingVectors: 31,
  maxFragmentUniformVectors: 1024,
  maxSamples: 8,
  maxAnisotropy: 16,
};

const swept = [
  'EXT_color_buffer_float',
  'EXT_color_buffer_half_float',
  'KHR_parallel_shader_compile',
  'EXT_texture_filter_anisotropic',
  'EXT_texture_compression_bptc',
  'WEBGL_compressed_texture_s3tc',
];

describe('capabilityReport', () => {
  it('is clean on a full desktop context', () => {
    const report = capabilityReport({ swept, enabled: swept, limits });
    expect(report.critical).toEqual([]);
    expect(report.degraded).toEqual([]);
    expect(report.missingExtensions).toEqual([]);
    expect(report.compressed.bptc).toBe(true);
    expect(report.halfFloatTargets).toBe(true);
  });

  it('disqualifies a context without half-float targets or with tiny limits', () => {
    const report = capabilityReport({
      swept,
      enabled: swept.filter((n) => !n.startsWith('EXT_color_buffer')),
      limits: { ...limits, maxTextureSize: 2048, maxVaryingVectors: 8 },
    });
    expect(report.critical).toEqual([
      'no half-float render targets',
      'max texture size 2048',
      'max varying vectors 8',
    ]);
    expect(report.missingExtensions).toEqual([
      'EXT_color_buffer_float',
      'EXT_color_buffer_half_float',
    ]);
  });

  it('degrades, without disqualifying, on missing compression, parallel compile or anisotropy', () => {
    const report = capabilityReport({
      swept,
      enabled: ['EXT_color_buffer_half_float', 'EXT_texture_filter_anisotropic'],
      limits: { ...limits, maxAnisotropy: 4 },
    });
    expect(report.critical).toEqual([]);
    expect(report.degraded).toEqual([
      'no compressed texture format (RGBA transcode)',
      'no parallel shader compile',
      'anisotropy capped at 4',
    ]);
    const s3tcOnly = capabilityReport({
      swept,
      enabled: ['EXT_color_buffer_half_float', 'WEBGL_compressed_texture_s3tc'],
      limits,
    });
    expect(s3tcOnly.degraded).toContain('no BC7 (BPTC) textures');
  });
});
