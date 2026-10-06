<!-- src/render/mortar_overdrive/: the Mortar Overdrive circuit and race feedback, drawn.
     Presentation only. The scheduler, tier-fairness and pure-core rules live in
     src/render/CLAUDE.md (the circuit THEME rule is there too); reference them. -->

# src/render/mortar_overdrive/: the Mortar Overdrive renderer side

Everything the renderer draws for the race: the circuit (road, kerbs, lawn, water,
barriers, props, lamps, the theme sky), the race-only GPU preparation that runs under
the loading lobby or the arrival cover, and the race feedback (shells, oil, pickups,
field cues, the vehicle mix). Reads the world through `IWorld`; never mutates the sim.

## Entry points the renderer holds
- `scene.ts` (`MortarOverdriveScene`, `renderer.mortarOverdrive`): the one owner of the
  tracks, the Ground Blast and oil-spray pools, the theme sky, the preparation seam,
  the instant feedback and the race events. It takes the renderer untyped as its host,
  welded to the renderer's private members in `tests/mortar_overdrive_scene.test.ts`.
- `kart_presentation.ts`: the per-view lean and presentation of a racing machine,
  imported by `renderer.ts` as one namespace (welded in
  `tests/mortar_overdrive_kart_presentation.test.ts`).

## File map by role
- Circuit build: `track.ts` (`buildMortarOverdriveTrack`, every surface swept along the
  SHARED sim spline), `track_palette.ts` (materials one renderer shares across
  circuits), `themes.ts` (what a circuit is DRESSED IN, keyed by the sim `theme`
  string), `barrier_visuals.ts` and `prop_visuals.ts` (what a barrier kit and a prop
  look like), `dressing_material.ts`, `fills.ts` (models a track group still waits for),
  `lamps.ts`, `sky.ts` (the theme HDRI and dome per sky key), `draft_track.ts` (the
  dev draft circuit, drawn in the running game).
- GPU preparation: `prepare.ts` (the race-only producers' preparation seam),
  `circuit_prepare.ts` (what it compiles of the circuits), `common_pieces.ts` (the
  representatives linked at the commitment trigger).
- Race feedback: `ground_blast.ts` (the shell, its arc and landing), `oil_spray.ts`,
  `slicks.ts`, `pickups.ts`, `field_cues.ts`, `audio.ts` (the renderer relay for race
  events and the three-loop vehicle mix).
- Pure cores (Three-free, in `RENDER_PURE_CORES`, driven by plain Vitests):
  `audio_core.ts`, `contact_kick_core.ts` (the display-only bump drawn at the seen touch,
  retired on the ack; opt-out `?contactkick=0`), `daylight_core.ts`, `grass_core.ts`, `missed_pickup_core.ts`,
  `oil_spray_core.ts`, `pickups_core.ts`, `prepare_core.ts` (when a preparation runs and
  whether it proved itself: the commitment trigger the HUD race warm also reads),
  `slicks_core.ts`, `track_core.ts`, `track_dispose_core.ts`, `upload_frame_core.ts`,
  `visibility_core.ts`; `barrier_visuals.ts` and `themes.ts` are the bare-named cores
  (pinned in `tests/architecture.test.ts` `EXPECTED_BARE_NAMED`).

## Seams
- Every GPU producer here is a client of the preparation scheduler (see
  `src/render/CLAUDE.md`, "GPU work"); the race clients are keyed
  `mortar-overdrive-prepare:<reason>:<client>` by `prepare.ts`.
- Geometry comes from `src/sim/mortar_overdrive/` (spline, fences, ground, props
  resolve) and the authored records from `src/sim/content/mortar_overdrive/`.
- Graphics tiers may shed cosmetic richness only. The Ground Blast landing marker is
  actionable, so `ground_blast.ts` has no way to read a tier or the frame governor
  (pinned on its imports in `tests/mortar_overdrive_render.test.ts`).

## Conventions
- `index.ts` is the public surface code outside this directory imports (the renderer, the
  HUD, the game layer, the circuit editor). Files here import their siblings directly,
  never the barrel.
  A runtime import that needs only some leaves stays DEEP (`mortar_overdrive/themes`), so it does
  not load the whole directory through the barrel; type imports and importers that
  already load the directory use the barrel.
  The renderer itself imports the barrel (it already loads the whole scene).
- A new decision (math, a state resolution) is a new `*_core.ts` registered in
  `RENDER_PURE_CORES`, with the Three half as a thin consumer.
- Tests: `tests/mortar_overdrive_render.test.ts`, `tests/mortar_overdrive_scene.test.ts`,
  `tests/mortar_overdrive_boot_compile.test.ts`, `tests/mortar_overdrive_themes.test.ts`
  and the other `tests/mortar_overdrive_*` render suites.
