// The text of the probe's views, host-agnostic: the consent screen, the
// progress line, the verdict. Every string is a `t()` key of the `probe.*`
// domain; `t` is injected so this core never imports the i18n runtime. The
// views' DOM lives in probe_page.ts.

export type Translate = (key: string, params?: Record<string, string | number>) => string;

export type BackendClass = 'd3d11' | 'vulkan' | 'opengl' | 'metal' | 'software' | 'unknown';

/** The design target per arm plus the boots, in minutes, rounded up. */
export function estimateMinutes(arms: number, secondsPerArm = 25, bootSeconds = 5): number {
  return Math.max(1, Math.ceil((arms * (secondsPerArm + bootSeconds)) / 60));
}

export function backendLabel(
  t: Translate,
  backend: BackendClass,
  parallelCompile: boolean,
): string {
  switch (backend) {
    case 'd3d11':
      return t('probe.backend.d3d11');
    case 'vulkan':
      return parallelCompile ? t('probe.backend.vulkanParallel') : t('probe.backend.vulkanPlain');
    case 'opengl':
      return t('probe.backend.opengl');
    case 'metal':
      return t('probe.backend.metal');
    case 'software':
      return t('probe.backend.software');
    default:
      return t('probe.backend.unknown');
  }
}

export interface ConsentModel {
  heading: string;
  body: string;
  start: string;
  cancel: string;
}

export function consentModel(t: Translate, minutes: string | number): ConsentModel {
  return {
    heading: t('probe.consent.heading'),
    body: t('probe.consent.body', { minutes }),
    start: t('probe.consent.start'),
    cancel: t('probe.consent.cancel'),
  };
}

export interface ProgressInput {
  backend: BackendClass | null;
  parallelCompile: boolean;
  /** Sections finished so far. */
  done: number;
  total: number;
  busy: boolean;
}

/** A number formatter the page injects (formatNumber); the core stays i18n-free. */
export type FormatNumber = (value: number) => string;

export function progressLine(
  t: Translate,
  input: ProgressInput,
  format: FormatNumber = String,
): string {
  if (input.busy) return t('probe.progress.busy');
  if (input.backend === null) return t('probe.progress.waiting');
  return t('probe.progress.arm', {
    backend: backendLabel(t, input.backend, input.parallelCompile),
    step: format(Math.min(input.total, input.done + 1)),
    total: format(input.total),
  });
}

export interface VerdictInput {
  backend: BackendClass | null;
  parallelCompile: boolean;
  worker: boolean;
  inconclusive: boolean;
  explicitSetting: boolean;
}

export interface VerdictModel {
  heading: string;
  worker: string;
  note: string | null;
  play: string;
  rerun: string;
  switchToAuto: string | null;
}

export function verdictModel(t: Translate, input: VerdictInput): VerdictModel {
  const decided = !input.inconclusive && input.backend !== null;
  return {
    heading: decided
      ? t('probe.verdict.heading', {
          backend: backendLabel(t, input.backend as BackendClass, input.parallelCompile),
        })
      : t('probe.verdict.inconclusive'),
    worker: decided
      ? input.worker
        ? t('probe.verdict.workerOn')
        : t('probe.verdict.workerOff')
      : '',
    note: decided && input.explicitSetting ? t('probe.verdict.explicitSetting') : null,
    play: t('probe.verdict.play'),
    rerun: t('probe.verdict.rerun'),
    switchToAuto: decided && input.explicitSetting ? t('probe.verdict.switchToAuto') : null,
  };
}

/** The verdict view's backend reading of a decision rung: the class the
 *  labels know and whether it is the parallel-compile Vulkan rung. */
export function rungView(rung: string | null): {
  backend: BackendClass | null;
  parallelCompile: boolean;
} {
  switch (rung) {
    case 'd3d11':
      return { backend: 'd3d11', parallelCompile: false };
    case 'vulkan-parallel-compile':
      return { backend: 'vulkan', parallelCompile: true };
    case 'vulkan-plain':
      return { backend: 'vulkan', parallelCompile: false };
    case 'opengl':
      return { backend: 'opengl', parallelCompile: false };
    default:
      return { backend: null, parallelCompile: false };
  }
}
