export declare const SHADER_PRODUCER_PATTERN: RegExp;
export declare const SHADER_PRODUCER_ROOT: string;
export declare function listShaderProducers(repoRoot: string): string[];
export declare function threeVersion(repoRoot: string): string;
export declare function listThreePatches(repoRoot: string): string[];
export declare function normalizeProducerText(text: string): string;
export declare function hashShaderCorpusInputs(repoRoot: string): string;
