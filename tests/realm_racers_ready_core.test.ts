import { describe, expect, it, vi } from 'vitest';
import {
  createRealmRacersReadySender,
  realmRacersReadyDueKey,
  stepRealmRacersReady,
} from '../src/ui/realm_racers_ready_core';
import type {
  RealmRacersInfo,
  RealmRacersLoadingInfo,
  RealmRacersMatchInfo,
  RealmRacersPhase,
} from '../src/world_api/realm_racers';

const ME = 1;
const SETTLED = { settled: true };
const PREPARING = { settled: false };

function info(phase: RealmRacersPhase, loading?: RealmRacersLoadingInfo, id = 7): RealmRacersInfo {
  const match = {
    id,
    phase,
    me: { pid: ME },
    ...(loading ? { loading } : {}),
  } as unknown as RealmRacersMatchInfo;
  return {
    queued: false,
    queuePosition: 0,
    queueSize: 0,
    match,
    practiceAvailable: false,
    queueViable: true,
  };
}

const waiting = (secondsLeft: number, id = 7) =>
  info('loading', { secondsLeft, readyIds: [2] }, id);

describe('realmRacersReadyDueKey', () => {
  it('is due only in the lobby, only once prepared, and only while the viewer is not listed ready', () => {
    expect(realmRacersReadyDueKey({ ...info('loading'), match: null }, SETTLED)).toBeNull();
    expect(realmRacersReadyDueKey(info('countdown'), SETTLED)).toBeNull();
    expect(realmRacersReadyDueKey(info('racing'), SETTLED)).toBeNull();
    expect(realmRacersReadyDueKey(info('loading'), SETTLED)).toBeNull();
    expect(
      realmRacersReadyDueKey(info('loading', { secondsLeft: 12, readyIds: [ME, 2] }), SETTLED),
    ).toBeNull();
    expect(realmRacersReadyDueKey(waiting(12), PREPARING)).toBeNull();
    expect(realmRacersReadyDueKey(waiting(12), SETTLED)).toBe('7|12');
    expect(realmRacersReadyDueKey(waiting(12, 8), SETTLED)).toBe('8|12');
  });
});

describe('stepRealmRacersReady', () => {
  it('never sends while the preparation is unsettled, however long the lobby waits', () => {
    const sender = createRealmRacersReadySender();
    const send = vi.fn();
    for (let seconds = 15; seconds >= 0; seconds--) {
      for (let frame = 0; frame < 60; frame++) {
        expect(stepRealmRacersReady(sender, waiting(seconds), PREPARING, send)).toBe(false);
      }
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('sends on the frame the preparation settles, then once per key', () => {
    const sender = createRealmRacersReadySender();
    const send = vi.fn();
    expect(stepRealmRacersReady(sender, waiting(15), PREPARING, send)).toBe(false);
    expect(stepRealmRacersReady(sender, waiting(15), SETTLED, send)).toBe(true);
    expect(stepRealmRacersReady(sender, waiting(15), SETTLED, send)).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    // Unanswered for a server second: one retry, not one per frame.
    expect(stepRealmRacersReady(sender, waiting(14), SETTLED, send)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    // Acknowledged: nothing more is due.
    const listed = info('loading', { secondsLeft: 14, readyIds: [ME, 2] });
    expect(stepRealmRacersReady(sender, listed, SETTLED, send)).toBe(false);
    expect(stepRealmRacersReady(sender, info('countdown'), SETTLED, send)).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('re-sends after a resume clears the flag, within the same second', () => {
    const sender = createRealmRacersReadySender();
    const send = vi.fn();
    stepRealmRacersReady(sender, waiting(14), SETTLED, send);
    stepRealmRacersReady(
      sender,
      info('loading', { secondsLeft: 14, readyIds: [ME, 2] }),
      SETTLED,
      send,
    );
    expect(stepRealmRacersReady(sender, waiting(14), SETTLED, send)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('waits again when a rebuilt renderer starts its preparation over', () => {
    const sender = createRealmRacersReadySender();
    const send = vi.fn();
    stepRealmRacersReady(sender, waiting(14), PREPARING, send);
    expect(send).not.toHaveBeenCalled();
    expect(stepRealmRacersReady(sender, waiting(13), SETTLED, send)).toBe(true);
    expect(stepRealmRacersReady(sender, waiting(12), PREPARING, send)).toBe(false);
    expect(stepRealmRacersReady(sender, waiting(12), SETTLED, send)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
