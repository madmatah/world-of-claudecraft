// HUD domain: Mortar Overdrive. The loading-lobby curtain the Mortar Overdrive UI composes
// while the viewer's race prepares, the race warm of its first-use sounds and
// icons, plus the Mortar Overdrive helpers extracted from hud.ts (see CLAUDE.md here).

export {
  mortarOverdriveAimCaster,
  mortarOverdriveCastFeedbackAllowed,
  predictMortarOverdriveGroundBlastFire,
  predictMortarOverdriveSlickDrop,
  refuseLockedAbility,
} from './cast_feedback';
export { applyMortarOverdriveEventPresentation } from './event_router';
export {
  createMortarOverdriveSplash,
  mortarOverdriveSplashDeps,
  mortarOverdriveUiDeps,
} from './hud_parts';
export { MORTAR_OVERDRIVE_LOBBY_HELD_ACTIONS, MortarOverdriveLobbyHold } from './lobby_hold';
export type { MortarOverdriveLobbyDeps } from './lobby_painter';
export { MortarOverdriveLobby } from './lobby_painter';
export type {
  MortarOverdriveLobbyFailsafe,
  MortarOverdriveLobbyLive,
  MortarOverdriveLobbyPilot,
  MortarOverdriveLobbyProgress,
  MortarOverdriveLobbyStatus,
  MortarOverdriveLobbyView,
} from './lobby_view';
export {
  buildMortarOverdriveLobbyView,
  createMortarOverdriveLobbyFailsafe,
  MORTAR_OVERDRIVE_LOBBY_FAILSAFE_GRACE_MS,
  mortarOverdriveLobbyPercent,
  stepMortarOverdriveLobbyFailsafe,
} from './lobby_view';
export type { MortarOverdriveRaceWarmSinks } from './race_warm';
export { MortarOverdriveRaceWarm } from './race_warm';
