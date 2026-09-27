// Pure view model for The Realm Racers queue window, its practice setup
// screen, and the in-race HUD.

import { REALM_RACERS_PRACTICE_CIRCUIT_ID } from '../sim/content/realm_racers_circuits';
import type {
  RallyDriverTier,
  RealmRacersInfo,
  RealmRacersPhase,
  RealmRacersResult,
} from '../world_api';

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

/**
 * The keybind names behind each taught control, spelled beside
 * RALLY_CONTROL_ACTIONS so the taught list and the binds that teach it cannot
 * drift apart. Steering is two bindings by nature; the rest resolve one.
 */
const RALLY_CONTROL_BINDS: Record<RallyControlAction, readonly string[]> = {
  throttle: ['forward'],
  brake: ['back'],
  steer: ['turnLeft', 'turnRight'],
  handbrake: ['jump'],
};

/**
 * The bound keys behind one taught rally control, as display labels.
 * `primaryLabel` is the host's keybind lookup (Hud passes
 * `Keybinds.primaryLabel`), so a player who drives on the arrow keys is taught
 * the arrow keys; an unbound control contributes no label rather than an empty
 * keycap.
 */
export function rallyControlKeys(
  action: RallyControlAction,
  primaryLabel: (bind: string) => string,
): string[] {
  const labels: string[] = [];
  for (const bind of RALLY_CONTROL_BINDS[action]) {
    const label = primaryLabel(bind);
    if (label) labels.push(label);
  }
  return labels;
}

/** One taught control: what it does, and which keys do it right now. `keys` is
 *  empty on a touch HUD, where there are no keys to name. */
export interface RallyControlRow {
  action: RallyControlAction;
  keys: readonly string[];
}

export interface RealmRacersSetupView {
  tiers: readonly { tier: RallyDriverTier; selected: boolean }[];
  controls: readonly RallyControlRow[];
  /**
   * Which circuit a practice lap runs, always the practice circuit. It is a
   * constant rather than a live value because practice never draws: naming it
   * here is what makes the pool's trade honest, since the circuit a player
   * learns on is one they will never race competitively.
   */
  circuitId: string;
  /** True on a touch HUD: the key column is meaningless there, so the screen
   *  teaches the on-screen controls in one line instead. */
  touch: boolean;
  /** False when the realm has handed out every practice copy of the circuit. */
  available: boolean;
  sig: string;
}

export type RealmRacersWindowView =
  | {
      kind: 'idle';
      queueSize: number;
      practiceAvailable: boolean;
      /** False where the queue can never seat a race (the offline world): the
       *  join button is disabled and the window points at Practice instead. */
      queueViable: boolean;
      sig: string;
    }
  | {
      kind: 'queued';
      position: number;
      queueSize: number;
      practiceAvailable: boolean;
      queueViable: boolean;
      sig: string;
    }
  | {
      kind: 'match';
      /** True when the whole field is house pilots: a practice lap is not a win
       *  over players, and the window says so rather than implying one. */
      practice: boolean;
      phase: RealmRacersPhase;
      /** Live placing and the frozen grid size: "3 of 4", never "second". */
      position: number;
      gridSize: number;
      result: RealmRacersResult;
      sig: string;
    };

export interface RealmRacersHudView {
  active: boolean;
  /**
   * The circuit this race is on, as a record id. Competition DRAWS it when the
   * grid fills, so the strip names it through the countdown: the player has to
   * be told what they got before the flag drops. Carried as the id, never the
   * name, because this view is i18n-free.
   */
  circuitId: string;
  phase: RealmRacersPhase;
  countdown: number;
  lap: number;
  totalLaps: number;
  position: number;
  gridSize: number;
  elapsed: number;
  speed: number;
  wrongWay: boolean;
  /**
   * The track-limits banner, resolved to ONE line here rather than in the
   * painter: two alarms cannot both be the loudest thing on screen, and a pilot
   * who has just been returned for cutting is on the road again, so a loiter
   * countdown and a cut notice can never legitimately co-occur.
   */
  trackLimit: 'none' | 'offTrack' | 'cutReturned';
  /** Seconds left before the off-track reset; only read for `offTrack`. */
  offTrackIn: number;
  /**
   * Whether the viewer is carrying a ward: the one-shot buff that eats the next
   * Ground Blast or patch of oil. A pip on the strip rather than only the FCT
   * that announced it, because a shield a pilot cannot see is a shield they
   * cannot plan around. Out of the signature (like `resetLocked`): it toggles
   * mid-race and must not rebuild the strip.
   */
  warded: boolean;
  /** Seconds left in the winner's chase window, 0 when it is not running. */
  chaseIn: number;
  /** Whether the RACE is over, which is when the podium takes the headline. */
  decided: boolean;
  voided: boolean;
  result: RealmRacersResult;
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
  circuitId: '',
  phase: 'countdown',
  countdown: 0,
  lap: 1,
  totalLaps: 0,
  position: 1,
  gridSize: 0,
  elapsed: 0,
  speed: 0,
  wrongWay: false,
  trackLimit: 'none',
  offTrackIn: 0,
  warded: false,
  chaseIn: 0,
  decided: false,
  voided: false,
  result: null,
  returnIn: 0,
  canForfeit: false,
  canReset: false,
  resetLocked: false,
  sig: 'off',
};

