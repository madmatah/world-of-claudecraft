// What an oil slick LOOKS like at this instant: spreading, sitting there, or
// soaking away, how wide, how dark, and how far its sheen has turned.
//
// The decision half of `realm_racers_slicks.ts`, kept here so a Vitest drives it
// with no renderer. It reads one input, the patches the race says are on the
// road, and turns the two transitions of that list into the two animations a
// player reads: a patch appearing SPREADS, a patch whose lifetime ran out soaks
// away rather than blinking out from under a machine.
//
// Nothing here is authoritative. Where a slick is and whether it is still there
// come off the match readout, which is the same field on both worlds; this only
// decides how the change is shown.
//
// FAIRNESS, and it is the reason this module reads no tier and no governor: a
// slick is actionable information (a pilot steers around it), so it is drawn the
// same on every graphics preset. The knobs here are the SHAPE of an appearance,
// never whether one happens, and the opacity floor below is what keeps the patch
// legible rather than tasteful.
//
// Pure core: no three, no DOM, no i18n, no clock of its own (time and dt are
// arguments). The one import is the sim's own pure hazard data, the same
// sanctioned edge the pickup boxes' renderer takes.

import { REALM_RACERS_SLICK_CAP } from '../sim/realm_racers_slicks';

/** The oil's own colour, as the renderer's material wants it: near black with a
 *  bruise in it, so it reads as a spill on any of the circuit themes rather than
 *  as a shadow. */
export const REALM_RACERS_SLICK_COLOR = 0x14101c;
/** The sheen turning slowly on top of it, which is what says WET. */
export const REALM_RACERS_SLICK_SHEEN_COLOR = 0x6f5bd6;

/**
 * A patch is drawn at FULL radius from the first frame it exists, so there is
 * deliberately no spread window here.
 *
 * The sim can report a grip loss for a slick on the very tick it appears, and a
 * disk still growing toward its real radius would be a hazard drawn smaller than
 * it bites: a pilot who steered around the edge they could see would lose grip
 * anyway. What animates instead is the SHEEN, which says wet without ever
 * claiming an edge.
 */
/** How long it takes to soak away once its lifetime is up, seconds. */
export const RALLY_SLICK_FADE_SECONDS = 0.6;
/** Opacity of a patch sitting on the road. High on purpose: see FAIRNESS. */
export const RALLY_SLICK_OPACITY = 0.85;
/** Turns per second of the sheen ring, radians per second. */
const SHEEN_RATE = 0.55;
/** Phase offset per patch, radians, so two slicks are never one object. */
const PHASE_PER_SLICK = 1.3;

/**
 * How many patches one circuit draws at once.
 *
 * Read off the SIM's own cap rather than chosen here, which is what makes "what
 * bites is what you can see" structural: the race evicts its oldest patch past
 * `REALM_RACERS_SLICK_CAP`, so a pool at least that big can never be the reason
 * a hazard goes undrawn. (The sim-side constant carries the arithmetic it is
 * sized off; `tests/realm_racers_render.test.ts` pins the >= relationship.)
 *
 * It is a fixed cost either way: the pool is minted at build time and its slots
 * are recycled, so a pathological race costs no meshes beyond it.
 */
export const RALLY_SLICK_POOL = REALM_RACERS_SLICK_CAP;

export type RallySlickPhase = 'present' | 'fading' | 'gone';

export interface RallySlickVisual {
  phase: RallySlickPhase;
  /** Seconds into the current transition; 0 in either resting state. */
  t: number;
}

/** The state a patch is born in: fully there. See the note on the spread above. */
export function rallySlickInitialVisual(): RallySlickVisual {
  return { phase: 'present', t: 0 };
}

/**
 * One patch, one frame.
 *
 * Returns a NEW state rather than mutating, except in the two resting phases
 * where it hands back the SAME object: the painter decides whether anything has
 * to be written by comparing what came back with what it held.
 */
export function stepRallySlickVisual(
  visual: RallySlickVisual,
  present: boolean,
  dt: number,
): RallySlickVisual {
  const step = Math.max(0, dt);
  switch (visual.phase) {
    case 'present':
      return present ? visual : { phase: 'fading', t: 0 };
    case 'gone':
      return present ? { phase: 'present', t: 0 } : visual;
    default: {
      // A patch cannot come back (an id is spent when its slick expires), but a
      // race that ended and restarted on the same circuit can hand the same id
      // to a new one. Being there wins outright, at full radius, from wherever
      // the soak had got to.
      if (present) return { phase: 'present', t: 0 };
      const t = visual.t + step;
      return t >= RALLY_SLICK_FADE_SECONDS ? { phase: 'gone', t: 0 } : { phase: 'fading', t };
    }
  }
}

