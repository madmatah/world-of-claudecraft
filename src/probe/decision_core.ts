// The decision: which backend to launch and whether the warm worker is worth
// it, from the arms' results. Host-agnostic, the rule of
// tmp/DESIGN_backend-probe.md ("Decision rule") made code:
//
//   1. disqualify: did not bind, software rasterizer, died in both rounds,
//      adapter differs from the reference arm, checksum grossly wrong, a
//      critical capability missing
//   2. the reference is D3D11 when it survives; else the survivors rank
//      against each other and a tie goes to Vulkan (parallel-compile first)
//   3. another backend replaces the reference only if, on the HITCH metrics,
//      it is not worse beyond tolerance on any and better by the margin on
//      at least one, AND not worse beyond tolerance on the game-shaped frame,
//      AND not worse beyond tolerance on presentation pacing
//   4. inside the margin: round two, then the reference
//   margin and tolerance = max(fixed floor per metric, twice the largest
//   spread between passes seen on any arm); without a fixed floor (ARM64,
//   unknown architecture) a relative minimum stands in
//
// The link profile of an arm is what would ship on it: the worker-assisted
// profile when its own worker verdict is decisive, the raw cold cost
// otherwise. The fixed floors here are PROVISIONAL until the RTX 3060 and
// Intel calibration runs of step 1 replace them.

import type { ProbeResult } from './probe_run';
import { passVerdict, relativeSpread } from './stats_core';
import { workerWorthIt } from './worker_section_core';

export type ArmRung = 'd3d11' | 'vulkan-parallel-compile' | 'vulkan-plain' | 'opengl';

export const ARM_ORDER: readonly ArmRung[] = [
  'd3d11',
  'vulkan-parallel-compile',
  'vulkan-plain',
  'opengl',
];

export interface ArmInput {
  rung: ArmRung;
  /** The rounds' results, in order; a round that died has no result. */
  results: ProbeResult[];
  /** Rounds launched, died or not. */
  roundsLaunched: number;
  roundsDied: number;
  /** The adapter key the shell latched for this arm ('' when unknown). */
  adapter: string;
}

/** One arm's figures, each the mean over its valid passes, lower is better
 *  unless stated. */
export interface ArmFigures {
  worstFrameUnderLinksMs: number;
  lostUnderLinksMs: number;
  coldLinkMs: number;
  hitLinkMs: number;
  linkProfileMs: number;
  uploadMaxFrameMs: number;
  frameP95Ms: number;
  /** Higher is better. */
  pacingOnCadence: number;
  workerWorthIt: boolean;
  workerLostMs: number;
  /** The largest relative spread between passes over the figures above. */
  spread: number;
  /** Sections with a single valid pass. */
  singlePassSections: string[];
  /** Sections with no valid pass. */
  neutralSections: string[];
  capped: boolean;
}

export type Disqualification =
  | 'did-not-bind'
  | 'software'
  | 'died'
  | 'adapter-differs'
  | 'checksum'
  | 'capability'
  | 'no-result';

export interface ArmVerdict {
  rung: ArmRung;
  disqualified: Disqualification | null;
  figures: ArmFigures | null;
}

export interface DecisionFloors {
  /** Relative floors per metric (fraction of the reference's value). */
  hitch: number;
  frame: number;
  pacing: number;
  /** The worker's frame-gap tolerance, milliseconds lost per warmed program. */
  workerLostPerProgramMs: number;
}

/** PROVISIONAL, until the calibration runs: on a comparison of medians a
 *  15 percent hitch gap and a 10 percent frame or pacing gap are outside
 *  what two passes seconds apart disagree by on the Intel iGPU. */
export const PROVISIONAL_FLOORS: DecisionFloors = Object.freeze({
  hitch: 0.15,
  frame: 0.1,
  pacing: 0.05,
  workerLostPerProgramMs: 40,
});

/** The relative minimum where no fixed floor exists. */
export const RELATIVE_MINIMUM = 0.1;

export interface Decision {
  backend: ArmRung | null;
  worker: boolean;
  /** The arm the others were measured against. */
  reference: ArmRung | null;
  margin: number;
  arms: ArmVerdict[];
  /** Why a second round is wanted, empty when none is. */
  secondRoundTriggers: string[];
  /** No verdict: nothing survived, or a gating section was neutral. */
  inconclusive: string | null;
}

function mean(values: number[]): number {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return Number.NaN;
  return finite.reduce((a, b) => a + b, 0) / finite.length;
}

function spreadOf(values: number[]): number {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return 0;
  return relativeSpread(Math.min(...finite), Math.max(...finite));
}

