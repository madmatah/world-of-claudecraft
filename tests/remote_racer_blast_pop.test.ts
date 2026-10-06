// A rival thrown by a Ground Blast pops on the frame its Hit event arrives,
// drawn on the sim's own arc, instead of a round trip later when the
// interpolated snapshot height finally shows it
// (remote_vehicle_display_core.ts, startRemoteRacerHops / remoteRacerDisplayY).
//
// The ground truth is the REAL sim: a staged shell lands on a seated rival and
// its per-tick height is recorded. The wire is that same track delayed by the
// interpolation plus the self frame's lead, which is exactly what a rival's
// mirrored height shows.

import { describe, expect, it } from 'vitest';
import {
  createRemoteVehicleDisplay,
  REMOTE_RACER_HOP_SETTLE_CAP_S,
  REMOTE_VEHICLE_SNAP_DIST,
  type RemoteVehicleDisplayState,
  remoteRacerDisplayY,
  remoteRacerHopRise,
  remoteRacerHopSeedS,
  startRemoteRacerHop,
  startRemoteRacerHops,
  stepRemoteVehicleDisplay,
} from '../src/render/remote_vehicle_display_core';
import { mortarOverdriveCompetitionCircuits } from '../src/sim/content/mortar_overdrive/circuits';
import {
  GROUND_BLAST_POP_VELOCITY,
  resolveGroundBlastImpact,
} from '../src/sim/mortar_overdrive/ground_blast';
import { MORTAR_OVERDRIVE_GRID_SIZE } from '../src/sim/mortar_overdrive/layout';
import {
  mortarOverdriveFireGroundBlast,
  mortarOverdriveStartMatch,
  updateMortarOverdrive,
} from '../src/sim/mortar_overdrive/race';
import { mortarOverdriveTrack } from '../src/sim/mortar_overdrive/spline';
import { GRAVITY } from '../src/sim/player_motion';
import { DT, type SimEvent, TICK_RATE } from '../src/sim/types';
import { createVehicleDrive } from '../src/sim/vehicle_motion';
import { addAt, makeWorld, teleport } from './mortar_overdrive_util';

type HitEvent = SimEvent & { type: 'mortarOverdriveGroundBlastHit' };

const FRAME_S = 1 / 60;
/** How far the mirrored height trails the drawn frame: a 100 ms snapshot
 *  interpolation plus a 120 ms self-frame lead. */
