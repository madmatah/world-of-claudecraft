// The aura tooltip's effect line, rendered exactly the way Hud.auraEffectTooltipHtml
// renders it (minus the wrapping div and the HTML escape): the pure descriptor,
// every number through formatNumber at the descriptor's own fraction digits, then
// t() in the current language. A suite that proves a tooltip against the live
// mechanic compares this string with the numbers the sim actually applied.

import {
  type AuraEffectInput,
  auraEffectDescriptor,
  auraEffectMaximumFractionDigits,
} from '../../src/ui/aura_effect';
import { formatNumber, type TranslationKey, t } from '../../src/ui/i18n';

export function renderAuraEffectLine(aura: AuraEffectInput): string {
  const effect = auraEffectDescriptor(aura);
  if (!effect) return '';
  const values: Record<string, string> = {};
  for (const [key, n] of Object.entries(effect.nums ?? {})) {
    values[key] = formatNumber(n, { maximumFractionDigits: auraEffectMaximumFractionDigits(n) });
  }
  return t(effect.key as TranslationKey, values);
}
