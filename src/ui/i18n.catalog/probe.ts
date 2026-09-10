// i18n source catalog - the GPU backend probe ("WoC config detector"), the
// desktop-only page that measures the three Windows graphics backends and
// records which one to launch. English values only; the locale translations
// live in src/ui/i18n.locales/<lang>.ts (the runtime-authoritative overlays),
// filled by the maintainer at release (the wordy leaves carry their five
// non-Latin fills in the same change, M16).
//
// Assembled into `en` by ./index.ts under the `probe` namespace. Kept as its own
// module in the hud_chrome.ts shape (no per-locale blocks) so a new probe key is
// an English-only add that compiles.

export const probeStrings = {
  // The product name: identical in every language, like "World of ClaudeCraft"
  // itself (BRAND_ALLOW in tests/i18n_completeness.test.ts).
  title: 'WoC config detector',
  // The graphics API names stay as their vendors spell them (BRAND_ALLOW).
  backend: {
    d3d11: 'Direct3D 11',
    vulkanParallel: 'Vulkan (parallel shader compile)',
    vulkanPlain: 'Vulkan',
    opengl: 'OpenGL',
    metal: 'Metal',
    software: 'Software rendering',
    unknown: 'Unknown backend',
  },
  consent: {
    heading: 'Find the best graphics backend for this PC',
    body: 'The test opens and closes several windows on its own and takes about {minutes} minutes. Between two tests the screen can look empty for a few seconds: that is normal, nothing has crashed. Keep the game closed, plug a laptop in, and leave the computer alone until the result appears.',
    start: 'Start the test',
    cancel: 'Not now',
  },
  progress: {
    waiting: 'Preparing the test',
    arm: 'Testing {backend}, step {step} of {total}',
    // The player's one global bearing: which test of how many, shown beside
    // the step inside a test.
    overall: 'Test {index} of {total}',
    between: 'Test {done} of {total} finished. Starting the next one.',
    busy: 'The computer is busy with something else. Close other programs and run the test again.',
  },
  verdict: {
    heading: 'Recommended for this PC: {backend}',
    workerOn: 'Shader warm-up worker: on',
    workerOff: 'Shader warm-up worker: off',
    inconclusive: 'The test could not decide. Run it again with nothing else open.',
    explicitSetting:
      'Your graphics backend is set by hand, so this result is not applied until you switch that setting to Auto.',
    play: 'Play',
    rerun: 'Run the test again',
    switchToAuto: 'Switch the backend setting to Auto',
    // The way out of a full screen window: without it the verdict offers only
    // to play or to test again, and there is no third answer.
    close: 'Close',
  },
  status: {
    noWebgl2: 'This backend could not start on this computer.',
    software: 'This backend only renders in software here and cannot run the game.',
    noCorpus: 'The test data is missing from this build.',
    capped: 'This backend could not link the test shaders in time.',
  },
};
