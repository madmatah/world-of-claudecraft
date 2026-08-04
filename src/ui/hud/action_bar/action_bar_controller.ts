import { REALM_RACERS_ABILITIES, REALM_RACERS_BAR_SLOTS } from '../../../sim/content/realm_racers';
import { SPORT_ABILITIES } from '../../../sim/content/vale_cup';
import { ABILITIES, ITEMS } from '../../../sim/data';
import type { PlayerClass } from '../../../sim/types';
import type { ActionBarLayout } from '../../../world_api/action_bar';
import { knownItemDef } from '../../known_item';
import { WARRIOR_STANCE_GROUP } from '../../stance_bar_view';
import { ACTION_BAR_ABILITY_SLOTS } from './action_bar_layout_core';
import {
  actionBarFormSeededKey,
  actionBarSlotMapKey,
  actionBarStealthInitializedKey,
  captureActionBarLayout,
} from './action_bar_layout_sync';
import {
  actionForAttackSlot,
  attackSlotStorageKey,
  buildDefaultFormBar,
  clearHotbarSlot,
  type HotbarAction,
  isAbilityActionBarEligible,
  parseHotbarActions,
  placeAbilityOnSlot,
  classHasFormBars as playerClassHasFormBars,
  loadAttackSlotAction as readAttackSlotAction,
  sanitizeHotbarAction,
  sanitizeHotbarActions,
  shouldSeedFormBar,
  storedHotbarHasIneligibleAbility,
  syncHotbarActions,
  saveAttackSlotAction as writeAttackSlotAction,
} from './hotbar';

export { ACTION_BAR_ABILITY_SLOTS } from './action_bar_layout_core';

export type HotbarForm = 'normal' | 'bear' | 'cat' | 'cat_stealth' | 'stealth' | 'sport' | 'rally';

const FORM_TOGGLE_IDS = new Set(['bear_form', 'cat_form', 'travel_form']);

// The bar slots the rally kit reserves, derived once at import: `actionForSlot`
// asks per slot and per frame, so the membership test must not rebuild a list
// each time.
const RALLY_PINNED_SLOTS: ReadonlySet<number> = new Set(Object.values(REALM_RACERS_BAR_SLOTS));

export interface ActionBarControllerDeps {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  playerClass: PlayerClass;
  playerName: string;
  knownAbilityIds(): readonly string[];
  hasAura(kind: string): boolean;
  isInSportMatch(): boolean;
  isInRealmRacers?(): boolean;
  showAttackButton(): boolean;
  // The persistence seam: called after a user-driven layout change (never during
  // initial load) with the FULL captured layout. Offline it is a no-op
  // (localStorage is the store); online the ClientWorld debounces a wire save.
  // Optional so an offline/test controller with no server persistence just skips
  // it and keeps its byte-identical localStorage behavior.
  persistLayout?(layout: ActionBarLayout): void;
}

/** Owns action-bar pages, migrations, persistence, and attack-slot assignment. */
export class ActionBarController {
  private activeFormState: HotbarForm = 'normal';
  private actionState: HotbarAction[] = Array.from(
    { length: ACTION_BAR_ABILITY_SLOTS },
    () => null,
  );
  private loadedFromStorage = false;
  private knownAbilityIdsAtLastSync: Set<string> | null = null;
  private pendingLoadoutKnownAbilityIds: Set<string> | null = null;
  private attackActionState: HotbarAction = null;
  // Suppresses the persistence seam while the controller is loading/seeding from
  // storage: only user-driven changes after init should upload. Flipped true at
  // the end of init()/reload().
  private ready = false;

  constructor(private readonly deps: ActionBarControllerDeps) {}

  init(): void {
    this.loadActions();
    this.loadAttackAction();
    this.ready = true;
  }

  /** Re-seed every bar/attack slot from storage (after the server layout has
   *  overwritten the local mirror at login). Persistence stays suppressed while
   *  reloading so restoring a server copy never bounces straight back up. */
  reload(): void {
    this.ready = false;
    this.loadActions();
    this.loadAttackAction();
    this.ready = true;
  }

  private persist(): void {
    if (!this.ready || !this.deps.persistLayout) return;
    this.deps.persistLayout(
      captureActionBarLayout(this.deps.storage, this.deps.playerClass, this.deps.playerName),
    );
  }

  get activeForm(): HotbarForm {
    return this.activeFormState;
  }

  get actions(): HotbarAction[] {
    return this.actionState;
  }

  replaceActions(actions: HotbarAction[]): void {
    this.actionState = sanitizeHotbarActions(actions, (id) => this.isAbilityPlacementAllowed(id));
  }

