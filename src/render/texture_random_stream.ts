// A private position in the procedural painters' random sequence
// (textures.ts). Every painter there draws from one shared sequence, so a
// painter run at a moment that varies (a Realm Racers circuit built when a
// pilot commits to it, in whatever order races are drawn) would shift every
// texture painted after it. A caller with its own stream paints from it
// instead and leaves the shared sequence untouched. Its own module so the
// painter mocks the render suites install never have to know it exists.

export interface TextureRandomStream {
  /** What the stream was seeded from; scopes the caches it paints into. */
  readonly id: string;
  state: number;
}

let active: TextureRandomStream | null = null;

export function textureRandomStream(seed: string): TextureRandomStream {
  // FNV-1a over the seed string, folded into the sequence's 31-bit state.
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return { id: seed, state: hash & 0x7fffffff || 12345 };
}

/** Run `paint` with every painter drawing from `stream`; the shared sequence
 *  is not touched, and the stream keeps its new position. Synchronous only:
 *  the swap lasts for the call. Nests, and survives a throw. */
export function withTextureRandomStream<T>(stream: TextureRandomStream, paint: () => T): T {
  const outer = active;
  active = stream;
  try {
    return paint();
  } finally {
    active = outer;
  }
}

/** The stream a painter draws from right now, null for the shared sequence. */
export function activeTextureRandomStream(): TextureRandomStream | null {
  return active;
}
