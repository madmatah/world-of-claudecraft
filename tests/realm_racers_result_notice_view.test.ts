import { describe, expect, it } from 'vitest';
import { HUD_LOG } from '../src/ui/hud_tones';
import { t } from '../src/ui/i18n';
import {
  type RealmRacersResultEvent,
  realmRacersResultNotice,
} from '../src/ui/realm_racers_result_notice_view';

function result(over: Partial<RealmRacersResultEvent>): RealmRacersResultEvent {
  return {
    type: 'realmRacersResult',
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

describe('realmRacersResultNotice', () => {
  it('tells a quitter whose race runs on that they quit, never that it was drawn', () => {
    expect(realmRacersResultNotice(result({ forfeited: true, winnerName: '' }))).toEqual({
      banner: t('hudChrome.rally.bannerForfeit'),
      log: t('hudChrome.rally.logForfeitRaceOn'),
      logColor: HUD_LOG.RACE_FORFEIT,
    });
  });

  it('names the winner to a quitter only once there is one', () => {
    expect(realmRacersResultNotice(result({ forfeited: true }))).toEqual({
      banner: t('hudChrome.rally.bannerLoss', { name: 'Briar' }),
      log: t('hudChrome.rally.logForfeit', { name: 'Briar' }),
      logColor: HUD_LOG.RACE_FORFEIT,
    });
  });

  it('calls a void heat void, for the survivor and the quitter alike', () => {
    const voidNotice = {
      banner: t('hudChrome.rally.raceVoid'),
      log: t('hudChrome.rally.raceVoid'),
      logColor: HUD_LOG.RACE_NOTICE,
    };
    expect(realmRacersResultNotice(result({ voided: true, winnerName: '' }))).toEqual(voidNotice);
    expect(
      realmRacersResultNotice(result({ voided: true, forfeited: true, winnerName: '' })),
    ).toEqual(voidNotice);
  });

  it('keeps the draw, win and loss lines', () => {
    expect(realmRacersResultNotice(result({ winnerName: '' })).banner).toBe(
      t('hudChrome.rally.bannerDraw'),
    );
    expect(realmRacersResultNotice(result({ won: true, winnerName: 'Aster' }))).toEqual({
      banner: t('hudChrome.rally.bannerWin'),
      log: t('hudChrome.rally.logWin'),
      logColor: HUD_LOG.GOOD,
    });
    expect(realmRacersResultNotice(result({}))).toEqual({
      banner: t('hudChrome.rally.bannerLoss', { name: 'Briar' }),
      log: t('hudChrome.rally.logLoss', { name: 'Briar' }),
      logColor: HUD_LOG.BAD,
    });
  });
});
