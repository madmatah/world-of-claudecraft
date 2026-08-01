// Pure view model for The Realm Racers queue window, its practice setup
// screen, and the in-race HUD.

import type { RallyDriverTier, RealmRacersInfo } from '../world_api';

/**
 * The difficulty tiers the practice setup offers, hardest last. Spelled here
 * rather than imported from the sim so the view stays a leaf over `IWorld`; the
 * order is the one the player reads, and each entry is a wire value the seam
 * accepts.
 */
export const RALLY_PRACTICE_TIERS: readonly RallyDriverTier[] = ['rookie', 'driver', 'ace'];

/** The tier a player who has expressed no preference races. The middle one: a
 *  first practice lap should be a race, not a walkover and not a wall. */
export const RALLY_DEFAULT_PRACTICE_TIER: RallyDriverTier = 'driver';

/**
 * The controls the setup screen teaches, in the order a pilot needs them. Each
 * is a stable id the painter maps to BOTH its copy and the player's own key
 * binding, so a rebound key is taught as the key the player actually has.
 *
 * DRIVING only. The weapon is deliberately absent: it is one button with an
 * obvious effect, it is discovered in the first race without being told, and
 * the roster is heading for one weapon per machine and then for weapons picked
 * up off the circuit, so a screen that names a specific one starts going stale
 * the day the second machine lands.
 */
export const RALLY_CONTROL_ACTIONS = ['throttle', 'brake', 'steer', 'handbrake'] as const;
export type RallyControlAction = (typeof RALLY_CONTROL_ACTIONS)[number];

/** One taught control: what it does, and which keys do it right now. `keys` is
 *  empty on a touch HUD, where there are no keys to name. */
export interface RallyControlRow {
  action: RallyControlAction;
  keys: readonly string[];
}

export interface RealmRacersSetupView {
  tiers: readonly { tier: RallyDriverTier; selected: boolean }[];
  controls: readonly RallyControlRow[];
  /** True on a touch HUD: the key column is meaningless there, so the screen
   *  teaches the on-screen controls in one line instead. */
  touch: boolean;
  /** False when the realm has handed out every practice copy of the circuit. */
  available: boolean;
  sig: string;
}

export type RealmRacersWindowView =
  | { kind: 'idle'; queueSize: number; practiceAvailable: boolean; sig: string }
  | {
      kind: 'queued';
      position: number;
      queueSize: number;
      practiceAvailable: boolean;
      sig: string;
    }
  | {
      kind: 'match';
      opponent: string;
      /** Set when the opponent is a house pilot: a practice lap is not a win
       *  over a player, and the window says so rather than implying one. */
      opponentBotTier: RallyDriverTier | null;
      practice: boolean;
      phase: 'countdown' | 'racing' | 'finished';
      lap: number;
      position: 1 | 2;
      result: 'won' | 'lost' | 'draw' | 'forfeit' | null;
      sig: string;
    };

export interface RealmRacersHudView {
  active: boolean;
  phase: 'countdown' | 'racing' | 'finished';
  countdown: number;
  lap: number;
  totalLaps: number;
  position: 1 | 2;
  elapsed: number;
  speed: number;
  wrongWay: boolean;
  opponent: string;
  opponentBotTier: RallyDriverTier | null;
  result: 'won' | 'lost' | 'draw' | 'forfeit' | null;
  returnIn: number;
  /**
   * Whether the strip offers its own forfeit control. The queue window closes
   * itself the moment a match starts, so the strip is the only in-race surface
   * that can carry it. False once the race is decided: there is nothing left to
   * forfeit through the return countdown.
   */
  canForfeit: boolean;
  /** Manual recovery to the latest spline anchor, only while the flag is live. */
  canReset: boolean;
  resetLocked: boolean;
  sig: string;
}

const HUD_OFF: RealmRacersHudView = {
  active: false,
  phase: 'countdown',
  countdown: 0,
  lap: 1,
  totalLaps: 0,
  position: 1,
  elapsed: 0,
  speed: 0,
  wrongWay: false,
  opponent: '',
  opponentBotTier: null,
  result: null,
  returnIn: 0,
  canForfeit: false,
  canReset: false,
  resetLocked: false,
  sig: 'off',
};

export function buildRealmRacersWindowView(info: RealmRacersInfo): RealmRacersWindowView {
  const match = info.match;
  if (match) {
    return {
      kind: 'match',
      opponent: match.opponent.name,
      opponentBotTier: match.opponent.botTier,
      practice: match.practice,
      phase: match.phase,
      lap: match.me.lap,
      position: match.position,
      result: match.result,
      sig: `match|${match.id}|${match.phase}|${match.me.lap}|${match.position}|${match.result ?? '-'}|${match.opponent.botTier ?? '-'}|${match.practice ? 'p' : 'r'}`,
    };
  }
  const open = info.practiceAvailable;
  if (info.queued) {
    return {
      kind: 'queued',
      position: info.queuePosition,
      queueSize: info.queueSize,
      practiceAvailable: open,
      sig: `queued|${info.queuePosition}|${info.queueSize}|${open ? 'open' : 'full'}`,
    };
  }
  return {
    kind: 'idle',
    queueSize: info.queueSize,
    practiceAvailable: open,
    sig: `idle|${info.queueSize}|${open ? 'open' : 'full'}`,
  };
}

/**
 * The practice setup screen: pick a rival, read the controls, drop the flag.
 * It exists so the countdown is not the first time a player meets the machine;
 * by the time the flag falls they have already been told what every control
 * does, in the keys they personally have bound.
 */
export function buildRealmRacersSetupView(
  info: RealmRacersInfo,
  selected: RallyDriverTier,
  keysFor: (action: RallyControlAction) => readonly string[],
  touch: boolean,
): RealmRacersSetupView {
  const controls = RALLY_CONTROL_ACTIONS.map((action) => ({
    action,
    keys: touch ? [] : keysFor(action),
  }));
  // The keys ride the signature: rebinding a control while the screen is open
  // has to repaint it, and no other input to this view would have moved.
  const keySig = controls.map((row) => row.keys.join('/')).join(',');
  return {
    tiers: RALLY_PRACTICE_TIERS.map((tier) => ({ tier, selected: tier === selected })),
    controls,
    touch,
    available: info.practiceAvailable,
    sig: `setup|${selected}|${info.practiceAvailable ? 'open' : 'full'}|${touch ? 't' : 'k'}|${keySig}`,
  };
}

export function buildRealmRacersHudView(info: RealmRacersInfo): RealmRacersHudView {
  const match = info.match;
  if (!match) return HUD_OFF;
  const canForfeit = match.phase !== 'finished';
  const canReset = match.phase === 'racing';
  return {
    active: true,
    phase: match.phase,
    countdown: match.countdown,
    lap: match.me.lap,
    totalLaps: match.totalLaps,
    position: match.position,
    elapsed: match.elapsed,
    speed: match.speed,
    wrongWay: match.wrongWay,
    opponent: match.opponent.name,
    opponentBotTier: match.opponent.botTier,
    result: match.result,
    returnIn: match.returnIn,
    canForfeit,
    canReset,
    resetLocked: match.resetLocked,
    // Lock state is a live button property, not structure: keeping it out of
    // the signature preserves keyboard focus when the reset becomes disabled.
    sig: `${match.id}|${match.opponent.pid}|${match.opponent.botTier ?? '-'}|${canForfeit ? 'quit' : 'done'}|${canReset ? 'reset' : 'no-reset'}`,
  };
}
