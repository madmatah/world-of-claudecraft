// The circuit editor's public surface: the three pure cores it is built from.
// The page (`main.ts`, loaded by `circuit_editor.html`) is deliberately NOT
// re-exported: it is an entry point, not a module anything imports.
//
// The readout every drag is measured against is not here either. It lives in
// `src/sim/realm_racers_circuit_metrics.ts`, because it is the same validation a
// content test runs over every shipped circuit and a copy of it in a dev tool
// would be a rule the game does not share.

export { type EnvelopeSuggestion, suggestEnvelope } from './envelope_core';
export {
  circuitFromTypeScript,
  circuitToTypeScript,
  draftFileContents,
  roundCircuit,
  validateCircuitPayload,
} from './export_core';
export {
  type CircuitBand,
  deleteControlPoint,
  FRACTION_SNAP,
  fromApronBands,
  fromWidthBands,
  hitTestControlPoint,
  insertControlPoint,
  MIN_CONTROL_POINTS,
  moveControlPoint,
  nearestSegment,
  type PaintBandOptions,
  paintSpan,
  type SegmentHit,
  toApronBands,
  toWidthBands,
} from './handles_core';
export {
  advanceFlyThrough,
  circuitLocalSample,
  createPreviewOrbit,
  flySpeedYardsPerSecond,
  flyThroughPose,
  flyThroughPoseAt,
  orbitDrag,
  orbitFrame,
  orbitPose,
  orbitZoom,
  PREVIEW_CHASE_PROFILE,
  PREVIEW_FLY_SPEED_FRACTIONS,
  PREVIEW_ORBIT_LIMITS,
  PREVIEW_REBUILD_DEBOUNCE_MS,
  type PreviewChaseProfile,
  type PreviewFlySpeed,
  type PreviewOrbitState,
  type PreviewPose,
  type PreviewTrackSampler,
} from './preview_camera_core';
export {
  fitStrokeToControlPoints,
  perpendicularDistance,
  resampleClosed,
  type StrokeFitOptions,
} from './stroke_fit_core';
export { suggestWidthBands, type WidthFixResult } from './width_fix_core';
