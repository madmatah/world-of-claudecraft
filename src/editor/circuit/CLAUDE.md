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
- The four endpoints (`POST /__circuit_editor/save`, `GET /__circuit_editor/drafts`,
  `GET /__circuit_editor/draft/<id>`, `DELETE /__circuit_editor/draft/<id>`) are
  registered in `configureServer` only, which runs under the dev server and
  nowhere else. The save arm validates the payload through
  `validateCircuitPayload` before writing, and it writes to
  `tmp/circuit-drafts/<id>.ts` (gitignored scratch), NEVER to
  `src/sim/content/realm_racers_circuits.ts`: that module is hand-curated and its
  comments carry the reasoning behind every number. None of the three read arms
  decides anything in `vite.config.ts`: `draft_endpoints_core.ts` answers them, so
  the id handling is unit-tested (`tests/editor_circuit_draft_endpoints.test.ts`).
  An id arriving off a URL is checked against the same shape the save endpoint
  names its files with BEFORE any read, so no request can resolve out of the draft
  directory.
- **The core has no writer, and the DELETE arm did not change that.** It DECIDES:
  `draftDeleteDecision` hands back the id the request is cleared to unlink, or
  null with the refusal to send, and the unlink lives in the plugin beside the
  save. A core that could delete would be a core a future GET could delete
  through. The two verbs share ONE middleware mount, because the mount owns the
  path: a second `use` for the same prefix would answer whichever was registered
  first and the other would never run. The plugin re-checks that the file it is
  about to remove is in `tmp/circuit-drafts` even though the id already cannot
  carry a separator, since that is the guarantee that has to hold if the check
  upstream is ever loosened.

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
- **The library is folded by the THEME, and that is its default category.** A
  theme carries `props`, the catalog keys that belong on a circuit in that zone,
  and the library opens on exactly those under a chip wearing the THEME's own id
  (`evergarden`, not "theme": the first is an answer, the second is a category
  name). Every other key is one chip away and the whole catalog is one more,
  because a record may place any of them and the readout judges the PLACEMENT
  rather than the vocabulary. It exists because the derived dressing ring was
  deleted (it walked the perimeter repeating a fixed list, so it followed the
  wall rather than the design), and hand-dressing a circuit is mostly the hunt
  for the six pieces that look like this zone inside a catalog that holds every
  zone's. A SEARCH deliberately outranks the chips: typing "lantern" under the
  theme chip means "find me the lantern", not "find me the lantern if this zone
  happens to own one".
- **A tile is a PHOTOGRAPH, taken once through the game's own visual registry.**
  A name is not a picture, and `statueHead` is exactly the key nobody can
  picture. Each asset renders once off screen (`prop_thumbnails.ts`, lazily
  imported like `preview3d.ts`) and caches to `localStorage` under one version
  salt for the whole store. It never blocks: a tile shows its text chip until
  its picture arrives, and a page with no WebGL keeps the chips forever. A
  picture arriving REPLACES the tile's face in place rather than rebuilding the
  grid, and that is load-bearing rather than tidy: the grid is what a tile drag
  captures the pointer on, and rebuilding it mid-gesture is how the
  drag-a-tile-onto-the-plan gesture died the first time.
- **Dragging a tile onto the plan is the primary gesture, and it is pointer
  capture, not HTML5 drag-and-drop.** The drop target is a canvas, so there is
  nothing to hit-test against and the ghost has to be drawn by the plan itself.
  Three browser behaviours have to be answered for it to work at all, and every
  one of them cost a debugging round: a press on the tile's `<img>` starts
  Chrome's own image drag, which fires `pointercancel` and takes the capture with
  it (`preventDefault` plus `draggable = false`); the PRESS has to arm, because a
  drag must know what it is carrying from its first move, which means the click
  that follows cannot also be a toggle or every click would arm and then disarm
  the same piece; and a click with NO press is the keyboard (enter and space send
  a bare one), so that arm is the plain toggle or the tiles are mouse-only. What
  is left for the pointer's click is the two cases the press cannot answer: a
  second click asking for the pointer back, and the tail of a drag, which is
  swallowed. Pinned in `tests/editor_circuit_library_panel.test.ts`, because all
  four paths look identical from the outside.
