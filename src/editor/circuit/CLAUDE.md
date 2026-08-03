<!-- src/editor/circuit/: the Realm Racers circuit editor. Root, src/ and
     src/editor/ CLAUDE.md carry the shared rules; this file covers what is
     specific to drawing a circuit. -->

# src/editor/circuit/ : the Realm Racers circuit editor (`circuit_editor.html`)

A DEV tool. It draws a Realm Racers circuit against the live readout that says
whether the sim can drive it, and exports a record to paste. It exists because
authoring a circuit by hand failed twice on defects a sketch cannot show (a loop
that crossed itself, a corner tighter than its own road), and the pool is meant
to grow to one themed circuit per game zone.

## It never ships
- `circuit_editor.html` sits at the repo ROOT beside `music_editor.html` and is
  deliberately absent from `input` in `vite.config.ts`, so no production build
  emits it. Open it under `npm run dev` at `http://localhost:5173/circuit_editor.html`.
- English-only, the same dev-tool carve-out the music editor and the perf overlay
  take. No `t()`, no i18n catalog keys.
- The three endpoints (`POST /__circuit_editor/save`, `GET /__circuit_editor/drafts`,
  `GET /__circuit_editor/draft/<id>`) are registered in `configureServer` only,
  which runs under the dev server and nowhere else. The save arm validates the
  payload through `validateCircuitPayload` before writing, and it writes to
  `tmp/circuit-drafts/<id>.ts` (gitignored scratch), NEVER to
  `src/sim/content/realm_racers_circuits.ts`: that module is hand-curated and its
  comments carry the reasoning behind every number. The two GET arms decide
  nothing in `vite.config.ts`: `draft_endpoints_core.ts` answers them, so the id
  handling is unit-tested (`tests/editor_circuit_draft_endpoints.test.ts`). An id
  arriving off a URL is checked against the same shape the save endpoint names its
  files with BEFORE any read, so no request can resolve out of the draft
  directory.

## Driving a draft: `/dev rallydraft <id> [tier]`
The read endpoint exists so a running dev client can race a draft with no source
edit and no restart. The command is intercepted in the CLIENT
(`src/game/realm_racers_draft_dev.ts`, wired in `src/main.ts`) and not in
`src/sim/dev_commands.ts`, for one reason that decides the shape: **the sim never
fetches**. The client reads the draft, validates it with the same
`validateCircuitPayload` the save endpoint runs, and hands the sim a plain record
(`Sim.realmRacersRegisterDraftCircuit`); the sim's own `/dev rally` then races it,
because a registered draft resolves through `realmRacersCircuitById` exactly like an
authored circuit. Offline dev builds only, and the sim refuses the registration
outright without `ctx.devCommands`.

## Where the rules live
- **The readout is `src/sim/realm_racers_circuit_metrics.ts`, not this
  directory.** Every metric it computes is a rule the GAME depends on (the
  spline's projection window, the racing-surface envelope, the pond outlines,
  the collision region, the instance band), and `tests/realm_racers_circuits.test.ts`
  runs it over every shipped circuit. A copy of any of it here would be a rule
  the game does not share.
- **The curve is the real one.** The editor derives its geometry with
  `realmRacersTrack()`, the same memoized derivation the sim and the renderer
  read, so what it draws is what the sim will drive. The memo rebuilds when the
  record behind an id changes, which is what lets a draft redraw on every drag.
- A closed centripetal Catmull-Rom does NOT pass through the operator's stroke,
  so the page draws both: the raw stroke faint, the derived curve over it.
- **The enclosure follows the drawing, not the other way round.** A freehand fit
  re-sizes the perimeter wall and the collision region to the road it just drew
  (`Fit enclosure` does it on demand after handle edits), because a circuit is
  drawn at whatever size it wants to be and the enclosure it inherited belongs to
  the previous one. Both ceilings are real and reported live: `regionHalfX`
  cannot leave the instance band, and `regionHalfZ` cannot exceed half the lane
  spacing less the interest clearance, or two copies of the circuit would see
  each other.

