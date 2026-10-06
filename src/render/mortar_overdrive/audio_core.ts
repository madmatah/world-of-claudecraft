import type { SimEvent } from '../../sim/types';
import type { MortarOverdriveAudioEvent } from '../audio_sink';

export interface MortarOverdriveSpatialAudioCue {
  kind: MortarOverdriveAudioEvent;
  x: number;
  z: number;
  heightOffset: number;
  impact?: number;
}

/** Authoritative world event -> one positional Mortar Overdrive cue. */
export function mortarOverdriveSpatialAudioCue(
  event: SimEvent,
): MortarOverdriveSpatialAudioCue | null {
  switch (event.type) {
    case 'mortarOverdriveGroundBlastFired':
      return { kind: 'groundBlastFire', x: event.x, z: event.z, heightOffset: 1 };
    case 'mortarOverdriveGroundBlastHit':
      return {
        kind: 'groundBlastImpact',
        x: event.x,
        z: event.z,
        heightOffset: 0,
        impact: event.impact,
      };
    case 'mortarOverdriveBump':
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
    case 'mortarOverdriveSlicked':
      return { kind: 'scrape', x: event.x, z: event.z, heightOffset: 0.3, impact: event.impact };
    default:
      return null;
  }
}

export function mortarOverdriveScrapeAudioCue(
  x: number,
  z: number,
  impact: number,
): MortarOverdriveSpatialAudioCue {
  return { kind: 'scrape', x, z, heightOffset: 0.5, impact };
}

export type MortarOverdriveVehicleAudioAction = 'run' | 'stop' | 'none';

/** Keep loops alive only while the mirrored entity is both driving and audible. */
export function mortarOverdriveVehicleAudioAction(
  wasActive: boolean,
  driving: boolean,
  audible: boolean,
): MortarOverdriveVehicleAudioAction {
  if (driving && audible) return 'run';
  return wasActive ? 'stop' : 'none';
}
