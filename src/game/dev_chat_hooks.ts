// The dev-only chat interceptors, composed in one hook so main.ts stays a
// firewall: the day/night scrub, the Ignivar/Drakelands placer rig and the
// Realm Racers circuit-draft race all ride the chat input's send path, fire only in dev builds, and consume the
// line when they recognize it (the caller clears the input and closes chat
// on true). A future dev chat command joins this chain, never main.ts.
import type * as THREE from 'three';
import {
  currentQuestPlacements,
  type QuestPlacerWorld,
} from '../render/world_quest_placer_sources';
import type { RealmRacersCircuit } from '../sim/content/realm_racers_circuits';
import type { Entity } from '../sim/types';
import { type DayNightDevHud, tryDayNightDevCommand } from './daynight_dev_command';
import { tryIgnivarPlacerCommand } from './ignivar_placer';
import {
  fetchRealmRacersDraft,
  parseRealmRacersDraftCommand,
  runRealmRacersDraftCommand,
} from './realm_racers_draft_dev';

/** `/dev rallydraft <id> [tier]` (realm_racers_draft_dev.ts): the offline sim
 *  registers the editor draft and the renderer draws it. */
export interface RealmRacersDraftHookDeps {
  /** Null online: the server is authoritative and never registers a draft. */
  sim: {
    realmRacersRegisterDraftCircuit(circuit: RealmRacersCircuit): {
      lane: number;
      problems: readonly string[];
    };
  } | null;
  draw(circuit: RealmRacersCircuit): void;
}

export interface DevChatHookDeps {
  hud: DayNightDevHud & { log(text: string, color?: string): void };
  renderer: {
    scene: THREE.Scene;
    worldCompileGate(): ((target: THREE.Object3D) => Promise<unknown>) | undefined;
  };
  world: QuestPlacerWorld & { player: Entity | undefined; chat(text: string): void };
  realmRacersDraft?: RealmRacersDraftHookDeps;
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
  return tryRealmRacersDraftHook(raw, deps);
}

function tryRealmRacersDraftHook(raw: string, deps: DevChatHookDeps): boolean {
  const command = parseRealmRacersDraftCommand(raw);
  if (!command) return false;
  const draft = deps.realmRacersDraft;
  const sim = draft?.sim ?? null;
  // CLAIMED even when it cannot run: falling through would send
  // "/dev rallydraft ..." to the world as a public chat line.
  if (!draft || !sim) {
    deps.hud.log(
      '[dev] Circuit drafts are offline only: the server never registers one.',
      '#ffcf6a',
    );
    return true;
  }
  void runRealmRacersDraftCommand(command, {
    fetchDraft: fetchRealmRacersDraft,
    register: (circuit) => sim.realmRacersRegisterDraftCircuit(circuit),
    draw: (circuit) => draft.draw(circuit),
    race: (chatCommand) => deps.world.chat(chatCommand),
    log: (text) => deps.hud.log(text, '#8fd0ff'),
  });
  return true;
}
