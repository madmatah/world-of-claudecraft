import type { SimEvent } from '../sim/types';
import type { RealmRacersAudioEvent } from './audio_sink';

export interface RealmRacersSpatialAudioCue {
  kind: RealmRacersAudioEvent;
  x: number;
  z: number;
  heightOffset: number;
  impact?: number;
}

/** Authoritative world event -> one positional rally cue. */
export function realmRacersSpatialAudioCue(event: SimEvent): RealmRacersSpatialAudioCue | null {
  switch (event.type) {
    case 'realmRacersGroundBlastFired':
      return { kind: 'groundBlastFire', x: event.x, z: event.z, heightOffset: 1 };
    case 'realmRacersGroundBlastHit':
      return {
        kind: 'groundBlastImpact',
        x: event.x,
        z: event.z,
        heightOffset: 0,
        impact: event.impact,
      };
    case 'realmRacersBump':
      return {
        kind: 'bump',
        x: event.x,
        z: event.z,
        heightOffset: 0.5,
        impact: Math.min(1, event.impact / 24),
      };
    // Oil reuses the SCRAPE cue rather than earning a sample of its own: it is
    // already the tyre-noise voice (pitched up, short, jittered), and a machine
    // losing grip on a patch is the same sound as one losing it on a wall. At
    // tyre height, and the impact arrives pre-normalized.
    case 'realmRacersSlicked':
      return { kind: 'scrape', x: event.x, z: event.z, heightOffset: 0.3, impact: event.impact };
    default:
      return null;
  }
}

export function realmRacersScrapeAudioCue(
  x: number,
  z: number,
  impact: number,
): RealmRacersSpatialAudioCue {
  return { kind: 'scrape', x, z, heightOffset: 0.5, impact };
}

export type RealmRacersVehicleAudioAction = 'run' | 'stop' | 'none';

/** Keep loops alive only while the mirrored entity is both driving and audible. */
export function realmRacersVehicleAudioAction(
  wasActive: boolean,
  driving: boolean,
  audible: boolean,
): RealmRacersVehicleAudioAction {
  if (driving && audible) return 'run';
  return wasActive ? 'stop' : 'none';
}
