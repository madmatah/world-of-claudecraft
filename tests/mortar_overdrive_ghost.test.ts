// The recovery GHOST: a machine the race has just put back on the racing line is
// intangible to rival machines until it is unlocked, old enough for a follower
// to have passed, and clear; or until a hard cap runs out. The playtest case it exists for: at 200 ms a pilot shot a rival off
// the road, the rival was recovered onto the line locked still for two seconds,
// and the shooter, following at full speed, hit a parked solid machine.

import { describe, expect, it, vi } from 'vitest';
import { mortarOverdriveCompetitionCircuits } from '../src/sim/content/mortar_overdrive/circuits';
import { vehicleProfile } from '../src/sim/content/vehicles';
import {
  MORTAR_OVERDRIVE_GHOST_AURA,
  MORTAR_OVERDRIVE_GHOST_MARGIN_TICKS,
  MORTAR_OVERDRIVE_GHOST_MIN_TICKS,
  mortarOverdriveContactCounts,
  mortarOverdriveGhosted,
  mortarOverdriveGhostMayClear,
  mortarOverdriveGhostWindow,
  mortarOverdriveHullsMeetInTick,
  mortarOverdriveHullsOverlap,
  mortarOverdriveKeepParting,
  mortarOverdrivePartingEndTick,
} from '../src/sim/mortar_overdrive/ghost';
import { MORTAR_OVERDRIVE_GRID_SIZE } from '../src/sim/mortar_overdrive/layout';
import {
  MORTAR_OVERDRIVE_BUMP_EVENT_MIN_IMPACT,
  MORTAR_OVERDRIVE_BUMP_EVENT_TICKS,
  MORTAR_OVERDRIVE_GROUND_BLAST_AURA,
  MORTAR_OVERDRIVE_RESET_LOCK_TICKS,
  MORTAR_OVERDRIVE_RETURN_TICKS,
  MORTAR_OVERDRIVE_STUCK_TICKS,
  MORTAR_OVERDRIVE_VEHICLE_KEY,
  type MortarOverdriveMatch,
  mortarOverdriveCircuitOf,
  mortarOverdriveFreePracticeSlot,
  mortarOverdriveMatchOf,
  mortarOverdriveMovementLockedAt,
  mortarOverdriveStartMatch,
  mortarOverdriveToCanonical,
  mortarOverdriveToWorld,
  updateMortarOverdrive,
} from '../src/sim/mortar_overdrive/race';
import { MORTAR_OVERDRIVE_SLICK_LIFETIME_TICKS } from '../src/sim/mortar_overdrive/slicks';
import { mortarOverdriveTrack } from '../src/sim/mortar_overdrive/spline';
import type { Sim } from '../src/sim/sim';
import { type Entity, TICK_RATE } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { formatNumber } from '../src/ui/i18n';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';
import { renderAuraEffectLine } from './helpers/aura_effect_line';
import {
  autoGhostClearTick,
  expectGhostEndsWhenClear,
  expectGhostWindow,
  manualGhostClearTick,
} from './helpers/mortar_overdrive_ghost_window';
import { addAt, makeWorld, teleport } from './mortar_overdrive_util';

