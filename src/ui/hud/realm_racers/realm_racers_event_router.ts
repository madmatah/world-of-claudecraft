// The HUD's routing of the Realm Racers sim events: the queue log lines, the
// flag, lap and result banners, the pickup note and splash, and the cues. Hud
// members are private, so the router takes the Hud untyped (the
// quest_event_router.ts precedent); the members it reads are welded to hud.ts
// in tests/realm_racers_ui.test.ts.
import { audio } from '../../../game/audio';
import { playRealmRacersResultAudio } from '../../../game/realm_racers_audio_routing';
import type { SimEvent } from '../../../sim/types';
import { HUD_LOG } from '../../hud_tones';
import { formatNumber, t } from '../../i18n';
import { realmRacersPickupEffectText } from '../../realm_racers_pickup_i18n';
import type { RealmRacersPickupSplash } from '../../realm_racers_pickup_splash_controller';
import { realmRacersResultNotice } from '../../realm_racers_result_notice_view';

/** The private Hud members the router drives. */
interface RealmRacersEventHost {
  sim: { playerId: number };
  log(text: string, color?: string): void;
  showBanner(text: string): void;
  showSelfNote(text: string): void;
  combatLog(text: string, color?: string): void;
  realmRacersSplash: Pick<RealmRacersPickupSplash, 'show'>;
}

/** Present one sim event through the rally channels. True when it was a rally
 *  event, so the HUD's per-event switch skips it. */
export function applyRealmRacersEventPresentation(hud: object, ev: SimEvent): boolean {
  const h = hud as RealmRacersEventHost;
  const sim = h.sim;
  switch (ev.type) {
    case 'realmRacersQueued':
      if (ev.pid === sim.playerId) {
        h.log(
          t('hudChrome.rally.logQueued', {
            position: formatNumber(ev.position, { maximumFractionDigits: 0 }),
          }),
          HUD_LOG.RACE_NOTICE,
        );
      }
      return true;
    case 'realmRacersUnqueued':
      if (ev.pid === sim.playerId) h.log(t('hudChrome.rally.logUnqueued'), HUD_LOG.RACE_NOTICE);
      return true;
    case 'realmRacersFound':
      // The CUE only: the circuit banner is driven from STATE by
      // `RealmRacersUi`, since this event reaches the client one frame
      // before the snapshot that carries the circuit.
      if (ev.pid === sim.playerId) audio.realmRacersFound();
      return true;
    case 'realmRacersGo':
      // Cue only: the race strip already reads GO! on this frame, and a banner
      // above it would show the word twice.
      if (ev.pid === sim.playerId) audio.realmRacersGo();
      return true;
    case 'realmRacersReset':
      // A silent recovery marker for the online position predictor.
      return true;
    case 'realmRacersLap':
      if (ev.pid === sim.playerId) {
        h.showBanner(
          t('hudChrome.rally.bannerLap', {
            lap: formatNumber(ev.lap, { maximumFractionDigits: 0 }),
            total: formatNumber(ev.totalLaps, { maximumFractionDigits: 0 }),
          }),
        );
        audio.realmRacersLap();
      }
      return true;
    // A box just gave this pilot something. It floats over their own machine
    // rather than taking the banner: a take happens every few seconds, the
    // pilot is steering while it lands, and the banner belongs to the three
    // moments that stop a race (the flag, a lap, the result). The event
    // carries the EFFECT and the words are resolved here.
    case 'realmRacersPickup':
      if (ev.pid === sim.playerId) {
        h.showSelfNote(realmRacersPickupEffectText(ev.effect));
        h.realmRacersSplash.show(ev.effect);
      }
      return true;
    // And the ward paying for itself, on the same surface: a shell that
    // lands on a warded machine and does nothing has to say why.
    case 'realmRacersWardBroken':
      if (ev.pid === sim.playerId) h.showSelfNote(t('hudChrome.rally.wardBroken'));
      return true;
    case 'realmRacersGroundBlastFired':
    case 'realmRacersGroundBlastHit':
      return true;
    // Contact and oil are rendered in the world (sparks, puff, ring, shake),
    // never in the HUD: a banner on every nudge would bury the lap and
    // result lines.
    case 'realmRacersBump':
    case 'realmRacersSlicked':
      return true;
    case 'realmRacersResult': {
      if (ev.pid !== sim.playerId) return true;
      const notice = realmRacersResultNotice(ev);
      h.showBanner(notice.banner);
      h.combatLog(notice.log, notice.logColor);
      playRealmRacersResultAudio(ev, sim.playerId, audio);
      return true;
    }
    default:
      return false;
  }
}
