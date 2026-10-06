import { describe, expect, it } from 'vitest';
import {
  CONTACT_KICK_MARGIN_TICKS,
  CONTACT_KICK_MAX_DV,
  CONTACT_KICK_MAX_SHIFT_YD,
  type ContactKickBody,
  contactKickDue,
  contactKickRivalShift,
  createContactKick,
  foldContactKickHandoff,
  growContactKick,
  resetContactKick,
  retireContactKick,
  startContactKick,
  startContactKickAt,
} from '../src/render/realm_racers_contact_kick_core';
import { REMOTE_VEHICLE_SNAP_DIST } from '../src/render/remote_vehicle_display_core';
import {
  createSelfRenderPositionState,
  displayedAimPose,
  noteSelfIdentity,
  type ReconciledSelfPrediction,
  type SelfRenderPositionState,
  updateSelfRenderPosition,
} from '../src/render/self_render_position_core';
import { vehicleProfile } from '../src/sim/content/vehicles';
import { REALM_RACERS_VEHICLE_KEY } from '../src/sim/social/realm_racers';
import type { Entity } from '../src/sim/types';
import { resolveVehicleContact } from '../src/sim/vehicle_contact';
import { createVehicleDrive, vehicleVelocityX, vehicleVelocityZ } from '../src/sim/vehicle_motion';

const PROFILE = vehicleProfile(REALM_RACERS_VEHICLE_KEY);
const RIVAL = 7;
const TOUCH = 100;
const START_ACK = 96;

/** The local kart at `speed` yd/s up +z into a parked rival 3 yd ahead. */
function bodies(speed = 30): { self: ContactKickBody; rival: ContactKickBody } {
  const selfDrive = createVehicleDrive(REALM_RACERS_VEHICLE_KEY);
  selfDrive.speed = speed;
  return {
    self: {
      x: 0,
      z: 0,
      facing: 0,
      drive: selfDrive,
      radius: PROFILE.bodyRadius,
      mass: PROFILE.mass,
    },
    rival: {
      x: 0.4,
      z: 3,
      facing: 0,
      drive: createVehicleDrive(REALM_RACERS_VEHICLE_KEY),
      radius: PROFILE.bodyRadius,
      mass: PROFILE.mass,
    },
  };
}