## Two things the readout learned the hard way
- **Every failing stretch is reported, never the worst one.** The corner checks
  walk CONTIGUOUS RUNS of samples (`contiguousRuns` in the metrics core) and emit
  one problem per run, wrapping across the start line. Reporting the argmin turned
  four tight corners into four rounds of "fix one, meet the next", with nothing on
  screen ever saying there were four. A run already carrying an error is not also
  warned about.
- **What carries no design decision is not authored at all.** The recovery
  anchors used to be a hand-placed list of lap fractions on the record, and the
  editor had a whole mode for dragging them. They are invisible, they never
  validate a lap, and the only thing they decide is where a reset puts a racer
  back, so there was nothing to decide: `realmRacersGates` derives them from the
  curve (one per `REALM_RACERS_GATE_SPACING` yards, each slid to the straightest
  road nearby). The editor DRAWS them and never edits them.
- **The dressing is a DOCUMENT on the record, and the tool carries it whole.**
  `props` (each in track-space `{s, offset}` or circuit-local `{x, z}`),
  `scatters` (seeded fills) and `ponds` (placed decorative water) all round-trip
  through `export_core.ts`, and the catalog key is checked against the SIM
  catalog (`src/sim/content/realm_racers_props.ts`), so the tool cannot bless a
  piece the game has no footprint for. The reason it is checked at all is the
  field this one replaced: the single `landmark` point was silently DROPPED by
  the validator, so the editor's preview drew an island the raced draft did not
  have. Positions themselves are never computed here:
  `src/sim/realm_racers_props_resolve.ts` is the one resolver, and the readout
  reports what it placed. Props mode DRAWS what that resolver returns and
  nothing it worked out itself, which is why a footprint on the canvas is the
  footprint the collision set holds.
- **A track-space placement stops where the projection stops being an answer.**
  Placing, and dragging, author track-space only inside
  `REALM_RACERS_PROJECTION_ENVELOPE`, and only while the hinted projection came
  back from its own local window (`props_core.ts` `stayedNear`). Past either,
  the piece is authored circuit-local at the exact point it was dropped. Both
  arms exist for one shape: the Express Tour runs two stretches eleven yards
  apart facing each other, and an unhinted projection in that strip returns the
  FAR stretch, so a bench dragged across the corridor would be re-anchored a
  quarter of a lap away and would follow the wrong road at the next centerline
  edit.
- **A circuit has ONE lateral boundary, and it is the garden edge.** Road plus
  verge plus run-off (`rallyGardenEdgeOffsetAt`): where the two slow bands change
  over, where the border flowers are sown, and the racing surface the dressing
  may not stand on. Everything past it, both sides, is lawn to decorate.
  There were two other offset curves and both are gone. The APRON ran from the
  road edge out to the water and had a paint mode of its own; by the end nothing
  read it but the envelope keeping props off the track, and it pushed that
  envelope out to 25 yards on the infield, so half the garden refused a bench.
  The SHORE line (`halfWidth + apron`) was a CONTAINMENT line first (water, two
  hedges, a kneewall), then the curve the water was cut along, painted span by
  span through a stepwise `waterBands` table. Track limits are a referee now
  (`src/sim/realm_racers_track_limits.ts`) so nothing on either curve stopped
  anyone, and a table of lap fractions still derives the water from the road's
  own shape, which puts a canal down the middle of every circuit.
- **The palette is folded by the THEME, not by a favourites list.** A theme
  carries `props`, the catalog keys that belong on a circuit in that zone, and
  those are what the palette offers before it is unfolded. It filters nothing:
  every key still shows, because a record may place any of them and the readout
  judges the PLACEMENT rather than the vocabulary. It exists because the derived
  dressing ring was deleted (it walked the perimeter repeating a fixed list, so
  it followed the wall rather than the design), and hand-dressing a circuit is
  mostly the hunt for the six pieces that look like this zone inside a catalog
  that holds every zone's.
