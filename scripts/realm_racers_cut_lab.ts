// The Realm Racers cut lab: what a straight line across a circuit is actually
// WORTH, measured by driving it through the real kernel rather than by
// measuring the geometry.
//
// It exists because the geometry is the wrong question. A chord that saves a
// hundred yards of lap can still be slower than the road, because the off-track
// bands cost speed the whole way; and a machine shoved off line sweeps arc it
// never chose. So the only honest measurement of "is this cut worth taking" is
// a stopwatch: drive the chord, drive the road, compare.
//
// It sat in `tests/helpers/` while a content case in
// `tests/realm_racers_track_limits` drove it over every shipped circuit and
// failed when a cut paid. That assertion is gone: a circuit MAY legitimately
// offer a shortcut that trades time against the referee's penalty, so "no cut
// pays" was a pin on two shapes rather than a rule. The judgment moved to the
// probe beside this file, which the `qa-checklist` agent runs when a circuit
// record is in the diff.
//
// So it moved too. A helper under `tests/helpers/` that no test imports is
// misfiled, and the next reader would spend the search working out which suite
// it serves. It has exactly one consumer now, and it lives next to it.

import type { RealmRacersCircuit } from '../src/sim/content/realm_racers_circuits';
import { realmRacersStripPickups } from '../src/sim/realm_racers_pickups';
import { forwardArcDelta } from '../src/sim/realm_racers_progress';
import { realmRacersTrack } from '../src/sim/realm_racers_spline';
import { Sim } from '../src/sim/sim';
import {
  realmRacersCircuitOf,
  realmRacersMatchOf,
  realmRacersToCanonical,
} from '../src/sim/social/realm_racers';
import { startRealmRacersDevRace } from '../src/sim/social/realm_racers_bots';
import { beginRealmRacersCountdown } from '../src/sim/social/realm_racers_loading';
import { TICK_RATE } from '../src/sim/types';

/** A world with one pilot and a full house grid seated on `circuit`, past the
 *  countdown and racing. */
function seat(circuit: RealmRacersCircuit, seed: number) {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true, devCommands: true });
  if (!startRealmRacersDevRace(sim, circuit.id, 'ace')) {
    throw new Error(`could not seat a grid on ${circuit.id}`);
  }
  const match = realmRacersMatchOf(sim.ctx, sim.primaryId);
  if (!match) throw new Error('no match after seating');
  // Straight to the flag rather than ticking the loading lobby and the nine-second
  // countdown out: this lab seats a fresh world per line it times, and both are
  // pure cost. The lobby closes through its own transition with a zero countdown.
  // Driven through the module so the phase transition is the real one (it hands
  // back the controls and starts the lap clocks), not a field poke.
  // The circuit is stripped of its pickup boxes BEFORE the first tick, and that
  // is not a convenience: this lab is a STOPWATCH over geometry, and a box hands
  // out a weighted draw (22b) whose nitro, oil and ward all move the clock it is
  // reading. Leaving them in would time the dice. Stripping runs above the tick
  // because the flag drop below is a full racing tick in which the ace grid is
  // already driving, and a box taken there is a draw this lab never sees.
  //
  // SCOPE, so no result read off this lab claims more than it measured: what it
  // proves is that no cut pays on a CLEAN circuit. A lap under oil, or against a
  // rival spending a nitro, is a different question and this says nothing about
  // it.
  realmRacersStripPickups(match.pickups);
  // The grid is disarmed for the same reason and by the same argument. Every
  // machine is seated with its profile's weapon already loaded, independently of
  // the boxes above, so the ace pilots sharing this circuit will shell whatever
  // rival they can see: a shot lands a `GROUND_BLAST_YAW_KICK` into the timed
  // machine's `spin`, and how long that spin runs is a profile number
  // (`spinDecay`). A stopwatch over geometry cannot have a term in it that moves
  // when the handling is tuned, and this one did: re-tuning `spinDecay` swung
  // the number of lines that finish inside the drive window from seven to one on
  // the practice circuit while the times themselves barely moved.
  for (const progress of match.progress.values()) progress.heldWeapon = null;
  beginRealmRacersCountdown(
    sim.ctx,
    match,
    0,
    realmRacersCircuitOf(match).timeLimitSeconds * TICK_RATE,
  );
  sim.tick();
  if (match.phase !== 'racing') throw new Error('the flag did not drop');
  return { sim, match };
}

