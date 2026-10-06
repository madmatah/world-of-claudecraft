// The sky a Mortar Overdrive circuit flies: its theme's HDRI, the prefiltered
// environment built from it (PMREM) and the dome texture, prepared per sky key.
//
// The world's own lane cannot cover it: `prepareZoneSky` runs off zone
// residency, and the instance band belongs to no zone, so nothing else would
// ever ask for the Nightbloom's dome out there. The steps are the zone lane's:
// the key is pinned against eviction from the fetch to the last upload, the
// PMREM source uploads in its own budgeted unit, and PMREM generation (one
// indivisible block of GPU work) rides the renderer's GPU work queue at the
// zone sky's priority and label kind, never a bare promise continuation on
// whatever frame the fetch lands in. The key prepared is the one the dome and
// the IBL read (the theme's sky key, `farshore` included); only the grade
// tables take `mortarOverdriveSkyDayNightBiome`.
//
// The race preparation waits on it (mortar_overdrive/circuit_prepare.ts) so the
// lobby curtain covers it; the per-frame call from the band is one map lookup
// plus one residency read once asked. A key the residency lane evicted after
// it was ready is prepared again on the next ask.

import type * as THREE from 'three';
import { GPU_WORK_PRIORITY } from '../background_gpu_queue';
import { ensureSkyBiomeAssets, pinSkyBiomeAssets } from '../sky';
import type { MortarOverdriveSkyKey } from './themes';

/** The slice of the sky view this reads (rebuilt with the renderer's build). */
export interface MortarOverdriveSkyView {
  envTexture(biome: MortarOverdriveSkyKey): THREE.Texture | null;
  domeTexture(biome: MortarOverdriveSkyKey): THREE.Texture | null;
  skyBiomeAssetsResident(biome: MortarOverdriveSkyKey): boolean;
}

export interface MortarOverdriveSkyHost {
  sky(): MortarOverdriveSkyView;
  /** One unit of the renderer's GPU work queue. */
  run(work: () => unknown, priority: number, label: string): Promise<unknown>;
  /** One texture through the budgeted upload lane. */
  upload(texture: THREE.Texture | null): Promise<unknown>;
  /** The prefiltered environment, memoized per key (`ensureEnvironmentBiome`). */
  environment(biome: MortarOverdriveSkyKey): unknown;
  /** Whether this tier builds a prefiltered environment for a new key: a null
   *  one then means the sky failed, not that the tier skips it. */
  needsEnvironment(): boolean;
}

/** The sky module's fetch and pin, injected by a test. */
export interface MortarOverdriveSkyAssets {
  fetch(biome: MortarOverdriveSkyKey): Promise<unknown>;
  pin(biome: MortarOverdriveSkyKey): () => void;
}

const SKY_ASSETS: MortarOverdriveSkyAssets = {
  fetch: (biome) => ensureSkyBiomeAssets([biome]),
  pin: (biome) => pinSkyBiomeAssets([biome]),
};

interface SkyTask {
  readonly done: Promise<boolean>;
  ok: boolean | null;
}

export class MortarOverdriveSky {
  private readonly tasks = new Map<MortarOverdriveSkyKey, SkyTask>();

  constructor(
    private readonly host: MortarOverdriveSkyHost,
    private readonly assets: MortarOverdriveSkyAssets = SKY_ASSETS,
  ) {}

  /** Whether the sky prepared; never rejects. A failed key stays failed: the
   *  fetch memo keeps its rejection, so asking again would only fail again,
   *  and a circuit under the shipped sky is a worse look, not a broken frame. */
  ensure(biome: MortarOverdriveSkyKey): Promise<boolean> {
    const known = this.tasks.get(biome);
    if (known && !(known.ok === true && !this.host.sky().skyBiomeAssetsResident(biome))) {
      return known.done;
    }
    const task: SkyTask = { done: this.prepare(biome), ok: null };
    void task.done.then((ok) => {
      task.ok = ok;
    });
    this.tasks.set(biome, task);
    return task.done;
  }

  private async prepare(biome: MortarOverdriveSkyKey): Promise<boolean> {
    const host = this.host;
    const unpin = this.assets.pin(biome);
    try {
      await this.assets.fetch(biome);
      await host.upload(host.sky().envTexture(biome));
      await host.run(
        () => {
          const needed = host.needsEnvironment();
          if (host.environment(biome) === null && needed) throw new Error('no environment');
        },
        GPU_WORK_PRIORITY.VISIBLE_PREWARM,
        `pmrem:${biome}`,
      );
      await host.upload(host.sky().domeTexture(biome));
      return true;
    } catch {
      return false;
    } finally {
      unpin();
    }
  }
}
