// The race strips the auras a pilot walks in with and hands them back on the
// way out, aged by the time the race held them (mortar_overdrive/auras.ts).
import { describe, expect, it } from 'vitest';
import { leaveMortarOverdriveForModeration } from '../server/mortar_overdrive/commands';
import { mortarOverdriveCompetitionCircuits } from '../src/sim/content/mortar_overdrive/circuits';
import { CHEATER_MARK_AURA_ID } from '../src/sim/moderation/cheater_mark';
import {
  mortarOverdriveAurasAt,
  settleMortarOverdriveStrippedAuras,
  snapshotMortarOverdriveStrippedAuras,
} from '../src/sim/mortar_overdrive/auras';
import { startMortarOverdrivePractice } from '../src/sim/mortar_overdrive/bots';
import {
  MORTAR_OVERDRIVE_OFF_TRACK_AURA,
  MORTAR_OVERDRIVE_RETURN_TICKS,
  MORTAR_OVERDRIVE_WARD_AURA,
  mortarOverdriveCircuitOf,
  mortarOverdriveMatchOf,
  mortarOverdriveStartMatch,
  updateMortarOverdrive,
} from '../src/sim/mortar_overdrive/race';
import { mortarOverdriveTrack } from '../src/sim/mortar_overdrive/spline';
import type { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';
import { TICK_RATE } from '../src/sim/types';
import { WELL_FED_AURA_ID } from '../src/sim/wellfed';
import { addAt, makeWorld, teleport } from './mortar_overdrive_util';

const RACE_CIRCUIT = mortarOverdriveCompetitionCircuits()[0];

function aura(id: string, kind: Aura['kind'], remaining: number, extra: Partial<Aura> = {}): Aura {
  return {
    id,
    name: id,
    kind,
    remaining,
    duration: Math.max(remaining, 1),
    value: 5,
    sourceId: 0,
    school: 'nature',
    ...extra,
  } as Aura;
}

function body(sim: Sim, pid: number): Entity {
  const e = sim.entities.get(pid);
  if (!e) throw new Error(`no entity ${pid}`);
  return e;
}

function find(e: Entity, id: string): Aura | undefined {
  return e.auras.find((a) => a.id === id);
}

/** Ticks until the pilot is home (off every grid), returning the tick count
 *  after the return tick. */
function tickUntilHome(sim: Sim, pid: number, budget = 600): number {
  for (let i = 0; i < budget; i++) {
    if (sim.players.get(pid)?.mortarOverdriveMatchId === null) return sim.tickCount;
    sim.tick();
  }
  throw new Error('pilot never came home');
}

/** The returned remaining time sits between the seat-to-return gap measured
 *  before and after the return tick, allowing the aura pass of the return tick
 *  itself to age it once more. */
function expectAged(remaining: number | undefined, start: number, seatTick: number, home: number) {
  expect(remaining).toBeDefined();
  const latest = start - (home - seatTick + 1) / TICK_RATE;
  const earliest = start - (home - 1 - seatTick) / TICK_RATE;
  expect(remaining as number).toBeGreaterThanOrEqual(latest - 1e-6);
  expect(remaining as number).toBeLessThanOrEqual(earliest + 1e-6);
}

describe('Mortar Overdrive hands the stripped auras back on the return', () => {
  it('Practice: a food buff comes back with its remaining time minus the race', () => {
    const sim = makeWorld();
    const pid = addAt(sim, 'warrior', 'Pilot');
    const e = body(sim, pid);
    e.auras.push(aura(WELL_FED_AURA_ID, 'buff_sta', 1800, { sourceId: pid }));
    const seatTick = sim.tickCount;
    expect(startMortarOverdrivePractice(sim, 'rookie', pid)).toBe(true);
    // The race itself stays a clean slate.
    expect(find(e, WELL_FED_AURA_ID)).toBeUndefined();
    for (let i = 0; i < 200; i++) sim.tick();
    expect(find(e, WELL_FED_AURA_ID)).toBeUndefined();
    sim.mortarOverdriveForfeit(pid);
    const home = tickUntilHome(sim, pid);
    expect(home - seatTick).toBeGreaterThan(200 + MORTAR_OVERDRIVE_RETURN_TICKS - 2);
    expectAged(find(e, WELL_FED_AURA_ID)?.remaining, 1800, seatTick, home);
    expect(sim.mortarOverdrive.practices).toHaveLength(0);
  });

  it('forfeit from a rated heat: the buff and its stat effect return', () => {
    const sim = makeWorld();
    const pids = [
      addAt(sim, 'warrior', 'Aster', -5, -40),
      addAt(sim, 'mage', 'Briar', 7, -42),
      addAt(sim, 'rogue', 'Cass', -9, -38),
      addAt(sim, 'priest', 'Dell', 11, -44),
    ];
    const e = body(sim, pids[0]);
    const baseHp = e.maxHp;
    e.auras.push(aura('fortitude_test', 'buff_sta', 900, { value: 40 }));
    sim.ctx.recalcPlayer(e);
    const buffedHp = e.maxHp;
    expect(buffedHp).toBeGreaterThan(baseHp);
    const seatTick = sim.tickCount;
    expect(mortarOverdriveStartMatch(sim.ctx, pids, undefined, RACE_CIRCUIT.id)).toBe(true);
    expect(e.maxHp).toBe(baseHp);
    for (let i = 0; i < 40; i++) sim.tick();
    sim.mortarOverdriveForfeit(pids[0]);
    const home = tickUntilHome(sim, pids[0]);
    expectAged(find(e, 'fortitude_test')?.remaining, 900, seatTick, home);
    expect(e.maxHp).toBe(buffedHp);
    // The race goes on for the other three.
    expect(sim.mortarOverdrive.match).not.toBeNull();
  });

  it('drops an aura whose time ran out during the race, and keeps an untimed one as it was', () => {
    const sim = makeWorld();
    const pid = addAt(sim, 'paladin', 'Pilot');
    const e = body(sim, pid);
    e.auras.push(
      aura('short_elixir', 'buff_str', 3),
      aura('devotion_test', 'buff_armor', 0, { permanent: true, duration: 0 }),
    );
    expect(startMortarOverdrivePractice(sim, 'rookie', pid)).toBe(true);
    for (let i = 0; i < 4 * TICK_RATE; i++) sim.tick();
    sim.mortarOverdriveForfeit(pid);
    tickUntilHome(sim, pid);
    expect(find(e, 'short_elixir')).toBeUndefined();
    const devotion = find(e, 'devotion_test');
    expect(devotion?.permanent).toBe(true);
    expect(devotion?.remaining).toBe(0);
  });

  it('never lets a race aura leak back, and never doubles what the seat kept', () => {
    const sim = makeWorld();
    const pid = addAt(sim, 'warrior', 'Pilot');
    const e = body(sim, pid);
    e.auras.push(
      aura(CHEATER_MARK_AURA_ID, 'buff_sta', 3600, { value: 0, undispellable: true }),
      aura(WELL_FED_AURA_ID, 'buff_sta', 1800),
    );
    expect(startMortarOverdrivePractice(sim, 'rookie', pid)).toBe(true);
    const match = mortarOverdriveMatchOf(sim.ctx, pid);
    const snapshot = match?.strippedAuras.get(pid);
    const snapped = snapshot?.auras.map((a) => a.id) ?? [];
    expect(snapped).toContain(WELL_FED_AURA_ID);
    // The warrior's stance is stripped too, and comes back with the rest.
    expect(snapped).toContain('battle_stance');
    expect(snapped).not.toContain(CHEATER_MARK_AURA_ID);
    for (let i = 0; i < 20; i++) sim.tick();
    e.auras.push(
      aura(MORTAR_OVERDRIVE_WARD_AURA, 'mortar_overdrive_ward', 10),
      aura(MORTAR_OVERDRIVE_OFF_TRACK_AURA, 'slow', 10),
    );
    sim.mortarOverdriveForfeit(pid);
    tickUntilHome(sim, pid);
    expect(find(e, MORTAR_OVERDRIVE_WARD_AURA)).toBeUndefined();
    expect(find(e, MORTAR_OVERDRIVE_OFF_TRACK_AURA)).toBeUndefined();
    expect(e.auras.filter((a) => a.id === CHEATER_MARK_AURA_ID)).toHaveLength(1);
    expect(e.auras.filter((a) => a.id === WELL_FED_AURA_ID)).toHaveLength(1);
    expect(e.auras.filter((a) => a.id === 'battle_stance')).toHaveLength(1);
  });

  it('a stealthed pilot comes home stealthed', () => {
    const sim = makeWorld();
    const pid = addAt(sim, 'rogue', 'Pilot');
    const e = body(sim, pid);
    e.auras.push(aura('stealth', 'stealth', 0, { permanent: true }));
    e.stealthed = true;
    expect(startMortarOverdrivePractice(sim, 'rookie', pid)).toBe(true);
    expect(e.stealthed).toBe(false);
    sim.mortarOverdriveForfeit(pid);
    tickUntilHome(sim, pid);
    expect(find(e, 'stealth')).toBeDefined();
    expect(e.stealthed).toBe(true);
  });

  it('a leave mid-race restores the auras on the live body before the leave save', () => {
    // Auras are session state (no save path writes them: wellfed.ts, the
    // Aura.flask note in types.ts), so what a leave owes the pilot is the
    // restore on the live body before preparePlayerLeave hands over to the
    // save. A linkdead pilot keeps the live body for the grace, so a resume
    // finds the buff on it.
    const sim = makeWorld();
    const pid = addAt(sim, 'warrior', 'Pilot');
    const e = body(sim, pid);
    e.auras.push(aura(WELL_FED_AURA_ID, 'buff_sta', 1800));
    const seatTick = sim.tickCount;
    expect(startMortarOverdrivePractice(sim, 'rookie', pid)).toBe(true);
    for (let i = 0; i < 100; i++) sim.tick();
    sim.preparePlayerLeave(pid);
    expect(sim.players.get(pid)?.mortarOverdriveMatchId).toBeNull();
    const back = find(e, WELL_FED_AURA_ID);
    expect(back?.remaining).toBeCloseTo(1800 - (sim.tickCount - seatTick) / TICK_RATE, 6);
  });

  it('a mid-race save of a druid seated in Cat Form writes the parked mana, not the energy', () => {
    const sim = makeWorld();
    const pid = addAt(sim, 'druid', 'Pilot');
    const e = body(sim, pid);
    e.auras.push(aura('cat_form', 'form_cat', 3600, { value: 0.71 }));
    sim.ctx.recalcPlayer(e);
    expect(e.resourceType).toBe('energy');
    e.resource = 37;
    e.savedMana = 123;
    expect(startMortarOverdrivePractice(sim, 'rookie', pid)).toBe(true);
    for (let i = 0; i < 10; i++) sim.tick();
    // Driving in caster form on the clean slate, with a full mana bar.
    expect(e.resourceType).toBe('mana');
    const save = sim.serializeCharacter(pid);
    expect(save?.resource).toBe(123);
    sim.mortarOverdriveForfeit(pid);
    tickUntilHome(sim, pid);
    // Home in Cat Form on the energy carried in, with the mana parked behind it
    // still the pre-race amount rather than the clean slate's refill.
    expect(find(e, 'cat_form')).toBeDefined();
    expect(e.resourceType).toBe('energy');
    expect(e.resource).toBe(37);
    expect(e.savedMana).toBe(123);
  });
});

describe('every return path hands the stripped auras back', () => {
  /** Drive a pilot round its own race's circuit for `laps` laps in bounded
   *  hops (the wrap gate needs real forward distance), without ticking. */
  function driveLaps(sim: Sim, pid: number, laps: number): void {
    const m = mortarOverdriveMatchOf(sim.ctx, pid);
    if (!m) throw new Error('not seated');
    const track = mortarOverdriveTrack(mortarOverdriveCircuitOf(m));
    for (let lap = 0; lap < laps; lap++) {
      let left = track.length + 12;
      while (left > 0 && m.phase === 'racing') {
        const step = Math.min(40, left);
        const progress = m.progress.get(pid);
        if (!progress) throw new Error('no progress');
        const at = track.pointAt(progress.lastS + step);
        teleport(sim, pid, m.origin.x + at.x, m.origin.z + at.z);
        updateMortarOverdrive(sim.ctx);
        left -= step;
      }
    }
  }

  function fed(sim: Sim, cls: Parameters<Sim['addPlayer']>[0] = 'warrior'): number {
    const pid = addAt(sim, cls, 'Pilot');
    body(sim, pid).auras.push(aura(WELL_FED_AURA_ID, 'buff_sta', 1800));
    return pid;
  }

  it('a natural finish: home, and fed again, only when the tableau ends at teardown', () => {
    const sim = makeWorld();
    const pid = fed(sim);
    const bots = [
      addAt(sim, 'mage', 'Briar', 7, -42),
      addAt(sim, 'rogue', 'Cass', -9, -38),
      addAt(sim, 'priest', 'Dell', 11, -44),
    ];
    for (const bot of bots) sim.mortarOverdrive.bots.set(bot, 'rookie');
    const seatTick = sim.tickCount;
    expect(mortarOverdriveStartMatch(sim.ctx, [pid, ...bots], undefined, RACE_CIRCUIT.id)).toBe(
      true,
    );
    const m = mortarOverdriveMatchOf(sim.ctx, pid);
    if (!m) throw new Error('no match');
    m.phase = 'racing';
    driveLaps(sim, pid, m.totalLaps);
    expect(m.phase).toBe('finished');
    expect(m.progress.get(pid)?.finishedTick).not.toBeNull();
    for (let i = 0; i < MORTAR_OVERDRIVE_RETURN_TICKS - 2; i++) sim.tick();
    expect(find(body(sim, pid), WELL_FED_AURA_ID)).toBeUndefined();
    const home = tickUntilHome(sim, pid);
    expect(sim.mortarOverdrive.match).toBeNull();
    expectAged(find(body(sim, pid), WELL_FED_AURA_ID)?.remaining, 1800, seatTick, home);
  });

  it('Practice ending on its clock: home and fed again after the tableau', () => {
    const sim = makeWorld();
    const pid = fed(sim);
    const seatTick = sim.tickCount;
    expect(startMortarOverdrivePractice(sim, 'rookie', pid)).toBe(true);
    const m = mortarOverdriveMatchOf(sim.ctx, pid);
    if (!m) throw new Error('no match');
    m.phase = 'racing';
    m.deadlineTick = sim.tickCount + 1;
    sim.tick();
    expect(m.phase).toBe('finished');
    expect(m.progress.get(pid)?.retiredTick).toBeNull();
    const home = tickUntilHome(sim, pid);
    expect(sim.mortarOverdrive.practices).toHaveLength(0);
    expectAged(find(body(sim, pid), WELL_FED_AURA_ID)?.remaining, 1800, seatTick, home);
  });

  it('a pilot who dies mid-race is retired, returned at once, and fed again', () => {
    const sim = makeWorld();
    const pid = fed(sim);
    expect(startMortarOverdrivePractice(sim, 'rookie', pid)).toBe(true);
    for (let i = 0; i < 20; i++) sim.tick();
    body(sim, pid).dead = true;
    sim.tick();
    expect(sim.players.get(pid)?.mortarOverdriveMatchId).toBeNull();
    expect(find(body(sim, pid), WELL_FED_AURA_ID)).toBeDefined();
  });

  it('a pilot carried off their lane is retired, returned at once, and fed again', () => {
    const sim = makeWorld();
    const pid = fed(sim);
    expect(startMortarOverdrivePractice(sim, 'rookie', pid)).toBe(true);
    for (let i = 0; i < 20; i++) sim.tick();
    // A summon or a GM move: back in the open world, off the race's copy.
    teleport(sim, pid, 0, -40);
    sim.tick();
    expect(sim.players.get(pid)?.mortarOverdriveMatchId).toBeNull();
    expect(find(body(sim, pid), WELL_FED_AURA_ID)).toBeDefined();
  });

  it('a moderation move (the jail path) restores the body, auras included, before it moves it', () => {
    const sim = makeWorld();
    const pid = fed(sim);
    const seatPos = { ...body(sim, pid).pos };
    expect(startMortarOverdrivePractice(sim, 'rookie', pid)).toBe(true);
    for (let i = 0; i < 20; i++) sim.tick();
    const returnedTo = leaveMortarOverdriveForModeration(sim, pid, body(sim, pid));
    expect(sim.players.get(pid)?.mortarOverdriveMatchId).toBeNull();
    expect(returnedTo.x).toBeCloseTo(seatPos.x, 6);
    expect(returnedTo.z).toBeCloseTo(seatPos.z, 6);
    expect(find(body(sim, pid), WELL_FED_AURA_ID)).toBeDefined();
  });

  it('a druid seated in Bear Form comes home in it, on the rage carried in, with the parked mana intact', () => {
    const sim = makeWorld();
    const pid = addAt(sim, 'druid', 'Pilot');
    const e = body(sim, pid);
    e.auras.push(aura('bear_form', 'form_bear', 3600, { value: 0 }));
    sim.ctx.recalcPlayer(e);
    expect(e.resourceType).toBe('rage');
    e.resource = 40;
    e.savedMana = 150;
    expect(startMortarOverdrivePractice(sim, 'rookie', pid)).toBe(true);
    for (let i = 0; i < 10; i++) sim.tick();
    // On the clean slate in caster form, so the recalc refilled the mana bar.
    expect(e.resourceType).toBe('mana');
    expect(e.resource).toBe(e.maxResource);
    sim.mortarOverdriveForfeit(pid);
    tickUntilHome(sim, pid);
    expect(find(e, 'bear_form')).toBeDefined();
    expect(e.resourceType).toBe('rage');
    expect(e.resource).toBe(40);
    // The form's recalc parks the full caster bar in savedMana; the return puts
    // the pre-race amount back over it.
    expect(e.savedMana).toBe(150);
  });
});

describe("a party paladin's aura comes back only while its source still owes it", () => {
  /** A warrior pilot partied with a paladin whose Devotion Ward rides on both. */
  function partied(): { sim: Sim; pilot: number; paladin: number } {
    const sim = makeWorld();
    const pilot = addAt(sim, 'warrior', 'Pilot');
    const paladin = addAt(sim, 'paladin', 'Warden', 4, -40);
    sim.partyInvite(pilot, paladin);
    sim.partyAccept(pilot);
    expect(sim.ctx.partyOf(pilot)?.members).toContain(paladin);
    const ward = (sourceId: number) =>
      aura('devotion_ward', 'buff_dr', Number.POSITIVE_INFINITY, {
        permanent: true,
        value: 0.05,
        sourceId,
        school: 'holy',
      });
    body(sim, paladin).auras.push(ward(paladin));
    body(sim, pilot).auras.push(ward(paladin));
    return { sim, pilot, paladin };
  }

  function raceAndReturn(sim: Sim, pilot: number, during: () => void): void {
    expect(startMortarOverdrivePractice(sim, 'rookie', pilot)).toBe(true);
    expect(find(body(sim, pilot), 'devotion_ward')).toBeUndefined();
    for (let i = 0; i < 20; i++) sim.tick();
    during();
    sim.mortarOverdriveForfeit(pilot);
    tickUntilHome(sim, pilot);
  }

  it('returns while the paladin is still in the party and still wearing it', () => {
    const { sim, pilot, paladin } = partied();
    raceAndReturn(sim, pilot, () => {});
    expect(find(body(sim, pilot), 'devotion_ward')?.sourceId).toBe(paladin);
  });

  it('stays gone when the paladin left the party during the race', () => {
    const { sim, pilot, paladin } = partied();
    raceAndReturn(sim, pilot, () => sim.partyLeave(paladin));
    expect(sim.ctx.partyOf(pilot)).toBeNull();
    expect(find(body(sim, pilot), 'devotion_ward')).toBeUndefined();
  });

  it('stays gone when the paladin dropped the aura during the race', () => {
    const { sim, pilot, paladin } = partied();
    raceAndReturn(sim, pilot, () => {
      const p = body(sim, paladin);
      p.auras = p.auras.filter((a) => a.id !== 'devotion_ward');
    });
    expect(find(body(sim, pilot), 'devotion_ward')).toBeUndefined();
  });

  it('stays gone when the paladin left the world during the race', () => {
    const { sim, pilot, paladin } = partied();
    raceAndReturn(sim, pilot, () => sim.removePlayer(paladin));
    expect(find(body(sim, pilot), 'devotion_ward')).toBeUndefined();
  });
});

describe('a restored periodic aura keeps its original tick schedule', () => {
  it('a HoT ticks exactly the beats its seat-time schedule had left after the return', () => {
    const sim = makeWorld();
    const pid = addAt(sim, 'warrior', 'Pilot');
    const e = body(sim, pid);
    e.hp = Math.floor(e.maxHp / 4);
    // Fresh at the seat: beats every 3 s, ten in all.
    e.auras.push(
      aura('test_renew', 'hot', 30, { value: 1, tickInterval: 3, tickTimer: 3, duration: 30 }),
    );
    const seatTick = sim.tickCount;
    expect(startMortarOverdrivePractice(sim, 'rookie', pid)).toBe(true);
    for (let i = 0; i < 200; i++) sim.tick();
    sim.mortarOverdriveForfeit(pid);
    const home = tickUntilHome(sim, pid);
    // The restore landed on tick `home - 1` or `home`: with beats 60 ticks
    // apart and this gap well clear of a beat, both readings agree.
    const left = (gap: number) =>
      Array.from({ length: 10 }, (_, k) => (k + 1) * 3 * TICK_RATE).filter((at) => at > gap).length;
    const expected = left(home - seatTick);
    expect(left(home - 1 - seatTick)).toBe(expected);
    expect(left(home + 1 - seatTick)).toBe(expected);
    let beats = 0;
    for (let i = 0; i < 40 * TICK_RATE && find(e, 'test_renew'); i++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'heal2' && (ev as { abilityId?: string }).abilityId === 'test_renew')
          beats++;
      }
    }
    expect(find(e, 'test_renew')).toBeUndefined();
    expect(beats).toBe(expected);
  });
});

