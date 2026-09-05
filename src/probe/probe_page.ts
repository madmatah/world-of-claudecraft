// The thin DOM host of the probe entry: reads the view off the URL, localizes
// the document, and mounts the matching view into the root element. Every
// decision lives in a DOM-free core beside it (probe_view_core.ts and the
// section cores); this file only touches the document.

import { t } from '../ui/i18n';
import { type ProbeResult, type ProbeSink, runProbe } from './probe_run';
import { type ProbeView, probeViewFromSearch } from './probe_view_core';

export interface MountBackendProbeOptions {
  search?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/** The measuring view's sink outside the shell: the page's own global and a
 *  `<pre>` a driver script can read (the shell's bridge replaces it). */
function pageSink(root: HTMLElement): ProbeSink {
  const pre = document.createElement('pre');
  pre.dataset.probeResult = '';
  root.append(pre);
  return {
    post(result: ProbeResult) {
      (globalThis as { __probeResult?: ProbeResult }).__probeResult = result;
      pre.textContent = JSON.stringify(result);
    },
  };
}

function startMeasuring(root: HTMLElement, search: string): void {
  const params = new URLSearchParams(search);
  const sink = pageSink(root);
  void runProbe({
    run: params.get('run') ?? `page-${Date.now().toString(36)}`,
    round: Number(params.get('round') ?? '1') || 1,
    tier: params.get('tier') ?? 'ultra',
    sink,
    host: root,
  }).then((result) => {
    root.dataset.probeEnded = result.ended;
  });
}

/** Mount the view for `search` into `root`; returns the view it mounted. */
export function mountBackendProbe(
  root: HTMLElement,
  options: MountBackendProbeOptions = {},
): ProbeView {
  const search = options.search ?? location.search;
  const view = probeViewFromSearch(search);
  root.dataset.view = view;
  root.innerHTML =
    `<section class="probe-card" data-probe-view="${view}">` +
    `<h1>${escapeHtml(t('probe.title'))}</h1>` +
    `</section>`;
  if (view === 'probe') startMeasuring(root, search);
  return view;
}
