import type { SimEvent } from '../sim/types';

/**
 * Position-recovery events and their authoritative self pose travel in two
 * ordered WebSocket frames (events first, snapshot second). A render frame
 * may land between them, so the renderer must not consume the discontinuity
 * until the first subsequent snapshot has actually updated the mirror.
 */
export class SelfPositionDiscontinuityLatch {
  private pending = false;
  private ready = false;

  /** Arms the latch on the viewer's own completed unstuck or Mortar Overdrive reset. */
  noteEvent(ev: SimEvent, playerId: number): void {
    if (
      ((ev.type === 'unstuck' &&
        (ev as Extract<SimEvent, { type: 'unstuck' }>).phase === 'completed') ||
        ev.type === 'mortarOverdriveReset') &&
      ((ev as { pid?: number }).pid === undefined || (ev as { pid?: number }).pid === playerId)
    ) {
      this.pending = true;
    }
  }

  /** The snapshot that follows the events has landed on the mirror. */
  snapshotApplied(): void {
    if (this.pending) {
      this.pending = false;
      this.ready = true;
    }
  }

  /** Consume one recovery snap only after its following authoritative snapshot. */
  consume(): boolean {
    const ready = this.ready;
    this.ready = false;
    return ready;
  }
}
