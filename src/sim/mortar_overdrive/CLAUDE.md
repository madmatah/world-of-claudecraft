<!-- src/sim/mortar_overdrive/: the Mortar Overdrive race, sim side. Determinism, the
     SimContext seam and the module-first rules live in src/sim/CLAUDE.md; reference them. -->

# src/sim/mortar_overdrive/: the Mortar Overdrive race (sim)

A deterministic four-pilot vehicle race: a FIFO queue, one instanced match on a circuit
band, arc-length lap progress, house pilots, pickups, oil and the Ground Blast, then an
exact return of every pilot to where they were. Runs unchanged in the offline browser
world, the server and the headless env, like the rest of `src/sim/`. Authored data
(circuits, the race kit, barrier kits, props) lives next door in
`src/sim/content/mortar_overdrive/`.

## The lifecycle (stateful, behind `SimContext`)
- `race.ts`: owns the match. The queue, seating (a pilot is handed a `drive` state and
  the movement kernel switches to the vehicle model), the loading lobby hand-off, the
  countdown, the race tick (surface, track limits, pickups, slicks, shells, ward,
  ghost), classification and the return. Both of the race's own rng sites are here (the
  competition circuit draw at seat time, the pickup take's weighted draw in
  `tickPickups`); a Ground Blast draws only what the ordinary `castAbility` path draws,
  and every other module in this directory draws nothing.
- `context.ts`: the lazy `SimContext` bindings, the tick phase the coordinator calls
  (`updateMortarOverdrivePhase`), the fresh meta fields and the save fragment
  (`mortarOverdriveSaveFragment`). It is the coordinator's ONE Mortar Overdrive module:
  `src/sim/sim.ts` reaches the race through one namespace import of it.
- `loading.ts`: the `loading` phase a race opens in (every pilot held until each human
  sends ready or the cap runs out). `seat.ts`: `inMortarOverdriveHeat`, an import-free
  leaf so the battleground, World PvP and duel modules can ask it without a cycle.
- `busy.ts`: the activities a seat must never pull a player out of. `bots.ts`: the house
  pilots (practice and the dev race), driven by `driver.ts`.
- `auras.ts`: the auras the seat wipe strips (`snapshotMortarOverdriveStrippedAuras`),
  handed back on every return aged by the time away (`restoreMortarOverdriveStrippedAuras`;
  a party paladin aura only while its source still owes it), plus the druid pools parked
  at the seat. Auras are never saved, so a relog mid-race loses them like any logout.
- `drafts.ts` + `draft_registry.ts`: the dev-only side door that makes a circuit drawn
  in the circuit editor raceable for one session (`ctx.devCommands` gated).

## Pure leaves (no SimContext, no rng, no clock beyond the ticks they are handed)
- Circuit geometry: `layout.ts` (shared margins, grid size, gate crossing, the lane
  bands), `spline.ts` (everything derived from an authored record: centerline,
  arc-length table, projection, recovery gates, start grid, the boundary),
  `ground.ts` (the land outline), `fences.ts` (where authored barriers stand),
  `props_resolve.ts` (where hand-placed scenery stands), `circuit_metrics.ts` (is a
  drawn circuit drivable: the editor's live readout and the content test's check).
- Collision: `colliders.ts` (the band's static collision) and `collide.ts` (the arm
  `src/sim/colliders.ts` routes to on the band).
- Race rules: `progress.ts` (laps), `standings.ts` (grid order), `track_limits.ts` (the
  referee), `pickups.ts` and `pickup_effects.ts` (boxes and what they give),
  `slicks.ts` (oil), `slick_contact.ts` (the slick crossing, bite and surface share the
  server tick and the client's own-kart prediction both run), `credit.ts` (the win credit
  rule: a win counts only against a human rival seated at the GO who finished or completed
  a lap), `ghost.ts` (the recovery ghost), `ground_blast.ts` (where a shot
  lands and what it does), `driver.ts` (the bot's driving brain), `readout_clock.ts`
  (the per-tick half of the readout the server ships as `moc`), `zone.ts` (which world
  zone a circuit belongs to).

## Seams
- Render and UI read the race only through `IWorld` (`src/world_api/mortar_overdrive.ts`,
  `IWorldMortarOverdrive`), implemented by `Sim` and mirrored by `ClientWorld`.
- The server encodes the readouts in `server/mortar_overdrive/` and the client decodes
  them in `src/net/mortar_overdrive/`.

## Conventions
- `index.ts` is the public surface for code OUTSIDE `src/sim/` (render, ui, game, net,
  server, the editor, scripts). Files in this directory import their siblings directly,
  never the barrel.
  A runtime import that needs only some leaves stays DEEP (`sim/mortar_overdrive/layout`), so it does
  not load the whole directory through the barrel; type imports and importers that
  already load the directory use the barrel.
- The rest of the sim (and `src/sim/content/mortar_overdrive/`) always imports these modules
  DEEP: `race.ts` imports the sim core back, so a core module loading the barrel would
  evaluate the whole race in the middle of its own load (a TDZ on `data.ts`'s zones).
- The barrel lists exactly what outside code imports, nothing more: a new outside import
  adds its name there, and a name nobody outside imports leaves it.
- A new rng draw, a new tick phase or a new `SimContext` member is a sim-architecture
  change: see `src/sim/CLAUDE.md` and dispatch `architecture-reviewer`.
- Tests: `tests/mortar_overdrive_*.test.ts` (start with `mortar_overdrive_match`,
  `mortar_overdrive_loading_lobby`, `mortar_overdrive_bots`,
  `mortar_overdrive_track_limits`) and the parity golden
  `tests/parity/golden/mortar_overdrive.json`.
