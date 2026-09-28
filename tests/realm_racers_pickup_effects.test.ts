import { describe, expect, it } from 'vitest';
import { eventAnchor } from '../server/event_delivery';
import { isDebuffAura, isToggleAura } from '../src/sim/aura_classify';
import {
  REALM_RACERS_ABILITY_ID,
  REALM_RACERS_EFFECT_ABILITIES,
  REALM_RACERS_NITRO_ABILITY_ID,
  REALM_RACERS_SLICK_ABILITY_ID,
  realmRacersHeldEffectOf,
} from '../src/sim/content/realm_racers';
import { realmRacersCompetitionCircuits } from '../src/sim/content/realm_racers_circuits';
import { vehicleProfile } from '../src/sim/content/vehicles';
import {
  GROUND_BLAST_RADIUS,
  GROUND_BLAST_SHOCK_TICKS,
} from '../src/sim/realm_racers_ground_blast';
import {
  drawRallyPickupEffect,
  isRallyHeldEffect,
  type RallyPickupBand,
  type RallyPickupEffect,
  REALM_RACERS_NITRO_KICK,
  REALM_RACERS_NITRO_SPEED_MULT,
  REALM_RACERS_NITRO_TICKS,
  REALM_RACERS_PICKUP_TABLES,
  rallyHeldEffectFromWire,
  rallyPickupBand,
} from '../src/sim/realm_racers_pickup_effects';
import { realmRacersPickupBoxes } from '../src/sim/realm_racers_pickups';
import { travelledFromArc } from '../src/sim/realm_racers_progress';
import {
  REALM_RACERS_SLICK_CAP,
  REALM_RACERS_SLICK_GRIP,
  REALM_RACERS_SLICK_GRIP_TICKS,
  REALM_RACERS_SLICK_LIFETIME_TICKS,
  REALM_RACERS_SLICK_RADIUS,
} from '../src/sim/realm_racers_slicks';
import { realmRacersTrack } from '../src/sim/realm_racers_spline';
import type { Sim } from '../src/sim/sim';
import {
  REALM_RACERS_COUNTDOWN_TICKS,
  REALM_RACERS_OFF_TRACK_AURA,
  REALM_RACERS_VEHICLE_KEY,
  REALM_RACERS_WARD_AURA,
  REALM_RACERS_WARD_AURA_SECONDS,
  realmRacersForfeit,
  realmRacersResetPosition,
  realmRacersStartMatch,
  realmRacersToWorld,
  realmRacersWarded,
} from '../src/sim/social/realm_racers';
import { type SimEvent, TICK_RATE } from '../src/sim/types';
import { advanceVehicleDrive, vehicleMaxSpeed } from '../src/sim/vehicle_motion';
import { createAurasView, isAuraDebuff } from '../src/ui/auras_view';
import { installScriptedRng, rallyPickupRollFor } from './helpers/realm_racers_rng';
import { addAt, makeWorld, readyAllRacers, teleport } from './realm_racers_util';

/** The circuit a QUEUED race runs on, which is what every live case here seats. */
const RACE_CIRCUIT = realmRacersCompetitionCircuits()[0];