const RACE_CIRCUIT = mortarOverdriveCompetitionCircuits()[0];
const PROFILE = vehicleProfile(MORTAR_OVERDRIVE_VEHICLE_KEY);
/** The contact reach between two machines: two hull radii. */
const REACH = PROFILE.bodyRadius * 2;

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${label}`);
  return value;
}

function onLane(match: MortarOverdriveMatch, s: number) {
  const point = mortarOverdriveTrack(RACE_CIRCUIT).pointAt(s);
  const world = mortarOverdriveToWorld(match, point.x, point.z);
  return { ...point, x: world.x, z: world.z };
}

/** Parks a machine at a world point with the lap bookkeeping a machine that
 *  DROVE there would carry, so the referee never reads the jump as a cut. */
function park(sim: Sim, match: MortarOverdriveMatch, pid: number, x: number, z: number): void {
  teleport(sim, pid, x, z);
  const progress = required(match.progress.get(pid), `progress ${pid}`);
  const local = mortarOverdriveToCanonical(match, x, z);
  const projection = mortarOverdriveTrack(RACE_CIRCUIT).project(local.x, local.z);
  progress.lastS = projection.s;
  progress.trackIndex = projection.index;
}

function watch(sim: Sim, type: string) {
  const emit = vi.spyOn(sim, 'emit');
  return () =>
    emit.mock.calls
      .map(([event]) => event as { type: string } & Record<string, unknown>)
      .filter((event) => event.type === type);
}

/**
 * A racing grid with everybody parked well apart round the lap, and racer `a`
 * about to be recovered onto the line at 40 % of the lap (`road`).
 */
function racing() {
  const sim = makeWorld();
  const pids = Array.from({ length: MORTAR_OVERDRIVE_GRID_SIZE }, (_, i) =>
    addAt(sim, 'warrior', `Racer${i}`, -6 + i * 4, -40),
  );
  mortarOverdriveStartMatch(sim.ctx, pids, undefined, RACE_CIRCUIT.id);
  sim.tick();
  const match = required(sim.mortarOverdrive.match, 'race');
  match.phase = 'racing';
  sim.tick();
  const track = mortarOverdriveTrack(RACE_CIRCUIT);
  pids.forEach((pid, i) => {
    const away = onLane(match, track.length * (0.6 + i * 0.08));
    park(sim, match, pid, away.x, away.z);
  });
  sim.tick();
  const [a, b] = pids;
  const road = onLane(match, track.length * 0.4);
  required(match.progress.get(a), 'progress').resetS = road.s;
  return {
    sim,
    match,
    pids,
    a,
    b,
    road,
    racer: required(sim.entities.get(a), 'racer'),
    rival: required(sim.entities.get(b), 'rival'),
    progress: required(match.progress.get(a), 'progress'),
  };
}

/** Put `pid` on top of `on`, `offset` yards to its side: overlapping hulls. */
function parkOn(sim: Sim, match: MortarOverdriveMatch, pid: number, on: Entity, offset = 1): void {
  park(sim, match, pid, on.pos.x + offset, on.pos.z);
}

/** Put `pid` inside `on`, `offset` yards to its side, driving straight at it:
 *  still closing, so the contact pass resolves a real impact once both are
 *  solid. */
function ramInto(
  sim: Sim,
  match: MortarOverdriveMatch,
  pid: number,
  on: Entity,
  offset: number,
  speed = 6,
): void {
  park(sim, match, pid, on.pos.x + offset, on.pos.z);
  const rammer = required(sim.entities.get(pid), 'rammer');
  rammer.facing = Math.atan2(-Math.sign(offset), 0);
  const drive = required(rammer.drive, 'rammer drive');
  drive.speed = speed;
  drive.slip = 0;
  drive.yawRate = 0;
}

/** Hold a machine dead still on a spot, whatever the last contact gave it. */
function holdStill(
  sim: Sim,
  match: MortarOverdriveMatch,
  racer: Entity,
  spot: { x: number; z: number },
) {
  park(sim, match, racer.id, spot.x, spot.z);
  const drive = required(racer.drive, 'drive');
  drive.speed = 0;
  drive.slip = 0;
  drive.yawRate = 0;
}

describe('the ghost rule, on its own', () => {
  it('pins a 1.5 s minimum from the recovery and a one-second margin to the cap', () => {
    expect(MORTAR_OVERDRIVE_GHOST_MIN_TICKS).toBe(30);
    expect(MORTAR_OVERDRIVE_GHOST_MARGIN_TICKS).toBe(20);
  });

  it('opens its window off the recovery, never off the manual lock alone', () => {
    // A manual reset at 100: its 40-tick lock (ends 141) outlasts the minimum.
    expect(mortarOverdriveGhostWindow(100, 141)).toEqual({ earliestClearTick: 141, capTick: 161 });
    // The one-tick automatic lock (ends 102) and the one-second cut lock (ends
    // 121): the minimum from the recovery holds them both to 131.
    expect(mortarOverdriveGhostWindow(100, 102)).toEqual({ earliestClearTick: 131, capTick: 151 });
    expect(mortarOverdriveGhostWindow(100, 121)).toEqual({ earliestClearTick: 131, capTick: 151 });
    expect(mortarOverdriveGhostWindow(100, 0)).toEqual({ earliestClearTick: 131, capTick: 151 });
  });

  it('ends only once the window allows it and the hull is clear, or at the cap', () => {
    const at = (tick: number, overlapping: boolean) =>
      mortarOverdriveGhostMayClear({ tick, earliestClearTick: 10, capTick: 30, overlapping });
    expect(at(9, false)).toBe(false);
    expect(at(10, false)).toBe(true);
    expect(at(10, true)).toBe(false);
    expect(at(29, true)).toBe(false);
    expect(at(30, true)).toBe(true);
    expect(
      mortarOverdriveGhostMayClear({
        tick: 30,
        earliestClearTick: 99,
        capTick: 30,
        overlapping: true,
      }),
    ).toBe(true);
  });

  it('counts a hull crossing the ghost inside the tick as overlapping, not just the endpoint', () => {
    const r = PROFILE.bodyRadius;
    const ghost = { x: 0, z: 0, prevX: 0, prevZ: 0, radius: r };
    // Ten yards before to ten yards past, straight through: both ends clear.
    const tunnel = { x: 10, z: 0, prevX: -10, prevZ: 0, radius: r };
    expect(mortarOverdriveHullsOverlap(ghost, tunnel)).toBe(false);
    expect(mortarOverdriveHullsMeetInTick(ghost, tunnel)).toBe(true);
    // The same run a lane over, beyond the reach: clear the whole tick.
    const beside = { x: 10, z: REACH + 0.5, prevX: -10, prevZ: REACH + 0.5, radius: r };
    expect(mortarOverdriveHullsMeetInTick(ghost, beside)).toBe(false);
    // Parked on it: the endpoint answer, unchanged.
    expect(mortarOverdriveHullsMeetInTick(ghost, { ...ghost, x: 1, prevX: 1 })).toBe(true);
  });

  it('sweeps the ghost own motion too, and keeps two machines running abreast apart', () => {
    const r = PROFILE.bodyRadius;
    // The GHOST drives straight through a parked rival: both ends clear, the
    // middle of the tick meets, from either side of the pair.
    const parked = { x: 0, z: 0, prevX: 0, prevZ: 0, radius: r };
    const driving = { x: 10, z: 0, prevX: -10, prevZ: 0, radius: r };
    expect(mortarOverdriveHullsOverlap(driving, parked)).toBe(false);
    expect(mortarOverdriveHullsMeetInTick(driving, parked)).toBe(true);
    expect(mortarOverdriveHullsMeetInTick(parked, driving)).toBe(true);
    // Two machines running abreast just outside reach never close the gap,
    // whether at one speed or at two: the relative motion runs along the road.
    const abreast = { x: 10, z: REACH + 0.5, prevX: -10, prevZ: REACH + 0.5, radius: r };
    expect(mortarOverdriveHullsMeetInTick(driving, abreast)).toBe(false);
    expect(mortarOverdriveHullsMeetInTick(abreast, driving)).toBe(false);
    const faster = { x: 20, z: REACH + 0.5, prevX: -5, prevZ: REACH + 0.5, radius: r };
    expect(mortarOverdriveHullsMeetInTick(driving, faster)).toBe(false);
  });

  it('does not count a contact between a pair still parting from a ghost that ended on it', () => {
    expect(mortarOverdriveContactCounts(1, [], 2, [])).toBe(true);
    expect(mortarOverdriveContactCounts(1, undefined, 2, undefined)).toBe(true);
    expect(mortarOverdriveContactCounts(1, [2], 2, [])).toBe(false);
    expect(mortarOverdriveContactCounts(1, [], 2, [1])).toBe(false);
    // Scoped to the pair: the same machine's contact with anyone else counts.
    expect(mortarOverdriveContactCounts(1, [2], 3, [])).toBe(true);
    expect(mortarOverdriveContactCounts(3, [], 1, [2])).toBe(true);
  });

  it('ends a parting the first tick the pair is apart, for that pair alone and for good', () => {
    const partners = [2, 3, 4];
    mortarOverdriveKeepParting(partners, 10, 30, (pid) => pid !== 3);
    expect(partners).toEqual([2, 4]);
    mortarOverdriveKeepParting(partners, 11, 30, () => true);
    expect(partners).toEqual([2, 4]);
    mortarOverdriveKeepParting(partners, 12, 30, () => false);
    expect(partners).toEqual([]);
  });

  it('ends every parting one margin past the cap that opened it, whatever the overlap', () => {
    expect(mortarOverdrivePartingEndTick(100)).toBe(100 + MORTAR_OVERDRIVE_GHOST_MARGIN_TICKS);
    const partners = [2, 3];
    mortarOverdriveKeepParting(partners, 119, 120, () => true);
    expect(partners).toEqual([2, 3]);
    mortarOverdriveKeepParting(partners, 120, 120, () => true);
    expect(partners).toEqual([]);
  });

  it('reads overlap on the contact reach, touching exactly at the reach being clear', () => {
    const hull = (x: number) => ({ x, z: 0, radius: PROFILE.bodyRadius });
    expect(mortarOverdriveHullsOverlap(hull(0), hull(REACH - 0.01))).toBe(true);
    expect(mortarOverdriveHullsOverlap(hull(0), hull(REACH))).toBe(false);
    expect(
      mortarOverdriveHullsOverlap({ x: 0, z: 0, radius: 1 }, { x: 0.6, z: 0.8, radius: 0.1 }),
    ).toBe(true);
  });
});

describe('the ghost starts on every recovery', () => {
  it('starts on a manual recovery, as an aura every client mirrors', () => {
    const { sim, a, racer, progress } = racing();
    const auras = watch(sim, 'aura');
    expect(mortarOverdriveGhosted(racer)).toBe(false);
    const resetTick = sim.tickCount;
    sim.mortarOverdriveResetPosition(a);
    const aura = required(
      racer.auras.find((entry) => entry.id === MORTAR_OVERDRIVE_GHOST_AURA),
      'ghost aura',
    );
    expect(aura).toMatchObject({ kind: 'mortar_overdrive_ghost', name: 'Ghosted', value: 0 });
    expect(progress.ghostClearTick).toBe(resetTick + MORTAR_OVERDRIVE_RESET_LOCK_TICKS + 1);
    expect(progress.ghostCapTick).toBe(
      resetTick + MORTAR_OVERDRIVE_RESET_LOCK_TICKS + 1 + MORTAR_OVERDRIVE_GHOST_MARGIN_TICKS,
    );
    // Silent, like the recovery itself: the entity aura list is the whole wire,
    // and no gain line lands in anybody's event frame.
    expect(auras().filter((event) => event.name === 'Ghosted')).toEqual([]);
  });

  it('explains itself in its tooltip with the window the recovery really opened', () => {
    const { sim, a, racer, progress } = racing();
    const resetTick = sim.tickCount;
    sim.mortarOverdriveResetPosition(a);
    const aura = required(
      racer.auras.find((entry) => entry.id === MORTAR_OVERDRIVE_GHOST_AURA),
      'ghost aura',
    );
    const effect = required(auraEffectDescriptor(aura), 'ghost effect line');
    const nums = required(effect.nums, 'ghost effect numbers');
    expect(effect.key).toBe('hudChrome.auraEffect.mortarOverdriveGhost');
    // The printed minimum and margin are the window the sim keyed to this
    // recovery, in seconds.
    expect(progress.ghostClearTick - resetTick).toBeGreaterThan(nums.minSeconds * TICK_RATE);
    expect(progress.ghostCapTick - progress.ghostClearTick).toBe(nums.marginSeconds * TICK_RATE);
    expect(nums).toEqual({
      minSeconds: MORTAR_OVERDRIVE_GHOST_MIN_TICKS / TICK_RATE,
      marginSeconds: MORTAR_OVERDRIVE_GHOST_MARGIN_TICKS / TICK_RATE,
    });
    const min = formatNumber(nums.minSeconds, { maximumFractionDigits: 1 });
    const margin = formatNumber(nums.marginSeconds, { maximumFractionDigits: 0 });
    expect(renderAuraEffectLine(aura)).toBe(
      `Rival machines pass through you after the race puts you back on the track. Lasts at least ${min} sec and until you can drive again, then ends as soon as you are clear of every rival, ${margin} sec later at most. Ground Blasts and oil slicks still hit you.`,
    );
    expect(hudChromeStrings.auraEffect.mortarOverdriveGhost).not.toMatch(/\d/);
  });

  it('holds a manual recovery for its minimum, then to the cap with a rival on it', () => {
    const { sim, match, a, b, racer, progress } = racing();
    const resetTick = sim.tickCount;
    sim.mortarOverdriveResetPosition(a);
    expectGhostWindow({
      sim,
      racer,
      progress,
      earliestClearTick: manualGhostClearTick(resetTick),
      holdRivalOn: () => parkOn(sim, match, b, racer),
    });
  });

  it('ends a manual recovery ghost on its earliest clear tick with nobody near', () => {
    const { sim, a, racer, progress } = racing();
    const resetTick = sim.tickCount;
    sim.mortarOverdriveResetPosition(a);
    expectGhostEndsWhenClear({
      sim,
      racer,
      progress,
      earliestClearTick: manualGhostClearTick(resetTick),
    });
  });

  /** A real stuck recovery: parked off the road at a standstill until the
   *  wedged arm puts the machine back on the line at `road`. */
  function stuckRecovery() {
    const staged = racing();
    const { sim, match, a, racer, road, progress } = staged;
    const lateral = road.halfWidth + 8;
    park(sim, match, a, road.x - road.tz * lateral, road.z + road.tx * lateral);
    for (let i = 0; i < MORTAR_OVERDRIVE_STUCK_TICKS; i++) sim.tick();
    expect(racer.pos.x).toBeCloseTo(road.x, 5);
    expect(progress.resetLockedUntilTick).toBe(sim.tickCount + 2);
    return { ...staged, resetTick: sim.tickCount };
  }

  it('holds a stuck recovery for its minimum, well past its one-tick lock, then to the cap', () => {
    const { sim, match, b, racer, progress, resetTick } = stuckRecovery();
    expectGhostWindow({
      sim,
      racer,
      progress,
      earliestClearTick: autoGhostClearTick(resetTick),
      holdRivalOn: () => parkOn(sim, match, b, racer),
    });
    expect(progress.ghostCapTick).toBe(0);
  });

  it('ends a stuck recovery ghost on its earliest clear tick with nobody near', () => {
    const { sim, racer, progress, resetTick } = stuckRecovery();
    expectGhostEndsWhenClear({
      sim,
      racer,
      progress,
      earliestClearTick: autoGhostClearTick(resetTick),
    });
  });

  it('replaces the window on a second recovery rather than stacking a longer one', () => {
    const { sim, match, a, b, racer, progress } = racing();
    const first = sim.tickCount;
    sim.mortarOverdriveResetPosition(a);
    // Held a ghost past the lock by a rival parked on it, then reset again.
    while (sim.tickCount < first + MORTAR_OVERDRIVE_RESET_LOCK_TICKS + 1 + 4) {
      parkOn(sim, match, b, racer);
      sim.tick();
    }
    expect(mortarOverdriveGhosted(racer)).toBe(true);
    const second = sim.tickCount;
    sim.mortarOverdriveResetPosition(a);
    // Exactly what one fresh recovery at this tick opens.
    expect({ earliestClearTick: progress.ghostClearTick, capTick: progress.ghostCapTick }).toEqual({
      earliestClearTick: second + MORTAR_OVERDRIVE_RESET_LOCK_TICKS + 1,
      capTick: second + MORTAR_OVERDRIVE_RESET_LOCK_TICKS + 1 + MORTAR_OVERDRIVE_GHOST_MARGIN_TICKS,
    });
    expect(racer.auras.filter((aura) => aura.id === MORTAR_OVERDRIVE_GHOST_AURA)).toHaveLength(1);
  });
});

describe('a ghost touches nobody', () => {
  it('lets a rival sit inside it for the whole lock with no shove and no bump', () => {
    const { sim, match, a, b, racer, rival } = racing();
    const bumps = watch(sim, 'mortarOverdriveBump');
    sim.mortarOverdriveResetPosition(a);
    parkOn(sim, match, b, racer);
    const rivalAt = { ...rival.pos };
    const racerAt = { ...racer.pos };
    for (let i = 0; i < MORTAR_OVERDRIVE_RESET_LOCK_TICKS; i++) sim.tick();
    expect(mortarOverdriveGhosted(racer)).toBe(true);
    expect(rival.pos.x).toBeCloseTo(rivalAt.x, 9);
    expect(rival.pos.z).toBeCloseTo(rivalAt.z, 9);
    expect(racer.pos.x).toBeCloseTo(racerAt.x, 9);
    expect(racer.pos.z).toBeCloseTo(racerAt.z, 9);
    expect(bumps()).toEqual([]);
    expect(required(match.progress.get(b), 'rival progress').hadRivalContact).toBe(false);
  });

  it('shoves the same parked rival apart when the machine is NOT a ghost (the control)', () => {
    const { sim, match, a, b, racer, rival } = racing();
    sim.mortarOverdriveResetPosition(a);
    // Strip the ghost by hand: the same overlap must now resolve.
    racer.auras = racer.auras.filter((aura) => aura.id !== MORTAR_OVERDRIVE_GHOST_AURA);
    parkOn(sim, match, b, racer);
    const rivalAt = { ...rival.pos };
    sim.tick();
    expect(Math.hypot(rival.pos.x - rivalAt.x, rival.pos.z - rivalAt.z)).toBeGreaterThan(0.01);
  });

  it('stays a ghost past its window while overlapped, and ends the first tick it is clear', () => {
    const { sim, match, a, b, racer, rival, progress } = racing();
    const earliestClearTick = manualGhostClearTick(sim.tickCount);
    sim.mortarOverdriveResetPosition(a);
    parkOn(sim, match, b, racer);
    while (sim.tickCount < earliestClearTick) sim.tick();
    sim.tick();
    sim.tick();
    // Unlocked, still inside the rival: a ghost, or two machines spawn in each
    // other.
    expect(sim.tickCount).toBe(earliestClearTick + 2);
    expect(mortarOverdriveGhosted(racer)).toBe(true);
    // Clear of it by more than the reach: solid on the next tick.
    park(sim, match, b, racer.pos.x + REACH + 1, racer.pos.z);
    expect(mortarOverdriveGhosted(rival)).toBe(false);
    sim.tick();
    expect(mortarOverdriveGhosted(racer)).toBe(false);
    expect(progress.ghostCapTick).toBe(0);
  });

  it('ends at the cap even with a rival parked on it, and the contact resolves again', () => {
    const { sim, match, a, b, racer, rival, progress } = racing();
    const cap = manualGhostClearTick(sim.tickCount) + MORTAR_OVERDRIVE_GHOST_MARGIN_TICKS;
    sim.mortarOverdriveResetPosition(a);
    expect(progress.ghostCapTick).toBe(cap);
    while (sim.tickCount < cap - 1) {
      // Held on top of it every tick, the way a rival parked on it would sit.
      parkOn(sim, match, b, racer, 0.5);
      sim.tick();
      expect(mortarOverdriveGhosted(racer)).toBe(true);
    }
    parkOn(sim, match, b, racer, 0.5);
    const rivalAt = { ...rival.pos };
    sim.tick();
    expect(sim.tickCount).toBe(cap);
    expect(mortarOverdriveGhosted(racer)).toBe(false);
    // Solid again on that same tick: the pair is pushed apart.
    expect(Math.hypot(rival.pos.x - rivalAt.x, rival.pos.z - rivalAt.z)).toBeGreaterThan(0.01);
  });

  it('replays the playtest: the shooter follows at speed and passes the recovered kart clean', () => {
    const run = (ghost: boolean) => {
      const { sim, match, a, b, racer, rival, pids } = racing();
      const bumps = watch(sim, 'mortarOverdriveBump');
      const lockedUntilTick = sim.tickCount + MORTAR_OVERDRIVE_RESET_LOCK_TICKS + 1;
      sim.mortarOverdriveResetPosition(a);
      if (!ghost)
        racer.auras = racer.auras.filter((aura) => aura.id !== MORTAR_OVERDRIVE_GHOST_AURA);
      // The shooter, twelve yards behind on the racing line, aimed straight at
      // the recovered machine and already at racing speed.
      const dirX = Math.sin(racer.facing);
      const dirZ = Math.cos(racer.facing);
      park(sim, match, b, racer.pos.x - dirX * 12, racer.pos.z - dirZ * 12);
      rival.facing = racer.facing;
      required(rival.drive, 'rival drive').speed = PROFILE.maxSpeed * 0.75;
      required(sim.players.get(b), 'rival player').moveInput.forward = true;
      const parked = { ...racer.pos };
      for (let i = 0; i < 12; i++) sim.tick();
      const ahead = (rival.pos.x - parked.x) * dirX + (rival.pos.z - parked.z) * dirZ;
      return {
        bumps: bumps().filter((event) => pids.includes(event.aId as number)),
        ahead,
        racerMoved: Math.hypot(racer.pos.x - parked.x, racer.pos.z - parked.z),
        rivalContact: required(match.progress.get(b), 'rival progress').hadRivalContact,
        stillLocked: sim.tickCount < lockedUntilTick,
      };
    };
    const clean = run(true);
    // Straight through, still inside the recovered machine's lock, and neither
    // machine touched.
    expect(clean.stillLocked).toBe(true);
    expect(clean.ahead).toBeGreaterThan(REACH);
    expect(clean.bumps).toEqual([]);
    expect(clean.racerMoved).toBeLessThan(0.01);
    expect(clean.rivalContact).toBe(false);
    // The same approach against a SOLID parked machine is the collision the
    // playtest reported, which is what makes the case above decisive.
    const solid = run(false);
    expect(solid.bumps.length).toBeGreaterThan(0);
    expect(solid.rivalContact).toBe(true);
  });
});

describe('the ghost ends only when it really is clear', () => {
  it('holds through a rival tunnelling through it on the clearing tick, with no bump', () => {
    const { sim, match, a, b, racer, rival } = racing();
    const bumps = watch(sim, 'mortarOverdriveBump');
    const earliestClearTick = manualGhostClearTick(sim.tickCount);
    sim.mortarOverdriveResetPosition(a);
    // Held on it past the earliest clear, so the next evaluation may clear.
    while (sim.tickCount < earliestClearTick + 1) {
      parkOn(sim, match, b, racer);
      sim.tick();
    }
    expect(mortarOverdriveGhosted(racer)).toBe(true);
    // One pass of the race: the rival crossed the whole ghost inside the tick,
    // clear of it at both ends (a shell throw, or a head-on meeting).
    const dirX = Math.sin(racer.facing);
    const dirZ = Math.cos(racer.facing);
    rival.prevPos = { ...rival.pos, x: racer.pos.x - dirX * 4, z: racer.pos.z - dirZ * 4 };
    rival.pos = { ...rival.pos, x: racer.pos.x + dirX * 4, z: racer.pos.z + dirZ * 4 };
    sim.ctx.rebucket(rival);
    const rivalAt = { ...rival.pos };
    updateMortarOverdrive(sim.ctx);
    expect(sim.tickCount).toBeLessThan(earliestClearTick + MORTAR_OVERDRIVE_GHOST_MARGIN_TICKS);
    expect(mortarOverdriveGhosted(racer)).toBe(true);
    expect(bumps()).toEqual([]);
    expect(rival.pos.x).toBeCloseTo(rivalAt.x, 9);
    expect(rival.pos.z).toBeCloseTo(rivalAt.z, 9);
  });

  it('holds two karts recovered onto the same anchor, and parts them boundedly at the cap', () => {
    const { sim, match, a, b, racer, rival, progress, road } = racing();
    const rivalProgress = required(match.progress.get(b), 'rival progress');
    rivalProgress.resetS = road.s;
    const cap = manualGhostClearTick(sim.tickCount) + MORTAR_OVERDRIVE_GHOST_MARGIN_TICKS;
    sim.mortarOverdriveResetPosition(a);
    sim.mortarOverdriveResetPosition(b);
    expect(mortarOverdriveGhosted(racer)).toBe(true);
    expect(mortarOverdriveGhosted(rival)).toBe(true);
    expect(Math.hypot(racer.pos.x - rival.pos.x, racer.pos.z - rival.pos.z)).toBeLessThan(REACH);
    expect(progress.ghostCapTick).toBe(cap);
    expect(rivalProgress.ghostCapTick).toBe(cap);
    while (sim.tickCount < cap - 1) {
      sim.tick();
      expect(mortarOverdriveGhosted(racer)).toBe(true);
      expect(mortarOverdriveGhosted(rival)).toBe(true);
    }
    sim.tick();
    expect(mortarOverdriveGhosted(racer)).toBe(false);
    expect(mortarOverdriveGhosted(rival)).toBe(false);
    for (let i = 0; i < 10; i++) sim.tick();
    const apart = Math.hypot(racer.pos.x - rival.pos.x, racer.pos.z - rival.pos.z);
    for (const p of [racer.pos, rival.pos]) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
    }
    // Parted to about the reach, never flung across the circuit.
    expect(apart).toBeGreaterThan(REACH * 0.9);
    expect(apart).toBeLessThan(REACH * 3);
  });

  for (const ram of [false, true]) {
    it(`holds two karts recovered onto one anchor on different ticks, each to its own cap${ram ? ', rammed apart at the second' : ''}`, () => {
      const { sim, match, a, b, racer, rival, progress, road } = racing();
      const rivalProgress = required(match.progress.get(b), 'rival progress');
      rivalProgress.resetS = road.s;
      const bumps = watch(sim, 'mortarOverdriveBump');
      const firstCap = manualGhostClearTick(sim.tickCount) + MORTAR_OVERDRIVE_GHOST_MARGIN_TICKS;
      sim.mortarOverdriveResetPosition(a);
      for (let i = 0; i < 10; i++) sim.tick();
      const secondCap = manualGhostClearTick(sim.tickCount) + MORTAR_OVERDRIVE_GHOST_MARGIN_TICKS;
      sim.mortarOverdriveResetPosition(b);
      expect(progress.ghostCapTick).toBe(firstCap);
      expect(rivalProgress.ghostCapTick).toBe(secondCap);
      expect(Math.hypot(racer.pos.x - rival.pos.x, racer.pos.z - rival.pos.z)).toBeLessThan(REACH);
      // The second kart inside it all along does not stretch the first past its
      // own cap: the later window is the second kart's alone.
      while (sim.tickCount < firstCap - 1) {
        sim.tick();
        expect(mortarOverdriveGhosted(racer)).toBe(true);
        expect(mortarOverdriveGhosted(rival)).toBe(true);
      }
      sim.tick();
      expect(mortarOverdriveGhosted(racer)).toBe(false);
      expect(mortarOverdriveGhosted(rival)).toBe(true);
      // Ended inside the second kart, which is still a ghost.
      expect(progress.ghostPartingPids).toEqual([b]);
      expect(rivalProgress.ghostPartingPids).toEqual([]);
      // Solid now, with a ghost still inside it: nothing touches until that one
      // runs out too.
      const firstAt = { ...racer.pos };
      while (sim.tickCount < secondCap - 1) {
        sim.tick();
        expect(mortarOverdriveGhosted(rival)).toBe(true);
      }
      expect(racer.pos.x).toBeCloseTo(firstAt.x, 9);
      expect(racer.pos.z).toBeCloseTo(firstAt.z, 9);
      // The ram variant: the second kart drives into the first on its own cap
      // tick, so the separation lands at a real impact.
      if (ram) ramInto(sim, match, b, racer, 1.5);
      sim.tick();
      expect(mortarOverdriveGhosted(rival)).toBe(false);
      expect(progress.ghostPartingPids).toEqual([b]);
      expect(rivalProgress.ghostPartingPids).toEqual([a]);
      const impacts = bumps().map((event) => event.impact as number);
      if (ram) {
        expect(impacts).toHaveLength(1);
        expect(impacts[0]).toBeGreaterThanOrEqual(MORTAR_OVERDRIVE_BUMP_EVENT_MIN_IMPACT);
      }
      for (let i = 0; i < 10; i++) sim.tick();
      for (const p of [racer.pos, rival.pos]) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
      }
      const apart = Math.hypot(racer.pos.x - rival.pos.x, racer.pos.z - rival.pos.z);
      expect(apart).toBeGreaterThan(REACH * 0.9);
      expect(apart).toBeLessThan(REACH * 3);
      // Parted by the race, not by either pilot.
      expect(progress.hadRivalContact).toBe(false);
      expect(rivalProgress.hadRivalContact).toBe(false);
    });
  }

  it('still collides two solid rivals while a third machine on the grid is a ghost', () => {
    const { sim, match, a, pids, racer, progress } = racing();
    const [, b, c] = pids;
    const bumps = watch(sim, 'mortarOverdriveBump');
    sim.mortarOverdriveResetPosition(a);
    const rival = required(sim.entities.get(b), 'rival');
    // Far from the ghost, the third machine drives into the rival.
    ramInto(sim, match, c, rival, 1.5);
    const rivalAt = { ...rival.pos };
    sim.tick();
    expect(mortarOverdriveGhosted(racer)).toBe(true);
    const pairs = bumps().map((event) => [event.aId, event.bId].sort());
    expect(pairs).toEqual([[b, c].sort()]);
    expect(Math.hypot(rival.pos.x - rivalAt.x, rival.pos.z - rivalAt.z)).toBeGreaterThan(0.01);
    expect(required(match.progress.get(b), 'rival progress').hadRivalContact).toBe(true);
    expect(required(match.progress.get(c), 'third progress').hadRivalContact).toBe(true);
    expect(progress.hadRivalContact).toBe(false);
  });

  /** Pilot `a` crosses the finish line as a ghost: wedged off the road twenty
   *  yards short of it on the last lap, where the stuck arm's one-tick lock
   *  hands the wheel straight back, and over the line two ticks later. */
  function finishedAsGhost() {
    const staged = racing();
    const { sim, match, a, racer, progress } = staged;
    const track = mortarOverdriveTrack(RACE_CIRCUIT);
    const anchor = onLane(match, track.length - 20);
    progress.lap = match.totalLaps;
    progress.resetS = anchor.s;
    progress.resetLap = match.totalLaps;
    progress.resetDistanceSinceWrap = track.length - 20;
    const lateral = anchor.halfWidth + 8;
    park(sim, match, a, anchor.x - anchor.tz * lateral, anchor.z + anchor.tx * lateral);
    for (let i = 0; i < MORTAR_OVERDRIVE_STUCK_TICKS; i++) sim.tick();
    expect(racer.pos.x).toBeCloseTo(anchor.x, 5);
    const resetTick = sim.tickCount;
    sim.tick();
    sim.tick();
    // Teleport, not park: the crossing is read off the last arc the race
    // credited, which is the anchor's.
    const over = onLane(match, 5);
    teleport(sim, a, over.x, over.z);
    sim.tick();
    expect(progress.finishedTick).toBe(sim.tickCount);
    expect(mortarOverdriveGhosted(racer)).toBe(true);
    expect(match.phase).toBe('racing');
    return { ...staged, earliestClearTick: autoGhostClearTick(resetTick) };
  }

  for (const rivalOn of [false, true]) {
    it(`still ends the ghost of a pilot who crossed the line in it${rivalOn ? ', at the cap with a rival on it' : ''}`, () => {
      const { sim, match, b, racer, progress, earliestClearTick } = finishedAsGhost();
      if (rivalOn) {
        expectGhostWindow({
          sim,
          racer,
          progress,
          earliestClearTick,
          holdRivalOn: () => parkOn(sim, match, b, racer),
        });
      } else {
        expectGhostEndsWhenClear({ sim, racer, progress, earliestClearTick });
      }
      // And gone for good: nothing brings it back through the tableau.
      for (let i = 0; i < TICK_RATE; i++) sim.tick();
      expect(mortarOverdriveGhosted(racer)).toBe(false);
    });
  }

  for (const capped of [false, true]) {
    it(`clears a finisher's ${capped ? 'live parting' : 'live ghost'} when they leave, straight home`, () => {
      const { sim, match, a, b, racer, progress, earliestClearTick } = finishedAsGhost();
      if (capped) {
        expectGhostWindow({
          sim,
          racer,
          progress,
          earliestClearTick,
          holdRivalOn: () => parkOn(sim, match, b, racer),
        });
        expect(progress.ghostPartingPids).toEqual([b]);
      } else {
        expect(progress.ghostCapTick).toBe(earliestClearTick + MORTAR_OVERDRIVE_GHOST_MARGIN_TICKS);
      }
      // A finisher who leaves skips the quitter's arm (and the clear in it):
      // the race returns them home at once.
      sim.mortarOverdriveForfeit(a);
      expect(progress.retiredTick).toBeNull();
      expect(progress.returned).toBe(true);
      expect(progress.ghostClearTick).toBe(0);
      expect(progress.ghostCapTick).toBe(0);
      expect(progress.ghostPartingPids).toEqual([]);
      expect(mortarOverdriveGhosted(racer)).toBe(false);
    });
  }
});

