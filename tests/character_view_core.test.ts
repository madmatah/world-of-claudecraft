import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { characterViewOutsideHysteresis } from '../src/render/character_view_core';

describe('character view visibility hysteresis', () => {
  const createRangeSquared = 80 * 80;
  const destroyRangeSquared = 96 * 96;

  it.each([
    [false, createRangeSquared - 1, false],
    [false, createRangeSquared, false],
    [false, createRangeSquared + 1, true],
    [true, destroyRangeSquared - 1, false],
    [true, destroyRangeSquared, false],
    [true, destroyRangeSquared + 1, true],
  ] as const)(
    'for prior visible=%s classifies distance squared %s outside as %s',
    (wasVisible, distanceSquared, outside) => {
      expect(
        characterViewOutsideHysteresis(
          wasVisible,
          distanceSquared,
          createRangeSquared,
          destroyRangeSquared,
        ),
      ).toBe(outside);
    },
  );

  it('pins renderer wiring through the Realm Racers exception to the exact ranges', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(renderer).toMatch(
      /isOutsideRealmRacersDrawRange\(\s*participantIds,\s*p\.id,\s*id,\s*v\.group\.visible,\s*d2,\s*this\.entityViewCreateRangeSq,\s*this\.entityViewDestroyRangeSq,\s*\)/,
    );
    const realmRacersCore = readFileSync(
      new URL('../src/render/realm_racers_visibility_core.ts', import.meta.url),
      'utf8',
    );
    expect(realmRacersCore).toMatch(
      /characterViewOutsideHysteresis\(\s*wasVisible,\s*distanceSq,\s*createRangeSq,\s*destroyRangeSq,?\s*\)/,
    );
  });
});
