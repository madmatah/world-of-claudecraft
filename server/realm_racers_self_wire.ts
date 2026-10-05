// The Realm Racers keys of the snapshot self record, beside the quest and bank
// self-key leaves (game.ts sits at a zero-margin monolith ceiling). The host
// calls each emitter at its own spot so the self JSON keeps its key order.
import { realmRacersHeldEffectOf } from '../src/sim/content/realm_racers';
import type { RallyHeldEffect } from '../src/sim/realm_racers_pickup_effects';
import { splitRealmRacersInfo } from '../src/sim/realm_racers_readout_clock';
import type { PlayerMeta, Sim } from '../src/sim/sim';
import { realmRacersSeatedOrQueued } from '../src/sim/social/realm_racers';
import type { RealmRacersInfo } from '../src/world_api/realm_racers';
import {
  createRealmReadoutMemo,
  type RealmReadoutMemo,
  realmReadoutJson,
} from './realm_readout_memo';

type EmitSelfKey = (key: string, value: unknown) => void;

type RealmRacersSelfSim = Pick<
  Sim,
  'ctx' | 'tickCount' | 'realmRacersInfoFor' | 'realmRacersTracksideFor'
>;

/** One idle-readout memo per Sim (server-host state, keyed by the Sim so two
 *  realms in one process never share a build). */
const idleReadouts = new WeakMap<object, RealmReadoutMemo<RealmRacersInfo>>();

/** The memo behind the idle `rr`, created on a Sim's first pass. */
export function realmRacersIdleReadout(sim: object): RealmReadoutMemo<RealmRacersInfo> {
  let memo = idleReadouts.get(sim);
  if (!memo) {
    memo = createRealmReadoutMemo<RealmRacersInfo>();
    idleReadouts.set(sim, memo);
  }
  return memo;
}

/** The per-tick `rr` (queue and heat), `rrc` (the heat's clocks) and `rrt`
 *  (trackside lane) keys. */
export function emitRealmRacersSelfKeys(
  maybe: EmitSelfKey,
  maybeRaw: (key: string, serialized: string) => void,
  sim: RealmRacersSelfSim,
  pid: number,
): void {
  // Almost every viewer is neither queued nor seated, and for all of them the
  // readout is the same value (no queue place, no heat, the realm's free
  // practice copy and queue viability): built and stringified once per pass
  // through the realm-readout memo and shipped raw, like the `dfb` board (and,
  // like it, one pass stale on a broadcast that ran no tick, healed next pass).
  if (!realmRacersSeatedOrQueued(sim.ctx, pid)) {
    maybeRaw(
      'rr',
      realmReadoutJson(realmRacersIdleReadout(sim), sim.tickCount, () =>
        sim.realmRacersInfoFor(pid),
      ),
    );
    maybeRaw('rrc', 'null');
  } else {
    emitRealmRacersHeatKeys(maybe, sim, pid);
  }
  // The lane the viewer is STANDING on while not seated in its race: null for
  // almost everyone (the lane test is the same O(1) band check the movement
  // kernel runs), and the slick/box arrays are bounded by the circuit's own
  // pickup and slick counts and built once per match per tick, so a stand
  // full of watchers serializes one build.
  maybe('rrt', sim.realmRacersTracksideFor(pid));
}

/** The per-viewer `rr` and `rrc` of a queued or seated viewer. */
function emitRealmRacersHeatKeys(maybe: EmitSelfKey, sim: RealmRacersSelfSim, pid: number): void {
  // Per-tick, bounded by the race grid: at most REALM_RACERS_GRID_SIZE
  // standings rows, the circuit's boxes and REALM_RACERS_SLICK_CAP patches,
  // plus three queue scalars (one indexOf over the realm queue). The clocks
  // and the speed move every racing tick, so they ride `rrc` on their own:
  // `rr` then matches its last send, and is skipped, until something real
  // changes (an overtake, a box, a patch of oil).
  const { still, clock } = splitRealmRacersInfo(sim.realmRacersInfoFor(pid));
  maybe('rr', still);
  maybe('rrc', clock);
}

/** The wireRev-gated `rrkit` key of the heavy self block. */
export function emitRealmRacersKitKey(
  maybe: EmitSelfKey,
  meta: Pick<PlayerMeta, 'realmRacersMatchId' | 'known'>,
): void {
  // The Realm Racers kit flag: while set, the client's action bar rebuilds
  // the race kit instead of the class kit. It rides the wireRev-gated block
  // because the sim bumps wireRev on BOTH the grid-up swap and the restore,
  // so maybe() serializes each flip, including the restore's EXPLICIT null
  // (delta omission means "unchanged" and would strand the client on the
  // race kit). It names the weapon in the racer's SLOT (`w`) plus that
  // weapon's per-race budget (`c`), read straight off the kit the sim
  // actually granted, so a mirror never has to guess which ability a racer
  // is holding. The live remaining count is not here: it rides `achg`, the
  // shared charge wire.
  const rallyWeapon = meta.realmRacersMatchId !== null ? meta.known[0] : undefined;
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
  const rallyHeld = rallyWeapon
    ? meta.known
        .slice(1)
        .map((known) => realmRacersHeldEffectOf(known.def.id))
        .filter((effect): effect is RallyHeldEffect => effect !== null)
    : [];
  maybe(
    'rrkit',
    rallyWeapon
      ? {
          active: true,
          w: rallyWeapon.def.id,
          c: rallyWeapon.charges ?? null,
          ...(rallyHeld.length > 0 ? { h: rallyHeld } : {}),
        }
      : null,
  );
}
