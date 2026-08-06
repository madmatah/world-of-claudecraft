import { describe, expect, it } from 'vitest';
import {
  otherRealmRacersParticipantIds,
  realmRacersInterestParticipantIds,
} from '../server/realm_racers_interest';
import { Sim } from '../src/sim/sim';
import { REALM_RACERS_RETURN_TICKS } from '../src/sim/social/realm_racers';

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

  it('stops pinning a participant the race has returned home', () => {
    // A quitter is back in the open world while the race runs on for up to
    // three minutes: keeping them pinned would stream their live position to
    // ex-rivals at full rate anywhere in the world, past both the distance
    // cutoff and the stealth policy the pin bypasses.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pids = [
      sim.addPlayer('warrior', 'Aster'),
      sim.addPlayer('mage', 'Briar'),
      sim.addPlayer('rogue', 'Cass'),
      sim.addPlayer('priest', 'Dell'),
    ];
    for (const pid of pids) sim.realmRacersQueueJoin(pid);
    sim.tick();
    expect(sim.realmRacers.match).not.toBeNull();
    const [a, b] = pids;
    expect(realmRacersInterestParticipantIds(sim.ctx, a, a)).toContain(b);

    sim.realmRacersForfeit(b);
    for (let i = 0; i < REALM_RACERS_RETURN_TICKS + 1; i++) sim.tick();
    expect(sim.realmRacers.match).not.toBeNull();
    expect(sim.realmRacers.match?.progress.get(b)?.returned).toBe(true);

    // The race no longer streams the quitter to the rivals, and the quitter
    // (no longer seated) resolves no match at all.
    expect(realmRacersInterestParticipantIds(sim.ctx, a, a)).not.toContain(b);
    expect(realmRacersInterestParticipantIds(sim.ctx, b, b)).toEqual([]);
  });
});
