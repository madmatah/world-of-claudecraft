'use strict';

// The GPU backend probe's orchestrator core, pure: launches one child per arm
// through an injected waiting spawn, watches its liveness off the result
// file, kills a hung child, classifies the exit, reads and validates the
// result, sequences the arms of a round with the adaptive `vulkan-plain`
// arm, and shapes the rounds' outcomes into the decision's inputs. Every
// clock, timer, filesystem and spawn is injected; the parent
// (electron/backend_probe_parent.cjs) wires the real ones. Design:
// tmp/DESIGN_backend-probe.md, "Child process lifecycle" and "Reliability
// rules". Tests: tests/electron_backend_probe_orchestrator.test.ts.

const {
  armsForRound,
  childArgvFor,
  childEnvFor,
  classifyChildExit,
  keepsDirectory,
  profileDirFor,
  resultPathFor,
} = require('./backend_probe_plan.cjs');
const { acceptProbeResult } = require('./backend_probe_result.cjs');

/**
 * The hang guard is progress-based: the child's page reposts its result on a
 * heartbeat and after every section, and each post moves the result file's
 * mtime. A child is hung when nothing moved for longer than the largest gap
 * it has shown so far times a multiplier, floored: a slow machine that keeps
 * posting is never hung, and a page frozen for a whole minute is. The floor
 * is not a score and not a bound; "hung" is inconclusive.
 */
const HANG_FLOOR_MS = 60_000;
const HANG_GAP_MULTIPLIER = 4;
const LIVENESS_POLL_MS = 1000;

/** Tracks the child's progress marks and answers whether it is hung. */
function createLivenessTracker(startMs) {
  let last = startMs;
  let maxGap = 0;
  return {
    progress(atMs) {
      if (atMs <= last) return;
      maxGap = Math.max(maxGap, atMs - last);
      last = atMs;
    },
    deadlineMs() {
      return Math.max(HANG_FLOOR_MS, HANG_GAP_MULTIPLIER * maxGap);
    },
    hung(nowMs) {
      return nowMs - last > this.deadlineMs();
    },
    lastProgressMs() {
      return last;
    },
  };
}

/** What the parent reads off a child's result file: the envelope the child
 *  writes (outcome, code, adapter, driver, result) or null. */
function readEnvelope(ctx, resultPath, round) {
  const file = ctx.fs.readResultFile(resultPath);
  if (!file || typeof file !== 'object') return null;
  const result = acceptProbeResult(file.result, { run: ctx.run, round });
  return {
    result,
    adapter: typeof file.adapter === 'string' ? file.adapter : '',
    driverVersion: typeof file.driverVersion === 'string' ? file.driverVersion : '',
  };
}

/**
 * Launch one arm and wait for it. Resolves with the arm's outcome: the exit
 * classification, the validated result (or null), the adapter the child
 * reported, and whether its directory is kept as evidence.
 */
function launchArm(ctx, arm, round) {
  const profileDir = profileDirFor(ctx.runDir, arm, round);
  const resultPath = resultPathFor(ctx.runDir, arm, round);
  ctx.fs.mkdir(profileDir);
  const env = childEnvFor({
    baseEnv: ctx.baseEnv,
    arm,
    run: ctx.run,
    round,
    resultPath,
    profileDir,
    locale: ctx.locale,
    tier: ctx.tier,
    gpuForceOptOut: ctx.gpuForceOptOut,
    parentPid: ctx.parentPid,
  });
  const argv = childArgvFor(ctx.argv);
  return new Promise((resolve) => {
    let killedByParent = false;
    let poll = null;
    let settled = false;
    let lastMtime = null;
    const tracker = createLivenessTracker(ctx.now());
    const finish = (exit) => {
      if (settled) return;
      settled = true;
      if (poll !== null) ctx.timers.clearInterval(poll);
      const outcome = exit.error
        ? 'unknown'
        : classifyChildExit({ code: exit.code, signal: exit.signal, killedByParent });
      const envelope = readEnvelope(ctx, resultPath, round);
      ctx.log?.info?.(`[probe] arm ${arm} round ${round}: ${outcome}`, {
        code: exit.code,
        signal: exit.signal,
      });
      resolve({
        arm,
        round,
        outcome,
        code: exit.code,
        signal: exit.signal,
        result: envelope?.result ?? null,
        adapter: envelope?.adapter ?? '',
        driverVersion: envelope?.driverVersion ?? '',
        profileDir,
        resultPath,
        keepDirectory: keepsDirectory(outcome),
      });
    };
    let child;
    try {
      child = ctx.spawn({ env, argv, onExit: finish });
    } catch (err) {
      finish({ code: null, signal: null, error: err });
      return;
    }
    ctx.log?.info?.(`[probe] arm ${arm} round ${round} started`, { pid: child?.pid ?? null });
    poll = ctx.timers.setInterval(() => {
      const now = ctx.now();
      const mtime = ctx.fs.fileMtimeMs(resultPath);
      if (mtime !== null && mtime !== lastMtime) {
        lastMtime = mtime;
        tracker.progress(now);
      }
      if (tracker.hung(now) && !killedByParent) {
        killedByParent = true;
        ctx.log?.warn?.(`[probe] arm ${arm} round ${round} hung; killing it`, {
          silentMs: now - tracker.lastProgressMs(),
        });
        child.kill();
      }
    }, LIVENESS_POLL_MS);
  });
}

