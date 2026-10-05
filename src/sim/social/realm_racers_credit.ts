// Who a Realm Racers win counts against. A win (the rrWins meter and every
// deed that needs the overall win) is banked only when at least one OTHER
// human pilot actually raced the heat: beating three house pilots alone is
// practice, not a record, and the online backfill would otherwise make every
// solo queue a farmable win. The finish and time-trial deeds stay
// solo-earnable (deeds.ts onRallyRaceEndForDeeds / onRallyLapForDeeds).
//
// "Actually raced" is two facts, both needed:
// - seated at the GO: on the roster the race records on the tick its phase
//   turns to racing (`RealmRacersMatch.seatedAtGo`), so a pilot the countdown
//   lost (a forfeit, a leave, a death retired by the roster pass on that very
//   tick) never started it;
// - then raced: crossed the finish, or completed at least the first lap. A
//   linkdead or idle human sits on the grid at the GO and never gets that far,
//   so they cannot unlock somebody else's win; one who drove a lap and then
//   left still can.
//
// Draws no rng, mutates nothing.
import type { RealmRacersMatch, RealmRacersProgress } from './realm_racers';

/** Crossed the finish, or completed lap 1 (the lap counter wraps to 2). */
export function realmRacersPilotRaced(
  progress: Pick<RealmRacersProgress, 'finishedTick' | 'lap'> | undefined,
): boolean {
  return !!progress && (progress.finishedTick !== null || progress.lap >= 2);
}

/** Did another human than `pid` start this heat and race it? */
export function realmRacersHadHumanRival(
  match: Pick<RealmRacersMatch, 'seatedAtGo' | 'progress'>,
  bots: ReadonlyMap<number, unknown>,
  pid: number,
): boolean {
  return match.seatedAtGo.some(
    (other) =>
      other !== pid && !bots.has(other) && realmRacersPilotRaced(match.progress.get(other)),
  );
}
