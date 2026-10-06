<!-- src/sim/content/mortar_overdrive/: Mortar Overdrive data-as-code. Content
     obligations and naming originality live in src/sim/content/CLAUDE.md. -->

# src/sim/content/mortar_overdrive/: Mortar Overdrive data

Declarative records the race reads. Data-as-code: these files are correctly large and
are not to be "modularized"; logic belongs in `src/sim/mortar_overdrive/`.

## File map
- `kit.ts`: the class-agnostic one-button race kit (the weapon and the pickup
  abilities, the held slots), swapped in only for seated racers and resolved the same
  way by `Sim` and `ClientWorld`; also the house pilots' roster.
- `circuits.ts`: the authored circuits, one record per circuit (control points, width
  bands, start grid, perimeter, water, race length, theme, time of day, fences, props,
  pickup rows). What a designer edits; everything derived lives in
  `src/sim/mortar_overdrive/spline.ts`.
- `barriers.ts`: what a barrier kit is to the sim (run thickness and height); the look
  is `src/render/mortar_overdrive/barrier_visuals.ts`.
- `props.ts`: what a scenery prop is to the sim (footprint, solidity, height); the look
  is `src/render/mortar_overdrive/prop_visuals.ts`, keyed by the same catalog keys.

## Seams and conventions
- These records and `src/sim/mortar_overdrive/` import each other (the kit reads sim
  constants, the sim reads circuits), so imports between the two directories stay DEEP
  both ways; a barrel on that edge closes a load-order cycle (a TDZ on the kit's ability
  table at config load).
- `index.ts` is the public surface for code outside `src/sim/` (render, ui, the editor,
  scripts). Files here import their siblings directly, never the barrel.
  A runtime import that needs only some leaves stays DEEP (`content/mortar_overdrive/circuits`), so it does
  not load the whole directory through the barrel; type imports and importers that
  already load the directory use the barrel.
- A new circuit, prop or pickup is a content change with its same-change obligations
  (deeds, guide regen, naming originality): see `src/sim/content/CLAUDE.md` and dispatch
  `content-obligations-reviewer`.
- Tests: `tests/mortar_overdrive_circuits.test.ts`, `tests/mortar_overdrive_props.test.ts`,
  `tests/mortar_overdrive_tooltips.test.ts`.
