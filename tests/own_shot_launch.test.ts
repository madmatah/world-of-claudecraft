// The local pilot's own Ground Blast shell, launched on the input frame
// (own_shot_launch_core.ts + RealmRacersGroundBlastVisuals.launchOwn): the
// same aim clamp and flight the sim applies, adopted by the server's Fired
// event as exactly one shell, faded out with no crater when the server never
// confirms it, on a window derived from the prediction's own lead.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  claimOwnShotLaunch,
  createOwnShotLedger,
  expireOwnShotLaunch,
  OWN_SHOT_UNCONFIRMED_FADE_S,
  ownShotConfirmWindowS,
  ownShotMuzzle,
  planOwnShotLaunch,
  recordOwnShotLaunch,
  shellProgress,
} from '../src/render/own_shot_launch_core';
import { RealmRacersGroundBlastVisuals } from '../src/render/realm_racers_ground_blast';
import { realmRacersCompetitionCircuits } from '../src/sim/content/realm_racers_circuits';
import {
  GROUND_BLAST_MUZZLE_NOSE_YD,
  resolveGroundBlastAim,
} from '../src/sim/realm_racers_ground_blast';
import { REALM_RACERS_GRID_SIZE } from '../src/sim/realm_racers_layout';
import {
  realmRacersFireGroundBlast,
  realmRacersStartMatch,
  updateRealmRacers,
} from '../src/sim/social/realm_racers';
import { DT, type SimEvent } from '../src/sim/types';
import { addAt, makeWorld, teleport } from './realm_racers_util';

vi.mock('../src/render/textures', () => ({
  rallyGroundBlastMarkerTexture: () => {
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    texture.needsUpdate = true;
    return texture;
  },
}));

const FRAME = 1 / 60;
const OWNER = 7;
const RIVAL = 9;
const flat = (): number => 0;

function named(v: RealmRacersGroundBlastVisuals, name: string): THREE.Mesh {
  const mesh = v.group.getObjectByName(name) as THREE.Mesh | undefined;
  if (!mesh) throw new Error(`no ${name}`);
  return mesh;
}

function materialsOf(v: RealmRacersGroundBlastVisuals): Map<THREE.Material, number> {
  const out = new Map<THREE.Material, number>();
  v.group.traverse((object) => {
    const mat = (object as THREE.Mesh).material as THREE.Material | undefined;
    if (mat) out.set(mat, mat.version);
  });
  return out;
}

function launched(leadMs: number): RealmRacersGroundBlastVisuals {
  const v = new RealmRacersGroundBlastVisuals();
  v.prepare();
  expect(v.launchOwn(0, 0, 0, { x: 0, z: 30 }, leadMs, flat, OWNER)).toBe(true);
  return v;
}

