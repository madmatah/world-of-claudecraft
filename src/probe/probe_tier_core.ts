// The graphics tier the probe hands its children, from the game's persisted
// graphics preset number (src/render/gfx.ts numbers them: 1 low, 2 medium,
// 3 high, 4 ultra, 5 advanced, 6 insane). Advanced has no tier of its own
// (a custom mix), so it measures on the corpus of the tier its mix is
// closest to in program count, ultra; insane keeps its name and the corpus
// loader folds it (nearestCorpusTier). Pure; tests/probe_tier_core.test.ts.

export type ProbeTier = 'low' | 'medium' | 'high' | 'ultra' | 'insane';

export const PROBE_TIERS: readonly ProbeTier[] = ['low', 'medium', 'high', 'ultra', 'insane'];

export function tierFromPreset(preset: number | undefined | null): ProbeTier {
  switch (preset) {
    case 1:
      return 'low';
    case 2:
      return 'medium';
    case 3:
      return 'high';
    case 6:
      return 'insane';
    default:
      return 'ultra';
  }
}

/** The persisted preset number out of the game's settings blob, or undefined. */
export function presetFromSettingsJson(json: string | null | undefined): number | undefined {
  if (typeof json !== 'string' || json === '') return undefined;
  try {
    const raw = JSON.parse(json) as unknown;
    if (!raw || typeof raw !== 'object') return undefined;
    const value = (raw as Record<string, unknown>).graphicsPreset;
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
