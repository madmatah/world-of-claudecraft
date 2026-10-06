import { describe, expect, it } from 'vitest';
import {
  acknowledgedSlickState,
  SelfSlickPredictor,
  type SlickPredictionBody,
  type SlickPredictionMatch,
  type SlickPredictionState,
  sameSlickState,
  unoiledGrip,
} from '../src/render/self_slick_prediction_core';
import { vehicleProfile } from '../src/sim/content/vehicles';
import { GROUND_BLAST_SHOCK_GRIP } from '../src/sim/mortar_overdrive/ground_blast';
import {
  MORTAR_OVERDRIVE_LANES,
  mortarOverdriveLaneOffset,
} from '../src/sim/mortar_overdrive/layout';
import {
  MORTAR_OVERDRIVE_GARDEN_BAND,
  MORTAR_OVERDRIVE_VEHICLE_KEY,
  MORTAR_OVERDRIVE_VERGE_BAND,
  MORTAR_OVERDRIVE_WARD_AURA,
} from '../src/sim/mortar_overdrive/race';
import { applyMortarOverdriveSlickSurface } from '../src/sim/mortar_overdrive/slick_contact';
import {
  MORTAR_OVERDRIVE_SLICK_GRIP,
  MORTAR_OVERDRIVE_SLICK_GRIP_TICKS,
  MORTAR_OVERDRIVE_SLICK_SLIP_CAP,
  mortarOverdriveSlickThrow,
} from '../src/sim/mortar_overdrive/slicks';
import { mortarOverdriveTrack } from '../src/sim/mortar_overdrive/spline';
import type { Aura } from '../src/sim/types';
import { createVehicleDrive } from '../src/sim/vehicle_motion';
import type {
  MortarOverdriveRacerInfo,
  MortarOverdriveSlickInfo,
} from '../src/world_api/mortar_overdrive';

// A lane other than 0, so the circuit-frame offset is really exercised.
const LANE = MORTAR_OVERDRIVE_LANES[1];
const ORIGIN = mortarOverdriveLaneOffset(LANE.index);
const HERE = mortarOverdriveTrack(LANE.circuit).pointAt(40);
const PID = 7;
const START_TICK = 100;

/** A patch 1.5 yd up the z axis from HERE, in the circuit's frame. */
function patch(over: Partial<MortarOverdriveSlickInfo> = {}): MortarOverdriveSlickInfo {
  return { id: 3, x: HERE.x, z: HERE.z + 1.5, endsAt: START_TICK + 200, ...over };
}

function match(
  slicks: MortarOverdriveSlickInfo[],
  over: Partial<SlickPredictionMatch> = {},
  me: Partial<MortarOverdriveRacerInfo> = {},
): SlickPredictionMatch {
  return {
    phase: 'racing',
    elapsedTicks: START_TICK,
    slicks,
    resetLocked: false,
    me: { pid: PID, finished: false, retired: false, ...me } as MortarOverdriveRacerInfo,
    ...over,
  };
}

function slickState(over: Partial<SlickPredictionState> = {}): SlickPredictionState {
  return {
    raceTick: START_TICK,
    slickGripUntilTick: 0,
    slickContactId: null,
    slickContactUntilTick: 0,
    baseGrip: 1,
    wardSpent: false,
    ...over,
  };
}

/** A machine at 30 yd/s, facing +z, that drives HERE to HERE + 3 yd: through
 *  the patch's centre. */
function body(auras: Aura[] = []): SlickPredictionBody {
  const drive = createVehicleDrive(MORTAR_OVERDRIVE_VEHICLE_KEY);
  drive.speed = 30;
  return {
    id: PID,
    prevPos: { x: ORIGIN.x + HERE.x, y: 0, z: ORIGIN.z + HERE.z },
    pos: { x: ORIGIN.x + HERE.x, y: 0, z: ORIGIN.z + HERE.z + 3 },
    facing: 0,
    auras,
    drive,
    slick: slickState(),
  };
}

/** Park the body well clear of the oil for the next step. */
function parkAway(b: SlickPredictionBody): void {
  b.prevPos = { x: ORIGIN.x + HERE.x + 40, y: 0, z: ORIGIN.z + HERE.z };
  b.pos = { ...b.prevPos };
}

