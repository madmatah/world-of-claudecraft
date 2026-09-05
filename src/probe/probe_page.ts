// The thin DOM host of the probe entry: reads the view off the URL, localizes
// the document, and mounts the matching view into the root element. Every
// decision lives in a DOM-free core beside it (probe_view_core.ts for the
// switch, probe_views_core.ts for the text); this file only touches the
// document. Outside the shell (a plain browser, the step-1 harness) the
// consent's Start navigates to the measuring view, the measuring view
// publishes its result on a global and a <pre> a driver reads, and the
// verdict view reads a decision the driver injected; the shell replaces
// those three seams with its bridge in step 2.

import { formatNumber, t as translate } from '../ui/i18n';
import { type ProbeResult, type ProbeSink, runProbe } from './probe_run';
import { type ProbeView, probeViewFromSearch } from './probe_view_core';
import {
  type BackendClass,
  consentModel,
  estimateMinutes,
  progressLine,
  type Translate,
  verdictModel,
} from './probe_views_core';

/** The runtime's `t` behind the cores' string-keyed seam: every key the
 *  cores ask for is a `probe.*` leaf, which the catalog's key union pins. */
const t: Translate = (key, params) => translate(key as Parameters<typeof translate>[0], params);

export interface MountBackendProbeOptions {
  search?: string;
}

/** The sections the measuring view counts down. */
const SECTION_TOTAL = 6;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function card(inner: string, view: ProbeView): string {
  return (
    `<section class="probe-card" data-probe-view="${view}">` +
    `<h1>${escapeHtml(t('probe.title'))}</h1>${inner}</section>`
  );
}

function renderConsent(root: HTMLElement, search: string): void {
  const model = consentModel(t, formatNumber(estimateMinutes(3)));
  root.innerHTML = card(
    `<h2>${escapeHtml(model.heading)}</h2>` +
      `<p>${escapeHtml(model.body)}</p>` +
      `<p><button type="button" data-probe-start>${escapeHtml(model.start)}</button> ` +
      `<button type="button" data-probe-cancel>${escapeHtml(model.cancel)}</button></p>`,
    'consent',
  );
  root.querySelector('[data-probe-start]')?.addEventListener('click', () => {
    const params = new URLSearchParams(search);
    params.set('view', 'probe');
    location.search = `?${params.toString()}`;
  });
  root.querySelector('[data-probe-cancel]')?.addEventListener('click', () => {
    window.close();
  });
}

function statusOf(result: ProbeResult): string {
  switch (result.ended) {
    case 'no-webgl2':
      return t('probe.status.noWebgl2');
    case 'software':
      return t('probe.status.software');
    case 'no-corpus':
      return t('probe.status.noCorpus');
    case 'busy':
      return t('probe.progress.busy');
    default:
      return progressLine(t, {
        backend: (result.identity?.backend as BackendClass | undefined) ?? null,
        parallelCompile: result.identity?.parallelCompile === true,
        done: Object.keys(result.sections).length,
        total: SECTION_TOTAL,
        busy: false,
      });
  }
}

/** The measuring view's sink outside the shell: the page's own global and a
 *  `<pre>` a driver script can read (the shell's bridge replaces it). */
function pageSink(root: HTMLElement, status: HTMLElement): ProbeSink {
  const pre = document.createElement('pre');
  pre.dataset.probeResult = '';
  pre.hidden = true;
  root.append(pre);
  return {
    post(result: ProbeResult) {
      (globalThis as { __probeResult?: ProbeResult }).__probeResult = result;
      pre.textContent = JSON.stringify(result);
      status.textContent = statusOf(result);
    },
  };
}

function renderProbe(root: HTMLElement, search: string): void {
  const params = new URLSearchParams(search);
  root.innerHTML = card(
    `<p data-probe-status>${escapeHtml(t('probe.progress.waiting'))}</p>`,
    'probe',
  );
  const status = root.querySelector<HTMLElement>('[data-probe-status]') as HTMLElement;
  const sink = pageSink(root, status);
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

function renderProgress(root: HTMLElement, search: string): void {
  const params = new URLSearchParams(search);
  const line = progressLine(t, {
    backend: (params.get('backend') as BackendClass | null) ?? null,
    parallelCompile: params.get('parallel') === '1',
    done: Number(params.get('done') ?? '0') || 0,
    total: SECTION_TOTAL,
    busy: params.get('busy') === '1',
  });
  root.innerHTML = card(`<p data-probe-status>${escapeHtml(line)}</p>`, 'progress');
}

/** What the verdict view reads: injected by the driver or the shell. */
export interface ProbeDecisionView {
  backend: BackendClass | null;
  parallelCompile: boolean;
  worker: boolean;
  inconclusive: boolean;
  explicitSetting: boolean;
}

function renderVerdict(root: HTMLElement): void {
  const injected = (globalThis as { __probeDecision?: ProbeDecisionView }).__probeDecision;
  const model = verdictModel(
    t,
    injected ?? {
      backend: null,
      parallelCompile: false,
      worker: false,
      inconclusive: true,
      explicitSetting: false,
    },
  );
  root.innerHTML = card(
    `<h2>${escapeHtml(model.heading)}</h2>` +
      (model.worker ? `<p>${escapeHtml(model.worker)}</p>` : '') +
      (model.note ? `<p>${escapeHtml(model.note)}</p>` : '') +
      `<p><button type="button" data-probe-play>${escapeHtml(model.play)}</button> ` +
      `<button type="button" data-probe-rerun>${escapeHtml(model.rerun)}</button>` +
      (model.switchToAuto
        ? ` <button type="button" data-probe-auto>${escapeHtml(model.switchToAuto)}</button>`
        : '') +
      `</p>`,
    'verdict',
  );
}

/** Mount the view for `search` into `root`; returns the view it mounted. */
export function mountBackendProbe(
  root: HTMLElement,
  options: MountBackendProbeOptions = {},
): ProbeView {
  const search = options.search ?? location.search;
  const view = probeViewFromSearch(search);
  root.dataset.view = view;
  switch (view) {
    case 'consent':
      renderConsent(root, search);
      break;
    case 'probe':
      renderProbe(root, search);
      break;
    case 'progress':
      renderProgress(root, search);
      break;
    case 'verdict':
      renderVerdict(root);
      break;
  }
  return view;
}
