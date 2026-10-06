// WCAG 2.2 AA gate for the Mortar Overdrive in-race HUD: axe-core over the race
// strip and the standings panel, painted by their real painters with the real
// style barrel, mid-race with every status line up. The standings list keeps
// its list semantics (a live-region role on the <ol> took them away), and the
// strip container is no status region over its own controls.

import { afterEach, describe, expect, it } from 'vitest';
import type { MortarOverdriveHudView } from '../../src/ui/hud/mortar_overdrive/race_view';
import { MortarOverdriveStandingsPanel } from '../../src/ui/hud/mortar_overdrive/standings_painter';
import { buildMortarOverdriveStandingsView } from '../../src/ui/hud/mortar_overdrive/standings_view';
import { MortarOverdriveStrip } from '../../src/ui/hud/mortar_overdrive/strip_painter';
import { makeWriterFacet } from '../../src/ui/painter_host';
import type { MortarOverdriveMatchInfo } from '../../src/world_api';
import { axeSeriousViolations, cleanup, formatViolations } from './_harness';

afterEach(cleanup);

const racer = (pid: number, position: number, name: string) => ({
  pid,
  name,
  cls: 'warrior' as const,
  lap: 2,
  finished: false,
  botTier: null,
  position,
  finishSeconds: null,
  retired: false,
});

function liveMatch(): MortarOverdriveMatchInfo {
  const standings = [racer(2, 1, 'Briar'), racer(1, 2, 'Aster'), racer(3, 3, 'Cass')];
  return {
    id: 7,
    circuitId: 'evergarden_express_tour',
    participantIds: [1, 2, 3],
    phase: 'racing',
    countdown: 0,
    countdownTicks: 0,
    elapsed: 65,
    elapsedTicks: 1300,
    chaseIn: 0,
    returnIn: 0,
    me: standings[1],
    standings,
    gridSize: 3,
    decided: false,
    speed: 31,
    wrongWay: true,
    offTrackIn: 3,
    cutReturned: false,
    pickupsTaken: [],
    slicks: [],
    warded: true,
    resetLocked: false,
    totalLaps: 3,
    practice: false,
    result: null,
  } as unknown as MortarOverdriveMatchInfo;
}

const strip: MortarOverdriveHudView = {
  active: true,
  circuitId: 'evergarden_express_tour',
  phase: 'racing',
  countdown: 0,
  lap: 2,
  totalLaps: 3,
  position: 2,
  gridSize: 3,
  elapsed: 65,
  speed: 31,
  wrongWay: true,
  trackLimit: 'offTrack',
  offTrackIn: 3,
  warded: true,
  wardIn: 4,
  chaseIn: 0,
  decided: false,
  voided: false,
  result: null,
  returnIn: 0,
  canForfeit: true,
  canReset: true,
  resetLocked: false,
  sig: '7|3|quit|reset',
};

describe('Mortar Overdrive in-race HUD accessibility', () => {
  it('has no serious or critical axe violations mid-race', async () => {
    const layer = document.createElement('div');
    layer.id = 'ui';
    document.body.appendChild(layer);
    const noop = (): void => {};
    const writers = makeWriterFacet(new Map(), new Map(), new Map(), new Map(), noop, noop);
    const standings = new MortarOverdriveStandingsPanel({ layer: () => layer, writers });
    const hud = new MortarOverdriveStrip({
      layer: () => layer,
      writers,
      reset: noop,
      forfeit: noop,
      now: () => 0,
    });
    hud.update(strip);
    standings.update(buildMortarOverdriveStandingsView(liveMatch()));
    const list = layer.querySelector('#mortar-overdrive-standings') as HTMLElement;
    expect(list.querySelectorAll('li').length).toBe(3);
    const violations = await axeSeriousViolations(layer);
    expect(violations, formatViolations(violations)).toEqual([]);
    expect(list.getAttribute('role')).toBeNull();
    expect(layer.querySelector('#mortar-overdrive-hud')?.getAttribute('role')).toBeNull();
  });
});
