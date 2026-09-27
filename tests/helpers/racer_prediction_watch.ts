// A racing pilot's reconcile outcomes under driver prediction, set against
// the server ticks that changed what the kernel reads: the recorder the
// flag-on racer suites share (tests/realm_racers_v2_prediction.test.ts).
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
  kind: 'suspend' | 'replayed' | 'ignored' | 'stale';
  phase: Phase;
  /** The server tick that consumed the acknowledged client tick. */
  tick: number | null;
  /** Between a suspend and the first reconcile after it. */
  afterSuspend: boolean;
  /** Before the first predicted racing frame. */
  beforePredictedRace: boolean;
}

export interface EndFrame {
  predictorActive: boolean;
  /** The mirror still seats the pilot. */
  driving: boolean;
}

export interface PilotWatch {
  notes: OutcomeNote[];
  racingFrames: boolean[];
  endFrames: EndFrame[];
  /** Ticks where the server changed what the kernel reads without the
   *  client's inputs: surface multipliers, auras, the lock, contacts. */
  transitions: Set<number>;
}

function driveSignature(e: Entity, session: ClientSession): string {
  const d = e.drive;
  const auras = e.auras.map((a) => `${a.id}:${a.value}`).join(',');
  const ground = `${e.onGround}|${session.movementOverrideActive}|${auras}`;
  if (!d) return `runner|${ground}`;
  return `${d.profileKey}|${d.gripMult}|${d.dragMult}|${d.speedCap}|${d.slipCap}|${d.controlsLocked}|${ground}`;
}

export function watchPilot(
  harness: OnlineHarness,
  pilot: WatchedPilot,
  phase: () => Phase,
): PilotWatch {
  const watch: PilotWatch = { notes: [], racingFrames: [], endFrames: [], transitions: new Set() };
  const ctTick = new Map<number, number>();
  let signature = '';
  harness.onServerTick((events) => {
    const tick = harness.server.sim.tickCount;
    ctTick.set(pilot.session.lastConsumedCt, tick);
    const next = driveSignature(pilot.serverEntity, pilot.session);
    if (next !== signature) watch.transitions.add(tick);
    signature = next;
    for (const ev of events) {
      if (
        ev.type === 'realmRacersBump' &&
        (ev.aId === pilot.serverEntity.id || ev.bId === pilot.serverEntity.id)
      ) {
        watch.transitions.add(tick);
      }
    }
  });
  let last = { ...pilot.reconcileOutcomes() };
  let afterSuspend = false;
  let predictedRace = false;
  pilot.onFrame((frame) => {
    const now = { ...pilot.reconcileOutcomes() };
    const tick = ctTick.get(pilot.client.reconAckClientTick) ?? null;
    const note = (kind: OutcomeNote['kind']) =>
      watch.notes.push({
        kind,
        phase: phase(),
        tick,
        afterSuspend,
        beforePredictedRace: !predictedRace,
      });
    if (now.suspends > last.suspends) {
      note('suspend');
      afterSuspend = true;
    }
    if (now.ignored > last.ignored) note('ignored');
    if (now.stale > last.stale) note('stale');
    if (now.replayed > last.replayed) note('replayed');
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