- **A placing loop stays in the library.** Every placement selects what it just
  placed, and the panel's "a selection means show me its numbers" rule took the
  library away after every single drop. While a piece is ARMED that rule is
  suspended (`panelLayout`'s `isPlacing`); the inspector is one click, or one
  `esc`, away.
- **A row along the road is spaced along ITSELF, not along the lap.** An offset
  curve is shorter than the centerline inside a corner and longer outside one, so
  stepping the lap by the spacing bunched a row of lanterns to five yards through
  a hairpin. `alongRoadProps` walks the offset curve and emits a piece each time
  the real distance reaches the spacing. It authors TRACK space for the same
  reason the rest of the dressing does: a row at a constant `{s, offset}` follows
  a later centerline edit, and a line of world coordinates leaves the verge the
  first time a corner moves. Capped, and the cap SAYS what it dropped.
- **The road edge is a magnet with no band on the inside.** Outside the garden
  edge the snap bites within a few yards, because a placement made out in the
  lawn is a placement nobody made near the road. Inside it there is no ambiguity
  to respect: every point from the centerline to the garden edge is racing
  surface, so a drop there is a drop the readout is about to refuse, and the
  operator meant the roadside. `alt` overrules all of it.
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

**That placeholder borrows a shipped circuit's NUMBERS and none of what its
author placed on it**, and forgetting one of those is a defect that has landed
twice. First the practice circuit's infield fountain arrived on every new
circuit, becoming a metrics error the operator did not author and could not see
the source of; then `pickupRows`, added to the record after that fix and never
added to the clearing, so drawing a fresh circuit laid three rows of boxes nobody
placed. The rule therefore lives in `plan_core.ts` (`blankCircuit`) rather than in
the page, where a test can hold it, and `tests/editor_circuit_plan.test.ts` pins
it two ways: the named fields, and a STRUCTURAL sweep asserting a blank record
carries no list at all beyond its geometry and roles, since every kind of placed
content here is a list. The second is the one that catches the next field without
anybody remembering this paragraph. Loading a SHIPPED circuit keeps its content,
of course: that is the circuit being edited.

## The workbench shell (layout, not features)
- **The plan IS the bench.** One full-bleed 2D canvas; a menu bar and an icon
  tool rail frame it and everything else floats over it. The 3D preview used to
  take half the drawing area, which made a 1100 yard lap a scrolling exercise:
  it is a movable, resizable DOCK now (`dock.ts`), `shift+F` for the whole plan,
  with a "follows cursor" mode where hovering a corner on the plan is the gesture
  that looks at it in 3D.
- **The rail has five entries, and SHAPE is one intent over two gestures.** A
  blank canvas is drawn on, a drawn one is edited by its handles, and which of
  the two the operator gets was never a choice worth a button (`toolFor`). RACE
  is the fourth, and it is read as ONE intent: everything about the race that is
  not the road's shape. TERRAIN is the fifth, read the same way: the land the
  race sits on, which is the authored BARRIERS plus the two actions that size
  and centre the enclosure they stand in. `Fit enclosure` is on SHAPE's banner
  too, deliberately: an operator who has just finished a stroke wants it
  immediately, which is why it left the menu bar in the first place. That is what lets the furniture and the record's own
  numbers share a mode without it being a sack. A dedicated furniture MODE was
  considered and turned down for a reason worth keeping: splitting leaves RACE a
  rail entry with no canvas gesture at all, and the obvious remedy (let it move
  the start line) is not a placement. The start line IS `s = 0`, the origin every
  lap fraction on the record is expressed against (`widthBands`, track-space
  `props`, `pickupRows`, plus the derived gates and recovery anchors), so moving
  it means re-basing all of them. Splitting later costs one row in `RAIL_MODES`
  and one case in `toolFor`, so the decision stays cheap to revisit.
- **RACE has a POINTER state, and it is the default.** It used to be permanently
  armed: a click on the road authored a pickup row, and a click that missed the
  row an operator meant authored a second one beside it. It had a rule against
  exactly that ("selecting comes before placing"), and the rule could not work,
  because ordering the tests only helps INSIDE the click tolerance of a row that
  is already there. Ten yards away there is nothing to hit. So the tool wears the
  props grammar now: a palette in its own tab arms a kind, `esc` or a second click
  on the tile gives the pointer back, an arm survives a placement so three rows
  are three clicks, and with nothing armed a click that hits nothing deselects and
  authors nothing at all. A click on an existing row picks that row up whether or
  not anything is armed, which is the props tool's hit-test-first order.
- **A row MOVES, three ways, and a move may reorder the lap.** Drag it along the
  road, arrow it (the two horizontal keys only: a row has one degree of freedom,
  and the step is a length in YARDS divided by the lap, or a nudge would mean 4.5
  yards on the garden circuit and 8.3 on the Express Tour), or type its position
  in the inspector. The list is sorted by lap position, so the move holds the row
  by its VALUE and the selection follows the returned index: crossing a neighbour
  renumbers both. It can never be parked inside `PICKUP_ROW_MIN_GAP` of another
  row, because the pending fraction is pushed to the near EDGE of that band, which
  is also what makes a drag past a neighbour a swap rather than a wall (approach
  from behind and the near edge is in front of it; pass its own fraction and the
  far edge becomes nearer). One undo step per drag: the snapshot is taken at the
  press.
- **Its boundary for PLACING is the ROAD EDGE, not the garden edge every DRESSING
  placement is judged against**, and the two questions are why: the dressing asks
  "may this piece stand here", whose answer is the whole racing surface, and this
  asks "did the operator point at the road", whose answer is the road. It also has
  to be the road because that is what the readout measures a row against
  (`pickup_row_off_road`) and what the status line says. MOVING uses the
  unconstrained projection instead (`pickupDragFractionAt`), and the difference is
  the gesture: a drag whose row stopped following because the pointer strayed a
  yard onto the verge reads as the tool having dropped it.
- **The row ghost's tint is the READOUT's own verdict**, like the dressing
  ghost's. Three things can refuse a row and only two belong to the gesture (off
  the road, too near a neighbour); the third is `pickup_row_off_road`, raised from
  `realmRacersPickupRowFit` in `src/sim/realm_racers_circuit_metrics.ts`, which
  measures the resolved boxes' four CORNERS rather than their centres. That is the
  one that catches a row looking central where the road changes width under it,
  and a ghost drawn green over it would be the tool blessing a placement the panel
  is about to refuse. The predicate takes the BOXES rather than a row index, so a
  ghost can ask about a row the record does not carry yet.
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
  numbers.** `sideTabsFor` gives PROPS `library`, `inspector`, `outliner` and RACE
  `library`, `inspector`, `properties`; SHAPE and WIDTH get none. The props tabs
  arm or edit a piece of DRESSING, so they are dead in a tool that places none,
  and the dressing outliner sitting in the width tool was listing props at an
  operator painting a road. Shape and width get `MODE_READOUT` instead, the
  readout sections their own tool is changing, built by the same `readoutSection`
  the drawer uses so the two can never quote a different number. The tool's one
  value field follows the same rule: the scatter spacing shows over the LIBRARY
  and nowhere else.
