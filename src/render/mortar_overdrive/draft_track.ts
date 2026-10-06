// The visual half of the dev draft arm: a circuit drawn in the editor, built
// and drawn in the running game.
//
// It is a sibling of the track builder rather than an arm inside it because
// what it owns is a LIFECYCLE the authored circuits do not have. Those are
// built at most once per renderer, when a pilot commits to one (its race
// preparation builds it in the lobby, mortar_overdrive/circuit_prepare.ts), and
// kept for the session. A draft is built at REGISTRATION, which is a dev
// moment nobody is racing through, and rebuilt whenever the operator saves
// and re-runs the command.
//
// Replacing a draft frees what its group OWNED (see
// `mortar_overdrive/track_dispose_core.ts`, which is careful about what it does
// NOT free): without it, an afternoon of iterating on one circuit leaks a
// circuit's worth of vertex buffers per pass.

import type * as THREE from 'three';
import type { MortarOverdriveCircuit } from '../../sim/content/mortar_overdrive';
import type { MortarOverdriveLaneView } from '../../world_api/mortar_overdrive';
import type { MortarOverdriveTrackView } from './track';
import { disposeMortarOverdriveTrackGroup } from './track_dispose_core';

export interface MortarOverdriveDraftTracks {
  /** Rebuild the view for a draft id, disposing the one it replaces. */
  register(circuit: MortarOverdriveCircuit): void;
  update(px: number, pz: number, time: number, match: MortarOverdriveLaneView | null): void;
  /** Forward of MortarOverdriveTrackView.dropProvisionalSlick over the drafts. */
  dropProvisionalSlick(circuitId: string, worldX: number, worldZ: number, time: number): void;
}

/** The part of the tracks group this needs. Structural so the lifecycle above
 *  is unit-testable without a scene graph. */
export interface DraftTrackParent {
  add(object: THREE.Object3D): void;
  remove(object: THREE.Object3D): void;
}

/**
 * Draft views under a caller-owned parent.
 *
 * `build` is injected rather than imported so this module does not close a
 * cycle with `mortar_overdrive/track.ts`, which composes it: the tracks view is
 * what knows how to build one circuit, and this is what knows when to throw one
 * away.
 */
export function buildMortarOverdriveDraftTracks(
  parent: DraftTrackParent,
  build: (circuit: MortarOverdriveCircuit) => MortarOverdriveTrackView,
): MortarOverdriveDraftTracks {
  const views = new Map<string, MortarOverdriveTrackView>();
  return {
    register(circuit) {
      const previous = views.get(circuit.id);
      if (previous) {
        parent.remove(previous.group);
        disposeMortarOverdriveTrackGroup(previous.group);
      }
      const view = build(circuit);
      parent.add(view.group);
      views.set(circuit.id, view);
    },
    update(px, pz, time, match) {
      // The same lane gate every authored circuit runs: a draft's view hides
      // itself unless the viewer stands on the draft's own lane, which the
      // layout leaf hands out after every authored one.
      for (const view of views.values()) view.update(px, pz, time, match);
    },
    dropProvisionalSlick(circuitId, worldX, worldZ, time) {
      for (const view of views.values()) view.dropProvisionalSlick(circuitId, worldX, worldZ, time);
    },
  };
}
