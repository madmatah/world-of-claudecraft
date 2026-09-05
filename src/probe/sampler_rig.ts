// Placeholder textures for a corpus program's samplers, so a draw with it is
// VALID: a real program mixes sampler2D, samplerCube, sampler2DShadow and
// the array and integer kinds, and WebGL refuses a draw where two samplers
// of different types read the same unit (all of them default to unit 0),
// which would leave the "first draw" measuring a rejected call. Each sampler
// uniform gets its own unit with a one-texel texture of its own kind; the
// textures are minted once per context and shared by every program.

const SAMPLER_2D = 0x8b5e;
const SAMPLER_3D = 0x8b5f;
const SAMPLER_CUBE = 0x8b60;
const SAMPLER_2D_SHADOW = 0x8b62;
const SAMPLER_2D_ARRAY = 0x8dc1;
const SAMPLER_2D_ARRAY_SHADOW = 0x8dc4;
const SAMPLER_CUBE_SHADOW = 0x8dc5;
const INT_SAMPLER_2D = 0x8dca;
const INT_SAMPLER_3D = 0x8dcb;
const INT_SAMPLER_CUBE = 0x8dcc;
const INT_SAMPLER_2D_ARRAY = 0x8dcf;
const UNSIGNED_INT_SAMPLER_2D = 0x8dd2;
const UNSIGNED_INT_SAMPLER_3D = 0x8dd3;
const UNSIGNED_INT_SAMPLER_CUBE = 0x8dd4;
const UNSIGNED_INT_SAMPLER_2D_ARRAY = 0x8dd7;

type Kind = 'float' | 'int' | 'uint' | 'shadow';
type Target = '2d' | '3d' | 'cube' | 'array';

interface SamplerShape {
  target: Target;
  kind: Kind;
}

const SHAPES: Record<number, SamplerShape> = {
  [SAMPLER_2D]: { target: '2d', kind: 'float' },
  [SAMPLER_3D]: { target: '3d', kind: 'float' },
  [SAMPLER_CUBE]: { target: 'cube', kind: 'float' },
  [SAMPLER_2D_SHADOW]: { target: '2d', kind: 'shadow' },
  [SAMPLER_2D_ARRAY]: { target: 'array', kind: 'float' },
  [SAMPLER_2D_ARRAY_SHADOW]: { target: 'array', kind: 'shadow' },
  [SAMPLER_CUBE_SHADOW]: { target: 'cube', kind: 'shadow' },
  [INT_SAMPLER_2D]: { target: '2d', kind: 'int' },
  [INT_SAMPLER_3D]: { target: '3d', kind: 'int' },
  [INT_SAMPLER_CUBE]: { target: 'cube', kind: 'int' },
  [INT_SAMPLER_2D_ARRAY]: { target: 'array', kind: 'int' },
  [UNSIGNED_INT_SAMPLER_2D]: { target: '2d', kind: 'uint' },
  [UNSIGNED_INT_SAMPLER_3D]: { target: '3d', kind: 'uint' },
  [UNSIGNED_INT_SAMPLER_CUBE]: { target: 'cube', kind: 'uint' },
  [UNSIGNED_INT_SAMPLER_2D_ARRAY]: { target: 'array', kind: 'uint' },
};

export interface SamplerRig {
  /** Bind every sampler of `program` (already in use) to its own unit. */
  bind(program: WebGLProgram): number;
  dispose(): void;
}

function glTarget(gl: WebGL2RenderingContext, target: Target): number {
  switch (target) {
    case '2d':
      return gl.TEXTURE_2D;
    case '3d':
      return gl.TEXTURE_3D;
    case 'cube':
      return gl.TEXTURE_CUBE_MAP;
    case 'array':
      return gl.TEXTURE_2D_ARRAY;
  }
}

function mintTexture(gl: WebGL2RenderingContext, shape: SamplerShape): WebGLTexture {
  const texture = gl.createTexture() as WebGLTexture;
  const target = glTarget(gl, shape.target);
  gl.bindTexture(target, texture);
  const format =
    shape.kind === 'shadow'
      ? { internal: gl.DEPTH_COMPONENT16, format: gl.DEPTH_COMPONENT, type: gl.UNSIGNED_SHORT }
      : shape.kind === 'int'
        ? { internal: gl.RGBA8I, format: gl.RGBA_INTEGER, type: gl.BYTE }
        : shape.kind === 'uint'
          ? { internal: gl.RGBA8UI, format: gl.RGBA_INTEGER, type: gl.UNSIGNED_BYTE }
          : { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
  const texel =
    shape.kind === 'shadow'
      ? new Uint16Array([0])
      : shape.kind === 'int'
        ? new Int8Array([0, 0, 0, 0])
        : new Uint8Array([128, 128, 128, 255]);
  if (shape.target === '2d') {
    gl.texImage2D(target, 0, format.internal, 1, 1, 0, format.format, format.type, texel);
  } else if (shape.target === 'cube') {
    for (let face = 0; face < 6; face++) {
      gl.texImage2D(
        gl.TEXTURE_CUBE_MAP_POSITIVE_X + face,
        0,
        format.internal,
        1,
        1,
        0,
        format.format,
        format.type,
        texel,
      );
    }
  } else {
    gl.texImage3D(target, 0, format.internal, 1, 1, 1, 0, format.format, format.type, texel);
  }
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  if (shape.kind === 'shadow') {
    gl.texParameteri(target, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(target, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  }
  gl.bindTexture(target, null);
  return texture;
}

export function createSamplerRig(gl: WebGL2RenderingContext): SamplerRig {
  const textures = new Map<string, WebGLTexture>();
  const maxUnits = Number(gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS)) || 16;
  const textureFor = (shape: SamplerShape): WebGLTexture => {
    const key = `${shape.target}:${shape.kind}`;
    let texture = textures.get(key);
    if (!texture) {
      texture = mintTexture(gl, shape);
      textures.set(key, texture);
    }
    return texture;
  };
  return {
    bind(program) {
      const count = Number(gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS)) || 0;
      let unit = 0;
      for (let i = 0; i < count && unit < maxUnits; i++) {
        const info = gl.getActiveUniform(program, i);
        if (!info) continue;
        const shape = SHAPES[info.type];
        if (!shape) continue;
        const location = gl.getUniformLocation(program, info.name);
        if (!location) continue;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(glTarget(gl, shape.target), textureFor(shape));
        gl.uniform1i(location, unit);
        unit += 1;
      }
      gl.activeTexture(gl.TEXTURE0);
      return unit;
    },
    dispose() {
      for (const texture of textures.values()) gl.deleteTexture(texture);
      textures.clear();
    },
  };
}
