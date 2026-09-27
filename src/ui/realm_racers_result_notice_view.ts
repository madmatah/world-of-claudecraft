// The banner and combat-log line a pilot's own Realm Racers result earns. Pure:
// it picks the words and the log register from the result event, and the HUD
// only paints them. Order matters: a void heat outranks everything, and a
// quitter whose race runs on (no winner yet) is told they quit, never that the
// race was drawn.

import type { SimEvent } from '../sim/types';
import { HUD_LOG } from './hud_tones';
import { t } from './i18n';

export type RealmRacersResultEvent = Extract<SimEvent, { type: 'realmRacersResult' }>;

export interface RealmRacersResultNotice {
  banner: string;
  log: string;
  logColor: string;
}

export function realmRacersResultNotice(ev: RealmRacersResultEvent): RealmRacersResultNotice {
  if (ev.voided) {
    const text = t('hudChrome.rally.raceVoid');
    return { banner: text, log: text, logColor: HUD_LOG.RACE_NOTICE };
  }
  if (ev.forfeited && !ev.winnerName) {
    return {
      banner: t('hudChrome.rally.bannerForfeit'),
      log: t('hudChrome.rally.logForfeitRaceOn'),
      logColor: HUD_LOG.RACE_FORFEIT,
    };
  }
  if (!ev.winnerName) {
    const text = t('hudChrome.rally.bannerDraw');
    return { banner: text, log: text, logColor: HUD_LOG.RACE_NOTICE };
  }
  if (ev.won) {
    return {
      banner: t('hudChrome.rally.bannerWin'),
      log: t('hudChrome.rally.logWin'),
      logColor: HUD_LOG.GOOD,
    };
  }
  const name = { name: ev.winnerName };
  return {
    banner: t('hudChrome.rally.bannerLoss', name),
    log: ev.forfeited ? t('hudChrome.rally.logForfeit', name) : t('hudChrome.rally.logLoss', name),
    logColor: ev.forfeited ? HUD_LOG.RACE_FORFEIT : HUD_LOG.BAD,
  };
}
