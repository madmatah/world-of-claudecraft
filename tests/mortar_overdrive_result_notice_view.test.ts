import { describe, expect, it } from 'vitest';
import {
  type MortarOverdriveResultEvent,
  mortarOverdriveResultNotice,
} from '../src/ui/hud/mortar_overdrive/result_notice_view';
import { HUD_LOG } from '../src/ui/hud_tones';
import { t } from '../src/ui/i18n';

function result(over: Partial<MortarOverdriveResultEvent>): MortarOverdriveResultEvent {
  return {
    type: 'mortarOverdriveResult',
    won: false,
    forfeited: false,
    winnerName: 'Briar',
    placing: 2,
    gridSize: 4,
    returnTicks: 120,
    voided: false,
    ...over,
  };
}

describe('mortarOverdriveResultNotice', () => {
  it('tells a quitter whose race runs on that they quit, never that it was drawn', () => {
    expect(mortarOverdriveResultNotice(result({ forfeited: true, winnerName: '' }))).toEqual({
      banner: t('hudChrome.mortarOverdrive.bannerForfeit'),
      log: t('hudChrome.mortarOverdrive.logForfeitRaceOn'),
      logColor: HUD_LOG.RACE_FORFEIT,
    });
  });

  it('names the winner to a quitter only once there is one', () => {
    expect(mortarOverdriveResultNotice(result({ forfeited: true }))).toEqual({
      banner: t('hudChrome.mortarOverdrive.bannerLoss', { name: 'Briar' }),
      log: t('hudChrome.mortarOverdrive.logForfeit', { name: 'Briar' }),
      logColor: HUD_LOG.RACE_FORFEIT,
    });
  });

  it('calls a void heat void, for the survivor and the quitter alike', () => {
    const voidNotice = {
      banner: t('hudChrome.mortarOverdrive.raceVoid'),
      log: t('hudChrome.mortarOverdrive.raceVoid'),
      logColor: HUD_LOG.RACE_NOTICE,
    };
    expect(mortarOverdriveResultNotice(result({ voided: true, winnerName: '' }))).toEqual(
      voidNotice,
    );
    expect(
      mortarOverdriveResultNotice(result({ voided: true, forfeited: true, winnerName: '' })),
    ).toEqual(voidNotice);
  });

  it('keeps the draw, win and loss lines', () => {
    expect(mortarOverdriveResultNotice(result({ winnerName: '' })).banner).toBe(
      t('hudChrome.mortarOverdrive.bannerDraw'),
    );
    expect(mortarOverdriveResultNotice(result({ won: true, winnerName: 'Aster' }))).toEqual({
      banner: t('hudChrome.mortarOverdrive.bannerWin'),
      log: t('hudChrome.mortarOverdrive.logWin'),
      logColor: HUD_LOG.GOOD,
    });
    expect(mortarOverdriveResultNotice(result({}))).toEqual({
      banner: t('hudChrome.mortarOverdrive.bannerLoss', { name: 'Briar' }),
      log: t('hudChrome.mortarOverdrive.logLoss', { name: 'Briar' }),
      logColor: HUD_LOG.BAD,
    });
  });
});
