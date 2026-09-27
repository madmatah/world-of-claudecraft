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

describe('realmRacersReadyDueKey', () => {
  it('is due only in the lobby, and only while the viewer is not listed ready', () => {
    expect(realmRacersReadyDueKey({ ...info('loading'), match: null })).toBeNull();
    expect(realmRacersReadyDueKey(info('countdown'))).toBeNull();
    expect(realmRacersReadyDueKey(info('racing'))).toBeNull();
    expect(realmRacersReadyDueKey(info('loading'))).toBeNull();
    expect(
      realmRacersReadyDueKey(info('loading', { secondsLeft: 12, readyIds: [ME, 2] })),
    ).toBeNull();
    expect(realmRacersReadyDueKey(info('loading', { secondsLeft: 12, readyIds: [2] }))).toBe(
      '7|12',
    );
    expect(realmRacersReadyDueKey(info('loading', { secondsLeft: 12, readyIds: [] }, 8))).toBe(
      '8|12',
    );
  });
});

describe('stepRealmRacersReady', () => {
  it('sends once per key, retries on the next whole second, and re-sends once the flag is cleared', () => {
    const sender = createRealmRacersReadySender();
    const send = vi.fn();
    const waiting = (secondsLeft: number) => info('loading', { secondsLeft, readyIds: [2] });
    expect(stepRealmRacersReady(sender, waiting(15), send)).toBe(true);
    expect(stepRealmRacersReady(sender, waiting(15), send)).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    // Unanswered for a second: one retry, not one per frame.
    expect(stepRealmRacersReady(sender, waiting(14), send)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    // Acknowledged, then cleared by a drop and a resume inside the same second.
    stepRealmRacersReady(sender, info('loading', { secondsLeft: 14, readyIds: [ME, 2] }), send);
    expect(stepRealmRacersReady(sender, waiting(14), send)).toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
    expect(stepRealmRacersReady(sender, info('countdown'), send)).toBe(false);
    expect(send).toHaveBeenCalledTimes(3);
  });
});