- **The theme is an ID, and the readout is what judges it.** A circuit names its
  art (`theme`) the same way it names its music: a plain string, offered by the
  panel as a datalist off `REALM_RACERS_THEME_IDS` and resolved render-side by
  `src/render/realm_racers_themes.ts`. The save endpoint checks the SHAPE only;
  whether a registry authors the id is a metrics error (`unknown_theme`) the
  panel shows live, so a theme being written in the same change can still be
  typed in and previewed. Drawing a draft against a theme no circuit ships is
  the intended way to look at one: set the field, and the 3D preview rebuilds
  through the real track builder wearing it.
- **The water is PLACED.** A pond is an entry in the Props palette: drag a box,
  then drag its handles. Deleting the last one leaves a circuit with no water at
  all, which is a shape the tool has to be able to reach, and the basin follows
  the ponds rather than being a second thing to keep in step (the record's rule
  is an IFF, and the save endpoint refuses either half alone).
- **What the readout says about the dressing, it can say NO to.** Three checks
  fired on every piece and could never come back false, so all three are gone: a
  solid prop on drivable garden (since 16b that is everything inside the wall), a
  pond on drivable garden (same), and a solid prop too low or too alone to be
  read (a rule about the PIECE, never about where it stands, so a bench forty
  yards from the road tripped it as surely as one at a corner exit). What is left
  is one error per kind: nothing may stand on the racing surface.
- **A brush paints a STROKE, never a point.** A band table is read piecewise
  linearly, so setting one breakpoint re-slopes the road all the way round the
  lap: one click at 30 percent changed 452 of a 454 yard lap. `paintSpan` takes
  every fraction the pointer visited plus the table as it stood BEFORE the
  stroke, fills the cells a fast pointer skipped, and lays a plateau with a
  smoothstep transition each side, which is how the hand-authored profiles are
  shaped. Cells the stroke never reached keep their original breakpoints.
- **A transition is a length in YARDS, not in lap fractions.** The garden
  circuit ramps its width over 23 to 32 yards, so the page hands `paintSpan` a
  ramp of `PAINT_RAMP_YARDS / lapLength` and a transition reads the same on a
  454 yard circuit and an 1100 yard one. Each ramp is emitted per cell and then
  thinned to the rows the shape needs, EXCEPT its outermost breakpoint: that is
  where the transition meets the profile it interrupted, and dropping it lets
  the road lean toward the stroke from arbitrarily far away.
- **The tool's one number is a VALUE, not a brush size.** It means a
  different quantity in each painting mode with a different legal range, so the
  field is renamed and re-bounded per mode, and every stroke reports what it
  changed. It reported nothing at all before, and a default equal to the blank
  circuit's road made the first stroke a silent no-op that read as a dead tool.
- **A repair that touches a clean circuit is a broken repair.** `suggestWidthBands`
  returns the authored bands untouched unless some corner genuinely asks for less
  road than the record already gives it, and it never moves a control point:
  widening a corner is the operator's design, so corners under the road's own
  floor come back by name instead.

## One CSS trap this page has now hit four times, and the gate that ends it
An author rule that sets `display` outranks the UA's `[hidden] { display: none }`,
so `element.hidden = true` silently does nothing. It cost `#empty`, then the old
`#preview`, then two more in the workbench pass at once: the practice rows
(`.field`) stayed visible with practice unchecked, and a mode's repair chips
(`button.chip`) all showed in every mode. **A selector this page can HIDE and
whose rules set `display` needs its own `[hidden]` guard beside it**, written at
the same time as the rule. Prose did not stop the third and the fourth, so
`tests/editor_circuit_page.test.ts` now reads the stylesheet and fails without the
guard, both ways: a hidden element missing one, and a guard for an element nothing
hides. It also pins the count of `.hidden =` assignments, so a new one cannot
arrive without a look at the sheet. A selector nothing hides needs no guard, which
is why the rule names the ELEMENT rather than every rule in the file.

## The 3D preview is the shipped pipeline, not a second drawing
- It renders the draft through `buildRealmRacersTrack` (`src/render/`), which
  already takes a plain record, so ground splat, kerbs, water, the perimeter and
  the dressing all appear here exactly as the game draws them, and a later
  theme or dressing pass shows up for free.