/**
 * Run one round: its arms in order, one child each. The adaptive arm: when
 * the `vulkan-parallel-compile` child DIED in round one and `vulkan-plain`
 * is not already an arm, it is launched right after, and stays an arm for
 * the rest of the run. `onArmStart` and `onArmEnd` are the parent's progress
 * hooks.
 */
async function runRound(ctx, round, options = {}) {
  let plainVulkan = options.plainVulkan === true;
  const arms = armsForRound(round, { plainVulkan, arm64: ctx.arm64 === true });
  const outcomes = [];
  for (let index = 0; index < arms.length; index += 1) {
    const arm = arms[index];
    ctx.onArmStart?.({ arm, round, index, total: arms.length });
    const outcome = await launchArm(ctx, arm, round);
    outcomes.push(outcome);
    ctx.onArmEnd?.(outcome);
    if (
      round === 1 &&
      arm === 'vulkan-parallel-compile' &&
      outcome.outcome === 'died' &&
      !plainVulkan
    ) {
      plainVulkan = true;
      arms.splice(index + 1, 0, 'vulkan-plain');
    }
  }
  return { round, arms, outcomes, plainVulkan };
}

/** Outcomes that count as the arm having died in that round. */
const DIED = 'died';

/**
 * The decision's inputs over the rounds run so far: per rung, the validated
 * results in round order, the rounds launched and died, and the adapter the
 * first round that reported one latched.
 */
function armInputs(rounds) {
  const byRung = new Map();
  for (const round of rounds) {
    for (const outcome of round.outcomes) {
      const entry = byRung.get(outcome.arm) ?? {
        rung: outcome.arm,
        results: [],
        roundsLaunched: 0,
        roundsDied: 0,
        adapter: '',
        outcomes: [],
      };
      entry.roundsLaunched += 1;
      if (outcome.outcome === DIED) entry.roundsDied += 1;
      if (outcome.result) entry.results.push(outcome.result);
      if (entry.adapter === '' && outcome.adapter !== '') entry.adapter = outcome.adapter;
      entry.outcomes.push(outcome.outcome);
      byRung.set(outcome.arm, entry);
    }
  }
  return [...byRung.values()];
}

/**
 * Whether a second round runs, from the canonical trigger list: the decision
 * landed inside the margin or a section had a single valid pass (the
 * decision names these), an arm died, the reference arm was capped. Never
 * after round two.
 */
function secondRoundTriggers(round1, decision) {
  const triggers = [...(decision?.secondRoundTriggers ?? [])];
  for (const outcome of round1.outcomes) {
    if (outcome.outcome === DIED && !triggers.some((t) => t.startsWith(`${outcome.arm} died`))) {
      triggers.push(`${outcome.arm} died`);
    }
    if (outcome.outcome === 'capped' && outcome.arm === 'd3d11') {
      triggers.push('reference capped');
    }
  }
  return triggers;
}

/**
 * Outcomes that make the whole run inconclusive regardless of the decision:
 * a child the parent had to kill, a renderer that went away, the probe's own
 * error, a busy machine, or an exit outside the taxonomy.
 */
const INCONCLUSIVE_OUTCOMES = Object.freeze([
  'hung',
  'renderer-gone',
  'probe-error',
  'busy',
  'orphaned',
  'unknown',
]);

function inconclusiveOutcomes(rounds) {
  const found = [];
  for (const round of rounds) {
    for (const outcome of round.outcomes) {
      if (INCONCLUSIVE_OUTCOMES.includes(outcome.outcome)) {
        found.push(`${outcome.arm} round ${outcome.round}: ${outcome.outcome}`);
      }
    }
  }
  return found;
}

/** Delete the directories of the children that completed; keep the rest. */
function cleanupRun(ctx, rounds) {
  for (const round of rounds) {
    for (const outcome of round.outcomes) {
      if (outcome.keepDirectory) continue;
      try {
        ctx.fs.rm(outcome.profileDir);
      } catch (err) {
        ctx.log?.warn?.(`[probe] could not remove ${outcome.profileDir}`, err?.message ?? err);
      }
    }
  }
}

module.exports = {
  HANG_FLOOR_MS,
  HANG_GAP_MULTIPLIER,
  INCONCLUSIVE_OUTCOMES,
  LIVENESS_POLL_MS,
  armInputs,
  cleanupRun,
  createLivenessTracker,
  inconclusiveOutcomes,
  launchArm,
  runRound,
  secondRoundTriggers,
};
