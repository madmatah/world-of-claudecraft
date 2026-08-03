// The circuit editor's edit history.
//
// The property worth a test is the BRANCH, not the stacking: a new edit made
// after an undo has to drop the future, or redo walks the operator forward into a
// record they have since edited away from. Everything else here is a stack.

import { describe, expect, it } from 'vitest';
import { HISTORY_CAP, SnapshotHistory } from '../src/editor/circuit/history_core';

describe('the edit history', () => {
  it('starts with nothing to go back or forward to', () => {
    const history = new SnapshotHistory<string>();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undo('now')).toBeNull();
    expect(history.redo('now')).toBeNull();
  });

  it('walks back through the states it was handed, newest first', () => {
    const history = new SnapshotHistory<string>();
    history.push('a');
    history.push('b');
    expect(history.undo('c')).toBe('b');
    expect(history.undo('b')).toBe('a');
    expect(history.undo('a')).toBeNull();
  });

  it('walks forward again, and keeps walking', () => {
    // The bug the straight-onto-past write in `redo` exists for: pushing through
    // `push` would clear the rest of the future, so a redo could never be
    // followed by a second one.
    const history = new SnapshotHistory<string>();
    history.push('a');
    history.push('b');
    history.undo('c');
    history.undo('b');
    expect(history.canRedo).toBe(true);
    expect(history.redo('a')).toBe('b');
    expect(history.redo('b')).toBe('c');
    expect(history.redo('c')).toBeNull();
    expect(history.canRedo).toBe(false);
  });

  it('drops the forward branch on a new edit, so redo cannot reach a dead future', () => {
    const history = new SnapshotHistory<string>();
    history.push('a');
    expect(history.undo('b')).toBe('a');
    expect(history.canRedo).toBe(true);
    // The operator edits instead of redoing: 'b' is now unreachable history.
    history.push('a');
    expect(history.canRedo).toBe(false);
    expect(history.redo('x')).toBeNull();
  });

  it('reports both depths, so a button can reflect each independently', () => {
    const history = new SnapshotHistory<string>();
    history.push('a');
    history.push('b');
    expect(history.depth).toBe(2);
    expect(history.redoDepth).toBe(0);
    history.undo('c');
    expect(history.depth).toBe(1);
    expect(history.redoDepth).toBe(1);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(true);
  });

  it('caps the past and drops the OLDEST, which is the step nobody walks to', () => {
    const history = new SnapshotHistory<number>(3);
    for (let i = 0; i < 6; i++) history.push(i);
    expect(history.depth).toBe(3);
    // 0, 1 and 2 fell off the bottom; the three most recent survive.
    expect(history.undo(6)).toBe(5);
    expect(history.undo(5)).toBe(4);
    expect(history.undo(4)).toBe(3);
    expect(history.undo(3)).toBeNull();
  });

  it('defaults to a cap a long session cannot grow past', () => {
    const history = new SnapshotHistory<number>();
    for (let i = 0; i < HISTORY_CAP + 40; i++) history.push(i);
    expect(history.depth).toBe(HISTORY_CAP);
  });

  it('clears both branches', () => {
    const history = new SnapshotHistory<string>();
    history.push('a');
    history.undo('b');
    history.clear();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it('holds a falsy snapshot as a real step, not as absence', () => {
    // The page's snapshot is an object, but a history that used truthiness to
    // mean "nothing here" would break on any caller whose state can be 0 or ''.
    const history = new SnapshotHistory<number>();
    history.push(0);
    expect(history.canUndo).toBe(true);
    expect(history.undo(1)).toBe(0);
  });
});