- The builder authors WORLD coordinates around `REALM_RACERS_ORIGIN`. The
  preview subtracts that on the parent group rather than flying the camera out
  to the instance band, so every camera number in the core is circuit-local;
  the ground material reads OBJECT space, which a parent translation leaves
  alone.
- It never calls the builder's own `update()`: that exists to hide a circuit
  that does not own the viewer's LANE, and a preview has one circuit and no
  lanes.
- **The rig PANS, and the seat looks around.** Two gaps a fixed orbit target and
  a forward-only chase left: half of a big circuit is unreachable from a target
  pinned on the origin, and a paused fly-through could only ever stare down the
  road. So `orbitPan` slides the target across the ground in the camera's own
  basis (shift-drag or middle-drag, scaled by distance so the ground under the
  pointer follows the pointer, clamped by `PREVIEW_PAN_LIMIT` so it cannot be lost
  in empty band), `orbitLookAt` puts it on a named point (double-clicking the 2D
  plan, the fastest way to say which corner), and `flyLookPose` turns the LOOK
  while leaving the eye exactly where the game's boom profile put it: move the
  camera instead and the view answers a question about nowhere. Fit returns the
  target to the centre; a double click in the dock returns the head to the road.
  Which way a downward drag tips the view is the one axis people genuinely
  disagree about, so `invertLook` is an operator preference in the layout store
  and the horizontal is never inverted. `space` plays or pauses the ride, and
  RESUMING resets the look: a lap restarted from a head turned ninety degrees is
  not the lap anyone paused to look at. It is refused while a button holds the
  focus, because there the space bar is that button's activation.
- A rebuild is a full group swap on a debounce, never a rebuild inside a
  pointermove: the builder is one call that lands about half a megabyte of
  geometry. Freeing the old group goes through
  `src/render/realm_racers_track_dispose_core.ts`, which frees what the builder
  MINTS and never what it borrows from a shared cache (every `InstancedMesh` in
  that group draws a cached geometry, so disposing it would take the authored
  circuits down with the draft).

## Starting a circuit
`New blank` and `Load` are two File entries, never one dropdown: a `<select>`
fires only on a CHANGE, so an operator who had drawn over the starter oval could
not ask for a fresh one. A blank canvas is a STATE (`drawn`), not a shape: the page
keeps a valid placeholder record underneath, because a circuit with no curve is
not something the spline, the readout or the export can represent, and shows and
offers none of it until the first stroke. Both buttons commit before moving the
flag, so the undo stack snapshots the state being left and discarding a circuit
is recoverable.

## The workbench shell (layout, not features)
- **The plan IS the bench.** One full-bleed 2D canvas; a menu bar and an icon
  tool rail frame it and everything else floats over it. The 3D preview used to
  take half the drawing area, which made a 1100 yard lap a scrolling exercise:
  it is a movable, resizable DOCK now (`dock.ts`), `shift+F` for the whole plan,
  with a "follows cursor" mode where hovering a corner on the plan is the gesture
  that looks at it in 3D.
- **The rail has four entries, and SHAPE is one intent over two gestures.** A
  blank canvas is drawn on, a drawn one is edited by its handles, and which of
  the two the operator gets was never a choice worth a button (`toolFor`). RACE
  is not a canvas tool: its "options" are the enclosure and race forms.
- **One action table, four surfaces.** `layout_core.ts` carries every action's
  label, detail, icon, chord and menu, and the menu bar, the rail, the status-bar
  chord hints and the `?` cheatsheet all render THAT. Four hand-kept lists of the
  same shortcuts is the drift this exists to make impossible, and
  `tests/editor_circuit_layout.test.ts` pins the table both ways (every
  menu-tagged action is in exactly one menu, every invocable action is in exactly
  one cheatsheet block).