describe('the own-shot launch plan is the sim shot', () => {
  it('clamps and times exactly as the server does, from the drawn nose', () => {
    // A real server shot from the same pose at the same aim.
    const sim = makeWorld();
    const circuit = realmRacersCompetitionCircuits()[0];
    const pids = Array.from({ length: REALM_RACERS_GRID_SIZE }, (_, i) =>
      addAt(sim, 'warrior', `Racer${i}`, -6 + i * 4, -40 - i),
    );
    realmRacersStartMatch(sim.ctx, pids, undefined, circuit.id);
    sim.tick();
    const live = sim.realmRacers.match;
    if (!live) throw new Error('no match');
    live.phase = 'racing';
    updateRealmRacers(sim.ctx);
    const caster = sim.entities.get(pids[0]);
    if (!caster) throw new Error('no caster');
    teleport(sim, pids[0], caster.pos.x, caster.pos.z);
    caster.facing = 0.3;
    // Off the cone and past the range, so both clamps bite.
    const requested = { x: caster.pos.x + 60, z: caster.pos.z + 50 };
    caster.castAim = { ...requested, y: caster.pos.y };
    realmRacersFireGroundBlast(sim.ctx, caster);
    const fired = sim
      .tick()
      .find(
        (e): e is SimEvent & { type: 'realmRacersGroundBlastFired' } =>
          e.type === 'realmRacersGroundBlastFired',
      );
    const pose = { x: caster.pos.x, z: caster.pos.z, facing: caster.facing };
    const plan = planOwnShotLaunch(pose, requested, 180);
    if (!plan || !fired) throw new Error('no plan or no fired event');
    expect(plan.targetX).toBeCloseTo(fired.targetX, 9);
    expect(plan.targetZ).toBeCloseTo(fired.targetZ, 9);
    expect(plan.x).toBeCloseTo(fired.x, 9);
    expect(plan.z).toBeCloseTo(fired.z, 9);
    // The sim's flight, plus the lead the crater is seen after.
    expect(plan.flightSeconds).toBeCloseTo(fired.flightSeconds + 0.18, 9);
    expect(resolveGroundBlastAim(pose, requested).clamped).toBe(true);
    expect(ownShotMuzzle(0, 0, 0)).toEqual({ x: 0, z: GROUND_BLAST_MUZZLE_NOSE_YD });
  });

  it('plans nothing without a lead to time it by', () => {
    expect(planOwnShotLaunch({ x: 0, z: 0, facing: 0 }, { x: 0, z: 30 }, null)).toBeNull();
    expect(planOwnShotLaunch({ x: 0, z: 0, facing: 0 }, { x: 0, z: 30 }, Number.NaN)).toBeNull();
  });

  it('derives the confirmation window from the lead, never a fixed constant', () => {
    for (const leadMs of [40, 120, 250, 400]) {
      expect(ownShotConfirmWindowS(leadMs)).toBeCloseTo((2 * leadMs) / 1000 + DT, 12);
      const plan = planOwnShotLaunch({ x: 0, z: 0, facing: 0 }, { x: 0, z: 30 }, leadMs);
      expect(plan?.confirmWithinS).toBe(ownShotConfirmWindowS(leadMs));
    }
    expect(ownShotConfirmWindowS(300)).toBeGreaterThan(ownShotConfirmWindowS(100));
  });

  it('keeps the ledger to the pilot, the window, and one shot', () => {
    const ledger = createOwnShotLedger();
    recordOwnShotLaunch(ledger, OWNER, 2, 5, 10, 0.3);
    // A rival's Fired event neither claims nor clears it.
    expect(claimOwnShotLaunch(ledger, RIVAL, 10.1)).toBeNull();
    expect(ledger.pending).not.toBeNull();
    expect(expireOwnShotLaunch(ledger, 10.3)).toBeNull();
    expect(claimOwnShotLaunch(ledger, OWNER, 10.2)).toMatchObject({ slot: 2, serial: 5 });
    expect(ledger.pending).toBeNull();
    // Late: the claim clears it but adopts nothing.
    recordOwnShotLaunch(ledger, OWNER, 3, 6, 20, 0.3);
    expect(claimOwnShotLaunch(ledger, OWNER, 20.31)).toBeNull();
    expect(ledger.pending).toBeNull();
    recordOwnShotLaunch(ledger, OWNER, 3, 7, 30, 0.3);
    expect(expireOwnShotLaunch(ledger, 30.31)).toMatchObject({ slot: 3, serial: 7 });
    expect(shellProgress(0.4, 0, 2)).toBe(0.4);
    expect(shellProgress(0.4, 1, 2)).toBeCloseTo(0.7, 12);
    expect(shellProgress(0.4, 3, 2)).toBe(1);
  });
});

