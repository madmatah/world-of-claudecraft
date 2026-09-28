// The race warm: the sampled clips and procedural icons a Realm Racers race
// first reaches for at speed (the first shell, bump, drift, pickup and slow),
// fetched and composed while the race is still ahead, so none of it waits on a
// fetch or builds a canvas on a racing frame. A browser with no worker canvas
// keeps the icons' on-demand build (icon_prewarm.ts leaves that path alone).
//
// It fires on the same commitment trigger as the race GPU preparation
// (realm_racers_prepare_core.ts): the queue join, a practice seat, a login or
// reconnect already seated, or standing in the rally band. The seated arm is
// what covers a player who logs in on the spot. Once per HUD, from its non-paint
// half, so a hidden window warms too; nothing runs before the commitment but
// the one band test.
//
// Sounds: only the clips the manifest leaves lazy (a startup clip is already
// resident), through the engine's own preload. Icons: through the icon warmer
// (icon_prewarm.ts), one worker encode in flight at a time, into the caches the
// splash, the action bar and the buff bar read.

import { REALM_RACERS_EVENT_SFX, REALM_RACERS_VEHICLE_SFX } from '../../../game/realm_racers_sfx';
import { SFX_CLIPS, type SfxEntry, type SfxId } from '../../../game/sfx_manifest.generated';
import {
  createRealmRacersPrepareLatch,
  type RealmRacersCommitment,
  type RealmRacersPrepareReason,
  takeRealmRacersPrepare,
} from '../../../render/realm_racers_prepare_core';
import { REALM_RACERS_ABILITIES } from '../../../sim/content/realm_racers';
import { REALM_RACERS_GHOST_AURA } from '../../../sim/realm_racers_ghost';
import { isAtRealmRacersXZ } from '../../../sim/realm_racers_layout';
import {
  REALM_RACERS_GROUND_BLAST_AURA,
  REALM_RACERS_OFF_TRACK_AURA,
  REALM_RACERS_WARD_AURA,
} from '../../../sim/social/realm_racers';
import type { IWorld } from '../../../world_api';
import { resolveHudAuraIconId } from '../../aura_icon_runtime';
import type { IconPrewarmEntry } from '../../icon_prewarm';
import {
  RALLY_SPLASH_ICON_SIZE,
  rallyPickupSplashIcons,
} from '../../realm_racers_pickup_splash_view';

/** The auras a race puts on the viewer's own machine, as the race applies
 *  them: the buff bar shows each. */
export const REALM_RACERS_SELF_AURAS: readonly { id: string; kind: string }[] = [
  { id: REALM_RACERS_WARD_AURA, kind: 'rally_ward' },
  { id: REALM_RACERS_GHOST_AURA, kind: 'rally_ghost' },
  { id: REALM_RACERS_GROUND_BLAST_AURA, kind: 'slow' },
  { id: REALM_RACERS_OFF_TRACK_AURA, kind: 'slow' },
];

/** The apply cues the HUD plays when the race grants those auras
 *  (combat_sfx.ts auraApplyCue): the ward's buff and the two slows' debuff.
 *  The ghost is granted in place and plays none. */
export const REALM_RACERS_SELF_AURA_CUES: readonly SfxId[] = ['buff_apply', 'debuff_apply'];

/** The clips a race plays through the spatial engine (the rally events and the
 *  vehicle mix) and the HUD's race aura cues, the startup ones included. The
 *  GameAudio race stings and the rider's jump and land are startup clips. */
export function realmRacersRaceSfx(): SfxId[] {
  return [
    ...new Set<SfxId>([
      ...Object.values(REALM_RACERS_EVENT_SFX),
      ...Object.values(REALM_RACERS_VEHICLE_SFX),
      ...REALM_RACERS_SELF_AURA_CUES,
    ]),
  ];
}

/** The clips the warm preloads: the race's clips the manifest does not load at
 *  startup. */
export function realmRacersRaceWarmSfx(
  clips: Readonly<Record<string, Pick<SfxEntry, 'preload'>>> = SFX_CLIPS,
): SfxId[] {
  return realmRacersRaceSfx().filter((key) => clips[key] && clips[key].preload !== 'startup');
}

/** The icons the warm composes: the splash of every pickup effect, the action
 *  bar's rally slots (the bar's default size), and the buff bar's icon of each
 *  race aura (its procedural layer, the one it composes on demand). */
export function realmRacersRaceWarmIcons(): IconPrewarmEntry[] {
  const entries: IconPrewarmEntry[] = [];
  for (const icon of rallyPickupSplashIcons()) {
    entries.push({ kind: icon.kind, id: icon.id, size: RALLY_SPLASH_ICON_SIZE });
  }
  for (const id of Object.keys(REALM_RACERS_ABILITIES)) entries.push({ kind: 'ability', id });
  const auraIcons = new Set(REALM_RACERS_SELF_AURAS.map((aura) => resolveHudAuraIconId(aura)));
  for (const id of auraIcons) entries.push({ kind: 'aura', id, mode: 'procedural' });
  return entries;
}

/** Where the warm sends its work; the HUD hands in the real engine and icon
 *  warmer (realm_racers_hud_parts.ts), a test hands in spies. */
export interface RealmRacersRaceWarmSinks {
  preloadSfx(key: SfxId): void;
  prewarmIcons(entries: IconPrewarmEntry[]): void;
}

export class RealmRacersRaceWarm {
  private readonly latch = createRealmRacersPrepareLatch();
  private readonly commitment: RealmRacersCommitment = {
    queued: false,
    match: null,
    inBand: false,
    shot: false,
  };

  constructor(private readonly sinks: RealmRacersRaceWarmSinks) {}

  /** Why the warm ran, or null while it has not. */
  get reason(): RealmRacersPrepareReason | null {
    return this.latch.reason;
  }

  /** Per HUD frame: a no-op once warmed, one band test before. */
  step(world: Pick<IWorld, 'realmRacersInfo' | 'player'>): void {
    if (this.latch.reason !== null) return;
    const info = world.realmRacersInfo;
    const pos = world.player.pos;
    const commitment = this.commitment;
    commitment.queued = info.queued;
    commitment.match = info.match;
    commitment.inBand = isAtRealmRacersXZ(pos.x, pos.z);
    if (takeRealmRacersPrepare(this.latch, commitment) === null) return;
    commitment.match = null;
    for (const key of realmRacersRaceWarmSfx()) this.sinks.preloadSfx(key);
    this.sinks.prewarmIcons(realmRacersRaceWarmIcons());
  }
}
