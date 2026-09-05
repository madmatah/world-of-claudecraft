// The thin DOM host of the probe entry: reads the view off the URL, localizes
// the document, and mounts the matching view into the root element. Every
// decision lives in a DOM-free core beside it (probe_view_core.ts and the
// section cores); this file only touches the document.

import { t } from '../ui/i18n';
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

/** Mount the view for `search` into `root`; returns the view it mounted. */
export function mountBackendProbe(
  root: HTMLElement,
  options: MountBackendProbeOptions = {},
): ProbeView {
  const view = probeViewFromSearch(options.search ?? location.search);
  root.dataset.view = view;
  root.innerHTML =
    `<section class="probe-card" data-probe-view="${view}">` +
    `<h1>${escapeHtml(t('probe.title'))}</h1>` +
    `</section>`;
  return view;
}