- **A TAB OWNS THE WHOLE COLUMN.** The record form used to be the exception: it
  showed under RACE whichever tab was active, which made it read as belonging to
  none of them. It is the `properties` tab now, so `showForm` keys on the active
  tab and not on the mode, and exactly one panel is ever up. Two panels share the
  `library` id and two share `inspector`, one pair per placing tool, and the page
  shows the active mode's: the props library arms a catalog asset and the race
  palette arms a piece of furniture, which are two vocabularies rather than one
  list with a filter. Library and Inspector sit at the SAME index in both placing
  tools so the eye does not re-find them between the two, and `properties` is
  appended rather than led with. A third `SideTabId` also moves `SIDE_TABS` (what
  a stored layout is validated against) and `SIDE_TAB_LABELS`, off which the shell
  now builds its buttons instead of a hardcoded list.
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
  pays, and a hover only repaints while something is armed. The along-road
  PREVIEW goes through the same door (`ghostRowPlacements`), or it would be that
  bug twelve times over.
- **The ghost's tint is the READOUT's own verdict.** Red comes from
  `realmRacersPropStanding`, the predicate `prop_blocks_racing_surface` is raised
  from, extracted in `src/sim/realm_racers_circuit_metrics.ts` so it has one
  reader. A tint derived from the editor's own arithmetic would be free to say
  green about a placement the panel then refuses, which is the whole thing the
  ghost exists to prevent one step earlier.
