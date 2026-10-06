# HUD domain: Mortar Overdrive

The whole Mortar Overdrive HUD lives here (it moved out of flat `src/ui/` with the rename),
behind the `index.ts` barrel `hud.ts` imports; files here import their siblings directly,
never the barrel.

- Composer and window: `composer.ts` (`MortarOverdriveUi`), `race_window.ts` (the cold
  window, both screens) over the pure `race_view.ts` (window, setup and strip view model).
- Race strip, standings, podium: `strip_painter.ts` (hot, in `HOT_PAINTERS`),
  `standings_painter.ts` + `standings_view.ts`, `podium_painter.ts` + `podium_view.ts`,
  `result_notice_view.ts`, `ready_core.ts` (the lobby ready send).
- Pickup splash: `pickup_splash_controller.ts` + `pickup_splash_view.ts`, copy in
  `pickup_i18n.ts`; circuit names in `circuit_i18n.ts`.
- Loading lobby: `lobby_view.ts`, `lobby_painter.ts`, `lobby_hold.ts` (below).
- Extracted from `hud.ts`: `event_router.ts`, `cast_feedback.ts`, `hud_parts.ts`,
  `race_warm.ts` (below).

Also here, extracted from `hud.ts` and taking the Hud untyped (the
`hud/quest/quest_event_router.ts` precedent, welded to hud.ts in
`tests/mortar_overdrive_ui.test.ts`): `mortar_overdrive/event_router.ts` (the Mortar Overdrive
sim events' log lines, banners, pickup note and cues), `mortar_overdrive/cast_feedback.ts`
(the aim caster pose, the instant local cues of a shot or oil drop, the refusal of a
held kit ability) and `mortar_overdrive/hud_parts.ts` (the pickup splash Hud owns, built by
`createMortarOverdriveSplash`, and the deps Hud builds `MortarOverdriveUi` from).

`mortar_overdrive/race_warm.ts` (`MortarOverdriveRaceWarm`) warms what a race first reaches for
at speed, on the race GPU preparation's own commitment trigger
(`takeMortarOverdrivePrepare` in `src/render/mortar_overdrive/prepare_core.ts`: queue, practice,
seated, band), once per HUD, from `MortarOverdriveUi.sendReady` above the paint cut. Sounds:
the race clips (`src/game/mortar_overdrive/sfx.ts`, the table `sfx.ts` plays them from, plus
the HUD's apply cues of the race auras) that the manifest leaves lazy, through
`sfx.preload`. Icons: the splash of every pickup effect, the Mortar Overdrive slots at the bar size
and the buff bar's race auras, through `prewarmIconCache` (`src/ui/icon_prewarm.ts`, eager,
one worker encode in flight for this pump); a browser with no worker canvas keeps the
on-demand build. Pinned by `tests/mortar_overdrive_race_warm.test.ts`, offline and online.

The curtain a race opens under while every pilot's machine prepares the circuit
(the sim's `loading` phase, `src/sim/mortar_overdrive/loading.ts`, read through
`IWorld.mortarOverdriveInfo`), behind the `index.ts` barrel. `src/ui/hud/mortar_overdrive/composer.ts`
(`MortarOverdriveUi`) composes it:
`MortarOverdriveUi` is a thin composer (match edges, banner, countdown cue, ready send) over
the cold window (`mortar_overdrive/race_window.ts`, both screens), the hot race strip
(`mortar_overdrive/strip_painter.ts`, in `HOT_PAINTERS`), the standings panel and the podium.
`MortarOverdriveUi` also marks body with `MORTAR_OVERDRIVE_RACE_ON_CLASS` while the viewer's own match
exists (the race strip is up, lobby included), through the elided writer: the plain
banners ride the band above the strip and the new-adventurer card and its arrow stand
down (the race strip rules in `src/styles/components.css`, the touch twin in
`src/styles/hud.mobile.css`, pinned by `tests/mortar_overdrive_lobby_css.test.ts`).

- `mortar_overdrive/lobby_view.ts`: the pure, DOM-free core (registered in `UI_PURE_CORES`).
  - `buildMortarOverdriveLobbyView(match, progress)` shows only while the viewer's own match
    is in `loading`, so the curtain lifts for the whole grid on the server's switch to the
    countdown, and a reconnect into a race already under way never sees it. Pilots are the
    grid in `participantIds` order, named from `standings` (a pid with no standings row is
    dropped rather than shown unnamed); a house pilot is Ready from the seat. The bar is
    this machine's preparation (`MortarOverdrivePrepare.progress`, read by Hud from its
    CURRENT renderer through the read-only `renderer.mortarOverdrive.prepare` slice, so a
    graphics rebuild hands over the new seam; one read per frame is shared by the ready
    send and the paint, and it names the drawn circuit and the match so that circuit's own
    preparation counts before the renderer has asked for it, and a new lobby on a circuit
    already prepared never reads the last lobby's verdict): prepared units over
    units, never 100 before every producer has its verdict. The `sig` is the match, the
    circuit and the grid shape; the container and its pilot slots are reused across frames.
  - `stepMortarOverdriveLobbyFailsafe` is the client bound: each newly received, changed
    `secondsLeft` becomes a client-clock deadline, so a frozen readout drops the curtain
    past it plus a small grace, while a lobby that is still counting (after a stalled or
    backgrounded client) raises it again. Presentation only: it never sends ready and never
    touches readiness.
- `mortar_overdrive/lobby_painter.ts`: the thin painter (`MortarOverdriveLobby`), a self-mounted
  `#mortar-overdrive-lobby` curtain (`role="dialog"`, named by the circuit heading, NOT modal:
  the chat frame outside it stays reachable), mounted FIRST in the HUD layer. It marks body
  with `MORTAR_OVERDRIVE_LOBBY_SHOWN_CLASS` while shown.
  - It holds one arrival-cover depth (`src/render/arrival_cover.ts`, injected as
    `setCover` by `mortar_overdrive/hud_parts.ts`, never imported by the painter) only while
    this machine is still preparing: the GPU-prep admission then runs on the cover rule, as
    under the loading screen. Once settled the depth drops while the curtain stays up, so
    the lanes the cover refuses run behind the curtain, not in the countdown.
  - While shown it holds the window and menu keys (below). It never touches the ready
    send or GO.
  - ONE innerHTML write per sig change; every name, status, count, the bar width, its aria
    values and the dialog's name ride the `PainterHost` elided writers, and a localized
    string is resolved again only when the value it spells changes. `dispose()` drops the
    depth and the hold.
- `mortar_overdrive/lobby_hold.ts`: `MortarOverdriveLobbyHold`, one instance per `MortarOverdriveUi`
  (Hud exposes it as `lobbyHold`), set by the painter. `holds(action)` covers a CLOSED set
  of window and menu actions (`MORTAR_OVERDRIVE_LOBBY_HELD_ACTIONS`), the same on the keyboard and the
  pad: both paths pass Hud as the host of `dispatchCollectionAction`, which asks the hold
  before any window toggle. Chat, Hide Interface and Escape stay live, so a hidden interface
  is always recoverable; `main.ts` gates only Escape's game-menu arm on `shown`. Targeting,
  slots, camera and pet commands are never held. On touch, the Quick Actions strip ignores
  a swipe onto an item the curtain hides (`menu_control_controller.ts` reads the body class).
- `MortarOverdriveUi` lifts the curtain early on a lost connection (`connectionDropActive` in
  `src/ui/reconnect_overlay.ts`: the reconnect overlay actually mounted, so a blip inside
  its show grace never flashes the world, or the session ended, with or without the fatal
  overlay) and on the failsafe. Its ready send (`sendReady`, with
  `src/ui/hud/mortar_overdrive/ready_core.ts`) runs above Hud's paint cut, so a hidden window still
  readies.
- Chat stays usable: `#chatlog-wrap` is a later sibling of the curtain and is lifted above
  it (the desktop composer is a body-level layer over `#ui` already); on touch the Quick
  Actions anchor and its Chat item are the only controls shown over it. Nothing else is.
- Known and accepted: an action-bar slot that opens a window (a tradeskill spell, a
  container) and a client-side chat command that opens one (`/who`) are not key actions, so
  the hold does not see them; the window opens under the curtain and appears when it lifts.
- Copy: `hudChrome.mortarOverdrive.lobby*` in `src/ui/i18n.catalog/hud_chrome.ts`, plus the Mortar Overdrive's
  own `title`, `standingsYou`, `standingsBot` and circuit-name keys. Styles: the
  `mortar overdrive lobby` section in `src/styles/components.css`, touch rules in
  `src/styles/hud.mobile.css`.
