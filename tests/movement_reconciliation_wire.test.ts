import { describe, expect, it } from 'vitest';
import { driveReconWire } from '../server/drive_recon_wire';
import { reconciliationSelfWire } from '../server/movement_reconciliation_wire';
import { applyReconSelfWire, ReconWireState } from '../src/net/movement_reconciliation_wire';
import { createClientPlayerMotionDeps } from '../src/render/client_player_motion';
import { createPlayer } from '../src/sim/entity';
import { stepPlayerMotion } from '../src/sim/player_motion';
import { type Entity, emptyMoveInput, type MoveInput, type VehicleDrive } from '../src/sim/types';
import { createVehicleDrive } from '../src/sim/vehicle_motion';
import { groundHeight } from '../src/sim/world';

const SEED = 17;

describe('applyReconSelfWire', () => {
  it('advances previous authoritative facing on every v2 self sample', () => {
    const state = new ReconWireState();

    applyReconSelfWire(state, { rpx: 1, rpy: 2, rpz: 3, rpf: 0.25, ackCt: 0, ovE: 0 }, 2);
    expect(state.reconPreviousAuthoritativeFacing).toBe(0.25);
    expect(state.reconAuthoritativeFacing).toBe(0.25);

    applyReconSelfWire(state, { rpx: 2, rpy: 3, rpz: 4, rpf: 1.25, ackCt: 1, ovE: 0 }, 2);
    expect(state.reconPreviousAuthoritativeFacing).toBe(0.25);
    expect(state.reconAuthoritativeFacing).toBe(1.25);

    applyReconSelfWire(state, { rpx: 3, rpy: 4, rpz: 5, rpf: -0.5, ackCt: 2, ovE: 0 }, 2);
    expect(state.reconPreviousAuthoritativeFacing).toBe(1.25);
    expect(state.reconAuthoritativeFacing).toBe(-0.5);
  });
});

const V2_SESSION = {
  movementWireVersion: 2 as const,
  lastConsumedCt: 41,
  movementOverrideEpoch: 3,
  movementOverrideActive: false,
  movementMoveSpeedMult: 1,
  driveReconWireVersion: 1,
};

function pilot(): Entity {
  const e = createPlayer(7, 'warrior', { x: 113_700.125, y: 3.5, z: -41.75 }, 'Pilot');
  e.drive = createVehicleDrive('rally_loaner');
  return e;
}

/** The server's self block through the real JSON the socket carries. */
function overTheWire(e: Entity, session = V2_SESSION): Record<string, unknown> {
  return JSON.parse(JSON.stringify(reconciliationSelfWire(session, e)));
}

function decode(wire: Record<string, unknown>, version: 1 | 2 = 2) {
  const state = new ReconWireState();
  const mirror = pilot();
  mirror.drive = null;
  applyReconSelfWire(state, wire, version, mirror);
  return { state, mirror };
}