/** The figures of one arm over every valid pass of every round it completed. */
export function armFigures(results: readonly ProbeResult[], floors: DecisionFloors): ArmFigures {
  const worst: number[] = [];
  const lost: number[] = [];
  const cold: number[] = [];
  const hit: number[] = [];
  const upload: number[] = [];
  const frame: number[] = [];
  const pacing: number[] = [];
  const workerLost: number[] = [];
  let workerOk = true;
  let workerSeen = false;
  let capped = false;
  const singlePass: string[] = [];
  const neutral: string[] = [];
  for (const result of results) {
    const s = result.sections;
    const validity = (name: string, passes: number, valid: readonly boolean[] | undefined) => {
      const verdict = passVerdict(
        Array.from({ length: passes }, (_, i) => ({ valid: valid ? valid[i] !== false : true })),
      );
      if (verdict.kind === 'single-pass') singlePass.push(name);
      if (verdict.kind === 'neutral') neutral.push(name);
      return verdict.valid;
    };
    if (s.links) {
      for (const i of validity('links', s.links.passes.length, s.links.validity)) {
        const pass = s.links.passes[i];
        cold.push(pass.cold.medianMs);
        hit.push(pass.hit.medianMs);
        if (pass.cold.capped) capped = true;
      }
    }
    if (s.parallel) {
      for (const i of validity('parallel', s.parallel.passes.length, s.parallel.validity)) {
        const pass = s.parallel.passes[i];
        worst.push(pass.summary.frames.maxMs);
        lost.push(pass.summary.frames.lostMs);
        if (pass.capped) capped = true;
      }
    }
    if (s.uploads) {
      for (const i of validity('uploads', s.uploads.passes.length, s.uploads.validity)) {
        const pass = s.uploads.passes[i];
        upload.push(
          Math.max(...pass.summary.paths.filter((p) => !p.skipped).map((p) => p.maxFrameMs)),
        );
      }
    }
    if (s.frame) {
      for (const i of validity('frame', s.frame.passes.length, s.frame.validity)) {
        frame.push(s.frame.passes[i].summary.frames.p95Ms);
      }
    }
    if (s.pacing) {
      for (const i of validity('pacing', s.pacing.passes.length, s.pacing.validity)) {
        pacing.push(s.pacing.passes[i].windowed.onCadence);
      }
    }
    if (s.worker) {
      for (const i of validity('worker', s.worker.passes.length, s.worker.validity)) {
        const summary = s.worker.passes[i].summary;
        workerSeen = true;
        workerLost.push(summary.framesDuringWarm.lostMs);
        const perProgram =
          summary.warmed > 0 ? summary.framesDuringWarm.lostMs / summary.warmed : Infinity;
        if (!workerWorthIt(summary) || perProgram > floors.workerLostPerProgramMs) workerOk = false;
      }
    }
  }
  const coldMs = mean(cold);
  const hitMs = mean(hit);
  const worker = workerSeen && workerOk;
  const workerLostMs = mean(workerLost);
  // What ships: a warmed program costs its hit plus its share of the frames
  // the warm lost; an unwarmed one costs the cold link.
  const linkProfileMs = worker ? hitMs + workerLostMs / 6 : coldMs;
  return {
    worstFrameUnderLinksMs: mean(worst),
    lostUnderLinksMs: mean(lost),
    coldLinkMs: coldMs,
    hitLinkMs: hitMs,
    linkProfileMs,
    uploadMaxFrameMs: mean(upload),
    frameP95Ms: mean(frame),
    pacingOnCadence: mean(pacing),
    workerWorthIt: worker,
    workerLostMs,
    spread: Math.max(
      spreadOf(worst),
      spreadOf(lost),
      spreadOf(cold),
      spreadOf(hit),
      spreadOf(upload),
      spreadOf(frame),
    ),
    singlePassSections: singlePass,
    neutralSections: neutral,
    capped,
  };
}

function disqualificationOf(
  arm: ArmInput,
  referenceAdapter: string | null,
): Disqualification | null {
  if (arm.roundsLaunched > 0 && arm.roundsDied === arm.roundsLaunched) return 'died';
  const result = arm.results[arm.results.length - 1];
  if (!result) return 'no-result';
  if (result.ended === 'no-webgl2') return 'did-not-bind';
  if (result.identity?.software) return 'software';
  if (result.capability && result.capability.critical.length > 0) return 'capability';
  const frame = result.sections.frame;
  if (frame?.passes.some((p) => !p.summary.checksum.ok || !p.summary.textureChecksum.ok)) {
    return 'checksum';
  }
  if (referenceAdapter && arm.adapter && referenceAdapter !== arm.adapter) return 'adapter-differs';
  return null;
}

/** Lower is better: is `candidate` better than `reference` by `margin`? */
function betterBy(candidate: number, reference: number, margin: number): boolean {
  if (!Number.isFinite(candidate) || !Number.isFinite(reference)) return false;
  if (reference <= 0) return candidate < reference;
  return (reference - candidate) / reference >= margin;
}

