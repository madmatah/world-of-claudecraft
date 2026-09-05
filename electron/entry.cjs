'use strict';

// The desktop shell's entry (package.json "main"): one decision, then the
// module that owns the mode. A GPU backend probe CHILD (electron/backend_probe_plan.cjs:
// one process per measured backend, spawned by the probe parent with its
// plan in the environment) never runs main.cjs at all: it would read the
// game's prefs, take the single-instance lock, start the crash dialog and
// the rescue on a profile that is not its own. Everything else, the game
// and the probe parent alike, is main.cjs. Kept to this one branch so
// main.cjs stays the module every startup pin scans.

const { isProbeChild } = require('./backend_probe_plan.cjs');

if (isProbeChild(process.env)) {
  require('./backend_probe_child.cjs').runBackendProbeChild();
} else {
  require('./main.cjs');
}
