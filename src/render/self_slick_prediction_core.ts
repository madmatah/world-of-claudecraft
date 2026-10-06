// The oil, predicted for the local kart: a seated pilot's prediction applies the
// slick grip loss and throw on the predicted tick the server will, instead of
// meeting them one round trip late as a reconcile correction.
//
// Everything that decides it is the race's own code (`realm_racers_slicks.ts`
// for who crosses what, `realm_racers_slick_contact.ts` for what a crossing
// does), fed from what the client already mirrors: the patches on the match
// readout, the race clock beside it, and the pilot's standing with the oil on
// `rdv`. Ticks here are RACE ticks (ticks since GO), the clock both the readout
// and the acknowledgement can be read in. DOM-free and Three-free.
//
// Where the client's inputs differ from the server's, each case is an ordinary
// reconcile replay: the server's other passes that land in the same tick (a
// rival contact, the referee, a recovery that skips the surface pass); a
// rival's patch the client has not seen yet, or one a later drop evicted past
// the cap; patch centres the readout rounds to the hundredth of a yard (a
// crossing within that of the edge, or of the throw's side floor); the pilot's
// eligibility and an own patch's immunity, taken from the newest snapshot
// rather than re-judged on the predicted tick (oil on the finish line, a lock
// ending inside the window, the owner leaving their fresh patch).

import { realmRacersLaneAt, realmRacersLaneOffset } from '../sim/realm_racers_layout';
import {
  applyRallySlickSurface,
  biteRallySlick,
  type RallySlickContact,
  type RallySlickRecon,
  rallySlickCrossing,
} from '../sim/realm_racers_slick_contact';
import {
  type RallySlick,
  type RallySlickRacer,
  REALM_RACERS_SLICK_GRIP,
  REALM_RACERS_SLICK_GRIP_TICKS,
  REALM_RACERS_SLICK_SLIP_CAP,
  stepRealmRacersSlicks,
} from '../sim/realm_racers_slicks';
import type { Aura, Vec3, VehicleDrive } from '../sim/types';
import type { RealmRacersMatchInfo } from '../world_api/realm_racers';

/** A predicted tick's standing with the oil, in race ticks. */
export interface SlickPredictionState extends RallySlickContact {
  /** The race tick the state stands at the end of. */
  raceTick: number;
  /** The surface grip under the oil (band and shock folded in), or null when
   *  the acknowledgement it came from could not give it back exactly. */
  baseGrip: number | null;
  /** The prediction already spent the mirrored ward on a crossing: the mirror
   *  keeps showing it until the server's own spend lands. Never compared. */
  wardSpent: boolean;
}

/** What the step reads of the race, off the newest snapshot. */
export type SlickPredictionMatch = Pick<
  RealmRacersMatchInfo,
  'phase' | 'elapsedTicks' | 'slicks' | 'resetLocked' | 'me'
>;

/** The predicted body the step reads and writes. */
export interface SlickPredictionBody {
  id: number;
  pos: Vec3;
  prevPos: Vec3;
  facing: number;
  auras: readonly Aura[];
  drive?: VehicleDrive | null;
  slick?: SlickPredictionState | null;
}

/** The viewer's own race is running, on a server that sends what the oil is
 *  predicted from (an older one's patches carry no `endsAt`, and its `rdv` no
 *  standing): only then is the oil predicted at all. */
function racing(match: SlickPredictionMatch | null | undefined): match is SlickPredictionMatch {
  if (match?.phase !== 'racing') return false;
  for (const slick of match.slicks) if (!Number.isFinite(slick.endsAt)) return false;
  return true;
}

/**
 * The grip under the oil, from an acknowledged grip that carries it: exact or
 * null. The race multiplies the oil on last (`applyRallySlickSurface`), and every
 * shipped surface factor divides back out to the bit (pinned in the core's
 * tests), so null is a guard, not a path a shipped surface takes.
 */
export function unoiledGrip(gripMult: number): number | null {
  const base = gripMult / REALM_RACERS_SLICK_GRIP;
  // Above the road's grip it was never oiled: a recovery that skipped the
  // surface pass left the window open over a clean grip.
  if (base > 1) return null;
  return base * REALM_RACERS_SLICK_GRIP === gripMult ? base : null;
}

/**
 * The acknowledged standing, or null outside a running race (or before the
 * server sends one).
 *
 * The grip under the oil needs one inference: the surface pass runs BEFORE the
 * crossings in a tick, so an acknowledgement of a bite's own tick (a full grip
 * window left) carries the grip from before the bite. Whether THAT had oil in it
 * is the predicted entry's to say when it agrees on the grip; otherwise the
 * common case is taken (no oil before the bite), and a wrong guess costs the
 * one replay the window's end would have cost anyway.
 */
export function acknowledgedSlickState(
  recon: RallySlickRecon | null | undefined,
  match: SlickPredictionMatch | null | undefined,
  gripMult: number,
  predicted?: { drive?: VehicleDrive | null; slick?: SlickPredictionState | null } | null,
): SlickPredictionState | null {
  if (!recon || !racing(match)) return null;
  const tick = match.elapsedTicks;
  let baseGrip: number | null;
  if (recon.gripLeft === 0) baseGrip = gripMult;
  else if (recon.gripLeft < REALM_RACERS_SLICK_GRIP_TICKS) baseGrip = unoiledGrip(gripMult);
  else if (predicted?.slick && predicted.drive?.gripMult === gripMult)
    baseGrip = predicted.slick.baseGrip;
  else baseGrip = gripMult;
  return {
    raceTick: tick,
    slickGripUntilTick: tick + recon.gripLeft,
    slickContactId: recon.contactId,
    slickContactUntilTick: tick + recon.contactLeft,
    baseGrip,
    wardSpent: false,
  };
}

