// Price a candidate worn layer against the baseline with the link bench, on
// this machine's WebGL backend (Linux ANGLE OpenGL gives the ordering; Windows
// ANGLE D3D11 is the score). Both inputs are folders written by
// resolve_worn_glsl.mjs.
//   node scripts/shader_lab/bench_candidate.mjs --candidate tmp/candidate_glsl [--baseline scripts/shader_lab/baseline] [--reps 5] [--angle d3d11]
// Builds a two-sided corpus in <candidate>/link-corpus (one program per family x
// tier per side, named baseline:<family>:<tier> and candidate:<family>:<tier>),
// runs scripts/shader_link_bench.mjs on it, and prints the paired table.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { programHash, textHash } from '../lib/shader_harvest_corpus.mjs';

const args = { candidate: null, baseline: 'scripts/shader_lab/baseline', reps: 5, angle: null };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--candidate') args.candidate = process.argv[++i];
  else if (a === '--baseline') args.baseline = process.argv[++i];
  else if (a === '--reps') args.reps = Number(process.argv[++i]);
  else if (a === '--angle') args.angle = process.argv[++i];
}
if (!args.candidate) throw new Error('--candidate <dir> is required');

const context = JSON.parse(
  fs.readFileSync(path.resolve('scripts/shader_lab/world_context.json'), 'utf8'),
);
const corpusDir = path.resolve(args.candidate, 'link-corpus');
fs.rmSync(corpusDir, { recursive: true, force: true });
fs.mkdirSync(path.join(corpusDir, 'shaders'), { recursive: true });
const programs = [];
const shaders = new Map();
// Families that share a STRUCTURE compile byte-identical source (the layer
// carries its per-family scalars as uniforms), so the six AO families collapse
// to one program and metal stands alone. Each distinct text is benched once and
// named after every family it serves.
function addSide(side, dir) {
  const byText = new Map();
  for (const file of fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.frag.glsl'))
    .sort()) {
    const m = /^worn_(\w+)_(\w+)\.frag\.glsl$/.exec(file);
    if (!m) continue;
    const fragment = fs.readFileSync(path.join(dir, file), 'utf8');
    const vertex = fs.readFileSync(path.join(dir, file.replace('.frag.', '.vert.')), 'utf8');
    const hash = programHash(vertex, fragment, 'position');
    const entry = byText.get(hash) ?? { vertex, fragment, families: [], tier: m[2] };
    entry.families.push(m[1]);
    byText.set(hash, entry);
  }
  for (const [hash, e] of byText) {
    const vertexHash = textHash(e.vertex);
    const fragmentHash = textHash(e.fragment);
    shaders.set(`${vertexHash}.vert`, e.vertex);
    shaders.set(`${fragmentHash}.frag`, e.fragment);
    programs.push({
      hash,
      name: `${side}:${e.families.join('+')}:${e.tier}`,
      kind: 'standard',
      vertexHash,
      fragmentHash,
      index0: 'position',
      seen: {},
    });
  }
}
addSide('baseline', path.resolve(args.baseline));
addSide('candidate', path.resolve(args.candidate));
for (const [key, text] of shaders)
  fs.writeFileSync(path.join(corpusDir, 'shaders', `${key}.glsl`), text);
fs.writeFileSync(
  path.join(corpusDir, 'corpus.json'),
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      runs: [{ profile: 'lab', contexts: [{ id: 0, webgl2: true, ...context }] }],
      programCount: programs.length,
      shaderCount: shaders.size,
      programs,
      shaders: [...shaders.keys()].map((k) => ({ hash: k.split('.')[0], stage: k.split('.')[1] })),
    },
    null,
    1,
  ),
);
const outDir = path.join(corpusDir, 'bench');
const r = spawnSync(
  'node',
  [
    'scripts/shader_link_bench.mjs',
    '--corpus',
    corpusDir,
    '--reps',
    String(args.reps),
    '--out',
    outDir,
    ...(args.angle ? ['--angle', args.angle] : []),
  ],
  {
    stdio: 'inherit',
    // The GPU driver's own on-disk shader cache serves a warm binary in a few
    // ms for any text compiled before (the salt comment does not change the
    // compiled bytecode); off, so every link is the cold compile a new player
    // pays. NVIDIA and Mesa variables; harmless elsewhere.
    env: { ...process.env, __GL_SHADER_DISK_CACHE: '0', MESA_SHADER_CACHE_DISABLE: 'true' },
  },
);
if (r.status !== 0) process.exit(r.status ?? 1);
const results = JSON.parse(fs.readFileSync(path.join(outDir, 'results.json'), 'utf8'));
const rows = results.results;
const byName = new Map();
for (const row of rows) byName.set(row.name, row);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};
console.log(`\nbackend: ${results.machine?.renderer ?? '?'}`);
console.log(
  'families                                  tier    baseline ms  candidate ms  saved ms',
);
for (const [name, row] of byName) {
  if (!name.startsWith('baseline:')) continue;
  const cand = byName.get(name.replace('baseline:', 'candidate:'));
  // Repetitions after the first: the backend compile alone (the first may hit
  // the driver cache differently), the same reading the bench report uses.
  const cost = (x) => (x ? median((x.runs ?? []).slice(1).map((t) => t.ms)) : NaN);
  const b = cost(row);
  const c = cost(cand);
  const [, families, tier] = name.split(':');
  console.log(
    `${families.padEnd(41)} ${tier.padEnd(7)} ${b.toFixed(1).padStart(11)}  ${c.toFixed(1).padStart(12)}  ${(b - c).toFixed(1).padStart(8)}`,
  );
}
