import { describe, expect, it } from 'vitest';
import { stopDisconnectedPlayerInput } from '../server/disconnected_player_input';
import {
  createMortarOverdriveStartCamera,
  MORTAR_OVERDRIVE_HANDOFF_TICKS,
  mortarOverdriveStartCameraInput,
  stepMortarOverdriveStartCamera,
} from '../src/game/mortar_overdrive/start_camera';
import { updateDeeds } from '../src/sim/deeds';
import { MORTAR_OVERDRIVE_GRID_SIZE } from '../src/sim/mortar_overdrive/layout';
import { MORTAR_OVERDRIVE_LOADING_MAX_TICKS } from '../src/sim/mortar_overdrive/loading';
import {
  MORTAR_OVERDRIVE_COUNTDOWN_TICKS,
  MORTAR_OVERDRIVE_MOUNT_KEY,
  MORTAR_OVERDRIVE_RETURN_TICKS,
  type MortarOverdriveMatch,
  mortarOverdriveCircuitOf,
  mortarOverdriveMatchOf,
  mortarOverdriveReady,
  mortarOverdriveStartMatch,
} from '../src/sim/mortar_overdrive/race';
import type { Sim } from '../src/sim/sim';
import { type SimEvent, TICK_RATE } from '../src/sim/types';
import { addAt, makeWorld, readyAllRacers } from './mortar_overdrive_util';

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
function seatedGrid(): { sim: Sim; pids: number[]; match: MortarOverdriveMatch; seatTick: number } {
  const sim = makeWorld();
  const pids = GRID.map((row) => addAt(sim, row.cls, row.name, row.x, row.z));
  for (const pid of pids) sim.mortarOverdriveQueueJoin(pid);
  sim.tick();
  return {
    sim,
    pids,
    match: required(sim.mortarOverdrive.match, 'match'),
    seatTick: sim.tickCount,
  };
}

function lobbyOf(sim: Sim, pid: number) {
  return required(sim.mortarOverdriveInfoFor(pid).match, `readout for ${pid}`);
}