- **Icons are inline SVG in one module** (`editor_icons.ts`), never emojis and
  never an icon font: nothing here ships, so an external asset would be a request
  that only resolves under `npm run dev`. The test is a TABLE check (every
  referenced icon exists, every icon is referenced or declared chrome-only), not
  a pixel one.
- **The readout is a drawer, and the problems are on the plan.** Three headline
  chips stay in the eye line (lap, tightest corner ratio, props); the nine
  sections moved behind `View > metrics detail`. Every located problem draws a
  callout pinned at its own lap position and the status chip names the WORST one,
  because a fault that is a PLACE was something the operator had to scroll a
  panel to find.
- **The layout persists, and a corrupt store degrades to defaults.** Dock
  geometry, the drawer, grid, snap, zoom and the last panel tab live under
  `woc_circuit_editor_layout_v1`, parse-or-default by version. Geometry is
  clamped on every apply rather than only on the drag: the window a dock was
  parked in is not the window it is restored into, and a panel off-screen is a
  panel nobody can close.
- **Snap is off by default and rounds what a gesture AUTHORS, never what it hit
  tests.** What is under the finger is under the finger; the grid only rounds the
  coordinate that lands on the record.
- **A tab a mode cannot use is not offered, and a mode with no tabs shows its own
  numbers.** `sideTabsFor` gives PROPS all three (library, inspector, outliner)
  and every other mode NONE: the library arms a piece for the props tool and the
  inspector edits a selected one, so both are dead in the tools that select
  nothing, and the DRESSING outliner sitting in the width tool was listing props
  at an operator painting a road. Shape and width get `MODE_READOUT` instead, the
  readout sections their own tool is changing, built by the same `readoutSection`
  the drawer uses so the two can never quote a different number. The tool's one
  value field follows the same rule: the scatter spacing shows over the LIBRARY
  and nowhere else.
- **A mode's repairs sit on the plan, beside its banner** (`railActions`). Both
  were reachable only through the Track menu, and that is where they were lost: an
  operator who has just finished a stroke wants Fit enclosure and Fix corners
  immediately, and hunting a menu bar for them breaks the gesture. They stay in
  the menu too, off the same table. The chrome builds one button per action and
  only shows or hides it, because an action button is registered by id for its
  enabled state and rebuilding would leave the registry holding buttons nothing
  can reach.
- **A fixed vocabulary gets a real `<select>`, with a way out.** The theme and the
  music track were datalists, which only ever worked as a SEARCH: there was no way
  to see what the themes even are, which is the first thing anyone wants from a
  fixed set. `selectField` lists the known ids, adds an `other, type it` entry
  (an id being written in the same change is legally typeable, and `unknown_theme`
  in the readout is what judges it), and shows a value the record already carries
  as its own option so the control never lies. The music vocabulary is read off
  `AREA_TRACK_URLS`, the set the game can actually stream for a lane.
- **The race form shows the fields the circuit's ROLES make real.** Two
  checkboxes; unchecking the last is refused BY NAME (the record needs at least
  one role and a control that springs back unexplained reads as broken), and
  turning practice off hides the practice rows and zeroes the copy count. The lap
  count stays on the record while hidden, because the validator holds it to 1..20
  and a zero there is a draft that cannot be saved.
- **The props tool has a POINTER state, and it is the default.** With a piece
  permanently armed, a click that missed the bench the operator meant to grab
  silently authored a second bench: an edit nobody asked for, at a place nobody
  chose. Arming is deliberate (`armPalette`), clicking the armed tile again
  disarms, `esc` disarms, and the status bar holds "placing postLantern" or
  "pointer" for as long as it is true, because a transient message cannot answer
  "am I still placing lanterns". Three things say which state the tool is in, so
  none of them has to be read: the pointer entry is its own row above the pieces
  rather than the first tile (as a tile it read as "the first asset is armed"), the
  canvas cursor is a crosshair or a copy cursor, and the armed piece has a GHOST.
