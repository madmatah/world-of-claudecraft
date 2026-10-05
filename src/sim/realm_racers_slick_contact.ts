// What a slick does to ONE machine that drove into it: whether a hit starts a
// new crossing, the grip window and throw a crossing hands out, and the oil's
// share of the surface pass.
//
// Shared by the race (`social/realm_racers.ts`, `tickSlicks` and the surface
// pass) and the online client's own-kart prediction
// (`src/render/self_slick_prediction_core.ts`), so a predicted slide runs the
// server's own arithmetic (the client's inputs differ only where its mirror
// does: see that module's header). Pure and deterministic: no SimContext, no rng (the
// throw's last-resort direction is the stateless hash in `realm_racers_slicks`).
// The ward that can eat a crossing stays with the race, which owns the auras.

import { vehicleProfile } from './content/vehicles';
import {
  type RallySlick,
  type RallySlickHit,
  REALM_RACERS_SLICK_GRIP,
  REALM_RACERS_SLICK_GRIP_TICKS,
  REALM_RACERS_SLICK_SLIP_CAP,
  rallySlickContains,
  realmRacersSlickThrow,
} from './realm_racers_slicks';
import type { VehicleDrive } from './types';
import { addVehicleSlip, vehicleMaxSlip } from './vehicle_motion';

/**
 * One machine's standing with the oil, in ticks of whichever clock the caller
 * runs (the race's tick count, or the prediction's race tick). The race's
 * per-racer progress carries exactly these fields.
 */
export interface RallySlickContact {
  /** The patch this machine's current or last crossing is in, by id. */
  slickContactId: number | null;
  /** The crossing of that patch stays one crossing until this tick. */
  slickContactUntilTick: number;
  /** The grip loss lasts until this tick. */
  slickGripUntilTick: number;
}

/**
 * Is this hit a NEW crossing? Mutates `contact`.
 *
 * Contact with the oil is resolved ONCE per crossing, not once per tick spent in
 * the puddle: a machine crosses a patch over two or three ticks, and
 * re-resolving it every one of them would announce twenty times a second and
 * eat a ward the tick after it had already saved the pilot.
 * The deadline follows THIS patch's contact, resolved or not, so it can only
 * lapse once the machine is out of THAT oil. Two halves, both load-bearing:
 * letting it lapse underneath a machine still sitting in a patch threw a
 * stopped pilot again every window for the whole twelve seconds the patch
 * lives (harmless while a crossing only cost grip, a fresh shove once one
 * moved the machine), and keying it to the patch rather than to the racer is
 * what stops lingering in one slick from buying a free pass through the next
 * one down the road. The GRIP window deliberately does NOT follow the
 * contact: it expires on its own clock, or a machine that stopped in the oil
 * would never get the grip back to drive out of it.
 * Overlapping patches are one crossing while the machine has not LEFT the
 * remembered one: two rivals oiling the same corner overlap, the nearest
 * patch flips across the equidistance line every wobble, and each flip
 * used to read as a fresh crossing (a throw and an announcement per flip).
 * The remembered patch is kept until the machine is really out of it.
 *
 * `remembered` is the patch `contact` remembers when it still stands, and
 * `x`/`z` where the machine ended the tick, in the patches' frame.
 */
export function rallySlickCrossing(
  contact: RallySlickContact,
  hit: RallySlickHit,
  tick: number,
  remembered: RallySlick | null | undefined,
  x: number,
  z: number,
): boolean {
  if (
    contact.slickContactId !== null &&
    contact.slickContactId !== hit.slick &&
    remembered &&
    rallySlickContains(remembered, x, z)
  ) {
    contact.slickContactUntilTick = tick + REALM_RACERS_SLICK_GRIP_TICKS;
    return false;
  }
  const resolves = contact.slickContactId !== hit.slick || tick >= contact.slickContactUntilTick;
  contact.slickContactId = hit.slick;
  contact.slickContactUntilTick = tick + REALM_RACERS_SLICK_GRIP_TICKS;
  return resolves;
}

/** The crossing machine, in the patches' frame (`facing` is frame-free). */
export interface RallySlickBitePose {
  pid: number;
  facing: number;
  x: number;
  z: number;
}

/**
 * The bite of a new crossing the ward did not eat: the grip window opens, and
 * the oil throws the machine. Returns how hard (0 to 1), 0 for a machine that
 * was not thrown and must not announce it.
 *
 * The shove is the half of a slick that does not depend on what the machine was
 * doing when it arrived. The grip loss is the other half and they are written to
 * work together: this takes the machine off the line it was on, and the missing
 * grip is why it cannot gather it back up.
 */
export function biteRallySlick(
  contact: RallySlickContact,
  drive: VehicleDrive | null | undefined,
  tick: number,
  pose: RallySlickBitePose,
  hit: RallySlickHit,
): number {
  contact.slickGripUntilTick = tick + REALM_RACERS_SLICK_GRIP_TICKS;
  if (!drive) return 0;
  const profile = vehicleProfile(drive.profileKey);
  const thrown = realmRacersSlickThrow({
    slip: drive.slip,
    forwardSpeed: drive.speed,
    topSpeed: profile.maxSpeed,
    facing: pose.facing,
    x: pose.x,
    z: pose.z,
    slickX: hit.x,
    slickZ: hit.z,
    slickId: hit.slick,
    pid: pose.pid,
  });
  if (thrown.strength <= 0) return 0;
  // The ceiling is raised HERE rather than waited for, exactly as the nitro
  // raises its own: the surface pass runs earlier in this same tick, so a
  // shove that clamped against the tarmac ceiling first would be cut to what
  // the road allows and the raise would arrive a tick after the moment it was
  // granted for.
  drive.slipCap = REALM_RACERS_SLICK_SLIP_CAP;
  addVehicleSlip(drive, thrown.push, vehicleMaxSlip(profile, drive));
  return thrown.strength;
}

/**
 * The oil's share of the surface pass: the grip under it, and how far sideways
 * the machine may travel. `baseGrip` is every other surface factor already
 * multiplied in (the band, a Ground Blast shock); the oil goes on last, which is
 * what lets the prediction take it back off an acknowledged grip exactly.
 */
export function applyRallySlickSurface(
  drive: VehicleDrive,
  baseGrip: number,
  slicked: boolean,
): void {
  drive.gripMult = slicked ? baseGrip * REALM_RACERS_SLICK_GRIP : baseGrip;
  drive.slipCap = slicked ? REALM_RACERS_SLICK_SLIP_CAP : 1;
}

/**
 * A contact as it stands at the end of `tick`, in ticks LEFT rather than the
 * clock's own ticks: what the server sends its pilot (`rdv`) and what the
 * client's prediction compares an acknowledgement against. A crossing is
 * remembered only while its patch still stands (in `standing`), the one case
 * where the id can still decide a later hit; otherwise both contact fields read
 * as no contact, the same state the race would act on.
 */
export interface RallySlickRecon {
  gripLeft: number;
  contactId: number | null;
  contactLeft: number;
}

export function rallySlickRecon(
  contact: RallySlickContact,
  tick: number,
  standing: readonly { id: number }[],
): RallySlickRecon {
  let contactId: number | null = null;
  if (contact.slickContactId !== null) {
    for (const slick of standing) if (slick.id === contact.slickContactId) contactId = slick.id;
  }
  return {
    gripLeft: Math.max(0, contact.slickGripUntilTick - tick),
    contactId,
    contactLeft: contactId === null ? 0 : Math.max(0, contact.slickContactUntilTick - tick),
  };
}