describe('the drive recon (rdv)', () => {
  it('round-trips every drive field at full precision, airborne and locked', () => {
    const e = pilot();
    const d = e.drive as VehicleDrive;
    d.speed = 1 / 3;
    d.slip = -Math.PI / 7;
    d.steerAngle = 0.1 + 0.2;
    d.yawRate = -5e-324;
    d.spin = 2 ** -40;
    d.handbrake = 0.35000000000000003;
    d.gripMult = 0.6180339887498949;
    d.dragMult = Math.SQRT2;
    d.speedCap = 1 - 2 ** -52;
    d.slipCap = 1.7976931348623157e308;
    d.collisionImpact = 7.123456789012345;
    d.controlsLocked = true;
    e.onGround = false;
    e.vy = -12.345678901234567;

    const wire = overTheWire(e);
    expect(Object.keys(wire.rdv as object).sort()).toEqual(
      [
        'air',
        'c',
        'ci',
        'dg',
        'g',
        'hb',
        'k',
        'lk',
        'sc',
        'sl',
        'sn',
        'sp',
        'st',
        'vy',
        'yr',
      ].sort(),
    );
    const { state, mirror } = decode(wire);
    expect(state.reconDrive).toEqual(d);
    expect(state.reconVy).toBe(e.vy);
    expect(state.reconOnGround).toBe(false);
    expect(state.reconOverrideActive).toBe(false);
    // The mirror is rebuilt from the same record, as its own object.
    expect(mirror.drive).toEqual(d);
    expect(mirror.drive).not.toBe(state.reconDrive);
  });

  it('round-trips the standing with the oil, and sends none of it at rest', () => {
    const e = pilot();
    const slick = { gripLeft: 17, contactId: 4, contactLeft: 29 };
    const rdv = JSON.parse(JSON.stringify(driveReconWire(e, slick)));
    expect(rdv).toMatchObject({ og: 17, oc: 4, ou: 29 });
    const state = new ReconWireState();
    applyReconSelfWire(state, { ...overTheWire(e), rdv }, 2);
    expect(state.reconSlick).toEqual(slick);
    // A remembered patch whose window has lapsed keeps only its id.
    const lapsed = driveReconWire(e, { gripLeft: 0, contactId: 4, contactLeft: 0 });
    expect(lapsed).toEqual({ k: 'rally_loaner', sp: 0, sl: 0, yr: 0, oc: 4 });
    const none = { gripLeft: 0, contactId: null, contactLeft: 0 };
    expect(driveReconWire(e, none)).toEqual(driveReconWire(e));
    applyReconSelfWire(state, overTheWire(e), 2);
    expect(state.reconSlick).toEqual(none);
    e.drive = null;
    applyReconSelfWire(state, overTheWire(e), 2);
    expect(state.reconSlick).toBeNull();
  });

  it('sends only the always-on fields for a machine at rest on a clean road', () => {
    const e = pilot();
    const wire = overTheWire(e);
    expect(wire.rdv).toEqual({ k: 'rally_loaner', sp: 0, sl: 0, yr: 0 });
    const { state } = decode(wire);
    expect(state.reconDrive).toEqual(createVehicleDrive('rally_loaner'));
    expect(state.reconVy).toBe(0);
    expect(state.reconOnGround).toBe(true);
  });

  it('carries a signed zero across as a plain zero', () => {
    const e = pilot();
    const d = e.drive as VehicleDrive;
    d.speed = -0;
    d.slip = -0;
    d.yawRate = -0;
    const { state } = decode(overTheWire(e));
    const got = state.reconDrive as VehicleDrive;
    expect([got.speed, got.slip, got.yawRate].every((n) => n === 0)).toBe(true);
    expect(Object.is(got.speed, 0)).toBe(true);
  });

  it('drops a sub-threshold scrape reading, which the kernel never reads', () => {
    const e = pilot();
    (e.drive as VehicleDrive).collisionImpact = 0.004;
    const wire = overTheWire(e);
    expect(wire.rdv).not.toHaveProperty('ci');
    expect(decode(wire).state.reconDrive?.collisionImpact).toBe(0);
  });

  it.each([
    ['not an object', 7],
    ['an array', [1, 2, 3]],
    ['a missing speed', { k: 'rally_loaner', sl: 0, yr: 0 }],
    ['a null (non-finite) slip', { k: 'rally_loaner', sp: 0, sl: null, yr: 0 }],
    ['a string yaw rate', { k: 'rally_loaner', sp: 0, sl: 0, yr: '0' }],
    ['an unknown profile', { k: 'hovercraft', sp: 0, sl: 0, yr: 0 }],
    ['a numeric profile', { k: 3, sp: 0, sl: 0, yr: 0 }],
    ['a non-finite grip', { k: 'rally_loaner', sp: 0, sl: 0, yr: 0, g: null }],
    ['a boolean lock', { k: 'rally_loaner', sp: 0, sl: 0, yr: 0, lk: true }],
    ['an airborne flag without vy', { k: 'rally_loaner', sp: 0, sl: 0, yr: 0, air: 1 }],
    ['a vy on the ground', { k: 'rally_loaner', sp: 0, sl: 0, yr: 0, vy: -3 }],
    ['a bad airborne flag', { k: 'rally_loaner', sp: 0, sl: 0, yr: 0, air: 2, vy: 1 }],
    ['a negative grip window', { k: 'rally_loaner', sp: 0, sl: 0, yr: 0, og: -3 }],
    ['a fractional grip window', { k: 'rally_loaner', sp: 0, sl: 0, yr: 0, og: 1.5 }],
    ['a zero patch id', { k: 'rally_loaner', sp: 0, sl: 0, yr: 0, oc: 0 }],
    ['a contact window with no patch', { k: 'rally_loaner', sp: 0, sl: 0, yr: 0, ou: 4 }],
  ])('drops %s whole and stands the prediction down', (_name, rdv) => {
    const state = new ReconWireState();
    const mirror = pilot();
    mirror.drive = null;
    applyReconSelfWire(state, { ...overTheWire(pilot()), rdv }, 2, mirror);
    expect(state.reconDrive).toBeNull();
    expect(state.reconOverrideActive).toBe(true);
    // Never replayed, only drawn: a resting machine of the default profile.
    expect(mirror.drive).toEqual(createVehicleDrive('rally_loaner'));
  });

  it('keeps the last good machine on the mirror across consecutive malformed rows', () => {
    const e = pilot();
    (e.drive as VehicleDrive).speed = 33.5;
    const state = new ReconWireState();
    const mirror = pilot();
    applyReconSelfWire(state, overTheWire(e), 2, mirror);
    for (let i = 0; i < 2; i++) {
      // applyWire nulls the mirror first: the self record carries no `drv`.
      mirror.drive = null;
      applyReconSelfWire(state, { ...overTheWire(e), rdv: { k: 'rally_loaner' } }, 2, mirror);
      expect(mirror.drive).toEqual(e.drive);
      expect(mirror.drive).not.toBe(state.reconDriveShown);
      expect(state.reconDrive).toBeNull();
      expect(state.reconOverrideActive).toBe(true);
    }
  });

  it('draws a resting machine on a malformed first row, never a runner, and still stands down', () => {
    // With no good row to hold yet, the own kart would otherwise be drawn as
    // a runner until one landed.
    const state = new ReconWireState();
    const mirror = pilot();
    mirror.drive = null;
    applyReconSelfWire(state, { ...overTheWire(pilot()), rdv: { k: 'rally_loaner' } }, 2, mirror);
    expect(mirror.drive).toEqual(createVehicleDrive('rally_loaner'));
    expect(state.reconDrive).toBeNull();
    expect(state.reconOverrideActive).toBe(true);
    // A second malformed row keeps it; the first good row replaces it.
    mirror.drive = null;
    applyReconSelfWire(state, { ...overTheWire(pilot()), rdv: 3 }, 2, mirror);
    expect(mirror.drive).toEqual(createVehicleDrive('rally_loaner'));
    const e = pilot();
    (e.drive as VehicleDrive).speed = 21.25;
    mirror.drive = null;
    applyReconSelfWire(state, overTheWire(e), 2, mirror);
    expect((mirror.drive as VehicleDrive | null)?.speed).toBe(21.25);
    expect(state.reconOverrideActive).toBe(false);
  });

  it('forgets the held machine at the unseat and on reset', () => {
    const e = pilot();
    const state = new ReconWireState();
    applyReconSelfWire(state, overTheWire(e), 2);
    expect(state.reconDriveShown).not.toBeNull();
    e.drive = null;
    applyReconSelfWire(state, overTheWire(e), 2);
    expect(state.reconDriveShown).toBeNull();
    const mirror = pilot();
    mirror.drive = null;
    applyReconSelfWire(state, { ...overTheWire(pilot()), rdv: 3 }, 2, mirror);
    // The held machine is gone, so the malformed row draws a resting one.
    expect(mirror.drive).toEqual(createVehicleDrive('rally_loaner'));

    applyReconSelfWire(state, overTheWire(pilot()), 2);
    state.resetReconWireState();
    expect(state.reconDriveShown).toBeNull();
  });

  it('keeps the rounded drv, and sends no rdv, to a v2 client without the capability', () => {
    const e = pilot();
    for (const driveReconWireVersion of [0, undefined, 2]) {
      const wire = reconciliationSelfWire({ ...V2_SESSION, driveReconWireVersion }, e);
      expect(Object.hasOwn(wire, 'drv')).toBe(false);
      expect(wire).not.toHaveProperty('rdv');
      expect(wire).toHaveProperty('rpx');
    }
  });

  it('replaces a previous drive recon with null on a record without one', () => {
    const e = pilot();
    const state = new ReconWireState();
    applyReconSelfWire(state, overTheWire(e), 2);
    expect(state.reconDrive).not.toBeNull();
    e.drive = null;
    const onFoot = overTheWire(e);
    expect(onFoot).not.toHaveProperty('rdv');
    applyReconSelfWire(state, onFoot, 2);
    expect(state.reconDrive).toBeNull();
    expect(state.reconOverrideActive).toBe(false);
  });

  it('is cleared with the rest of the recon state', () => {
    const e = pilot();
    e.onGround = false;
    e.vy = 4;
    const { state } = decode(overTheWire(e));
    expect(state.reconDrive).not.toBeNull();
    state.resetReconWireState();
    expect({
      drive: state.reconDrive,
      vy: state.reconVy,
      onGround: state.reconOnGround,
    }).toEqual({ drive: null, vy: 0, onGround: true });
  });

  it('is never sent to a v1 session, nor decoded on v1', () => {
    const e = pilot();
    expect(reconciliationSelfWire({ ...V2_SESSION, movementWireVersion: 1 }, e)).toEqual({});
    const { state, mirror } = decode(overTheWire(e), 1);
    expect(state.reconDrive).toBeNull();
    expect(mirror.drive).toBeNull();
  });

  it('is never sent for a runner, and drops the rounded drv only for a driver', () => {
    const e = pilot();
    const driving = reconciliationSelfWire(V2_SESSION, e);
    expect(Object.hasOwn(driving, 'drv')).toBe(true);
    expect(driving.drv).toBeUndefined();
    expect(driving).toHaveProperty('rdv');
    e.drive = null;
    const running = reconciliationSelfWire(V2_SESSION, e);
    expect(Object.hasOwn(running, 'drv')).toBe(false);
    expect(running).not.toHaveProperty('rdv');
  });
});

