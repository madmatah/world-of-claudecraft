import { describe, expect, it } from 'vitest';
import { stopDisconnectedPlayerInput } from '../server/disconnected_player_input';
import {
  createRealmRacersStartCamera,
  REALM_RACERS_HANDOFF_TICKS,
  realmRacersStartCameraInput,
  stepRealmRacersStartCamera,
} from '../src/game/realm_racers_start_camera';
import { REALM_RACERS_GRID_SIZE } from '../src/sim/realm_racers_layout';
import type { Sim } from '../src/sim/sim';
import {
  REALM_RACERS_COUNTDOWN_TICKS,
  type RealmRacersMatch,
  realmRacersCircuitOf,
  realmRacersMatchOf,
  realmRacersReady,
} from '../src/sim/social/realm_racers';
import { REALM_RACERS_LOADING_MAX_TICKS } from '../src/sim/social/realm_racers_loading';
import { TICK_RATE } from '../src/sim/types';
import { addAt, makeWorld, readyAllRacers } from './realm_racers_util';

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

/** Four humans seated through the queue, on the tick the grid fills. */
function seatedGrid(): { sim: Sim; pids: number[]; match: RealmRacersMatch; seatTick: number } {
  const sim = makeWorld();
  const pids = GRID.map((row) => addAt(sim, row.cls, row.name, row.x, row.z));
  for (const pid of pids) sim.realmRacersQueueJoin(pid);
  sim.tick();
  return { sim, pids, match: required(sim.realmRacers.match, 'match'), seatTick: sim.tickCount };
}

function lobbyOf(sim: Sim, pid: number) {
  return required(sim.realmRacersInfoFor(pid).match, `readout for ${pid}`);
}

