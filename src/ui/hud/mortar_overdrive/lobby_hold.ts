// While the race lobby curtain is shown, the keys and pad buttons that open a
// window or a menu do nothing: the curtain would hide whatever they opened.
// The set is closed and matches on both input paths (the keyboard's onUiKey
// actions and the pad's twins of them). Left live on purpose: chat (the grid
// talks while it waits), Hide Interface and Escape (Escape brings a hidden
// interface back first; main.ts gates only its game-menu arm on `shown`),
// and everything that is not a window (targeting, slots, camera, pets).
//
// One instance per Mortar Overdrive UI (MortarOverdriveUi owns it, Hud exposes it as
// `lobbyHold`), written only by the curtain painter on its show and hide edges,
// so the hold ends on the frame the curtain drops and dies with its owner.

export const MORTAR_OVERDRIVE_LOBBY_HELD_ACTIONS: ReadonlySet<string> = new Set([
  'interact',
  'bags',
  'char',
  'spellbook',
  'talents',
  'questlog',
  'map',
  'meters',
  'targetAuras',
  'social',
  'arena',
  'mortarOverdrive',
  'dungeonFinder',
  'leaderboard',
  'calendar',
  'discord',
  'crafting',
  'deeds',
  'professions',
  'reliquary',
  'harvestJournal',
  'perfecting',
  'lootExplorer',
  'cosmetics',
]);

export class MortarOverdriveLobbyHold {
  private active = false;

  /** Whether the lobby curtain is shown right now. */
  get shown(): boolean {
    return this.active;
  }

  set(active: boolean): void {
    this.active = active;
  }

  /** True when this window or menu action must be swallowed. */
  holds(action: string): boolean {
    return this.active && MORTAR_OVERDRIVE_LOBBY_HELD_ACTIONS.has(action);
  }
}
