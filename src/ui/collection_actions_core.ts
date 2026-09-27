// Shared collection-window routing for keyboard and controller input. The
// keyboard path calls it before any window toggle, so the race lobby's key
// hold sits here (a held action reads as handled); the pad dispatcher asks the
// same hold at its head, through the re-export below.
import { rallyLobbyHoldsAction } from './hud/realm_racers/realm_racers_lobby_hold';

export { rallyLobbyHoldsAction };

export interface CollectionActionsHost {
  toggleDeeds(): void;
  toggleProfessions(): void;
  toggleReliquary(): void;
  toggleCosmetics(): void;
  toggleHarvestJournal(): void;
  togglePerfecting(): void;
  toggleLootExplorer(): void;
}
const COLLECTION_ACTIONS = {
  deeds: 'toggleDeeds',
  professions: 'toggleProfessions',
  reliquary: 'toggleReliquary',
  cosmetics: 'toggleCosmetics',
  harvestJournal: 'toggleHarvestJournal',
  perfecting: 'togglePerfecting',
  lootExplorer: 'toggleLootExplorer',
} as const;
export function dispatchCollectionAction(action: string, host: CollectionActionsHost): boolean {
  if (rallyLobbyHoldsAction(action)) return true;
  if (!Object.hasOwn(COLLECTION_ACTIONS, action)) return false;
  host[COLLECTION_ACTIONS[action as keyof typeof COLLECTION_ACTIONS]]();
  return true;
}
