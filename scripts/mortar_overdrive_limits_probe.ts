// Measures the two numbers the Mortar Overdrive track-limits referee is written in:
// `MORTAR_OVERDRIVE_OFF_ROAD_EXCHANGE_RATE` and `MORTAR_OVERDRIVE_CUT_TOLERANCE_YD`.
//
//   npx tsx scripts/mortar_overdrive_limits_probe.ts                     # everything
//   npx tsx scripts/mortar_overdrive_limits_probe.ts --cuts <circuitId>  # one circuit, part B
//
// It has two callers with two different questions, hence the flags. TUNING the
// referee wants the whole thing: part A watches honest racing to find where the
// floor has to sit, part B drives cuts across a ladder of candidate rates.
// REVIEWING an authored circuit wants part B on one circuit against the SHIPPED
// constants, which is what `--cuts <id>` gives and what the `qa-checklist` agent
// runs when a circuit record is in the diff.
//
// The VERDICT block at the end of part B is what that review reads, and it says
// two things rather than one, because they are not the same kind of fact:
//
//   - "the best cut saves X s" is a fact about the SHAPE. A circuit may
//     legitimately offer a shortcut that pays; that is an authoring choice, and
//     nothing here refuses it.
//   - "N paying cuts go UNCAUGHT" is a fact about the REFEREE. A cut that beats
//     the road and clears the tolerance is a free shortcut with no penalty,
//     which is the anti-cheat not applying to that geometry. Nobody authors
//     that on purpose, and it is the line worth stopping on.
//
// The referee's rule is `arcGained - RATE * groundDriven > FLOOR`. Both numbers
// want measuring rather than deriving:
//
//   - the RATE is how much lap a yard driven off the road is worth. The
//     terminal-speed ladder (road 57.9 / garden 28.2) implies 2.05, but nobody
//     drives at their terminal speed: a machine leaves the road carrying road
//     momentum and spends the excursion bleeding it, so the effective rate is
//     lower. Part B measures it by DRIVING every candidate cut.
//   - the FLOOR has to sit above what honest racing produces. Part A measures
//     that by watching real races, blasts and contacts included.
//
// Nothing here re-implements a rule. Part A reconstructs each excursion from
// positions using the shipped projection and the shipped band predicate; part B
// drives the real kernel through the real Sim.

import {
  MORTAR_OVERDRIVE_CIRCUIT_LIST,
  type MortarOverdriveCircuit,
} from '../src/sim/content/mortar_overdrive/circuits';
import { startMortarOverdriveDevRace } from '../src/sim/mortar_overdrive/bots';
import { forwardArcDelta } from '../src/sim/mortar_overdrive/progress';
import {
  MORTAR_OVERDRIVE_COUNTDOWN_TICKS,
  mortarOverdriveMatchOf,
  mortarOverdriveOffTrackBand,
  mortarOverdriveOnTrack,
  mortarOverdriveReady,
  mortarOverdriveToCanonical,
} from '../src/sim/mortar_overdrive/race';
import { mortarOverdriveTrack } from '../src/sim/mortar_overdrive/spline';
import {
  MORTAR_OVERDRIVE_CUT_TOLERANCE_YD,
  MORTAR_OVERDRIVE_OFF_ROAD_EXCHANGE_RATE,
} from '../src/sim/mortar_overdrive/track_limits';
import { Sim } from '../src/sim/sim';
import { TICK_RATE } from '../src/sim/types';
import {
  driveMortarOverdriveChord,
  measureMortarOverdriveRoadPace,
  mortarOverdriveChordCandidates,
  mortarOverdriveRoadSeconds,
} from './mortar_overdrive_cut_lab';

const SEED = 4242;
/** Part A races each circuit on several seeds: five excursions from one race is
 *  not a distribution, and the FLOOR is read off its worst case. */
const HONEST_SEEDS = [4242, 7, 1337, 90210, 555, 31415];

function makeSim(seed = SEED): Sim {
  // `noPlayer` would leave nobody to seat the dev race on, so the probe's own
  // pilot is the primary player and every rival is a house pilot.
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true, devCommands: true });
}

