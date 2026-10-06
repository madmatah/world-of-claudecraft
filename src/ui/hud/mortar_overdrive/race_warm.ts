// The race warm: the sampled clips and procedural icons a Mortar Overdrive race
// first reaches for at speed (the first shell, bump, drift, pickup and slow),
// fetched and composed while the race is still ahead, so none of it waits on a
// fetch or builds a canvas on a racing frame. A browser with no worker canvas
// keeps the icons' on-demand build (icon_prewarm.ts leaves that path alone).
//
// It fires on the same commitment trigger as the race GPU preparation
// (mortar_overdrive/prepare_core.ts): the queue join, a practice seat, a login or
// reconnect already seated, or standing in the Mortar Overdrive band. The seated arm is
// what covers a player who logs in on the spot. Once per HUD, from its non-paint
// half, so a hidden window warms too; nothing runs before the commitment but
// the one band test.
//
// Sounds: only the clips the manifest leaves lazy (a startup clip is already
// resident), through the engine's own preload. Icons: through the icon warmer
// (icon_prewarm.ts), one worker encode in flight at a time, into the caches the
// splash, the action bar and the buff bar read.

import {
  MORTAR_OVERDRIVE_EVENT_SFX,
  MORTAR_OVERDRIVE_VEHICLE_SFX,
} from '../../../game/mortar_overdrive/sfx';
import { SFX_CLIPS, type SfxEntry, type SfxId } from '../../../game/sfx_manifest.generated';
import {
  createMortarOverdrivePrepareLatch,
  type MortarOverdriveCommitment,
  type MortarOverdrivePrepareReason,
  takeMortarOverdrivePrepare,
} from '../../../render/mortar_overdrive/prepare_core';
import { MORTAR_OVERDRIVE_ABILITIES } from '../../../sim/content/mortar_overdrive/kit';
import { MORTAR_OVERDRIVE_GHOST_AURA } from '../../../sim/mortar_overdrive/ghost';
import { isAtMortarOverdriveXZ } from '../../../sim/mortar_overdrive/layout';
import {
  MORTAR_OVERDRIVE_GROUND_BLAST_AURA,
  MORTAR_OVERDRIVE_OFF_TRACK_AURA,
  MORTAR_OVERDRIVE_WARD_AURA,
} from '../../../sim/mortar_overdrive/race';
import type { IWorld } from '../../../world_api';
import { resolveHudAuraIconId } from '../../aura_icon_runtime';
import type { IconPrewarmEntry } from '../../icon_prewarm';
import {
  MORTAR_OVERDRIVE_SPLASH_ICON_SIZE,
  mortarOverdrivePickupSplashIcons,
} from './pickup_splash_view';

/** The auras a race puts on the viewer's own machine, as the race applies
 *  them: the buff bar shows each. */
export const MORTAR_OVERDRIVE_SELF_AURAS: readonly { id: string; kind: string }[] = [
  { id: MORTAR_OVERDRIVE_WARD_AURA, kind: 'mortar_overdrive_ward' },
  { id: MORTAR_OVERDRIVE_GHOST_AURA, kind: 'mortar_overdrive_ghost' },
  { id: MORTAR_OVERDRIVE_GROUND_BLAST_AURA, kind: 'slow' },
  { id: MORTAR_OVERDRIVE_OFF_TRACK_AURA, kind: 'slow' },
];

/** The apply cues the HUD plays when the race grants those auras
 *  (combat_sfx.ts auraApplyCue): the ward's buff and the two slows' debuff.
 *  The ghost is granted in place and plays none. */
export const MORTAR_OVERDRIVE_SELF_AURA_CUES: readonly SfxId[] = ['buff_apply', 'debuff_apply'];

/** The clips a race plays through the spatial engine (the Mortar Overdrive events and the
 *  vehicle mix) and the HUD's race aura cues, the startup ones included. The
 *  GameAudio race stings and the rider's jump and land are startup clips. */
export function mortarOverdriveRaceSfx(): SfxId[] {
  return [
    ...new Set<SfxId>([
      ...Object.values(MORTAR_OVERDRIVE_EVENT_SFX),
      ...Object.values(MORTAR_OVERDRIVE_VEHICLE_SFX),
      ...MORTAR_OVERDRIVE_SELF_AURA_CUES,
    ]),
  ];
}

/** The clips the warm preloads: the race's clips the manifest does not load at
 *  startup. */
export function mortarOverdriveRaceWarmSfx(
  clips: Readonly<Record<string, Pick<SfxEntry, 'preload'>>> = SFX_CLIPS,
): SfxId[] {
  return mortarOverdriveRaceSfx().filter((key) => clips[key] && clips[key].preload !== 'startup');
}

/** The icons the warm composes: the splash of every pickup effect, the action
 *  bar's Mortar Overdrive slots (the bar's default size), and the buff bar's icon of each
 *  race aura (its procedural layer, the one it composes on demand). */
export function mortarOverdriveRaceWarmIcons(): IconPrewarmEntry[] {
  const entries: IconPrewarmEntry[] = [];
  for (const icon of mortarOverdrivePickupSplashIcons()) {
    entries.push({ kind: icon.kind, id: icon.id, size: MORTAR_OVERDRIVE_SPLASH_ICON_SIZE });
  }
  for (const id of Object.keys(MORTAR_OVERDRIVE_ABILITIES)) entries.push({ kind: 'ability', id });
  const auraIcons = new Set(MORTAR_OVERDRIVE_SELF_AURAS.map((aura) => resolveHudAuraIconId(aura)));
  for (const id of auraIcons) entries.push({ kind: 'aura', id, mode: 'procedural' });
  return entries;
}

/** Where the warm sends its work; the HUD hands in the real engine and icon
 *  warmer (mortar_overdrive/hud_parts.ts), a test hands in spies. */
export interface MortarOverdriveRaceWarmSinks {
  preloadSfx(key: SfxId): void;
  prewarmIcons(entries: IconPrewarmEntry[]): void;
}

export class MortarOverdriveRaceWarm {
  private readonly latch = createMortarOverdrivePrepareLatch();
  private readonly commitment: MortarOverdriveCommitment = {
    queued: false,
    match: null,
    inBand: false,
    shot: false,
  };

  constructor(private readonly sinks: MortarOverdriveRaceWarmSinks) {}

  /** Why the warm ran, or null while it has not. */
  get reason(): MortarOverdrivePrepareReason | null {
    return this.latch.reason;
  }

  /** Per HUD frame: a no-op once warmed, one band test before. */
  step(world: Pick<IWorld, 'mortarOverdriveInfo' | 'player'>): void {
    if (this.latch.reason !== null) return;
    const info = world.mortarOverdriveInfo;
    const pos = world.player.pos;
    const commitment = this.commitment;
    commitment.queued = info.queued;
    commitment.match = info.match;
    commitment.inBand = isAtMortarOverdriveXZ(pos.x, pos.z);
    if (takeMortarOverdrivePrepare(this.latch, commitment) === null) return;
    commitment.match = null;
    for (const key of mortarOverdriveRaceWarmSfx()) this.sinks.preloadSfx(key);
    this.sinks.prewarmIcons(mortarOverdriveRaceWarmIcons());
  }
}