  replaceActionsForLoadout(
    actions: HotbarAction[],
    targetKnownAbilityIds: ReadonlySet<string>,
  ): void {
    this.actionState = sanitizeHotbarActions(actions, (id) => this.isAbilityPlacementAllowed(id));
    this.pendingLoadoutKnownAbilityIds = new Set(targetKnownAbilityIds);
    this.knownAbilityIdsAtLastSync = new Set([
      ...this.deps.knownAbilityIds(),
      ...targetKnownAbilityIds,
    ]);
  }

  get attackAction(): HotbarAction {
    return this.attackActionState;
  }

  replaceAttackAction(action: HotbarAction): void {
    this.attackActionState = sanitizeHotbarAction(action, (id) =>
      this.isAbilityPlacementAllowed(id),
    );
  }

  resolveActiveForm(): HotbarForm {
    if (this.deps.isInRealmRacers?.()) return 'rally';
    if (this.deps.isInSportMatch()) return 'sport';
    if (this.deps.playerClass === 'druid') {
      if (this.deps.hasAura('form_bear')) return 'bear';
      if (this.deps.hasAura('form_cat')) {
        if (this.deps.hasAura('stealth')) return 'cat_stealth';
        return 'cat';
      }
    }
    if (this.deps.playerClass === 'rogue' && this.deps.hasAura('stealth')) return 'stealth';
    return 'normal';
  }

  syncActiveForm(): boolean {
    const next = this.resolveActiveForm();
    if (next === this.activeFormState) return false;
    this.saveActions();
    this.saveAttackAction();
    this.activeFormState = next;
    this.loadActions();
    this.loadAttackAction();
    return true;
  }

  syncKnownAbilities(): void {
    const liveKnownAbilityIds = [...this.deps.knownAbilityIds()];
    if (
      this.pendingLoadoutKnownAbilityIds &&
      [...this.pendingLoadoutKnownAbilityIds].every((id) => liveKnownAbilityIds.includes(id))
    ) {
      this.pendingLoadoutKnownAbilityIds = null;
    }
    const knownAbilityIds = this.pendingLoadoutKnownAbilityIds
      ? [...new Set([...liveKnownAbilityIds, ...this.pendingLoadoutKnownAbilityIds])]
      : liveKnownAbilityIds;
    const autoPlaceAbilityIds = new Set<string>();
    const consider = (id: string): void => {
      // A passive (Measured Fury) is known but never castable, so it never
      // auto-places on the action bar (a manual drag would be a dead slot too).
      if (!this.isAbilityPlacementAllowed(id)) return;
      // Warrior stances live on the dedicated #stancebar, never the action bar,
      // so learning one on level-up must not consume an action slot.
      if (ABILITIES[id]?.exclusiveGroup === WARRIOR_STANCE_GROUP) return;
      if (this.shouldAutoPlaceOnForm(id, this.activeFormState)) autoPlaceAbilityIds.add(id);
    };
    if (this.knownAbilityIdsAtLastSync === null) {
      if (!this.loadedFromStorage) {
        for (const id of knownAbilityIds) consider(id);
      }
    } else {
      for (const id of knownAbilityIds) {
        if (!this.knownAbilityIdsAtLastSync.has(id)) consider(id);
      }
    }
    const formToggle = this.formToggleAbilityId();
    if (formToggle && knownAbilityIds.includes(formToggle)) autoPlaceAbilityIds.add(formToggle);
    const synced = syncHotbarActions(
      this.actionState,
      knownAbilityIds,
      autoPlaceAbilityIds,
      // Also strips every PINNED kit ability out of the assignable rows, which is
      // what MIGRATES a bar seeded by an earlier build: those put the rally
      // weapon in row slot 1 and the drawn pickup effect in the first free slot
      // behind it, and either would otherwise now appear twice.
      (id) => !this.isAbilityPlacementAllowed(id) || this.activityKitSlotFor(id) !== null,
    );
    this.actionState = synced.actions;
    if (synced.changed) this.saveActions();
    this.knownAbilityIdsAtLastSync = new Set(knownAbilityIds);
  }

  addAbility(abilityId: string): boolean {
    // A passive is never castable: reject a manual drag/spellbook add so it
    // cannot occupy a dead action slot (auto-place already skips passives).
    if (!this.isAbilityPlacementAllowed(abilityId)) return false;
    if (this.actionState.some((action) => action?.type === 'ability' && action.id === abilityId)) {
      return false;
    }
    const target = this.actionState.indexOf(null);
    if (target === -1) return false;
    this.actionState = placeAbilityOnSlot(this.actionState, abilityId, target);
    this.saveActions();
    return true;
  }