- **The keys beside the pieces are decluttered, not just zoom-gated.** A zoom
  threshold was enough while every piece was placed by hand; one gesture that
  lays eleven lanterns eight yards apart makes eleven labels one unreadable
  smear. `labelledPieces` grants them greedily and FIRST-COME, so the set does
  not reshuffle while the pointer moves.
- **A selected piece is shaped ON the plan, and the inspector is the numeric
  truth beside it.** The pond has had handles since the water was placeable and
  the props never did, so turning a bench meant tapping `r` and reading the
  inspector to find out where it got to. `propHandlePoints` generalizes that
  precedent: a rotate ring past the outline on the piece's own facing (which is
  therefore also the only mark on the plan saying which way it points) and a
  corner grip on the footprint. The NEAREST grip wins the hit test rather than the
  first declared: a lantern is under a yard across, so at a working zoom the click
  tolerance reaches both at once and "first in the list" would make one of them
  unreachable. A rotate drag lands on the shared rotation step unless `shift` is
  held, and a corner drag is read as a RATIO of the reach the grip already had,
  which makes it the same gesture at every zoom and at every size the piece is
  already at. Both read the placed piece off the RESOLVER, never the record: a
  track-space piece's own numbers are a lap fraction and an offset, which is not
  somewhere a grip can be drawn.
- **The arrows nudge, `ctrl+D` duplicates, and the copy is what stays selected.**
  Selecting the COPY is what makes a run of pieces one gesture repeated
  (duplicate, nudge, duplicate, nudge); leaving the original selected would put
  every copy in the same place. A duplicate goes through `movedProp`, so it is
  re-framed by the rule every other placement is. The arrows are matched off
  `nudgeKeyOf` rather than through the action table, and the table's
  `nudgeSelection` row carries a GESTURE saying so: four chord rows, doubled for
  the shifted step, is eight cheatsheet lines for one thing an operator reads
  once. The step sizes are the map editor's own, so a nudge means the same in both
  tools.
- **The outliner is the way BACK to a piece, not a readout.** A row selects, a
  double click takes the plan (and the 3D dock, when it is open) to it, and its
  own button discards it. Both listeners are on the PANEL rather than on the rows,
  and that is load-bearing: `paint()` rebuilds every row on every repaint, so the
  row a double click begins on is a different element from the one it ends on, and
  a `dblclick` bound to a row would be lost silently. Deleting an entry DROPS the
  selection rather than adjusting it, because removing one shifts every index
  after it and a selection that survived would be pointing at whatever moved up
  into the hole. Selecting from the outliner also disarms the library, or the
  panel's own "a placing loop stays in the library" rule would answer a row click
  with the tiles again instead of the piece's numbers.
- **The Load dialog lists the drafts on disk.** The dev server could list and
  parse them from the day those endpoints were written and nothing read the list,
  so the only way back into last week's circuit was to remember its id and type it
  at `/dev rallydraft`. Rows come back NEWEST FIRST from the endpoint and are not
  re-sorted on the page, because two orderings of one list is how the row an
  operator clicked stops being the row they meant. A disk draft loads under its
  OWN id, unlike a shipped circuit (which is renamed so editing it cannot hand the
  memoized derivation of a live circuit a shape the game did not author): a draft
  is already a draft, and renaming it would leave Save draft writing a SECOND file
  while `/dev rallydraft <id>` went on racing the one it was opened from. The list
  is re-read on every OPEN, since the directory is scratch space another window, a
  shell, or this page's own Save draft all change under the dialog.