describe('Mortar Overdrive loading lobby', () => {
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
      loading: { secondsLeft: MORTAR_OVERDRIVE_LOADING_MAX_TICKS / TICK_RATE, readyIds: [] },
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
    for (const pid of pids.slice(0, 3)) mortarOverdriveReady(sim.ctx, pid);
    for (let i = 0; i < 10; i++) sim.tick();
    expect(match.phase).toBe('loading');
    expect(lobbyOf(sim, pids[3]).loading?.readyIds).toEqual(pids.slice(0, 3));

    mortarOverdriveReady(sim.ctx, pids[3]);
    sim.tick();
    expect(match.phase).toBe('countdown');
    const transition = sim.tickCount;
    expect(match.goTick).toBe(transition + MORTAR_OVERDRIVE_COUNTDOWN_TICKS);
    expect(match.deadlineTick).toBe(
      match.goTick + mortarOverdriveCircuitOf(match).timeLimitSeconds * TICK_RATE,
    );
    for (const pid of pids) {
      const readout = lobbyOf(sim, pid);
      expect(readout).toMatchObject({
        phase: 'countdown',
        countdownTicks: MORTAR_OVERDRIVE_COUNTDOWN_TICKS,
      });
      expect(readout.loading).toBeUndefined();
    }
    for (let i = 0; i < MORTAR_OVERDRIVE_COUNTDOWN_TICKS - 1; i++) sim.tick();
    expect(match.phase).toBe('countdown');
    sim.tick();
    expect(match.phase).toBe('racing');
    expect(sim.tickCount).toBe(match.goTick);
    expect(match.progress.get(pids[0])?.lapStartTick).toBe(match.goTick);
  });

  it('starts the countdown at the cap when nobody is ready', () => {
    const { sim, match, seatTick } = seatedGrid();
    for (let i = 0; i < MORTAR_OVERDRIVE_LOADING_MAX_TICKS - 1; i++) sim.tick();
    expect(match.phase).toBe('loading');
    sim.tick();
    expect(match.phase).toBe('countdown');
    expect(sim.tickCount).toBe(seatTick + MORTAR_OVERDRIVE_LOADING_MAX_TICKS);
    expect(match.goTick).toBe(seatTick + MORTAR_OVERDRIVE_LOADING_MAX_TICKS + 180);
    expect(match.deadlineTick).toBe(
      match.goTick + mortarOverdriveCircuitOf(match).timeLimitSeconds * TICK_RATE,
    );
    expect(MORTAR_OVERDRIVE_LOADING_MAX_TICKS).toBe(15 * TICK_RATE);
  });

  it('starts the countdown at the cap with a linkdead pilot still seated, and races on', () => {
    const { sim, pids, match, seatTick } = seatedGrid();
    readyAllRacers(sim);
    stopDisconnectedPlayerInput(sim, pids[2]);
    for (let i = 0; i < MORTAR_OVERDRIVE_LOADING_MAX_TICKS - 1; i++) sim.tick();
    expect(match.phase).toBe('loading');
    sim.tick();
    expect(match.phase).toBe('countdown');
    expect(sim.tickCount).toBe(seatTick + MORTAR_OVERDRIVE_LOADING_MAX_TICKS);
    for (let i = 0; i < MORTAR_OVERDRIVE_COUNTDOWN_TICKS; i++) sim.tick();
    expect(match.phase).toBe('racing');
    // The linkdead pilot is on the grid with everyone else, not retired.
    expect(mortarOverdriveMatchOf(sim.ctx, pids[2])).toBe(match);
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
    sim.startMortarOverdrivePractice('rookie');
    const match = required(mortarOverdriveMatchOf(sim.ctx, human), 'practice');
    expect(match.loadingUntilTick).toBe(seatClock + MORTAR_OVERDRIVE_LOADING_MAX_TICKS);
    let loadingTicks = 0;
    while (match.phase === 'loading') {
      sim.tick();
      if (match.phase === 'loading') loadingTicks++;
    }
    expect(loadingTicks).toBe(MORTAR_OVERDRIVE_LOADING_MAX_TICKS - 1);
    expect(sim.tickCount).toBe(seatClock + MORTAR_OVERDRIVE_LOADING_MAX_TICKS);
    expect(match.goTick).toBe(
      seatClock + MORTAR_OVERDRIVE_LOADING_MAX_TICKS + MORTAR_OVERDRIVE_COUNTDOWN_TICKS,
    );

    // Ready before the first tick: that tick closes the lobby.
    const other = makeWorld();
    const pilot = addAt(other, 'warrior', 'Briar', -5, -40);
    other.tick();
    const clock = other.tickCount;
    other.startMortarOverdrivePractice('rookie');
    other.readyMortarOverdrive();
    other.tick();
    const early = required(mortarOverdriveMatchOf(other.ctx, pilot), 'practice');
    expect(early.phase).toBe('countdown');
    expect(early.goTick).toBe(clock + 1 + MORTAR_OVERDRIVE_COUNTDOWN_TICKS);
  });

  it('ignores a duplicate, a stranger, a pilot of another race, a quitter and a late ready', () => {
    const { sim, pids, match } = seatedGrid();
    const [a, b, c, d] = pids;
    const stranger = addAt(sim, 'warrior', 'Eamon', 0, -46);
    const practiser = addAt(sim, 'mage', 'Fenn', 4, -46);
    sim.mortarOverdrivePracticeStart('rookie', practiser);
    const practice = required(mortarOverdriveMatchOf(sim.ctx, practiser), 'practice');

    mortarOverdriveReady(sim.ctx, a);
    mortarOverdriveReady(sim.ctx, a);
    mortarOverdriveReady(sim.ctx, stranger);
    mortarOverdriveReady(sim.ctx, practiser);
    sim.tick();
    expect(lobbyOf(sim, b).loading?.readyIds).toEqual([a]);
    expect(match.ready.has(stranger)).toBe(false);
    expect(match.ready.has(practiser)).toBe(false);
    // The practiser's ready is theirs, and it closed their own lobby only.
    expect(practice.phase).toBe('countdown');

    sim.mortarOverdriveForfeit(b);
    mortarOverdriveReady(sim.ctx, b);
    expect(match.ready.has(b)).toBe(false);
    // A pilot who quit is no longer waited for: the rest closes the lobby.
    mortarOverdriveReady(sim.ctx, c);
    mortarOverdriveReady(sim.ctx, d);
    sim.tick();
    expect(match.phase).toBe('countdown');
    const goTick = match.goTick;
    mortarOverdriveReady(sim.ctx, a);
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
    expect(mortarOverdriveMatchOf(sim.ctx, pids[1])).toBe(match);
    expect(lobbyOf(sim, pids[0]).loading?.readyIds).toEqual([pids[0], pids[2], pids[3]]);
    mortarOverdriveReady(sim.ctx, pids[1]);
    sim.tick();
    expect(match.phase).toBe('countdown');
  });

  it('seats Practice with the house pilots ready, waiting on the player alone', () => {
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.startMortarOverdrivePractice('rookie');
    sim.tick();
    const match = required(mortarOverdriveMatchOf(sim.ctx, human), 'practice');
    const bots = match.pids.filter((pid) => sim.mortarOverdrive.bots.has(pid));
    expect(bots).toHaveLength(MORTAR_OVERDRIVE_GRID_SIZE - 1);
    expect(match.phase).toBe('loading');
    expect(sim.mortarOverdriveInfo.match?.loading?.readyIds).toEqual(bots);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(match.phase).toBe('loading');

    sim.readyMortarOverdrive();
    sim.tick();
    expect(match.phase).toBe('countdown');
    expect(match.goTick).toBe(sim.tickCount + MORTAR_OVERDRIVE_COUNTDOWN_TICKS);
  });

  it('plays the whole establishing shot from the countdown, then hands back the chase view', () => {
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.startMortarOverdrivePractice('rookie');
    const state = createMortarOverdriveStartCamera();
    const step = () => {
      const facing = required(sim.entities.get(human), 'racer').facing;
      return stepMortarOverdriveStartCamera(
        state,
        mortarOverdriveStartCameraInput(sim.mortarOverdriveInfo.match, facing, facing, 12, false),
      );
    };
    for (let i = 0; i < 30; i++) {
      sim.tick();
      expect(step()).toBeNull();
    }
    sim.readyMortarOverdrive();
    sim.tick();
    expect(sim.mortarOverdriveInfo.match?.countdownTicks).toBe(MORTAR_OVERDRIVE_COUNTDOWN_TICKS);
    const opening = required(step(), 'opening pose');
    expect(opening.dist).toBeGreaterThan(50);
    let released = null as ReturnType<typeof step>;
    for (
      let i = 0;
      i < MORTAR_OVERDRIVE_COUNTDOWN_TICKS + MORTAR_OVERDRIVE_HANDOFF_TICKS + 5;
      i++
    ) {
      sim.tick();
      const pose = step();
      if (sim.mortarOverdriveInfo.match?.phase !== 'racing') {
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

/** Every personal result event a tick batch carries, keyed by pilot. */
function resultsOf(
  events: SimEvent[],
): Map<number, Extract<SimEvent, { type: 'mortarOverdriveResult' }>> {
  const out = new Map<number, Extract<SimEvent, { type: 'mortarOverdriveResult' }>>();
  for (const event of events) {
    if (event.type === 'mortarOverdriveResult') out.set(event.pid as number, event);
  }
  return out;
}

/** Nobody on the grid banked anything from this heat. */
function expectNoCredit(sim: Sim, pids: readonly number[]): void {
  updateDeeds(sim.ctx);
  for (const pid of pids) {
    const meta = required(sim.players.get(pid), `meta ${pid}`);
    expect(meta.mortarOverdriveWins, `mortarOverdriveWins ${pid}`).toBe(0);
    expect(meta.deedsEarned.has('pvp_mortar_overdrive_first_race'), `first race ${pid}`).toBe(
      false,
    );
    expect(meta.deedsEarned.has('pvp_mortar_overdrive_first_win'), `first win ${pid}`).toBe(false);
  }
}

/** A voided heat still sends everyone home on the ordinary tableau clock. */
function expectHomeAfterTableau(sim: Sim, pids: readonly number[]): void {
  for (let i = 0; i < MORTAR_OVERDRIVE_RETURN_TICKS; i++) sim.tick();
  expect(sim.mortarOverdrive.match).toBeNull();
  for (const pid of pids) expect(mortarOverdriveMatchOf(sim.ctx, pid)).toBeNull();
}

describe('Mortar Overdrive race decided before GO is void', () => {
  for (const phase of ['loading', 'countdown'] as const) {
    it(`voids a heat whose field empties in ${phase}, down to two humans then one`, () => {
      const { sim, pids, match } = seatedGrid();
      if (phase === 'countdown') {
        readyAllRacers(sim);
        sim.tick();
      }
      expect(match.phase).toBe(phase);
      const [a, b, c, d] = pids;
      sim.mortarOverdriveForfeit(c);
      sim.mortarOverdriveForfeit(d);
      // Two still running: the race stands.
      expect(match.phase).toBe(phase);
      sim.mortarOverdriveForfeit(b);
      const results = resultsOf(sim.tick());
      expect(match.phase).toBe('finished');
      expect(match.voided).toBe(true);
      expect(match.winnerPid).toBeNull();
      expect(results.get(a)).toMatchObject({ won: false, winnerName: '', voided: true });
      expect(results.get(b)).toMatchObject({ won: false, forfeited: true, voided: true });
      const survivor = lobbyOf(sim, a);
      expect(survivor).toMatchObject({ phase: 'finished', decided: true, result: 'void' });
      expect(lobbyOf(sim, b).result).toBe('forfeit');
      expectNoCredit(sim, pids);
      expectHomeAfterTableau(sim, pids);
    });
  }

  it('counts house pilots as running, but a field of house pilots alone ends the heat void', () => {
    const sim = makeWorld();
    const [a, b] = GRID.slice(0, 2).map((row) => addAt(sim, row.cls, row.name, row.x, row.z));
    const bots = GRID.slice(2).map((row) => {
      const pid = addAt(sim, row.cls, row.name, row.x, row.z);
      sim.mortarOverdrive.bots.set(pid, 'rookie');
      return pid;
    });
    expect(mortarOverdriveStartMatch(sim.ctx, [a, b, ...bots])).toBe(true);
    sim.tick();
    const match = required(sim.mortarOverdrive.match, 'match');
    expect(match.phase).toBe('loading');
    sim.mortarOverdriveForfeit(a);
    sim.tick();
    // One human and two house pilots still running: not decided.
    expect(match.phase).toBe('loading');
    sim.mortarOverdriveForfeit(b);
    const results = resultsOf(sim.tick());
    expect(match.phase).toBe('finished');
    expect(match.voided).toBe(true);
    expect(match.winnerPid).toBeNull();
    expect(results.get(b)).toMatchObject({ won: false, voided: true });
    expectNoCredit(sim, [a, b]);
  });

  it('voids a heat whose last rival is found gone on the exact GO tick, before GO fires', () => {
    const { sim, pids, match } = seatedGrid();
    readyAllRacers(sim);
    sim.tick();
    const [a, b, c, d] = pids;
    sim.mortarOverdriveForfeit(c);
    sim.mortarOverdriveForfeit(d);
    while (sim.tickCount + 1 < match.goTick) sim.tick();
    expect(match.phase).toBe('countdown');
    // Found gone by the roster pass of the GO tick itself, which runs before
    // the countdown arm could turn the phase.
    required(sim.players.get(b), 'meta').leaving = true;
    const events = sim.tick();
    expect(sim.tickCount).toBe(match.goTick);
    expect(events.some((event) => event.type === 'mortarOverdriveGo')).toBe(false);
    expect(match.phase).toBe('finished');
    expect(match.voided).toBe(true);
    expect(match.winnerPid).toBeNull();
    expect(resultsOf(events).get(a)).toMatchObject({ won: false, voided: true });
    expect(lobbyOf(sim, a)).toMatchObject({ voided: true, result: 'void' });
    required(sim.players.get(b), 'meta').leaving = false;
    expectNoCredit(sim, [a, c, d]);
  });

  it('voids a heat when the last human rival disconnects before GO, and sends the survivor home', () => {
    const { sim, pids, match } = seatedGrid();
    const [a, b, c, d] = pids;
    sim.mortarOverdriveForfeit(c);
    sim.mortarOverdriveForfeit(d);
    sim.tick();
    expect(match.phase).toBe('loading');
    sim.removePlayer(b);
    const results = resultsOf(sim.tick());
    expect(match.phase).toBe('finished');
    expect(match.voided).toBe(true);
    expect(match.winnerPid).toBeNull();
    expect(results.get(a)).toMatchObject({ won: false, winnerName: '', voided: true });
    expect(lobbyOf(sim, a)).toMatchObject({ voided: true, result: 'void', decided: true });
    expectNoCredit(sim, [a, c, d]);
    expectHomeAfterTableau(sim, [a, c, d]);
    const survivor = required(sim.entities.get(a), 'survivor');
    expect(survivor.drive).toBeFalsy();
    expect(survivor.mountKey).not.toBe(MORTAR_OVERDRIVE_MOUNT_KEY);
    expect(required(sim.players.get(a), 'meta').mortarOverdriveMatchId).toBeNull();
  });

  it('decides a walkover once the race has started, without banking a win nobody raced for', () => {
    const { sim, pids, match } = seatedGrid();
    readyAllRacers(sim);
    sim.tick();
    for (let i = 0; i < MORTAR_OVERDRIVE_COUNTDOWN_TICKS; i++) sim.tick();
    expect(match.phase).toBe('racing');
    const [a, b, c, d] = pids;
    sim.mortarOverdriveForfeit(b);
    sim.mortarOverdriveForfeit(c);
    sim.mortarOverdriveForfeit(d);
    const results = resultsOf(sim.tick());
    expect(match.phase).toBe('finished');
    expect(match.voided).toBe(false);
    expect(match.winnerPid).toBe(a);
    expect(results.get(a)).toMatchObject({ won: true, voided: false });
    expect(lobbyOf(sim, a)).toMatchObject({ decided: true, result: 'won' });
    // Absent, not false, on a race that ran: an ordinary readout pays no bytes.
    expect('voided' in lobbyOf(sim, a)).toBe(false);
    const meta = required(sim.players.get(a), 'winner');
    // The three who quit after the flag never completed a lap, so none of them
    // is the human rival a win needs (mortar_overdrive/credit.ts): the walkover is
    // decided and not void, but it banks no win.
    expect(meta.mortarOverdriveWins).toBe(0);
    // A walkover is a win, not a crossing: the finish deed waits for the line.
    expect(meta.deedsEarned.has('pvp_mortar_overdrive_first_race')).toBe(false);
    updateDeeds(sim.ctx);
    expect(meta.deedsEarned.has('pvp_mortar_overdrive_first_win')).toBe(false);
  });
});
