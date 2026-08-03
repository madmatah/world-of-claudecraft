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
  spline's projection window, the anti-cut apron, the basin polygon, the
  collision region, the instance band), and `tests/realm_racers_circuits.test.ts`
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
  reports what it placed.
- **Where the water goes is authored; the shore line is not.** The shore is
  `halfWidth + apron`, derived. It used to be a CONTAINMENT line and the mode
  painted what stood on it (water, two hedges, a kneewall); track limits are a
  referee now (`src/sim/realm_racers_track_limits.ts`), so nothing on that curve
  stops anyone and the Water mode paints one decorative decision: pond, or lawn.
  Painting the last pond away leaves a circuit with no water at all, which is a
  shape the tool has to be able to reach.
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
- **The one number in the header is a VALUE, not a brush size.** It means a
  different quantity in each painting mode with a different legal range, so the
  field is renamed and re-bounded per mode, and every stroke reports what it
  changed. It reported nothing at all before, and a default equal to the blank
  circuit's road made the first stroke a silent no-op that read as a dead tool.
- **A repair that touches a clean circuit is a broken repair.** `suggestWidthBands`
  returns the authored bands untouched unless some corner genuinely asks for less
  road than the record already gives it, and it never moves a control point:
  widening a corner is the operator's design, so corners under the road's own
  floor come back by name instead.

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
- A rebuild is a full group swap on a debounce, never a rebuild inside a
  pointermove: the builder is one call that lands about half a megabyte of
  geometry. Freeing the old group goes through
  `src/render/realm_racers_track_dispose_core.ts`, which frees what the builder
  MINTS and never what it borrows from a shared cache (every `InstancedMesh` in
  that group draws a cached geometry, so disposing it would take the authored
  circuits down with the draft).

## Starting a circuit
`New blank` and `Load` are two buttons, never one dropdown: a `<select>` fires
only on a CHANGE, so an operator who had drawn over the starter oval could not
ask for a fresh one. A blank canvas is a STATE (`drawn`), not a shape: the page
keeps a valid placeholder record underneath, because a circuit with no curve is
not something the spline, the readout or the export can represent, and shows and
offers none of it until the first stroke. Both buttons commit before moving the
flag, so the undo stack snapshots the state being left and discarding a circuit
is recoverable.

## Module split (the page holds no decisions)
| Module | Owns |
|---|---|
| `stroke_fit_core.ts` | freehand stroke to control points: arc-length resample, then Ramer-Douglas-Peucker, closing the loop |
| `handles_core.ts` | hit testing and insert/move/delete for the control ring, plus `paintSpan` for the two INTERPOLATED band tables and the ordering and minimum-count invariants |
| `water_paint_core.ts` | the STEPWISE water table: painting a kind over a span of lap, collapsing the result to the fewest breakpoints, and the one rule that rides with it (a circuit authors a basin if and only if some span of its shore carries water, so the basin follows the paint instead of being a second thing to keep in step) |
| `width_fix_core.ts` | the corner repair: a road profile that clears every corner the road's floor can reach, in one pass. Sound because `turnRadius` depends on the centerline alone, so narrowing cannot move a corner |
| `envelope_core.ts` | what perimeter wall and collision region fit a road of a given size, clamped to the band and the lane depth budget. A convenience, not a rule: the enclosure rules themselves are in the metrics core |
| `export_core.ts` | the record to a pasteable TypeScript literal and back, the rounding the live record shares with it, and the payload validator the save endpoint runs |
| `draft_endpoints_core.ts` | what the dev server answers for the two READ endpoints: the draft list and one parsed draft. It is handed a READER and has no writer, which is what makes "a GET never writes" structural |
| `preview_camera_core.ts` | where the 3D preview's camera stands: the orbit rig's clamps, and the fly-through pose along the racing line |
| `preview3d.ts` | the 3D preview itself: the scene, the light rig, the rebuild lifecycle and the camera modes. Loaded on demand, so the 2D tool still opens instantly |
| `main.ts` | the page: canvas, pointer routing, the panel. No formulas |

New tool logic lands as another `*_core.ts` here (DOM-free, deterministic, its
own `tests/editor_circuit_<name>.test.ts`), never appended to `main.ts`. Note
that `tests/architecture.test.ts` sweeps `*_core.ts` for registration under
`src/ui` and `src/render` only, so an `src/editor/**` core registers nowhere;
that is the same treatment `undo_core.ts` and `stamp_core.ts` already get.
