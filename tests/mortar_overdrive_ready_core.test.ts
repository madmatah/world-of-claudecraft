import { describe, expect, it, vi } from 'vitest';
import {
  createMortarOverdriveReadySender,
  mortarOverdriveReadyDueKey,
  stepMortarOverdriveReady,
} from '../src/ui/hud/mortar_overdrive/ready_core';
import type {
  MortarOverdriveInfo,
  MortarOverdriveLoadingInfo,
  MortarOverdriveMatchInfo,
  MortarOverdrivePhase,
} from '../src/world_api/mortar_overdrive';

const ME = 1;
const SETTLED = { settled: true };
const PREPARING = { settled: false };

function info(
  phase: MortarOverdrivePhase,
  loading?: MortarOverdriveLoadingInfo,
  id = 7,
): MortarOverdriveInfo {
  const match = {
    id,
    phase,
    me: { pid: ME },
    ...(loading ? { loading } : {}),
  } as unknown as MortarOverdriveMatchInfo;
  return {
    queued: false,
    queuePosition: 0,
    queueSize: 0,
    match,
    practiceAvailable: false,
  };
}

const waiting = (secondsLeft: number, id = 7) =>
  info('loading', { secondsLeft, readyIds: [2] }, id);

describe('mortarOverdriveReadyDueKey', () => {
  it('is due only in the lobby, only once prepared, and only while the viewer is not listed ready', () => {
    expect(mortarOverdriveReadyDueKey({ ...info('loading'), match: null }, SETTLED)).toBeNull();
    expect(mortarOverdriveReadyDueKey(info('countdown'), SETTLED)).toBeNull();
    expect(mortarOverdriveReadyDueKey(info('racing'), SETTLED)).toBeNull();
    expect(mortarOverdriveReadyDueKey(info('loading'), SETTLED)).toBeNull();
    expect(
      mortarOverdriveReadyDueKey(info('loading', { secondsLeft: 12, readyIds: [ME, 2] }), SETTLED),
    ).toBeNull();
    expect(mortarOverdriveReadyDueKey(waiting(12), PREPARING)).toBeNull();
    expect(mortarOverdriveReadyDueKey(waiting(12), SETTLED)).toBe('7|12');
    expect(mortarOverdriveReadyDueKey(waiting(12, 8), SETTLED)).toBe('8|12');
  });
});

describe('stepMortarOverdriveReady', () => {
  it('never sends while the preparation is unsettled, however long the lobby waits', () => {
    const sender = createMortarOverdriveReadySender();
    const send = vi.fn();
    for (let seconds = 15; seconds >= 0; seconds--) {
      for (let frame = 0; frame < 60; frame++) {
        expect(stepMortarOverdriveReady(sender, waiting(seconds), PREPARING, send)).toBe(false);
      }
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('sends on the frame the preparation settles, then once per key', () => {
    const sender = createMortarOverdriveReadySender();
    const send = vi.fn();
    expect(stepMortarOverdriveReady(sender, waiting(15), PREPARING, send)).toBe(false);
    expect(stepMortarOverdriveReady(sender, waiting(15), SETTLED, send)).toBe(true);
    expect(stepMortarOverdriveReady(sender, waiting(15), SETTLED, send)).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    // Unanswered for a server second: one retry, not one per frame.
    expect(stepMortarOverdriveReady(sender, waiting(14), SETTLED, send)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    // Acknowledged: nothing more is due.
    const listed = info('loading', { secondsLeft: 14, readyIds: [ME, 2] });
    expect(stepMortarOverdriveReady(sender, listed, SETTLED, send)).toBe(false);
    expect(stepMortarOverdriveReady(sender, info('countdown'), SETTLED, send)).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('re-sends after a resume clears the flag, within the same second', () => {
    const sender = createMortarOverdriveReadySender();
    const send = vi.fn();
    stepMortarOverdriveReady(sender, waiting(14), SETTLED, send);
    stepMortarOverdriveReady(
      sender,
      info('loading', { secondsLeft: 14, readyIds: [ME, 2] }),
      SETTLED,
      send,
    );
    expect(stepMortarOverdriveReady(sender, waiting(14), SETTLED, send)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('waits again when a rebuilt renderer starts its preparation over', () => {
    const sender = createMortarOverdriveReadySender();
    const send = vi.fn();
    stepMortarOverdriveReady(sender, waiting(14), PREPARING, send);
    expect(send).not.toHaveBeenCalled();
    expect(stepMortarOverdriveReady(sender, waiting(13), SETTLED, send)).toBe(true);
    expect(stepMortarOverdriveReady(sender, waiting(12), PREPARING, send)).toBe(false);
    expect(stepMortarOverdriveReady(sender, waiting(12), SETTLED, send)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
