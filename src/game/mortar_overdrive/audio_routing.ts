import type { SimEvent } from '../../sim/types';

type MortarOverdriveResultEvent = Extract<SimEvent, { type: 'mortarOverdriveResult' }> & {
  pid?: number;
};

export type MortarOverdriveResultAudioOutcome = 'victory' | 'defeat' | null;

export interface MortarOverdriveResultAudioSink {
  mortarOverdriveResult(won: boolean): void;
}

/** Personal race result -> requested UI sting; draws remain silent. */
export function mortarOverdriveResultAudioOutcome(
  event: MortarOverdriveResultEvent,
  playerId: number,
): MortarOverdriveResultAudioOutcome {
  if ((event.pid !== undefined && event.pid !== playerId) || !event.winnerName) return null;
  return event.won ? 'victory' : 'defeat';
}

/** Execute the exact HUD result route against its injected audio sink. */
export function playMortarOverdriveResultAudio(
  event: MortarOverdriveResultEvent,
  playerId: number,
  sink: MortarOverdriveResultAudioSink,
): void {
  const outcome = mortarOverdriveResultAudioOutcome(event, playerId);
  if (outcome !== null) sink.mortarOverdriveResult(outcome === 'victory');
}
