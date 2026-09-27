# HUD domain: Realm Racers loading lobby

The curtain a race opens under while every pilot's machine prepares the circuit
(the sim's `loading` phase, `src/sim/social/realm_racers_loading.ts`, read through
`IWorld.realmRacersInfo`), behind the `index.ts` barrel. `src/ui/realm_racers.ts`
(`RealmRacersUi`) composes it; the rest of the rally HUD still lives flat in `src/ui/`.

- `realm_racers_lobby_view.ts`: the pure, DOM-free core (registered in `UI_PURE_CORES`).
  `buildRealmRacersLobbyView(match, progress)` shows only while the viewer's own match is
  in `loading`, so the curtain lifts for the whole grid on the server's switch to the
  countdown and a reconnect into a race already under way never sees it. Pilots are the
  grid in `participantIds` order, named from `standings` (a pid with no standings row is
  dropped rather than shown unnamed); a house pilot is Ready from the seat. The bar is
  this machine's preparation (`realmRacersPrepareProgress()` in
  `src/render/realm_racers_prepare.ts`): prepared units over units, never 100 before
  every producer has its verdict. The `sig` is the match, the circuit and the grid shape;
  the container and its pilot slots are reused across frames (the standings view pattern).
- `realm_racers_lobby_painter.ts`: the thin painter (`RealmRacersLobby`), a self-mounted
  `#realm-racers-lobby` curtain in the HUD layer. It holds ONE arrival-cover depth
  (`setArrivalCover`, `src/render/arrival_cover.ts`) for as long as it is shown, which is
  what makes it a curtain of the loading-screen family rather than an overlay: the
  GPU-prep admission and the frame cadence treat its frames as covered. It never waits on
  reveals and never touches input, the ready send or GO. ONE innerHTML write per sig
  change; every name, status, count, the bar width and its `aria-valuenow` / `aria-valuetext` ride the
  `PainterHost` elided writers.
- The ready send is not here: `src/ui/realm_racers_ready_core.ts` sends it once the
  preparation readout is `settled`, and re-sends while the lobby does not list the viewer.
- Copy: `hudChrome.rally.lobby*` in `src/ui/i18n.catalog/hud_chrome.ts`, plus the rally's
  own `title`, `standingsYou`, `standingsBot` and circuit-name keys. Styles: the
  `realm racers lobby` section in `src/styles/components.css`, mobile in
  `src/styles/hud.mobile.css`.
