// The decision: which backend to launch and whether the warm worker is worth
// it, from the arms' results. Host-agnostic, the rule of
// docs/desktop-release.md ("GPU backend on Windows: the probe") ("Decision rule") made code:
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
  /** The power state the child read at its first frame, one per round that
   *  reported one (the shell's envelope); absent in a plain browser. */
  onBattery?: boolean[];
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
  /** The spread PER metric, which is what the margins are built from: one
   *  noisy metric on one arm must not widen the margin of every other. */
  spreads: MetricSpreads;
  /** The display's frame interval, the quantum below which a difference in a
   *  frame-time metric is nothing a player can see. */
  refreshMs: number;
  /** Sections with a single valid pass. */
  singlePassSections: string[];
  /** Sections with no valid pass. */
  neutralSections: string[];
  capped: boolean;
}

/** Relative spread per comparable metric. */
export type MetricSpreads = Record<ComparedMetric, number>;

/** The metrics a candidate is compared on, hitch first. */
export type ComparedMetric =
  | 'worstFrameUnderLinksMs'
  | 'lostUnderLinksMs'
  | 'linkProfileMs'
  | 'uploadMaxFrameMs'
  | 'frameP95Ms'
  | 'pacingOnCadence';

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
 *  what two passes seconds apart disagree by on the Intel iGPU.
 *
 *  These are the FLOOR under each metric's own margin, never a shared one: the
 *  margin in force for a metric is the larger of its floor and twice the worst
 *  spread that metric showed on any surviving arm (marginFor). */
export const PROVISIONAL_FLOORS: DecisionFloors = Object.freeze({
  hitch: 0.15,
  frame: 0.1,
  pacing: 0.05,
  workerLostPerProgramMs: 40,
});

/** The relative minimum where no fixed floor exists. */
export const RELATIVE_MINIMUM = 0.1;

/** How many heavy programs the worker section warms per pass
 *  (src/probe/worker_section.ts): the worker's frames lost are spread over
 *  them to make a per-program link profile. */
export const WORKER_SECTION_PROGRAMS = 6;

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
  const linkProfileMs = worker ? hitMs + workerLostMs / WORKER_SECTION_PROGRAMS : coldMs;
  // The link profile is built from cold and hit, so its own spread is the
  // worse of theirs; pacing is a ratio, and its spread is read as such.
  const spreads: MetricSpreads = {
    worstFrameUnderLinksMs: spreadOf(worst),
    lostUnderLinksMs: spreadOf(lost),
    linkProfileMs: Math.max(spreadOf(cold), spreadOf(hit)),
    uploadMaxFrameMs: spreadOf(upload),
    frameP95Ms: spreadOf(frame),
    pacingOnCadence: spreadOf(pacing),
  };
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
    // Kept for the report and the support line; the margins read `spreads`.
    spread: Math.max(...Object.values(spreads)),
    spreads,
    refreshMs: refreshOf(results),
    singlePassSections: singlePass,
    neutralSections: neutral,
    capped,
  };
}

/** The arm's display interval: the largest its passes reported, so the floor
 *  it feeds is never smaller than a frame on the slowest of them. Zero when no
 *  pass reported one, which turns the absolute floor off rather than guessing. */
function refreshOf(results: readonly ProbeResult[]): number {
  const seen = results
    .map((r) => r.refreshMs)
    .filter((ms): ms is number => typeof ms === 'number' && Number.isFinite(ms) && ms > 0);
  return seen.length === 0 ? 0 : Math.max(...seen);
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

/**
 * A gap no player could see, whatever the relative arithmetic says. This holds
 * for a WORST-FRAME statistic and nothing else (FRAME_FLOOR_METRICS): those sit
 * on a floor of one display interval, so a worst frame of 16.9 ms is not a
 * hitch at all and 20.4 ms is 3.5 ms of one, and reading that pair as a 19
 * percent difference takes noise for signal. It must NOT be extended to a
 * running frame time: a p95 of 25 against 33 ms is eight milliseconds too, and
 * there it is the difference between 40 and 30 frames a second. `floorMs` of
 * zero (no arm reported a refresh) turns the rule off rather than inventing a
 * quantum.
 */
function withinOneFrame(a: number, b: number, floorMs: number): boolean {
  if (floorMs <= 0) return false;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) < floorMs;
}

/** The metrics whose floor is one display frame: both are a maximum over the
 *  frames of a pass, so their quiet value IS the refresh interval. */
const FRAME_FLOOR_METRICS = new Set<ComparedMetric>(['worstFrameUnderLinksMs', 'uploadMaxFrameMs']);

const HITCH_METRICS: ComparedMetric[] = [
  'worstFrameUnderLinksMs',
  'lostUnderLinksMs',
  'linkProfileMs',
  'uploadMaxFrameMs',
];

/**
 * One metric's margin: its own noise, never the run's worst. Built from the
 * largest spread THAT metric showed on any surviving arm, doubled, with the
 * fixed floor underneath. Read from the run of 2026-09-10: the upload figure
 * moved 37.7 to 17.4 ms between two passes of one arm (a single hiccup on a
 * max-of-frames statistic, 74 percent in relative terms), and under one shared
 * margin that widened EVERY comparison to about 147 percent, so nothing could
 * ever have beaten the reference. Per metric, a noisy upload only makes the
 * upload comparison unreadable, which is the honest consequence.
 */
