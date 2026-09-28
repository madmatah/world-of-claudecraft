// The painters' private random streams (src/render/texture_random_stream.ts,
// read by every painter in src/render/textures.ts): a painter run
// under `withTextureRandomStream` draws from its own sequence and leaves the
// shared one exactly where it was, so a texture painted at a moment that
// varies (a Realm Racers circuit built when a pilot commits to it) never
// shifts the look of anything painted after it.
//
// The painters run against a recording 2D context: every numeric argument of
// every draw call is logged, which is a fingerprint of the random draws a
// paint made without needing a real canvas.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type TexturesModule = typeof import('../src/render/textures') &
  typeof import('../src/render/texture_random_stream');

let log: number[] = [];

function recordingContext(size: { width: number; height: number }) {
  const gradient = { addColorStop: (...args: unknown[]) => record(args) };
  const record = (args: unknown[]) => {
    for (const arg of args) if (typeof arg === 'number') log.push(arg);
  };
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'getImageData') {
          return () => ({ data: new Uint8ClampedArray(size.width * size.height * 4) });
        }
        if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
          return (...args: unknown[]) => {
            record(args);
            return gradient;
          };
        }
        return (...args: unknown[]) => record(args);
      },
      set() {
        return true;
      },
    },
  );
}

/** The painters and the stream switch out of one fresh module graph, so the
 *  shared sequence starts where a page load starts it. */
async function freshTextures(): Promise<TexturesModule> {
  vi.resetModules();
  const painters = await import('../src/render/textures');
  const streams = await import('../src/render/texture_random_stream');
  return { ...painters, ...streams };
}

/** What one paint drew: the numbers it logged. */
function painted(paint: () => unknown): number[] {
  log = [];
  paint();
  const drawn = log;
  log = [];
  return drawn;
}

beforeEach(() => {
  vi.stubGlobal('document', {
    createElement: () => {
      const canvas = { width: 1, height: 1, getContext: () => recordingContext(canvas) };
      return canvas;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a private texture random stream', () => {
  it('leaves the shared sequence exactly where it was', async () => {
    const control = await freshTextures();
    const first = painted(() => control.macroNoiseTexture());
    const second = painted(() => control.macroNoiseTexture());
    expect(second).not.toEqual(first);

    const probed = await freshTextures();
    expect(painted(() => probed.macroNoiseTexture())).toEqual(first);
    const stream = probed.textureRandomStream('realm-racers:circuit:probe');
    probed.withTextureRandomStream(stream, () => probed.macroNoiseTexture());
    // The paint under the stream did not move the shared sequence: the next
    // shared paint is the one it would have been without it.
    expect(painted(() => probed.macroNoiseTexture())).toEqual(second);
  });

  it('paints the same texture from the same seed, whatever ran before it', async () => {
    const a = await freshTextures();
    const fromFresh = painted(() =>
      a.withTextureRandomStream(a.textureRandomStream('seed-one'), () => a.macroNoiseTexture()),
    );
    const b = await freshTextures();
    b.macroNoiseTexture();
    b.macroNoiseTexture();
    const afterOthers = painted(() =>
      b.withTextureRandomStream(b.textureRandomStream('seed-one'), () => b.macroNoiseTexture()),
    );
    expect(afterOthers).toEqual(fromFresh);
    const other = painted(() =>
      b.withTextureRandomStream(b.textureRandomStream('seed-two'), () => b.macroNoiseTexture()),
    );
    expect(other).not.toEqual(fromFresh);
  });

  it('keeps its own position across calls, and nests', async () => {
    const t = await freshTextures();
    const stream = t.textureRandomStream('seed-one');
    const first = painted(() => t.withTextureRandomStream(stream, () => t.macroNoiseTexture()));
    const second = painted(() => t.withTextureRandomStream(stream, () => t.macroNoiseTexture()));
    expect(second).not.toEqual(first);

    const u = await freshTextures();
    const outer = u.textureRandomStream('seed-one');
    const shared = painted(() => u.macroNoiseTexture());
    const v = await freshTextures();
    const nested = painted(() =>
      v.withTextureRandomStream(outer, () =>
        v.withTextureRandomStream(v.textureRandomStream('inner'), () => v.macroNoiseTexture()),
      ),
    );
    expect(nested).not.toEqual(shared);
    // The outer stream did not move while the inner one painted.
    expect(outer.state).toBe(v.textureRandomStream('seed-one').state);
    // Nor did the shared sequence.
    expect(painted(() => v.macroNoiseTexture())).toEqual(shared);
  });

  it('restores the shared sequence when the paint throws', async () => {
    const control = await freshTextures();
    const first = painted(() => control.macroNoiseTexture());
    const t = await freshTextures();
    expect(() =>
      t.withTextureRandomStream(t.textureRandomStream('seed-one'), () => {
        t.macroNoiseTexture();
        throw new Error('paint failed');
      }),
    ).toThrow('paint failed');
    expect(painted(() => t.macroNoiseTexture())).toEqual(first);
  });

  it('gives a flower card painted from a stream its own cache entry and its own draws', async () => {
    const t = await freshTextures();
    const kinds = [
      {
        p: [240, 240, 240] as [number, number, number],
        c: [200, 180, 60] as [number, number, number],
      },
    ];
    const shared = t.flowerTuftTexture(kinds);
    const stream = t.textureRandomStream('realm-racers:flower');
    const scoped = t.flowerTuftTexture(kinds, false, stream);
    expect(scoped).not.toBe(shared);
    // Cached per stream id: a second stream of the same id reads the same card
    // without drawing again.
    expect(t.flowerTuftTexture(kinds, false, t.textureRandomStream('realm-racers:flower'))).toBe(
      scoped,
    );
    expect(t.flowerTuftTexture(kinds)).toBe(shared);
  });
});
