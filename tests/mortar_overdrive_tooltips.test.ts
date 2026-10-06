// The Mortar Overdrive tooltips against the live mechanic: the three kit abilities
// on the action bar and the two effects a racer suffers in the aura row. Every
// figure a player reads is a placeholder filled from the sim's own tuning, so
// these cases render the real text and compare each number with what the race
// actually does to a machine.

import { describe, expect, it } from 'vitest';
import { mortarOverdriveCompetitionCircuits } from '../src/sim/content/mortar_overdrive/circuits';
import {
  MORTAR_OVERDRIVE_ABILITIES,
  MORTAR_OVERDRIVE_ABILITY_ID,
  MORTAR_OVERDRIVE_ABILITY_TEXT_VALUES,
  MORTAR_OVERDRIVE_NITRO_ABILITY_ID,
  MORTAR_OVERDRIVE_SLICK_ABILITY_ID,
  mortarOverdriveAbilityTextValues,
  resolveMortarOverdriveKit,
} from '../src/sim/content/mortar_overdrive/kit';
import {
  GROUND_BLAST_AIM_CONE_RAD,
  GROUND_BLAST_CONTROL_SECONDS,
  GROUND_BLAST_CONTROL_SPEED_MULT,
  GROUND_BLAST_CORE_RADIUS,
  GROUND_BLAST_MAX_FLIGHT,
  GROUND_BLAST_MIN_RANGE,
  GROUND_BLAST_RADIUS,
  GROUND_BLAST_SHOCK_GRIP,
  GROUND_BLAST_SHOCK_TICKS,
  resolveGroundBlastAim,
} from '../src/sim/mortar_overdrive/ground_blast';
import { MORTAR_OVERDRIVE_GRID_SIZE } from '../src/sim/mortar_overdrive/layout';
import {
  MORTAR_OVERDRIVE_NITRO_KICK,
  MORTAR_OVERDRIVE_NITRO_SPEED_MULT,
  MORTAR_OVERDRIVE_NITRO_TICKS,
} from '../src/sim/mortar_overdrive/pickup_effects';
import {
  MORTAR_OVERDRIVE_GARDEN_BAND,
  MORTAR_OVERDRIVE_GROUND_BLAST_AURA,
  MORTAR_OVERDRIVE_OFF_TRACK_AURA,
  MORTAR_OVERDRIVE_VERGE_BAND,
  mortarOverdriveFireGroundBlast,
  mortarOverdriveSpendPickupEffect,
  mortarOverdriveStartMatch,
  mortarOverdriveToWorld,
  updateMortarOverdrive,
} from '../src/sim/mortar_overdrive/race';
import {
  MORTAR_OVERDRIVE_SLICK_GRIP,
  MORTAR_OVERDRIVE_SLICK_GRIP_TICKS,
  MORTAR_OVERDRIVE_SLICK_LIFETIME_TICKS,
} from '../src/sim/mortar_overdrive/slicks';
import { mortarOverdriveTrack } from '../src/sim/mortar_overdrive/spline';
import type { Sim } from '../src/sim/sim';
import { type Entity, TICK_RATE } from '../src/sim/types';
import { abilityDisplayDescription, abilityEffectText } from '../src/ui/ability_description';
import type { AuraEffectInput } from '../src/ui/aura_effect';
import { formatNumber } from '../src/ui/i18n';
import { classAbilityNamesEn } from '../src/ui/i18n.catalog/abilities';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';
import { renderAuraEffectLine } from './helpers/aura_effect_line';
import { addAt, makeWorld, teleport } from './mortar_overdrive_util';

