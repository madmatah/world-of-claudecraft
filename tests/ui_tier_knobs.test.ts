import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { UiEffectsTier } from '../src/game/ui_effects_profile';
import {
  AURA_REFRESH_INTERVAL_LOW_MS,
  AURA_VISIBLE_CAP_FULL,
  AURA_VISIBLE_CAP_LOW,
  auraRefreshIntervalMs,
  auraVisibleCap,
  cadenceDue,
  coerceFxTier,
  FCT_MAX_CONCURRENT_LOW,
  FCT_TTL_SCALE_FULL,
  FCT_TTL_SCALE_LOW,
  fctDropNonCrit,
  fctMaxConcurrent,
  fctTtlScale,
  MINIMAP_REDRAW_INTERVAL_LOW_MS,
  minimapRedrawIntervalMs,
  PARTY_FRAME_NONSELF_INTERVAL_LOW_MS,
  partyFrameNonSelfIntervalMs,
  TARGET_FRAME_NONSELF_INTERVAL_LOW_MS,
  targetFrameNonSelfIntervalMs,
} from '../src/game/ui_tier_knobs';

// P14a per-element graphics-tier knobs. The headline gate is the two-controller hazard:
// every knob is a pure function of the STATIC tier and NEVER reads the FPS governor, so
// only the static preset can move a knob. These tests pin that (import-absence +
// behavioral), the no-op-on-full invariant (medium/high/ultra are byte-equivalent to
// pre-tiering), and that low measurably sheds on every knob.

// The four published tiers and the three that must stay at full effects (only low sheds).
const ALL_TIERS: readonly UiEffectsTier[] = ['low', 'medium', 'high', 'ultra'];
const FULL_TIERS: readonly UiEffectsTier[] = ['medium', 'high', 'ultra'];

const FCT_POOL_CAP = 64; // the painter's pre-allocated pool size (fct_painter.ts)

describe('ui_tier_knobs - determinism (pure: same input, same output)', () => {
  it('every knob returns an identical value on repeated calls', () => {
    for (const tier of ALL_TIERS) {
      expect(fctMaxConcurrent(tier, FCT_POOL_CAP)).toBe(fctMaxConcurrent(tier, FCT_POOL_CAP));
      expect(fctTtlScale(tier)).toBe(fctTtlScale(tier));
      expect(fctDropNonCrit(tier)).toBe(fctDropNonCrit(tier));
      expect(minimapRedrawIntervalMs(tier)).toBe(minimapRedrawIntervalMs(tier));
      expect(auraVisibleCap(tier)).toBe(auraVisibleCap(tier));
      expect(auraRefreshIntervalMs(tier)).toBe(auraRefreshIntervalMs(tier));
      expect(targetFrameNonSelfIntervalMs(tier)).toBe(targetFrameNonSelfIntervalMs(tier));
      expect(partyFrameNonSelfIntervalMs(tier)).toBe(partyFrameNonSelfIntervalMs(tier));
    }
  });
});

describe('ui_tier_knobs - no-op on full tiers (ultra byte-equivalent to pre-tiering)', () => {
  it('FCT: full pool cap, TTL scale 1, no drop-non-crit on medium/high/ultra', () => {
    for (const tier of FULL_TIERS) {
      expect(fctMaxConcurrent(tier, FCT_POOL_CAP)).toBe(FCT_POOL_CAP);
      expect(fctTtlScale(tier)).toBe(FCT_TTL_SCALE_FULL);
      expect(fctTtlScale(tier)).toBe(1); // 1250 * 1 = 1250, exactly the descriptor ttl
      expect(fctDropNonCrit(tier)).toBe(false);
    }
  });

  it('cadence knobs return 0 (no extra throttle) on medium/high/ultra', () => {
    for (const tier of FULL_TIERS) {
      expect(minimapRedrawIntervalMs(tier)).toBe(0);
      expect(auraRefreshIntervalMs(tier)).toBe(0);
      expect(targetFrameNonSelfIntervalMs(tier)).toBe(0);
      expect(partyFrameNonSelfIntervalMs(tier)).toBe(0);
    }
  });

  it('aura visible-count is uncapped on medium/high/ultra', () => {
    for (const tier of FULL_TIERS) {
      expect(auraVisibleCap(tier)).toBe(AURA_VISIBLE_CAP_FULL);
      expect(auraVisibleCap(tier)).toBe(Number.POSITIVE_INFINITY);
    }
  });

  it('a 0-interval cadence is ALWAYS due, so the full-tier path is the unchanged path', () => {
    // cadenceDue with the full-tier interval (0) is due regardless of elapsed time, even
    // for a future-dated lastAt: there is no extra throttle on medium/high/ultra.
    expect(cadenceDue(0, 0, minimapRedrawIntervalMs('ultra'))).toBe(true);
    expect(cadenceDue(1_000_000, 0, targetFrameNonSelfIntervalMs('high'))).toBe(true);
    expect(cadenceDue(0, 0, partyFrameNonSelfIntervalMs('medium'))).toBe(true);
  });
});

