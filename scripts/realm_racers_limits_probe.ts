// Measures the two numbers the Realm Racers track-limits referee is written in:
// `REALM_RACERS_OFF_ROAD_EXCHANGE_RATE` and `REALM_RACERS_CUT_TOLERANCE_YD`.
//
//   npx tsx scripts/realm_racers_limits_probe.ts
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
  REALM_RACERS_CIRCUIT_LIST,
  type RealmRacersCircuit,
} from '../src/sim/content/realm_racers_circuits';
import { forwardArcDelta } from '../src/sim/realm_racers_progress';
import { realmRacersTrack } from '../src/sim/realm_racers_spline';
import { Sim } from '../src/sim/sim';
import {
  REALM_RACERS_COUNTDOWN_TICKS,
  realmRacersMatchOf,
  realmRacersOffTrackBand,
  realmRacersOnTrack,
  realmRacersToCanonical,
} from '../src/sim/social/realm_racers';
import { startRealmRacersDevRace } from '../src/sim/social/realm_racers_bots';
import { TICK_RATE } from '../src/sim/types';
import {
  driveRallyChord,
  measureRallyRoadPace,
  rallyChordCandidates,
  rallyRoadSeconds,
} from '../tests/helpers/realm_racers_cut_lab';

const SEED = 4242;
/** Part A races each circuit on several seeds: five excursions from one race is
 *  not a distribution, and the FLOOR is read off its worst case. */
const HONEST_SEEDS = [4242, 7, 1337, 90210, 555, 31415];

function makeSim(seed = SEED): Sim {
  // `noPlayer` would leave nobody to seat the dev race on, so the probe's own
  // pilot is the primary player and every rival is a house pilot.
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
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
  circuit: RealmRacersCircuit,
  seed: number,
): {
  excursions: Excursion[];
  resets: number;
  ticks: number;
} {
  const sim = makeSim(seed);
  if (!startRealmRacersDevRace(sim, circuit.id, 'ace')) {
    throw new Error(`could not seat a grid on ${circuit.id}`);
  }
  const match = realmRacersMatchOf(sim.ctx, sim.primaryId);
  if (!match) throw new Error('no match after seating');
  const track = realmRacersTrack(circuit);

  const open = new Map<number, Excursion & { lastS: number }>();
  const done: Excursion[] = [];
  let resets = 0;
  // How many cut returns the LIVE referee handed down. On a bot field this is
  // the false-positive count, and it is the acceptance signal for the numbers.
  const cutNotice = new Map<number, number>();

  const deadline =
    REALM_RACERS_COUNTDOWN_TICKS + circuit.timeLimitSeconds * TICK_RATE + 5 * TICK_RATE;
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
      const local = realmRacersToCanonical(match, racer.pos.x, racer.pos.z);
      const projection = track.project(local.x, local.z, progress.trackIndex);
      const onTrack = realmRacersOnTrack(realmRacersOffTrackBand(circuit, projection));
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
// `tests/helpers/realm_racers_cut_lab.ts`, shared with the content test that
// holds every shipped circuit to it: a probe with its own copy of the stopwatch
// is a probe that can disagree with the gate.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

function run(): void {
  const rates = [1, 1.2, 1.4, 1.6, 1.8, 2.05];

  for (const circuit of REALM_RACERS_CIRCUIT_LIST) {
    const track = realmRacersTrack(circuit);
    console.log(`\n=== ${circuit.id} (${track.length.toFixed(0)} yd lap) ===`);

    // --- Part A ---
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

    // --- Part B ---
    const pace = measureRallyRoadPace(circuit);
    const count = track.samples.length;
    console.log(`B. ace cruise ${pace.cruise.toFixed(1)} yd/s; cuts driven through the kernel:`);
    const rows: { arc: number; ground: number; saved: number; unearned: number[] }[] = [];
    let undriveable = 0;
    // Out to nearly half a lap: the cut that MATTERS is the one that skips a
    // whole section, and a sweep that stopped at a couple of corners would have
    // measured only the cuts the bands already price into worthlessness.
    const candidates = rallyChordCandidates(circuit, Math.max(1, Math.round(count / 10)), [
      60,
      110,
      180,
      260,
      340,
      Math.floor(count * 0.4),
    ]);
    for (const candidate of candidates) {
      const road = rallyRoadSeconds(pace, candidate.from, candidate.to);
      if (road === null) continue;
      const driven = driveRallyChord(
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
  }
}

run();
