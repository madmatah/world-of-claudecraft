// HUD domain: Realm Racers. The loading-lobby curtain the rally UI composes
// while the viewer's race prepares, the race warm of its first-use sounds and
// icons, plus the rally helpers extracted from hud.ts (see CLAUDE.md here).

export {
  predictRallyGroundBlastFire,
  predictRallySlickDrop,
  rallyAimCaster,
  rallyCastFeedbackAllowed,
  refuseLockedAbility,
} from './realm_racers_cast_feedback';
export { applyRealmRacersEventPresentation } from './realm_racers_event_router';
export { realmRacersSplashDeps, realmRacersUiDeps } from './realm_racers_hud_parts';
export { RALLY_LOBBY_HELD_ACTIONS, RealmRacersLobbyHold } from './realm_racers_lobby_hold';
export type { RealmRacersLobbyDeps } from './realm_racers_lobby_painter';
export { RealmRacersLobby } from './realm_racers_lobby_painter';
export type {
  RealmRacersLobbyFailsafe,
  RealmRacersLobbyLive,
  RealmRacersLobbyPilot,
  RealmRacersLobbyProgress,
  RealmRacersLobbyStatus,
  RealmRacersLobbyView,
} from './realm_racers_lobby_view';
export {
  buildRealmRacersLobbyView,
  createRealmRacersLobbyFailsafe,
  REALM_RACERS_LOBBY_FAILSAFE_GRACE_MS,
  realmRacersLobbyPercent,
  stepRealmRacersLobbyFailsafe,
} from './realm_racers_lobby_view';
export type { RealmRacersRaceWarmSinks } from './realm_racers_race_warm';
export { RealmRacersRaceWarm } from './realm_racers_race_warm';