describe('ui_tier_knobs - low sheds cost on every knob', () => {
  it('FCT: tighter live cap, shorter TTL, drops non-crit', () => {
    expect(fctMaxConcurrent('low', FCT_POOL_CAP)).toBe(FCT_MAX_CONCURRENT_LOW);
    expect(fctMaxConcurrent('low', FCT_POOL_CAP)).toBeLessThan(FCT_POOL_CAP);
    expect(fctTtlScale('low')).toBe(FCT_TTL_SCALE_LOW);
    expect(fctTtlScale('low')).toBeLessThan(1);
    expect(fctDropNonCrit('low')).toBe(true);
  });

  it('FCT live cap never exceeds the pre-allocated pool (small-pool clamp)', () => {
    expect(fctMaxConcurrent('low', 3)).toBe(3);
    expect(fctMaxConcurrent('low', FCT_MAX_CONCURRENT_LOW + 10)).toBe(FCT_MAX_CONCURRENT_LOW);
  });

  it('minimap redraw throttles, auras cap + coarsen, non-self frames slow on low', () => {
    expect(minimapRedrawIntervalMs('low')).toBe(MINIMAP_REDRAW_INTERVAL_LOW_MS);
    expect(minimapRedrawIntervalMs('low')).toBeGreaterThan(0);
    expect(auraVisibleCap('low')).toBe(AURA_VISIBLE_CAP_LOW);
    expect(auraVisibleCap('low')).toBeLessThan(AURA_VISIBLE_CAP_FULL);
    expect(auraRefreshIntervalMs('low')).toBe(AURA_REFRESH_INTERVAL_LOW_MS);
    expect(targetFrameNonSelfIntervalMs('low')).toBe(TARGET_FRAME_NONSELF_INTERVAL_LOW_MS);
    expect(partyFrameNonSelfIntervalMs('low')).toBe(PARTY_FRAME_NONSELF_INTERVAL_LOW_MS);
  });
});

describe('ui_tier_knobs - cadenceDue semantics', () => {
  it('a positive interval throttles to that spacing', () => {
    expect(cadenceDue(1000, 1000, 250)).toBe(false); // 0ms elapsed
    expect(cadenceDue(1000, 1249, 250)).toBe(false); // 249ms elapsed
    expect(cadenceDue(1000, 1250, 250)).toBe(true); // exactly 250ms elapsed
    expect(cadenceDue(1000, 2000, 250)).toBe(true); // well past
  });

  it('a 0 or negative interval is always due', () => {
    expect(cadenceDue(1000, 1000, 0)).toBe(true);
    expect(cadenceDue(5000, 1000, 0)).toBe(true); // even a future lastAt
    expect(cadenceDue(1000, 1000, -1)).toBe(true);
  });
});

