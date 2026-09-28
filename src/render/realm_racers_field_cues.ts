// The things that happen ON the circuit's surface, presented: a machine thrown
// by oil, a rival laying a patch, a box the viewer was racing for taken by
// someone else. The renderer hands each of these events here and owns none of
// the logic (the decisions are the Three-free cores beside this file).
//
// Every one is display-only. The patch and the box stay exactly where the
// server resolved them; the spray and the "missed" cue only say what happened
// to them, in the frame the viewer draws rivals in.

import * as THREE from 'three';
import type { SimEvent } from '../sim/types';
import type { IWorld } from '../world_api';
import { playRealmRacersEventAudio, type RealmRacersRuntimeAudioSink } from './realm_racers_audio';
import {
  type RallyContestKart,
  type RallySeenSelf,
  rallyContestKart,
  rallyPickupMissed,
} from './realm_racers_missed_pickup_core';
import { RealmRacersOilSprayVisuals } from './realm_racers_oil_spray';
import {
  RALLY_OIL_SPRAY_LIFT_YD,
  type RallyOilSprayPath,
  rallyOilSprayPath,
} from './realm_racers_oil_spray_core';
import type { RealmRacersPrepare } from './realm_racers_prepare';
import { REALM_RACERS_SLICK_SHEEN_COLOR } from './realm_racers_slicks_core';
import type { RemoteVehicleDisplayState } from './remote_vehicle_display_core';
import type { Vfx } from './vfx';

/** The fizzle a missed box leaves: a dim, cool sputter where it stood, in
 *  place of the take the viewer did not get. */
export const RALLY_MISSED_PICKUP_COLOR = 0x8f8aa3;
const MISSED_LIFT_YD = 1;
const MISSED_PARTICLES = 12;
const MISSED_POWER = 0.55;
const MISSED_SECONDS = 0.45;

export type RallyFieldCueWorld = Pick<IWorld, 'playerId' | 'player' | 'realmRacersInfo'>;
export type RallyFieldCueVfx = Pick<Vfx, 'burst' | 'groundPuff'>;
type RallyFieldCueViews = ReadonlyMap<
  number,
  { remoteVehicle: Readonly<RemoteVehicleDisplayState> }
>;

export class RealmRacersFieldCues {
  /** The spray pool: a race preparation client, attached to the scene by the
   *  renderer like the Ground Blast pool. */
  readonly sprays = new RealmRacersOilSprayVisuals();
  private readonly at = new THREE.Vector3();
  private readonly path: RallyOilSprayPath = { fromX: 0, fromZ: 0, toX: 0, toZ: 0 };
  private readonly kart: RallyContestKart = { x: 0, z: 0, velocityX: 0, velocityZ: 0 };
  private prepare: Pick<RealmRacersPrepare, 'reason'> | null = null;

  constructor(
    private readonly views: RallyFieldCueViews,
    private readonly ground: (x: number, z: number) => number,
  ) {}

  /** Register the spray pool with the race preparation seam, and read from it
   *  whether the viewer has committed to racing. */
  joinPrepare(seam: Pick<RealmRacersPrepare, 'reason' | 'addClient'>): void {
    seam.addClient(this.sprays);
    this.prepare = seam;
  }

  onEvent(
    ev: SimEvent,
    world: RallyFieldCueWorld,
    vfx: RallyFieldCueVfx,
    audio: RealmRacersRuntimeAudioSink | null,
    seen: RallySeenSelf,
  ): void {
    switch (ev.type) {
      case 'realmRacersSlicked':
        // Oil letting go, in the world: a puff off the tyres in the patch's own
        // sheen colour (so what threw the machine is legible from the car that
        // is about to arrive) plus the scrape cue. No HUD line, same as a bump:
        // this is a driving event and the banner belongs to the moments that
        // stop a race.
        //
        // And deliberately NO camera shake, unlike every other rally impact. A
        // shell or a contact is a JOLT: the machine keeps pointing where it
        // pointed, so without a shake nothing says a moment happened. Oil is not
        // a jolt, it is the road leaving: the machine keeps its heading (the
        // throw moves the velocity and never the yaw) and slides out from under
        // the nose, which the world already shows. A shake on top reads as the
        // picture coming apart rather than as force. An earlier build DID spin
        // the machine here and the seat verdict was that it felt like the wheel
        // being yanked, so restoring either one means reckoning with that.
        vfx.groundPuff(
          new THREE.Vector3(ev.x, this.ground(ev.x, ev.z), ev.z),
          0.9 + ev.impact,
          REALM_RACERS_SLICK_SHEEN_COLOR,
        );
        playRealmRacersEventAudio(audio, this.ground, ev);
        return;
      case 'realmRacersSlickDropped': {
        // The viewer's own drop has no spray: its patch is already painted
        // under the drawn machine (the provisional slick drop).
        // A viewer who never committed to racing has no prepared pool, and a
        // spray is not worth a program linked on a live frame: the patch still
        // appears, from the readout.
        if (!this.sprays.built && (this.prepare?.reason ?? null) === null) return;
        const path = rallyOilSprayPath(this.views, ev, world.playerId, this.path);
        if (!path) return;
        this.sprays.spray(
          path,
          this.ground(path.fromX, path.fromZ) + RALLY_OIL_SPRAY_LIFT_YD,
          this.ground(path.toX, path.toZ),
        );
        return;
      }
      case 'realmRacersPickupTaken': {
        const kart = rallyContestKart(world, seen, this.kart);
        if (!rallyPickupMissed(world.playerId, kart, ev.takerId, ev.x, ev.z)) return;
        this.at.set(ev.x, this.ground(ev.x, ev.z) + MISSED_LIFT_YD, ev.z);
        vfx.burst(
          this.at,
          'shadow',
          MISSED_PARTICLES,
          MISSED_POWER,
          RALLY_MISSED_PICKUP_COLOR,
          MISSED_SECONDS,
        );
        return;
      }
      default:
        return;
    }
  }

  update(dt: number): void {
    this.sprays.update(dt);
  }

  dispose(): void {
    this.sprays.dispose();
  }
}