const GRID = [
  { cls: 'warrior', name: 'Aster', x: -5, z: -40 },
  { cls: 'mage', name: 'Briar', x: 7, z: -42 },
  { cls: 'rogue', name: 'Cass', x: -9, z: -38 },
  { cls: 'priest', name: 'Dell', x: 11, z: -44 },
] as const;

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${label}`);
  return value;
}

function match(sim: Sim): NonNullable<Sim['realmRacers']['match']> {
  return required(sim.realmRacers.match, 'Realm Racers match');
}

/** Four humans on the grid, past the lights, with nobody driving. */
function racingGrid(): { sim: Sim; pids: number[] } {
  const sim = makeWorld();
  const pids = GRID.map((row) => addAt(sim, row.cls, row.name, row.x, row.z));
  // Seated on the NAMED circuit rather than through the queue's draw: the pool
  // holds more than one competition circuit, and the geometry below is this
  // one's road.
  expect(realmRacersStartMatch(sim.ctx, pids, undefined, RACE_CIRCUIT.id)).toBe(true);
  readyAllRacers(sim);
  sim.tick();
  for (let i = 0; i < REALM_RACERS_COUNTDOWN_TICKS; i++) sim.tick();
  expect(match(sim).phase).toBe('racing');
  expect(match(sim).circuitId).toBe(RACE_CIRCUIT.id);
  return { sim, pids };
}

/** Parks a machine on a circuit-local point, with the lap bookkeeping a machine
 *  that DROVE there would carry (the twin of the 22a suite's helper). */
function standAt(sim: Sim, pid: number, x: number, z: number): void {
  const live = match(sim);
  const world = realmRacersToWorld(live, x, z);
  teleport(sim, pid, world.x, world.z);
  const progress = required(live.progress.get(pid), `progress ${pid}`);
  const projection = realmRacersTrack(RACE_CIRCUIT).project(x, z, progress.trackIndex);
  progress.lastS = projection.s;
  progress.trackIndex = projection.index;
}

function standOnBox(sim: Sim, pid: number, index: number): void {
  const box = required(realmRacersPickupBoxes(RACE_CIRCUIT)[index], `box ${index}`);
  standAt(sim, pid, box.x, box.z);
}

/** Where one box sits round the lap, as a fraction. What a case needs whenever
 *  it places a FIELD around the take rather than just a taker. */
function boxLapFraction(index: number): number {
  const box = required(realmRacersPickupBoxes(RACE_CIRCUIT)[index], `box ${index}`);
  return box.s / realmRacersTrack(RACE_CIRCUIT).length;
}

/**
 * Three boxes as far apart as the circuit's own rows allow.
 *
 * A case wanting three machines each on their OWN box cannot name indices: how
 * many boxes a shipped circuit carries is content (four per row, and the row
 * count is an authoring decision), so the literals `0, 4, 8` were three rows on
 * the circuit they were written against and out of range the day it kept one.
 * Thirds of whatever is there is the same answer on the old shape and an answer
 * at all on every other.
 */
function spreadBoxes(): [number, number, number] {
  const count = realmRacersPickupBoxes(RACE_CIRCUIT).length;
  expect(count, 'three boxes to spread across').toBeGreaterThanOrEqual(3);
  return [0, Math.floor(count / 3), Math.floor((2 * count) / 3)];
}

function progressOf(sim: Sim, pid: number) {
  return required(match(sim).progress.get(pid), `progress ${pid}`);
}

/** Is this racer carrying the ward AURA, which is the source of truth for it? */
function wardedOf(sim: Sim, pid: number): boolean {
  return realmRacersWarded(sim.entities.get(pid));
}

/** The ward aura record itself, for the cases that assert what it looks like. */
function wardAuraOf(sim: Sim, pid: number) {
  return sim.entities.get(pid)?.auras.find((aura) => aura.id === REALM_RACERS_WARD_AURA);
}

/**
 * Puts a machine at a lap fraction with the bookkeeping a machine that DROVE
 * there would carry.
 *
 * `distanceSinceWrap` is the load-bearing half: without it the progress step
 * reads the jump as a lap wrap the other way and hands the racer a NEGATIVE
 * travelled, which silently reorders the field the band is read against.
 */
function placeOnLap(sim: Sim, pid: number, fraction: number): void {
  const track = realmRacersTrack(RACE_CIRCUIT);
  const point = track.pointAt(track.length * fraction);
  standAt(sim, pid, point.x, point.z);
  const progress = progressOf(sim, pid);
  // The search hint is computed from the ARC rather than left to a hinted
  // projection: `project` searches a local window around the hint, so a machine
  // moved half a lap in one jump would otherwise lock onto a sample near where
  // it used to be and read as having gone backwards.
  progress.lastS = point.s;
  progress.trackIndex = Math.round(point.s / track.step);
  progress.distanceSinceWrap = point.s;
  progress.travelled = travelledFromArc(progress.lap, point.s, track.length, point.s);
  expect(progress.travelled).toBeGreaterThanOrEqual(0);
}

/**
 * Take one box with a KNOWN outcome: the taker is alone at the front of the
 * field (nobody has moved), so their band is the leader's and the roll is that
 * table's.
 */
function takeWithEffect(sim: Sim, pid: number, box: number, effect: RallyPickupEffect): SimEvent[] {
  const rng = installScriptedRng(sim);
  rng.script(rallyPickupRollFor('leader', effect));
  standOnBox(sim, pid, box);
  const events = sim.tick();
  // The scripted value really went to the take: without this, a roll consumed
  // by some other system would leave the case asserting about whatever the
  // stream happened to hand the boxes instead.
  expect(rng.consumed).toBe(1);
  return events;
}

describe('the pickup effect tables', () => {
  it('opens every table with the refill', () => {
    // The premise the 22a suite's `forceRefills(0)` rests on, and the design
    // rule behind the tables: the common case is the FIRST row everywhere, so a
    // roll of zero is a refill wherever the taker is running.
    for (const band of Object.keys(REALM_RACERS_PICKUP_TABLES) as RallyPickupBand[]) {
      expect(REALM_RACERS_PICKUP_TABLES[band][0].effect).toBe('charge');
      expect(drawRallyPickupEffect(band, 0)).toBe('charge');
    }
  });

  it('hands out each effect in proportion to its weight', () => {
    // Driven, not sampled: 1200 evenly spaced rolls over [0, 1) land in each
    // slice exactly as often as its weight says, so this fails on a broken
    // cumulative walk. (The VALUES are pinned separately below: this assertion
    // reads the table and compares it with itself, which is decisive about the
    // walk and about nothing else.)
    const draws = 1200;
    for (const band of Object.keys(REALM_RACERS_PICKUP_TABLES) as RallyPickupBand[]) {
      const table = REALM_RACERS_PICKUP_TABLES[band];
      const total = table.reduce((sum, row) => sum + row.weight, 0);
      const counts = new Map<RallyPickupEffect, number>();
      for (let i = 0; i < draws; i++) {
        const effect = drawRallyPickupEffect(band, i / draws);
        counts.set(effect, (counts.get(effect) ?? 0) + 1);
      }
      for (const row of table) {
        expect(counts.get(row.effect), `${band}/${row.effect}`).toBe((draws * row.weight) / total);
      }
    }
  });

  it('gives the backmarker a luckier table than the leader, not a better one', () => {
    const share = (band: RallyPickupBand, effect: RallyPickupEffect) => {
      const table = REALM_RACERS_PICKUP_TABLES[band];
      const total = table.reduce((sum, row) => sum + row.weight, 0);
      return (table.find((row) => row.effect === effect)?.weight ?? 0) / total;
    };
    // The leader refills; the tail of the field gets the two effects that close
    // a gap (nitro) or survive one being closed (ward).
    expect(share('leader', 'charge')).toBeGreaterThan(share('backmarker', 'charge'));
    expect(share('backmarker', 'nitro')).toBeGreaterThan(share('leader', 'nitro'));
    expect(share('backmarker', 'ward')).toBeGreaterThan(share('leader', 'ward'));
    // The oil is the one thing worth MORE the further ahead you are, so it
    // leans the other way.
    expect(share('leader', 'slick')).toBeGreaterThan(share('backmarker', 'slick'));
    // Luckier, never different: nothing is exclusive to a band, and the refill
    // is still the single likeliest outcome wherever you are running.
    for (const band of Object.keys(REALM_RACERS_PICKUP_TABLES) as RallyPickupBand[]) {
      const table = REALM_RACERS_PICKUP_TABLES[band];
      expect(table.map((row) => row.effect).sort()).toEqual(['charge', 'nitro', 'slick', 'ward']);
      for (const row of table) expect(row.weight).toBeGreaterThan(0);
      const best = table.reduce((top, row) => (row.weight > top.weight ? row : top));
      expect(best.effect).toBe('charge');
    }
  });

  it('pins the shipped weights and the shipped tuning to literals', () => {
    // Every OTHER assertion about the tables reads them and compares them with
    // themselves, so a typo in a weight (or a seat-tuning pass nobody meant to
    // ship) would sail through all of them. These are the numbers, spelled out:
    // changing the feel of the pickups should be a decision that lands here.
    expect(REALM_RACERS_PICKUP_TABLES).toEqual({
      leader: [
        { effect: 'charge', weight: 7 },
        { effect: 'nitro', weight: 1 },
        { effect: 'ward', weight: 1 },
        { effect: 'slick', weight: 3 },
      ],
      midfield: [
        { effect: 'charge', weight: 6 },
        { effect: 'nitro', weight: 2 },
        { effect: 'ward', weight: 2 },
        { effect: 'slick', weight: 2 },
      ],
      backmarker: [
        { effect: 'charge', weight: 4 },
        { effect: 'nitro', weight: 4 },
        { effect: 'ward', weight: 3 },
        { effect: 'slick', weight: 1 },
      ],
    });
    // Two seconds of burst at 1.3x the ceiling, with a 6 yd/s kick to start it.
    expect(REALM_RACERS_NITRO_TICKS).toBe(40);
    expect(REALM_RACERS_NITRO_TICKS).toBe(2 * TICK_RATE);
    expect(REALM_RACERS_NITRO_SPEED_MULT).toBe(1.3);
    expect(REALM_RACERS_NITRO_KICK).toBe(6);
    // And the oil: a patch a bit wider than a box's catch, twelve seconds on the
    // road, a second and a half of sliding at 15 percent of the grip, and never
    // more patches at once than the renderer has slots for.
    expect(REALM_RACERS_SLICK_RADIUS).toBe(2.6);
    expect(REALM_RACERS_SLICK_LIFETIME_TICKS).toBe(240);
    expect(REALM_RACERS_SLICK_GRIP_TICKS).toBe(30);
    expect(REALM_RACERS_SLICK_GRIP).toBe(0.15);
    expect(REALM_RACERS_SLICK_CAP).toBe(16);
  });

  it('reads the band off where the taker is running', () => {
    expect(rallyPickupBand(0, 4)).toBe('leader');
    expect(rallyPickupBand(1, 4)).toBe('midfield');
    expect(rallyPickupBand(2, 4)).toBe('midfield');
    expect(rallyPickupBand(3, 4)).toBe('backmarker');
    // A field of two has no midfield, and a solo practice lap is its own leader:
    // practice must not quietly play the catch-up game. A field where NOBODY has
    // moved yet (every machine tied on the grid) collapses to the leader band
    // for the same reason: nobody is AHEAD of anybody, so every rank is 0.
    expect(rallyPickupBand(1, 2)).toBe('backmarker');
    expect(rallyPickupBand(0, 1)).toBe('leader');
  });

  it('clamps a roll that could not have come off the stream', () => {
    expect(drawRallyPickupEffect('leader', -1)).toBe('charge');
    expect(drawRallyPickupEffect('leader', 1)).toBe(
      REALM_RACERS_PICKUP_TABLES.leader[REALM_RACERS_PICKUP_TABLES.leader.length - 1].effect,
    );
  });

  it('names the two effects a racer HOLDS', () => {
    expect(isRallyHeldEffect('nitro')).toBe(true);
    expect(isRallyHeldEffect('slick')).toBe(true);
    // The other two happen at the box: ammunition has nothing to decide, and a
    // shield a pilot would arm immediately is not a decision either.
    expect(isRallyHeldEffect('charge')).toBe(false);
    expect(isRallyHeldEffect('ward')).toBe(false);
    // And each held effect is spent through its own ability, both ways round.
    expect(REALM_RACERS_EFFECT_ABILITIES).toEqual({
      nitro: REALM_RACERS_NITRO_ABILITY_ID,
      slick: REALM_RACERS_SLICK_ABILITY_ID,
    });
    expect(realmRacersHeldEffectOf(REALM_RACERS_NITRO_ABILITY_ID)).toBe('nitro');
    expect(realmRacersHeldEffectOf(REALM_RACERS_SLICK_ABILITY_ID)).toBe('slick');
    expect(realmRacersHeldEffectOf(REALM_RACERS_ABILITY_ID)).toBeNull();
  });

  it('reads a held effect off the wire by NAME, never through the id mapper', () => {
    // The wire carries the effect name the server already converted; the decode
    // validates that string. Feeding the name to the id mapper answered null,
    // which is the exact defect that left an online pilot with no button for
    // the effect they were holding (seat report, 2026-08-04).
    expect(rallyHeldEffectFromWire('nitro')).toBe('nitro');
    expect(rallyHeldEffectFromWire('slick')).toBe('slick');
    expect(rallyHeldEffectFromWire(REALM_RACERS_SLICK_ABILITY_ID)).toBeNull();
    expect(rallyHeldEffectFromWire('charge')).toBeNull();
    expect(rallyHeldEffectFromWire('')).toBeNull();
    expect(realmRacersHeldEffectOf('slick')).toBeNull();
  });
});

describe('the drawn effect, in a race', () => {
  it('ranks the taker among the racers still driving', () => {
    const { sim, pids } = racingGrid();
    const [leader, back] = pids;
    // The leader well up the road, so the taker at the flag is genuinely last.
    placeOnLap(sim, leader, 0.45);

    // The SAME roll, read against two different tables. On the backmarker's it
    // is a ward; on the leader's that number is oil, so a band read off
    // anything but the standings fails this rather than passing by luck.
    const roll = rallyPickupRollFor('backmarker', 'ward');
    expect(drawRallyPickupEffect('backmarker', roll)).toBe('ward');
    expect(drawRallyPickupEffect('leader', roll)).toBe('slick');
    installScriptedRng(sim).script(roll);
    standOnBox(sim, back, 0);
    sim.tick();
    expect(wardedOf(sim, back)).toBe(true);
  });

  it('leaves a RETIRED racer out of the field the band is read against', () => {
    // The arrangement is chosen so the bug WOULD show: a quitter parked BEHIND
    // the taker. Counting them makes the taker no longer last (backmarker turns
    // into midfield); a quitter parked between the leader and the taker cannot
    // catch anything, because the taker is last with or without them.
    const { sim, pids } = racingGrid();
    const [leader, middle, taker, quitter] = pids;
    // Every position RELATIVE to the box the take happens on, never written as a
    // constant. The taker has to be last among the live racers or the band read
    // is not the backmarker's, and where a circuit's pickup rows sit is content:
    // the row this box belongs to moved from 12 percent of the lap to 42, which
    // put the taker ahead of two machines placed at fixed fractions and read the
    // MIDFIELD table while still calling itself a backmarker case.
    const boxFraction = boxLapFraction(0);
    // Room either side for the spread below, so it stays inside one lap wherever
    // the row sits, and the case fails by name rather than by wrapping if not.
    expect(boxFraction, 'the row leaves room to place a field around it').toBeGreaterThan(0.15);
    expect(boxFraction, 'the row leaves room to place a field around it').toBeLessThan(0.75);
    placeOnLap(sim, leader, boxFraction + 0.2);
    placeOnLap(sim, middle, boxFraction + 0.1);
    placeOnLap(sim, taker, boxFraction);
    placeOnLap(sim, quitter, boxFraction - 0.1);
    realmRacersForfeit(sim.ctx, quitter);
    // The premises, asserted: the quitter is out of the race and really is
    // behind the taker, so counting them would put a fourth machine in the
    // field with the taker no longer at the back of it.
    expect(progressOf(sim, quitter).retiredTick).not.toBeNull();
    expect(progressOf(sim, quitter).travelled).toBeLessThan(progressOf(sim, taker).travelled);
    // ...and the taker is last of the ones still driving, which is the other
    // half of the same premise and the half the fixed fractions lost.
    for (const ahead of [leader, middle]) {
      expect(progressOf(sim, ahead).travelled).toBeGreaterThan(progressOf(sim, taker).travelled);
    }

    // A roll that tells the two tables APART, which most do not: it sits inside
    // the backmarker's nitro slice and inside the midfield's refill.
    const roll = 5 / 12;
    expect(drawRallyPickupEffect('backmarker', roll)).toBe('nitro');
    expect(drawRallyPickupEffect('midfield', roll)).toBe('charge');
    const rng = installScriptedRng(sim);
    rng.script(roll);
    standOnBox(sim, taker, 0);
    sim.tick();
    expect(rng.consumed).toBe(1);
    expect(progressOf(sim, taker).heldEffect).toBe('nitro');
  });

  it('names the drawn effect to the taker', () => {
    const { sim, pids } = racingGrid();
    const [a] = pids;
    const events = takeWithEffect(sim, a, 0, 'nitro');
    const named = events.filter((event) => event.type === 'realmRacersPickup');
    expect(named).toHaveLength(1);
    expect(named[0]).toMatchObject({ effect: 'nitro', pid: a });
  });

  it('announces the take world-wide with the taker and the box, never the effect', () => {
    const { sim, pids } = racingGrid();
    const [a] = pids;
    const events = takeWithEffect(sim, a, 0, 'slick');
    const taken = events.filter((event) => event.type === 'realmRacersPickupTaken');
    expect(taken).toHaveLength(1);
    const box = required(realmRacersPickupBoxes(RACE_CIRCUIT)[0], 'box 0');
    const at = realmRacersToWorld(match(sim), box.x, box.z);
    const x = Math.round(at.x * 100) / 100;
    const z = Math.round(at.z * 100) / 100;
    // Exactly these four fields, in this order: no pid (a pid makes an event
    // personal to that session) and no effect (what the box gave stays the
    // taker's own business).
    const wire = JSON.stringify(taken[0]);
    expect(wire).toBe(`{"type":"realmRacersPickupTaken","takerId":${a},"x":${x},"z":${z}}`);
    expect(Buffer.byteLength(wire)).toBe(
      54 + String(a).length + String(x).length + String(z).length,
    );
    // World-coordinate anchored, so the server interest-scopes it at the box
    // instead of broadcasting it realm-wide.
    expect(eventAnchor(taken[0], sim.entities)).toEqual({ x, y: 0, z });
  });

  it('refills the weapon on a charge draw and nothing else', () => {
    const { sim, pids } = racingGrid();
    const [a] = pids;
    const before = required(
      sim.entities.get(a)?.abilityCharges?.[REALM_RACERS_ABILITY_ID],
      'charge pool',
    ).charges;
    takeWithEffect(sim, a, 0, 'charge');
    const progress = progressOf(sim, a);
    expect(progress.heldWeapon?.charges).toBeGreaterThan(before);
    expect(wardedOf(sim, a)).toBe(false);
    expect(progress.heldEffect).toBeNull();
    expect(progress.nitroUntilTick).toBe(0);
    expect(match(sim).slicks).toEqual([]);
  });
});

describe('the held effects', () => {
  it('puts the drawn effect on the action bar instead of firing it', () => {
    const { sim, pids } = racingGrid();
    const [a] = pids;
    takeWithEffect(sim, a, 0, 'nitro');
    const progress = progressOf(sim, a);
    // Held, not spent: nothing has happened to the machine yet.
    expect(progress.heldEffect).toBe('nitro');
    expect(progress.nitroUntilTick).toBe(0);
    expect(required(sim.entities.get(a)?.drive, 'drive').speedCap).toBe(1);
    // And it is a real ability in the kit, which is what gives it a bar slot, a
    // keybind, a gamepad button and a mobile control for free. The WEAPON stays
    // first: the activity kit hands slot 0 to the first rally ability a racer
    // knows, so an effect ahead of it would take the leftmost key.
    const meta = required(sim.players.get(a), 'meta');
    expect(meta.known.map((known) => known.def.id)).toEqual([
      REALM_RACERS_ABILITY_ID,
      REALM_RACERS_NITRO_ABILITY_ID,
    ]);
    expect(meta.known[1].charges).toBe(1);
    const pool = required(
      sim.entities.get(a)?.abilityCharges?.[REALM_RACERS_NITRO_ABILITY_ID],
      'held pool',
    );
    expect(pool).toMatchObject({ charges: 1, maxCharges: 1, fixed: true });
  });

  it('falls back to the refill while a slot is already full', () => {
    const { sim, pids } = racingGrid();
    const [a] = pids;
    takeWithEffect(sim, a, 0, 'slick');
    const progress = progressOf(sim, a);
    expect(progress.heldEffect).toBe('slick');
    const charges = required(progress.heldWeapon?.charges, 'charges');

    // The pickup cooldown has to expire before a second box is takeable at all.
    for (let i = 0; i < 21; i++) sim.tick();
    // The DRAW still happens and still comes off the band's own table: the
    // fallback is decided after it, so a full slot cannot change what the
    // tables mean.
    const rng = installScriptedRng(sim);
    rng.script(rallyPickupRollFor('leader', 'nitro'));
    standOnBox(sim, a, 1);
    const events = sim.tick();
    expect(rng.consumed).toBe(1);
    expect(progress.heldEffect).toBe('slick');
    expect(required(progress.heldWeapon?.charges, 'charges')).toBeGreaterThan(charges);
    // And the pilot is told what they actually got, not what the dice said.
    expect(events.filter((event) => event.type === 'realmRacersPickup')).toMatchObject([
      { effect: 'charge', pid: a },
    ]);
  });

  it('falls back to the refill for a ward on a racer already warded', () => {
    const { sim, pids } = racingGrid();
    const [a] = pids;
    takeWithEffect(sim, a, 0, 'ward');
    const progress = progressOf(sim, a);
    expect(wardedOf(sim, a)).toBe(true);
    const charges = required(progress.heldWeapon?.charges, 'charges');

    for (let i = 0; i < 21; i++) sim.tick();
    const rng = installScriptedRng(sim);
    rng.script(rallyPickupRollFor('leader', 'ward'));
    standOnBox(sim, a, 1);
    sim.tick();
    expect(rng.consumed).toBe(1);
    expect(wardedOf(sim, a)).toBe(true);
    // ONE ward, never two: the fallback is what stops a second grant, and the
    // aura is what the fallback reads.
    expect(
      sim.entities.get(a)?.auras.filter((aura) => aura.id === REALM_RACERS_WARD_AURA),
    ).toHaveLength(1);
    expect(required(progress.heldWeapon?.charges, 'charges')).toBeGreaterThan(charges);
  });

  it('raises the top speed for the burst when the pilot spends it, then decays', () => {
    const { sim, pids } = racingGrid();
    const [a] = pids;
    takeWithEffect(sim, a, 0, 'nitro');
    const drive = required(sim.entities.get(a)?.drive, 'drive');
    const profile = vehicleProfile(REALM_RACERS_VEHICLE_KEY);
    const progress = progressOf(sim, a);
    const speedBefore = drive.speed;

    // Spent through the ORDINARY cast path, which is what the bar, the keybind,
    // the gamepad button and the mobile control all reach.
    sim.castAbility(REALM_RACERS_NITRO_ABILITY_ID, a);
    expect(progress.heldEffect).toBeNull();
    expect(progress.nitroUntilTick).toBe(sim.tickCount + REALM_RACERS_NITRO_TICKS);
    // The ceiling is up the moment the button is pressed, not a tick later, and
    // the kick is on top of it so the burst is felt rather than climbed toward.
    expect(drive.speedCap).toBe(REALM_RACERS_NITRO_SPEED_MULT);
    expect(vehicleMaxSpeed(profile, drive, 1)).toBeCloseTo(
      profile.maxSpeed * REALM_RACERS_NITRO_SPEED_MULT,
      9,
    );
    expect(drive.speed).toBeCloseTo(speedBefore + REALM_RACERS_NITRO_KICK, 6);
    // The button goes with the charge: an empty slot never sits on the bar.
    expect(required(sim.players.get(a), 'meta').known.map((known) => known.def.id)).toEqual([
      REALM_RACERS_ABILITY_ID,
    ]);
    expect(sim.entities.get(a)?.abilityCharges?.[REALM_RACERS_NITRO_ABILITY_ID]).toBeUndefined();

    // Still up in the middle of the burst, gone once it expires. The surface
    // pass rewrites the ceiling every tick, so this is the real path.
    for (let i = 0; i < REALM_RACERS_NITRO_TICKS / 2; i++) sim.tick();
    expect(drive.speedCap).toBe(REALM_RACERS_NITRO_SPEED_MULT);
    while (sim.tickCount <= progress.nitroUntilTick) sim.tick();
    expect(drive.speedCap).toBe(1);
    expect(vehicleMaxSpeed(profile, drive, 1)).toBe(profile.maxSpeed);

    // And what happens to a machine still travelling above the ordinary ceiling
    // is a DECAY, not a snap: the kernel sinks it at the profile's capDecel, so
    // a burst that ends on a straight reads as the engine easing rather than as
    // hitting something. (Driven through the kernel directly: the ceiling is the
    // sim's business, the sinking is the kernel's.)
    drive.speed = profile.maxSpeed * REALM_RACERS_NITRO_SPEED_MULT;
    advanceVehicleDrive(drive, profile, {
      throttle: 1,
      steer: 0,
      handbrake: false,
      onGround: true,
      auraMult: 1,
    });
    expect(drive.speed).toBeLessThan(profile.maxSpeed * REALM_RACERS_NITRO_SPEED_MULT);
    expect(drive.speed).toBeGreaterThan(profile.maxSpeed);
  });

  it('drops the oil under the MACHINE when the pilot spends it', () => {
    const { sim, pids } = racingGrid();
    const [a] = pids;
    const box = realmRacersPickupBoxes(RACE_CIRCUIT)[0];
    takeWithEffect(sim, a, 0, 'slick');
    // Driven well away from the row before spending it: the patch goes where the
    // pilot chose, which is the whole of what makes it a decision (22a dropped
    // it at the row, and the operator's override moved it here).
    const point = realmRacersTrack(RACE_CIRCUIT).pointAt(realmRacersTrack(RACE_CIRCUIT).length / 2);
    standAt(sim, a, point.x, point.z);
    const spentTick = sim.tickCount;
    sim.castAbility(REALM_RACERS_SLICK_ABILITY_ID, a);

    const slicks = match(sim).slicks;
    expect(slicks).toHaveLength(1);
    expect(slicks[0].x).toBeCloseTo(point.x, 3);
    expect(slicks[0].z).toBeCloseTo(point.z, 3);
    expect(Math.hypot(slicks[0].x - box.x, slicks[0].z - box.z)).toBeGreaterThan(20);
    expect(slicks[0]).toMatchObject({ ownerPid: a });
    expect(slicks[0].expiresTick).toBe(spentTick + REALM_RACERS_SLICK_LIFETIME_TICKS);
    expect(progressOf(sim, a).heldEffect).toBeNull();
    // Announced once, world-wide, naming the dropper: the readout's patch
    // carries no owner, and this is what a client draws the spray from.
    const drops = sim.drainEvents().filter((event) => event.type === 'realmRacersSlickDropped');
    const machine = required(sim.entities.get(a), 'dropper').pos;
    const x = Math.round(machine.x * 100) / 100;
    const z = Math.round(machine.z * 100) / 100;
    expect(drops).toEqual([{ type: 'realmRacersSlickDropped', sourceId: a, x, z }]);
    const wire = JSON.stringify(drops[0]);
    expect(wire).toBe(`{"type":"realmRacersSlickDropped","sourceId":${a},"x":${x},"z":${z}}`);
    expect(Buffer.byteLength(wire)).toBe(
      56 + String(a).length + String(x).length + String(z).length,
    );
    expect(eventAnchor(drops[0], sim.entities)).toEqual({ x, y: 0, z });
    // And it reaches the readout every racer in the match mirrors, rounded to
    // the hundredth of a yard the shared builder ships.
    expect(sim.realmRacersInfoFor(pids[1]).match?.slicks).toEqual([
      {
        id: slicks[0].id,
        x: Math.round(slicks[0].x * 100) / 100,
        z: Math.round(slicks[0].z * 100) / 100,
      },
    ]);
  });

  it('refuses a cast for an effect the racer does not hold', () => {
    const { sim, pids } = racingGrid();
    const [a] = pids;
    takeWithEffect(sim, a, 0, 'nitro');
    const progress = progressOf(sim, a);
    // The SLOT is the authority, never the button: a stale bar (or a cheat
    // client naming the other id) spends nothing.
    sim.castAbility(REALM_RACERS_SLICK_ABILITY_ID, a);
    expect(match(sim).slicks).toEqual([]);
    expect(progress.heldEffect).toBe('nitro');

    // And spending it twice is spending it once: the charge goes with the slot,
    // so a second press does nothing at all.
    sim.castAbility(REALM_RACERS_NITRO_ABILITY_ID, a);
    const armed = progress.nitroUntilTick;
    expect(armed).toBeGreaterThan(0);
    sim.tick();
    sim.castAbility(REALM_RACERS_NITRO_ABILITY_ID, a);
    expect(progress.nitroUntilTick).toBe(armed);
  });

  it('draws no rng when a held effect is spent', () => {
    const { sim, pids } = racingGrid();
    const [a] = pids;
    takeWithEffect(sim, a, 0, 'slick');
    const seen: number[] = [];
    sim.rng.setObserver((value) => seen.push(value));
    try {
      sim.castAbility(REALM_RACERS_SLICK_ABILITY_ID, a);
    } finally {
      sim.rng.setObserver(null);
    }
    // The randomness was spent at the box. A draw here would put the shared
    // stream on the player's trigger finger.
    expect(seen).toEqual([]);
    expect(match(sim).slicks).toHaveLength(1);
  });
});

describe('the ward', () => {
  /**
   * Drops a shell centred `distance` yards from the racer, on a diagonal.
   *
   * The falloff helper is symmetric in its operands, so an axis-aligned case
   * would pass just as happily with x and z swapped; the two legs are also
   * deliberately unequal so neither is a special case of the other.
   */
  function shellNear(sim: Sim, victim: number, owner: number, distance: number): void {
    const racer = required(sim.entities.get(victim), 'racer');
    const leg = distance / Math.hypot(1, 0.999);
    match(sim).groundBlasts.push({
      ownerPid: owner,
      x: racer.pos.x + leg,
      z: racer.pos.z + leg * 0.999,
      impactTick: sim.tickCount + 1,
    });
  }

  it('is a real AURA on the machine, classified as a buff and shown with its countdown', () => {
    const { sim, pids } = racingGrid();
    const [a] = pids;
    takeWithEffect(sim, a, 0, 'ward');
    const aura = required(wardAuraOf(sim, a), 'ward aura');
    // The shape, spelled out: a marker kind of its own (nothing borrowed that
    // would drag mechanics in), no stat effect, physical so no dispel in the
    // game can strip it, and the ten-second clock it runs out on.
    expect(REALM_RACERS_WARD_AURA_SECONDS).toBe(10);
    expect(aura).toMatchObject({
      id: REALM_RACERS_WARD_AURA,
      name: 'Racing Ward',
      kind: 'rally_ward',
      value: 0,
      school: 'physical',
      remaining: REALM_RACERS_WARD_AURA_SECONDS,
      duration: REALM_RACERS_WARD_AURA_SECONDS,
    });
    // BUFF, through the one classifier the HUD and the sim share.
    expect(isDebuffAura(aura.kind, aura.value)).toBe(false);
    expect(isAuraDebuff(aura)).toBe(false);
    // A timed buff, not a mode: the countdown the pilot plans around is shown.
    expect(isToggleAura(aura.kind, aura.id)).toBe(false);

    const units = { s: 's', m: 'm', h: 'h', d: 'd' };
    const view = createAurasView('buffs', {
      iconId: (input) => `aura_${input.kind}`,
      auraName: (input) => input.name,
      formatStacks: (n) => String(n),
      auraEffectHtml: () => '',
      durationUnits: () => units,
      isOwn: () => true,
    });
    const painted = view.tick({ auras: [aura] });
    expect(painted.count).toBe(1);
    expect(painted.slots[0]).toMatchObject({
      isDebuff: false,
      durationText: '10s',
      expiring: false,
      toggle: false,
      // The icon the pickup splash asks for by name, so the two surfaces cannot
      // draw different wards.
      iconKey: 'aura_rally_ward',
    });
    // And it blinks as it runs out, like every other timed buff.
    const ending = view.tick({ auras: [{ ...aura, remaining: 2.5 }] });
    expect(ending.slots[0]).toMatchObject({ durationText: '3s', expiring: true });
  });

  it('absorbs exactly one Ground Blast, then breaks', () => {
    const { sim, pids } = racingGrid();
    const [a, shooter] = pids;
    takeWithEffect(sim, a, 0, 'ward');
    const progress = progressOf(sim, a);
    expect(wardedOf(sim, a)).toBe(true);

    const racer = required(sim.entities.get(a), 'racer');
    shellNear(sim, a, shooter, GROUND_BLAST_RADIUS - 0.01);
    const absorbed = sim.tick();
    expect(wardedOf(sim, a)).toBe(false);
    expect(progress.groundBlastShockUntilTick).toBe(0);
    expect(racer.vy).toBe(0);
    expect(absorbed.filter((event) => event.type === 'realmRacersWardBroken')).toMatchObject([
      { pid: a },
    ]);
    // The shell that was eaten caught NOBODY: a warded machine is not the
    // nearest hit, so the crater is announced as landing on empty track.
    expect(absorbed.filter((event) => event.type === 'realmRacersGroundBlastHit')).toMatchObject([
      { targetId: null },
    ]);
    // Nor is it in the per-racer list a client pops drawn rivals from.
    expect(absorbed.find((event) => event.type === 'realmRacersGroundBlastHit')).not.toHaveProperty(
      'hits',
    );

    // And the ward is spent: the next shell lands in full.
    shellNear(sim, a, shooter, GROUND_BLAST_RADIUS - 0.01);
    const landed = sim.tick();
    expect(progress.groundBlastShockUntilTick).toBe(sim.tickCount + GROUND_BLAST_SHOCK_TICKS);
    expect(landed.filter((event) => event.type === 'realmRacersWardBroken')).toEqual([]);
    expect(landed.filter((event) => event.type === 'realmRacersGroundBlastHit')).toMatchObject([
      { targetId: a },
    ]);
  });

  it('is not spent by a shell that missed', () => {
    const { sim, pids } = racingGrid();
    const [a, shooter] = pids;
    takeWithEffect(sim, a, 0, 'ward');
    const progress = progressOf(sim, a);
    // A hair OUTSIDE the blast: a one-shot shield eaten by a near miss would be
    // worse than no shield at all.
    shellNear(sim, a, shooter, GROUND_BLAST_RADIUS + 0.01);
    const missed = sim.tick();
    expect(wardedOf(sim, a)).toBe(true);
    expect(missed.filter((event) => event.type === 'realmRacersWardBroken')).toEqual([]);
    expect(progress.groundBlastShockUntilTick).toBe(0);
  });

  it('comes off on every way out of a race: forfeit, disconnect and the flag', () => {
    const { sim, pids } = racingGrid();
    const [a, b, c, d] = pids;
    const [boxB, boxC, boxD] = spreadBoxes();
    takeWithEffect(sim, b, boxB, 'ward');
    for (let i = 0; i < 21; i++) sim.tick();
    takeWithEffect(sim, c, boxC, 'ward');
    for (let i = 0; i < 21; i++) sim.tick();
    takeWithEffect(sim, d, boxD, 'ward');
    for (const pid of [b, c, d]) expect(wardedOf(sim, pid), `premise ${pid}`).toBe(true);
    const live = match(sim);

    // Forfeit: the quitter keeps their machine for the tableau, but not the
    // ward, which every rival would otherwise see as a live gold veil.
    realmRacersForfeit(sim.ctx, b);
    expect(progressOf(sim, b).retiredTick).not.toBeNull();
    expect(progressOf(sim, b).returned).toBe(false);
    expect(wardedOf(sim, b)).toBe(false);
    // The fade the buff bar listens for rides out with the next tick.
    expect(sim.tick()).toContainEqual(
      expect.objectContaining({ type: 'aura', targetId: b, gained: false }),
    );

    // Disconnect: restored on the spot, ward and all.
    realmRacersForfeit(sim.ctx, c, true);
    expect(progressOf(sim, c).returned).toBe(true);
    expect(wardedOf(sim, c)).toBe(false);

    // The flag: `a` quits too, which leaves `d` the lone runner and decides
    // the race with d still on the circuit and still warded.
    expect(live.phase).toBe('racing');
    expect(wardedOf(sim, d)).toBe(true);
    realmRacersForfeit(sim.ctx, a);
    expect(live.phase).toBe('finished');
    expect(progressOf(sim, d).returned).toBe(false);
    expect(progressOf(sim, d).retiredTick).toBeNull();
    expect(wardedOf(sim, d)).toBe(false);
  });

  it('is swept off the circuit with the flag, along with the oil', () => {
    const { sim, pids } = racingGrid();
    const [a, b, c, d] = pids;
    // A race with everything LIVE when the flag falls: a ward standing, a nitro
    // mid-burst, oil well inside its lifetime, and a machine actually sliding in
    // it. (Running the race out on its 180 s deadline instead, as the first
    // version did, expires every one of those first and asserts about nothing.)
    // The machine in the oil is deliberately NOT the warded one: a ward absorbs
    // oil, so driving the warded pilot into it would spend the very thing this
    // case is about.
    const [wardBox, slickBox, nitroBox] = spreadBoxes();
    takeWithEffect(sim, a, wardBox, 'ward');
    for (let i = 0; i < 21; i++) sim.tick();
    takeWithEffect(sim, b, slickBox, 'slick');
    sim.castAbility(REALM_RACERS_SLICK_ABILITY_ID, b);
    const live = match(sim);
    const slick = required(live.slicks[0], 'slick');
    for (let i = 0; i < 21; i++) sim.tick();
    takeWithEffect(sim, c, nitroBox, 'nitro');
    sim.castAbility(REALM_RACERS_NITRO_ABILITY_ID, c);
    // And the fourth machine into the puddle, so a grip clock is running too.
    standAt(sim, d, slick.x, slick.z);
    sim.tick();

    // The premises, every one of them, so no assertion below is vacuous.
    expect(wardedOf(sim, a)).toBe(true);
    expect(wardAuraOf(sim, a)?.remaining).toBeGreaterThan(0);
    expect(progressOf(sim, d).slickGripUntilTick).toBeGreaterThan(sim.tickCount);
    expect(progressOf(sim, c).nitroUntilTick).toBeGreaterThan(sim.tickCount);
    expect(required(sim.entities.get(c)?.drive, 'drive').speedCap).toBe(
      REALM_RACERS_NITRO_SPEED_MULT,
    );
    expect(live.slicks.length).toBeGreaterThan(0);
    expect(slick.expiresTick).toBeGreaterThan(sim.tickCount);

    // The flag falls on all of it, deliberately rather than on the clock.
    for (const pid of pids) realmRacersForfeit(sim.ctx, pid);
    expect(live.phase).toBe('finished');
    expect(live.slicks).toEqual([]);
    for (const pid of pids) {
      const progress = progressOf(sim, pid);
      expect(wardedOf(sim, pid)).toBe(false);
      expect(progress.nitroUntilTick).toBe(0);
      expect(progress.slickGripUntilTick).toBe(0);
      expect(progress.slickContactUntilTick).toBe(0);
      expect(progress.heldEffect).toBeNull();
      // And the machine's ceiling comes back down with it: the surface pass
      // stops running once the phase leaves `racing`, so a nitro live at the
      // flag would otherwise stand through the whole tableau. A pilot whose
      // forfeit landed AFTER the flag was sent straight home instead, so they
      // have no machine at all.
      if (progress.returned) {
        expect(sim.entities.get(pid)?.drive).toBeNull();
      } else {
        expect(required(sim.entities.get(pid)?.drive, 'drive').speedCap).toBe(1);
      }
    }
  });
});

describe('the ward runs out on its own', () => {
  /** The ward's whole life in ticks, off the live constant. */
  const WARD_TICKS = REALM_RACERS_WARD_AURA_SECONDS * TICK_RATE;

  /** A shell whose impact lands on the NEXT tick, centred just inside the blast
   *  on the racer (the twin of the ward suite's helper). */
  function shellOn(sim: Sim, victim: number, owner: number): void {
    const racer = required(sim.entities.get(victim), 'racer');
    const leg = (GROUND_BLAST_RADIUS - 0.01) / Math.hypot(1, 0.999);
    match(sim).groundBlasts.push({
      ownerPid: owner,
      x: racer.pos.x + leg,
      z: racer.pos.z + leg * 0.999,
      impactTick: sim.tickCount + 1,
    });
  }

  /** Take a ward, then tick until `ticksAfterGrant` ticks have passed since the
   *  tick that granted it. Returns every event those ticks emitted. */
  function wardedFor(ticksAfterGrant: number): {
    sim: Sim;
    pids: number[];
    grantedAt: number;
    events: SimEvent[];
  } {
    const { sim, pids } = racingGrid();
    takeWithEffect(sim, pids[0], 0, 'ward');
    const grantedAt = sim.tickCount;
    expect(wardedOf(sim, pids[0])).toBe(true);
    const events: SimEvent[] = [];
    while (sim.tickCount < grantedAt + ticksAfterGrant) events.push(...sim.tick());
    return { sim, pids, grantedAt, events };
  }

  it('ends exactly ten seconds after the take, with the fade every client clears it on', () => {
    expect(WARD_TICKS).toBe(200);
    const { sim, pids, grantedAt } = wardedFor(WARD_TICKS - 1);
    const [a] = pids;
    // The last tick of the window: still up, a tick's worth of clock left.
    expect(wardedOf(sim, a)).toBe(true);
    expect(required(wardAuraOf(sim, a), 'ward aura').remaining).toBeCloseTo(1 / TICK_RATE, 9);
    const expiry = sim.tick();
    expect(sim.tickCount).toBe(grantedAt + WARD_TICKS);
    expect(wardedOf(sim, a)).toBe(false);
    // The aura system's own expiry, which emits the same fade the spend path
    // does, so the buff bar, the aura log and every mirror drop it alike.
    expect(expiry.filter((event) => event.type === 'aura' && event.targetId === a)).toEqual([
      { type: 'aura', targetId: a, name: 'Racing Ward', gained: false },
    ]);
    // Running out is not breaking: nothing hit it, so nothing announces it.
    expect(expiry.filter((event) => event.type === 'realmRacersWardBroken')).toEqual([]);
    // And the readout the race strip reads follows the aura it is derived from.
    expect(sim.realmRacersInfoFor(a).match?.warded).toBe(false);
  });

  it('never announces a break for a ward that ran out, however long the race goes on', () => {
    const { sim, pids, events } = wardedFor(WARD_TICKS + TICK_RATE);
    expect(wardedOf(sim, pids[0])).toBe(false);
    expect(events.filter((event) => event.type === 'realmRacersWardBroken')).toEqual([]);
    expect(
      events.filter(
        (event) => event.type === 'aura' && event.targetId === pids[0] && !event.gained,
      ),
    ).toHaveLength(1);
  });

  it('still absorbs a Ground Blast landing on its last tick, 9.95 s in', () => {
    const { sim, pids, grantedAt } = wardedFor(WARD_TICKS - 2);
    const [a, shooter] = pids;
    const progress = progressOf(sim, a);
    shellOn(sim, a, shooter);
    const absorbed = sim.tick();
    expect(sim.tickCount).toBe(grantedAt + WARD_TICKS - 1);
    expect(absorbed.filter((event) => event.type === 'realmRacersWardBroken')).toMatchObject([
      { pid: a },
    ]);
    expect(progress.groundBlastShockUntilTick).toBe(0);
    expect(wardedOf(sim, a)).toBe(false);
  });

  it('is gone once the clock runs out: a Ground Blast at 10.05 s lands in full', () => {
    const { sim, pids, grantedAt } = wardedFor(WARD_TICKS);
    const [a, shooter] = pids;
    const progress = progressOf(sim, a);
    expect(wardedOf(sim, a)).toBe(false);
    shellOn(sim, a, shooter);
    const landed = sim.tick();
    expect(sim.tickCount).toBe(grantedAt + WARD_TICKS + 1);
    expect(landed.filter((event) => event.type === 'realmRacersWardBroken')).toEqual([]);
    expect(landed.filter((event) => event.type === 'realmRacersGroundBlastHit')).toMatchObject([
      { targetId: a },
    ]);
    expect(progress.groundBlastShockUntilTick).toBe(sim.tickCount + GROUND_BLAST_SHOCK_TICKS);
  });

  it('keeps its first clock when a second ward is drawn: the draw falls back to the refill', () => {
    const { sim, pids } = racingGrid();
    const [a] = pids;
    takeWithEffect(sim, a, 0, 'ward');
    const grantedAt = sim.tickCount;
    for (let i = 0; i < 21; i++) sim.tick();
    takeWithEffect(sim, a, 1, 'ward');
    // No refresh: the ward still ends ten seconds after the FIRST take.
    const aura = required(wardAuraOf(sim, a), 'ward aura');
    expect(aura.remaining).toBeCloseTo(
      REALM_RACERS_WARD_AURA_SECONDS - (sim.tickCount - grantedAt) / TICK_RATE,
      9,
    );
    while (sim.tickCount < grantedAt + WARD_TICKS - 1) sim.tick();
    expect(wardedOf(sim, a)).toBe(true);
    sim.tick();
    expect(wardedOf(sim, a)).toBe(false);
  });
});

describe('a machine the referee puts back', () => {
  it('keeps what it won and loses what the ground was doing to it', () => {
    const { sim, pids } = racingGrid();
    const [a] = pids;
    takeWithEffect(sim, a, 0, 'ward');
    const progress = progressOf(sim, a);
    // Everything live at once: a ward carried, a nitro burning, and the machine
    // sliding through a rival's oil.
    progress.nitroUntilTick = sim.tickCount + REALM_RACERS_NITRO_TICKS;
    progress.slickGripUntilTick = sim.tickCount + REALM_RACERS_SLICK_GRIP_TICKS;
    progress.slickContactUntilTick = sim.tickCount + REALM_RACERS_SLICK_GRIP_TICKS;
    progress.groundBlastShockUntilTick = sim.tickCount + GROUND_BLAST_SHOCK_TICKS;
    const drive = required(sim.entities.get(a)?.drive, 'drive');
    drive.speedCap = REALM_RACERS_NITRO_SPEED_MULT;
    expect(wardedOf(sim, a)).toBe(true);

    expect(realmRacersResetPosition(sim.ctx, a)).toBeUndefined();

    // The ward is a thing the pilot WON: a recovery does not confiscate it, and
    // it must not ride any of the aura cleanup the reset DOES do (the off-track
    // band aura is stripped there, by id).
    expect(wardedOf(sim, a)).toBe(true);
    expect(sim.entities.get(a)?.auras.some((aura) => aura.id === REALM_RACERS_OFF_TRACK_AURA)).toBe(
      false,
    );
    // Everything the ground was doing to the machine is behind it, and so is a
    // burst it can no longer spend (the recovery stopped it dead).
    expect(progress.nitroUntilTick).toBe(0);
    expect(progress.slickGripUntilTick).toBe(0);
    expect(progress.slickContactUntilTick).toBe(0);
    // The shock of a shell hit goes with the rest: a recovery is a fresh
    // start, not a way to serve out a control penalty while teleporting.
    expect(progress.groundBlastShockUntilTick).toBe(0);
    expect(drive.speedCap).toBe(1);
  });
});

describe('the pickups stay deterministic', () => {
  it('gives the same race the same effects twice', () => {
    // Two runs of one script on one seed, through the REAL stream (nothing is
    // scripted here): the draw is the only new rng site in the phase, so a
    // second run that disagreed would mean the take order, the ranking or the
    // draw itself had picked up something outside the sim clock.
    const run = () => {
      const sim = makeWorld();
      const pids = GRID.map((row) => addAt(sim, row.cls, row.name, row.x, row.z));
      realmRacersStartMatch(sim.ctx, pids, undefined, RACE_CIRCUIT.id);
      readyAllRacers(sim);
      sim.tick();
      for (let i = 0; i < REALM_RACERS_COUNTDOWN_TICKS; i++) sim.tick();
      const drawn: string[] = [];
      for (let lane = 0; lane < 4; lane++) {
        standOnBox(sim, pids[lane], lane);
        for (const event of sim.tick()) {
          if (event.type === 'realmRacersPickup') drawn.push(`${event.pid}:${event.effect}`);
        }
      }
      const live = match(sim);
      return {
        drawn,
        slicks: live.slicks.map((slick) => `${slick.id}@${slick.x.toFixed(4)}`),
        held: pids.map((pid) => live.progress.get(pid)?.heldEffect ?? '-'),
        warded: pids.map((pid) => realmRacersWarded(sim.entities.get(pid))),
        charges: pids.map((pid) => live.progress.get(pid)?.heldWeapon?.charges),
      };
    };
    const first = run();
    expect(first.drawn).toHaveLength(4);
    expect(run()).toEqual(first);
  });
});
