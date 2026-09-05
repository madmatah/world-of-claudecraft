// The thin DOM host of the probe entry: reads the view off the URL, localizes
// the document, and mounts the matching view into the root element. Every
// decision lives in a DOM-free core beside it (probe_view_core.ts for the
// switch, probe_views_core.ts for the text); this file only touches the
// document. Outside the shell (a plain browser, the step-1 harness) the
// consent's Start navigates to the measuring view, the measuring view
// publishes its result on a global and a <pre> a driver reads, and the
// verdict view reads a decision the driver injected; the shell replaces
// those three seams with its bridge in step 2.

import { type DesktopProbeProgress, desktopBridge } from '../runtime';
import { formatNumber, getLanguage, t as translate } from '../ui/i18n';
import { type ArmInput, type ArmRung, decide, PROVISIONAL_FLOORS } from './decision_core';
import { createInterferenceMonitor } from './interference';
import { type ProbeResult, type ProbeSink, runProbe } from './probe_run';
import { presetFromSettingsJson, tierFromPreset } from './probe_tier_core';
import { type ProbeView, probeViewFromSearch } from './probe_view_core';
import {
  type BackendClass,
  consentModel,
  estimateMinutes,
  progressLine,
  rungView,
  type Translate,
  verdictModel,
} from './probe_views_core';
import {
  actInShell,
  bindWindowState,
  createShellSink,
  postVerdictInShell,
  readResultsInShell,
  reportEnded,
  startInShell,
  subscribeProgress,
} from './shell_bridge';

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
  const bridge = desktopBridge();
  root.querySelector('[data-probe-start]')?.addEventListener('click', () => {
    if (bridge?.probeStart) {
      // The parent main has no access to renderer storage: the locale and
      // the graphics preset travel with the start.
      void startInShell(bridge, {
        locale: getLanguage(),
        tier: tierFromPreset(presetFromSettingsJson(storedSettingsJson())),
      });
      return;
    }
    const params = new URLSearchParams(search);
    params.set('view', 'probe');
    location.search = `?${params.toString()}`;
  });
  root.querySelector('[data-probe-cancel]')?.addEventListener('click', () => {
    if (bridge?.probeAction) {
      void actInShell(bridge, 'cancel');
      return;
    }
    window.close();
  });
}

function storedSettingsJson(): string | null {
  try {
    return localStorage.getItem('woc_settings');
  } catch {
    return null;
  }
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
  // Inside a probe child the shell hears every post and the window's state
  // feeds the monitor; in a plain browser both are no-ops over a null bridge.
  const bridge = desktopBridge();
  const monitor = createInterferenceMonitor();
  const unbindWindowState = bindWindowState(bridge, monitor);
  const shell = createShellSink(bridge, pageSink(root, status));
  void runProbe({
    run: params.get('run') ?? `page-${Date.now().toString(36)}`,
    round: Number(params.get('round') ?? '1') || 1,
    tier: params.get('tier') ?? 'ultra',
    sink: shell.sink,
    monitor,
    host: root,
  }).then((result) => {
    shell.dispose();
    unbindWindowState();
    monitor.dispose();
    root.dataset.probeEnded = result.ended;
    reportEnded(bridge, result.ended);
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
  const status = root.querySelector<HTMLElement>('[data-probe-status]') as HTMLElement;
  // In the parent's window the line follows the shell's pushes: the arm in
  // flight (the parent counts arms, the child counts its own sections).
  subscribeProgress(desktopBridge(), (progress: DesktopProbeProgress) => {
    if (progress.phase === 'deciding') {
      status.textContent = t('probe.progress.waiting');
      return;
    }
    const view = rungView(progress.arm ?? null);
    status.textContent = progressLine(t, {
      backend: view.backend,
      parallelCompile: view.parallelCompile,
      done: (progress.index ?? 0) + 1,
      total: progress.total ?? 0,
      busy: false,
    });
  });
}

/** What the verdict view reads: injected by the driver or the shell. */
export interface ProbeDecisionView {
  backend: BackendClass | null;
  parallelCompile: boolean;
  worker: boolean;
  inconclusive: boolean;
  explicitSetting: boolean;
}

function paintVerdict(root: HTMLElement, input: ProbeDecisionView): void {
  const model = verdictModel(t, input);
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
  const bridge = desktopBridge();
  const wire = (selector: string, action: 'play' | 'rerun' | 'auto') => {
    root.querySelector(selector)?.addEventListener('click', () => {
      if (action === 'rerun' && bridge?.probeStart) {
        void startInShell(bridge, {
          locale: getLanguage(),
          tier: tierFromPreset(presetFromSettingsJson(storedSettingsJson())),
        });
        return;
      }
      if (action === 'auto') {
        void actInShell(bridge, 'auto').then((done) => {
          if (done) paintVerdict(root, { ...input, explicitSetting: false });
        });
        return;
      }
      void actInShell(bridge, action);
    });
  };
  wire('[data-probe-play]', 'play');
  wire('[data-probe-rerun]', 'rerun');
  wire('[data-probe-auto]', 'auto');
}

const INCONCLUSIVE_VIEW: ProbeDecisionView = {
  backend: null,
  parallelCompile: false,
  worker: false,
  inconclusive: true,
  explicitSetting: false,
};

/**
 * The verdict view. In the parent's window it reads what the parent has:
 * the rounds to DECIDE over (the decision core is the page's; the decision
 * goes back over the bridge and the parent runs a second round or shows the
 * result), or the parent's FINAL answer to paint. Outside the shell it
 * paints a decision the driver injected.
 */
function renderVerdict(root: HTMLElement): void {
  const bridge = desktopBridge();
  if (!bridge?.probeResults) {
    const injected = (globalThis as { __probeDecision?: ProbeDecisionView }).__probeDecision;
    paintVerdict(root, injected ?? INCONCLUSIVE_VIEW);
    return;
  }
  root.innerHTML = card(
    `<p data-probe-status>${escapeHtml(t('probe.progress.waiting'))}</p>`,
    'verdict',
  );
  void readResultsInShell(bridge).then((results) => {
    if (!results) {
      paintVerdict(root, INCONCLUSIVE_VIEW);
      return;
    }
    if (results.phase === 'decide') {
      const arms = results.arms as ArmInput[];
      const decision = decide(arms, {
        round: results.round,
        // Fixed floors exist for x64 only; ARM64 decides on the relative rules.
        floors: results.arm64 ? null : PROVISIONAL_FLOORS,
      });
      const winner = decision.arms.find((arm) => arm.rung === decision.backend);
      const winnerResult = arms.find((arm) => arm.rung === decision.backend)?.results.at(-1);
      void postVerdictInShell(bridge, {
        ...decision,
        backendClass: winnerResult?.identity?.backend ?? 'unknown',
        figures: winner?.figures ?? undefined,
      });
      return;
    }
    const decision = results.decision as { backend: ArmRung | null; worker: boolean } | null;
    const view = rungView(decision?.backend ?? null);
    paintVerdict(root, {
      backend: results.inconclusive === null ? view.backend : null,
      parallelCompile: view.parallelCompile,
      worker: decision?.worker === true,
      inconclusive: results.inconclusive !== null || decision?.backend == null,
      explicitSetting: results.explicitSetting,
    });
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
