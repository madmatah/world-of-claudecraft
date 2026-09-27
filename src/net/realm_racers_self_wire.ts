// The Realm Racers readouts of the snapshot self record: `rr` (queue, heat and
// standings) and `rrt` (the trackside lane the viewer stands on). Both are
// delta-omitted (server selfWireJson `maybe(...)`): an ABSENT key keeps the
// prior mirror, and an explicit null is the key's own "nothing". Sibling of
// social_self_wire.ts, which owns the rest of the social/PvP cohort.

import type { RealmRacersInfo, RealmRacersLaneView } from '../world_api/realm_racers';

export interface RealmRacersSelfMirrors {
  realmRacersInfo: RealmRacersInfo;
  realmRacersTrackside: RealmRacersLaneView | null;
}

export interface RealmRacersSelfRecord {
  rr?: unknown;
  rrt?: unknown;
}

/** The mirror's "no queue, no heat" value; mirrors the ClientWorld initializer. */
export function idleRealmRacersInfo(): RealmRacersInfo {
  return {
    queued: false,
    queuePosition: 0,
    queueSize: 0,
    match: null,
    practiceAvailable: true,
    queueViable: true,
  };
}

export function applyRealmRacersSelfWire(
  target: RealmRacersSelfMirrors,
  s: RealmRacersSelfRecord,
): void {
  if (s.rr !== undefined)
    target.realmRacersInfo = (s.rr as RealmRacersInfo | null) ?? idleRealmRacersInfo();
  if (s.rrt !== undefined)
    target.realmRacersTrackside = (s.rrt as RealmRacersLaneView | null) ?? null;
}