describe('the separation at the cap is no rival contact', () => {
  /**
   * A ghost held to its cap by a rival parked on it, with the rival driving into
   * it on the cap tick itself: the pair the cap parts, at a closing speed the
   * clean-race flag's own floor would count. The contact pass reads each pair
   * lower roster index first, so `ghostAt` picks which side of it the ghost's
   * parting sits on. The default puts the ghost on `a`, its rival on `b`.
   */
  function partedAtCap(ghostAt: 'lower' | 'higher' = 'lower') {
    const staged = racing();
    const { sim, match, a, b, road } = staged;
    const [ghostPid, rivalPid] = ghostAt === 'lower' ? [a, b] : [b, a];
    const ghost = required(sim.entities.get(ghostPid), 'ghost');
    const ghostProgress = required(match.progress.get(ghostPid), 'ghost progress');
    ghostProgress.resetS = road.s;
    const bumps = watch(sim, 'mortarOverdriveBump');
    const pairBumps = () =>
      bumps().filter((event) => {
        const pair = [event.aId, event.bId];
        return pair.includes(ghostPid) && pair.includes(rivalPid);
      });
    const capTick = manualGhostClearTick(sim.tickCount) + MORTAR_OVERDRIVE_GHOST_MARGIN_TICKS;
    sim.mortarOverdriveResetPosition(ghostPid);
    const spot = { x: ghost.pos.x, z: ghost.pos.z };
    while (sim.tickCount < capTick - 1) {
      parkOn(sim, match, rivalPid, ghost);
      sim.tick();
    }
    ramInto(sim, match, rivalPid, ghost, 1.5);
    sim.tick();
    expect(sim.tickCount).toBe(capTick);
    expect(mortarOverdriveGhosted(ghost)).toBe(false);
    expect(ghostProgress.ghostPartingPids).toEqual([rivalPid]);
    // The race still parts them, loudly, exactly as before.
    expect(pairBumps()).toHaveLength(1);
    expect(pairBumps()[0].impact as number).toBeGreaterThanOrEqual(
      MORTAR_OVERDRIVE_BUMP_EVENT_MIN_IMPACT,
    );
    return {
      ...staged,
      ghostPid,
      rivalPid,
      ghostProgress,
      spot,
      pairBumps,
      rivalProgress: required(match.progress.get(rivalPid), 'rival progress'),
    };
  }

  for (const ghostAt of ['lower', 'higher'] as const) {
    it(`parts the pair with its bump, and spoils neither clean race (ghost at the ${ghostAt} index)`, () => {
      const { sim, match, ghostProgress, rivalProgress } = partedAtCap(ghostAt);
      for (let i = 0; i < TICK_RATE; i++) sim.tick();
      match.deadlineTick = sim.tickCount;
      sim.tick();
      expect(match.phase).toBe('finished');
      expect(ghostProgress.hadRivalContact).toBe(false);
      expect(rivalProgress.hadRivalContact).toBe(false);
    });
  }

  it('exempts both rivals a ghost ended inside at once, and only those two contacts', () => {
    const { sim, match, a, pids, racer, progress } = racing();
    const [, b, c] = pids;
    const bumps = watch(sim, 'mortarOverdriveBump');
    const capTick = manualGhostClearTick(sim.tickCount) + MORTAR_OVERDRIVE_GHOST_MARGIN_TICKS;
    sim.mortarOverdriveResetPosition(a);
    // One rival either side, each inside the ghost and out of the other's reach.
    while (sim.tickCount < capTick - 1) {
      parkOn(sim, match, b, racer, 2.2);
      parkOn(sim, match, c, racer, -2.2);
      sim.tick();
    }
    ramInto(sim, match, b, racer, 2.2);
    ramInto(sim, match, c, racer, -2.2);
    sim.tick();
    expect(sim.tickCount).toBe(capTick);
    expect(progress.ghostPartingPids).toEqual([b, c]);
    const byPair = (x: number, y: number) => x - y;
    expect(bumps().map((event) => [event.aId as number, event.bId as number].sort(byPair))).toEqual(
      [
        [a, b],
        [a, c],
      ].map((pair) => pair.sort(byPair)),
    );
    for (const event of bumps()) {
      expect(event.impact as number).toBeGreaterThanOrEqual(MORTAR_OVERDRIVE_BUMP_EVENT_MIN_IMPACT);
    }
    for (const pid of [a, b, c]) {
      expect(required(match.progress.get(pid), `progress ${pid}`).hadRivalContact).toBe(false);
    }
  });

  it('keeps the pair parting while they stay inside each other, and counts them once apart', () => {
    const { sim, match, b, racer, spot, progress, rivalProgress, pairBumps } = partedAtCap();
    // Still inside each other and still closing, past the bump throttle: real
    // impacts every tick, and still the one separation.
    for (let i = 0; i < MORTAR_OVERDRIVE_BUMP_EVENT_TICKS + 1; i++) {
      holdStill(sim, match, racer, spot);
      ramInto(sim, match, b, racer, 1.5);
      sim.tick();
    }
    expect(pairBumps().length).toBeGreaterThan(1);
    expect(progress.hadRivalContact).toBe(false);
    expect(rivalProgress.hadRivalContact).toBe(false);
    // Apart for one tick...
    holdStill(sim, match, racer, spot);
    park(sim, match, b, spot.x + REACH + 3, spot.z);
    sim.tick();
    // ...and the next contact between the same two is a contact like any other.
    holdStill(sim, match, racer, spot);
    ramInto(sim, match, b, racer, 1.5);
    sim.tick();
    expect(progress.hadRivalContact).toBe(true);
    expect(rivalProgress.hadRivalContact).toBe(true);
  });

  it('ends a parting one margin past the cap even with the pair still inside each other', () => {
    // Pinned together (a wall behind one of them, or a blast throwing one back
    // into the other): the exemption still runs out.
    const { sim, match, b, racer, spot, progress, rivalProgress } = partedAtCap();
    const capTick = sim.tickCount;
    const partingEndTick = capTick + MORTAR_OVERDRIVE_GHOST_MARGIN_TICKS;
    while (sim.tickCount < partingEndTick - 1) {
      holdStill(sim, match, racer, spot);
      ramInto(sim, match, b, racer, 1.5);
      sim.tick();
    }
    expect(progress.ghostPartingPids).toEqual([b]);
    expect(progress.hadRivalContact).toBe(false);
    expect(rivalProgress.hadRivalContact).toBe(false);
    holdStill(sim, match, racer, spot);
    ramInto(sim, match, b, racer, 1.5);
    sim.tick();
    expect(sim.tickCount).toBe(partingEndTick);
    expect(progress.ghostPartingPids).toEqual([]);
    expect(progress.hadRivalContact).toBe(true);
    expect(rivalProgress.hadRivalContact).toBe(true);
  });

  it('counts a third machine that hits one of a parting pair, for those two alone', () => {
    const { sim, match, pids, b, racer, spot, progress, rivalProgress } = partedAtCap();
    const c = pids[2];
    const thirdProgress = required(match.progress.get(c), 'third progress');
    // The pair still inside each other, and a third machine driving into the
    // recovered one from the far side, out of the rival's reach.
    holdStill(sim, match, racer, spot);
    ramInto(sim, match, b, racer, 1.5);
    ramInto(sim, match, c, racer, -2.7, 5);
    sim.tick();
    expect(progress.hadRivalContact).toBe(true);
    expect(thirdProgress.hadRivalContact).toBe(true);
    expect(rivalProgress.hadRivalContact).toBe(false);
  });

  it('forgets a parting with a new recovery, a forfeit, and the flag', () => {
    const recovered = partedAtCap();
    expect(recovered.progress.ghostPartingPids).toEqual([recovered.b]);
    recovered.sim.mortarOverdriveResetPosition(recovered.a);
    expect(mortarOverdriveGhosted(recovered.racer)).toBe(true);
    expect(recovered.progress.ghostPartingPids).toEqual([]);

    const quit = partedAtCap();
    quit.sim.mortarOverdriveForfeit(quit.a);
    expect(quit.progress.ghostPartingPids).toEqual([]);

    const flagged = partedAtCap();
    flagged.match.deadlineTick = flagged.sim.tickCount;
    flagged.sim.tick();
    expect(flagged.match.phase).toBe('finished');
    expect(flagged.progress.ghostPartingPids).toEqual([]);
  });

  it('forgets the window and the parting of a pilot whose body is already gone', () => {
    // A ghost still running, and a parting still live: both are the race's
    // books, not the body's, so a pilot retired with no entity left to strip
    // still leaves them clean.
    const ghosted = racing();
    ghosted.sim.mortarOverdriveResetPosition(ghosted.a);
    expect(ghosted.progress.ghostCapTick).not.toBe(0);
    ghosted.sim.entities.delete(ghosted.a);
    ghosted.sim.tick();
    expect(ghosted.progress.returned).toBe(true);
    expect(ghosted.progress.ghostClearTick).toBe(0);
    expect(ghosted.progress.ghostCapTick).toBe(0);

    const parted = partedAtCap();
    parted.sim.entities.delete(parted.a);
    parted.sim.tick();
    expect(parted.progress.returned).toBe(true);
    expect(parted.progress.ghostPartingPids).toEqual([]);
  });
});

