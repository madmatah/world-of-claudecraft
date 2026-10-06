// The banner and combat-log line a pilot's own Mortar Overdrive result earns. Pure:
// it picks the words and the log register from the result event, and the HUD
// only paints them. Order matters: a void heat outranks everything, and a
// quitter whose race runs on (no winner yet) is told they quit, never that the
// race was drawn.

import type { SimEvent } from '../../../sim/types';
import { HUD_LOG } from '../../hud_tones';
import { t } from '../../i18n';

export type MortarOverdriveResultEvent = Extract<SimEvent, { type: 'mortarOverdriveResult' }>;

export interface MortarOverdriveResultNotice {
  banner: string;
  log: string;
  logColor: string;
}

export function mortarOverdriveResultNotice(
  ev: MortarOverdriveResultEvent,
): MortarOverdriveResultNotice {
  if (ev.voided) {
    const text = t('hudChrome.mortarOverdrive.raceVoid');
    return { banner: text, log: text, logColor: HUD_LOG.RACE_NOTICE };
  }
  if (ev.forfeited && !ev.winnerName) {
    return {
      banner: t('hudChrome.mortarOverdrive.bannerForfeit'),
      log: t('hudChrome.mortarOverdrive.logForfeitRaceOn'),
      logColor: HUD_LOG.RACE_FORFEIT,
    };
  }
  if (!ev.winnerName) {
    const text = t('hudChrome.mortarOverdrive.bannerDraw');
    return { banner: text, log: text, logColor: HUD_LOG.RACE_NOTICE };
  }
  if (ev.won) {
    return {
      banner: t('hudChrome.mortarOverdrive.bannerWin'),
      log: t('hudChrome.mortarOverdrive.logWin'),
      logColor: HUD_LOG.GOOD,
    };
  }
  const name = { name: ev.winnerName };
  return {
    banner: t('hudChrome.mortarOverdrive.bannerLoss', name),
    log: ev.forfeited
      ? t('hudChrome.mortarOverdrive.logForfeit', name)
      : t('hudChrome.mortarOverdrive.logLoss', name),
    logColor: ev.forfeited ? HUD_LOG.RACE_FORFEIT : HUD_LOG.BAD,
  };
}
