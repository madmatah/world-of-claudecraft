// The deps of the Realm Racers HUD parts Hud composes: the pickup splash and the
// race UI (window, strip, lobby). Built from the Hud untyped (the quest_event_router.ts
// precedent), since the deps read private Hud members; they are welded to
// hud.ts in tests/realm_racers_ui.test.ts.
import { audio } from '../../../game/audio';
import { sfx } from '../../../game/sfx';
import { setArrivalCover } from '../../../render/arrival_cover';
import type { RealmRacersPrepareProgress } from '../../../render/realm_racers_prepare';
import type { IWorld } from '../../../world_api';
import { prewarmIconCache } from '../../icon_prewarm';
import { iconDataUrl } from '../../icons';
import type { PainterHostWriters } from '../../painter_host';
import type { RealmRacersDeps } from '../../realm_racers';
import {
  type RallyPickupSplashDeps,
  RealmRacersPickupSplash,
} from '../../realm_racers_pickup_splash_controller';
import { RALLY_SPLASH_ICON_SIZE } from '../../realm_racers_pickup_splash_view';
import { rallyControlKeys } from '../../realm_racers_view';

/** The private Hud members the parts read. */
interface RealmRacersPartsHost {
  sim: IWorld;
  renderer: {
    realmRacers: {
      prepare: {
        progress(
          out: RealmRacersPrepareProgress,
          circuitId: string | null,
        ): RealmRacersPrepareProgress;
      };
    };
  };
  keybinds: { primaryLabel(bind: string): string };
  writerFacet: PainterHostWriters;
  realmRacersSplash: RealmRacersPickupSplash;
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
export function realmRacersSplashDeps(hud: object): RallyPickupSplashDeps {
  const h = hud as RealmRacersPartsHost;
  return {
    layer: () => document.getElementById('ui'),
    writers: h.writerFacet,
    iconUrl: (icon) => iconDataUrl(icon.kind, icon.id, RALLY_SPLASH_ICON_SIZE),
    schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
    cancel: (handle) => window.clearTimeout(handle),
  };
}

/** The pickup splash Hud owns, built from its own deps (one field initializer). */
export function createRealmRacersSplash(hud: object): RealmRacersPickupSplash {
  return new RealmRacersPickupSplash(realmRacersSplashDeps(hud));
}

export function realmRacersUiDeps(hud: object): RealmRacersDeps {
  const h = hud as RealmRacersPartsHost;
  return {
    root: () => document.querySelector('#realm-racers-window') as HTMLElement,
    layer: () => document.getElementById('ui'),
    world: () => h.sim,
    closeOthers: () => h.closeOtherWindows('#realm-racers-window'),
    // The rally's practice tutorial teaches the keys the player ACTUALLY has,
    // so the binding lookup is resolved here (the rally module never reaches
    // into the game layer's keybind profile) and the touch HUD is told to drop
    // the key column entirely.
    controlKeys: (action) => rallyControlKeys(action, (bind) => h.keybinds.primaryLabel(bind)),
    isTouchHud: () => document.body.classList.contains('mobile-touch'),
    countdownTick: () => audio.realmRacersCountdownTick(),
    showBanner: (text) => h.showBanner(text),
    // The race UI owns the match-end edge; the splash it clears is this class's.
    clearPickupSplash: () => h.realmRacersSplash.clear(),
    writers: h.writerFacet,
    prepareProgress: (out, circuitId) => h.renderer.realmRacers.prepare.progress(out, circuitId),
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
    ...h.windowFocus('#realm-racers-window'),
  };
}