/** One reconstructed excursion: what the referee would have measured. */
interface Excursion {
  circuitId: string;
  pid: number;
  ticks: number;
  arc: number;
  ground: number;
  /** True if the machine was ever off the ground during it: a blast launch. */
  flew: boolean;
  /** True if a rival's shell shock was live during it. */
  shocked: boolean;
}

const unearnedAt = (excursion: Excursion, rate: number): number =>
  excursion.arc - rate * excursion.ground;

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[at];
}

// ---------------------------------------------------------------------------
// Part A: what HONEST racing produces.
// ---------------------------------------------------------------------------

/**
 * Races a full grid of house pilots and reconstructs every excursion any of
 * them makes, tick by tick, from the shipped projection and band predicate.
 *
 * The field is bots, so every excursion here is honest by construction: they
 * follow the racing line and never aim at the infield. What puts them off the
 * road is what puts a player off it, which is the whole point: each other, and
 * each other's weapon.
 */
function measureHonestExcursions(
  circuit: MortarOverdriveCircuit,
  seed: number,
): {
  excursions: Excursion[];
  resets: number;
  ticks: number;
} {
  const sim = makeSim(seed);
  if (!startMortarOverdriveDevRace(sim, circuit.id, 'ace')) {
    throw new Error(`could not seat a grid on ${circuit.id}`);
  }
  const match = mortarOverdriveMatchOf(sim.ctx, sim.primaryId);
  if (!match) throw new Error('no match after seating');
  mortarOverdriveReady(sim.ctx, sim.primaryId);
  const track = mortarOverdriveTrack(circuit);

  const open = new Map<number, Excursion & { lastS: number }>();
  const done: Excursion[] = [];
  let resets = 0;
  // How many cut returns the LIVE referee handed down. On a bot field this is
  // the false-positive count, and it is the acceptance signal for the numbers.
  const cutNotice = new Map<number, number>();

  const deadline =
    MORTAR_OVERDRIVE_COUNTDOWN_TICKS + circuit.timeLimitSeconds * TICK_RATE + 5 * TICK_RATE;
  let ticks = 0;
  while (ticks < deadline && match.phase !== 'finished') {
    const before = new Map(match.pids.map((pid) => [pid, sim.entities.get(pid)?.pos.y ?? 0]));
    sim.tick();
    ticks++;
    if (match.phase !== 'racing') continue;
    for (const pid of match.pids) {
      const racer = sim.entities.get(pid);
      const progress = match.progress.get(pid);
      if (!racer || !progress) continue;
      if (progress.cutReturnUntilTick > (cutNotice.get(pid) ?? 0)) {
        cutNotice.set(pid, progress.cutReturnUntilTick);
        resets++;
      }
      const local = mortarOverdriveToCanonical(match, racer.pos.x, racer.pos.z);
      const projection = track.project(local.x, local.z, progress.trackIndex);
      const onTrack = mortarOverdriveOnTrack(mortarOverdriveOffTrackBand(circuit, projection));
      const live = open.get(pid);
      if (onTrack) {
        if (live) {
          done.push(live);
          open.delete(pid);
        }
        continue;
      }
      const moved = Math.hypot(racer.pos.x - racer.prevPos.x, racer.pos.z - racer.prevPos.z);
      // A machine off the ground is one a weapon put in the air: the vertical
      // position is the physical fact, and it is what a launch looks like.
      const airborne = Math.abs(racer.pos.y - (before.get(pid) ?? racer.pos.y)) > 0.05;
      const shocked = sim.ctx.tickCount < progress.groundBlastShockUntilTick;
      if (!live) {
        open.set(pid, {
          circuitId: circuit.id,
          pid,
          ticks: 1,
          arc: forwardArcDelta(progress.lastS, projection.s, track.length),
          ground: moved,
          flew: airborne,
          shocked,
          lastS: projection.s,
        });
        continue;
      }
      live.ticks++;
      live.arc += forwardArcDelta(live.lastS, projection.s, track.length);
      live.ground += moved;
      live.lastS = projection.s;
      live.flew ||= airborne;
      live.shocked ||= shocked;
    }
  }
  for (const live of open.values()) done.push(live);
  return { excursions: done, resets, ticks };
}

