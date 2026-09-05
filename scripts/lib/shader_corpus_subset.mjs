// The shipped shader corpus of the GPU backend probe: a curated subset of one
// session's recorded program set, in the format the probe page loads.
//
// A full ultra session records about 390 programs and 35 MB of GLSL; the probe
// links a dozen heavy ones per section (each pass salts them afresh, so twelve
// programs serve every section), draws with their depth twins in its shadow
// pass, and runs the post chain. So the subset keeps: the heaviest colour
// programs by source size, the heaviest depth twins, and every post-chain pass.
// Pure: the record in, the shipped object out; scripts/shader_corpus_record.mjs
// is the browser side and tests/shader_corpus_subset.test.ts pins the rules.

/** Bumped when the shipped shape changes; the probe refuses another format. */
export const PROBE_CORPUS_FORMAT = 1;

/** three's shadow-map twins: the depth material a mesh's colour program pairs with. */
export const DEPTH_TWIN_TYPES = Object.freeze(['MeshDepthMaterial', 'MeshDistanceMaterial']);

/** The post chain's programs, by the names the game gives them: its own passes
 *  through the shader's name, the third-party ones through post_pass_naming_core.ts. */
export const POST_PASS_NAME_PATTERN = /^(OutputGradeShader|ScreenFxShader|n8ao\.|bloom\.|smaa\.)/;

export const DEFAULT_HEAVY_COUNT = 16;
export const DEFAULT_TWIN_COUNT = 8;

export function programWeight(program) {
  return program.vertex.length + program.fragment.length;
}

function byWeightDesc(a, b) {
  return programWeight(b) - programWeight(a) || a.cacheKey.localeCompare(b.cacheKey);
}

function shipped(program) {
  return {
    type: program.type,
    name: program.name,
    cacheKey: program.cacheKey,
    index0Attribute: program.index0Attribute,
    vertex: program.vertex,
    fragment: program.fragment,
  };
}

/**
 * Select the subset: every post-chain pass, the `twinCount` heaviest depth
 * twins, and the `heavyCount` heaviest remaining programs. Programs are never
 * duplicated across the three groups; the output order is post chain, twins,
 * heavy, each by descending weight.
 */
export function selectProbeCorpus(programs, options = {}) {
  const heavyCount = options.heavyCount ?? DEFAULT_HEAVY_COUNT;
  const twinCount = options.twinCount ?? DEFAULT_TWIN_COUNT;
  const post = [];
  const twins = [];
  const rest = [];
  for (const program of programs) {
    if (POST_PASS_NAME_PATTERN.test(program.name)) post.push(program);
    else if (DEPTH_TWIN_TYPES.includes(program.type)) twins.push(program);
    else rest.push(program);
  }
  post.sort(byWeightDesc);
  twins.sort(byWeightDesc);
  rest.sort(byWeightDesc);
  return [...post, ...twins.slice(0, twinCount), ...rest.slice(0, heavyCount)].map(shipped);
}

/**
 * The shipped corpus object for one recorded session. `recordedFrom` is
 * informational (the recording machine's build id and adapter) and outside
 * the freshness hash, which keys on the GLSL producers alone.
 */
export function buildProbeCorpus(record, inputs) {
  return {
    format: PROBE_CORPUS_FORMAT,
    tier: record.tier,
    inputsHash: inputs.inputsHash,
    recordedAt: record.savedAt,
    recordedFrom: { buildId: inputs.buildId ?? '', adapter: inputs.adapter ?? '' },
    extensions: [...record.extensions],
    contextAttributes: record.contextAttributes,
    programs: selectProbeCorpus(record.programs, inputs),
  };
}

/** What a tier's corpus must carry: twelve saltable heavy programs on every
 *  tier; a depth twin and a post-chain program only where the tier renders
 *  shadows and a composer (the low tier draws neither). */
export function probeCorpusMinimums(tier) {
  const composed = tier === 'high' || tier === 'ultra' || tier === 'insane';
  return { heavy: 12, twins: composed ? 1 : 0, post: composed ? 1 : 0 };
}

/** The subset must carry enough saltable heavy programs for the link
 *  sections; reports what is missing, empty when the corpus is complete. */
export function probeCorpusShortfalls(corpus, minimums = {}) {
  const heavyMin = minimums.heavy ?? 12;
  const twinMin = minimums.twins ?? 1;
  const postMin = minimums.post ?? 1;
  const post = corpus.programs.filter((p) => POST_PASS_NAME_PATTERN.test(p.name)).length;
  const twins = corpus.programs.filter((p) => DEPTH_TWIN_TYPES.includes(p.type)).length;
  const heavy = corpus.programs.length - post - twins;
  const shortfalls = [];
  if (heavy < heavyMin) shortfalls.push(`heavy programs: ${heavy} of ${heavyMin}`);
  if (twins < twinMin) shortfalls.push(`depth twins: ${twins} of ${twinMin}`);
  if (post < postMin) shortfalls.push(`post-chain programs: ${post} of ${postMin}`);
  return shortfalls;
}