/**
 * The one LIVE strip container, mutated in place every frame (the
 * allocation-light per-frame contract, src/ui/CLAUDE.md: this view is built
 * from `RealmRacersUi.update()` each frame of a race, so a fresh object per
 * call is per-frame garbage). Every field is a primitive, so mutation carries
 * no identity hazard; a caller reads the frame's values before the next build,
 * which the synchronous paint in `RealmRacersUi.renderHud` does.
 */
const HUD_LIVE: RealmRacersHudView = { ...HUD_OFF };

export function buildRealmRacersWindowView(info: RealmRacersInfo): RealmRacersWindowView {
  const match = info.match;
  if (match) {
    return {
      kind: 'match',
      practice: match.practice,
      phase: match.phase,
      position: match.me.position,
      gridSize: match.gridSize,
      result: match.voided ? 'void' : match.result,
      // The lap is deliberately absent, from the view AND from the signature:
      // the window never displays it (the strip does), so carrying it here only
      // rebuilt the whole queue window once per lap for a number nobody saw.
      sig: `match|${match.id}|${match.phase}|${match.me.position}|${match.gridSize}|${match.result ?? '-'}|${match.practice ? 'p' : 'r'}`,
    };
  }
  const open = info.practiceAvailable;
  const viable = info.queueViable;
  if (info.queued) {
    return {
      kind: 'queued',
      position: info.queuePosition,
      queueSize: info.queueSize,
      practiceAvailable: open,
      queueViable: viable,
      sig: `queued|${info.queuePosition}|${info.queueSize}|${open ? 'open' : 'full'}|${viable ? 'q' : 'nq'}`,
    };
  }
  return {
    kind: 'idle',
    queueSize: info.queueSize,
    practiceAvailable: open,
    queueViable: viable,
    sig: `idle|${info.queueSize}|${open ? 'open' : 'full'}|${viable ? 'q' : 'nq'}`,
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
    // Out of the signature deliberately: it is a build-time constant, so it can
    // never move on its own and adding it would only be noise.
    circuitId: REALM_RACERS_PRACTICE_CIRCUIT_ID,
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
  const view = HUD_LIVE;
  view.active = true;
  view.circuitId = match.circuitId;
  view.phase = match.phase;
  view.countdown = match.countdown;
  view.lap = match.me.lap;
  view.totalLaps = match.totalLaps;
  view.position = match.me.position;
  view.gridSize = match.gridSize;
  view.elapsed = match.elapsed;
  view.speed = match.speed;
  view.wrongWay = match.wrongWay;
  // The countdown wins over the notice: one is about to happen TO the pilot,
  // the other has already happened and is only being explained.
  view.trackLimit = match.offTrackIn > 0 ? 'offTrack' : match.cutReturned ? 'cutReturned' : 'none';
  view.offTrackIn = match.offTrackIn;
  view.warded = match.warded;
  view.chaseIn = match.chaseIn;
  view.decided = match.decided;
  view.voided = match.voided === true;
  view.result = match.result;
  view.returnIn = match.returnIn;
  view.canForfeit = canForfeit;
  view.canReset = canReset;
  view.resetLocked = match.resetLocked;
  // Lock state is a live button property, not structure: keeping it out of
  // the signature preserves keyboard focus when the reset becomes disabled.
  // The live placing is out for the same reason it is out of the standings
  // signature: it moves under a close race and the readout row writes it
  // through the elided writers anyway.
  view.sig = `${match.id}|${match.gridSize}|${canForfeit ? 'quit' : 'done'}|${canReset ? 'reset' : 'no-reset'}`;
  return view;
}
