// The HUD's rally cast affordances: the pose the aim clamp measures from, the
// instant local cues of a rally shot or oil drop, and the refusal of a kit
// ability the activity is holding. Hud members are private, so these take the
// Hud untyped (the quest_event_router.ts precedent); the members they read are
// welded to hud.ts in tests/realm_racers_ui.test.ts.

import { isAbilityBudgetSpent, isAbilityLockedByActivity } from '../../../sim/ability_budget';
import {
  REALM_RACERS_ABILITY_ID,
  REALM_RACERS_SLICK_ABILITY_ID,
} from '../../../sim/content/realm_racers';
import type { Entity } from '../../../sim/types';
import type { IWorld } from '../../../world_api';
import { t } from '../../i18n';
import { type AimPoint, localRallyCastFeedbackAllowed } from '../action_bar/ground_aim';

/** The private Hud members the rally cast affordances read and drive. */
interface RallyCastHost {
  sim: Pick<IWorld, 'player' | 'realmRacersInfo'>;
  renderer: {
    readonly realmRacers: {
      readonly selfAimPose: Pick<Entity, 'pos' | 'facing'> | null;
      predictOwnGroundBlastFire(point: AimPoint): void;
      predictOwnSlickDrop(): void;
    };
  };
  flashActionSlot(barSlot: number): void;
  showError(text: string): void;
}

/** The pose the aim clamp measures from: the DISPLAYED self when the online
 *  predictor drives it (the mirror pose is an echo old, which at racing
 *  speed clamps the reticle yards behind the machine the player sees), else
 *  the world's own player pose (offline it is exact). */
export function rallyAimCaster(hud: object): Pick<Entity, 'pos' | 'facing'> {
  const h = hud as RallyCastHost;
  return h.renderer.realmRacers.selfAimPose ?? h.sim.player;
}

/** Every mirror the client can see says the sim will accept this rally
 *  cast, so its instant local cue (the shell's muzzle report, the oil
 *  drop's patch) may play now (localRallyCastFeedbackAllowed). */
export function rallyCastFeedbackAllowed(
  hud: object,
  abilityId: string,
  expectedAbilityId: string,
): boolean {
  const h = hud as RallyCastHost;
  const race = h.sim.realmRacersInfo.match;
  return localRallyCastFeedbackAllowed(
    abilityId,
    expectedAbilityId,
    h.sim.player.dead,
    isAbilityLockedByActivity(h.sim.player, abilityId),
    h.sim.player.cooldowns.get(abilityId) ?? 0,
    race?.phase === 'racing',
    race !== null && !race.me.finished && !race.me.retired,
  );
}

/** After a ground-aimed cast commits. */
export function predictRallyGroundBlastFire(hud: object, id: string, point: AimPoint): void {
  // Online, every audible and visible cue of a rally shot used to wait for
  // the server's Fired event, a full round trip after the press: the weapon
  // read as firing late. Launch the muzzle report and the shell NOW, toward
  // the point just sent, when the cast is legal by every mirror the client
  // can see (the gate mirrors the client-visible half of
  // realmRacersFireGroundBlast's refusals); the Fired event adopts the
  // shell, and the crater stays server-authoritative.
  if (rallyCastFeedbackAllowed(hud, id, REALM_RACERS_ABILITY_ID)) {
    (hud as RallyCastHost).renderer.realmRacers.predictOwnGroundBlastFire(point);
  }
}

/** After an instant bar cast commits. */
export function predictRallySlickDrop(hud: object, id: string): void {
  // The oil drop's instant patch, the slick twin of the shell's
  // muzzle report: painted under the displayed machine the frame
  // the cast commits, swapped for the readout's real patch when it
  // lands (or expired if the sim refused). Reading the gate AFTER
  // the cast is deliberate: offline the cast applies synchronously
  // (the cooldown is already running, the gate refuses, and the
  // REAL patch is on the road this same tick, so the cue would be
  // redundant); online the mirror only moves when the server
  // echoes, so the gate still sees the pre-cast state.
  if (rallyCastFeedbackAllowed(hud, id, REALM_RACERS_SLICK_ABILITY_ID)) {
    (hud as RallyCastHost).renderer.realmRacers.predictOwnSlickDrop();
  }
}

/**
 * An activity that lent this kit is refusing the ability: never open an aiming
 * mode the cast would then reject. Returns true when the press is spent here.
 * Hud asks it first on a ground-aim press, so a spent race weapon says so
 * rather than opening an aiming mode the cast will refuse.
 *
 * The two reasons come from the SAME predicate the sim refuses on, so the
 * affordance and the authority cannot disagree. Running out of ammunition
 * borrows the sim's own words, because "nothing happened" is indistinguishable
 * from a broken key; being held on the grid stays silent, since a racer
 * waiting for the flag can see perfectly well why they cannot shoot.
 */
export function refuseLockedAbility(hud: object, abilityId: string, barSlot: number): boolean {
  const h = hud as RallyCastHost;
  const player = h.sim.player;
  if (!isAbilityLockedByActivity(player, abilityId)) return false;
  h.flashActionSlot(barSlot);
  if (isAbilityBudgetSpent(player, abilityId)) h.showError(t('hud.errors.outOfCharges'));
  return true;
}
