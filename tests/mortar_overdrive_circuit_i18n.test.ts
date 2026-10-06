// The circuit-id-to-name resolver every Mortar Overdrive surface shares.

import { describe, expect, it } from 'vitest';
import {
  MORTAR_OVERDRIVE_CIRCUIT_LIST,
  MORTAR_OVERDRIVE_PRACTICE_CIRCUIT_ID,
} from '../src/sim/content/mortar_overdrive/circuits';
import { mortarOverdriveCircuitName } from '../src/ui/hud/mortar_overdrive/circuit_i18n';

describe('Mortar Overdrive circuit names', () => {
  it('names EVERY authored circuit', () => {
    // The rule is the reason this resolver exists: authoring a circuit and
    // authoring its name are one edit in two files, and a circuit that reaches
    // a player unnamed is a defect this catches at the table rather than in a
    // seat. Not vacuous: the pool is more than one circuit.
    expect(MORTAR_OVERDRIVE_CIRCUIT_LIST.length).toBeGreaterThan(1);
    for (const circuit of MORTAR_OVERDRIVE_CIRCUIT_LIST) {
      const name = mortarOverdriveCircuitName(circuit.id);
      expect(name, `${circuit.id} has no name`).toBeTruthy();
      // And the name is COPY, never the id dressed up.
      expect(name).not.toBe(circuit.id);
      expect(name).not.toContain('_');
    }
  });

  it('gives the five shipped circuits their authored names', () => {
    expect(mortarOverdriveCircuitName(MORTAR_OVERDRIVE_PRACTICE_CIRCUIT_ID)).toBe(
      'Evergarden Bootcamp',
    );
    expect(mortarOverdriveCircuitName('evergarden_express_tour')).toBe('Evergarden Express Tour');
    expect(mortarOverdriveCircuitName('nightbloom_moonwell_run')).toBe('Nightbloom Moonspring Run');
    expect(mortarOverdriveCircuitName('drakelands_rampart_run')).toBe('Drakelands Rampart Run');
    expect(mortarOverdriveCircuitName('palmreach_lagoon_run')).toBe('Palmreach Lagoon Run');
  });

  it('answers null for a circuit nothing names, rather than throwing or leaking an id', () => {
    // A DRAFT circuit registered by a dev command resolves through
    // `mortarOverdriveCircuitById` and has no catalog key. `t()` would throw on it
    // in dev and test; every caller hides its line on null instead.
    expect(mortarOverdriveCircuitName('a_draft_somebody_drew')).toBeNull();
    expect(mortarOverdriveCircuitName('')).toBeNull();
  });
});
