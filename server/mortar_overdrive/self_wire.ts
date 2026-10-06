// The Mortar Overdrive keys of the snapshot self record, beside the quest and bank
// self-key leaves (game.ts sits at a zero-margin monolith ceiling). The host
// calls each emitter at its own spot so the self JSON keeps its key order.
import { mortarOverdriveHeldEffectOf } from '../../src/sim/content/mortar_overdrive/kit';
import type { MortarOverdriveHeldEffect } from '../../src/sim/mortar_overdrive';
import {
  mortarOverdriveSeatedOrQueued,
  mortarOverdriveTracksideFor,
} from '../../src/sim/mortar_overdrive/race';
import {
  mortarOverdriveStillToWire,
  splitMortarOverdriveInfo,
} from '../../src/sim/mortar_overdrive/readout_clock';
import type { PlayerMeta, Sim } from '../../src/sim/sim';
import type { MortarOverdriveInfo } from '../../src/world_api/mortar_overdrive';
import {
  createRealmReadoutMemo,
  type RealmReadoutMemo,
  realmReadoutJson,
} from '../realm_readout_memo';

type EmitSelfKey = (key: string, value: unknown) => void;

type MortarOverdriveSelfSim = Pick<Sim, 'ctx' | 'tickCount' | 'mortarOverdriveInfoFor'>;

/** One idle-readout memo per Sim (server-host state, keyed by the Sim so two
 *  realms in one process never share a build). */
const idleReadouts = new WeakMap<object, RealmReadoutMemo<MortarOverdriveInfo>>();

/** The memo behind the idle `mo`, created on a Sim's first pass. */
export function mortarOverdriveIdleReadout(sim: object): RealmReadoutMemo<MortarOverdriveInfo> {
  let memo = idleReadouts.get(sim);
  if (!memo) {
    memo = createRealmReadoutMemo<MortarOverdriveInfo>();
    idleReadouts.set(sim, memo);
  }
  return memo;
}

/** The per-tick `mo` (queue and heat), `moc` (the heat's clocks) and `mot`
 *  (trackside lane) keys. */
export function emitMortarOverdriveSelfKeys(
  maybe: EmitSelfKey,
  maybeRaw: (key: string, serialized: string) => void,
  sim: MortarOverdriveSelfSim,
  pid: number,
): void {
  // Almost every viewer is neither queued nor seated, and for all of them the
  // readout is the same value (no queue place, no heat, the realm's free
  // practice copy): built and stringified once per pass
  // through the realm-readout memo and shipped raw, like the `dfb` board (and,
  // like it, one pass stale on a broadcast that ran no tick, healed next pass).
  if (!mortarOverdriveSeatedOrQueued(sim.ctx, pid)) {
    maybeRaw(
      'mo',
      realmReadoutJson(mortarOverdriveIdleReadout(sim), sim.tickCount, () =>
        sim.mortarOverdriveInfoFor(pid),
      ),
    );
    maybeRaw('moc', 'null');
  } else {
    emitMortarOverdriveHeatKeys(maybe, sim, pid);
  }
  // The lane the viewer is STANDING on while not seated in its race: null for
  // almost everyone (the lane test is the same O(1) band check the movement
  // kernel runs), and the slick/box arrays are bounded by the circuit's own
  // pickup and slick counts and built once per match per tick, so a stand
  // full of watchers serializes one build.
  maybe('mot', mortarOverdriveTracksideFor(sim.ctx, pid));
}

/** The per-viewer `mo` and `moc` of a queued or seated viewer. */
function emitMortarOverdriveHeatKeys(
  maybe: EmitSelfKey,
  sim: MortarOverdriveSelfSim,
  pid: number,
): void {
  // Per-tick, bounded by the race grid: at most MORTAR_OVERDRIVE_GRID_SIZE
  // standings rows, the circuit's boxes and MORTAR_OVERDRIVE_SLICK_CAP patches,
  // plus three queue scalars (one indexOf over the realm queue) and, while
  // queued, the start readout (at most a grid of seats off the queue head). The clocks
  // and the speed move every racing tick, so they ride `moc` on their own:
  // `mo` then matches its last send, and is skipped, until something real
  // changes (an overtake, a box, a patch of oil).
  // A queued viewer's start rides as its absolute deadline tick, which holds
  // still while the deadline does, so the countdown costs `mo` nothing per tick.
  const { still, clock } = splitMortarOverdriveInfo(sim.mortarOverdriveInfoFor(pid));
  maybe('mo', mortarOverdriveStillToWire(still, sim.tickCount));
  maybe('moc', clock);
}

/** The wireRev-gated `mokit` key of the heavy self block. */
export function emitMortarOverdriveKitKey(
  maybe: EmitSelfKey,
  meta: Pick<PlayerMeta, 'mortarOverdriveMatchId' | 'known'>,
): void {
  // The Mortar Overdrive kit flag: while set, the client's action bar rebuilds
  // the race kit instead of the class kit. It rides the wireRev-gated block
  // because the sim bumps wireRev on BOTH the grid-up swap and the restore,
  // so maybe() serializes each flip, including the restore's EXPLICIT null
  // (delta omission means "unchanged" and would strand the client on the
  // race kit). It names the weapon in the racer's SLOT (`w`) plus that
  // weapon's per-race budget (`c`), read straight off the kit the sim
  // actually granted, so a mirror never has to guess which ability a racer
  // is holding. The live remaining count is not here: it rides `achg`, the
  // shared charge wire.
  const mortarOverdriveWeapon = meta.mortarOverdriveMatchId !== null ? meta.known[0] : undefined;
  // `h` is the LIST of HELD pickup effects (22b), the abilities the kit
  // grants beside the weapon. It rides the kit flag rather than a field of
  // its own because the mirror rebuilds the whole kit from this payload:
  // sending the weapon alone would leave an online pilot holding an effect
  // they have no button for.
  //
  // A LIST, and read off the whole kit rather than `known[1]`, because a
  // racer can hold more than one at a time (a dev grant hands out a stack of
  // each). Reading one slot silently dropped whatever the sim put second:
  // the oil went missing online exactly this way while the nitro beside it
  // came through. The COUNTS are not here, they ride `achg` like every other
  // charge-limited ability.
  const mortarOverdriveHeld = mortarOverdriveWeapon
    ? meta.known
        .slice(1)
        .map((known) => mortarOverdriveHeldEffectOf(known.def.id))
        .filter((effect): effect is MortarOverdriveHeldEffect => effect !== null)
    : [];
  maybe(
    'mokit',
    mortarOverdriveWeapon
      ? {
          active: true,
          w: mortarOverdriveWeapon.def.id,
          c: mortarOverdriveWeapon.charges ?? null,
          ...(mortarOverdriveHeld.length > 0 ? { h: mortarOverdriveHeld } : {}),
        }
      : null,
  );
}