describe('the bump drawn at the seen touch', () => {
  it("takes each machine's velocity change from the sim's own contact resolver, touching neither", () => {
    const { self, rival } = bodies(12);
    const selfBefore = structuredClone(self);
    const rivalBefore = structuredClone(rival);
    const kick = createContactKick();
    expect(startContactKick(kick, self, rival, RIVAL, START_ACK, TOUCH)).toBe(true);
    expect(self).toEqual(selfBefore);
    expect(rival).toEqual(rivalBefore);
    const a = structuredClone(self);
    const b = structuredClone(rival);
    resolveVehicleContact(a, b);
    expect(kick.selfVx).toBe(vehicleVelocityX(a.drive, 0) - vehicleVelocityX(self.drive, 0));
    expect(kick.selfVz).toBe(vehicleVelocityZ(a.drive, 0) - vehicleVelocityZ(self.drive, 0));
    expect(kick.rivalVz).toBe(vehicleVelocityZ(b.drive, 0) - vehicleVelocityZ(rival.drive, 0));
    expect(kick.selfVz).toBeLessThan(0);
    expect(kick.rivalVz).toBeGreaterThan(0);
    expect([kick.rivalId, kick.touchTick]).toEqual([RIVAL, TOUCH]);
  });

  it('caps the velocity change and the drawn shift, below the rival snap distance', () => {
    expect(CONTACT_KICK_MAX_SHIFT_YD * 2).toBeLessThanOrEqual(REMOTE_VEHICLE_SNAP_DIST);
    const { self, rival } = bodies(60);
    const kick = createContactKick();
    startContactKick(kick, self, rival, RIVAL, START_ACK, TOUCH);
    expect(Math.hypot(kick.selfVx, kick.selfVz)).toBeCloseTo(CONTACT_KICK_MAX_DV, 9);
    for (let i = 0; i < 60; i++) growContactKick(kick, 1 / 60);
    expect(Math.hypot(kick.selfX, kick.selfZ)).toBeCloseTo(CONTACT_KICK_MAX_SHIFT_YD, 9);
    expect(Math.hypot(kick.rivalX, kick.rivalZ)).toBeLessThanOrEqual(
      CONTACT_KICK_MAX_SHIFT_YD + 1e-9,
    );
  });

  it('starts nothing for a pair that is not closing, or while another kick runs', () => {
    const parted = bodies(-5);
    const kick = createContactKick();
    expect(startContactKick(kick, parted.self, parted.rival, RIVAL, START_ACK, TOUCH)).toBe(false);
    const { self, rival } = bodies();
    expect(startContactKick(kick, self, rival, RIVAL, START_ACK, TOUCH)).toBe(true);
    expect(startContactKick(kick, self, rival, RIVAL + 1, START_ACK, TOUCH)).toBe(false);
    expect(kick.rivalId).toBe(RIVAL);
    // Nor over a handoff still waiting to fold into its rival.
    retireContactKick(kick);
    expect(startContactKick(kick, self, rival, RIVAL + 1, START_ACK, TOUCH)).toBe(false);
    foldContactKickHandoff(kick, RIVAL, { x: 0, z: 0 });
    expect(startContactKick(kick, self, rival, RIVAL + 1, START_ACK, TOUCH)).toBe(true);
  });

  it('starts at the predicted head: the acknowledged tick plus the tick offset', () => {
    const { self, rival } = bodies();
    const kick = createContactKick();
    expect(startContactKickAt(kick, self, rival, RIVAL, 96, 4)).toBe(true);
    expect([kick.startAck, kick.touchTick]).toEqual([96, 100]);
  });

  it('grows exactly with time, whatever the frame rate', () => {
    for (const fps of [20, 30, 60, 144]) {
      const { self, rival } = bodies();
      const kick = createContactKick();
      startContactKick(kick, self, rival, RIVAL, START_ACK, TOUCH);
      const frames = Math.ceil(fps / 10);
      for (let i = 0; i < frames; i++) growContactKick(kick, 1 / fps);
      expect(kick.selfZ).toBeCloseTo((kick.selfVz * frames) / fps, 9);
      expect(kick.rivalZ).toBeCloseTo((kick.rivalVz * frames) / fps, 9);
    }
  });

  it('is due on any replay past the touch frame, early contacts included, or past the margin', () => {
    const { self, rival } = bodies();
    const kick = createContactKick();
    startContactKick(kick, self, rival, RIVAL, START_ACK, TOUCH);
    expect(contactKickDue(kick, START_ACK, true)).toBe(false);
    // The server met the rival two ticks before the drawn touch.
    expect(contactKickDue(kick, START_ACK + 1, true)).toBe(true);
    expect(contactKickDue(kick, TOUCH + CONTACT_KICK_MARGIN_TICKS - 1, false)).toBe(false);
    expect(contactKickDue(kick, TOUCH + CONTACT_KICK_MARGIN_TICKS, false)).toBe(true);
    expect(contactKickDue(createContactKick(), TOUCH + 9, true)).toBe(false);
  });

  it("hands the rival shift to that rival's next projection step, once; a reset drops it", () => {
    const { self, rival } = bodies();
    const kick = createContactKick();
    startContactKick(kick, self, rival, RIVAL, START_ACK, TOUCH);
    growContactKick(kick, 0.05);
    const live = { x: 0, z: 0 };
    expect(contactKickRivalShift(kick, RIVAL + 1, live)).toBe(false);
    expect(contactKickRivalShift(kick, RIVAL, live)).toBe(true);
    retireContactKick(kick);
    expect([kick.rivalId, kick.selfX, kick.selfZ]).toEqual([-1, 0, 0]);
    expect(contactKickRivalShift(kick, RIVAL, { x: 0, z: 0 })).toBe(false);
    const drawn = { x: 1, z: 2 };
    expect(foldContactKickHandoff(kick, RIVAL + 1, drawn)).toBe(false);
    expect(foldContactKickHandoff(kick, RIVAL, drawn)).toBe(true);
    expect(drawn).toEqual({ x: 1 + live.x, z: 2 + live.z });
    expect(foldContactKickHandoff(kick, RIVAL, drawn)).toBe(false);
    startContactKick(kick, self, rival, RIVAL, START_ACK, TOUCH);
    growContactKick(kick, 0.05);
    retireContactKick(kick);
    resetContactKick(kick);
    expect(foldContactKickHandoff(kick, RIVAL, drawn)).toBe(false);
  });
});

