// The Realm Racers link of ClientWorld's mirror class chain (the
// QuestWorldWireState pattern, beside online.ts for its monolith ratchet): the
// IWorldRealmRacers mirrors and command sends, the Rally kit mirror, and the
// self position discontinuity latch. online.ts keeps only the hook at each
// protocol moment (event frame, snapshot applied, entity decode, self decode).
import type { ResolvedAbility } from '../sim/sim';
import type { Entity } from '../sim/types';
import type { ClientCommand, RallyDriverTier, RealmRacersInfo } from '../world_api';
import type { RealmRacersLaneView } from '../world_api/realm_racers';
import { ReconWireState } from './movement_reconciliation_wire';
import {
  applyRealmRacersSelfWire,
  decodeRealmRacersKit,
  idleRealmRacersInfo,
  type RealmRacersKitMirror,
  type RealmRacersSelfRecord,
  realmRacersKnownOr,
} from './realm_racers_self_wire';
import { SelfPositionDiscontinuityLatch } from './self_position_discontinuity';

export { decodeDriveWire } from './realm_racers_drive_wire';

export abstract class RealmRacersWireState extends ReconWireState {
  realmRacersInfo: RealmRacersInfo = idleRealmRacersInfo();
  realmRacersTrackside: RealmRacersLaneView | null = null;
  private realmRacersKit: RealmRacersKitMirror | null = null;
  // Created on first use, so a prototype-built test instance latches too.
  private selfDiscontinuityLatch?: SelfPositionDiscontinuityLatch;

  /** ClientWorld's typed command send (W0b), which every Rally command rides. */
  protected abstract cmd(payload: { cmd: ClientCommand } & Record<string, unknown>): void;

  protected get selfDiscontinuity(): SelfPositionDiscontinuityLatch {
    this.selfDiscontinuityLatch ??= new SelfPositionDiscontinuityLatch();
    return this.selfDiscontinuityLatch;
  }

  /** Consume one recovery snap only after its following authoritative snapshot. */
  consumeSelfPositionDiscontinuity(): boolean {
    return this.selfDiscontinuity.consume();
  }

  /**
   * The Realm Racers self keys in one pass: `rr` and `rrt` onto their mirrors,
   * then the `rrkit` decode, returning the self known list it resolves (the
   * Rally kit while seated, the class presentation otherwise).
   */
  protected applyRealmRacersSelf(
    s: RealmRacersSelfRecord & { rrkit?: unknown },
    e: Pick<Entity, 'abilityCharges'> | null,
    presentationKnown: ResolvedAbility[],
  ): ResolvedAbility[] {
    applyRealmRacersSelfWire(this, s);
    this.realmRacersKit = decodeRealmRacersKit(this.realmRacersKit, s.rrkit);
    return realmRacersKnownOr(this.realmRacersKit, e, presentationKnown);
  }

  joinRealmRacersQueue(): void {
    this.cmd({ cmd: 'realm_racers_join' });
  }
  leaveRealmRacersQueue(): void {
    this.cmd({ cmd: 'realm_racers_leave' });
  }
  forfeitRealmRacers(): void {
    this.cmd({ cmd: 'realm_racers_forfeit' });
  }
  resetRealmRacersPosition(): void {
    this.cmd({ cmd: 'realm_racers_reset' });
  }
  // Practice: the server seats the sender against a house pilot on the ONE
  // circuit immediately. Same command online and off, and the server re-checks
  // the tier and the circuit before seating anyone.
  startRealmRacersPractice(tier: RallyDriverTier): void {
    this.cmd({ cmd: 'realm_racers_practice', tier });
  }
  readyRealmRacers(): void {
    this.cmd({ cmd: 'realm_racers_ready' });
  }
}