/** Lower is better: is `candidate` worse than `reference` beyond `tolerance`? */
function worseBeyond(candidate: number, reference: number, tolerance: number): boolean {
  if (!Number.isFinite(candidate) || !Number.isFinite(reference)) return false;
  if (reference <= 0) return candidate > reference;
  return (candidate - reference) / reference > tolerance;
}

const HITCH_METRICS: Array<keyof ArmFigures> = [
  'worstFrameUnderLinksMs',
  'lostUnderLinksMs',
  'linkProfileMs',
  'uploadMaxFrameMs',
];

export function decide(
  arms: readonly ArmInput[],
  options: { floors?: DecisionFloors | null; round: number } = { round: 1 },
): Decision {
  const floors = options.floors ?? null;
  const verdicts: ArmVerdict[] = [];
  const triggers: string[] = [];
  // The reference's adapter anchors the adapter rule; D3D11 when present.
  const referenceArm = arms.find((arm) => arm.rung === 'd3d11');
  const referenceAdapter = referenceArm?.adapter || null;
  for (const arm of arms) {
    const disqualified = disqualificationOf(arm, arm.rung === 'd3d11' ? null : referenceAdapter);
    const figures = disqualified ? null : armFigures(arm.results, floors ?? PROVISIONAL_FLOORS);
    verdicts.push({ rung: arm.rung, disqualified, figures });
    if (arm.roundsDied > 0 && arm.roundsDied < arm.roundsLaunched)
      triggers.push(`${arm.rung} died once`);
    if (figures?.singlePassSections.length) {
      triggers.push(`${arm.rung} single pass: ${figures.singlePassSections.join(', ')}`);
    }
  }
  const survivors = verdicts.filter((v) => v.disqualified === null && v.figures !== null);
  const largestSpread = Math.max(0, ...survivors.map((v) => v.figures?.spread ?? 0));
  const margin = Math.max(floors ? floors.hitch : RELATIVE_MINIMUM, 2 * largestSpread);
  const frameTolerance = Math.max(floors ? floors.frame : RELATIVE_MINIMUM, 2 * largestSpread);
  const pacingTolerance = Math.max(floors ? floors.pacing : RELATIVE_MINIMUM, 2 * largestSpread);

  const neutral = survivors.find((v) => v.figures?.neutralSections.length);
  if (neutral) {
    return {
      backend: null,
      worker: false,
      reference: null,
      margin,
      arms: verdicts,
      secondRoundTriggers: triggers,
      inconclusive: `${neutral.rung}: neutral ${neutral.figures?.neutralSections.join(', ')}`,
    };
  }
  if (survivors.length === 0) {
    return {
      backend: null,
      worker: false,
      reference: null,
      margin,
      arms: verdicts,
      secondRoundTriggers: triggers,
      inconclusive: 'no surviving backend',
    };
  }

  const byRung = new Map(survivors.map((v) => [v.rung, v]));
  const d3d11 = byRung.get('d3d11') ?? null;
  const reference =
    d3d11 ??
    // No D3D11: the survivors rank against each other; the best ranked by
    // the same rule is the reference, ties to Vulkan, parallel first.
    (ARM_ORDER.map((rung) => byRung.get(rung)).find((v) => v) as ArmVerdict);
  if (reference.figures?.capped) triggers.push(`${reference.rung} capped`);
  const ref = reference.figures as ArmFigures;

  let winner: ArmVerdict = reference;
  for (const candidate of survivors) {
    if (candidate === reference) continue;
    const c = candidate.figures as ArmFigures;
    const anyWorse = HITCH_METRICS.some((m) =>
      worseBeyond(c[m] as number, ref[m] as number, margin),
    );
    const anyBetter = HITCH_METRICS.some((m) => betterBy(c[m] as number, ref[m] as number, margin));
    const frameOk = !worseBeyond(c.frameP95Ms, ref.frameP95Ms, frameTolerance);
    // Pacing: higher is better, so the comparison flips.
    const pacingOk = !worseBeyond(1 - c.pacingOnCadence, 1 - ref.pacingOnCadence, pacingTolerance);
    if (!anyWorse && anyBetter && frameOk && pacingOk) {
      // Between two qualifying candidates the better link profile wins.
      if (
        winner === reference ||
        betterBy(c.linkProfileMs, (winner.figures as ArmFigures).linkProfileMs, 0)
      ) {
        winner = candidate;
      }
    } else if (!anyWorse && !anyBetter && frameOk && pacingOk) {
      triggers.push(`${candidate.rung} inside the margin`);
    }
  }
  const secondRound = options.round < 2 ? triggers : [];
  return {
    backend: winner.rung,
    worker: (winner.figures as ArmFigures).workerWorthIt,
    reference: reference.rung,
    margin,
    arms: verdicts,
    secondRoundTriggers: secondRound,
    inconclusive: null,
  };
}
