// A pilot held on the grid in the loading lobby cannot act, so nothing in the
// world may be able to start a fight with them there: no player through world
// PvP, and no camp spawning inside the Mortar Overdrive band. Talking is kept: the grid
// stands within say range of itself. What this does NOT cover is
// a mob moved next to the grid by hand: the combat system has no racer rule of
// its own, so the protection is that nothing hostile lives in the band.

import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import {
  MORTAR_OVERDRIVE_BAND_X_MAX,
  MORTAR_OVERDRIVE_BAND_X_MIN,
} from '../src/sim/mortar_overdrive/layout';
import { worldPvpFfaZones, worldPvpZonePolicyAt } from '../src/sim/pvp/world_pvp_zones';
import type { Sim } from '../src/sim/sim';
import { addAt, makeWorld, teleport } from './mortar_overdrive_util';

function seatedGrid(): { sim: Sim; pids: number[] } {
  const sim = makeWorld();
  const pids = [
    addAt(sim, 'warrior', 'Aster', -5, -40),
    addAt(sim, 'mage', 'Briar', 7, -42),
    addAt(sim, 'rogue', 'Cass', -9, -38),
    addAt(sim, 'priest', 'Dell', 11, -44),
  ];
  for (const pid of pids) sim.mortarOverdriveQueueJoin(pid);
  sim.tick();
  return { sim, pids };
}

describe('Mortar Overdrive lobby safety', () => {
  it('keeps a lobby pilot out of world PvP, even on free-for-all ground', () => {
    const { sim, pids } = seatedGrid();
    const pilotId = pids[0] as number;
    const pilot = sim.entities.get(pilotId);
    if (!pilot) throw new Error('missing pilot');
    expect(sim.mortarOverdriveInfoFor(pilotId).match?.phase).toBe('loading');
    // Free-for-all ground makes any two players hostile with no flag, so it is
    // the strongest place to ask; the seat, not the ground, must refuse.
    const ffa = worldPvpFfaZones()[0];
    if (!ffa) throw new Error('no free-for-all zone');
    const x = ((ffa.xMin ?? -100) + (ffa.xMax ?? 100)) / 2;
    const z = (ffa.zMin + ffa.zMax) / 2;
    teleport(sim, pilotId, x, z);
    const rivalId = addAt(sim, 'rogue', 'Fence', x + 2, z);
    const bystanderId = addAt(sim, 'mage', 'Bystander', x + 1, z);
    const rival = sim.entities.get(rivalId);
    const bystander = sim.entities.get(bystanderId);
    if (!rival || !bystander) throw new Error('missing players');
    expect(worldPvpZonePolicyAt(x, z)).toBe('ffa');
    expect(sim.ctx.isHostileTo(rival, bystander)).toBe(true);
    expect(sim.ctx.isHostileTo(rival, pilot)).toBe(false);
    expect(sim.ctx.isHostileTo(pilot, rival)).toBe(false);
  });

  it('lets the grid talk: a /s line from a lobby pilot reaches every pilot', () => {
    const { sim, pids } = seatedGrid();
    const speaker = pids[0] as number;
    expect(sim.mortarOverdriveInfoFor(speaker).match?.phase).toBe('loading');
    sim.chat('/s ready when you are', speaker);
    const heard = sim
      .tick()
      .filter((event) => event.type === 'chat' && event.channel === 'say')
      .map((event) => (event as { pid: number }).pid)
      .sort((a, b) => a - b);
    expect(heard).toEqual([...pids].sort((a, b) => a - b));
  });

  it('spawns no camp inside the Mortar Overdrive band', () => {
    const inBand = BUILTIN_WORLD.camps.filter(
      (camp) =>
        camp.center.x + camp.radius >= MORTAR_OVERDRIVE_BAND_X_MIN &&
        camp.center.x - camp.radius <= MORTAR_OVERDRIVE_BAND_X_MAX,
    );
    expect(BUILTIN_WORLD.camps.length).toBeGreaterThan(0);
    expect(inBand).toEqual([]);
  });
});
