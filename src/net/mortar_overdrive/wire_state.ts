// The Mortar Overdrive link of ClientWorld's mirror class chain (the
// QuestWorldWireState pattern, beside online.ts for its monolith ratchet): the
// IWorldMortarOverdrive mirrors and command sends, the Mortar Overdrive kit mirror, and the
// self position discontinuity latch. online.ts keeps only the hook at each
// protocol moment (event frame, snapshot applied, entity decode, self decode).
import type { ResolvedAbility } from '../../sim/sim';
import type { Entity } from '../../sim/types';
import type {
  ClientCommand,
  MortarOverdriveDriverTier,
  MortarOverdriveInfo,
} from '../../world_api';
import type { MortarOverdriveLaneView } from '../../world_api/mortar_overdrive';
import { ReconWireState } from '../movement_reconciliation_wire';
import { SelfPositionDiscontinuityLatch } from '../self_position_discontinuity';
import {
  applyMortarOverdriveSelfWire,
  decodeMortarOverdriveKit,
  idleMortarOverdriveInfo,
  type MortarOverdriveKitMirror,
  type MortarOverdriveSelfRecord,
  mortarOverdriveKnownOr,
} from './self_wire';

export { decodeDriveWire } from './drive_wire';

export abstract class MortarOverdriveWireState extends ReconWireState {
  mortarOverdriveInfo: MortarOverdriveInfo = idleMortarOverdriveInfo();
  mortarOverdriveTrackside: MortarOverdriveLaneView | null = null;
  private mortarOverdriveKit: MortarOverdriveKitMirror | null = null;
  // Created on first use, so a prototype-built test instance latches too.
  private selfDiscontinuityLatch?: SelfPositionDiscontinuityLatch;

  /** ClientWorld's typed command send (W0b), which every Mortar Overdrive command rides. */
  protected abstract cmd(payload: { cmd: ClientCommand } & Record<string, unknown>): void;

  protected get selfDiscontinuity(): SelfPositionDiscontinuityLatch {
    this.selfDiscontinuityLatch ??= new SelfPositionDiscontinuityLatch();
    return this.selfDiscontinuityLatch;
  }

  /**
   * Consume one recovery snap only after its following authoritative snapshot.
   * The event frame precedes its authoritative snapshot: ClientWorld holds this
   * edge across any intervening rAF and exposes it only after that snapshot has
   * updated the self mirror, so main.ts reads it once per frame here.
   */
  consumeSelfPositionDiscontinuity(): boolean {
    return this.selfDiscontinuity.consume();
  }

  /**
   * The Mortar Overdrive self keys in one pass: `mo` and `mot` onto their mirrors,
   * then the `mokit` decode, returning the self known list it resolves (the
   * Mortar Overdrive kit while seated, the class presentation otherwise).
   */
  protected applyMortarOverdriveSelf(
    s: MortarOverdriveSelfRecord & { mokit?: unknown },
    e: Pick<Entity, 'abilityCharges'> | null,
    presentationKnown: ResolvedAbility[],
  ): ResolvedAbility[] {
    applyMortarOverdriveSelfWire(this, s);
    this.mortarOverdriveKit = decodeMortarOverdriveKit(this.mortarOverdriveKit, s.mokit);
    return mortarOverdriveKnownOr(this.mortarOverdriveKit, e, presentationKnown);
  }

  joinMortarOverdriveQueue(): void {
    this.cmd({ cmd: 'mortar_overdrive_join' });
  }
  leaveMortarOverdriveQueue(): void {
    this.cmd({ cmd: 'mortar_overdrive_leave' });
  }
  forfeitMortarOverdrive(): void {
    this.cmd({ cmd: 'mortar_overdrive_forfeit' });
  }
  resetMortarOverdrivePosition(): void {
    this.cmd({ cmd: 'mortar_overdrive_reset' });
  }
  // Practice: the server seats the sender against a house pilot on the ONE
  // circuit immediately. Same command online and off, and the server re-checks
  // the tier and the circuit before seating anyone.
  startMortarOverdrivePractice(tier: MortarOverdriveDriverTier): void {
    this.cmd({ cmd: 'mortar_overdrive_practice', tier });
  }
  readyMortarOverdrive(): void {
    this.cmd({ cmd: 'mortar_overdrive_ready' });
  }
  // Start now: the server re-checks that the sender is queued, able to race and
  // that the public lane is free before it seats anyone.
  startMortarOverdriveNow(): void {
    this.cmd({ cmd: 'mortar_overdrive_start_now' });
  }
}
