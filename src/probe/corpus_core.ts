// The shipped shader corpus as the probe reads it: the format the regen
// script writes (scripts/lib/shader_corpus_subset.mjs, PROBE_CORPUS_FORMAT),
// validated field by field (the bytes come off a bundled asset, but a bound
// is a bound), and the tier choice: the child receives the game's stored
// tier and takes the nearest corpus the bundle ships.

export const PROBE_CORPUS_FORMAT = 1;

export const CORPUS_TIER_ORDER = ['low', 'medium', 'high', 'ultra', 'insane'] as const;
export type CorpusTier = (typeof CORPUS_TIER_ORDER)[number];

export interface ProbeProgram {
  type: string;
  name: string;
  cacheKey: string;
  index0Attribute: string;
  vertex: string;
  fragment: string;
}

export interface ProbeCorpus {
  format: number;
  tier: string;
  inputsHash: string;
  recordedAt: number;
  recordedFrom: { buildId: string; adapter: string };
  extensions: string[];
  contextAttributes: Record<string, unknown> | null;
  programs: ProbeProgram[];
}

const LABEL_LIMIT = 256;
const PROGRAM_LIMIT = 256;
const SOURCE_LIMIT = 2 * 1024 * 1024;
const EXTENSION_LIMIT = 64;

function isLabel(value: unknown, limit = LABEL_LIMIT): value is string {
  return typeof value === 'string' && value.length <= limit;
}

/** Whatever the bundle holds is checked before a single program is linked. */
export function isProbeCorpus(value: unknown): value is ProbeCorpus {
  if (typeof value !== 'object' || value === null) return false;
  const corpus = value as Partial<ProbeCorpus>;
  if (corpus.format !== PROBE_CORPUS_FORMAT) return false;
  if (!isLabel(corpus.tier) || !isLabel(corpus.inputsHash)) return false;
  if (typeof corpus.recordedAt !== 'number' || !Number.isFinite(corpus.recordedAt)) return false;
  if (typeof corpus.recordedFrom !== 'object' || corpus.recordedFrom === null) return false;
  if (!isLabel(corpus.recordedFrom.buildId) || !isLabel(corpus.recordedFrom.adapter)) return false;
  if (!Array.isArray(corpus.extensions) || corpus.extensions.length > EXTENSION_LIMIT) return false;
  if (!corpus.extensions.every((name) => isLabel(name))) return false;
  if (corpus.contextAttributes !== null && typeof corpus.contextAttributes !== 'object') {
    return false;
  }
  if (!Array.isArray(corpus.programs) || corpus.programs.length > PROGRAM_LIMIT) return false;
  for (const program of corpus.programs) {
    if (typeof program !== 'object' || program === null) return false;
    const p = program as Partial<ProbeProgram>;
    if (!isLabel(p.type) || !isLabel(p.name) || !isLabel(p.cacheKey)) return false;
    if (!isLabel(p.index0Attribute)) return false;
    if (!isLabel(p.vertex, SOURCE_LIMIT) || !isLabel(p.fragment, SOURCE_LIMIT)) return false;
    if (p.vertex.length === 0 || p.fragment.length === 0) return false;
  }
  return true;
}

/** The tier whose corpus to load: the wanted tier when shipped, else the
 *  nearest shipped tier by preset order (ties go downward, the cheaper set). */
export function nearestCorpusTier(wanted: string, shipped: readonly string[]): CorpusTier | null {
  const order = CORPUS_TIER_ORDER as readonly string[];
  const available = shipped.filter((tier) => order.includes(tier));
  if (available.length === 0) return null;
  if (available.includes(wanted)) return wanted as CorpusTier;
  const at = order.indexOf(wanted);
  if (at < 0) return available.sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] as CorpusTier;
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const tier of available) {
    const distance = Math.abs(order.indexOf(tier) - at);
    const below = order.indexOf(tier) < at;
    if (distance < bestDistance || (distance === bestDistance && below)) {
      best = tier;
      bestDistance = distance;
    }
  }
  return best as CorpusTier;
}

export const DEPTH_TWIN_TYPES: readonly string[] = ['MeshDepthMaterial', 'MeshDistanceMaterial'];
export const POST_PASS_NAME_PATTERN = /^(OutputGradeShader|ScreenFxShader|n8ao\.|bloom\.|smaa\.)/;

export type ProbeProgramRole = 'heavy' | 'twin' | 'post';

export function programRole(program: Pick<ProbeProgram, 'type' | 'name'>): ProbeProgramRole {
  if (POST_PASS_NAME_PATTERN.test(program.name)) return 'post';
  if (DEPTH_TWIN_TYPES.includes(program.type)) return 'twin';
  return 'heavy';
}

/** The heavy programs by descending source size: the link sections' set. */
export function heavyPrograms(corpus: ProbeCorpus): ProbeProgram[] {
  return corpus.programs
    .filter((program) => programRole(program) === 'heavy')
    .sort((a, b) => b.vertex.length + b.fragment.length - (a.vertex.length + a.fragment.length));
}