describe('ui_tier_knobs - coerceFxTier (the static data-fx-level -> tier read)', () => {
  it('passes through every valid tier string', () => {
    for (const tier of ALL_TIERS) expect(coerceFxTier(tier)).toBe(tier);
  });

  it('defaults to ultra (full effects) for an unset / unknown value', () => {
    // A missing or garbage stamp must never silently shed HUD cost.
    expect(coerceFxTier(undefined)).toBe('ultra');
    expect(coerceFxTier(null)).toBe('ultra');
    expect(coerceFxTier('')).toBe('ultra');
    expect(coerceFxTier('LOW')).toBe('ultra'); // case-sensitive: not a published tier
    expect(coerceFxTier('reduced')).toBe('ultra');
    expect(coerceFxTier('advanced')).toBe('ultra'); // a PRESET label, not a published tier
  });
});

describe('ui_tier_knobs - import absence + two-controller hazard (source scan)', () => {
  // The headline acceptance: the mapping reads the STATIC tier ONLY and never the FPS
  // governor, so flipping the static preset is the only thing that can move a knob.
  // Proven by reading the source (the architecture purity guard forbids render/game/net/
  // three/painter imports for a UI_PURE_CORE; this pins the governor + DOM rules too).
  const src = readFileSync(
    fileURLToPath(new URL('../src/game/ui_tier_knobs.ts', import.meta.url)),
    'utf8',
  );
  // Blank out comments so prose (which legitimately names the governor + the static
  // preset) cannot create a false positive; only real code is scanned.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('imports ONLY the UiEffectsTier type from the sibling resolver, nothing else', () => {
    const froms = [...code.matchAll(/\bimport\b[^;]*\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(froms).toEqual(['./ui_effects_profile']);
    expect(code).not.toMatch(/\bimport\s*\(/); // no dynamic import either
  });

  it('never reads the FPS governor state (the two-controller hazard)', () => {
    expect(code).not.toMatch(/governor/i);
    expect(code).not.toMatch(/render_budget/);
    expect(code).not.toMatch(/\.state\s*\(/);
    expect(code).not.toMatch(/\.levels\b/);
  });

  it('never reaches into src/render, src/ui, or src/net', () => {
    expect(code).not.toMatch(/['"][^'"]*\/render\//);
    expect(code).not.toMatch(/['"][^'"]*\/ui\//);
    expect(code).not.toMatch(/['"][^'"]*\/net\//);
  });

  it('touches no DOM global and no nondeterministic clock/random (purity)', () => {
    expect(code).not.toMatch(/\b(document|window|navigator|localStorage|sessionStorage)\s*[.[]/);
    expect(code).not.toMatch(/\b(Math\.random|Date\.now|performance\.now)\b/);
  });
});

describe('ui_tier_knobs - behavioral: only the tier moves a knob', () => {
  it('the only input that changes a knob is the tier argument (no hidden state)', () => {
    // Capture the full knob vector for each tier, then re-read after arbitrary unrelated
    // work: the vectors are identical, so nothing outside the tier argument (e.g. a
    // governor, a clock) can move a knob.
    const snapshot = (tier: UiEffectsTier) => ({
      fctCap: fctMaxConcurrent(tier, FCT_POOL_CAP),
      fctTtl: fctTtlScale(tier),
      fctDrop: fctDropNonCrit(tier),
      minimap: minimapRedrawIntervalMs(tier),
      auraCap: auraVisibleCap(tier),
      auraRefresh: auraRefreshIntervalMs(tier),
      target: targetFrameNonSelfIntervalMs(tier),
      party: partyFrameNonSelfIntervalMs(tier),
    });
    const before = ALL_TIERS.map(snapshot);
    // Unrelated churn that a governor-driven knob would react to (it must not here).
    for (let i = 0; i < 1000; i++) cadenceDue(i, i * 2, i % 3);
    const after = ALL_TIERS.map(snapshot);
    expect(after).toEqual(before);
    // And low is strictly cheaper than ultra on the knobs that compare (the gate's point).
    expect(before[0].fctCap).toBeLessThan(before[3].fctCap);
    expect(before[0].auraCap).toBeLessThan(before[3].auraCap);
    expect(before[0].minimap).toBeGreaterThan(before[3].minimap);
  });
});