describe('the vehicle kernel over a signed zero', () => {
  function stepped(zero: number, mi: Partial<MoveInput>): Entity {
    const e = pilot();
    e.pos = { x: 40, y: groundHeight(40, 60, SEED), z: 60 };
    e.prevPos = { ...e.pos };
    const d = e.drive as VehicleDrive;
    d.speed = zero;
    d.slip = zero;
    d.yawRate = zero;
    d.spin = zero;
    const deps = createClientPlayerMotionDeps(SEED);
    for (let i = 0; i < 8; i++) {
      e.prevPos = { ...e.pos };
      stepPlayerMotion(deps, e, { ...emptyMoveInput(), ...mi });
    }
    return e;
  }

  const plain = (n: number): number => (n === 0 ? 0 : n);

  it.each([
    ['idle', {}],
    ['throttle and a turn', { forward: true, turnLeft: true }],
    ['reverse and the handbrake', { back: true, jump: true }],
  ])('steps -0 and +0 speed and slip to the same state (%s)', (_name, mi) => {
    const neg = stepped(-0, mi);
    const pos = stepped(0, mi);
    const view = (e: Entity) => ({
      pos: e.pos,
      facing: e.facing,
      onGround: e.onGround,
      vy: plain(e.vy),
      drive: Object.fromEntries(
        Object.entries(e.drive as VehicleDrive).map(([k, v]) => [
          k,
          typeof v === 'number' ? plain(v) : v,
        ]),
      ),
    });
    expect(view(neg)).toEqual(view(pos));
  });
});