/** One line, timed. `seconds` is what the real kernel took to drive it. */
export interface RallyDrivenLine {
  /** Yards of lap the line covers. */
  arc: number;
  /** Yards of ground the machine actually drove. */
  ground: number;
  seconds: number;
}

export interface RallyRoadPace {
  /**
   * Tick each arc sample was first reached on, on the ace bot's SECOND lap (so
   * the standing start is not in the number), or -1 for a sample it never
   * registered on.
   */
  readonly reachedAtTick: readonly number[];
  /** Its mean speed over that lap, which is the entry speed a cut gets. */
  readonly cruise: number;
}

/**
 * The ace bot's own pace around the ROAD: the baseline a cut has to beat.
 *
 * Read off the shipped brain rather than off a speed constant, so a corner
 * costs what it really costs and the comparison is against how the circuit is
 * actually driven.
 */
export function measureRallyRoadPace(circuit: RealmRacersCircuit, seed = 4242): RallyRoadPace {
  const { sim, match } = seat(circuit, seed);
  const track = realmRacersTrack(circuit);
  const bot = match.pids.find((pid) => pid !== sim.primaryId);
  if (bot === undefined) throw new Error('no house pilot on the grid');
  const progress = match.progress.get(bot);
  if (!progress) throw new Error('no bot progress');
  // Everyone else is parked, through the race's own reset lock. The pilot being
  // timed is the INSTRUMENT here, so it drives a clean solo lap: a grid trading
  // paint around it puts contact `spin` into its lap, and how long that spin
  // runs is a handling number, so the reference road time would move whenever
  // the machine is tuned. It reaches the cut verdict through a side door, too:
  // a stretch this lap fails to register has no road time at all, and its
  // candidate line is dropped before anyone drives it.
  for (const [other, otherProgress] of match.progress) {
    if (other !== bot) otherProgress.resetLockedUntilTick = Number.MAX_SAFE_INTEGER;
  }

  const count = track.samples.length;
  const reachedAtTick = new Array<number>(count).fill(-1);
  let speedSum = 0;
  let samples = 0;
  let previous = -1;
  const start = sim.ctx.tickCount;
  while (sim.ctx.tickCount - start < 120 * TICK_RATE && match.phase === 'racing') {
    sim.tick();
    if (progress.lap < 2) continue;
    if (progress.lap > 2) break;
    const index = Math.round(progress.lastS / track.step) % count;
    // Stamp the whole INTERVAL the machine covered this tick, not just the
    // sample it happens to be standing on. The samples are a yard apart and a
    // racing machine moves about two yards a tick, so stamping one index leaves
    // half the lap unregistered, and a stretch with no road time has its
    // candidate line dropped before it is ever driven. That turned every cut
    // verdict into a parity coin flip: which half of the circuit registered
    // moved with any perturbation at all, including the handling being tuned.
    if (previous >= 0) {
      for (let step = 1; step <= count; step++) {
        const at = (previous + step) % count;
        if (reachedAtTick[at] < 0) reachedAtTick[at] = sim.ctx.tickCount;
        if (at === index) break;
      }
    } else if (reachedAtTick[index] < 0) {
      reachedAtTick[index] = sim.ctx.tickCount;
    }
    previous = index;
    speedSum += Math.abs(sim.entities.get(bot)?.drive?.speed ?? 0);
    samples++;
  }
  return { reachedAtTick, cruise: samples > 0 ? speedSum / samples : 0 };
}

/** Seconds the ace bot took between two arc samples on the road, or null when
 *  its lap did not register both. */
export function rallyRoadSeconds(pace: RallyRoadPace, from: number, to: number): number | null {
  const a = pace.reachedAtTick[from];
  const b = pace.reachedAtTick[to];
  if (a < 0 || b < 0 || b <= a) return null;
  return (b - a) / TICK_RATE;
}

/**
 * Drives a machine in a straight line from the road at `fromS` to the road at
 * `toS`, full throttle, and reports how long it took.
 *
 * Real Sim, real kernel, real bands: the machine leaves the road carrying road
 * speed and bleeds it in the garden exactly as a player's would. Null when the
 * line cannot be driven at all, which is a real answer rather than a failure: a
 * long chord off-road is a line the grip model will not hold, and reporting the
 * flailing as a time would be a lie.
 *
 * The referee's own excursion state is cleared every tick. This is what MEASURES
 * the threshold, so it cannot be interrupted by the threshold it is measuring.
 */