const WIRE_DELAY_S = 0.22;

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${label}`);
  return value;
}

/** The real sim: a shell `offset` yards beside a seated rival, and the rival's
 *  height lift over its pre-hit height every tick from the Hit on. */
function simArc(offset: number): { hit: HitEvent; lift: number[]; rivalId: number } {
  const sim = makeWorld();
  const circuit = mortarOverdriveCompetitionCircuits()[0];
  const pids = Array.from({ length: MORTAR_OVERDRIVE_GRID_SIZE }, (_, i) =>
    addAt(sim, 'warrior', `Racer${i}`, -6 + i * 4, -40 - i),
  );
  mortarOverdriveStartMatch(sim.ctx, pids, undefined, circuit.id);
  sim.tick();
  const live = required(sim.mortarOverdrive.match, 'match');
  const track = mortarOverdriveTrack(circuit);
  pids.slice(2).forEach((pid, i) => {
    const away = track.pointAt(track.length * (0.4 + i * 0.2));
    teleport(sim, pid, away.x, away.z);
  });
  live.phase = 'racing';
  updateMortarOverdrive(sim.ctx);
  const [a, b] = pids;
  const caster = required(sim.entities.get(a), 'caster');
  const rival = required(sim.entities.get(b), 'rival');
  caster.facing = 0;
  rival.facing = 0;
  teleport(sim, b, caster.pos.x, caster.pos.z + 14);
  caster.castAim = { x: rival.pos.x + offset, y: rival.pos.y, z: rival.pos.z };
  mortarOverdriveFireGroundBlast(sim.ctx, caster);
  const baseY = rival.pos.y;
  let hit: HitEvent | null = null;
  for (let tick = 0; tick < 40 && !hit; tick++) {
    for (const ev of sim.tick()) if (ev.type === 'mortarOverdriveGroundBlastHit') hit = ev;
  }
  const lift = [rival.pos.y - baseY];
  for (let tick = 0; tick < 80; tick++) {
    sim.tick();
    lift.push(rival.pos.y - baseY);
  }
  return { hit: required(hit, 'hit'), lift, rivalId: b };
}

/** The sim track sampled at `t` seconds after the Hit tick, linearly between
 *  ticks (what an interpolated snapshot height shows). */
function liftAt(lift: readonly number[], t: number): number {
  if (t <= 0) return lift[0];
  const f = t * TICK_RATE;
  const i = Math.floor(f);
  if (i + 1 >= lift.length) return lift[lift.length - 1];
  return lift[i] + (lift[i + 1] - lift[i]) * (f - i);
}

function activeDisplay(): RemoteVehicleDisplayState {
  const s = createRemoteVehicleDisplay();
  s.active = true;
  return s;
}

interface Frame {
  t: number;
  drawn: number;
  wire: number;
}

/** Play the rival at 60 fps: a few frames of wire height, then the Hit event
 *  on frame 0, then the drawn height against the delayed wire. */
function replay(lift: readonly number[], pop: number, groundY: number, frames = 150): Frame[] {
  const s = activeDisplay();
  const flat = (): number => groundY;
  for (let i = 0; i < 3; i++) remoteRacerDisplayY(s, 0, groundY, 0, 0, 0, flat, FRAME_S);
  expect(startRemoteRacerHop(s, pop)).toBe(true);
  const out: Frame[] = [];
  for (let i = 0; i < frames; i++) {
    const t = (i + 1) * FRAME_S;
    const wire = groundY + liftAt(lift, t - WIRE_DELAY_S);
    out.push({ t, drawn: remoteRacerDisplayY(s, 0, wire, 0, 0, 0, flat, FRAME_S), wire });
  }
  return out;
}

describe('a rival popped by a Ground Blast, drawn from the Hit event', () => {
  it('replays the per-racer falloff the event carries as the pop the sim applied', () => {
    const { hit, lift, rivalId } = simArc(3);
    const hits = required(hit.hits, 'hits');
    expect(hits[0]).toBe(rivalId);
    expect(hits[1]).toBeCloseTo(2 / 3, 3);
    // The sim's first tick in the air is exactly the drawn arc's first tick.
    expect(lift[1]).toBeCloseTo(remoteRacerHopRise(GROUND_BLAST_POP_VELOCITY * hits[1], DT), 3);
  });

  it('starts the hop on the event frame, peaks with the sim, lands on time, and never hops twice', () => {
    const { hit, lift } = simArc(0);
    const pop = GROUND_BLAST_POP_VELOCITY * required(hit.hits, 'hits')[1];
    const groundY = 12;
    const frames = replay(lift, pop, groundY);

    // Event frame: the drawn machine is already leaving the ground while the
    // wire still shows it sitting there.
    expect(frames[0].drawn).toBeGreaterThan(groundY + 0.1);
    expect(frames[0].wire).toBeCloseTo(groundY, 9);

    // Peak: the sim's own apex, within a hundredth of a yard.
    const simPeak = Math.max(...lift);
    const drawnPeak = Math.max(...frames.map((f) => f.drawn)) - groundY;
    expect(simPeak).toBeGreaterThan(3);
    expect(Math.abs(drawnPeak - simPeak)).toBeLessThan(0.01);

    // Landing: when the SIM lands (in the drawn frame), not when the wire does.
    const simLandT = lift.findIndex((y, i) => i > 0 && y <= 1e-9) / TICK_RATE;
    const drawnLand = frames.findIndex((f) => f.drawn <= groundY + 1e-9);
    expect(Math.abs(frames[drawnLand].t - simLandT)).toBeLessThanOrEqual(DT + FRAME_S);
    const wireUp = frames.findIndex((f) => f.wire > groundY + 0.1);
    const wireLand = frames.findIndex((f, i) => i > wireUp && f.wire <= groundY + 1e-9);
    expect(wireUp).toBeGreaterThan(0);
    expect(frames[wireLand].t - frames[drawnLand].t).toBeGreaterThan(WIRE_DELAY_S - 0.05);

    // No double hop: once down, it stays down while the wire's late copy of
    // the same hop plays out, though the wire is still in the air there.
    const lateWire = frames.slice(drawnLand, wireLand);
    expect(lateWire.some((f) => f.wire > groundY + 0.5)).toBe(true);
    for (const f of frames.slice(drawnLand)) expect(f.drawn).toBeCloseTo(groundY, 9);
  });

  it('hands back to the wire exactly once it has shown and finished the hop', () => {
    const { hit, lift } = simArc(0);
    const pop = GROUND_BLAST_POP_VELOCITY * required(hit.hits, 'hits')[1];
    const frames = replay(lift, pop, 5, 150);
    const last = frames[frames.length - 1];
    expect(last.drawn).toBe(last.wire);
    // With no hop in play the height is exactly the wire's drawn height.
    const idle = activeDisplay();
    const ramp = (x: number, z: number): number => 0.25 * x + 0.1 * z;
    expect(remoteRacerDisplayY(idle, 10, 7, 10, 22, 14, ramp, FRAME_S)).toBe(
      7 - ramp(10, 10) + ramp(22, 14),
    );
  });

  it('eases back to a wire that never replays the hop, without a step', () => {
    // A wire that stays on the ground (the server saw a different landing):
    // the settle cap hands it back through a decaying offset.
    const s = activeDisplay();
    const flat = (): number => 0;
    const wireY = 0.8;
    remoteRacerDisplayY(s, 0, 0, 0, 0, 0, flat, FRAME_S);
    startRemoteRacerHop(s, 4);
    let prev = 0;
    let maxStep = 0;
    let t = 0;
    for (; t < 1.5 + REMOTE_RACER_HOP_SETTLE_CAP_S + 1; t += FRAME_S) {
      const y = remoteRacerDisplayY(s, 0, wireY, 0, 0, 0, flat, FRAME_S);
      if (s.hop.phase === 'idle') maxStep = Math.max(maxStep, Math.abs(y - prev));
      prev = y;
    }
    expect(s.hop.phase).toBe('idle');
    expect(maxStep).toBeLessThan(0.25);
    expect(prev).toBeCloseTo(wireY, 3);
  });

  it('adds the pop to a rival already rising at the Hit, and never rises a second time', () => {
    // The truth: a machine already airborne at 6 yd/s when the shell lands; the
    // sim ADDS the 8 yd/s pop, so it flies on the sum. The wire shows the same
    // track WIRE_DELAY_S late, so at the event it is still rising on the old arc.
    const pre = 0.3;
    const pop = 8;
    const truth = (t: number): number => {
      if (t < 0) return Math.max(0, remoteRacerHopRise(6, t + pre));
      const vyAtHit = 6 - GRAVITY * pre;
      return Math.max(0, remoteRacerHopRise(6, pre) + remoteRacerHopRise(vyAtHit + pop, t));
    };
    const s = activeDisplay();
    const flat = (): number => 0;
    let drawn = 0;
    for (let t = -1; t <= 0; t += FRAME_S) {
      drawn = remoteRacerDisplayY(s, 0, truth(t - WIRE_DELAY_S), 0, 0, 0, flat, FRAME_S);
    }
    expect(s.hop.wireRate).toBeGreaterThan(0);
    expect(startRemoteRacerHop(s, pop)).toBe(true);
    // Seeded from the wire's own rate, not from rest.
    expect(s.hop.vy0).toBeGreaterThan(pop);
    const heights: number[] = [drawn];
    for (let t = FRAME_S; t < 4; t += FRAME_S) {
      heights.push(remoteRacerDisplayY(s, 0, truth(t - WIRE_DELAY_S), 0, 0, 0, flat, FRAME_S));
    }
    const landed = heights.findIndex((y, i) => i > 5 && y <= 1e-9);
    expect(landed).toBeGreaterThan(0);
    // Down once, down for good: the wire's late copy never lifts it again.
    expect(Math.max(...heights.slice(landed))).toBeLessThanOrEqual(1e-9);
    expect(s.hop.phase).toBe('idle');
  });

  it('never raises a landed rival into a wire still in the air at the hand-back', () => {
    // The drawn arc lands and the settle window runs out while the wire is
    // still airborne (rising, then falling): the kart stays down throughout.
    const s = activeDisplay();
    const flat = (): number => 0;
    remoteRacerDisplayY(s, 0, 0, 0, 0, 0, flat, FRAME_S);
    startRemoteRacerHop(s, 3);
    // Still RISING when the settle window runs out (the arc lands near 0.4 s,
    // the window closes 0.6 s later), then falling.
    const wire = (t: number): number => Math.max(0, remoteRacerHopRise(10, t - 0.8));
    let drawnDown = -1;
    const heights: number[] = [];
    for (let t = FRAME_S; t < 3; t += FRAME_S) {
      const y = remoteRacerDisplayY(s, 0, wire(t), 0, 0, 0, flat, FRAME_S);
      heights.push(y);
      if (drawnDown < 0 && heights.length > 3 && y <= 1e-9) drawnDown = heights.length - 1;
    }
    expect(drawnDown).toBeGreaterThan(0);
    expect(Math.max(...heights.slice(drawnDown))).toBeLessThanOrEqual(1e-9);
  });

  it("starts the arc at the self frame's lead, so it shares the horizontal frame", () => {
    const s = activeDisplay();
    const flat = (): number => 0;
    remoteRacerDisplayY(s, 0, 0, 0, 0, 0, flat, FRAME_S);
    s.lastSelfFrame = true;
    s.lastLeadMs = 120;
    s.leadCarryMs = 10;
    expect(remoteRacerHopSeedS(s)).toBeCloseTo(0.13, 12);
    startRemoteRacerHop(s, 12);
    expect(s.hop.t).toBeCloseTo(0.13, 12);
    const y = remoteRacerDisplayY(s, 0, 0, 0, 0, 0, flat, FRAME_S);
    expect(y).toBeCloseTo(remoteRacerHopRise(12, 0.13 + FRAME_S), 9);
    // Drawn on its arrival age, the arc starts at the event.
    const stood = activeDisplay();
    remoteRacerDisplayY(stood, 0, 0, 0, 0, 0, flat, FRAME_S);
    stood.lastSelfFrame = false;
    stood.lastLeadMs = 120;
    expect(remoteRacerHopSeedS(stood)).toBe(0);
  });

  it('stacks a second shell on the velocity the arc has left, as the sim adds to vy', () => {
    const s = activeDisplay();
    const flat = (): number => 0;
    remoteRacerDisplayY(s, 0, 0, 0, 0, 0, flat, FRAME_S);
    startRemoteRacerHop(s, 8);
    let y = 0;
    for (let i = 0; i < 12; i++) y = remoteRacerDisplayY(s, 0, 0, 0, 0, 0, flat, FRAME_S);
    const vyLeft = 8 - GRAVITY * s.hop.t;
    startRemoteRacerHop(s, 6);
    expect(s.hop.vy0).toBeCloseTo(vyLeft + 6, 9);
    expect(s.hop.y0).toBe(y);
  });

  it('pops only the drawn rivals the event names, never the local pilot or an idle view', () => {
    const flat = (): number => 0;
    const views = new Map<number, { remoteVehicle: RemoteVehicleDisplayState }>();
    for (const id of [2, 3, 4, 9]) {
      const s = activeDisplay();
      remoteRacerDisplayY(s, 0, 0, 0, 0, 0, flat, FRAME_S);
      views.set(id, { remoteVehicle: s });
    }
    views.set(5, { remoteVehicle: createRemoteVehicleDisplay() });
    const event = { hits: [2, 1, 9, 0.444, 5, 0.5, 3, 0] };
    // 9 is the viewer (its pop rides the prediction), 5 has no live
    // projection, 3 took nothing, 4 is not named.
    expect(startRemoteRacerHops(views, event, 9)).toBe(1);
    expect(views.get(2)?.remoteVehicle.hop).toMatchObject({ phase: 'arc', vy0: 12 });
    for (const id of [3, 4, 5, 9]) expect(views.get(id)?.remoteVehicle.hop.phase).toBe('idle');
    expect(startRemoteRacerHops(views, {}, 9)).toBe(0);
  });

  it('keeps the hop and glides the shove it rides in on at a deep horizon', () => {
    // The Hit event and the shoved pose ride one snapshot. Projected 320 ms
    // (a 200 ms round trip's lead), the push moves the target past the 6 yd
    // teleport rule; snapping there threw the drawn hop away on its first frame.
    const flat = (): number => 0;
    const drive = createVehicleDrive('tank');
    drive.speed = 50;
    const s = createRemoteVehicleDisplay();
    for (let i = 0; i < 4; i++) {
      stepRemoteVehicleDisplay(s, 0, 0, 0, drive, 320, FRAME_S, 5000);
      remoteRacerDisplayY(s, 0, 0, 0, s.x, s.z, flat, FRAME_S);
    }
    const before = { x: s.x, z: s.z };
    const shoved = { ...drive };
    resolveGroundBlastImpact({ x: 0, z: 0, facing: 0, drive: shoved }, -1.2, 0);
    const target = stepRemoteVehicleDisplay(
      createRemoteVehicleDisplay(),
      0,
      0,
      0,
      shoved,
      320,
      0,
      5000,
    );
    expect(Math.hypot(target.x - before.x, target.z - before.z)).toBeGreaterThan(
      REMOTE_VEHICLE_SNAP_DIST,
    );
    expect(startRemoteRacerHop(s, GROUND_BLAST_POP_VELOCITY)).toBe(true);
    stepRemoteVehicleDisplay(s, 0, 0, 0, shoved, 320, FRAME_S, 5000);
    expect(s.hop.phase).toBe('arc');
    expect(remoteRacerDisplayY(s, 0, 0, 0, s.x, s.z, flat, FRAME_S)).toBeGreaterThan(0);
    // Glided, not adopted: the first frame still sits near the drawn pose.
    expect(Math.abs(s.x - before.x)).toBeLessThan(Math.abs(target.x - before.x) / 2);
  });

  it('still snaps a short free jump with no pop in the air, at a deep horizon', () => {
    // A one-tick recovery lock can fall between two rendered frames, so a
    // reset may arrive on a free snapshot: with no Hit event behind it, the
    // jump is not a shove and keeps the plain rule.
    const drive = createVehicleDrive('tank');
    drive.speed = 30;
    const s = createRemoteVehicleDisplay();
    for (let i = 0; i < 4; i++) stepRemoteVehicleDisplay(s, 0, 0, 0, drive, 320, FRAME_S, 5000);
    const reset = { ...drive, speed: 0 };
    stepRemoteVehicleDisplay(s, 15, 0, 0, reset, 320, FRAME_S, 5000);
    const target = stepRemoteVehicleDisplay(
      createRemoteVehicleDisplay(),
      15,
      0,
      0,
      reset,
      320,
      0,
      5000,
    );
    expect(s.x).toBe(target.x);
    expect(s.z).toBe(target.z);
  });

  it('still snaps a held machine past the plain rule, at any horizon', () => {
    // A reset arrives held: the race locks the machine it puts back.
    const drive = createVehicleDrive('tank');
    const s = createRemoteVehicleDisplay();
    stepRemoteVehicleDisplay(s, 0, 0, 0, drive, 320, FRAME_S, 5000);
    const held = { ...drive, controlsLocked: true };
    stepRemoteVehicleDisplay(s, 7, 0, 0, held, 320, FRAME_S, 5000);
    expect(s.x).toBe(7);
  });

  it('drops the hop on a teleport or a track reset', () => {
    const s = activeDisplay();
    const flat = (): number => 0;
    const drive = createVehicleDrive('tank');
    stepRemoteVehicleDisplay(s, 0, 0, 0, drive, 0, FRAME_S);
    remoteRacerDisplayY(s, 0, 0, 0, 0, 0, flat, FRAME_S);
    startRemoteRacerHop(s, 10);
    stepRemoteVehicleDisplay(s, 40, 40, 0, drive, 0, FRAME_S);
    expect(s.hop.phase).toBe('idle');
    expect(remoteRacerDisplayY(s, 40, 0, 40, 40, 40, flat, FRAME_S)).toBe(0);
  });
});
