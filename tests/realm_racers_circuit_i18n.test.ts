// The circuit-id-to-name resolver every Realm Racers surface shares.

import { describe, expect, it } from 'vitest';
import {
  REALM_RACERS_CIRCUIT_LIST,
  REALM_RACERS_PRACTICE_CIRCUIT_ID,
} from '../src/sim/content/realm_racers_circuits';
import { realmRacersCircuitName } from '../src/ui/realm_racers_circuit_i18n';

describe('Realm Racers circuit names', () => {
  it('names EVERY authored circuit', () => {
    // The rule is the reason this resolver exists: authoring a circuit and
    // authoring its name are one edit in two files, and a circuit that reaches
    // a player unnamed is a defect this catches at the table rather than in a
    // seat. Not vacuous: the pool is more than one circuit.
    expect(REALM_RACERS_CIRCUIT_LIST.length).toBeGreaterThan(1);
    for (const circuit of REALM_RACERS_CIRCUIT_LIST) {
      const name = realmRacersCircuitName(circuit.id);
      expect(name, `${circuit.id} has no name`).toBeTruthy();
      // And the name is COPY, never the id dressed up.
      expect(name).not.toBe(circuit.id);
      expect(name).not.toContain('_');
    }
  });

  it('gives the four shipped circuits their authored names', () => {
    expect(realmRacersCircuitName(REALM_RACERS_PRACTICE_CIRCUIT_ID)).toBe('Evergarden Bootcamp');
    expect(realmRacersCircuitName('evergarden_express_tour')).toBe('Evergarden Express Tour');
    expect(realmRacersCircuitName('nightbloom_moonwell_run')).toBe('Nightbloom Moonspring Run');
    expect(realmRacersCircuitName('drakelands_rampart_run')).toBe('Drakelands Rampart Run');
  });

  it('answers null for a circuit nothing names, rather than throwing or leaking an id', () => {
    // A DRAFT circuit registered by a dev command resolves through
    // `realmRacersCircuitById` and has no catalog key. `t()` would throw on it
    // in dev and test; every caller hides its line on null instead.
    expect(realmRacersCircuitName('a_draft_somebody_drew')).toBeNull();
    expect(realmRacersCircuitName('')).toBeNull();
  });
});
