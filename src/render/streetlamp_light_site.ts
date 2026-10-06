// What light a streetlamp FIXTURE casts, wherever one stands.
//
// It was the road network's alone until a circuit could be dressed with the
// same fixtures: a lamp on a verge out in the instance band has to light the
// track exactly as a lamp on a road lights the road, or the two read as
// different objects that happen to share a model. So the numbers and the anchor
// arithmetic live here, with `streetlamps.ts` (the world's network) and
// `mortar_overdrive/lamps.ts` (a circuit's dressing) as the two consumers.
//
// A render pure core: no Three, no DOM. The anchor is plain trigonometry over
// the fixture's own AUTHORED socket, which is the load-bearing part: the light
// leaves the lantern rather than the foot of the post, so a hanging fixture
// lights the ground it reaches over.

import type { NightLightSite } from './night_light_field_core';

/**
 * How far one lamp's contribution reaches, in yards, and how bright it is.
 *
 * The cutoff is the REACH knob and the intensity is the BRIGHTNESS knob, and
 * they are deliberately turned separately: with decay-2 falloff the level under
 * the lamp is set by 1/d^2 at four yards, which the cutoff barely touches, while
 * the cutoff window is what strangles the tail. Widening the cutoff carries
 * lamplight further down the road without touching the pool underneath.
 *
 * Both were raised when the draped pools were removed (the field carries the
 * ground alone now) and again when the palette dropped to a true ~1800K flame
 * amber, which carries far less luminance per unit intensity than the pale
 * amber before it.
 */
export const LAMP_FIELD_RADIUS = 48;
export const LAMP_FIELD_INTENSITY = 205;
/** A glassed lantern wavers gently, so the authored source and the ground
 *  breathe together without introducing fixture-to-fixture differences. */
export const LAMP_FIELD_FLICKER = 0.1;

/**
 * The draped ground pool, for the ONE tier that cannot have the real thing.
 *
 * The Lambert tier compiles no standard splat material for the night light
 * field to splice, so a lamp there would light nothing at all. The sprite is the
 * artificial half of the old lighting (a flat radial disc that ignores the
 * surface it lies on), kept only where the alternative is an unlit road, and
 * kept for a CIRCUIT for a sharper reason: a race authored at a dark hour is
 * dark on every tier, so the tier that cannot be given real lamplight has to be
 * given the painted kind rather than the darkness alone.
 */
export const LAMP_POOL_RADIUS = 6.5;
export const LAMP_POOL_OPACITY = 0.5;

/**
 * How a lantern flame breathes: two slow out-of-phase sines, never a strobe.
 *
 * Shared because the FIXTURES are shared: a circuit's lamps and the road's are
 * the same prepared assets, so if the two drove their authored emissive on
 * different curves the pair would visibly beat against each other wherever both
 * are on screen.
 */
export function lampFlameBreath(time: number): number {
  return 1 + Math.sin(time * 5.7) * 0.05 + Math.sin(time * 1.9) * 0.04;
}

/** Where a fixture's light actually leaves it, in world space: its authored
 *  socket, swung onto the yaw the fixture is turned to. */
export function streetlampLightAnchor(
  x: number,
  y: number,
  z: number,
  yaw: number,
  socket: readonly [number, number, number],
): { x: number; y: number; z: number } {
  const [ox, oy, oz] = socket;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: x + ox * c + oz * s, y: y + oy, z: z - ox * s + oz * c };
}

/** One fixture's entry in the night light field: its anchor, its style's own
 *  flame colour, and the shared reach, brightness and waver. */
export function streetlampLightSite(
  x: number,
  y: number,
  z: number,
  yaw: number,
  socket: readonly [number, number, number],
  fieldColor: readonly [number, number, number],
): NightLightSite {
  return {
    ...streetlampLightAnchor(x, y, z, yaw, socket),
    radius: LAMP_FIELD_RADIUS,
    r: fieldColor[0],
    g: fieldColor[1],
    b: fieldColor[2],
    intensity: LAMP_FIELD_INTENSITY,
    flicker: LAMP_FIELD_FLICKER,
  };
}