/**
 * Do two standings agree on everything a later tick reads? Compared in ticks
 * LEFT, so a race clock that drifted against the client ticks never fails a
 * match by itself. A contact is already "none" in both once its patch is gone.
 */
export function sameSlickState(a: SlickPredictionState, b: SlickPredictionState): boolean {
  const aContact =
    a.slickContactId === null ? 0 : Math.max(0, a.slickContactUntilTick - a.raceTick);
  const bContact =
    b.slickContactId === null ? 0 : Math.max(0, b.slickContactUntilTick - b.raceTick);
  return (
    Math.max(0, a.slickGripUntilTick - a.raceTick) ===
      Math.max(0, b.slickGripUntilTick - b.raceTick) &&
    a.slickContactId === b.slickContactId &&
    aContact === bContact
  );
}

export function copySlickState(state: SlickPredictionState): SlickPredictionState {
  return { ...state };
}

/** The ward, read by its own aura kind: the race's ward helper lives in a sim
 *  system module, which the render tree does not import. */
function warded(auras: readonly Aura[]): boolean {
  for (const aura of auras) if (aura.kind === 'rally_ward') return true;
  return false;
}

/**
 * Steps the oil for one predicted tick, after the movement kernel: the surface
 * pass's oil share, then the crossings, in the race's own tick order. Holds the
 * scratch patch list, so a step allocates only what the race's own leaf does.
 */
export class SelfSlickPredictor {
  private readonly patches: RallySlick[] = [];
  private readonly pool: RallySlick[] = [];
  private readonly racer: RallySlickRacer = {
    pid: 0,
    fromX: 0,
    fromZ: 0,
    toX: 0,
    toZ: 0,
    eligible: false,
  };
  private readonly racers: RallySlickRacer[] = [this.racer];

  step(body: SlickPredictionBody, match: SlickPredictionMatch | null | undefined): void {
    const slick = body.slick;
    const drive = body.drive;
    if (!slick || !drive) return;
    if (!racing(match)) {
      body.slick = null;
      return;
    }
    const tick = slick.raceTick + 1;
    slick.raceTick = tick;
    if (!warded(body.auras)) slick.wardSpent = false;
    const slicked = tick < slick.slickGripUntilTick;
    if (slick.baseGrip !== null) applyRallySlickSurface(drive, slick.baseGrip, slicked);
    else drive.slipCap = slicked ? REALM_RACERS_SLICK_SLIP_CAP : 1;
    const lane = realmRacersLaneAt(body.pos.x, body.pos.z);
    const patches = this.livePatches(match, tick);
    if (lane && patches.length > 0) this.cross(body, slick, drive, match, lane.index, tick);
    if (slick.slickContactId !== null && !this.standing(slick.slickContactId)) {
      slick.slickContactId = null;
      slick.slickContactUntilTick = tick;
    }
  }

  private cross(
    body: SlickPredictionBody,
    slick: SlickPredictionState,
    drive: VehicleDrive,
    match: SlickPredictionMatch,
    laneIndex: number,
    tick: number,
  ): void {
    const origin = realmRacersLaneOffset(laneIndex);
    const racer = this.racer;
    racer.pid = body.id;
    racer.fromX = body.prevPos.x - origin.x;
    racer.fromZ = body.prevPos.z - origin.z;
    racer.toX = body.pos.x - origin.x;
    racer.toZ = body.pos.z - origin.z;
    racer.eligible = !match.me.finished && !match.me.retired && !match.resetLocked;
    const hit = stepRealmRacersSlicks(this.patches, { tick, racers: this.racers }).hits[0];
    if (!hit) return;
    const remembered =
      slick.slickContactId !== null && slick.slickContactId !== hit.slick
        ? this.patches.find((patch) => patch.id === slick.slickContactId)
        : undefined;
    if (!rallySlickCrossing(slick, hit, tick, remembered, racer.toX, racer.toZ)) return;
    if (!slick.wardSpent && warded(body.auras)) {
      slick.wardSpent = true;
      return;
    }
    biteRallySlick(
      slick,
      drive,
      tick,
      { pid: body.id, facing: body.facing, x: racer.toX, z: racer.toZ },
      hit,
    );
  }

  /** The patches standing at the end of `tick`, as the race's leaf reads them. */
  private livePatches(match: SlickPredictionMatch, tick: number): RallySlick[] {
    const patches = this.patches;
    patches.length = 0;
    for (const info of match.slicks) {
      if (tick >= info.endsAt) continue;
      let patch = this.pool[patches.length];
      if (!patch) {
        patch = { id: 0, x: 0, z: 0, ownerPid: 0, ownerClear: true, expiresTick: 0 };
        this.pool.push(patch);
      }
      patch.id = info.id;
      patch.x = info.x;
      patch.z = info.z;
      patch.ownerPid = info.immunePid ?? -1;
      patch.ownerClear = info.immunePid === undefined;
      patch.expiresTick = info.endsAt;
      patches.push(patch);
    }
    return patches;
  }

  private standing(id: number): boolean {
    for (const patch of this.patches) if (patch.id === id) return true;
    return false;
  }
}
