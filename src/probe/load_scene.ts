// The game-like GPU load the probe draws under while it measures links,
// uploads and pacing: full-screen fragment passes of real arithmetic (the
// challenge page's rig of 2026-08-27), calibrated so one frame of load costs
// a set fraction of the refresh interval on THIS GPU, rather than a fixed
// pass count that is nothing on a discrete card and everything on an iGPU.
// Thin GL over one program; no decisions beyond the calibration search.

const LOAD_VERTEX = `#version 300 es
in vec2 position;
out vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const LOAD_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform float uPhase;
uniform float uTint;
out vec4 outColor;
void main() {
  vec2 p = vUv * 6.0 - 3.0;
  float a = 0.0;
  for (int i = 0; i < 24; i++) {
    float f = float(i) * 0.37 + uPhase;
    p += 0.15 * vec2(sin(p.y * 1.3 + f), cos(p.x * 1.1 - f));
    a += 0.04 * sin(p.x * p.y + f);
  }
  outColor = vec4(0.5 + 0.5 * sin(a * 3.0 + uTint), 0.5 + 0.5 * cos(a * 2.0), uTint, 1.0);
}`;

export interface LoadScene {
  /** Draw `passes` full-screen passes; the phase animates the arithmetic so
   *  a driver cannot cache the frame. */
  draw(passes: number, phase: number): void;
  dispose(): void;
}

export function createLoadScene(gl: WebGL2RenderingContext): LoadScene | null {
  const program = gl.createProgram();
  const vertex = gl.createShader(gl.VERTEX_SHADER);
  const fragment = gl.createShader(gl.FRAGMENT_SHADER);
  if (!program || !vertex || !fragment) return null;
  gl.shaderSource(vertex, LOAD_VERTEX);
  gl.compileShader(vertex);
  gl.shaderSource(fragment, LOAD_FRAGMENT);
  gl.compileShader(fragment);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, 'position');
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) return null;
  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  const phaseAt = gl.getUniformLocation(program, 'uPhase');
  const tintAt = gl.getUniformLocation(program, 'uTint');
  return {
    draw(passes, phase) {
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      for (let i = 0; i < passes; i++) {
        gl.uniform1f(phaseAt, phase + i * 0.3);
        gl.uniform1f(tintAt, (i % 4) * 0.2);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.bindVertexArray(null);
      gl.useProgram(null);
    },
    dispose() {
      gl.deleteBuffer(vbo);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    },
  };
}

/** How many passes cost `targetMs` of GPU time per frame on this context:
 *  doubling passes and timing a draw plus readback each time (the readback
 *  waits for the GPU), then the largest count under the target. Never
 *  below one pass. */
export function calibrateLoadPasses(
  gl: WebGL2RenderingContext,
  scene: LoadScene,
  targetMs: number,
  now: () => number = () => performance.now(),
): number {
  const pixel = new Uint8Array(4);
  const timeDraw = (passes: number): number => {
    // One warm draw so the program's first-use cost is not the measurement.
    scene.draw(passes, 0);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const started = now();
    scene.draw(passes, 1);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return now() - started;
  };
  let passes = 1;
  let cost = timeDraw(1);
  while (passes < 256) {
    const next = timeDraw(passes * 2);
    if (next > targetMs) break;
    passes *= 2;
    cost = next;
  }
  return cost > 0 ? passes : 1;
}
