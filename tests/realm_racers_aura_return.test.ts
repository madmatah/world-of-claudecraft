// The race strips the auras a pilot walks in with and hands them back on the
// way out, aged by the time the race held them (social/realm_racers_auras.ts).
import { describe, expect, it } from 'vitest';
import { realmRacersCompetitionCircuits } from '../src/sim/content/realm_racers_circuits';
import { CHEATER_MARK_AURA_ID } from '../src/sim/moderation/cheater_mark';
import type { Sim } from '../src/sim/sim';
import {
  REALM_RACERS_OFF_TRACK_AURA,
  REALM_RACERS_RETURN_TICKS,
  REALM_RACERS_WARD_AURA,
  realmRacersMatchOf,
  realmRacersStartMatch,
} from '../src/sim/social/realm_racers';
import {
  realmRacersAurasAt,
  settleRealmRacersStrippedAuras,
  snapshotRealmRacersStrippedAuras,
} from '../src/sim/social/realm_racers_auras';
import { startRealmRacersPractice } from '../src/sim/social/realm_racers_bots';
import type { Aura, Entity } from '../src/sim/types';
import { TICK_RATE } from '../src/sim/types';
import { WELL_FED_AURA_ID } from '../src/sim/wellfed';
import { addAt, makeWorld } from './realm_racers_util';

const RACE_CIRCUIT = realmRacersCompetitionCircuits()[0];

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
    if (sim.players.get(pid)?.realmRacersMatchId === null) return sim.tickCount;
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

describe('Realm Racers hands the stripped auras back on the return', () => {
  it('Practice: a food buff comes back with its remaining time minus the race', () => {
    const sim = makeWorld();
    const pid = addAt(sim, 'warrior', 'Pilot');
    const e = body(sim, pid);
    e.auras.push(aura(WELL_FED_AURA_ID, 'buff_sta', 1800, { sourceId: pid }));
    const seatTick = sim.tickCount;
    expect(startRealmRacersPractice(sim, 'rookie', pid)).toBe(true);
    // The race itself stays a clean slate.
    expect(find(e, WELL_FED_AURA_ID)).toBeUndefined();
    for (let i = 0; i < 200; i++) sim.tick();
    expect(find(e, WELL_FED_AURA_ID)).toBeUndefined();
    sim.realmRacersForfeit(pid);
    const home = tickUntilHome(sim, pid);
    expect(home - seatTick).toBeGreaterThan(200 + REALM_RACERS_RETURN_TICKS - 2);
    expectAged(find(e, WELL_FED_AURA_ID)?.remaining, 1800, seatTick, home);
    expect(sim.realmRacers.practices).toHaveLength(0);
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
    expect(realmRacersStartMatch(sim.ctx, pids, undefined, RACE_CIRCUIT.id)).toBe(true);
    expect(e.maxHp).toBe(baseHp);
    for (let i = 0; i < 40; i++) sim.tick();
    sim.realmRacersForfeit(pids[0]);
    const home = tickUntilHome(sim, pids[0]);
    expectAged(find(e, 'fortitude_test')?.remaining, 900, seatTick, home);
    expect(e.maxHp).toBe(buffedHp);
    // The race goes on for the other three.
    expect(sim.realmRacers.match).not.toBeNull();
  });

  it('drops an aura whose time ran out during the race, and keeps an untimed one as it was', () => {
    const sim = makeWorld();
    const pid = addAt(sim, 'paladin', 'Pilot');
    const e = body(sim, pid);
    e.auras.push(
      aura('short_elixir', 'buff_str', 3),
      aura('devotion_test', 'buff_armor', 0, { permanent: true, duration: 0 }),
    );
    expect(startRealmRacersPractice(sim, 'rookie', pid)).toBe(true);
    for (let i = 0; i < 4 * TICK_RATE; i++) sim.tick();
    sim.realmRacersForfeit(pid);
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
    expect(startRealmRacersPractice(sim, 'rookie', pid)).toBe(true);
    const match = realmRacersMatchOf(sim.ctx, pid);
    const snapshot = match?.strippedAuras.get(pid);
    const snapped = snapshot?.auras.map((a) => a.id) ?? [];
    expect(snapped).toContain(WELL_FED_AURA_ID);
    // The warrior's stance is stripped too, and comes back with the rest.
    expect(snapped).toContain('battle_stance');
    expect(snapped).not.toContain(CHEATER_MARK_AURA_ID);
    for (let i = 0; i < 20; i++) sim.tick();
    e.auras.push(
      aura(REALM_RACERS_WARD_AURA, 'rally_ward', 10),
      aura(REALM_RACERS_OFF_TRACK_AURA, 'slow', 10),
    );
    sim.realmRacersForfeit(pid);
    tickUntilHome(sim, pid);
    expect(find(e, REALM_RACERS_WARD_AURA)).toBeUndefined();
    expect(find(e, REALM_RACERS_OFF_TRACK_AURA)).toBeUndefined();
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
    expect(startRealmRacersPractice(sim, 'rookie', pid)).toBe(true);
    expect(e.stealthed).toBe(false);
    sim.realmRacersForfeit(pid);
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
    expect(startRealmRacersPractice(sim, 'rookie', pid)).toBe(true);
    for (let i = 0; i < 100; i++) sim.tick();
    sim.preparePlayerLeave(pid);
    expect(sim.players.get(pid)?.realmRacersMatchId).toBeNull();
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
    expect(startRealmRacersPractice(sim, 'rookie', pid)).toBe(true);
    for (let i = 0; i < 10; i++) sim.tick();
    // Driving in caster form on the clean slate, with a full mana bar.
    expect(e.resourceType).toBe('mana');
    const save = sim.serializeCharacter(pid);
    expect(save?.resource).toBe(123);
    sim.realmRacersForfeit(pid);
    tickUntilHome(sim, pid);
    // Home in Cat Form on the energy carried in, with the mana parked behind it
    // still the pre-race amount rather than the clean slate's refill.
    expect(find(e, 'cat_form')).toBeDefined();
    expect(e.resourceType).toBe('energy');
    expect(e.resource).toBe(37);
    expect(e.savedMana).toBe(123);
  });
});

describe('realmRacersAurasAt (pure)', () => {
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
    const snapshot = snapshotRealmRacersStrippedAuras(e, 100);
    e.auras = [];
    settleRealmRacersStrippedAuras(snapshot, e);
    const at = realmRacersAurasAt(snapshot, 100 + 3 * TICK_RATE);
    expect(at.map((a) => [a.id, a.remaining])).toEqual([
      ['a', 7],
      ['c', 0],
    ]);
    // Fresh copies: the snapshot is unchanged and reusable.
    expect(snapshot.auras[0].remaining).toBe(10);
    expect(at[0]).not.toBe(snapshot.auras[0]);
  });
});
