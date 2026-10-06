// The circuit HOUR seam: `MortarOverdriveCircuit.timeOfDay`, the vocabulary that
// names it sim-side, and the phase it resolves to render-side.
//
// The contract is the theme's, one field over: ids resolve both ways, an id
// nobody authored falls back rather than breaking a draft, and the record can
// never overrule the dev override. The claims about what each hour LOOKS like
// are pinned through `day_night_core` itself rather than restated here, so a
// change to the cycle that moved noon into the dark would fail here too.

import { describe, expect, it } from 'vitest';
import {
  aboveHorizon,
  globalDayness,
  nightStarAmount,
  sunDirection,
} from '../src/render/day_night_core';
import {
  MORTAR_OVERDRIVE_TIME_OF_DAY_PHASE,
  mortarOverdriveAuthoredPhase,
  mortarOverdriveDaylight,
} from '../src/render/mortar_overdrive/daylight_core';
import { lampGlowAmount, nightLightAmount } from '../src/render/night_lighting_core';
import { MORTAR_OVERDRIVE_TIME_OF_DAY_IDS } from '../src/sim/content/mortar_overdrive/circuits';

const LIVE = 0.42;

describe('mortar overdrive time-of-day vocabulary', () => {
  it('resolves every authored id to a phase, and authors every phase it resolves', () => {
    for (const id of MORTAR_OVERDRIVE_TIME_OF_DAY_IDS) {
      expect(MORTAR_OVERDRIVE_TIME_OF_DAY_PHASE[id], `no phase for '${id}'`).toBeTypeOf('number');
    }
    expect([...Object.keys(MORTAR_OVERDRIVE_TIME_OF_DAY_PHASE)].sort()).toEqual(
      [...MORTAR_OVERDRIVE_TIME_OF_DAY_IDS].sort(),
    );
  });

  it('keeps every phase inside the cycle', () => {
    for (const phase of Object.values(MORTAR_OVERDRIVE_TIME_OF_DAY_PHASE)) {
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(1);
    }
  });

  it('answers the phase for a known hour and null for anything else', () => {
    expect(mortarOverdriveAuthoredPhase('noon')).toBe(MORTAR_OVERDRIVE_TIME_OF_DAY_PHASE.noon);
    expect(mortarOverdriveAuthoredPhase(undefined)).toBeNull();
    // An id being written in the same change stays drivable: it falls back to
    // the world clock, and the metrics readout is what names it.
    expect(mortarOverdriveAuthoredPhase('eclipse')).toBeNull();
  });
});

describe('which hour lights a circuit frame', () => {
  it('takes the world clock when the circuit authors none', () => {
    expect(mortarOverdriveDaylight(undefined, LIVE, null)).toEqual({
      phase: LIVE,
      authored: false,
    });
  });

  it('takes the circuit hour over the world clock', () => {
    expect(mortarOverdriveDaylight('midnight', LIVE, null)).toEqual({
      phase: MORTAR_OVERDRIVE_TIME_OF_DAY_PHASE.midnight,
      authored: true,
    });
  });

  it('lets the dev override win over an authored hour, still flagged authored', () => {
    // `/daynight` is how a circuit's dressing is checked at an hour it will
    // never ship at; a record that could overrule it would make it useless.
    // `authored` stays true so the tier-neutral arms keep running under it.
    expect(mortarOverdriveDaylight('noon', LIVE, 0.9)).toEqual({ phase: 0.9, authored: true });
  });

  it('lets the dev override win where no hour is authored', () => {
    expect(mortarOverdriveDaylight(undefined, LIVE, 0.9)).toEqual({ phase: 0.9, authored: false });
  });

  it('treats an unknown id as no hour at all rather than a hidden default', () => {
    expect(mortarOverdriveDaylight('eclipse', LIVE, null)).toEqual({
      phase: LIVE,
      authored: false,
    });
  });
});

describe('what each authored hour looks like through the cycle', () => {
  const phaseOf = (id: string): number => {
    const phase = MORTAR_OVERDRIVE_TIME_OF_DAY_PHASE[id];
    if (phase === undefined) throw new Error(`no phase for '${id}'`);
    return phase;
  };

  it('stands noon at full daylight and midnight at none', () => {
    expect(globalDayness(phaseOf('noon'))).toBeCloseTo(1, 5);
    expect(globalDayness(phaseOf('midnight'))).toBeCloseTo(0, 5);
  });

  it('orders the daylight hours brightest at noon', () => {
    expect(globalDayness(phaseOf('morning'))).toBeLessThan(globalDayness(phaseOf('noon')));
    expect(globalDayness(phaseOf('afternoon'))).toBeLessThan(globalDayness(phaseOf('noon')));
    expect(globalDayness(phaseOf('morning'))).toBeGreaterThan(globalDayness(phaseOf('dusk')));
  });

  it('puts dawn and dusk ON the horizon crossing, where the warm grade peaks', () => {
    // The sun sits at the horizon at both, which is what makes them worth
    // staging a race at: long shadows and the cycle's own sunrise orange.
    expect(sunDirection(phaseOf('dawn'))[1]).toBeCloseTo(0, 5);
    expect(sunDirection(phaseOf('dusk'))[1]).toBeCloseTo(0, 5);
    expect(aboveHorizon(sunDirection(phaseOf('noon'))[1])).toBe(1);
  });

  it('makes night dark enough that the lamps carry the road, and starlit', () => {
    const night = globalDayness(phaseOf('night'));
    expect(lampGlowAmount(nightLightAmount(1 - night, true))).toBe(1);
    expect(nightStarAmount(night)).toBeGreaterThan(0.5);
    // ...and still the EVENING rather than the black hour: midnight is darker,
    // which is the whole reason both are in the vocabulary.
    expect(night).toBeGreaterThan(globalDayness(phaseOf('midnight')));
  });

  it('leaves the daylight hours with the lamps out', () => {
    for (const id of ['morning', 'noon', 'afternoon']) {
      expect(lampGlowAmount(nightLightAmount(1 - globalDayness(phaseOf(id)), true))).toBe(0);
    }
  });
});
