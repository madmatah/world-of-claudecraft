// The deps of the Mortar Overdrive HUD parts Hud composes: the pickup splash and the
// race UI (window, strip, lobby). Built from the Hud untyped (the quest_event_router.ts
// precedent), since the deps read private Hud members; they are welded to
// hud.ts in tests/mortar_overdrive_ui.test.ts.
import { audio } from '../../../game/audio';
import { sfx } from '../../../game/sfx';
import { setArrivalCover } from '../../../render/arrival_cover';
import type { MortarOverdrivePrepareProgress } from '../../../render/mortar_overdrive';
import type { IWorld } from '../../../world_api';
import { prewarmIconCache } from '../../icon_prewarm';
import { iconDataUrl } from '../../icons';
import type { PainterHostWriters } from '../../painter_host';
import type { MortarOverdriveDeps } from './composer';
import {
  MortarOverdrivePickupSplash,
  type MortarOverdrivePickupSplashDeps,
} from './pickup_splash_controller';
import { MORTAR_OVERDRIVE_SPLASH_ICON_SIZE } from './pickup_splash_view';
import { mortarOverdriveControlKeys } from './race_view';

/** The private Hud members the parts read. */
interface MortarOverdrivePartsHost {
  sim: IWorld;
  renderer: {
    mortarOverdrive: {
      prepare: {
        progress(
          out: MortarOverdrivePrepareProgress,
          circuitId: string | null,
          matchId: number | null,
        ): MortarOverdrivePrepareProgress;
      };
    };
  };
  keybinds: { primaryLabel(bind: string): string };
  writerFacet: PainterHostWriters;
  mortarOverdriveSplash: MortarOverdrivePickupSplash;
  closeOtherWindows(keep?: string | string[]): void;
  showBanner(text: string): void;
  windowFocus(rootSel: string): {
    captureFocus: () => HTMLElement | null;
    restoreFocus: (target: HTMLElement | null) => void;
  };
}

/**
 * The pickup splash: the big kart-racer flash of what a box just gave. Event
 * driven (see the module header), so it costs the frame loop nothing; the FCT
 * note beside it stays as the quiet line and the held-ability slot stays as
 * the state.
 */
export function mortarOverdriveSplashDeps(hud: object): MortarOverdrivePickupSplashDeps {
  const h = hud as MortarOverdrivePartsHost;
  return {
    layer: () => document.getElementById('ui'),
    writers: h.writerFacet,
    iconUrl: (icon) => iconDataUrl(icon.kind, icon.id, MORTAR_OVERDRIVE_SPLASH_ICON_SIZE),
    schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
    cancel: (handle) => window.clearTimeout(handle),
  };
}

/** The pickup splash Hud owns, built from its own deps (one field initializer). */
export function createMortarOverdriveSplash(hud: object): MortarOverdrivePickupSplash {
  return new MortarOverdrivePickupSplash(mortarOverdriveSplashDeps(hud));
}

export function mortarOverdriveUiDeps(hud: object): MortarOverdriveDeps {
  const h = hud as MortarOverdrivePartsHost;
  return {
    root: () => document.querySelector('#mortar-overdrive-window') as HTMLElement,
    layer: () => document.getElementById('ui'),
    world: () => h.sim,
    closeOthers: () => h.closeOtherWindows('#mortar-overdrive-window'),
    // Mortar Overdrive's practice tutorial teaches the keys the player ACTUALLY has,
    // so the binding lookup is resolved here (the Mortar Overdrive module never reaches
    // into the game layer's keybind profile) and the touch HUD is told to drop
    // the key column entirely.
    controlKeys: (action) =>
      mortarOverdriveControlKeys(action, (bind) => h.keybinds.primaryLabel(bind)),
    isTouchHud: () => document.body.classList.contains('mobile-touch'),
    countdownTick: () => audio.mortarOverdriveCountdownTick(),
    showBanner: (text) => h.showBanner(text),
    // The race UI owns the match-end edge; the splash it clears is this class's.
    clearPickupSplash: () => h.mortarOverdriveSplash.clear(),
    writers: h.writerFacet,
    prepareProgress: (out, circuitId, matchId) =>
      h.renderer.mortarOverdrive.prepare.progress(out, circuitId, matchId),
    // The lobby curtain's arrival-cover depth: the render-side cover reaches
    // the painter through this seam rather than a default import of its own.
    setArrivalCover,
    raceWarm: {
      preloadSfx: (key) => sfx.preload(key),
      // Eager: an idle-only pump can starve behind a busy lobby, and each
      // encode runs in the worker anyway.
      prewarmIcons: (entries) => {
        prewarmIconCache(entries, { eagerCount: entries.length });
      },
    },
    ...h.windowFocus('#mortar-overdrive-window'),
  };
}
