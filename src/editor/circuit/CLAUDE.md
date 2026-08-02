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
- The save endpoint (`POST /__circuit_editor/save`) is registered in
  `configureServer` only, which runs under the dev server and nowhere else. It
  validates the payload through `validateCircuitPayload` before writing, and it
  writes to `tmp/circuit-drafts/<id>.ts` (gitignored scratch), NEVER to
  `src/sim/content/realm_racers_circuits.ts`: that module is hand-curated and its
  comments carry the reasoning behind every number.

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
- **A brush paints a STROKE, never a point.** A band table is read piecewise
  linearly, so setting one breakpoint re-slopes the road all the way round the
  lap: one click at 30 percent changed 452 of a 454 yard lap. `paintSpan` takes
  every fraction the pointer visited plus the table as it stood BEFORE the
  stroke, fills the cells a fast pointer skipped, and lays a plateau with a
  one-cell shoulder each side, which is how the hand-authored profiles are
  shaped. Cells the stroke never reached keep their original breakpoints.
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

## Module split (the page holds no decisions)
| Module | Owns |
|---|---|
| `stroke_fit_core.ts` | freehand stroke to control points: arc-length resample, then Ramer-Douglas-Peucker, closing the loop |
| `handles_core.ts` | hit testing and insert/move/delete for the control ring, plus `paintSpan` for the two band tables and the ordering and minimum-count invariants |
| `width_fix_core.ts` | the corner repair: a road profile that clears every corner the road's floor can reach, in one pass. Sound because `turnRadius` depends on the centerline alone, so narrowing cannot move a corner |
| `envelope_core.ts` | what perimeter wall and collision region fit a road of a given size, clamped to the band and the lane depth budget. A convenience, not a rule: the containment rules themselves are in the metrics core |
| `export_core.ts` | the record to a pasteable TypeScript literal and back, the rounding the live record shares with it, and the payload validator the save endpoint runs |
| `main.ts` | the page: canvas, pointer routing, the panel. No formulas |

New tool logic lands as another `*_core.ts` here (DOM-free, deterministic, its
own `tests/editor_circuit_<name>.test.ts`), never appended to `main.ts`. Note
that `tests/architecture.test.ts` sweeps `*_core.ts` for registration under
`src/ui` and `src/render` only, so an `src/editor/**` core registers nowhere;
that is the same treatment `undo_core.ts` and `stamp_core.ts` already get.