describe('the drawn bump as a term of the self display', () => {
  const kart = {
    prevPos: { x: 0, y: 0, z: 0 },
    pos: { x: 0, y: 0, z: 0 },
    prevFacing: 0,
    facing: 0,
    vy: 0,
    onGround: true,
    auras: [],
    ghost: false,
    drive: createVehicleDrive(REALM_RACERS_VEHICLE_KEY),
  } as unknown as Entity;

  /** A predicted kart cruising +z at 30 yd/s, its head `offset` ticks over
   *  the ack. */
  function frame(
    tMs: number,
    ackTick: number,
    residualZ: number | null = null,
  ): ReconciledSelfPrediction {
    return {
      kind: 'reconciled',
      position: { x: 0, y: 0, z: 30 * (tMs / 1000) },
      residual: residualZ === null ? null : { x: 0, y: 0, z: residualZ },
      drive: {
        facing: 0,
        velocityX: 0,
        velocityZ: 30,
        onGround: true,
        state: createVehicleDrive(REALM_RACERS_VEHICLE_KEY),
      },
      tickOffset: 4,
      tickAlpha: 0.5,
      ackTick,
    };
  }

  function kicked(state: SelfRenderPositionState): void {
    const { self, rival } = bodies(12);
    expect(startContactKick(state.contactKick, self, rival, RIVAL, START_ACK, TOUCH)).toBe(true);
  }

  it('draws the whole shift, exactly, at 20, 30, 60 and 144 fps', () => {
    for (const fps of [20, 30, 60, 144]) {
      const state = createSelfRenderPositionState();
      const dt = 1 / fps;
      updateSelfRenderPosition(state, kart, 1, 1, dt, 0, frame(0, 90), false);
      kicked(state);
      const vz = state.contactKick.selfVz;
      let t = 0;
      for (let i = 0; i < fps / 10; i++) {
        t += dt;
        updateSelfRenderPosition(state, kart, 1, 1, dt, 0, frame(t * 1000, 90), false);
      }
      expect(state.position.z - 30 * t).toBeCloseTo(vz * t, 9);
      // Never in the pose a command is aimed from.
      const aim = displayedAimPose(state, 0, { pos: { x: 0, y: 0, z: 0 }, facing: 0 });
      expect(aim?.pos.z).toBeCloseTo(30 * t, 9);
    }
  });

  it('a replayed contact cancels it: no step on the frame the acknowledgement lands', () => {
    const state = createSelfRenderPositionState();
    const dt = 1 / 60;
    updateSelfRenderPosition(state, kart, 1, 1, dt, 0, frame(0, 96), false);
    kicked(state);
    let t = 0;
    for (let i = 0; i < 9; i++) {
      t += dt;
      updateSelfRenderPosition(state, kart, 1, 1, dt, 0, frame(t * 1000, 97), false);
    }
    const shift = state.contactKick.selfZ;
    const before = state.position.z;
    // The server's contact, replayed: the predicted head jumps by exactly the
    // drawn shift (residual = old head minus new head).
    t += dt;
    const replay = frame(t * 1000, TOUCH);
    replay.position.z += shift;
    updateSelfRenderPosition(
      state,
      kart,
      1,
      1,
      dt,
      0,
      { ...replay, residual: { x: 0, y: 0, z: -shift } },
      false,
    );
    expect(state.contactKick.rivalId).toBe(-1);
    // One frame of cruise, nothing else: the shift and the residual met.
    expect(state.position.z - before).toBeCloseTo(30 * dt, 9);
    expect(state.offset.z).toBeCloseTo(0, 9);
  });

  it('a touch the server never had glides back out after the margin, continuously', () => {
    const state = createSelfRenderPositionState();
    const dt = 1 / 60;
    updateSelfRenderPosition(state, kart, 1, 1, dt, 0, frame(0, 96), false);
    kicked(state);
    let t = 0;
    for (let i = 0; i < 9; i++) {
      t += dt;
      updateSelfRenderPosition(state, kart, 1, 1, dt, 0, frame(t * 1000, 99), false);
    }
    const shift = state.position.z - 30 * t;
    expect(shift).toBeLessThan(0);
    t += dt;
    updateSelfRenderPosition(
      state,
      kart,
      1,
      1,
      dt,
      0,
      frame(t * 1000, TOUCH + CONTACT_KICK_MARGIN_TICKS),
      false,
    );
    expect(state.contactKick.rivalId).toBe(-1);
    // Handed to the offset and decaying: no jump, then gone.
    const after = state.position.z - 30 * t;
    expect(Math.abs(after - shift)).toBeLessThan(Math.abs(shift) * 0.25);
    for (let i = 0; i < 60; i++) {
      t += dt;
      updateSelfRenderPosition(state, kart, 1, 1, dt, 0, frame(t * 1000, 120), false);
    }
    expect(state.position.z - 30 * t).toBeCloseTo(0, 3);
  });

  it('a teleport drops the self shift and lets the rival glide on', () => {
    const state = createSelfRenderPositionState();
    updateSelfRenderPosition(state, kart, 1, 1, 1 / 60, 0, frame(0, 96), false);
    kicked(state);
    updateSelfRenderPosition(state, kart, 1, 1, 1 / 60, 0, frame(16, 96), false);
    updateSelfRenderPosition(state, kart, 1, 1, 1 / 60, 0, frame(32, 96), true);
    expect(state.contactKick.rivalId).toBe(-1);
    expect(state.contactKick.handoffRivalId).toBe(RIVAL);
    expect(state.position.z).toBeCloseTo(30 * 0.032, 9);
    // A rival not drawn by the next frame lets the handoff go.
    updateSelfRenderPosition(state, kart, 1, 1, 1 / 60, 0, frame(48, 96), false);
    expect(state.contactKick.handoffRivalId).toBe(RIVAL);
    updateSelfRenderPosition(state, kart, 1, 1, 1 / 60, 0, frame(64, 96), false);
    expect(state.contactKick.handoffRivalId).toBe(-1);
  });

  it('a stand-down keeps the drawn pose (shift included) in the handoff, and hands the rival on', () => {
    const run = (kick: boolean) => {
      const state = createSelfRenderPositionState();
      updateSelfRenderPosition(state, kart, 1, 1, 1 / 60, 0, frame(0, 96), false);
      if (kick) kicked(state);
      for (let i = 1; i <= 6; i++) {
        updateSelfRenderPosition(state, kart, 1, 1, 1 / 60, 0, frame(i * 16, 96), false);
      }
      const shift = state.contactKick.selfZ;
      updateSelfRenderPosition(state, kart, 1, 1, 1 / 60, 0, null, false);
      return { state, shift };
    };
    const kicked6 = run(true);
    const plain = run(false);
    expect(kicked6.state.contactKick.rivalId).toBe(-1);
    expect(kicked6.state.contactKick.handoffRivalId).toBe(RIVAL);
    expect(kicked6.shift).toBeLessThan(-0.5);
    // The shift rides the handoff offset: the drawn pose keeps (most of) it.
    const kept = kicked6.state.position.z - plain.state.position.z;
    expect(kept).toBeLessThan(kicked6.shift * 0.7);
    expect(kept).toBeGreaterThanOrEqual(kicked6.shift - 1e-9);
  });

  it('hands over when there is no acknowledgement to wait for, and a new character starts clean', () => {
    const state = createSelfRenderPositionState();
    updateSelfRenderPosition(state, kart, 1, 1, 1 / 60, 0, frame(0, 96), false);
    kicked(state);
    updateSelfRenderPosition(state, kart, 1, 1, 1 / 60, 0, frame(16, 96), false);
    const shift = state.contactKick.selfZ;
    updateSelfRenderPosition(
      state,
      kart,
      1,
      1,
      1 / 60,
      0,
      { ...frame(32, 96), ackTick: null },
      false,
    );
    expect(state.contactKick.rivalId).toBe(-1);
    expect(state.offset.z).toBeLessThan(shift * 0.5);
    foldContactKickHandoff(state.contactKick, RIVAL, { x: 0, z: 0 });
    kicked(state);
    noteSelfIdentity(state, 99);
    expect([state.contactKick.rivalId, state.contactKick.handoffRivalId]).toEqual([-1, -1]);
  });

  it('subtracts the drawn shift before judging a teleport', () => {
    // A runner-sized snap rule (6 yd), a 3 yd shift back down z, then the
    // predicted target steps 4 yd up z: 4 yd is no teleport, 7 would be.
    const runner = { ...kart, drive: null } as unknown as Entity;
    const state = createSelfRenderPositionState();
    updateSelfRenderPosition(state, runner, 1, 1, 1 / 60, 0, frame(0, 96), false);
    kicked(state);
    state.contactKick.selfVx = 0;
    state.contactKick.selfVz = -CONTACT_KICK_MAX_DV;
    const still = (ms: number) => ({ ...frame(ms, 96), position: { x: 0, y: 0, z: 0 } });
    for (let i = 1; i <= 30; i++) {
      updateSelfRenderPosition(state, runner, 1, 1, 1 / 60, 0, still(i * 16), false);
    }
    expect(state.contactKick.selfZ).toBeCloseTo(-CONTACT_KICK_MAX_SHIFT_YD, 9);
    const jump = { ...frame(31 * 16, 96), position: { x: 0, y: 0, z: 4 } };
    updateSelfRenderPosition(state, runner, 1, 1, 1 / 60, 0, jump, false);
    expect(state.contactKick.rivalId).toBe(RIVAL);
    expect(state.position.z).toBeCloseTo(4 - CONTACT_KICK_MAX_SHIFT_YD, 9);
  });
});