/** Whether the patch is drawn at all this frame. */
export function rallySlickVisible(visual: RallySlickVisual): boolean {
  return visual.phase !== 'gone';
}

/**
 * The patch's radius as a fraction of the sim's own catch radius.
 *
 * EXACTLY 1 for every frame the race can still report a hit on this patch, which
 * is the fairness half of the module: the drawn edge is the edge that bites. The
 * only movement is the soak-away, and that runs solely AFTER the race has taken
 * the patch off the road, where there is nothing left to be wrong about.
 *
 * It is a scale rather than an opacity ease because the track group's dispose
 * contract (`realm_racers_track_dispose_core.ts`) rests on one material per
 * build rather than one per piece, and per-patch opacity would need the latter.
 */
export function rallySlickScale(visual: RallySlickVisual): number {
  switch (visual.phase) {
    case 'present':
      return 1;
    case 'gone':
      return 0;
    default:
      return Math.max(0, 1 - visual.t / RALLY_SLICK_FADE_SECONDS);
  }
}

/** How far this patch's sheen has turned, radians. */
export function rallySlickSheenSpin(time: number, id: number): number {
  return time * SHEEN_RATE + id * PHASE_PER_SLICK;
}

/**
 * Whether two slick lists say the same thing.
 *
 * Ids only, in order: the readout rebuilds the array every snapshot and a
 * painter that re-keyed its pool per frame would allocate through a whole race
 * for a list that changes a handful of times a lap. Positions never move once a
 * patch is down, so an id match is a full match.
 */
export function rallySlickListSame(
  a: readonly { id: number }[],
  b: readonly { id: number }[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
  }
  return true;
}

/**
 * A NEW server patch this close to the provisional one is the same drop
 * arriving on the readout. Wide, because the server lays the patch under ITS
 * pose, which trails the display by the uplink at race speed (a handful of
 * yards, more on a bad link); wide is safe because only an id that was NOT on
 * the road at drop time can adopt, so the false-adoption case needs a rival
 * dropping a brand-new patch this close within the timeout.
 */
export const RALLY_PROVISIONAL_SLICK_MATCH_RADIUS = 12;
/** A provisional patch whose real one never arrived was a refused cast (or a
 *  painful link); past this it quietly vanishes. */
export const RALLY_PROVISIONAL_SLICK_TIMEOUT_SEC = 1.5;

export type RallyProvisionalSlickState = 'shown' | 'adopted' | 'expired';

/**
 * The provisional patch the local pilot's own drop paints IMMEDIATELY, before
 * the readout's round trip: what should it do this frame? It shows until the
 * server's patch lands nearby (adopted: the real one takes the road over,
 * same frame, same look, so the handoff is invisible) or until the timeout
 * says the cast never happened.
 *
 * `knownIds` is the set of patch ids already on the road when the drop was
 * painted. Only an id OUTSIDE it may adopt: oil clusters (a hairpin everyone
 * slicks, the dropper's own previous lap), and a pre-existing patch nearby
 * would otherwise adopt on the very first frame, silently turning the feature
 * off exactly where it is most wanted.
 */
export function rallyProvisionalSlickState(
  list: readonly { id: number; x: number; z: number }[],
  knownIds: ReadonlySet<number>,
  x: number,
  z: number,
  ageSec: number,
): RallyProvisionalSlickState {
  for (const slick of list) {
    if (knownIds.has(slick.id)) continue;
    const dx = slick.x - x;
    const dz = slick.z - z;
    if (
      dx * dx + dz * dz <
      RALLY_PROVISIONAL_SLICK_MATCH_RADIUS * RALLY_PROVISIONAL_SLICK_MATCH_RADIUS
    ) {
      return 'adopted';
    }
  }
  return ageSec > RALLY_PROVISIONAL_SLICK_TIMEOUT_SEC ? 'expired' : 'shown';
}

/** How long the provisional patch takes to shrink away once the real one has
 *  the road (or the timeout fired): long enough to read as a settle rather
 *  than a swap, short enough that two patches never linger. */
export const RALLY_PROVISIONAL_SLICK_FADE_SEC = 0.2;
