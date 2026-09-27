// HUD domain: Realm Racers. The loading-lobby curtain the rally UI composes
// while the viewer's race prepares (see CLAUDE.md here).

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