const RACE_CIRCUIT = mortarOverdriveCompetitionCircuits()[0];
const MORTAR_OVERDRIVE_IDS = [
  MORTAR_OVERDRIVE_ABILITY_ID,
  MORTAR_OVERDRIVE_NITRO_ABILITY_ID,
  MORTAR_OVERDRIVE_SLICK_ABILITY_ID,
] as const;

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${label}`);
  return value;
}

/** The figure exactly as a tooltip prints it (the description's own format). */
const shown = (value: number): string => formatNumber(value, { maximumFractionDigits: 2 });

/** The kit a seated racer holding both pickups carries, as the bar resolves it. */
function mortarOverdriveTooltip(abilityId: string): string {
  const kit = resolveMortarOverdriveKit(MORTAR_OVERDRIVE_ABILITY_ID, 3, [
    { effect: 'nitro', charges: 1 },
    { effect: 'slick', charges: 1 },
  ]);
  const res = required(
    kit.find((known) => known.def.id === abilityId),
    abilityId,
  );
  return abilityDisplayDescription(res, abilityEffectText(res));
}

/** A live race with the flag down: racers a and b on the grid, the rest far away. */
function racing() {
  const sim = makeWorld();
  const pids = Array.from({ length: MORTAR_OVERDRIVE_GRID_SIZE }, (_, i) =>
    addAt(sim, 'warrior', `Racer${i}`, -6 + i * 4, -40 - i),
  );
  mortarOverdriveStartMatch(sim.ctx, pids, undefined, RACE_CIRCUIT.id);
  sim.tick();
  const match = required(sim.mortarOverdrive.match, 'race');
  const track = mortarOverdriveTrack(RACE_CIRCUIT);
  pids.slice(2).forEach((pid, i) => {
    const away = track.pointAt(track.length * (0.4 + i * 0.2));
    teleport(sim, pid, match.origin.x + away.x, match.origin.z + away.z);
  });
  match.phase = 'racing';
  updateMortarOverdrive(sim.ctx);
  const [a, b] = pids;
  return {
    sim,
    match,
    a,
    b,
    racerA: required(sim.entities.get(a), 'racer a'),
    racerB: required(sim.entities.get(b), 'racer b'),
  };
}

/** Parks a machine on a circuit-local point, with the lap bookkeeping a machine
 *  that drove there would carry, so the referee never reads the jump as a cut. */
function standAt(sim: Sim, pid: number, x: number, z: number): void {
  const match = required(sim.mortarOverdrive.match, 'race');
  const world = mortarOverdriveToWorld(match, x, z);
  teleport(sim, pid, world.x, world.z);
  const progress = required(match.progress.get(pid), `progress ${pid}`);
  const projection = mortarOverdriveTrack(RACE_CIRCUIT).project(x, z, progress.trackIndex);
  progress.lastS = projection.s;
  progress.trackIndex = projection.index;
}

function auraOn(racer: Entity, id: string): AuraEffectInput {
  const aura = required(
    racer.auras.find((candidate) => candidate.id === id),
    `aura ${id}`,
  );
  return { id: aura.id, kind: aura.kind, value: aura.value };
}

describe('Mortar Overdrive ability tooltips', () => {
  it('Ground Blast prints every live figure of the shot and the hit', () => {
    const aimed = (requested: { x: number; z: number }) =>
      resolveGroundBlastAim({ x: 0, z: 0, facing: 0 }, requested);
    // The flight window as the shell really flies it: a point-blank aim slides out
    // to the minimum range and a far one is held to the maximum.
    const shortest = aimed({ x: 0, z: 1 }).flightTicks / TICK_RATE;
    const longest = aimed({ x: 0, z: 1000 }).flightTicks / TICK_RATE;
    const text = mortarOverdriveTooltip(MORTAR_OVERDRIVE_ABILITY_ID);
    expect(text).toBe(
      `Fire a shell at a spot on the ground at least ${shown(GROUND_BLAST_MIN_RANGE)} yards ahead and within ${shown(
        (GROUND_BLAST_AIM_CONE_RAD * 180) / Math.PI,
      )} degrees of your nose. It lands ${shown(shortest)} to ${shown(longest)} sec later. Every rival within ${shown(
        GROUND_BLAST_RADIUS,
      )} yards of the landing is thrown up and away, at full force within ${shown(
        GROUND_BLAST_CORE_RADIUS,
      )} yards and weaker toward the edge. They also lose ${shown(
        (1 - GROUND_BLAST_SHOCK_GRIP) * 100,
      )}% of their grip for ${shown(GROUND_BLAST_SHOCK_TICKS / TICK_RATE)} sec and are slowed by ${shown(
        (1 - GROUND_BLAST_CONTROL_SPEED_MULT) * 100,
      )}% for ${shown(GROUND_BLAST_CONTROL_SECONDS)} sec. A Racing Ward absorbs the hit.`,
    );
    for (const value of [
      GROUND_BLAST_MIN_RANGE,
      (GROUND_BLAST_AIM_CONE_RAD * 180) / Math.PI,
      shortest,
      longest,
      GROUND_BLAST_RADIUS,
      GROUND_BLAST_CORE_RADIUS,
      (1 - GROUND_BLAST_SHOCK_GRIP) * 100,
      GROUND_BLAST_SHOCK_TICKS / TICK_RATE,
      (1 - GROUND_BLAST_CONTROL_SPEED_MULT) * 100,
      GROUND_BLAST_CONTROL_SECONDS,
    ]) {
      expect(text).toContain(formatNumber(value));
    }
    // The clamp holds the longest reachable flight under the authored ceiling, so
    // the window has to come from the flight function, never the ceiling.
    expect(longest).toBeLessThan(GROUND_BLAST_MAX_FLIGHT);
  });

  it('Nitro prints the kick, the raised cap and the burst exactly as a spend applies them', () => {
    const { sim, match, a, racerA } = racing();
    const progress = required(match.progress.get(a), 'progress');
    progress.heldEffect = 'nitro';
    const drive = required(racerA.drive, 'drive');
    const before = drive.speed;
    mortarOverdriveSpendPickupEffect(sim.ctx, racerA, 'nitro');
    const kick = drive.speed - before;
    const raisedPct = Math.round((drive.speedCap - 1) * 100);
    const burstSeconds = (progress.nitroUntilTick - sim.tickCount) / TICK_RATE;
    expect([kick, drive.speedCap, burstSeconds * TICK_RATE]).toEqual([
      MORTAR_OVERDRIVE_NITRO_KICK,
      MORTAR_OVERDRIVE_NITRO_SPEED_MULT,
      MORTAR_OVERDRIVE_NITRO_TICKS,
    ]);

    const text = mortarOverdriveTooltip(MORTAR_OVERDRIVE_NITRO_ABILITY_ID);
    expect(text).toBe(
      `Burn your nitro for an instant ${shown(kick)} yards per second push forward. For ${shown(
        burstSeconds,
      )} sec, your top speed is raised ${shown(raisedPct)}% above your machine's normal cap.`,
    );
    expect(text).toContain(formatNumber(MORTAR_OVERDRIVE_NITRO_KICK));
    expect(text).toContain(formatNumber((MORTAR_OVERDRIVE_NITRO_SPEED_MULT - 1) * 100));
    expect(text).toContain(formatNumber(MORTAR_OVERDRIVE_NITRO_TICKS / TICK_RATE));
  });

  it('Oil Slick prints the patch lifetime and the grip a crossing takes, as a race applies them', () => {
    const { sim, match, a, b, racerA, racerB } = racing();
    const track = mortarOverdriveTrack(RACE_CIRCUIT);
    // On the road's centre line, so the surface under the crossing is the
    // neutral road and every bit of grip the rival loses is the oil's.
    const spot = track.pointAt(track.length * 0.25);
    standAt(sim, a, spot.x, spot.z);
    required(match.progress.get(a), 'progress a').heldEffect = 'slick';
    mortarOverdriveSpendPickupEffect(sim.ctx, racerA, 'slick');
    const patch = required(match.slicks[0], 'patch');
    const lifetimeSeconds = (patch.expiresTick - sim.tickCount) / TICK_RATE;

    // The dropper drives on and the rival arrives on the patch: the crossing arms
    // the grip window, and the next surface pass hands the cut grip to the drive.
    const onward = track.pointAt(track.length * 0.5);
    standAt(sim, a, onward.x, onward.z);
    standAt(sim, b, spot.x, spot.z);
    sim.tick();
    const progressB = required(match.progress.get(b), 'progress b');
    const gripSeconds = (progressB.slickGripUntilTick - sim.tickCount) / TICK_RATE;
    sim.tick();
    expect(racerB.auras.some((aura) => aura.id === MORTAR_OVERDRIVE_OFF_TRACK_AURA)).toBe(false);
    const gripLostPct = Math.round((1 - required(racerB.drive, 'drive b').gripMult) * 100);
    expect([lifetimeSeconds * TICK_RATE, gripSeconds * TICK_RATE, gripLostPct]).toEqual([
      MORTAR_OVERDRIVE_SLICK_LIFETIME_TICKS,
      MORTAR_OVERDRIVE_SLICK_GRIP_TICKS,
      Math.round((1 - MORTAR_OVERDRIVE_SLICK_GRIP) * 100),
    ]);

    const text = mortarOverdriveTooltip(MORTAR_OVERDRIVE_SLICK_ABILITY_ID);
    expect(text).toBe(
      `Drop a patch of oil under your machine. It stays on the track for ${shown(
        lifetimeSeconds,
      )} sec. A rival who drives into it is pushed sideways, harder the faster they are going, and loses ${shown(
        gripLostPct,
      )}% of their grip for ${shown(gripSeconds)} sec. Your own oil cannot catch you until you have driven out of it. A Racing Ward absorbs it.`,
    );
    expect(text).toContain(formatNumber(MORTAR_OVERDRIVE_SLICK_LIFETIME_TICKS / TICK_RATE));
    expect(text).toContain(formatNumber((1 - MORTAR_OVERDRIVE_SLICK_GRIP) * 100));
    expect(text).toContain(formatNumber(MORTAR_OVERDRIVE_SLICK_GRIP_TICKS / TICK_RATE));
  });

  it('keeps every figure out of the English source and every placeholder fillable', () => {
    const catalog = classAbilityNamesEn.entities.abilities;
    for (const id of MORTAR_OVERDRIVE_IDS) {
      const english = catalog[id].description;
      expect(english, id).not.toMatch(/\d/);
      const figures = required(mortarOverdriveAbilityTextValues(id), id);
      const tokens = [...english.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]);
      expect(tokens.sort(), id).toEqual(Object.keys(figures).sort());
      // The sim-source description is the same sentence with the same figures in,
      // so the fallback path can never state a different rule.
      const filled = english.replace(/\{([A-Za-z0-9_]+)\}/g, (_, name: string) =>
        String(figures[name]),
      );
      expect(MORTAR_OVERDRIVE_ABILITIES[id].description, id).toBe(filled);
      expect(MORTAR_OVERDRIVE_ABILITIES[id].description, id).not.toMatch(/[{}$]/);
    }
    expect(Object.keys(MORTAR_OVERDRIVE_ABILITY_TEXT_VALUES).sort()).toEqual(
      [...MORTAR_OVERDRIVE_IDS].sort(),
    );
    expect(mortarOverdriveAbilityTextValues('fireball')).toBeNull();
    expect(mortarOverdriveAbilityTextValues('constructor')).toBeNull();
  });
});

