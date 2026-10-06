// Mortar Overdrive: a spoiler-safe overview of the vehicle-circuit minigame at the
// Evergarden. The Evergarden Racing Society, how a race and a practice lap
// work, the loaned machine every pilot drives, the circuit pool, and what a
// pilot races for. Concepts only: no lap times, damage numbers, weapon
// cooldowns, or matchmaker internals.

import { esc } from '../../ui/esc';
import { t } from '../../ui/i18n';
import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { loreBeat, pageHeader, related, section, sectionPair } from './ui';

export const mortarOverdrive: GuidePage = {
  titleKey: 'guide.nav.mortarOverdrive',
  render() {
    const circuits =
      loreBeat(
        'guide.mortarOverdrivePage.circuitsPracticeTitle',
        'guide.mortarOverdrivePage.circuitsPracticeBody',
      ) +
      loreBeat(
        'guide.mortarOverdrivePage.circuitsCompetitionTitle',
        'guide.mortarOverdrivePage.circuitsCompetitionBody',
      );
    return `
      <article class="guide-article guide-mortar-overdrive">
        ${pageHeader('guide.mortarOverdrivePage.heading', 'guide.mortarOverdrivePage.intro')}
        ${sectionPair('guide.mortarOverdrivePage.loreHeading', 'guide.mortarOverdrivePage.loreBody')}
        ${section(
          'guide.mortarOverdrivePage.howHeading',
          `<p>${esc(t('guide.mortarOverdrivePage.howQueueBody'))}</p>` +
            `<p>${esc(t('guide.mortarOverdrivePage.howRaceBody'))}</p>` +
            `<p>${esc(t('guide.mortarOverdrivePage.howLimitsBody'))}</p>` +
            `<p>${esc(t('guide.mortarOverdrivePage.howPracticeBody'))}</p>`,
        )}
        ${sectionPair('guide.mortarOverdrivePage.machineHeading', 'guide.mortarOverdrivePage.machineBody')}
        ${section(
          'guide.mortarOverdrivePage.circuitsHeading',
          `<div class="guide-beat-grid">${circuits}</div>`,
        )}
        ${sectionPair('guide.mortarOverdrivePage.rewardsHeading', 'guide.mortarOverdrivePage.rewardsBody')}
        ${related([
          { href: hrefFor('how-to-play'), key: 'guide.nav.howToPlay' },
          { href: hrefFor('deeds'), key: 'guide.nav.deeds' },
        ])}
      </article>`;
  },
};