// ---------------------------------------------------------------------------
// Part B: what a CUT is actually worth. The measurement itself lives in
// `scripts/mortar_overdrive_cut_lab.ts`, beside this probe, its one consumer: a
// probe with its own copy of the stopwatch is a probe that can disagree with
// the lab.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

/**
 * What the caller asked for.
 *
 * Positional ids filter the circuits; `--cuts` drops part A. Neither narrows
 * what part B MEASURES: a scoped run drives the same sweep on fewer circuits, so
 * a verdict read off one circuit means exactly what it means in a full run.
 */
function parseArgs(argv: readonly string[]): { ids: string[]; cutsOnly: boolean } {
  const ids: string[] = [];
  let cutsOnly = false;
  for (const arg of argv) {
    if (arg === '--cuts') cutsOnly = true;
    else if (arg.startsWith('-')) throw new Error(`unknown flag ${arg}`);
    else ids.push(arg);
  }
  return { ids, cutsOnly };
}

/** How much lap a cut took for free, under the constants the game SHIPS. A
 *  positive number past the tolerance is what the referee acts on. */
const shippedUnearned = (arc: number, ground: number): number =>
  arc - MORTAR_OVERDRIVE_OFF_ROAD_EXCHANGE_RATE * ground;

/**
 * How much a line has to beat the road by before it counts as a shortcut, in
 * seconds.
 *
 * Not zero: the stopwatch reads in tick quanta and the ace bot's reference lap
 * carries its own noise, so a line inside a few tenths is the same speed by
 * another route rather than a cut. It came across from the content test this
 * verdict replaced, where it had the same job.
 */
const PAYS_SECONDS = 1.5;