describe('mortarOverdriveAurasAt (pure)', () => {
  it('ages timed auras by the ticks since the seat and drops the expired ones', () => {
    const e = {
      auras: [
        aura('a', 'buff_sta', 10),
        aura('b', 'buff_sta', 2),
        aura('c', 'buff_sta', 0, { permanent: true }),
      ],
      resourceType: 'rage',
      savedMana: 0,
    } as unknown as Entity;
    const snapshot = snapshotMortarOverdriveStrippedAuras(e, 100);
    e.auras = [];
    settleMortarOverdriveStrippedAuras(snapshot, e);
    const at = mortarOverdriveAurasAt(snapshot, 100 + 3 * TICK_RATE);
    expect(at.map((a) => [a.id, a.remaining])).toEqual([
      ['a', 7],
      ['c', 0],
    ]);
    // Fresh copies: the snapshot is unchanged and reusable.
    expect(snapshot.auras[0].remaining).toBe(10);
    expect(at[0]).not.toBe(snapshot.auras[0]);
  });

  it('ages the tick phase and the thorns cooldown, wrapping the phase like the aura pass', () => {
    const e = {
      auras: [
        aura('hot', 'hot', 30, { tickInterval: 3, tickTimer: 3 }),
        aura('fresh', 'hot', 30, { tickInterval: 3 }),
        aura('grace', 'buff_mana_grace', 0, { permanent: true, tickInterval: 5, tickTimer: 1 }),
        aura('shield', 'thorns', 600, { icd: 2, icdMax: 5 }),
      ],
      resourceType: 'mana',
      savedMana: 0,
    } as unknown as Entity;
    const snapshot = snapshotMortarOverdriveStrippedAuras(e, 0);
    e.auras = [];
    settleMortarOverdriveStrippedAuras(snapshot, e);
    const at = mortarOverdriveAurasAt(snapshot, 10 * TICK_RATE);
    const byId = new Map(at.map((a) => [a.id, a]));
    // 3 - 10 = -7: three beats fired, the next is 2 s out; 20 s left = 7 beats.
    expect(byId.get('hot')?.remaining).toBeCloseTo(20, 9);
    expect(byId.get('hot')?.tickTimer).toBeCloseTo(2, 9);
    // An unset phase starts at the interval, as the pass reads it.
    expect(byId.get('fresh')?.tickTimer).toBeCloseTo(2, 9);
    // Untimed auras keep their remaining but their beat still ran: 1 - 10 = -9,
    // two beats at 1 and 6, the next at 11.
    expect(byId.get('grace')?.tickTimer).toBeCloseTo(1, 9);
    expect(byId.get('grace')?.remaining).toBe(0);
    expect(byId.get('shield')?.icd).toBe(0);
  });

  it('a gloomtithe the aura pass would hold is not aged; one it would age is', () => {
    const e = {
      auras: [aura('gloomtithe', 'gloomtithe', 8)],
      resourceType: 'mana',
      savedMana: 0,
    } as unknown as Entity;
    const snapshot = snapshotMortarOverdriveStrippedAuras(e, 0);
    e.auras = [];
    settleMortarOverdriveStrippedAuras(snapshot, e);
    const held = mortarOverdriveAurasAt(snapshot, 5 * TICK_RATE, (a) => a.kind === 'gloomtithe');
    expect(held[0]?.remaining).toBe(8);
    const aged = mortarOverdriveAurasAt(snapshot, 5 * TICK_RATE);
    expect(aged[0]?.remaining).toBeCloseTo(3, 9);
  });
});
