export interface SentEntityVersions {
  idVer: number;
  dynVer: number;
  auraVer: number;
  sentAtTick: number;
  settled: boolean;
}

export interface EntityWireView {
  idVer: number;
  dynVer: number;
  auraVer: number;
  fullJson: string;
  liteJson: string;
  fullAuraJson: string;
  liteAuraJson: string;
}

/**
 * Append one already-selected entity through the shared full/lite/keep state
 * machine. Selection policy stays with the caller, so normal distance interest
 * and direct match pins cannot encode the same id through divergent paths.
 */
export function appendSnapshotEntity(
  id: number,
  tick: number,
  stableTimerWire: boolean,
  updateDue: boolean,
  sentEnts: Map<number, SentEntityVersions>,
  present: Set<number>,
  ents: string[],
  keep: number[],
  cache: EntityWireView,
): void {
  present.add(id);
  const known = sentEnts.get(id);
  if (known === undefined) {
    ents.push(stableTimerWire ? cache.fullAuraJson : cache.fullJson);
    sentEnts.set(id, {
      idVer: cache.idVer,
      dynVer: cache.dynVer,
      auraVer: cache.auraVer,
      sentAtTick: tick,
      settled: true,
    });
    return;
  }
  const auraChanged = stableTimerWire && known.auraVer !== cache.auraVer;
  if (known.idVer !== cache.idVer) {
    ents.push(auraChanged ? cache.fullAuraJson : cache.fullJson);
    known.idVer = cache.idVer;
    known.dynVer = cache.dynVer;
    known.auraVer = cache.auraVer;
    known.sentAtTick = tick;
    known.settled = false;
    return;
  }
  if (!updateDue || (known.dynVer === cache.dynVer && !auraChanged && known.settled)) {
    keep.push(id);
    return;
  }
  known.settled = known.dynVer === cache.dynVer;
  known.dynVer = cache.dynVer;
  known.auraVer = cache.auraVer;
  known.sentAtTick = tick;
  ents.push(auraChanged ? cache.liteAuraJson : cache.liteJson);
}
