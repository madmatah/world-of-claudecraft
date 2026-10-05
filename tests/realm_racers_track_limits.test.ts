// The track-limits REFEREE: its rules, which are invariants, and nothing about
// which circuits happen to satisfy them.
//
// A third block used to live here, driving every candidate cut on every shipped
// circuit and failing when one paid. It is gone, and the reason is a design
// finding rather than a cost saving (it did cost 33 of this file's 35 seconds):
// **a cut that pays can be an authoring choice.** A circuit may legitimately
// offer a shortcut that trades time against the referee's penalty, and a
// blocking assertion over that is a pin on two shapes, not a rule.
//
// What is NOT a choice is a paying cut the referee fails to CATCH: there the
// anti-cheat simply does not apply to that geometry, which nobody authors on
// purpose. That verdict moved to `scripts/realm_racers_limits_probe.ts`, which
// already owned the sweep, and the `qa-checklist` agent runs it when a circuit
// record is in the diff (docs/qa-gate.md's judgment layer). The measurement
// itself is unchanged, and lives beside the probe in `scripts/realm_racers_cut_lab.ts`.
import { describe, expect, it } from 'vitest';
import {
  noRallyExcursion,
  type RallyExcursion,
  REALM_RACERS_CUT_TOLERANCE_YD,
  REALM_RACERS_LOITER_TICKS,
  REALM_RACERS_LOITER_WARN_TICKS,
  REALM_RACERS_OFF_ROAD_EXCHANGE_RATE,
  rallyLoiterCountdownTicks,
  stepRealmRacersTrackLimits,
} from '../src/sim/realm_racers_track_limits';

const LAP = 400;

/** Drives one excursion through the referee, tick by tick, and returns every
 *  verdict it handed down. `path` is (arc position, ground yards this tick). */
function run(path: readonly [number, number][], previousS = 0): string[] {
  let state = noRallyExcursion();
  const verdicts: string[] = [];
  let last = previousS;
  for (const [s, moved] of path) {
    const step = stepRealmRacersTrackLimits(state, {
      onTrack: false,
      s,
      previousS: last,
      moved,
      lapLength: LAP,
    });
    state = step.excursion;
    verdicts.push(step.verdict);
    last = s;
  }
  return verdicts;
}

