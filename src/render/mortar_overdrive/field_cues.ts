// The things that happen ON the circuit's surface, presented: a machine thrown
// by oil, a rival laying a patch, a box the viewer was racing for taken by
// someone else. The renderer hands each of these events here and owns none of
// the logic (the decisions are the Three-free cores beside this file).
//
// Every one is display-only. The patch and the box stay exactly where the
// server resolved them; the spray and the "missed" cue only say what happened
// to them, in the frame the viewer draws rivals in.

import * as THREE from 'three';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import type { RemoteVehicleDisplayState } from '../remote_vehicle_display_core';
import type { Vfx } from '../vfx';
import { type MortarOverdriveRuntimeAudioSink, playMortarOverdriveEventAudio } from './audio';
import {
  type MortarOverdriveContestKart,
  type MortarOverdriveSeenSelf,
  mortarOverdriveContestKart,
  mortarOverdrivePickupMissed,
} from './missed_pickup_core';
import { MortarOverdriveOilSprayVisuals } from './oil_spray';
import {
  MORTAR_OVERDRIVE_OIL_SPRAY_LIFT_YD,
  type MortarOverdriveOilSprayPath,
  mortarOverdriveOilSprayPath,
} from './oil_spray_core';
import type { MortarOverdrivePrepare } from './prepare';
import { MORTAR_OVERDRIVE_SLICK_SHEEN_COLOR } from './slicks_core';

/** The fizzle a missed box leaves: a dim, cool sputter where it stood, in
 *  place of the take the viewer did not get. */
export const MORTAR_OVERDRIVE_MISSED_PICKUP_COLOR = 0x8f8aa3;
const MISSED_LIFT_YD = 1;
const MISSED_PARTICLES = 12;
const MISSED_POWER = 0.55;
const MISSED_SECONDS = 0.45;

export type MortarOverdriveFieldCueWorld = Pick<
  IWorld,
  'playerId' | 'player' | 'mortarOverdriveInfo'
>;
export type MortarOverdriveFieldCueVfx = Pick<Vfx, 'burst' | 'groundPuff'>;
type MortarOverdriveFieldCueViews = ReadonlyMap<
  number,
  { remoteVehicle: Readonly<RemoteVehicleDisplayState> }
>;

export class MortarOverdriveFieldCues {
  /** The spray pool: a race preparation client, attached to the scene by the
   *  renderer like the Ground Blast pool. */
  readonly sprays = new MortarOverdriveOilSprayVisuals();
  private readonly at = new THREE.Vector3();
  private readonly path: MortarOverdriveOilSprayPath = { fromX: 0, fromZ: 0, toX: 0, toZ: 0 };
  private readonly kart: MortarOverdriveContestKart = { x: 0, z: 0, velocityX: 0, velocityZ: 0 };
  private prepare: Pick<MortarOverdrivePrepare, 'reason'> | null = null;

  constructor(
    private readonly views: MortarOverdriveFieldCueViews,
    private readonly ground: (x: number, z: number) => number,
  ) {}

  /** Register the spray pool with the race preparation seam, and read from it
   *  whether the viewer has committed to racing. */
  joinPrepare(seam: Pick<MortarOverdrivePrepare, 'reason' | 'addClient'>): void {
    seam.addClient(this.sprays);
    this.prepare = seam;
  }

  onEvent(
    ev: SimEvent,
    world: MortarOverdriveFieldCueWorld,
    vfx: MortarOverdriveFieldCueVfx,
    audio: MortarOverdriveRuntimeAudioSink | null,
    seen: MortarOverdriveSeenSelf,
  ): void {
    switch (ev.type) {
      case 'mortarOverdriveSlicked':
        // Oil letting go, in the world: a puff off the tyres in the patch's own
        // sheen colour (so what threw the machine is legible from the car that
        // is about to arrive) plus the scrape cue. No HUD line, same as a bump:
        // this is a driving event and the banner belongs to the moments that
        // stop a race.
        //
        // And deliberately NO camera shake, unlike every other Mortar Overdrive impact. A
        // shell or a contact is a JOLT: the machine keeps pointing where it
        // pointed, so without a shake nothing says a moment happened. Oil is not
        // a jolt, it is the road leaving: the machine keeps its heading (the
        // throw moves the velocity and never the yaw) and slides out from under
        // the nose, which the world already shows. A shake on top reads as the
        // picture coming apart rather than as force. An earlier build DID spin
        // the machine here and the seat verdict was that it felt like the wheel
        // being yanked, so restoring either one means reckoning with that.
        vfx.groundPuff(
          this.at.set(ev.x, this.ground(ev.x, ev.z), ev.z),
          0.9 + ev.impact,
          MORTAR_OVERDRIVE_SLICK_SHEEN_COLOR,
        );
        playMortarOverdriveEventAudio(audio, this.ground, ev);
        return;
      case 'mortarOverdriveSlickDropped': {
        // The viewer's own drop has no spray: its patch is already painted
        // under the drawn machine (the provisional slick drop).
        // A viewer who never committed to racing has no prepared pool, and a
        // spray is not worth a program linked on a live frame: the patch still
        // appears, from the readout.
        if (!this.sprays.built && (this.prepare?.reason ?? null) === null) return;
        const path = mortarOverdriveOilSprayPath(this.views, ev, world.playerId, this.path);
        if (!path) return;
        this.sprays.spray(
          path,
          this.ground(path.fromX, path.fromZ) + MORTAR_OVERDRIVE_OIL_SPRAY_LIFT_YD,
          this.ground(path.toX, path.toZ),
        );
        return;
      }
      case 'mortarOverdrivePickupTaken': {
        const kart = mortarOverdriveContestKart(world, seen, this.kart);
        if (!mortarOverdrivePickupMissed(world.playerId, kart, ev.takerId, ev.x, ev.z)) return;
        this.at.set(ev.x, this.ground(ev.x, ev.z) + MISSED_LIFT_YD, ev.z);
        vfx.burst(
          this.at,
          'shadow',
          MISSED_PARTICLES,
          MISSED_POWER,
          MORTAR_OVERDRIVE_MISSED_PICKUP_COLOR,
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
