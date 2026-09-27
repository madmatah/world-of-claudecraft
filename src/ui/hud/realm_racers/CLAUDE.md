# HUD domain: Realm Racers loading lobby

The curtain a race opens under while every pilot's machine prepares the circuit
(the sim's `loading` phase, `src/sim/social/realm_racers_loading.ts`, read through
`IWorld.realmRacersInfo`), behind the `index.ts` barrel. `src/ui/realm_racers.ts`
(`RealmRacersUi`) composes it; the rest of the rally HUD still lives flat in `src/ui/`.

- `realm_racers_lobby_view.ts`: the pure, DOM-free core (registered in `UI_PURE_CORES`).
  - `buildRealmRacersLobbyView(match, progress)` shows only while the viewer's own match
    is in `loading`, so the curtain lifts for the whole grid on the server's switch to the
    countdown, and a reconnect into a race already under way never sees it. Pilots are the
    grid in `participantIds` order, named from `standings` (a pid with no standings row is
    dropped rather than shown unnamed); a house pilot is Ready from the seat. The bar is
    this machine's preparation (`RealmRacersPrepare.progress`, read by Hud from its
    CURRENT renderer, so a graphics rebuild hands over the new seam): prepared units over
    units, never 100 before every producer has its verdict. The `sig` is the match, the
    circuit and the grid shape; the container and its pilot slots are reused across frames.
  - `stepRealmRacersLobbyFailsafe` is the client bound: each received `secondsLeft` becomes
    a client-clock deadline, and past it plus a small grace the curtain stays down for that
    match. Presentation only: it never sends ready and never touches readiness.
- `realm_racers_lobby_painter.ts`: the thin painter (`RealmRacersLobby`), a self-mounted
  `#realm-racers-lobby` curtain (`role="dialog"`, named by the circuit heading), mounted
  FIRST in the HUD layer.
  - It holds one arrival-cover depth (`src/render/arrival_cover.ts`) only while this
    machine is still preparing: the GPU-prep admission then runs on the cover rule, as
    under the loading screen. Once settled the depth drops while the curtain stays up, so
    the lanes the cover refuses run behind the curtain, not in the countdown.
  - While shown it holds the window and menu keys (below). It never touches the ready
    send or GO.
  - ONE innerHTML write per sig change; every name, status, count, the bar width, its aria
    values and the dialog's name ride the `PainterHost` elided writers, and a localized
    string is resolved again only when the value it spells changes. `dispose()` drops the
    depth and the hold.
- `realm_racers_lobby_hold.ts`: the key hold the painter owns. `rallyLobbyHoldsAction` is
  asked by `dispatchCollectionAction` (`src/ui/collection_actions_core.ts`, the keyboard
  path's early call before any window toggle) and at the head of the pad dispatcher in
  `main.ts`; every action but `chat` is swallowed while the curtain is shown.
- `RealmRacersUi` lifts the curtain early on a lost connection (`connectionDropActive` in
  `src/ui/reconnect_overlay.ts`) and on the failsafe. Its ready send (`sendReady`, with
  `src/ui/realm_racers_ready_core.ts`) runs above Hud's paint cut, so a hidden window still
  readies.
- Chat stays usable: `#chatlog-wrap` is a later sibling of the curtain and is lifted above
  it (the desktop composer is a body-level layer over `#ui` already). Nothing else is.
- Copy: `hudChrome.rally.lobby*` in `src/ui/i18n.catalog/hud_chrome.ts`, plus the rally's
  own `title`, `standingsYou`, `standingsBot` and circuit-name keys. Styles: the
  `realm racers lobby` section in `src/styles/components.css`, touch rules in
  `src/styles/hud.mobile.css`.
