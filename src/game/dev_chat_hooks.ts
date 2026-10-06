// The dev-only chat interceptors, composed in one hook so main.ts stays a
// firewall: the day/night scrub, the Ignivar/Drakelands placer rig and the
// Mortar Overdrive circuit-draft race all ride the chat input's send path, fire only in dev builds, and consume the
// line when they recognize it (the caller clears the input and closes chat
// on true). A future dev chat command joins this chain, never main.ts.
import type * as THREE from 'three';
import {
  currentQuestPlacements,
  type QuestPlacerWorld,
} from '../render/world_quest_placer_sources';
import type { MortarOverdriveCircuit } from '../sim/content/mortar_overdrive';
import type { Entity } from '../sim/types';
import { type DayNightDevHud, tryDayNightDevCommand } from './daynight_dev_command';
import { tryIgnivarPlacerCommand } from './ignivar_placer';
import {
  fetchMortarOverdriveDraft,
  parseMortarOverdriveDraftCommand,
  runMortarOverdriveDraftCommand,
} from './mortar_overdrive/draft_dev';

/** `/dev overdrivedraft <id> [tier]` (mortar_overdrive/draft_dev.ts): the offline sim
 *  registers the editor draft and the renderer draws it. */
export interface MortarOverdriveDraftHookDeps {
  /** Null online: the server is authoritative and never registers a draft. */
  sim: {
    mortarOverdriveRegisterDraftCircuit(circuit: MortarOverdriveCircuit): {
      lane: number;
      problems: readonly string[];
    };
  } | null;
  draw(circuit: MortarOverdriveCircuit): void;
}

export interface DevChatHookDeps {
  hud: DayNightDevHud & { log(text: string, color?: string): void };
  renderer: {
    scene: THREE.Scene;
    worldCompileGate(): ((target: THREE.Object3D) => Promise<unknown>) | undefined;
  };
  world: QuestPlacerWorld & { player: Entity | undefined; chat(text: string): void };
  mortarOverdriveDraft?: MortarOverdriveDraftHookDeps;
}

export function tryDevChatHooks(raw: string, deps: DevChatHookDeps): boolean {
  if (!import.meta.env.DEV) return false;
  if (tryDayNightDevCommand(raw, deps.hud)) return true;
  if (
    tryIgnivarPlacerCommand(raw, {
      scene: deps.renderer.scene,
      compilePreview: deps.renderer.worldCompileGate(),
      getPlayer: () => deps.world.player,
      getCurrentQuestPlacements: () => currentQuestPlacements(deps.world),
      log: (text, color) => deps.hud.log(text, color),
      chat: (text) => deps.world.chat(text),
    })
  ) {
    return true;
  }
  return tryMortarOverdriveDraftHook(raw, deps);
}

function tryMortarOverdriveDraftHook(raw: string, deps: DevChatHookDeps): boolean {
  const command = parseMortarOverdriveDraftCommand(raw);
  if (!command) return false;
  const draft = deps.mortarOverdriveDraft;
  const sim = draft?.sim ?? null;
  // CLAIMED even when it cannot run: falling through would send
  // "/dev overdrivedraft ..." to the world as a public chat line.
  if (!draft || !sim) {
    deps.hud.log(
      '[dev] Circuit drafts are offline only: the server never registers one.',
      '#ffcf6a',
    );
    return true;
  }
  void runMortarOverdriveDraftCommand(command, {
    fetchDraft: fetchMortarOverdriveDraft,
    register: (circuit) => sim.mortarOverdriveRegisterDraftCircuit(circuit),
    draw: (circuit) => draft.draw(circuit),
    race: (chatCommand) => deps.world.chat(chatCommand),
    log: (text) => deps.hud.log(text, '#8fd0ff'),
  });
  return true;
}
