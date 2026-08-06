// The visual half of the dev draft arm: a circuit drawn in the editor, built
// and drawn in the running game.
//
// It is a sibling of the track builder rather than an arm inside it because
// what it owns is a LIFECYCLE the authored circuits do not have. Those are
// built once, eagerly, at renderer construction (deliberately: a lazy build
// would land half a megabyte of geometry on the frame a viewer arrives at a
// circuit, which is the countdown). A draft is built at REGISTRATION, which is
// a dev moment nobody is racing through, and rebuilt whenever the operator
// saves and re-runs the command.
//
// Replacing a draft frees what its group OWNED (see
// `realm_racers_track_dispose_core.ts`, which is careful about what it does
// NOT free): without it, an afternoon of iterating on one circuit leaks a
// circuit's worth of vertex buffers per pass.

import type * as THREE from 'three';
import type { RealmRacersCircuit } from '../sim/content/realm_racers_circuits';
import type { RealmRacersLaneView } from '../world_api/realm_racers';
import type { RealmRacersTrackView } from './realm_racers_track';
import { disposeRealmRacersTrackGroup } from './realm_racers_track_dispose_core';

export interface RealmRacersDraftTracks {
  /** Rebuild the view for a draft id, disposing the one it replaces. */
  register(circuit: RealmRacersCircuit): void;
  update(px: number, pz: number, time: number, match: RealmRacersLaneView | null): void;
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
 * cycle with `realm_racers_track.ts`, which composes it: the tracks view is
 * what knows how to build one circuit, and this is what knows when to throw one
 * away.
 */
export function buildRealmRacersDraftTracks(
  parent: DraftTrackParent,
  build: (circuit: RealmRacersCircuit) => RealmRacersTrackView,
): RealmRacersDraftTracks {
  const views = new Map<string, RealmRacersTrackView>();
  return {
    register(circuit) {
      const previous = views.get(circuit.id);
      if (previous) {
        parent.remove(previous.group);
        disposeRealmRacersTrackGroup(previous.group);
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
  };
}