function run(): void {
  const rates = [1, 1.2, 1.4, 1.6, 1.8, 2.05];
  const { ids, cutsOnly } = parseArgs(process.argv.slice(2));
  const circuits = ids.length
    ? ids.map((id) => {
        const found = MORTAR_OVERDRIVE_CIRCUIT_LIST.find((circuit) => circuit.id === id);
        // By NAME rather than by silently measuring nothing: a typo that probed
        // an empty list would print a clean bill of health for a circuit nobody
        // looked at, which is the worst thing a review tool can do.
        if (!found) {
          throw new Error(
            `no circuit '${id}'; shipped: ${MORTAR_OVERDRIVE_CIRCUIT_LIST.map((c) => c.id).join(', ')}`,
          );
        }
        return found;
      })
    : MORTAR_OVERDRIVE_CIRCUIT_LIST;

  for (const circuit of circuits) {
    const track = mortarOverdriveTrack(circuit);
    console.log(`\n=== ${circuit.id} (${track.length.toFixed(0)} yd lap) ===`);

    // --- Part A ---
    if (!cutsOnly) {
      const meaningful: Excursion[] = [];
      let resets = 0;
      let raced = 0;
      for (const seed of HONEST_SEEDS) {
        const honest = measureHonestExcursions(circuit, seed);
        meaningful.push(...honest.excursions.filter((e) => e.ticks >= 2));
        resets += honest.resets;
        raced += honest.ticks;
      }
      console.log(
        `A. honest racing: ${HONEST_SEEDS.length} races, ${raced} ticks, ` +
          `${meaningful.length} excursions ` +
          `(${meaningful.filter((e) => e.flew).length} with a launch, ` +
          `${meaningful.filter((e) => e.shocked).length} under shell shock), ` +
          `${resets} live cut returns`,
      );
      for (const rate of rates) {
        const values = meaningful.map((e) => unearnedAt(e, rate)).sort((a, b) => a - b);
        console.log(
          `   rate ${rate.toFixed(2)}: worst unearned ${quantile(values, 1).toFixed(1)} yd, ` +
            `p95 ${quantile(values, 0.95).toFixed(1)}, median ${quantile(values, 0.5).toFixed(1)}`,
        );
      }
    }

    // --- Part B ---
    const pace = measureMortarOverdriveRoadPace(circuit);
    const count = track.samples.length;
    console.log(`B. ace cruise ${pace.cruise.toFixed(1)} yd/s; cuts driven through the kernel:`);
    const rows: {
      from: number;
      to: number;
      arc: number;
      ground: number;
      saved: number;
      unearned: number[];
    }[] = [];
    let undriveable = 0;
    // Out to nearly half a lap: the cut that MATTERS is the one that skips a
    // whole section, and a sweep that stopped at a couple of corners would have
    // measured only the cuts the bands already price into worthlessness.
    const candidates = mortarOverdriveChordCandidates(
      circuit,
      Math.max(1, Math.round(count / 10)),
      [60, 110, 180, 260, 340, Math.floor(count * 0.4)],
    );
    for (const candidate of candidates) {
      const road = mortarOverdriveRoadSeconds(pace, candidate.from, candidate.to);
      if (road === null) continue;
      const driven = driveMortarOverdriveChord(
        circuit,
        track.samples[candidate.from].s,
        track.samples[candidate.to].s,
        pace.cruise,
      );
      if (!driven) {
        undriveable++;
        continue;
      }
      rows.push({
        from: candidate.from,
        to: candidate.to,
        arc: driven.arc,
        ground: driven.ground,
        saved: road - driven.seconds,
        unearned: rates.map((rate) => driven.arc - rate * driven.ground),
      });
    }
    rows.sort((x, y) => y.saved - x.saved);
    console.log(
      '   arc     ground  road-cut(s)  ' + rates.map((r) => `u@${r.toFixed(2)}`).join('  '),
    );
    for (const row of rows.slice(0, 14)) {
      console.log(
        `   ${row.arc.toFixed(0).padStart(5)}  ${row.ground.toFixed(0).padStart(6)}  ` +
          `${row.saved.toFixed(2).padStart(11)}  ` +
          row.unearned.map((u) => u.toFixed(0).padStart(6)).join('  '),
      );
    }
    const paying = rows.filter((row) => row.saved > 0);
    console.log(
      `   ${paying.length} of ${rows.length} candidate cuts actually BEAT the road ` +
        `(${undriveable} could not be driven at all)` +
        (paying.length > 0
          ? `; cheapest paying cut: ${paying[paying.length - 1].unearned
              .map((u, i) => `${rates[i].toFixed(2)}->${u.toFixed(0)}`)
              .join(' ')}`
          : ''),
    );

    // --- the verdict a circuit review reads ---
    //
    // Under the SHIPPED constants, not the rate ladder above: the ladder is for
    // choosing them, this is for judging a circuit against the ones in force.
    const best = rows[0];
    const pays = rows.filter((row) => row.saved > PAYS_SECONDS);
    const uncaught = pays.filter(
      (row) => shippedUnearned(row.arc, row.ground) <= MORTAR_OVERDRIVE_CUT_TOLERANCE_YD,
    );
    console.log(
      `   VERDICT (rate ${MORTAR_OVERDRIVE_OFF_ROAD_EXCHANGE_RATE}, ` +
        `tolerance ${MORTAR_OVERDRIVE_CUT_TOLERANCE_YD} yd, pays above ${PAYS_SECONDS} s)`,
    );
    console.log(
      best
        ? `     best cut: ${best.saved >= 0 ? '+' : ''}${best.saved.toFixed(2)} s ` +
            `(chord ${best.from}->${best.to})` +
            (best.saved > PAYS_SECONDS ? '  <- this circuit offers a shortcut' : '  note only')
        : '     best cut: none drivable',
    );
    // The line that matters. A paying cut is an authoring choice; a paying cut
    // the referee waves through is the anti-cheat not reaching that geometry.
    console.log(
      uncaught.length === 0
        ? `     paying cuts the referee does NOT catch: 0`
        : `     paying cuts the referee does NOT catch: ${uncaught.length}  <- DEFECT` +
            uncaught
              .map(
                (row) =>
                  `\n       chord ${row.from}->${row.to}: saves ${row.saved.toFixed(2)} s, ` +
                  `unearned ${shippedUnearned(row.arc, row.ground).toFixed(1)} yd ` +
                  `(needs > ${MORTAR_OVERDRIVE_CUT_TOLERANCE_YD})`,
              )
              .join(''),
    );
  }
}

run();