- **The draft autosaves, and resuming is an OFFER.** The working record goes to
  `localStorage` on a debounce after every commit, and boot puts a chip in the
  status bar rather than opening a dialog: a dev tool whose first act every
  session is something to dismiss trains people to dismiss it. A stored draft is
  validated through `validateCircuitPayload`, the same check the save endpoint
  runs, so an older schema degrades to a fresh canvas rather than half-loading.
  `beforeunload` warns only while DIRTY and DRAWN, or every reload asks.
  **A BLANK canvas writes nothing, and that guard is the whole safety net rather
  than tidiness.** `newBlank()` runs at boot and commits, so the timer it
  schedules fires a second later and wrote `{drawn: false}` straight over the
  draft the status bar was at that moment offering: an operator who did not press
  Resume inside that second lost the work for good. The in-memory offer went on
  working, which is exactly what hid it from a manual test.
- **The spacing control has one value and TWO floors.** A row lays what the drag
  covers; a scatter walks a grid of `(2*halfX/spacing) x (2*halfZ/spacing)` cells
  with a spline projection in each, so halving the spacing quadruples the work.
  Sharing the row's floor of one yard gave an 1100 yard circuit a slider position
  that stops the page answering, so `spacingFloor` gives the scatter its own, and
  switching modes carries the value up to it rather than leaving it under.
