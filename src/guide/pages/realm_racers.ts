// Realm Racers: a spoiler-safe overview of the vehicle-circuit minigame at the
// Evergarden. The Evergarden Racing Society, how a race and a practice lap
// work, the loaned machine every pilot drives, the circuit pool, and what a
// pilot races for. Concepts only: no lap times, damage numbers, weapon
// cooldowns, or matchmaker internals.

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { loreBeat, pageHeader, related, section, sectionPair } from './ui';

export const realmRacers: GuidePage = {
  titleKey: 'guide.nav.realmRacers',
  render() {
    const circuits =
      loreBeat(
        'guide.realmRacersPage.circuitsPracticeTitle',
        'guide.realmRacersPage.circuitsPracticeBody',
      ) +
      loreBeat(
        'guide.realmRacersPage.circuitsCompetitionTitle',
        'guide.realmRacersPage.circuitsCompetitionBody',
      );
    return `
      <article class="guide-article guide-realm-racers">
        ${pageHeader('guide.realmRacersPage.heading', 'guide.realmRacersPage.intro')}
        ${sectionPair('guide.realmRacersPage.loreHeading', 'guide.realmRacersPage.loreBody')}
        ${section(
          'guide.realmRacersPage.howHeading',
          `<p>${esc(t('guide.realmRacersPage.howQueueBody'))}</p>` +
            `<p>${esc(t('guide.realmRacersPage.howRaceBody'))}</p>` +
            `<p>${esc(t('guide.realmRacersPage.howLimitsBody'))}</p>` +
            `<p>${esc(t('guide.realmRacersPage.howPracticeBody'))}</p>`,
        )}
        ${sectionPair('guide.realmRacersPage.machineHeading', 'guide.realmRacersPage.machineBody')}
        ${section(
          'guide.realmRacersPage.circuitsHeading',
          `<div class="guide-beat-grid">${circuits}</div>`,
        )}
        ${sectionPair('guide.realmRacersPage.rewardsHeading', 'guide.realmRacersPage.rewardsBody')}
        ${related([
          { href: hrefFor('how-to-play'), key: 'guide.nav.howToPlay' },
          { href: hrefFor('deeds'), key: 'guide.nav.deeds' },
        ])}
      </article>`;
  },
};
