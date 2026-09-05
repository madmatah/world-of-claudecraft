// Public surface of the GPU backend probe ("WoC config detector"), the
// desktop-only page that measures the Windows graphics backends. See CLAUDE.md
// beside this file for the subsystem's layout and rules.

export { type MountBackendProbeOptions, mountBackendProbe } from './probe_page';
export { PROBE_VIEWS, type ProbeView, probeViewFromSearch } from './probe_view_core';