function marginFor(
  metric: ComparedMetric,
  survivors: readonly ArmVerdict[],
  floor: number,
): number {
  const worst = Math.max(0, ...survivors.map((v) => v.figures?.spreads?.[metric] ?? 0));
  return Math.max(floor, 2 * worst);
}

/** The frame quantum the absolute floor uses: the slowest display any
 *  surviving arm reported. */
function frameFloorMs(survivors: readonly ArmVerdict[]): number {
  return Math.max(0, ...survivors.map((v) => v.figures?.refreshMs ?? 0));
}

export interface DecideOptions {
  floors?: DecisionFloors | null;
  round: number;
  /** The stored verdict's rung, for the within-run hysteresis: the new winner
   *  must beat the stored backend's OWN arm of this run by the margin, else
   *  the stored backend stands; a stored backend disqualified in this run is
   *  replaced regardless. */
  storedRung?: ArmRung | null;
}

export function decide(arms: readonly ArmInput[], options: DecideOptions = { round: 1 }): Decision {
  const floors = options.floors ?? null;
  // Arms measured on battery compare only with arms measured on battery: a
  // run whose power state differed between arms (or moved between rounds)
  // is inconclusive, never a verdict about a clock state.
  const powerStates = new Set(arms.flatMap((arm) => arm.onBattery ?? []));
  if (powerStates.size > 1) {
    return {
      backend: null,
      worker: false,
      reference: null,
      margin: 0,
      arms: [],
      secondRoundTriggers: [],
      inconclusive: 'mixed power state',
    };
  }
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
  // One margin PER metric, from that metric's own noise (see marginFor), plus a
  // floor of one display frame under every frame-time comparison.
  const hitchFloor = floors ? floors.hitch : RELATIVE_MINIMUM;
  const hitchMargins = new Map<ComparedMetric, number>(
    HITCH_METRICS.map((metric) => [metric, marginFor(metric, survivors, hitchFloor)]),
  );
  const frameTolerance = marginFor(
    'frameP95Ms',
    survivors,
    floors ? floors.frame : RELATIVE_MINIMUM,
  );
  const pacingTolerance = marginFor(
    'pacingOnCadence',
    survivors,
    floors ? floors.pacing : RELATIVE_MINIMUM,
  );
  const floorMs = frameFloorMs(survivors);
  // The reported margin stays one number: the widest hitch margin in force.
  const margin = Math.max(...hitchMargins.values());

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

  // The decision rule between a candidate and a reference: not worse beyond
  // the margin on any hitch metric AND better by it on at least one, and not
  // worse beyond tolerance on the frame and on pacing (higher is better there).
  const compare = (c: ArmFigures, against: ArmFigures) => {
    const separable = (m: ComparedMetric) =>
      !FRAME_FLOOR_METRICS.has(m) || !withinOneFrame(c[m] as number, against[m] as number, floorMs);
    const anyWorse = HITCH_METRICS.some(
      (m) =>
        separable(m) &&
        worseBeyond(c[m] as number, against[m] as number, hitchMargins.get(m) ?? margin),
    );
    const anyBetter = HITCH_METRICS.some(
      (m) =>
        separable(m) &&
        betterBy(c[m] as number, against[m] as number, hitchMargins.get(m) ?? margin),
    );
    const frameOk = !worseBeyond(c.frameP95Ms, against.frameP95Ms, frameTolerance);
    const pacingOk = !worseBeyond(
      1 - c.pacingOnCadence,
      1 - against.pacingOnCadence,
      pacingTolerance,
    );
    return {
      anyWorse,
      anyBetter,
      frameOk,
      pacingOk,
      beats: !anyWorse && anyBetter && frameOk && pacingOk,
    };
  };

  let winner: ArmVerdict = reference;
  for (const candidate of survivors) {
    if (candidate === reference) continue;
    const c = candidate.figures as ArmFigures;
    const { anyWorse, anyBetter, frameOk, pacingOk } = compare(c, ref);
    if (!anyWorse && anyBetter && frameOk && pacingOk) {
      // Between two qualifying candidates the better link profile wins.
      // Strictly better: an equal profile keeps the earlier qualifying arm
      // (the arm order, D3D11 then the Vulkan rungs then OpenGL).
      if (winner === reference || c.linkProfileMs < (winner.figures as ArmFigures).linkProfileMs) {
        winner = candidate;
      }
    } else if (!anyWorse && !anyBetter && frameOk && pacingOk) {
      triggers.push(`${candidate.rung} inside the margin`);
    }
  }
  // Hysteresis, within this run: a stored backend that survived keeps the
  // verdict unless the new winner beats ITS arm by the margin (stored figures
  // are never compared across runs).
  const stored = options.storedRung ? byRung.get(options.storedRung) : undefined;
  if (stored && stored !== winner) {
    const held = !compare(winner.figures as ArmFigures, stored.figures as ArmFigures).beats;
    if (held) {
      triggers.push(`${winner.rung} does not beat the stored ${stored.rung} by the margin`);
      winner = stored;
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
