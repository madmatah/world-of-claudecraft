// A racing pilot's reconcile outcomes under driver prediction, set against
// the server ticks that changed what the kernel reads: the recorder the
// flag-on racer suites share (tests/mortar_overdrive_v2_prediction.test.ts).
// Each outcome is noted on the frame the client's counters moved, with the
// server tick that consumed the acknowledged client tick; a frame hook and a
// server tick hook on the online harness, nothing else.

import type { ClientSession } from '../../server/game';
import type { ClientWorld } from '../../src/net/online';
import type { Entity } from '../../src/sim/types';
import type { ClientFrameHook, OnlineHarness, ReconcileOutcomeCounts } from './online_harness';

export type Phase = 'seat' | 'go' | 'race' | 'end';

export interface WatchedPilot {
  client: ClientWorld;
  session: ClientSession;
  serverEntity: Entity;
  onFrame(hook: ClientFrameHook): () => void;
  reconcileOutcomes(): ReconcileOutcomeCounts;
}

export interface OutcomeNote {
  kind: 'suspend' | 'replayed' | 'ignored' | 'stale' | 'match';
  phase: Phase;
  /** The server tick that consumed the acknowledged client tick. */
  tick: number | null;
  /** Between a suspend and the first reconcile after it. */
  afterSuspend: boolean;
  /** Before the first predicted racing frame. */
  beforePredictedRace: boolean;
  /** Virtual wall time of the frame, ms. */
  tMs: number;
  /** A replay's correction: the old predicted head minus the replayed one
   *  (yaw only while the head drives). */
  residual?: { xz: number; y: number; yaw: number };
}

export interface EndFrame {
  predictorActive: boolean;
  /** The mirror still seats the pilot. */
  driving: boolean;
}

export interface PilotWatch {
  notes: OutcomeNote[];
  /** Every reconcile that matched exactly (kept apart from `notes`). */
  matches: OutcomeNote[];
  racingFrames: boolean[];
  endFrames: EndFrame[];
  /** Ticks where the server changed what the kernel reads without the
   *  client's inputs: surface multipliers, auras, the lock, contacts. */
  transitions: Set<number>;
  /** Per transition tick, which of the signature's fields changed (a bump
   *  event reads 'bump'). */
  transitionFields: Map<number, string[]>;
  /** The most reconcile outcomes (match plus replayed) one frame counted.
   *  The pipeline reconciles once per frame, so anything above 1 means the
   *  per-frame notes above would have collapsed several into one. */
  maxReconcilesPerFrame: number;
}

function driveSignatureFields(e: Entity, session: ClientSession): Record<string, string> {
  const d = e.drive;
  const fields: Record<string, string> = {
    auras: e.auras.map((a) => `${a.id}:${a.value}`).join(','),
    onGround: String(e.onGround),
    override: String(session.movementOverrideActive),
  };
  if (!d) return { ...fields, drive: 'runner' };
  return {
    ...fields,
    drive: d.profileKey,
    gripMult: String(d.gripMult),
    dragMult: String(d.dragMult),
    speedCap: String(d.speedCap),
    slipCap: String(d.slipCap),
    controlsLocked: String(d.controlsLocked),
  };
}

function driveSignature(fields: Record<string, string>): string {
  return Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('|');
}

/** The signature fields a transition can name (see transitionFields). */
export type TransitionField =
  | 'auras'
  | 'onGround'
  | 'override'
  | 'drive'
  | 'gripMult'
  | 'dragMult'
  | 'speedCap'
  | 'slipCap'
  | 'controlsLocked'
  | 'bump';

export function watchPilot(
  harness: OnlineHarness,
  pilot: WatchedPilot,
  phase: () => Phase,
): PilotWatch {
  const watch: PilotWatch = {
    notes: [],
    matches: [],
    racingFrames: [],
    endFrames: [],
    transitions: new Set(),
    transitionFields: new Map(),
    maxReconcilesPerFrame: 0,
  };
  const ctTick = new Map<number, number>();
  let signature = '';
  let lastFields: Record<string, string> = {};
  const noteTransition = (tick: number, field: string) => {
    watch.transitions.add(tick);
    const fields = watch.transitionFields.get(tick) ?? [];
    if (!fields.includes(field)) fields.push(field);
    watch.transitionFields.set(tick, fields);
  };
  harness.onServerTick((events) => {
    const tick = harness.server.sim.tickCount;
    ctTick.set(pilot.session.lastConsumedCt, tick);
    const fields = driveSignatureFields(pilot.serverEntity, pilot.session);
    const next = driveSignature(fields);
    if (next !== signature) {
      for (const key of Object.keys(fields)) {
        if (fields[key] !== lastFields[key]) noteTransition(tick, key);
      }
    }
    signature = next;
    lastFields = fields;
    for (const ev of events) {
      if (
        ev.type === 'mortarOverdriveBump' &&
        (ev.aId === pilot.serverEntity.id || ev.bId === pilot.serverEntity.id)
      ) {
        noteTransition(tick, 'bump');
      }
    }
  });
  let last = { ...pilot.reconcileOutcomes() };
  let afterSuspend = false;
  let predictedRace = false;
  pilot.onFrame((frame) => {
    const now = { ...pilot.reconcileOutcomes() };
    const tick = ctTick.get(pilot.client.reconAckClientTick) ?? null;
    const note = (kind: OutcomeNote['kind']) => {
      const entry: OutcomeNote = {
        kind,
        phase: phase(),
        tick,
        afterSuspend,
        beforePredictedRace: !predictedRace,
        tMs: frame.nowMs,
      };
      const display = frame.selfMotion;
      const residual = display && 'kind' in display ? display.residual : null;
      if (kind === 'replayed' && residual) {
        entry.residual = {
          xz: Math.hypot(residual.x, residual.z),
          y: Math.abs(residual.y),
          // the core's residual carries the yaw term (self_prediction_core.ts);
          // the display type does not name it until the drive view lands
          yaw: Math.abs((residual as { yaw?: number }).yaw ?? 0),
        };
      }
      (kind === 'match' ? watch.matches : watch.notes).push(entry);
    };
    // One note per counted outcome, so two in one frame never collapse.
    const noteEach = (kind: OutcomeNote['kind'], count: number) => {
      for (let i = 0; i < count; i++) note(kind);
    };
    if (now.suspends > last.suspends) {
      noteEach('suspend', now.suspends - last.suspends);
      afterSuspend = true;
    }
    noteEach('ignored', now.ignored - last.ignored);
    noteEach('stale', now.stale - last.stale);
    const replayed = now.replayed - last.replayed;
    const matched = now.match - last.match;
    watch.maxReconcilesPerFrame = Math.max(watch.maxReconcilesPerFrame, replayed + matched);
    noteEach('replayed', replayed);
    noteEach('match', matched);
    if (now.replayed > last.replayed || now.match > last.match) afterSuspend = false;
    last = now;
    if (phase() === 'race') {
      watch.racingFrames.push(frame.predictorActive);
      if (frame.predictorActive) predictedRace = true;
    } else if (phase() === 'end') {
      const c = pilot.client;
      watch.endFrames.push({
        predictorActive: frame.predictorActive,
        driving: c.entities.has(c.playerId) && c.player.drive != null,
      });
    }
  });
  return watch;
}