describe('Mortar Overdrive aura effect lines', () => {
  it('a Ground Blast hit states the slow, the grip loss and how long the grip stays gone', () => {
    const { sim, match, a, b, racerA, racerB } = racing();
    racerA.facing = 0;
    racerB.facing = 0;
    teleport(sim, a, racerA.pos.x, racerA.pos.z);
    teleport(sim, b, racerA.pos.x, racerA.pos.z + 14);
    updateMortarOverdrive(sim.ctx);
    const surfaceGrip = required(racerB.drive, 'drive b').gripMult;
    racerA.castAim = { x: racerB.pos.x, y: racerB.pos.y, z: racerB.pos.z };
    mortarOverdriveFireGroundBlast(sim.ctx, racerA);
    const shell = required(match.groundBlasts[0], 'shell');
    while (sim.tickCount < shell.impactTick) sim.tick();
    const progressB = required(match.progress.get(b), 'progress b');
    const shockSeconds = (progressB.groundBlastShockUntilTick - shell.impactTick) / TICK_RATE;
    updateMortarOverdrive(sim.ctx);
    const gripLostPct = Math.round(
      (1 - required(racerB.drive, 'drive b').gripMult / surfaceGrip) * 100,
    );
    const aura = auraOn(racerB, MORTAR_OVERDRIVE_GROUND_BLAST_AURA);
    expect([aura.value, shockSeconds * TICK_RATE, gripLostPct]).toEqual([
      GROUND_BLAST_CONTROL_SPEED_MULT,
      GROUND_BLAST_SHOCK_TICKS,
      Math.round((1 - GROUND_BLAST_SHOCK_GRIP) * 100),
    ]);

    const line = renderAuraEffectLine(aura);
    expect(line).toBe(
      `Reduces movement speed by ${formatNumber(Math.round((1 - aura.value) * 100))}%. Your machine has ${formatNumber(
        gripLostPct,
      )}% less grip for ${formatNumber(shockSeconds)} sec after the hit.`,
    );
    expect(line).toContain(formatNumber((1 - GROUND_BLAST_CONTROL_SPEED_MULT) * 100));
    expect(line).toContain(formatNumber((1 - GROUND_BLAST_SHOCK_GRIP) * 100));
    expect(line).toContain(formatNumber(GROUND_BLAST_SHOCK_TICKS / TICK_RATE));
    expect(hudChromeStrings.auraEffect.mortarOverdriveGroundBlast).not.toMatch(/\d/);
  });

  it('each off-track band states its own slow, grip and drag, read off the live surface', () => {
    const { sim, match, a, racerA } = racing();
    const sample = mortarOverdriveTrack(RACE_CIRCUIT).samples[120];
    // Outward is garden all the way to the wall on every circuit; the verge sits
    // just past the road edge (the bands' own placement in the match suite).
    const at = (offset: number) => {
      teleport(
        sim,
        a,
        match.origin.x + sample.x - sample.tz * offset,
        match.origin.z + sample.z + sample.tx * offset,
      );
      updateMortarOverdrive(sim.ctx);
      const drive = required(racerA.drive, 'drive');
      return {
        aura: auraOn(racerA, MORTAR_OVERDRIVE_OFF_TRACK_AURA),
        grip: drive.gripMult,
        drag: drive.dragMult,
      };
    };
    const expectBand = (
      surface: ReturnType<typeof at>,
      band: typeof MORTAR_OVERDRIVE_VERGE_BAND,
    ): void => {
      expect([surface.aura.value, surface.grip, surface.drag]).toEqual([
        band.speedMult,
        band.gripMult,
        band.dragMult,
      ]);
      const line = renderAuraEffectLine(surface.aura);
      expect(line).toBe(
        `Reduces movement speed by ${formatNumber(Math.round((1 - surface.aura.value) * 100))}%. Your machine has ${formatNumber(
          Math.round((1 - surface.grip) * 100),
        )}% less grip and ${formatNumber(surface.drag)} times the drag it has on the road. Lasts until you are back on the road.`,
      );
      expect(line).toContain(formatNumber((1 - band.speedMult) * 100));
      expect(line).toContain(formatNumber((1 - band.gripMult) * 100));
      expect(line).toContain(formatNumber(band.dragMult));
    };
    expectBand(at(sample.halfWidth + 1.5), MORTAR_OVERDRIVE_VERGE_BAND);
    expectBand(at(-(sample.halfWidth + 9)), MORTAR_OVERDRIVE_GARDEN_BAND);
    expect(hudChromeStrings.auraEffect.mortarOverdriveOffTrack).not.toMatch(/\d/);
  });

  it('falls back to the plain slow line for an off-track value no band carries', () => {
    const stale = { id: MORTAR_OVERDRIVE_OFF_TRACK_AURA, kind: 'slow' as const, value: 0.9 };
    expect(renderAuraEffectLine(stale)).toBe(`Reduces movement speed by ${formatNumber(10)}%`);
  });
});