describe('Realm Racers track limits: the referee', () => {
  it('carries no excursion at all while the machine is on the racing surface', () => {
    const carried: RallyExcursion = { exitS: 120, ticks: 40, ground: 900 };
    const step = stepRealmRacersTrackLimits(carried, {
      onTrack: true,
      s: 130,
      previousS: 129,
      moved: 1,
      lapLength: LAP,
    });
    expect(step.excursion).toEqual({ exitS: null, ticks: 0, ground: 0 });
    expect(step.verdict).toBe('none');
    expect(step.returnS).toBeNull();
  });

  it('records the exit at the PREVIOUS arc position, not at the first off-track one', () => {
    // The last place the machine held on the road is where it is put back, and
    // it is the position the caller's lap bookkeeping is in step with.
    const step = stepRealmRacersTrackLimits(noRallyExcursion(), {
      onTrack: false,
      s: 103,
      previousS: 100,
      moved: 3,
      lapLength: LAP,
    });
    expect(step.excursion.exitS).toBe(100);
    expect(step.excursion.ticks).toBe(1);
    expect(step.excursion.ground).toBe(3);
  });

  it('lets a wide excursion rejoin ahead for nothing, because it drove the yards', () => {
    // Running wide, sliding through the garden and coming back is RACING: the
    // outside line is LONGER than the road, so the odometer covers every yard
    // of arc it collects and then some. Thirty yards of arc, none of it earned
    // back even before the exchange rate discounts the ground.
    const path: [number, number][] = [];
    for (let i = 1; i <= 10; i++) path.push([100 + i * 3, 3.4]);
    expect(run(path, 100)).toEqual(Array(10).fill('none'));
  });

  it('lets a machine SHOVED across the inside of a corner rejoin ahead for nothing', () => {
    // The case that sent the flat arc-against-ground rule back to the drawing
    // board, and the reason the exchange rate exists. A machine does not choose
    // the arc it sweeps: driving at an inward offset `d` through a corner of
    // radius `R` sweeps `R / (R - d)` yards of centerline per yard of ground, so
    // a rival's shove into the inside of a hairpin (R 25, d 10) collects two
    // thirds of a yard of "gain" per yard driven through no decision of the
    // pilot's. Measured over real races it reached forty yards, which the flat
    // rule returned the victim for.
    const path: [number, number][] = [];
    // Thirty yards of ground at that corner's 1.67 yards of arc per yard.
    for (let i = 1; i <= 10; i++) path.push([100 + i * 5, 3]);
    expect(run(path, 100)).toEqual(Array(10).fill('none'));
  });

  it('lets a machine shoved off the road rejoin BEHIND for nothing', () => {
    // A bump that spins a machine backwards collects negative arc, so there is
    // nothing for the tolerance to be measured against.
    const path: [number, number][] = [];
    for (let i = 1; i <= 10; i++) path.push([100 - i * 2, 2.5]);
    expect(run(path, 100)).toEqual(Array(10).fill('none'));
  });

  it('returns a machine that gains more arc than the ground it drove', () => {
    // The cut: sixty yards of lap collected over twenty yards of driving.
    const path: [number, number][] = [];
    for (let i = 1; i <= 10; i++) path.push([100 + i * 6, 2]);
    const verdicts = run(path, 100);
    expect(verdicts).toContain('cutReturn');
    // ...and it fires the moment the unearned lap passes the floor, not at the
    // end of the excursion. Derived from the two constants rather than pinned,
    // so re-tuning either moves the check with it.
    const perTick = 6 - REALM_RACERS_OFF_ROAD_EXCHANGE_RATE * 2;
    expect(verdicts.indexOf('cutReturn')).toBe(Math.floor(REALM_RACERS_CUT_TOLERANCE_YD / perTick));
  });

  it('puts the machine back exactly where it left the road', () => {
    let state = noRallyExcursion();
    let last = 500;
    let returned: number | null = null;
    for (let i = 1; i <= 10 && returned === null; i++) {
      const step = stepRealmRacersTrackLimits(state, {
        onTrack: false,
        s: 500 + i * 6,
        previousS: last,
        moved: 1,
        lapLength: LAP,
      });
      state = step.excursion;
      last = 500 + i * 6;
      if (step.verdict === 'cutReturn') returned = step.returnS;
    }
    expect(returned).toBe(500);
    // The state is cleared with the verdict, so one excursion is refereed once.
    expect(state).toEqual({ exitS: null, ticks: 0, ground: 0 });
  });

  it('sits exactly on the tolerance boundary without firing, and fires one yard past it', () => {
    const at = (gain: number): string =>
      stepRealmRacersTrackLimits(
        { exitS: 200, ticks: 5, ground: 0 },
        { onTrack: false, s: 200 + gain, previousS: 200, moved: 0, lapLength: LAP },
      ).verdict;
    expect(at(REALM_RACERS_CUT_TOLERANCE_YD)).toBe('none');
    expect(at(REALM_RACERS_CUT_TOLERANCE_YD + 1)).toBe('cutReturn');
  });

  it('measures the gain across the start line the short way round the lap', () => {
    // An excursion that leaves at 395 and rejoins at 30 gained 35 yards, not
    // minus 365: the wrap is what makes the last corner of the lap refereed at
    // all.
    const step = stepRealmRacersTrackLimits(
      { exitS: 395, ticks: 3, ground: 0 },
      { onTrack: false, s: 30, previousS: 395, moved: 0, lapLength: LAP },
    );
    expect(step.verdict).toBe('cutReturn');
    expect(step.returnS).toBe(395);
  });

  it('discounts the ground driven at the exchange rate, not at par', () => {
    // The rate itself, isolated: one arc figure, two odometers either side of
    // the break-even, so the assertion is about the DISCOUNT rather than about
    // either constant on its own.
    const arc = REALM_RACERS_CUT_TOLERANCE_YD + 40;
    const at = (ground: number): string =>
      stepRealmRacersTrackLimits(
        { exitS: 0, ticks: 4, ground: 0 },
        { onTrack: false, s: arc, previousS: 0, moved: ground, lapLength: LAP },
      ).verdict;
    const breakEven = 40 / REALM_RACERS_OFF_ROAD_EXCHANGE_RATE;
    expect(at(breakEven - 1)).toBe('cutReturn');
    expect(at(breakEven + 1)).toBe('none');
    // At par the SAME excursion would have been returned, which is the whole
    // difference between the two rules.
    expect(arc - (breakEven + 1)).toBeGreaterThan(REALM_RACERS_CUT_TOLERANCE_YD);
  });

  it('returns a machine parked off the road on the loiter clock, moving or not', () => {
    // Neither arc nor ground: the cut rule can never fire on a camper, which is
    // exactly why this arm exists.
    const parked: [number, number][] = Array(REALM_RACERS_LOITER_TICKS).fill([300, 0]);
    const verdicts = run(parked, 300);
    expect(verdicts.filter((verdict) => verdict === 'loiter')).toHaveLength(1);
    expect(verdicts[REALM_RACERS_LOITER_TICKS - 1]).toBe('loiter');
    expect(verdicts.slice(0, -1).every((verdict) => verdict === 'none')).toBe(true);
  });

  it('counts the loiter clock down only once the warning has armed', () => {
    expect(rallyLoiterCountdownTicks(noRallyExcursion())).toBe(0);
    const at = (ticks: number): number => rallyLoiterCountdownTicks({ exitS: 1, ticks, ground: 0 });
    // A racer one tick off the road is not being warned about anything yet.
    expect(at(1)).toBe(0);
    expect(at(REALM_RACERS_LOITER_TICKS - REALM_RACERS_LOITER_WARN_TICKS - 1)).toBe(0);
    expect(at(REALM_RACERS_LOITER_TICKS - REALM_RACERS_LOITER_WARN_TICKS)).toBe(
      REALM_RACERS_LOITER_WARN_TICKS,
    );
    expect(at(REALM_RACERS_LOITER_TICKS - 1)).toBe(1);
    expect(at(REALM_RACERS_LOITER_TICKS)).toBe(0);
  });

  it('pins the shipped tuning to literals', () => {
    // Every derived check above moves WITH the constants, so none of them can
    // notice a retune: at par (1.0, the documented rejected design) they all
    // still pass. The literal is what says the shipped numbers are the shipped
    // numbers, the same pattern as the slicks suite's tuning block.
    expect(REALM_RACERS_OFF_ROAD_EXCHANGE_RATE).toBe(1.6);
    expect(REALM_RACERS_CUT_TOLERANCE_YD).toBe(25);
  });

  it('reads NOTHING about which side the machine left on', () => {
    // The operator's clincher, made structural: the input carries two arc
    // positions and an odometer and no lateral offset at all, so an outside cut
    // and an inside cut are literally the same call. A containment device would
    // have needed a second derived barrier on the outfield to close the same
    // hole; this closes both with one rule because it cannot tell them apart.
    const input = { onTrack: false, s: 280, previousS: 200, moved: 4, lapLength: LAP };
    expect(Object.keys(input).sort()).toEqual(['lapLength', 'moved', 'onTrack', 'previousS', 's']);
    expect(stepRealmRacersTrackLimits(noRallyExcursion(), input).verdict).toBe('cutReturn');
  });
});