- **The along-road preview is computed per POINTER MOVE, not per frame.** It is a
  walk of up to a couple of thousand spline samples, a full placement resolve and
  an unhinted projection per previewed piece; per repaint that is a drag that
  stops answering on a big circuit. What the release commits is the list already
  on screen, so what is drawn is what lands.
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
| `layout_core.ts` | the shell: the action table (labels, chords, icons, menus, cheatsheet grouping), the rail modes and their tool resolution, chord matching and platform spelling, the persisted layout with its clamps, the zoom/grid/snap arithmetic, the headline chips, the callout spread and its edge flip, and the problem labels the chip, the callouts and the drawer all print |
| `plan_core.ts` | the plan canvas's own numbers: the starter oval, the placeholder record a blank canvas stands on (template numbers, none of its placed content), what a fit frames, the two limit boxes and their sentences, the click tolerances, the wheel step, and the stylesheet tokens the canvas borrows |
| `editor_icons.ts` | the icon set: one inline SVG per action and rail mode, plus the chrome-only list that keeps the completeness check honest |
| `shell.ts` | the chrome as ELEMENTS: menu bar, rail, plan overlays, status bar, contextual right panel, metrics drawer, cheatsheet. Structure and listeners only, all of it rendered off the action table |
| `panels.ts` | the `PanelHost` every right-column panel reads the document through, plus the element shapes all five of them repeat |
| `panel_form.ts` | the record form: roles, race numbers, presentation ids and the enclosure, built once and only synced |
| `panel_inspector.ts` | the numbers behind the selection, editable, every edit back through `commitDressing` |
| `panel_outliner.ts` | what is standing on this circuit, entry by entry, and the way back to any of it: select, focus, delete, off two listeners on the panel rather than on the rows |
| `panel_readout.ts` | one builder per readout section, plus the drawer and the tabless mode's own column |
| `panel_library.ts` | what the props tool can put down, and which piece is armed |
| `panel_race.ts` | the RACE tool's own two: the furniture palette (the table, its tiles, the pointer state and the arm grammar) and the selected row's numbers, editable. The palette has no tile DRAG on purpose: dressing is a hunt through 182 photographed assets and dragging is how you place the one you found, while a palette of one named kind is armed by clicking it, which gets the keyboard for free |
| `dock.ts` | the floating 3D panel: move, resize, fullscreen, the camera tabs and the lap readout. Geometry rules come from `layout_core.ts` |
| `stroke_fit_core.ts` | freehand stroke to control points: arc-length resample, then Ramer-Douglas-Peucker, closing the loop |
| `handles_core.ts` | hit testing and insert/move/delete for the control ring, plus `paintSpan` for the two INTERPOLATED band tables and the ordering and minimum-count invariants |
| `library_core.ts` | what the library OFFERS: the category chips (theme first and by default), what a search matches, and what an empty grid says |
| `pickup_rows_core.ts` | the RACE tool's canvas gestures: which lap fraction a click on the road means (and the unconstrained twin a DRAG follows), which row a click landed on, and what adding, moving, nudging or removing one does to the list, gap band and reorder included. Where the BOXES end up is not decided here: `src/sim/realm_racers_pickups.ts` resolves a row, and the plan draws what it returns |
| `placement_core.ts` | what the GESTURE meant: which snap a drop takes, whether the readout will have it, and what a drag along the road lays down |
| `thumbnail_core.ts` | where the camera stands to photograph one catalog piece: one pose for every tile, framed on the axis that binds |
| `draft_store_core.ts` | what survives a reload: the autosaved draft (versioned, validated, offered), the drafts on disk as the Load dialog lists them, and the tile cache |
| `prop_thumbnails.ts` | the off-screen rig that takes the pictures. Lazily imported; never disposes what it borrowed from a shared cache |
| `props_core.ts` | the dressing: which frame a click authors a piece in, what the pointer is over, what a transform does to a record entry (a grip drag, an arrow nudge, a duplicate included), where the view goes to look at a selection, and how a dragged rectangle becomes a scatter or a pond. It AUTHORS: where a piece ends up is `src/sim/realm_racers_props_resolve.ts`, and the page reads the placements back off it. It calls that resolver in exactly ONE place, `ghostPlacement`, and for the same reason the ban exists: the outline under the cursor has to be the outline the collision set will hold, so the ghost asks the one resolver instead of deriving a second placement of its own |
| `width_fix_core.ts` | the corner repair: a road profile that clears every corner the road's floor can reach, in one pass. Sound because `turnRadius` depends on the centerline alone, so narrowing cannot move a corner |
| `envelope_core.ts` | what perimeter wall and collision region fit a road of a given size, clamped to the band and the lane depth budget. A convenience, not a rule: the enclosure rules themselves are in the metrics core |
| `fences_core.ts` | the TERRAIN tool's gestures: which barrier (and which of its points) a click landed on, what each click of a drawing run does to the run in progress, what a point drag, a nudge, a delete or a scale edit do to the list, and the offset that centres a circuit in its enclosure plus what has to move with it. It AUTHORS: where the modules end up is `src/sim/realm_racers_fences.ts`, and the plan draws what that resolver returns |
| `export_core.ts` | the record to a pasteable TypeScript literal and back, the rounding the live record shares with it, and the payload validator the save endpoint runs |
| `draft_endpoints_core.ts` | what the dev server answers about a saved draft: the list (newest first, with its last write), one parsed draft, and whether a DELETE may go ahead. It is handed a READER and has no writer at all, which is what makes "a GET never writes" structural; the delete arm names an id and the plugin unlinks it |
| `preview_camera_core.ts` | where the 3D preview's camera stands: the orbit rig's clamps, and the fly-through pose along the racing line |
| `preview3d.ts` | the 3D preview itself: the scene, the light rig, the rebuild lifecycle and the camera modes. Loaded on demand, so the 2D tool still opens instantly |
| `main.ts` | the page: canvas, pointer routing, and the wiring between the shell, the panels and the record. No formulas |

New tool logic lands as another `*_core.ts` here (DOM-free, deterministic, its
own `tests/editor_circuit_<name>.test.ts`), never appended to `main.ts`. Note
that `tests/architecture.test.ts` sweeps `*_core.ts` for registration under
`src/ui` and `src/render` only, so an `src/editor/**` core registers nowhere;
that is the same treatment `undo_core.ts` and `stamp_core.ts` already get.

**New ELEMENT construction is a `panel_*` module, not a block in `main.ts`.** The
workbench pass moved four decision clusters out and the coordinator still came out
BIGGER, which is the one thing the root CLAUDE.md says never to do to a
coordinator: about 770 lines of it were pure element construction with no canvas
coupling at all. The test for which side of the seam a block belongs on is one
question: does it need the page's private gesture state (the live pointer, the
view transform, the undo stack)? If not, it takes a `PanelHost` and lives beside
`shell.ts`. `index.ts` re-exports every core IN FULL and no DOM module at all, and
`tests/editor_circuit_index.test.ts` pins both directions, so a new core export
that never reaches the declared public surface fails rather than going unnoticed.
