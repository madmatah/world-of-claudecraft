// A seated racer cannot wear any look that claims the pilot's body ahead of
// the racer veil (ghost_style_core.ts riderVeilLook): no released spirit, no
// stealth, no Ghost Wolf and no form. The seat strips every aura
// (mortar_overdrive/race.ts standardizeRacer -> resetForArena, the arena clean
// slate), the kit is the Mortar Overdrive machine's alone (resolveMortarOverdriveKit), a
// dead or spirit pilot is retired at once, and no rival outside the race can
// reach a seated one (world_pvp.ts inInstancedPvp). So wherever the kart is
// not drawn yet, the pilot still wears the ward or the ghost itself.

import { describe, expect, it } from 'vitest';
import { characterFormMaskForAura } from '../src/render/characters/form_visual_selection_core';
import { startMortarOverdrivePractice } from '../src/sim/mortar_overdrive/bots';
import { mortarOverdriveMatchOf } from '../src/sim/mortar_overdrive/race';
import type { Aura } from '../src/sim/types';
import { addAt, makeWorld } from './mortar_overdrive_util';

const aura = (id: string, kind: string): Aura =>
  ({
    id,
    name: id,
    kind,
    remaining: 600,
    duration: 600,
    value: 1,
    sourceId: 0,
    school: 'physical',
  }) as Aura;

/** Every look the pilot's body can wear ahead of the racer veil. */
const claimsThePilot = (a: Pick<Aura, 'id' | 'kind'>): boolean =>
  a.kind === 'stealth' || a.id === 'ghost_wolf' || characterFormMaskForAura(a) !== 0;

describe('a seated racer holds nothing that claims the pilot ahead of the racer veil', () => {
  it('strips stealth, Ghost Wolf and every form at the seat, and the kit casts none', () => {
    const sim = makeWorld();
    const pid = addAt(sim, 'druid', 'Pilot');
    const e = sim.entities.get(pid);
    if (!e) throw new Error('no pilot');
    e.auras.push(
      aura('stealth', 'stealth'),
      aura('ghost_wolf', 'buff_speed'),
      aura('bear_form', 'form_bear'),
      aura('cat_form', 'form_cat'),
      aura('travel_form', 'form_travel'),
      aura('polymorph', 'polymorph'),
      aura('metamorphosis', 'form_metamorph'),
    );
    expect(e.auras.filter(claimsThePilot)).toHaveLength(7);
    expect(startMortarOverdrivePractice(sim, 'ace', pid)).toBe(true);
    expect(mortarOverdriveMatchOf(sim.ctx, pid)).not.toBeNull();
    expect(e.auras.filter(claimsThePilot)).toEqual([]);
    expect(e.ghost).toBe(false);
    const meta = sim.players.get(pid);
    const kit = meta?.known ?? [];
    expect(kit.length).toBeGreaterThan(0);
    for (const known of kit) {
      expect(known.def.id, 'ghost wolf').not.toBe('ghost_wolf');
      for (const effect of known.effects) {
        const fx = effect as { type: string; kind?: string; id?: string };
        expect(fx.type, known.def.id).not.toBe('greaterInvisibility');
        if (fx.kind) {
          expect(
            claimsThePilot({ id: fx.id ?? known.def.id, kind: fx.kind as never }),
            known.def.id,
          ).toBe(false);
        }
      }
    }
  });
});
