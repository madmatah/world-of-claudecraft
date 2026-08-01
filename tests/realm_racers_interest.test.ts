import { describe, expect, it } from 'vitest';
import { otherRealmRacersParticipantIds } from '../server/realm_racers_interest';

describe('Realm Racers match interest pins', () => {
  it('selects every other participant in frozen grid order', () => {
    expect(otherRealmRacersParticipantIds([41, 42, 43, 44], 42)).toEqual([41, 43, 44]);
  });

  it('does not invent a pin for a spectator outside the participant list', () => {
    expect(otherRealmRacersParticipantIds([41, 42, 43, 44], 99)).toEqual([41, 42, 43, 44]);
  });

  it('deduplicates malformed participant input at the trust boundary', () => {
    expect(otherRealmRacersParticipantIds([41, 42, 42, 43], 41)).toEqual([42, 43]);
  });
});
