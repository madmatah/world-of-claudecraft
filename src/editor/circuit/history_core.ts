// The circuit editor's edit history: a capped undo stack with a forward branch.
//
// SNAPSHOTS rather than commands, unlike `src/editor/undo_core.ts`, and for one
// reason that is specific to this tool: every edit here already produces a whole
// new record (`commit` rounds it and re-derives the geometry from it), so a
// do/undo closure pair would be two references to objects the page is holding
// anyway. What the history has to get right is not the diffing, it is the
// BRANCH: a new edit after an undo must drop the future, or redo walks forward
// into a record the operator has since edited away from.
//
// Pure and DOM-free: the page hands it snapshots and asks for them back.

/** How many steps back the tool can go. A dev tool is left open for hours, so
 *  this is a memory ceiling rather than a design limit. */
export const HISTORY_CAP = 100;

export class SnapshotHistory<T> {
  private readonly past: T[] = [];
  private readonly future: T[] = [];

  constructor(private readonly cap: number = HISTORY_CAP) {}

  /**
   * Record the state being LEFT, and drop the forward branch.
   *
   * The caller pushes before it mutates, which is what makes a snapshot history
   * cheap: there is nothing to capture afterwards. Dropping the future here
   * rather than in `undo` is the whole invariant, and it is why every push in the
   * page goes through one helper: a single site that pushed straight onto the
   * array would leave a redo the operator can reach and nothing behind it.
   */
  push(snapshot: T): void {
    this.past.push(snapshot);
    this.future.length = 0;
    const over = this.past.length - this.cap;
    if (over > 0) this.past.splice(0, over);
  }

  /** The state to go back to, or null. `current` becomes the redo step. */
  undo(current: T): T | null {
    const previous = this.past.pop();
    if (previous === undefined) return null;
    this.future.push(current);
    return previous;
  }

  /** The state to go forward to, or null. `current` becomes the undo step. */
  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    // Straight onto `past`, NOT through `push`: pushing would drop the rest of
    // the future, so a redo could never be followed by another redo.
    this.past.push(current);
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get depth(): number {
    return this.past.length;
  }

  get redoDepth(): number {
    return this.future.length;
  }

  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
  }
}