- **The ghost goes through the resolver, like every other placement here.**
  `ghostPlacement` resolves a throwaway record carrying the pending piece and
  draws what came back, so the outline under the cursor is the outline the
  collision set will hold. Drawing its own footprint would be a second derivation
  of a placement, which is the exact bug class the one resolver exists to prevent.
  It costs one resolve per repaint, which is the order `drawDressing` already
  pays, and a hover only repaints while something is armed.
- **A digit shortcut matches the PHYSICAL key.** On AZERTY the digit row is
  shifted: the `1` key reports `&`, and `1` only arrives with shift held, so the
  rail's `1..4` were dead on a French keyboard until `shortcutMatches` grew a
  `code` arm (`Digit1`). Punctuation gets the same treatment for the same reason
  (`?` is shift+`/`). Pinned in `tests/editor_circuit_layout.test.ts`.

## Module split (the page holds no decisions)
| Module | Owns |
|---|---|
| `panel_core.ts` | what the right column shows (`panelLayout`, one call for six interdependent rules), which readout sections a tabless mode carries, the props arm text, and which actions a blank canvas refuses (off the table's own `needsCircuit` flag) |
| `history_core.ts` | the edit history: a capped undo stack with a forward branch that a new edit drops |
| `layout_core.ts` | the shell: the action table (labels, chords, icons, menus, cheatsheet grouping), the rail modes and their tool resolution, chord matching and platform spelling, the persisted layout with its clamps, the zoom/grid/snap arithmetic, the headline chips, and the problem labels the chip, the callouts and the drawer all print |
| `editor_icons.ts` | the icon set: one inline SVG per action and rail mode, plus the chrome-only list that keeps the completeness check honest |
| `shell.ts` | the chrome as ELEMENTS: menu bar, rail, plan overlays, status bar, contextual right panel, metrics drawer, cheatsheet. Structure and listeners only, all of it rendered off the action table |
| `dock.ts` | the floating 3D panel: move, resize, fullscreen, the camera tabs and the lap readout. Geometry rules come from `layout_core.ts` |
| `stroke_fit_core.ts` | freehand stroke to control points: arc-length resample, then Ramer-Douglas-Peucker, closing the loop |
| `handles_core.ts` | hit testing and insert/move/delete for the control ring, plus `paintSpan` for the two INTERPOLATED band tables and the ordering and minimum-count invariants |
| `props_core.ts` | the dressing: which frame a click authors a piece in, what the pointer is over, what a transform does to a record entry, and how a dragged rectangle becomes a scatter or a pond. It AUTHORS and never resolves; where a piece ends up is `src/sim/realm_racers_props_resolve.ts` and the page reads the placements back off it |
| `width_fix_core.ts` | the corner repair: a road profile that clears every corner the road's floor can reach, in one pass. Sound because `turnRadius` depends on the centerline alone, so narrowing cannot move a corner |
| `envelope_core.ts` | what perimeter wall and collision region fit a road of a given size, clamped to the band and the lane depth budget. A convenience, not a rule: the enclosure rules themselves are in the metrics core |
| `export_core.ts` | the record to a pasteable TypeScript literal and back, the rounding the live record shares with it, and the payload validator the save endpoint runs |
| `draft_endpoints_core.ts` | what the dev server answers for the two READ endpoints: the draft list and one parsed draft. It is handed a READER and has no writer, which is what makes "a GET never writes" structural |
| `preview_camera_core.ts` | where the 3D preview's camera stands: the orbit rig's clamps, and the fly-through pose along the racing line |
| `preview3d.ts` | the 3D preview itself: the scene, the light rig, the rebuild lifecycle and the camera modes. Loaded on demand, so the 2D tool still opens instantly |
| `main.ts` | the page: canvas, pointer routing, and the wiring between the shell and the record. No formulas |

New tool logic lands as another `*_core.ts` here (DOM-free, deterministic, its
own `tests/editor_circuit_<name>.test.ts`), never appended to `main.ts`. Note
that `tests/architecture.test.ts` sweeps `*_core.ts` for registration under
`src/ui` and `src/render` only, so an `src/editor/**` core registers nowhere;
that is the same treatment `undo_core.ts` and `stamp_core.ts` already get.