  hasFreeSlot(): boolean {
    return this.actionState.includes(null);
  }

  removeAbility(abilityId: string): boolean {
    const target = this.actionState.findIndex(
      (action) => action?.type === 'ability' && action.id === abilityId,
    );
    if (target === -1) return false;
    this.actionState = clearHotbarSlot(this.actionState, target);
    this.saveActions();
    return true;
  }

  resetActiveBar(): void {
    this.actionState = buildDefaultFormBar(
      this.formKitAbilityIds(this.activeFormState),
      ACTION_BAR_ABILITY_SLOTS,
    );
    this.knownAbilityIdsAtLastSync = new Set(this.deps.knownAbilityIds());
    this.markFormBarSeeded();
    this.saveActions();
  }

  formKitAbilityIds(form: HotbarForm): string[] {
    return this.deps.knownAbilityIds().filter((id) => this.shouldAutoPlaceOnForm(id, form));
  }

  classHasFormBars(): boolean {
    return playerClassHasFormBars(this.deps.playerClass);
  }

  isHotbarItemId(itemId: string): boolean {
    // Gathering implements (#2343): the simple pole (use.type 'fishing') and
    // every gatherTool (picks, axes, sickles, tiered rods) are placeable, so
    // a keybound press works the tool exactly like the bags click.
    // Reins: the mounts-as-items pivot routes kind 'mount' through the same
    // useItem dispatch a potion rides (src/sim/items.ts -> summonMountItem), so
    // reins are placeable for the same reason a potion is. Without this arm the
    // bag drag never writes a hotbar payload and the bar cannot accept them.
    const item = ITEMS[itemId];
    return (
      item?.kind === 'food' ||
      item?.kind === 'drink' ||
      item?.kind === 'potion' ||
      item?.kind === 'mount' ||
      item?.use?.type === 'fishing' ||
      item?.use?.type === 'gatherTool'
    );
  }

  /**
   * The STORED-layout keep predicate (stale-client guard, R34), distinct from
   * isAssignableAction's strict placement gate: the layout is per-character
   * SERVER state and the save path is a wholesale overwrite, so an id this
   * bundle predates must ride through parse and save as an INERT slot (its
   * press arms already no-op on an unresolvable def) rather than be nulled
   * and silently destroyed for every other device. Known-but-ineligible ids
   * (a kind that stopped being placeable) keep today's strip.
   */
  keepsStoredItemId(itemId: string): boolean {
    return this.isHotbarItemId(itemId) || knownItemDef(ITEMS, itemId) === undefined;
  }

  isAssignableAction(action: Exclude<HotbarAction, null>): boolean {
    if (action.type === 'item') return this.isHotbarItemId(action.id);
    return (
      this.deps.knownAbilityIds().includes(action.id) && this.isAbilityPlacementAllowed(action.id)
    );
  }

  /**
   * The bar slot an ACTIVITY kit pins `id` to, or null when the id is not pinned
   * or no activity owns the bar.
   *
   * The weapon has owned slot 0 since the circuit shipped: the auto-attack
   * toggle has no meaning there (no target, no swing), so leaving it on the
   * leftmost key cost that key twice over, once answering "Invalid attack
   * target." and once showing an attack icon over a key that fired the weapon.
   * The pickup effects joined it as pins for a different reason, recorded with
   * the table in `sim/content/realm_racers.ts`: auto-placement fills the first
   * EMPTY slot, so every effect a pilot drew landed under the same key.
   *
   * Scope note: the Vale Cup's sport kit has exactly the same shape and is
   * deliberately NOT changed here, so its bar keeps the behavior it shipped
   * with; extending this is a one-line change to the form check plus its own
   * slot table.
   */
  private activityKitSlotFor(id: string, form: HotbarForm = this.activeFormState): number | null {
    if (form !== 'rally') return null;
    return REALM_RACERS_BAR_SLOTS[id] ?? null;
  }

  /** The kit ability pinned to `barSlot` and actually in the racer's hands, or
   *  null when the slot is unpinned or its pin is empty right now. */
  private activityKitAbilityForSlot(
    barSlot: number,
    form: HotbarForm = this.activeFormState,
  ): string | null {
    if (form !== 'rally') return null;
    return this.deps.knownAbilityIds().find((id) => REALM_RACERS_BAR_SLOTS[id] === barSlot) ?? null;
  }

