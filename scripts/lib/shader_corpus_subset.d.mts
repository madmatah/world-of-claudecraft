export interface RecordedProgram {
  vertex: string;
  fragment: string;
  index0Attribute: string;
  type: string;
  name: string;
  cacheKey: string;
}

export interface ShippedProgram {
  type: string;
  name: string;
  cacheKey: string;
  index0Attribute: string;
  vertex: string;
  fragment: string;
}

export interface RecordedCorpus {
  tier: string;
  savedAt: number;
  extensions: readonly string[];
  contextAttributes: Record<string, unknown> | null;
  programs: readonly RecordedProgram[];
}

export interface ProbeCorpus {
  format: number;
  tier: string;
  inputsHash: string;
  recordedAt: number;
  recordedFrom: { buildId: string; adapter: string };
  extensions: string[];
  contextAttributes: Record<string, unknown> | null;
  programs: ShippedProgram[];
}

export interface SelectOptions {
  heavyCount?: number;
  twinCount?: number;
}

export declare const PROBE_CORPUS_FORMAT: number;
export declare const DEPTH_TWIN_TYPES: readonly string[];
export declare const POST_PASS_NAME_PATTERN: RegExp;
export declare const DEFAULT_HEAVY_COUNT: number;
export declare const DEFAULT_TWIN_COUNT: number;
export declare function programWeight(program: { vertex: string; fragment: string }): number;
export declare function selectProbeCorpus(
  programs: readonly RecordedProgram[],
  options?: SelectOptions,
): ShippedProgram[];
export declare function buildProbeCorpus(
  record: RecordedCorpus,
  inputs: SelectOptions & { inputsHash: string; buildId?: string; adapter?: string },
): ProbeCorpus;
export declare function probeCorpusMinimums(tier: string): {
  heavy: number;
  twins: number;
  post: number;
};
export declare function probeCorpusShortfalls(
  corpus: { programs: readonly { type: string; name: string }[] },
  minimums?: { heavy?: number; twins?: number; post?: number },
): string[];
