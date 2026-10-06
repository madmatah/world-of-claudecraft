// The HUD's routing of the Mortar Overdrive sim events: the queue log lines, the
// flag, lap and result banners, the pickup note and splash, and the cues. Hud
// members are private, so the router takes the Hud untyped (the
// quest_event_router.ts precedent); the members it reads are welded to hud.ts
// in tests/mortar_overdrive_ui.test.ts.
import { audio } from '../../../game/audio';
import { playMortarOverdriveResultAudio } from '../../../game/mortar_overdrive/audio_routing';
import type { SimEvent } from '../../../sim/types';
import { HUD_LOG } from '../../hud_tones';
import { formatNumber, t } from '../../i18n';
import { mortarOverdrivePickupEffectText } from './pickup_i18n';
import type { MortarOverdrivePickupSplash } from './pickup_splash_controller';
import { mortarOverdriveResultNotice } from './result_notice_view';

/** The private Hud members the router drives. */
interface MortarOverdriveEventHost {
  sim: { playerId: number };
  log(text: string, color?: string): void;
  showBanner(text: string): void;
  showSelfNote(text: string): void;
  combatLog(text: string, color?: string): void;
  mortarOverdriveSplash: Pick<MortarOverdrivePickupSplash, 'show'>;
}

/** Present one sim event through the Mortar Overdrive channels. True when it was a Mortar Overdrive
 *  event, so the HUD's per-event switch skips it. */
export function applyMortarOverdriveEventPresentation(hud: object, ev: SimEvent): boolean {
  const h = hud as MortarOverdriveEventHost;
  const sim = h.sim;
  switch (ev.type) {
    case 'mortarOverdriveQueued':
      if (ev.pid === sim.playerId) {
        h.log(
          t('hudChrome.mortarOverdrive.logQueued', {
            position: formatNumber(ev.position, { maximumFractionDigits: 0 }),
          }),
          HUD_LOG.RACE_NOTICE,
        );
      }
      return true;
    case 'mortarOverdriveUnqueued':
      if (ev.pid === sim.playerId)
        h.log(t('hudChrome.mortarOverdrive.logUnqueued'), HUD_LOG.RACE_NOTICE);
      return true;
    case 'mortarOverdriveFound':
      // The CUE only: the circuit banner is driven from STATE by
      // `MortarOverdriveUi`, since this event reaches the client one frame
      // before the snapshot that carries the circuit.
      if (ev.pid === sim.playerId) audio.mortarOverdriveFound();
      return true;
    case 'mortarOverdriveGo':
      // Cue only: the race strip already reads GO! on this frame, and a banner
      // above it would show the word twice.
      if (ev.pid === sim.playerId) audio.mortarOverdriveGo();
      return true;
    case 'mortarOverdriveReset':
      // A silent recovery marker for the online position predictor.
      return true;
    case 'mortarOverdriveLap':
      if (ev.pid === sim.playerId) {
        h.showBanner(
          t('hudChrome.mortarOverdrive.bannerLap', {
            lap: formatNumber(ev.lap, { maximumFractionDigits: 0 }),
            total: formatNumber(ev.totalLaps, { maximumFractionDigits: 0 }),
          }),
        );
        audio.mortarOverdriveLap();
      }
      return true;
    // A box just gave this pilot something. It floats over their own machine
    // rather than taking the banner: a take happens every few seconds, the
    // pilot is steering while it lands, and the banner belongs to the three
    // moments that stop a race (the flag, a lap, the result). The event
    // carries the EFFECT and the words are resolved here.
    case 'mortarOverdrivePickup':
      if (ev.pid === sim.playerId) {
        h.showSelfNote(mortarOverdrivePickupEffectText(ev.effect));
        h.mortarOverdriveSplash.show(ev.effect);
      }
      return true;
    // And the ward paying for itself, on the same surface: a shell that
    // lands on a warded machine and does nothing has to say why.
    case 'mortarOverdriveWardBroken':
      if (ev.pid === sim.playerId) h.showSelfNote(t('hudChrome.mortarOverdrive.wardBroken'));
      return true;
    case 'mortarOverdriveGroundBlastFired':
    case 'mortarOverdriveGroundBlastHit':
      return true;
    // Contact and oil are rendered in the world (sparks, puff, ring, shake),
    // never in the HUD: a banner on every nudge would bury the lap and
    // result lines.
    case 'mortarOverdriveBump':
    case 'mortarOverdriveSlicked':
      return true;
    case 'mortarOverdriveResult': {
      if (ev.pid !== sim.playerId) return true;
      const notice = mortarOverdriveResultNotice(ev);
      h.showBanner(notice.banner);
      h.combatLog(notice.log, notice.logColor);
      playMortarOverdriveResultAudio(ev, sim.playerId, audio);
      return true;
    }
    default:
      return false;
  }
}