describe('Realm Racers loading lobby', () => {
  it('seats the grid in the lobby, held still, with no race clock running', () => {
    const { sim, pids, match, seatTick } = seatedGrid();
    const [a] = pids;
    expect(match.phase).toBe('loading');
    expect(lobbyOf(sim, a)).toMatchObject({
      phase: 'loading',
      countdown: 0,
      countdownTicks: 0,
      elapsed: 0,
      elapsedTicks: 0,
      loading: { secondsLeft: REALM_RACERS_LOADING_MAX_TICKS / TICK_RATE, readyIds: [] },
    });
    const racer = required(sim.entities.get(a), 'racer');
    const before = { ...racer.pos };
    required(sim.players.get(a), 'meta').moveInput.forward = true;
    for (let i = 0; i < 40; i++) sim.tick();
    expect(match.phase).toBe('loading');
    expect(racer.pos.x).toBeCloseTo(before.x, 6);
    expect(racer.pos.z).toBeCloseTo(before.z, 6);
    expect(racer.drive?.controlsLocked).toBe(true);
    expect(racer.drive?.speed).toBe(0);
    // 40 ticks into a 300-tick lobby: 260 ticks left, 13 whole seconds.
    expect(sim.tickCount - seatTick).toBe(40);
    expect(lobbyOf(sim, a).loading?.secondsLeft).toBe(13);
    sim.tick();
    // 259 ticks round UP to the same 13, so the readout holds within a second.
    expect(lobbyOf(sim, a).loading?.secondsLeft).toBe(13);
    expect(lobbyOf(sim, a).elapsedTicks).toBe(0);
  });

  it('starts the countdown on the same tick for everyone once the last pilot is ready', () => {
    const { sim, pids, match } = seatedGrid();
    for (const pid of pids.slice(0, 3)) realmRacersReady(sim.ctx, pid);
    for (let i = 0; i < 10; i++) sim.tick();
    expect(match.phase).toBe('loading');
    expect(lobbyOf(sim, pids[3]).loading?.readyIds).toEqual(pids.slice(0, 3));

    realmRacersReady(sim.ctx, pids[3]);
    sim.tick();
    expect(match.phase).toBe('countdown');
    const transition = sim.tickCount;
    expect(match.goTick).toBe(transition + REALM_RACERS_COUNTDOWN_TICKS);
    expect(match.deadlineTick).toBe(
      match.goTick + realmRacersCircuitOf(match).timeLimitSeconds * TICK_RATE,
    );
    for (const pid of pids) {
      const readout = lobbyOf(sim, pid);
      expect(readout).toMatchObject({
        phase: 'countdown',
        countdownTicks: REALM_RACERS_COUNTDOWN_TICKS,
      });
      expect(readout.loading).toBeUndefined();
    }
    for (let i = 0; i < REALM_RACERS_COUNTDOWN_TICKS - 1; i++) sim.tick();
    expect(match.phase).toBe('countdown');
    sim.tick();
    expect(match.phase).toBe('racing');
    expect(sim.tickCount).toBe(match.goTick);
    expect(match.progress.get(pids[0])?.lapStartTick).toBe(match.goTick);
  });

  it('starts the countdown at the cap when nobody is ready', () => {
    const { sim, match, seatTick } = seatedGrid();
    for (let i = 0; i < REALM_RACERS_LOADING_MAX_TICKS - 1; i++) sim.tick();
    expect(match.phase).toBe('loading');
    sim.tick();
    expect(match.phase).toBe('countdown');
    expect(sim.tickCount).toBe(seatTick + REALM_RACERS_LOADING_MAX_TICKS);
    expect(match.goTick).toBe(seatTick + REALM_RACERS_LOADING_MAX_TICKS + 180);
    expect(match.deadlineTick).toBe(
      match.goTick + realmRacersCircuitOf(match).timeLimitSeconds * TICK_RATE,
    );
    expect(REALM_RACERS_LOADING_MAX_TICKS).toBe(15 * TICK_RATE);
  });

  it('starts the countdown at the cap with a linkdead pilot still seated, and races on', () => {
    const { sim, pids, match, seatTick } = seatedGrid();
    readyAllRacers(sim);
    stopDisconnectedPlayerInput(sim, pids[2]);
    for (let i = 0; i < REALM_RACERS_LOADING_MAX_TICKS - 1; i++) sim.tick();
    expect(match.phase).toBe('loading');
    sim.tick();
    expect(match.phase).toBe('countdown');
    expect(sim.tickCount).toBe(seatTick + REALM_RACERS_LOADING_MAX_TICKS);
    for (let i = 0; i < REALM_RACERS_COUNTDOWN_TICKS; i++) sim.tick();
    expect(match.phase).toBe('racing');
    // The linkdead pilot is on the grid with everyone else, not retired.
    expect(realmRacersMatchOf(sim.ctx, pids[2])).toBe(match);
    expect(match.progress.get(pids[2])?.retiredTick).toBeNull();
    // One beat past the flip: the GO tick stamped the lock before it turned the phase.
    sim.tick();
    expect(required(sim.entities.get(pids[2]), 'racer').drive?.controlsLocked).toBe(false);
  });

  it('times the Practice lobby from a seat made between ticks', () => {
    // Practice seats from a command, between two ticks, so the seat tick itself
    // never runs the lobby: 299 loading ticks against the queue's 300 (the queue
    // seats inside a tick and that tick runs the lobby too). The cap tick is
    // the same 300 ticks after the seat's clock either way.
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.tick();
    const seatClock = sim.tickCount;
    sim.startRealmRacersPractice('rookie');
    const match = required(realmRacersMatchOf(sim.ctx, human), 'practice');
    expect(match.loadingUntilTick).toBe(seatClock + REALM_RACERS_LOADING_MAX_TICKS);
    let loadingTicks = 0;
    while (match.phase === 'loading') {
      sim.tick();
      if (match.phase === 'loading') loadingTicks++;
    }
    expect(loadingTicks).toBe(REALM_RACERS_LOADING_MAX_TICKS - 1);
    expect(sim.tickCount).toBe(seatClock + REALM_RACERS_LOADING_MAX_TICKS);
    expect(match.goTick).toBe(
      seatClock + REALM_RACERS_LOADING_MAX_TICKS + REALM_RACERS_COUNTDOWN_TICKS,
    );

    // Ready before the first tick: that tick closes the lobby.
    const other = makeWorld();
    const pilot = addAt(other, 'warrior', 'Briar', -5, -40);
    other.tick();
    const clock = other.tickCount;
    other.startRealmRacersPractice('rookie');
    other.readyRealmRacers();
    other.tick();
    const early = required(realmRacersMatchOf(other.ctx, pilot), 'practice');
    expect(early.phase).toBe('countdown');
    expect(early.goTick).toBe(clock + 1 + REALM_RACERS_COUNTDOWN_TICKS);
  });

  // The forfeit-in-the-lobby rule is pending a design decision; this is its slot.
  it.todo('decides what a forfeit in the loading lobby does to the race and its credit');

  it('ignores a duplicate, a stranger, a pilot of another race, a quitter and a late ready', () => {
    const { sim, pids, match } = seatedGrid();
    const [a, b, c, d] = pids;
    const stranger = addAt(sim, 'warrior', 'Eamon', 0, -46);
    const practiser = addAt(sim, 'mage', 'Fenn', 4, -46);
    sim.realmRacersPracticeStart('rookie', practiser);
    const practice = required(realmRacersMatchOf(sim.ctx, practiser), 'practice');

    realmRacersReady(sim.ctx, a);
    realmRacersReady(sim.ctx, a);
    realmRacersReady(sim.ctx, stranger);
    realmRacersReady(sim.ctx, practiser);
    sim.tick();
    expect(lobbyOf(sim, b).loading?.readyIds).toEqual([a]);
    expect(match.ready.has(stranger)).toBe(false);
    expect(match.ready.has(practiser)).toBe(false);
    // The practiser's ready is theirs, and it closed their own lobby only.
    expect(practice.phase).toBe('countdown');

    sim.realmRacersForfeit(b);
    realmRacersReady(sim.ctx, b);
    expect(match.ready.has(b)).toBe(false);
    // A pilot who quit is no longer waited for: the rest closes the lobby.
    realmRacersReady(sim.ctx, c);
    realmRacersReady(sim.ctx, d);
    sim.tick();
    expect(match.phase).toBe('countdown');
    const goTick = match.goTick;
    realmRacersReady(sim.ctx, a);
    sim.tick();
    expect(match.phase).toBe('countdown');
    expect(match.goTick).toBe(goTick);
    expect(match.ready.size).toBe(0);
  });

  it('counts a dropped client as not ready until it says so again', () => {
    const { sim, pids, match } = seatedGrid();
    readyAllRacers(sim);
    stopDisconnectedPlayerInput(sim, pids[1]);
    for (let i = 0; i < 5; i++) sim.tick();
    expect(match.phase).toBe('loading');
    expect(realmRacersMatchOf(sim.ctx, pids[1])).toBe(match);
    expect(lobbyOf(sim, pids[0]).loading?.readyIds).toEqual([pids[0], pids[2], pids[3]]);
    realmRacersReady(sim.ctx, pids[1]);
    sim.tick();
    expect(match.phase).toBe('countdown');
  });

  it('seats Practice with the house pilots ready, waiting on the player alone', () => {
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.startRealmRacersPractice('rookie');
    sim.tick();
    const match = required(realmRacersMatchOf(sim.ctx, human), 'practice');
    const bots = match.pids.filter((pid) => sim.realmRacers.bots.has(pid));
    expect(bots).toHaveLength(REALM_RACERS_GRID_SIZE - 1);
    expect(match.phase).toBe('loading');
    expect(sim.realmRacersInfo.match?.loading?.readyIds).toEqual(bots);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(match.phase).toBe('loading');

    sim.readyRealmRacers();
    sim.tick();
    expect(match.phase).toBe('countdown');
    expect(match.goTick).toBe(sim.tickCount + REALM_RACERS_COUNTDOWN_TICKS);
  });

  it('plays the whole establishing shot from the countdown, then hands back the chase view', () => {
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.startRealmRacersPractice('rookie');
    const state = createRealmRacersStartCamera();
    const step = () => {
      const facing = required(sim.entities.get(human), 'racer').facing;
      return stepRealmRacersStartCamera(
        state,
        realmRacersStartCameraInput(sim.realmRacersInfo.match, facing, facing, 12, false),
      );
    };
    for (let i = 0; i < 30; i++) {
      sim.tick();
      expect(step()).toBeNull();
    }
    sim.readyRealmRacers();
    sim.tick();
    expect(sim.realmRacersInfo.match?.countdownTicks).toBe(REALM_RACERS_COUNTDOWN_TICKS);
    const opening = required(step(), 'opening pose');
    expect(opening.dist).toBeGreaterThan(50);
    let released = null as ReturnType<typeof step>;
    for (let i = 0; i < REALM_RACERS_COUNTDOWN_TICKS + REALM_RACERS_HANDOFF_TICKS + 5; i++) {
      sim.tick();
      const pose = step();
      if (sim.realmRacersInfo.match?.phase !== 'racing') {
        expect(pose).not.toBeNull();
        continue;
      }
      if (state.matchId === null) {
        released = pose;
        break;
      }
    }
    expect(released).toMatchObject({ pitch: 0.32, dist: 12 });
    sim.tick();
    expect(step()).toBeNull();
  });
});
