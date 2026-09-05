// Decide from the JSON results scripts/backend_probe_run.mjs wrote: the
// latest run per backend under tmp/backend-probe/ becomes one arm, and the
// probe's own decision core (src/probe/decision_core.ts, bundled here the way
// export_loot_spreadsheet.mjs bundles the sim) says which backend and
// whether the worker is worth it. The calibration readout of step 1: what
// the shell will compute in step 2, run by hand over a Linux or Windows matrix.
//
//   node scripts/backend_probe_decide.mjs [--dir tmp/backend-probe] [--round 1]
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(repoRoot, arg('--dir', 'tmp/backend-probe'));
const round = Number(arg('--round', '1'));

/** The driver's run prefixes to the shell's rung literals. */
const RUNGS = {
  d3d11: 'd3d11',
  'vulkan-par': 'vulkan-parallel-compile',
  vulkan: 'vulkan-plain',
  'gl-egl': 'opengl',
  gl: 'opengl',
};

const build = await esbuild.build({
  stdin: {
    contents: "export { decide, armFigures } from './src/probe/decision_core.ts';",
    resolveDir: repoRoot,
    sourcefile: 'probe-decide-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const { decide } = await import(
  `data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`
);

const latest = new Map();
for (const name of readdirSync(dir)
  .filter((n) => n.endsWith('.json'))
  .sort()) {
  const prefix = Object.keys(RUNGS)
    .sort((a, b) => b.length - a.length)
    .find((p) => name.startsWith(`${p}-`));
  if (!prefix) continue;
  latest.set(RUNGS[prefix], name);
}
const arms = [...latest.entries()].map(([rung, name]) => {
  const result = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
  return { rung, results: [result], roundsLaunched: 1, roundsDied: 0, adapter: '' };
});
if (arms.length === 0) {
  console.error(`no results under ${dir}`);
  process.exit(1);
}
const decision = decide(arms, { round });
for (const arm of decision.arms) {
  const f = arm.figures;
  console.log(
    `${arm.rung.padEnd(24)} ${arm.disqualified ? `OUT (${arm.disqualified})` : ''}` +
      (f
        ? `worst ${f.worstFrameUnderLinksMs.toFixed(0)} lost ${f.lostUnderLinksMs.toFixed(0)} ` +
          `cold ${f.coldLinkMs.toFixed(0)} hit ${f.hitLinkMs.toFixed(1)} profile ${f.linkProfileMs.toFixed(0)} ` +
          `upload ${f.uploadMaxFrameMs.toFixed(0)} frameP95 ${f.frameP95Ms.toFixed(1)} ` +
          `cadence ${(f.pacingOnCadence * 100).toFixed(0)}% worker ${f.workerWorthIt ? 'on' : 'off'} ` +
          `spread ${(f.spread * 100).toFixed(1)}%${f.capped ? ' CAPPED' : ''}`
        : ''),
  );
}
console.log(
  `verdict: backend=${decision.backend ?? 'none'} worker=${decision.worker} reference=${decision.reference} ` +
    `margin=${(decision.margin * 100).toFixed(0)}%` +
    (decision.inconclusive ? ` INCONCLUSIVE (${decision.inconclusive})` : '') +
    (decision.secondRoundTriggers.length
      ? ` round2: ${decision.secondRoundTriggers.join('; ')}`
      : ''),
);
