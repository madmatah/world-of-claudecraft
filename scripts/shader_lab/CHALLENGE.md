# Challenge: a cheaper-to-compile surface-detail layer

## Context, for someone who has never opened this repo

World of ClaudeCraft is a low-poly, palette-textured MMO rendered with Three.js.
Its GLB props carry UVs that point at solid palette cells, so nothing per mesh can
give a wall a stone look. The renderer solves that with one shared shader layer,
`src/render/worn_stone.ts`: an `onBeforeCompile` hook on `MeshStandardMaterial`
that projects a CC0 PBR texture set (normal, ambient occlusion, roughness, and on
the upper tiers a displacement height map, plus a metalness map for the metal
family) in world space through a triplanar projection, one texture set per
material family (stone, rock, wood, plaster, bark, fabric, metal). It bends the
shading normal, darkens the diffuse where the AO map is dark, pulls roughness
toward the map, and on the ultra and insane tiers walks a small parallax along
the view ray from the height map. Nineteen render modules attach it; on an Ultra
load about 90 of the 437 compiled programs carry it.

The problem is the compile cost on Windows. Chrome runs WebGL through ANGLE on
Direct3D 11, which translates every GLSL program to HLSL and compiles it with the
D3D compiler at link time, on the main thread, while the player waits. A link
bench on an RTX 3060 measured, per program:

| Program class | Median link |
|---|---|
| authored ShaderMaterial | 10 ms |
| MeshLambertMaterial | 49 ms |
| MeshStandardMaterial, no shadow map, no env map | 166 ms |
| MeshStandardMaterial with both | 334 ms |
| MeshStandardMaterial with the worn layer | 539 ms |

The 90 worn programs alone sum to 46 seconds of link on that box, 37 percent of
the whole corpus. Text-level ablations on the same box priced the worn layer's
ingredients: an unbranched `wornTriR` saves 62 ms, dropping the parallax saves
65 ms, and about 60 ms more sits in the rest of the block. One small change has
already shipped (a single `return` in `wornTriR`, 25 ms per program): the branches
are what the D3D compiler pays for, not the texture fetches.

## What the layer is meant to look like

The author wrote the intent at the top of `src/render/worn_stone.ts`. Read it
first. In short: the game's look is cozy low-poly; the layer suggests material,
never photoreal; it must stay subtle; the beveled low-poly silhouette must
survive; grime settles in mortar lines and plank seams while raised faces lighten
a touch. The stone family is dressed masonry (running-bond courses), rock is
natural fracture with no mortar lines, bark reads as vertical ridges, fabric is
thread-level roughness variation and never corduroy, metal is patina over bare
steel that actually reflects the environment.

The maintainer's own reading of the current execution, which you may treat as a
hint rather than a rule: at close range the parallax walk gives rock a smooth,
slightly metallic sheen that fights the "cozy low-poly" intent.

## The task

Produce a replacement surface-detail layer that reads at least as well as the
current one against that documented intent, and whose fragment program compiles
substantially cheaper under ANGLE D3D11, without moving the cost to the GPU at
draw time.

Pixel identity is NOT required. What is required is that every family reads as
the same material, with the same subtlety, at the same distances. A different
execution that respects the documented intent better is preferred over a
faithful copy.

### Fixed

- The CC0 texture sets already in `public/textures/structures/` and
  `public/textures/terrain/` (KTX2, loaded by `prepareSurfaceDetailProfileAssets`).
- The seam: an `onBeforeCompile` hook on `MeshStandardMaterial`, injected at the
  same chunk anchors (`common`, `color_fragment`, `roughnessmap_fragment`,
  `metalnessmap_fragment`, `normal_fragment_maps`), behind the same exported API
  (`applySurfaceDetail`, `applyWornStone`, `detailedSurfaceMat`,
  `reapplySurfaceDetailToClone`, `surfaceDetailPrewarmTextures`, the family
  routing functions). Callers must not change.
- `customProgramCacheKey` stays sound: two materials whose composed source differs
  must never share a program, and families with the same structure must share one.
- The distance fades. Past the detail fade end, a surface must converge to the
  family's measured mean constants (`aoMean`, `roughMean`, `metalMean`) so distant
  facades keep their brightness, roughness and reflectivity. The fade bands
  (`surfaceDetailFadeBands`) and the dev override `?wornfade=` keep their meaning.
- Object-space mode for held weapons (AO and roughness only, no normal, no
  parallax), and the 4x4 `cellMask` for the merged Eastbrook atlas batches.
- The tier ladder semantics: high has no parallax, ultra and insane may; the live
  shed uniforms `uWornDetailTaps` and `uWornDetailClampK` must still be able to
  reduce the walk at draw time without recompiling.
- A flat, axis-aligned wall must pay one texture fetch per map, as today.
- Existing tests keep passing: `tests/worn_stone_shader.test.ts`,
  `tests/shader_pow_domain.test.ts`, `tests/material_hook_idempotence.test.ts`,
  `tests/material_clone_hooks.test.ts`, `tests/surface_detail_fade.test.ts`
  (update pins whose only purpose was to describe the old text, but say so).

### Free

- The parallax walk: keep it, simplify it, replace it with a height-based shade,
  or drop it, as long as the close-range result still respects the intent.
- The number and shape of branches, the triplanar blend, the normal blend, how
  AO and roughness compose, the uniform layout.