describe('the own shell in the pooled Ground Blast visuals', () => {
  it('leaves the barrel on the input frame, toward the clamped target', () => {
    const v = launched(200);
    expect(v.inFlight).toBe(1);
    const shell = named(v, 'groundBlast0');
    expect(shell.visible).toBe(true);
    // Drawn at the muzzle on the very frame of the press.
    expect(shell.position.x).toBeCloseTo(0, 9);
    expect(shell.position.z).toBeCloseTo(GROUND_BLAST_MUZZLE_NOSE_YD, 9);
    expect(named(v, 'marker0').position.z).toBeCloseTo(30, 9);
    // Nothing without a lead: the event draws the shell as before.
    const offline = new RealmRacersGroundBlastVisuals();
    expect(offline.launchOwn(0, 0, 0, { x: 0, z: 30 }, null, flat, OWNER)).toBe(false);
    expect(offline.inFlight).toBe(0);
  });

  it('adopts the server confirmation as exactly one shell, gliding onto its target', () => {
    const v = launched(200);
    const materials = materialsOf(v);
    for (let i = 0; i < 12; i++) v.update(FRAME);
    const shell = named(v, 'groundBlast0');
    const before = shell.position.clone();
    // A rival shot in between draws its own shell and leaves ours pending.
    v.fire({ x: 50, z: 0, targetX: 50, targetZ: 30, flightSeconds: 0.6, sourceId: RIVAL }, 0);
    expect(v.inFlight).toBe(2);
    // The server put the target half a yard over and flies 0.55 s from now.
    const server = { x: 0, z: 2, targetX: 0.5, targetZ: 30, flightSeconds: 0.55, sourceId: OWNER };
    v.fire(server, 0);
    expect(v.inFlight).toBe(2);
    v.update(0.001);
    // Continuous at the adoption: no jump on the frame it lands.
    expect(shell.position.distanceTo(before)).toBeLessThan(0.1);
    let landed = 0;
    let lastX = shell.position.x;
    for (let t = 0; t < 0.54; t += FRAME) {
      v.update(FRAME);
      if (!shell.visible) break;
      lastX = shell.position.x;
      landed = t;
    }
    // Re-timed onto the server's flight and onto the server's target.
    expect(landed).toBeGreaterThan(0.5);
    expect(lastX).toBeGreaterThan(0.4);
    v.update(0.05);
    expect(shell.visible).toBe(false);
    // Pool only: the same materials, never re-versioned (no program change).
    expect(materialsOf(v)).toEqual(materials);
  });

  it('fades a refused shot mid-air with no crater, on the lead-derived window', () => {
    for (const leadMs of [100, 300]) {
      const v = launched(leadMs);
      const shell = named(v, 'groundBlast0');
      const window = ownShotConfirmWindowS(leadMs);
      let t = 0;
      while (t + FRAME < window) {
        v.update(FRAME);
        t += FRAME;
      }
      expect(shell.scale.x, `lead ${leadMs}: whole inside the window`).toBe(1);
      v.update(FRAME * 2);
      v.update(FRAME);
      expect(shell.scale.x, `lead ${leadMs}: shrinking past it`).toBeLessThan(1);
      expect(shell.visible).toBe(true);
      for (let i = 0; i < 30; i++) v.update(FRAME);
      expect(shell.visible).toBe(false);
      expect(v.inFlight).toBe(0);
      // No crater: nothing in the pool is showing, the flash and wave included.
      expect(v.group.children.filter((c) => c.visible)).toEqual([]);
      // A confirmation that finally turns up draws its own shell.
      v.fire({ x: 0, z: 2, targetX: 0, targetZ: 30, flightSeconds: 0.5, sourceId: OWNER }, 0);
      expect(v.inFlight).toBe(1);
    }
  });
});

