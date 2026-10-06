<!-- src/game/mortar_overdrive/: the Mortar Overdrive client glue. Input, camera and
     audio rules live in src/game/CLAUDE.md; reference them. -->

# src/game/mortar_overdrive/: the Mortar Overdrive client glue

The pieces of the race that belong to the client frame loop rather than to the sim, the
renderer or the HUD: the pilot's facing lane, the start camera, the race's sampled
sounds, the result sting, and the dev path that races a circuit drawn in the editor.

## File map
- `client_wiring.ts`: what `src/main.ts` composes for the race (the facing lane while
  driving, the online camera heading, the start-camera tick, the circuit-draft chat
  hook), kept out of `main.ts` so the coordinator stays a firewall. `main.ts` imports
  it as one namespace.
- `start_camera.ts`: the deterministic establishing shot, posed from the sim's race
  clock (the countdown remainder, then the ticks since the start).
- `sfx.ts`: the race clip tables (`MORTAR_OVERDRIVE_EVENT_SFX`,
  `MORTAR_OVERDRIVE_VEHICLE_SFX`) that `src/game/sfx.ts` plays through the spatial
  engine; the HUD race warm preloads them.
- `audio_routing.ts`: a personal race result to the UI sting it requests
  (`playMortarOverdriveResultAudio`); draws stay silent.
- `draft_dev.ts`: `/dev overdrivedraft <id> [tier]`, offline dev builds only. It reads
  the draft off the dev server, validates it with the editor's own
  `validateCircuitPayload`, registers it, draws it and races it through the sim's
  `/dev overdrive`.

## Seams and conventions
- `draft_dev.ts` holds the ONE sanctioned import from `src/editor` in the presentation
  layers (`ALLOWED_EDITOR_IMPORTS` in `tests/architecture.test.ts`), so it stays OUT of
  the barrel: its importers (`src/game/dev_chat_hooks.ts`, the editor's draft dialog)
  import it deep, and no importer of the barrel inherits the editor edge.
- `index.ts` is the public surface for everything else code outside this directory
  imports. Files here import their siblings directly, never the barrel.
  A runtime import that needs only some leaves stays DEEP (`./mortar_overdrive/sfx`), so it does
  not load the whole directory through the barrel; type imports and importers that
  already load the directory use the barrel.
- Every sound key here is a manifest clip; SFX tuning goes through the SFX tooling
  (root `CLAUDE.md`), never a hand edit of the generated manifest.
- Tests: `tests/mortar_overdrive_start_camera.test.ts`,
  `tests/mortar_overdrive_draft_dev.test.ts`,
  `tests/mortar_overdrive_runtime_audio_wiring.test.ts`.
