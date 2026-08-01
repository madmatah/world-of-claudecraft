import type { SimEvent } from '../sim/types';

type RealmRacersResultEvent = Extract<SimEvent, { type: 'realmRacersResult' }> & {
  pid?: number;
};

export type RealmRacersResultAudioOutcome = 'victory' | 'defeat' | null;

export interface RealmRacersResultAudioSink {
  realmRacersResult(won: boolean): void;
}

/** Personal race result -> requested UI sting; draws remain silent. */
export function realmRacersResultAudioOutcome(
  event: RealmRacersResultEvent,
  playerId: number,
): RealmRacersResultAudioOutcome {
  if ((event.pid !== undefined && event.pid !== playerId) || !event.winnerName) return null;
  return event.won ? 'victory' : 'defeat';
}

/** Execute the exact HUD result route against its injected audio sink. */
export function playRealmRacersResultAudio(
  event: RealmRacersResultEvent,
  playerId: number,
  sink: RealmRacersResultAudioSink,
): void {
  const outcome = realmRacersResultAudioOutcome(event, playerId);
  if (outcome !== null) sink.realmRacersResult(outcome === 'victory');
}