  /** Whether the kit RESERVES `barSlot`, held or not. A reserved slot stays
   *  empty rather than falling through, which is what keeps each effect on its
   *  own key instead of sliding left into the first gap. */
  private isActivityKitSlot(barSlot: number, form: HotbarForm = this.activeFormState): boolean {
    if (form !== 'rally') return false;
    return RALLY_PINNED_SLOTS.has(barSlot);
  }

  isAttackSlotFixed(): boolean {
    if (this.isActivityKitSlot(0)) return false;
    return this.deps.showAttackButton();
  }

  actionForSlot(barSlot: number): HotbarAction {
    const pinned = this.activityKitAbilityForSlot(barSlot);
    if (pinned !== null) return { type: 'ability', id: pinned };
    if (this.isActivityKitSlot(barSlot)) return null;
    if (barSlot === 0) return actionForAttackSlot(this.isAttackSlotFixed(), this.attackActionState);
    return this.actionState[barSlot - 1] ?? null;
  }

  saveActions(): void {
    try {
      this.deps.storage.setItem(this.slotMapKey(), JSON.stringify(this.actionState));
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
    this.persist();
  }

  saveAttackAction(): void {
    try {
      writeAttackSlotAction(
        this.deps.storage,
        attackSlotStorageKey(this.slotMapKey()),
        this.attackActionState,
      );
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
    this.persist();
  }

  private slotMapKey(form: HotbarForm = this.activeFormState): string {
    return actionBarSlotMapKey(this.deps.playerClass, this.deps.playerName, form);
  }

  private shouldAutoPlaceOnForm(id: string, form: HotbarForm): boolean {
    // Passives never castable: keep them off every seeded/form kit bar too.
    if (!this.isAbilityPlacementAllowed(id)) return false;
    // An ability the kit already pins to its own key is not placed a second time
    // in the assignable rows; anything else the kit grants still is.
    if (form === 'rally') {
      return !!REALM_RACERS_ABILITIES[id] && this.activityKitSlotFor(id, form) === null;
    }
    if (form === 'sport') return !!SPORT_ABILITIES[id];
    if (SPORT_ABILITIES[id] || REALM_RACERS_ABILITIES[id]) return false;
    if (this.isStealthForm(form)) return false;
    if (form === 'bear' || form === 'cat') {
      return ABILITIES[id]?.requiresForm === form || FORM_TOGGLE_IDS.has(id);
    }
    return !ABILITIES[id]?.requiresForm;
  }

  private isFormKitBar(form: HotbarForm = this.activeFormState): boolean {
    return this.deps.playerClass === 'druid' && (form === 'bear' || form === 'cat');
  }

  private isStealthForm(form: HotbarForm = this.activeFormState): boolean {
    return form === 'stealth' || form === 'cat_stealth';
  }

  private abilityDef(id: string) {
    return ABILITIES[id] ?? SPORT_ABILITIES[id] ?? REALM_RACERS_ABILITIES[id];
  }

  private isAbilityPlacementAllowed(id: string): boolean {
    const ability = this.abilityDef(id);
    // Direct setter compatibility for host-provided known ids that are not in the
    // static client table; every real AbilityDef still follows the passive rule.
    return ability === undefined || isAbilityActionBarEligible(ability);
  }

  private isStoredAbilityEligible(id: string): boolean {
    return isAbilityActionBarEligible(this.abilityDef(id));
  }

  private formBarSeededKey(form: HotbarForm = this.activeFormState): string {
    return actionBarFormSeededKey(this.slotMapKey(form));
  }

  private markFormBarSeeded(form: HotbarForm = this.activeFormState): void {
    try {
      this.deps.storage.setItem(this.formBarSeededKey(form), '1');
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
  }

  private stealthBarInitializedKey(form: HotbarForm = this.activeFormState): string {
    return actionBarStealthInitializedKey(this.slotMapKey(form));
  }

  private loadStealthActions(
    parsed: HotbarAction[],
    stored: boolean,
    storedRaw: string | null,
  ): void {
    let initialized = false;
    try {
      initialized = this.deps.storage.getItem(this.stealthBarInitializedKey()) === '1';
    } catch {
      // Storage can be unavailable in private browsing modes.
    }

    let actions = parsed;
    let shouldPersist = !stored;
    if (!initialized) {
      const parentForm: HotbarForm = this.activeFormState === 'cat_stealth' ? 'cat' : 'normal';
      let parentStoredRaw: string | null = null;
      try {
        parentStoredRaw = this.deps.storage.getItem(this.slotMapKey(parentForm));
      } catch {
        // Storage can be unavailable in private browsing modes.
      }
      if (!stored || (storedRaw !== null && storedRaw === parentStoredRaw)) {
        actions = Array.from({ length: ACTION_BAR_ABILITY_SLOTS }, () => null);
        shouldPersist = true;
      }
    }

    this.loadedFromStorage = true;
    this.actionState = actions;
    this.knownAbilityIdsAtLastSync = null;
    try {
      if (shouldPersist) this.deps.storage.setItem(this.slotMapKey(), JSON.stringify(actions));
      if (!initialized) this.deps.storage.setItem(this.stealthBarInitializedKey(), '1');
    } catch {
      // Persisting the page must succeed before its migration marker is written.
    }
  }

  private seedFormBarIfNeeded(parsed: HotbarAction[]): boolean {
    let alreadySeeded = false;
    try {
      alreadySeeded = this.deps.storage.getItem(this.formBarSeededKey()) === '1';
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
    if (alreadySeeded) return false;

    let normalRaw: unknown = null;
    try {
      normalRaw = JSON.parse(this.deps.storage.getItem(this.slotMapKey('normal')) ?? 'null');
    } catch {
      // Corrupt state is treated as an empty bar.
    }
    const normalActions = parseHotbarActions(
      normalRaw,
      ACTION_BAR_ABILITY_SLOTS,
      (id) => !!ABILITIES[id] || !!SPORT_ABILITIES[id],
      // The stored-layout keep predicate here too: a normal bar holding an
      // unknown-id slot must still read as occupied, or the seeding decision
      // treats it as emptier than it is.
      (id) => this.keepsStoredItemId(id),
    );

    this.markFormBarSeeded();
    if (!shouldSeedFormBar(parsed, normalActions, false)) return false;

    this.actionState = buildDefaultFormBar(
      this.formKitAbilityIds(this.activeFormState),
      ACTION_BAR_ABILITY_SLOTS,
    );
    this.loadedFromStorage = true;
    this.knownAbilityIdsAtLastSync = null;
    this.saveActions();
    return true;
  }

  private loadActions(): void {
    let raw: unknown = null;
    let stored = false;
    let storedRaw: string | null = null;
    try {
      storedRaw = this.deps.storage.getItem(this.slotMapKey());
      raw = JSON.parse(storedRaw ?? 'null');
      stored = Array.isArray(raw);
    } catch {
      // Corrupt state is treated as an empty bar.
    }
    const parsed = parseHotbarActions(
      raw,
      ACTION_BAR_ABILITY_SLOTS,
      (id) => this.isStoredAbilityEligible(id),
      (id) => this.keepsStoredItemId(id),
    );
    if (stored && storedHotbarHasIneligibleAbility(raw, (id) => this.isStoredAbilityEligible(id))) {
      try {
        this.deps.storage.setItem(this.slotMapKey(), JSON.stringify(parsed));
      } catch {
        // Storage can be unavailable in private browsing modes.
      }
    }
    if (this.activeFormState === 'sport' || this.activeFormState === 'rally') {
      if (parsed.every((action) => action === null)) {
        this.actionState = buildDefaultFormBar(
          this.formKitAbilityIds(this.activeFormState),
          ACTION_BAR_ABILITY_SLOTS,
        );
        this.loadedFromStorage = true;
        this.knownAbilityIdsAtLastSync = null;
        return;
      }
      this.loadedFromStorage = stored;
      this.actionState = parsed;
      this.knownAbilityIdsAtLastSync = null;
      return;
    }
    if (this.isStealthForm()) {
      this.loadStealthActions(parsed, stored, storedRaw);
      return;
    }
    if (this.isFormKitBar()) {
      if (this.seedFormBarIfNeeded(parsed)) return;
      this.loadedFromStorage = stored;
      this.actionState = parsed;
      this.knownAbilityIdsAtLastSync = null;
      return;
    }
    this.loadedFromStorage = stored;
    this.actionState = parsed;
    this.knownAbilityIdsAtLastSync = null;
  }

  private formToggleAbilityId(): string | null {
    if (this.activeFormState === 'bear') return 'bear_form';
    if (this.activeFormState === 'cat') return 'cat_form';
    return null;
  }

  private loadAttackAction(): void {
    const key = attackSlotStorageKey(this.slotMapKey());
    let storedRaw: string | null = null;
    try {
      storedRaw = this.deps.storage.getItem(key);
      this.attackActionState = readAttackSlotAction(
        this.deps.storage,
        key,
        (id) => this.deps.knownAbilityIds().includes(id) && this.isAbilityPlacementAllowed(id),
        (id) => this.keepsStoredItemId(id),
      );
      if (storedRaw !== null && this.attackActionState === null) this.deps.storage.removeItem(key);
    } catch {
      this.attackActionState = null;
    }
  }
}