- Anything the compiler pays for that the picture does not need.

## Tools you are given

Everything below lives in `scripts/shader_lab/` on this branch and runs without
the game, the server, or a database. `pnpm install --frozen-lockfile` first.

- **The lab page.** Start a Vite dev server for this checkout
  (`npx vite --port 5199 --strictPort --force`; run it again with `--force` after
  every edit, this checkout's Vite serves stale transforms otherwise) and open
  `http://localhost:5199/scripts/shader_lab/worn_stone_lab.html?gfx=ultra`.
  It imports the real `worn_stone.ts` and the real textures. Left column is the
  bare palette, right column carries the layer; Space toggles it. Query
  parameters: `gfx=high|ultra|insane`, `family=`, `dist=`, `sun=`,
  `focus=wall|rock|barrel`, `layer=off`, `nopanel=1`. The "Download fragment GLSL"
  button saves the fully resolved fragment text the GPU compiled.
- **The reference set.** `refs/`: 35 PNGs (1280x720), one per family x viewpoint,
  panel hidden, captured by `node scripts/shader_lab/capture_refs.mjs --out <dir>`.
  Viewpoints: `near-wall`, `near-rock`, `near-barrel` (5.5 units, sun at 31
  degrees), `mid` (18 units), `far` (40 units). Run the same script against your
  candidate into another folder to get a paired set.
- **The resolved program texts.** `baseline/`: the vertex and fragment source the
  GPU compiled for every family x tier on the current code, pulled from the lab
  page by `node scripts/shader_lab/resolve_worn_glsl.mjs --out <dir>`. Run it on
  your candidate the same way. Note that the six families with an AO map compile
  byte-identical source (the per-family scalars ride uniforms), so there are
  really two structures per tier: the AO families and metal.
- **The quick text dump.** `node scripts/shader_lab/dump_worn_glsl.mjs` writes the
  injected block per family x tier with the Three.js `#include` chunks left
  unresolved, into `tmp/worn_glsl/`, in one second and without a browser. Use it
  to read what the hook injects; use the resolved texts for benching.
- **The link bench.** `node scripts/shader_lab/bench_candidate.mjs --candidate <your resolved dir> --reps 5`
  builds a two-sided corpus (baseline and candidate, one program per distinct
  text per tier), runs `scripts/shader_link_bench.mjs` on it with the GPU driver's
  shader cache disabled, and prints a paired table of median link times. Each
  link is salted so no browser cache hits. On Linux the backend is ANGLE OpenGL:
  it gives the ORDERING of candidates at about a third of the Windows price, and
  its noise is a few ms, so use 5 or more repetitions and re-run before trusting
  a small gap. `--angle d3d11` only works on Windows; the maintainer runs the
  final score on an RTX 3060 box. You do not need Windows to iterate.
- **The world context.** `world_context.json`: the WebGL2 context attributes and
  extension list of the game's renderer, which the bench applies to its scratch
  context because both shape ANGLE's translation.

## How a candidate is judged

1. **Compile cost** (the score). Median link time of the AO-families and metal
   programs on each tier under ANGLE D3D11, against the baseline text in the same
   run. Report the Linux GL numbers you measured yourself and mark them as such;
   the maintainer reruns the same `bench_candidate.mjs` on Windows.
2. **No cost shifted to the GPU.** Fragment fetch count on a flat wall must stay
   at one per map; on a three-plane surface it may not exceed today's count for
   the same tier. If you can, measure the lab page frame time on an integrated
   GPU (Intel Iris Xe or HD 530 class) with `?gfx=ultra&dist=5.5&focus=wall` and
   the browser's frame timeline; a regression there disqualifies.
3. **Distance fidelity** (mechanical). On the `mid` and `far` viewpoints, a
   per-pixel diff against the reference set must sit at the noise floor: mean
   absolute difference under 1.0 on the 0..255 scale, no pixel cluster over 8
   above it. This is where most of the game's pixels live and where the fade
   makes identity the expected result.
4. **Close-range review** (visual, not pixel). For each family, the `near-*`
   captures are reviewed side by side with the reference against this
   grid: does the material read (masonry courses, fracture, grain, ridges, weave,
   patina); does the low-poly silhouette survive; is the effect still subtle; is
   there any swim or crawl when the camera moves (check with the `Spin the props`
   box). "Different but conformant" passes. "Smoother, shinier, more metallic
   than the reference" is a regression. A reviewer agent with the two capture
   sets and this grid does this pass; the maintainer has the last word.
5. **Repo hygiene.** TypeScript strict, no em or en dashes, no emojis, no
   `Math.random`, existing tests green, `npx tsc --noEmit` clean, and a short
   note in the PR explaining what the compiler no longer pays for and why the
   picture does not need it.

## Deliverable

Work on a branch off THIS branch (`challenge/worn-surface-detail`, so the lab
tooling stays with you), containing:
- the new `src/render/worn_stone.ts` (or a sibling module it delegates to),
- updated tests,
- your candidate capture set and resolved texts under `tmp/` (not committed),
  plus a short `tmp/RESULTS.md` with the paired diff summary and the bench
  table, labelled by backend and machine.

Do not push. Leave the branch local and write the PR body to
`tmp/PR_<branch-slug>.md`. The maintainer rebases what wins onto the release
branch without the lab tooling.