/**
 * The two arc positions and the odometer are all the referee reads, so an
 * excursion is fully described by (arc, ground). Runs one through it in a single
 * step and reports the verdict.
 */
function judge(arc: number, ground: number): string {
  return stepRealmRacersTrackLimits(
    { exitS: 0, ticks: 4, ground: 0 },
    { onTrack: false, s: arc, previousS: 0, moved: ground, lapLength: 4000 },
  ).verdict;
}

describe('Realm Racers track limits: the outfield hole the old containment never closed', () => {
  it('judges an excursion by its arc and its odometer, never by which side it left on', () => {
    // The operator's clincher for this whole design, and now the only form of it
    // worth asserting. The containment family was infield-only, on the settled
    // trade that running wide is legal and costs only the slow bands; on a
    // RE-ENTRANT circuit shape an outside line between two points of the lap can
    // be shorter than the road, so an outside cut genuinely pays and nothing was
    // looking at it. Closing that would have needed a SECOND derived barrier out
    // in the garden.
    //
    // The referee closes it because it cannot tell the two apart: the input
    // carries two arc positions and an odometer and no lateral offset at all, so
    // an infield cut and an outfield cut with the same numbers are the same
    // call. Asserted on the SHAPE of the input rather than on a circuit, because
    // a circuit-shaped case would only ever be evidence about that circuit.
    const input = { onTrack: false, s: 300, previousS: 0, moved: 40, lapLength: 4000 };
    expect(Object.keys(input).sort()).toEqual(['lapLength', 'moved', 'onTrack', 'previousS', 's']);
    expect(stepRealmRacersTrackLimits(noRallyExcursion(), input).verdict).toBe('cutReturn');
  });

  it('is monotone: driving less ground for the same lap is never more legal', () => {
    // The property that makes "cutting cannot pay" structural rather than a
    // finding about two circuits. Whatever the constants, the verdict can only
    // move one way as a line gets shorter for the same arc, on either side of
    // the road, so there is no shape of excursion that beats it by driving less.
    const arc = 300;
    let sawBoth = 0;
    let previous = 'none';
    for (let ground = 400; ground >= 0; ground -= 5) {
      const verdict = judge(arc, ground);
      if (previous === 'cutReturn') expect(verdict, `ground ${ground}`).toBe('cutReturn');
      if (verdict !== previous) sawBoth++;
      previous = verdict;
    }
    // ...and the sweep really crossed the boundary rather than sitting on one
    // side of it the whole way.
    expect(sawBoth).toBe(1);
    expect(previous).toBe('cutReturn');
  });
});
