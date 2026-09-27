// HUD domain: Realm Racers. The loading-lobby curtain the rally UI composes
// while the viewer's race prepares (see CLAUDE.md here).

export type { RealmRacersLobbyDeps } from './realm_racers_lobby_painter';
export { RealmRacersLobby } from './realm_racers_lobby_painter';
export type {
  RealmRacersLobbyLive,
  RealmRacersLobbyPilot,
  RealmRacersLobbyProgress,
  RealmRacersLobbyStatus,
  RealmRacersLobbyView,
} from './realm_racers_lobby_view';
export { buildRealmRacersLobbyView, realmRacersLobbyPercent } from './realm_racers_lobby_view';
