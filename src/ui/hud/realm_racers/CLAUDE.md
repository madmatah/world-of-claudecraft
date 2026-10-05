# HUD domain: Realm Racers loading lobby

Also here, extracted from `hud.ts` and taking the Hud untyped (the
`hud/quest/quest_event_router.ts` precedent, welded to hud.ts in
`tests/realm_racers_ui.test.ts`): `realm_racers_event_router.ts` (the rally
sim events' log lines, banners, pickup note and cues), `realm_racers_cast_feedback.ts`
(the aim caster pose, the instant local cues of a shot or oil drop, the refusal of a
held kit ability) and `realm_racers_hud_parts.ts` (the pickup splash Hud owns, built by
`createRealmRacersSplash`, and the deps Hud builds `RealmRacersUi` from).

`realm_racers_race_warm.ts` (`RealmRacersRaceWarm`) warms what a race first reaches for
at speed, on the race GPU preparation's own commitment trigger
(`takeRealmRacersPrepare` in `src/render/realm_racers_prepare_core.ts`: queue, practice,
seated, band), once per HUD, from `RealmRacersUi.sendReady` above the paint cut. Sounds:
the race clips (`src/game/realm_racers_sfx.ts`, the table `sfx.ts` plays them from, plus
the HUD's apply cues of the race auras) that the manifest leaves lazy, through
`sfx.preload`. Icons: the splash of every pickup effect, the rally slots at the bar size
and the buff bar's race auras, through `prewarmIconCache` (`src/ui/icon_prewarm.ts`, eager,
one worker encode in flight for this pump); a browser with no worker canvas keeps the
on-demand build. Pinned by `tests/realm_racers_race_warm.test.ts`, offline and online.

The curtain a race opens under while every pilot's machine prepares the circuit
(the sim's `loading` phase, `src/sim/social/realm_racers_loading.ts`, read through
`IWorld.realmRacersInfo`), behind the `index.ts` barrel. `src/ui/realm_racers.ts`
(`RealmRacersUi`) composes it; the rest of the rally HUD still lives flat in `src/ui/`:
`RealmRacersUi` is a thin composer (match edges, banner, countdown cue, ready send) over
the cold window (`realm_racers_window.ts`, both screens), the hot race strip
(`realm_racers_strip_painter.ts`, in `HOT_PAINTERS`), the standings panel and the podium.
`RealmRacersUi` also marks body with `RALLY_RACE_ON_CLASS` while the viewer's own match
exists (the race strip is up, lobby included), through the elided writer: the plain
banners ride the band above the strip and the new-adventurer card and its arrow stand
down (the race strip rules in `src/styles/components.css`, the touch twin in
`src/styles/hud.mobile.css`, pinned by `tests/realm_racers_lobby_css.test.ts`).

- `realm_racers_lobby_view.ts`: the pure, DOM-free core (registered in `UI_PURE_CORES`).
  - `buildRealmRacersLobbyView(match, progress)` shows only while the viewer's own match
    is in `loading`, so the curtain lifts for the whole grid on the server's switch to the
    countdown, and a reconnect into a race already under way never sees it. Pilots are the
    grid in `participantIds` order, named from `standings` (a pid with no standings row is
    dropped rather than shown unnamed); a house pilot is Ready from the seat. The bar is
    this machine's preparation (`RealmRacersPrepare.progress`, read by Hud from its
    CURRENT renderer through the read-only `renderer.realmRacers.prepare` slice, so a
    graphics rebuild hands over the new seam; one read per frame is shared by the ready
    send and the paint, and it names the drawn circuit so that circuit's own preparation
    counts before the renderer has asked for it): prepared units over
    units, never 100 before every producer has its verdict. The `sig` is the match, the
    circuit and the grid shape; the container and its pilot slots are reused across frames.
  - `stepRealmRacersLobbyFailsafe` is the client bound: each newly received, changed
    `secondsLeft` becomes a client-clock deadline, so a frozen readout drops the curtain
    past it plus a small grace, while a lobby that is still counting (after a stalled or
    backgrounded client) raises it again. Presentation only: it never sends ready and never
    touches readiness.
- `realm_racers_lobby_painter.ts`: the thin painter (`RealmRacersLobby`), a self-mounted
  `#realm-racers-lobby` curtain (`role="dialog"`, named by the circuit heading, NOT modal:
  the chat frame outside it stays reachable), mounted FIRST in the HUD layer. It marks body
  with `RALLY_LOBBY_SHOWN_CLASS` while shown.
  - It holds one arrival-cover depth (`src/render/arrival_cover.ts`, injected as
    `setCover` by `realm_racers_hud_parts.ts`, never imported by the painter) only while
    this machine is still preparing: the GPU-prep admission then runs on the cover rule, as
    under the loading screen. Once settled the depth drops while the curtain stays up, so
    the lanes the cover refuses run behind the curtain, not in the countdown.
  - While shown it holds the window and menu keys (below). It never touches the ready
    send or GO.
  - ONE innerHTML write per sig change; every name, status, count, the bar width, its aria
    values and the dialog's name ride the `PainterHost` elided writers, and a localized
    string is resolved again only when the value it spells changes. `dispose()` drops the
    depth and the hold.
- `realm_racers_lobby_hold.ts`: `RealmRacersLobbyHold`, one instance per `RealmRacersUi`
  (Hud exposes it as `lobbyHold`), set by the painter. `holds(action)` covers a CLOSED set
  of window and menu actions (`RALLY_LOBBY_HELD_ACTIONS`), the same on the keyboard and the
  pad: both paths pass Hud as the host of `dispatchCollectionAction`, which asks the hold
  before any window toggle. Chat, Hide Interface and Escape stay live, so a hidden interface
  is always recoverable; `main.ts` gates only Escape's game-menu arm on `shown`. Targeting,
  slots, camera and pet commands are never held. On touch, the Quick Actions strip ignores
  a swipe onto an item the curtain hides (`menu_control_controller.ts` reads the body class).
- `RealmRacersUi` lifts the curtain early on a lost connection (`connectionDropActive` in
  `src/ui/reconnect_overlay.ts`: the reconnect overlay actually mounted, so a blip inside
  its show grace never flashes the world, or the session ended, with or without the fatal
  overlay) and on the failsafe. Its ready send (`sendReady`, with
  `src/ui/realm_racers_ready_core.ts`) runs above Hud's paint cut, so a hidden window still
  readies.
- Chat stays usable: `#chatlog-wrap` is a later sibling of the curtain and is lifted above
  it (the desktop composer is a body-level layer over `#ui` already); on touch the Quick
  Actions anchor and its Chat item are the only controls shown over it. Nothing else is.
- Known and accepted: an action-bar slot that opens a window (a tradeskill spell, a
  container) and a client-side chat command that opens one (`/who`) are not key actions, so
  the hold does not see them; the window opens under the curtain and appears when it lifts.
- Copy: `hudChrome.rally.lobby*` in `src/ui/i18n.catalog/hud_chrome.ts`, plus the rally's
  own `title`, `standingsYou`, `standingsBot` and circuit-name keys. Styles: the
  `realm racers lobby` section in `src/styles/components.css`, touch rules in
  `src/styles/hud.mobile.css`.