describe('the own shell at a high lead, on a second press, and on uneven ground', () => {
  it('outlives its confirm window on a minimum-range shot at a lead above 0.4 s', () => {
    // A point-blank aim flies the minimum flight; at this lead the sim flight
    // plus lead would land before the window closes, and a confirmation that
    // arrived in that gap would draw a second shell.
    const leadMs = 450;
    const plan = planOwnShotLaunch({ x: 0, z: 0, facing: 0 }, { x: 0, z: 1 }, leadMs);
    if (!plan) throw new Error('no plan');
    const window = ownShotConfirmWindowS(leadMs);
    expect(plan.flightSeconds).toBeGreaterThanOrEqual(window + OWN_SHOT_UNCONFIRMED_FADE_S);
    const v = new RealmRacersGroundBlastVisuals();
    v.prepare();
    v.launchOwn(0, 0, 0, { x: 0, z: 1 }, leadMs, flat, OWNER);
    let t = 0;
    while (t < window - 2 * FRAME) {
      v.update(FRAME);
      t += FRAME;
    }
    expect(v.inFlight).toBe(1);
    // Confirmed right at the end of its window: adopted, one shell.
    v.fire({ x: 0, z: 2, targetX: 0, targetZ: 9, flightSeconds: 0.45, sourceId: OWNER }, 0);
    expect(v.inFlight).toBe(1);
  });

  it('fades the first shell of two quick presses when the first was refused', () => {
    const v = launched(200);
    for (let i = 0; i < 6; i++) v.update(FRAME);
    const first = named(v, 'groundBlast0');
    // The second press replaces the pending first, which can no longer be
    // adopted: it shrinks away while the second flies.
    expect(v.launchOwn(0, 0, 0, { x: 5, z: 30 }, 200, flat, OWNER)).toBe(true);
    expect(v.inFlight).toBe(2);
    v.update(FRAME);
    expect(first.scale.x).toBeLessThan(1);
    // The server confirms only the second: adopted, no third shell.
    v.fire({ x: 0, z: 2, targetX: 5, targetZ: 30, flightSeconds: 0.5, sourceId: OWNER }, 0);
    expect(v.inFlight).toBe(2);
    for (let i = 0; i < 20; i++) v.update(FRAME);
    expect(first.visible).toBe(false);
    expect(named(v, 'groundBlast1').visible).toBe(true);
    expect(v.inFlight).toBe(1);
  });

  it('re-samples the ground under the adopted target, easing the marker onto it', () => {
    const v = launched(200);
    for (let i = 0; i < 6; i++) v.update(FRAME);
    const marker = named(v, 'marker0');
    const before = marker.position.y;
    v.fire({ x: 0, z: 2, targetX: 0.5, targetZ: 30, flightSeconds: 0.5, sourceId: OWNER }, 3);
    v.update(0.001);
    expect(Math.abs(marker.position.y - before)).toBeLessThan(0.05);
    for (let t = 0; t < 0.49; t += FRAME) v.update(FRAME);
    expect(marker.position.y).toBeGreaterThan(2.9);
  });
});

describe('the own-shot launch is wired behind the local gate', () => {
  it('sends the HUD aim point through the gated press, after the one-in-flight latch', () => {
    const hudTs = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    const castAt = hudTs.indexOf('castAt: (id, point, barSlot) => {');
    const cast = hudTs.indexOf('this.sim.castAbilityAt(id, point);', castAt);
    const predict = hudTs.indexOf('predictRallyGroundBlastFire(this, id, point);', castAt);
    expect(castAt).toBeGreaterThan(0);
    expect(cast).toBeGreaterThan(castAt);
    expect(predict).toBeGreaterThan(cast);
    expect(hudTs.slice(castAt, predict)).not.toContain('},');
    const hud = readFileSync(
      new URL('../src/ui/hud/realm_racers/realm_racers_cast_feedback.ts', import.meta.url),
      'utf8',
    );
    const gate = hud.indexOf('if (rallyCastFeedbackAllowed(hud, id, REALM_RACERS_ABILITY_ID)) {');
    const call = hud.indexOf('(hud as RallyCastHost).renderer.predictOwnGroundBlastFire(point);');
    expect(gate).toBeGreaterThan(0);
    expect(call).toBeGreaterThan(gate);
    expect(hud.slice(gate, call)).not.toContain('}');
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const body = renderer.slice(renderer.indexOf('predictOwnGroundBlastFire(point'));
    const latch = body.indexOf('if (!canMarkOwnShotFeedback(');
    const launch = body.indexOf('this.realmRacersGroundBlasts.launchOwn(');
    expect(latch).toBeGreaterThan(0);
    expect(launch).toBeGreaterThan(latch);
    expect(body.slice(0, launch)).toContain('const lead = this.selfRender.reconciledLeadMs;');
  });
});
