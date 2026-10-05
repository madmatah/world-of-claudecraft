// Who a Realm Racers win counts against. A win (the rrWins meter and every
// deed that needs the overall win) is banked only when at least one OTHER
// human pilot was seated in the heat at the GO: beating three house pilots
// alone is practice, not a record, and the online backfill would otherwise
// make every solo queue a farmable win. The finish and time-trial deeds stay
// solo-earnable (deeds.ts onRallyRaceEndForDeeds / onRallyLapForDeeds).
//
// "Seated at the GO" is read off the frozen grid at race end rather than
// recorded on the GO tick: a human on the grid who had not retired before the
// final `goTick` (beginRealmRacersCountdown writes it when the lobby closes).
// A pilot who quit in the lobby or the countdown never raced anyone; one who
// quit after the flag did, and still counts as the rival they were.
//
// Draws no rng, mutates nothing.
import type { RealmRacersMatch } from './realm_racers';

export function realmRacersHumansAtGo(
  match: Pick<RealmRacersMatch, 'pids' | 'progress' | 'goTick'>,
  bots: ReadonlyMap<number, unknown>,
): number[] {
  return match.pids.filter((pid) => {
    if (bots.has(pid)) return false;
    const retiredTick = match.progress.get(pid)?.retiredTick ?? null;
    return retiredTick === null || retiredTick >= match.goTick;
  });
}

/** Did another human than `pid` start this heat? */
export function realmRacersHadHumanRival(humansAtGo: readonly number[], pid: number): boolean {
  return humansAtGo.some((other) => other !== pid);
}
