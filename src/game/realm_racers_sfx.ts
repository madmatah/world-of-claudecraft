// The sampled clips a Realm Racers race plays through the spatial engine
// (sfx.ts): the world-event one-shots and the vehicle mix loops. sfx.ts plays
// from this table and the race warm preloads from it
// (src/ui/hud/realm_racers/realm_racers_race_warm.ts), so the warm can never
// miss a clip the engine reaches for.

import type { SfxId } from './sfx_manifest.generated';

export type RealmRacersSfxEvent = 'groundBlastFire' | 'groundBlastImpact' | 'bump' | 'scrape';

/** The positional one-shot of each rally world event. An oil crossing plays
 *  the scrape (realm_racers_audio_core.ts). */
export const REALM_RACERS_EVENT_SFX: Readonly<Record<RealmRacersSfxEvent, SfxId>> = {
  groundBlastFire: 'proj_groundshaker',
  groundBlastImpact: 'impact_groundshaker',
  bump: 'impact_arcane',
  scrape: 'impact_arcane',
};

/** The three loops of one machine's mix: the engine, the tyre skid while it
 *  slides, and the surface roll (the road's or the verge's). */
export const REALM_RACERS_VEHICLE_SFX: Readonly<{
  engine: SfxId;
  skid: SfxId;
  rollRoad: SfxId;
  rollDirt: SfxId;
}> = {
  engine: 'move_groundshaker_engine',
  skid: 'mount_run_stalkglider_snail',
  rollRoad: 'foot_stone',
  rollDirt: 'foot_dirt',
};