describe('SelfSlickPredictor', () => {
  it('bites a live patch on the tick the race would: the throw and the raised ceiling, the grip a pass later', () => {
    const b = body();
    new SelfSlickPredictor().step(b, match([patch()]));
    const tick = START_TICK + 1;
    expect(b.slick).toEqual(
      slickState({
        raceTick: tick,
        slickGripUntilTick: tick + MORTAR_OVERDRIVE_SLICK_GRIP_TICKS,
        slickContactId: 3,
        slickContactUntilTick: tick + MORTAR_OVERDRIVE_SLICK_GRIP_TICKS,
      }),
    );
    // The surface pass ran before the crossing, so this tick's grip is clean.
    expect(b.drive?.gripMult).toBe(1);
    expect(b.drive?.slipCap).toBe(MORTAR_OVERDRIVE_SLICK_SLIP_CAP);
    const profile = vehicleProfile(MORTAR_OVERDRIVE_VEHICLE_KEY);
    const thrown = mortarOverdriveSlickThrow({
      slip: 0,
      forwardSpeed: 30,
      topSpeed: profile.maxSpeed,
      facing: 0,
      x: HERE.x,
      z: HERE.z + 3,
      slickX: HERE.x,
      slickZ: HERE.z + 1.5,
      slickId: 3,
      pid: PID,
    });
    expect(thrown.push).not.toBe(0);
    expect(b.drive?.slip).toBe(thrown.push);
  });

  it('holds the grip loss for the window and gives the grip back on its last tick, exactly', () => {
    const b = body();
    const predictor = new SelfSlickPredictor();
    const m = match([patch()]);
    predictor.step(b, m);
    const grips: number[] = [];
    for (let i = 0; i < MORTAR_OVERDRIVE_SLICK_GRIP_TICKS; i++) {
      parkAway(b);
      predictor.step(b, m);
      grips.push(b.drive?.gripMult ?? Number.NaN);
    }
    const oiled = MORTAR_OVERDRIVE_SLICK_GRIP_TICKS - 1;
    expect(grips.slice(0, oiled)).toEqual(Array(oiled).fill(MORTAR_OVERDRIVE_SLICK_GRIP));
    expect(grips.at(-1)).toBe(1);
    expect(b.drive?.slipCap).toBe(1);
  });

  it('never bites oil that has dried up by the predicted tick', () => {
    const b = body();
    new SelfSlickPredictor().step(b, match([patch({ endsAt: START_TICK + 1 })]));
    expect(b.drive?.slip).toBe(0);
    expect(b.slick?.slickGripUntilTick).toBe(0);
    expect(b.slick?.slickContactId).toBeNull();
  });

  it('spares the pilot still standing in their own fresh patch, not anyone else', () => {
    const own = body();
    new SelfSlickPredictor().step(own, match([patch({ immunePid: PID })]));
    expect(own.drive?.slip).toBe(0);
    const rival = body();
    new SelfSlickPredictor().step(rival, match([patch({ immunePid: PID + 1 })]));
    expect(rival.drive?.slip).not.toBe(0);
  });

  it('a ward eats the crossing: no grip loss and no throw, but the crossing is spent', () => {
    const ward = { id: MORTAR_OVERDRIVE_WARD_AURA, kind: 'mortar_overdrive_ward' } as Aura;
    const b = body([ward]);
    new SelfSlickPredictor().step(b, match([patch()]));
    expect(b.drive?.slip).toBe(0);
    expect(b.drive?.slipCap).toBe(1);
    expect(b.slick?.slickGripUntilTick).toBe(0);
    expect(b.slick?.slickContactId).toBe(3);
  });

  it('spends the ward once: the next patch inside the window bites though the mirror still shows it', () => {
    const ward = { id: MORTAR_OVERDRIVE_WARD_AURA, kind: 'mortar_overdrive_ward' } as Aura;
    const b = body([ward]);
    const predictor = new SelfSlickPredictor();
    const second = patch({ id: 4, z: HERE.z + 41.5 });
    predictor.step(b, match([patch(), second]));
    expect(b.slick?.wardSpent).toBe(true);
    b.prevPos = { x: ORIGIN.x + HERE.x, y: 0, z: ORIGIN.z + HERE.z + 40 };
    b.pos = { x: ORIGIN.x + HERE.x, y: 0, z: ORIGIN.z + HERE.z + 43 };
    predictor.step(b, match([patch(), second]));
    expect(b.slick?.slickContactId).toBe(4);
    expect(b.drive?.slipCap).toBe(MORTAR_OVERDRIVE_SLICK_SLIP_CAP);
    // Once the server's spend shows on the mirror, a later ward counts again.
    b.auras = [];
    parkAway(b);
    predictor.step(b, match([]));
    expect(b.slick?.wardSpent).toBe(false);
  });

  it('keeps an overlapping crossing one crossing while the machine is still in the first patch', () => {
    const b = body();
    const predictor = new SelfSlickPredictor();
    const first = patch();
    predictor.step(b, match([first]));
    const slip = b.drive?.slip;
    // A second patch whose centre is nearer the next segment, the machine
    // still inside the first: no second throw, the first contact held.
    const overlap = patch({ id: 4, z: HERE.z + 4 });
    b.prevPos = { ...b.pos };
    b.pos = { x: ORIGIN.x + HERE.x, y: 0, z: ORIGIN.z + HERE.z + 3.5 };
    predictor.step(b, match([first, overlap]));
    expect(b.slick?.slickContactId).toBe(3);
    expect(b.slick?.slickContactUntilTick).toBe(START_TICK + 2 + MORTAR_OVERDRIVE_SLICK_GRIP_TICKS);
    expect(b.drive?.slip).toBe(slip);
  });

  it('with no recoverable grip it still opens the window and raises the ceiling, leaving the grip', () => {
    const b = body();
    if (b.slick) b.slick.baseGrip = null;
    if (b.drive) b.drive.gripMult = 0.6;
    const predictor = new SelfSlickPredictor();
    const m = match([patch()]);
    predictor.step(b, m);
    parkAway(b);
    predictor.step(b, m);
    expect(b.drive?.gripMult).toBe(0.6);
    expect(b.drive?.slipCap).toBe(MORTAR_OVERDRIVE_SLICK_SLIP_CAP);
  });

  it.each([
    ['finished', match([patch()], {}, { finished: true })],
    ['retired', match([patch()], {}, { retired: true })],
    ['held by the recovery lock', match([patch()], { resetLocked: true })],
  ])('takes no oil while %s', (_name, m) => {
    const b = body();
    new SelfSlickPredictor().step(b, m);
    expect(b.drive?.slip).toBe(0);
    expect(b.slick?.slickContactId).toBeNull();
  });

  it('forgets a crossing once its patch is gone, the way the server reports it', () => {
    const b = body();
    const predictor = new SelfSlickPredictor();
    predictor.step(b, match([patch({ endsAt: START_TICK + 2 })]));
    expect(b.slick?.slickContactId).toBe(3);
    parkAway(b);
    predictor.step(b, match([patch({ endsAt: START_TICK + 2 })]));
    expect(b.slick?.slickContactId).toBeNull();
  });

  it('drops its standing outside the race and never writes the readout it reads', () => {
    const b = body();
    const m = match([patch()]);
    const before = JSON.stringify(m);
    new SelfSlickPredictor().step(b, m);
    expect(JSON.stringify(m)).toBe(before);
    const after = body();
    new SelfSlickPredictor().step(after, match([patch()], { phase: 'finished' }));
    expect(after.slick).toBeNull();
    expect(after.drive?.slip).toBe(0);
  });
});

