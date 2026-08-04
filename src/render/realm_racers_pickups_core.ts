// What a pickup box LOOKS like at this instant: present or gone, mid spawn or
// mid pop, how big, how far turned, how high it floats.
//
// The whole decision half of `realm_racers_pickups.ts` (the Three half), kept
// here so a Vitest drives it with no renderer. It reads one input, the set of
// boxes the race says are TAKEN, and turns the two transitions of that set into
// the two animations a player reads: a box entering it POPS, a box leaving it
// grows back.
//
// Nothing here is authoritative about anything. A box's position comes from the
// sim's own resolver (`src/sim/realm_racers_pickups.ts`) and whether it is there
// comes off the match readout; this only decides how the change is shown, so it
// may be as cosmetic as it likes.
//
// It also owns the box's one COLOUR, which is deliberately NOT a theme entry.
// Every other surface a circuit wears comes from `realm_racers_themes.ts` so a
// zone can look like itself, and race FURNITURE is the exemption: a pickup box
// has to read as a pickup box on the first lap of a circuit a player has never
// seen, in a zone whose palette nobody chose for it. The same reasoning the
// start lights already follow. One constant, in both the forms its two readers
// need (the renderer's material and the editor plan's canvas strings), because
// two literals of one colour is how the plan and the game stop agreeing.
//
// Pure core: no three, no DOM, no i18n, no clock of its own (time and dt are
// arguments).

/** The box's body colour, as the renderer's material wants it. Race furniture,
 *  so it is the same in every zone: see the header. */
export const REALM_RACERS_PICKUP_COLOR = 0xf2c14a;
/** The same colour as a canvas string, for the editor plan. */
export const REALM_RACERS_PICKUP_COLOR_CSS = '#f2c14a';
/** And its translucent fill, for a plan that draws the box as a footprint. */
export const REALM_RACERS_PICKUP_FILL_CSS = 'rgba(242, 193, 74, 0.35)';

/** A box's live animation state. `gone` and `present` are the two resting
 *  states; the other two are the transitions between them. */
export type RallyPickupPhase = 'present' | 'spawning' | 'popping' | 'gone';

export interface RallyPickupVisual {
  phase: RallyPickupPhase;
  /** Seconds into the current transition; 0 in either resting state. */
  t: number;
}

/** How long a box takes to grow back after a respawn, seconds. */
export const RALLY_PICKUP_SPAWN_SECONDS = 0.45;
/** How long the take pop lasts, seconds. Short: it is a confirmation, not a
 *  cutscene, and the pilot who set it off is already past it. */
export const RALLY_PICKUP_POP_SECONDS = 0.28;
/** How far the pop swells before it vanishes, as a fraction of the box. */
const POP_SWELL = 0.7;
/** Overshoot of the spawn's ease-out, so a box arrives with a bounce. */
const SPAWN_OVERSHOOT = 1.7;
/** Idle spin, radians per second. */
const SPIN_RATE = 1.1;
/** Idle bob, yards each way, and its rate. */
const BOB_YARDS = 0.12;
const BOB_RATE = 1.6;
/** Phase offset per box, radians, so a row does not pulse as one object. */
const PHASE_PER_BOX = 0.7;

/** The state a box starts in, which is what a fresh view is built at: no
 *  transition to play, because nobody saw the moment before it. */
export function rallyPickupInitialVisual(taken: boolean): RallyPickupVisual {
  return { phase: taken ? 'gone' : 'present', t: 0 };
}

/**
 * One box, one frame.
 *
 * Returns a NEW state rather than mutating, so a caller may hold the previous
 * one to decide whether anything has to be written at all.
 */
export function stepRallyPickupVisual(
  visual: RallyPickupVisual,
  taken: boolean,
  dt: number,
): RallyPickupVisual {
  const step = Math.max(0, dt);
  switch (visual.phase) {
    case 'present':
      return taken ? { phase: 'popping', t: 0 } : visual;
    case 'gone':
      return taken ? visual : { phase: 'spawning', t: 0 };
    case 'popping': {
      // A box taken again mid pop is not a case a race can produce (it is
      // already gone), but a box put BACK mid pop is: the leader crossing the
      // line on the same tick a straggler took one. The spawn wins, from where
      // the pop got to, so nothing ever finishes an animation about a state it
      // is no longer in.
      if (!taken) return { phase: 'spawning', t: 0 };
      const t = visual.t + step;
      return t >= RALLY_PICKUP_POP_SECONDS ? { phase: 'gone', t: 0 } : { phase: 'popping', t };
    }
    default: {
      if (taken) return { phase: 'popping', t: 0 };
      const t = visual.t + step;
      return t >= RALLY_PICKUP_SPAWN_SECONDS
        ? { phase: 'present', t: 0 }
        : { phase: 'spawning', t };
    }
  }
}

/** Whether the box is drawn at all this frame. */
export function rallyPickupVisible(visual: RallyPickupVisual): boolean {
  return visual.phase !== 'gone';
}

/**
 * The box's scale, 1 at rest and 0 when it is gone.
 *
 * The pop swells before it disappears, which is what makes a take read as
 * something the machine DID rather than as a box that stopped being drawn.
 */
export function rallyPickupScale(visual: RallyPickupVisual): number {
  switch (visual.phase) {
    case 'present':
      return 1;
    case 'gone':
      return 0;
    case 'popping': {
      const u = Math.min(1, visual.t / RALLY_PICKUP_POP_SECONDS);
      // Swell then collapse: the sine puts the peak in the middle of the pop
      // and the cube takes it to nothing exactly at the end.
      return (1 + POP_SWELL * Math.sin(Math.PI * u)) * (1 - u ** 3);
    }
    default: {
      const u = Math.min(1, visual.t / RALLY_PICKUP_SPAWN_SECONDS);
      // Ease out with an overshoot: it passes 1, then settles back onto it.
      const back = u - 1;
      return 1 + back * back * ((SPAWN_OVERSHOOT + 1) * back + SPAWN_OVERSHOOT);
    }
  }
}

/** How far the box has turned about its own vertical axis, radians. */
export function rallyPickupSpin(time: number, index: number): number {
  return time * SPIN_RATE + index * PHASE_PER_BOX;
}

/** How high the box floats above its resting height this frame, yards. */
export function rallyPickupLift(time: number, index: number): number {
  return Math.sin(time * BOB_RATE + index * PHASE_PER_BOX) * BOB_YARDS;
}

/**
 * Whether two taken-index lists say the same thing.
 *
 * The readout hands the same short array shape every frame, so a painter that
 * rebuilt its membership set per frame would allocate through a whole race for
 * a list that changes a handful of times a lap. Order is significant because
 * the producer emits ascending indices and nothing else may.
 */
export function rallyPickupTakenSame(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