export function driveRallyChord(
  circuit: RealmRacersCircuit,
  fromS: number,
  toS: number,
  entrySpeed: number,
  seed = 4242,
): RallyDrivenLine | null {
  const { sim, match } = seat(circuit, seed);
  const track = realmRacersTrack(circuit);
  const pid = sim.primaryId;
  const racer = sim.entities.get(pid);
  const meta = sim.players.get(pid);
  const progress = match.progress.get(pid);
  if (!racer?.drive || !meta || !progress) throw new Error('no pilot');

  const start = track.pointAt(fromS);
  const target = track.pointAt(toS);
  const goal = { x: match.origin.x + target.x, z: match.origin.z + target.z };
  racer.pos.x = match.origin.x + start.x;
  racer.pos.z = match.origin.z + start.z;
  racer.prevPos = { ...racer.pos };
  racer.drive.speed = entrySpeed;
  racer.drive.slip = 0;
  racer.drive.spin = 0;
  progress.lastS = fromS;

  // The rivals are parked for the run, through the race's own reset lock (which
  // holds a machine where it stands and zeroes it every tick). Stripping the
  // boxes and the weapons takes the DICE out of this stopwatch; this takes the
  // other grid out of it. Three ace pilots racing the same circuit will bump the
  // timed machine, a bump writes `spin`, and how long that spin runs is a
  // handling number, so leaving them in makes the lab's verdict move whenever
  // the machine is tuned. The pace measurement above deliberately keeps its bot:
  // there, the pilot IS the instrument.
  for (const [other, otherProgress] of match.progress) {
    if (other !== pid) otherProgress.resetLockedUntilTick = Number.MAX_SAFE_INTEGER;
  }

  const wanted = forwardArcDelta(fromS, toS, track.length);
  let ground = 0;
  for (let ticks = 1; ticks <= 60 * TICK_RATE; ticks++) {
    // Pointed at the goal every tick, so the line really is the straight one
    // rather than whatever the steering servo drifts into.
    racer.facing = Math.atan2(goal.x - racer.pos.x, goal.z - racer.pos.z);
    meta.moveInput.forward = true;
    const wasX = racer.pos.x;
    const wasZ = racer.pos.z;
    sim.tick();
    ground += Math.hypot(racer.pos.x - wasX, racer.pos.z - wasZ);
    progress.excursion = { exitS: null, ticks: 0, ground: 0 };
    progress.cutReturnUntilTick = 0;
    // ARRIVED is an arc question, not a proximity one: a machine with real
    // inertia overshoots the point and circles it, and a proximity stop would
    // time the circling rather than the cut.
    const here = realmRacersToCanonical(match, racer.pos.x, racer.pos.z);
    const reached = forwardArcDelta(fromS, track.project(here.x, here.z).s, track.length);
    if (reached >= wanted) return { arc: wanted, ground, seconds: ticks / TICK_RATE };
  }
  return null;
}

/** One candidate straight line, as the sweep enumerates them. */
export interface RallyChordCandidate {
  from: number;
  to: number;
  /** Yards of lap between them. */
  arc: number;
  /** Straight-line distance: the ground a perfect cut would drive. */
  chord: number;
}

/**
 * Every straight line worth timing on a circuit: far enough apart to be a cut,
 * geometrically SHORTER than the road between them, and inside half a lap (past
 * that the short way round is backwards, which is the same corner from the
 * other side rather than a cut).
 */
export function rallyChordCandidates(
  circuit: RealmRacersCircuit,
  fromStep: number,
  aheadSamples: readonly number[],
): RallyChordCandidate[] {
  const track = realmRacersTrack(circuit);
  const count = track.samples.length;
  const out: RallyChordCandidate[] = [];
  for (let from = 0; from < count; from += fromStep) {
    for (const ahead of aheadSamples) {
      if (ahead * 2 >= count) continue;
      const to = (from + ahead) % count;
      if (to < from) continue;
      const a = track.samples[from];
      const b = track.samples[to];
      const chord = Math.hypot(b.x - a.x, b.z - a.z);
      const arc = ahead * track.step;
      // A line no shorter than the road is not a cut, whatever else it is.
      if (chord >= arc - 5) continue;
      out.push({ from, to, arc, chord });
    }
  }
  return out;
}