describe('hazards ignore the ghost', () => {
  /** A ghost past its lock, held a ghost by a rival parked on it. */
  function unlockedGhost() {
    const staged = racing();
    const { sim, match, a, b, racer } = staged;
    // A manual lock ends on the ghost's earliest clear tick.
    const unlockedTick = manualGhostClearTick(sim.tickCount);
    sim.mortarOverdriveResetPosition(a);
    while (sim.tickCount < unlockedTick + 1) {
      parkOn(sim, match, b, racer);
      sim.tick();
    }
    expect(mortarOverdriveGhosted(racer)).toBe(true);
    expect(mortarOverdriveMovementLockedAt(sim.ctx, a, unlockedTick - 1)).toBe(true);
    expect(mortarOverdriveMovementLockedAt(sim.ctx, a, sim.tickCount)).toBe(false);
    return staged;
  }

  it('lets a Ground Blast land on an unlocked ghost', () => {
    const { sim, match, pids, racer } = unlockedGhost();
    match.groundBlasts.push({
      ownerPid: pids[2],
      x: racer.pos.x + 0.5,
      z: racer.pos.z + 0.4,
      impactTick: sim.tickCount + 1,
    });
    sim.tick();
    expect(racer.auras.some((aura) => aura.id === MORTAR_OVERDRIVE_GROUND_BLAST_AURA)).toBe(true);
  });

  it('lets a patch of oil catch an unlocked ghost', () => {
    const { sim, match, pids, racer, progress } = unlockedGhost();
    const local = mortarOverdriveToCanonical(match, racer.pos.x, racer.pos.z);
    match.slicks.push({
      id: match.nextSlickId++,
      x: local.x,
      z: local.z,
      ownerPid: pids[2],
      ownerClear: true,
      expiresTick: sim.tickCount + MORTAR_OVERDRIVE_SLICK_LIFETIME_TICKS,
    });
    expect(progress.slickGripUntilTick).toBe(0);
    sim.tick();
    expect(progress.slickGripUntilTick).toBeGreaterThan(sim.tickCount);
  });
});

