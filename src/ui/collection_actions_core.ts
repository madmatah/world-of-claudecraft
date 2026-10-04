// Shared collection-window routing for keyboard and controller input (plus the
// Realm Racers window, the one both paths toggle the same way). Both paths call
// it before any window toggle, so a host-supplied hold (the race lobby's, which
// swallows window and menu actions while its curtain is up) sits here too: a
// held action reads as handled.

export interface CollectionActionsHost {
  toggleDeeds(): void;
  toggleProfessions(): void;
  toggleReliquary(): void;
  toggleCosmetics(): void;
  toggleHarvestJournal(): void;
  togglePerfecting(): void;
  toggleLootExplorer(): void;
  toggleRealmRacers(): void;
  /** A curtain that holds window and menu actions (the Realm Racers lobby). */
  lobbyHold?: { holds(action: string): boolean };
}
const COLLECTION_ACTIONS = {
  deeds: 'toggleDeeds',
  professions: 'toggleProfessions',
  reliquary: 'toggleReliquary',
  cosmetics: 'toggleCosmetics',
  harvestJournal: 'toggleHarvestJournal',
  perfecting: 'togglePerfecting',
  lootExplorer: 'toggleLootExplorer',
  rally: 'toggleRealmRacers',
} as const;
export function dispatchCollectionAction(action: string, host: CollectionActionsHost): boolean {
  if (host.lobbyHold?.holds(action)) return true;
  if (!Object.hasOwn(COLLECTION_ACTIONS, action)) return false;
  host[COLLECTION_ACTIONS[action as keyof typeof COLLECTION_ACTIONS]]();
  return true;
}
