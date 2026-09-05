// i18n source catalog - the GPU backend probe ("WoC config detector"), the
// desktop-only page that measures the three Windows graphics backends and
// records which one to launch. English values only; the locale translations
// live in src/ui/i18n.locales/<lang>.ts (the runtime-authoritative overlays),
// filled by the maintainer at release.
//
// Assembled into `en` by ./index.ts under the `probe` namespace. Kept as its own
// module in the hud_chrome.ts shape (no per-locale blocks) so a new probe key is
// an English-only add that compiles.

export const probeStrings = {
  // The product name: identical in every language, like "World of ClaudeCraft"
  // itself (BRAND_ALLOW in tests/i18n_completeness.test.ts).
  title: 'WoC config detector',
};