describe('the ghost aura lifecycle', () => {
  it('goes with the flag when the race ends', () => {
    const { sim, match, a, racer } = racing();
    sim.mortarOverdriveResetPosition(a);
    const auras = watch(sim, 'aura');
    match.deadlineTick = sim.tickCount;
    sim.tick();
    expect(match.phase).toBe('finished');
    expect(mortarOverdriveGhosted(racer)).toBe(false);
    expect(auras().filter((event) => event.name === 'Ghosted')).toEqual([]);
  });

  it('goes with a forfeit, at once, while the tableau still stands', () => {
    const { sim, a, racer, progress } = racing();
    sim.mortarOverdriveResetPosition(a);
    sim.mortarOverdriveForfeit(a);
    expect(progress.retiredTick).not.toBeNull();
    expect(progress.returned).toBe(false);
    expect(mortarOverdriveGhosted(racer)).toBe(false);
    expect(progress.ghostCapTick).toBe(0);
  });

  it('goes with a disconnect', () => {
    const { sim, a, racer, progress } = racing();
    sim.mortarOverdriveResetPosition(a);
    sim.preparePlayerLeave(a);
    expect(progress.returned).toBe(true);
    expect(mortarOverdriveGhosted(racer)).toBe(false);
  });
});

describe('a ghost belongs to the race that made it', () => {
  /**
   * Pilot `a` quits one race and waits out its tableau while that race runs on,
   * then is seated in another and recovered there. The public race ticks before
   * every practice, so both orders are staged: the race `a` left ticking before
   * the one it now drives, and after it.
   */
  function reseated(left: 'public' | 'practice') {
    const sim = makeWorld();
    const add = (i: number) => addAt(sim, 'warrior', `Racer${i}`, -6 + i * 4, -40);
    const a = add(0);
    const publicField = [1, 2, 3].map(add);
    const practiceField = [4, 5, 6].map(add);
    const seat = (kind: 'public' | 'practice'): MortarOverdriveMatch => {
      const seated =
        kind === 'public'
          ? mortarOverdriveStartMatch(sim.ctx, [a, ...publicField], undefined, RACE_CIRCUIT.id)
          : mortarOverdriveStartMatch(sim.ctx, [a, ...practiceField], {
              ownerPid: a,
              slot: mortarOverdriveFreePracticeSlot(sim.ctx),
            });
      expect(seated).toBe(true);
      const match = required(mortarOverdriveMatchOf(sim.ctx, a), `${kind} race`);
      sim.tick();
      match.phase = 'racing';
      sim.tick();
      return match;
    };
    const leftRace = seat(left);
    const leftProgress = required(leftRace.progress.get(a), 'left progress');
    sim.mortarOverdriveForfeit(a);
    for (let i = 0; i <= MORTAR_OVERDRIVE_RETURN_TICKS && !leftProgress.returned; i++) sim.tick();
    expect(leftProgress.returned).toBe(true);
    expect(leftRace.phase).toBe('racing');
    const race = seat(left === 'public' ? 'practice' : 'public');
    const progress = required(race.progress.get(a), 'progress');
    // Recovered mid-lap, a long way from the rest of its new grid.
    progress.resetS = mortarOverdriveTrack(mortarOverdriveCircuitOf(race)).length * 0.4;
    return { sim, a, leftRace, race, progress, racer: required(sim.entities.get(a), 'racer') };
  }

  for (const left of ['public', 'practice'] as const) {
    it(`keeps a ghost made in a new race while the ${left} race it quit still runs`, () => {
      const { sim, a, leftRace, race, progress, racer } = reseated(left);
      const resetTick = sim.tickCount;
      sim.mortarOverdriveResetPosition(a);
      expect(mortarOverdriveGhosted(racer)).toBe(true);
      const earliestClearTick = resetTick + MORTAR_OVERDRIVE_RESET_LOCK_TICKS + 1;
      expect(progress.ghostClearTick).toBe(earliestClearTick);
      expect(progress.ghostCapTick).toBe(earliestClearTick + MORTAR_OVERDRIVE_GHOST_MARGIN_TICKS);
      // Nobody near it in either race: a ghost for its whole window, whatever
      // the race it left makes of the pilot it no longer holds.
      while (sim.tickCount < earliestClearTick - 1) {
        sim.tick();
        expect(mortarOverdriveGhosted(racer)).toBe(true);
      }
      expect(leftRace.phase).toBe('racing');
      expect(race.phase).toBe('racing');
      sim.tick();
      expect(mortarOverdriveGhosted(racer)).toBe(false);
    });
  }
});