describe('against a server older than the oil prediction', () => {
  /** What an older server's readout carries: patches with no `endsAt`. */
  const oldPatch = (): MortarOverdriveSlickInfo => {
    const { endsAt: _endsAt, ...rest } = patch();
    return rest as MortarOverdriveSlickInfo;
  };

  it('predicts no oil at all: no standing from the acknowledgement, no step', () => {
    const recon = { gripLeft: 0, contactId: null, contactLeft: 0 };
    expect(acknowledgedSlickState(recon, match([oldPatch()]), 1)).toBeNull();
    const b = body();
    new SelfSlickPredictor().step(b, match([oldPatch()]));
    expect(b.slick).toBeNull();
    expect(b.drive?.slip).toBe(0);
    expect(b.drive?.slipCap).toBe(1);
  });
});

describe('the acknowledged standing', () => {
  it('takes the oil back off every shipped surface exactly', () => {
    const drive = createVehicleDrive(MORTAR_OVERDRIVE_VEHICLE_KEY);
    for (const band of [
      1,
      MORTAR_OVERDRIVE_VERGE_BAND.gripMult,
      MORTAR_OVERDRIVE_GARDEN_BAND.gripMult,
    ]) {
      for (const shock of [1, GROUND_BLAST_SHOCK_GRIP]) {
        const base = band * shock;
        applyMortarOverdriveSlickSurface(drive, base, true);
        expect(unoiledGrip(drive.gripMult)).toBe(base);
      }
    }
  });

  it('never reads a grip above the road out of an acknowledgement the oil did not touch', () => {
    // A recovery that skipped the surface pass: the window says oil, the
    // grip is still the road's. Dividing the oil back out would inflate it.
    expect(unoiledGrip(1)).toBeNull();
    expect(
      acknowledgedSlickState({ gripLeft: 12, contactId: null, contactLeft: 0 }, match([]), 1)
        ?.baseGrip,
    ).toBeNull();
    expect(unoiledGrip(MORTAR_OVERDRIVE_SLICK_GRIP)).toBe(1);
  });

  it('is null outside a running race or without a standing', () => {
    const recon = { gripLeft: 0, contactId: null, contactLeft: 0 };
    expect(acknowledgedSlickState(recon, null, 1)).toBeNull();
    expect(acknowledgedSlickState(recon, match([], { phase: 'countdown' }), 1)).toBeNull();
    expect(acknowledgedSlickState(null, match([]), 1)).toBeNull();
  });

  it('reads the standing against the race clock of the same snapshot', () => {
    const state = acknowledgedSlickState(
      { gripLeft: 12, contactId: 5, contactLeft: 14 },
      match([]),
      0.7 * MORTAR_OVERDRIVE_SLICK_GRIP,
    );
    expect(state).toEqual({
      raceTick: START_TICK,
      slickGripUntilTick: START_TICK + 12,
      slickContactId: 5,
      slickContactUntilTick: START_TICK + 14,
      baseGrip: 0.7,
      wardSpent: false,
    });
  });

  it('on a bite tick, trusts the predicted entry about the grip only when they agree on it', () => {
    const recon = {
      gripLeft: MORTAR_OVERDRIVE_SLICK_GRIP_TICKS,
      contactId: 5,
      contactLeft: MORTAR_OVERDRIVE_SLICK_GRIP_TICKS,
    };
    const drive = createVehicleDrive(MORTAR_OVERDRIVE_VEHICLE_KEY);
    drive.gripMult = 0.5 * MORTAR_OVERDRIVE_SLICK_GRIP;
    const predicted = { drive, slick: slickState({ baseGrip: 0.5 }) };
    // Still in an earlier crossing's window when this one bit.
    expect(acknowledgedSlickState(recon, match([]), drive.gripMult, predicted)?.baseGrip).toBe(0.5);
    // Disagreeing (or no entry): the grip before the bite is taken as clean.
    expect(acknowledgedSlickState(recon, match([]), 0.7, predicted)?.baseGrip).toBe(0.7);
    expect(acknowledgedSlickState(recon, match([]), 0.7)?.baseGrip).toBe(0.7);
  });
});

describe('sameSlickState', () => {
  it('compares ticks left, so a drifted race clock alone is no mismatch', () => {
    const a = slickState({
      raceTick: 100,
      slickGripUntilTick: 110,
      slickContactId: 2,
      slickContactUntilTick: 120,
    });
    const b = slickState({
      raceTick: 103,
      slickGripUntilTick: 113,
      slickContactId: 2,
      slickContactUntilTick: 123,
    });
    expect(sameSlickState(a, b)).toBe(true);
    expect(sameSlickState(a, { ...b, slickGripUntilTick: 114 })).toBe(false);
    expect(sameSlickState(a, { ...b, slickContactId: 4 })).toBe(false);
    expect(sameSlickState(a, { ...b, slickContactUntilTick: 122 })).toBe(false);
  });

  it('reads a lapsed window as zero and a missing contact as no contact', () => {
    const a = slickState({ raceTick: 100, slickGripUntilTick: 90 });
    const b = slickState({ raceTick: 100, slickGripUntilTick: 100, slickContactUntilTick: 130 });
    expect(sameSlickState(a, b)).toBe(true);
  });
});
