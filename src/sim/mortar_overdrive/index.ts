// Mortar Overdrive sim: the race and its pure leaves (see CLAUDE.md here).
// The public surface: what code outside this directory imports. Siblings import each
// other directly, never through this barrel.
export { startMortarOverdriveDevRace } from './bots';
export type {
  MortarOverdriveCircuitMetrics,
  MortarOverdriveCircuitProblem,
  MortarOverdriveCircuitProblemCode,
  MortarOverdrivePropStanding,
} from './circuit_metrics';
export {
  MORTAR_OVERDRIVE_RADIUS_OVER_WIDTH_FLOOR,
  MORTAR_OVERDRIVE_RADIUS_OVER_WIDTH_WARN,
  mortarOverdriveCircuitMetrics,
  mortarOverdrivePickupRowFit,
  mortarOverdrivePropStanding,
} from './circuit_metrics';
export { mortarOverdriveSaveFragment } from './context';
export { mortarOverdriveDraftCircuit } from './draft_registry';
export type { MortarOverdriveDriverTier } from './driver';
export { isMortarOverdriveDriverTier, MORTAR_OVERDRIVE_DRIVER_TIERS } from './driver';
export { mortarOverdriveFencePlacements } from './fences';
export {
  MORTAR_OVERDRIVE_GHOST_AURA,
  MORTAR_OVERDRIVE_GHOST_MARGIN_TICKS,
  MORTAR_OVERDRIVE_GHOST_MIN_TICKS,
  mortarOverdriveGhosted,
} from './ghost';
export {
  MORTAR_OVERDRIVE_MIN_GROUND_POINTS,
  mortarOverdriveGroundReach,
  mortarOverdriveGroundShape,
  mortarOverdriveGroundSpansAt,
  mortarOverdriveOnGround,
} from './ground';
export {
  GROUND_BLAST_AIM_CONE_RAD,
  GROUND_BLAST_CONTROL_SECONDS,
  GROUND_BLAST_CONTROL_SPEED_MULT,
  GROUND_BLAST_CORE_RADIUS,
  GROUND_BLAST_MAX_RANGE,
  GROUND_BLAST_MIN_RANGE,
  GROUND_BLAST_MUZZLE_NOSE_YD,
  GROUND_BLAST_POP_VELOCITY,
  GROUND_BLAST_PUSH,
  GROUND_BLAST_RADIUS,
  GROUND_BLAST_SHOCK_GRIP,
  GROUND_BLAST_SHOCK_TICKS,
  groundBlastFlightSeconds,
  resolveGroundBlastAim,
} from './ground_blast';
export type { MortarOverdrivePoint } from './layout';
export {
  isAtMortarOverdriveXZ,
  MORTAR_OVERDRIVE_BORDER_OFFSET,
  MORTAR_OVERDRIVE_BORDER_SPACING,
  MORTAR_OVERDRIVE_GRID_SIZE,
  MORTAR_OVERDRIVE_LAWN_OVERSHOOT,
  MORTAR_OVERDRIVE_MAX_REGION_HALF_X,
  MORTAR_OVERDRIVE_MAX_REGION_HALF_Z,
  MORTAR_OVERDRIVE_MIN_HALF_WIDTH,
  MORTAR_OVERDRIVE_ORIGIN,
  MORTAR_OVERDRIVE_RUNOFF_WIDTH,
  MORTAR_OVERDRIVE_VERGE_MARGIN,
  mortarOverdriveLaneAt,
  mortarOverdriveLaneOffset,
} from './layout';
export { beginMortarOverdriveCountdown } from './loading';
export type { MortarOverdriveHeldEffect, MortarOverdrivePickupEffect } from './pickup_effects';
export {
  MORTAR_OVERDRIVE_NITRO_KICK,
  MORTAR_OVERDRIVE_NITRO_SPEED_MULT,
  MORTAR_OVERDRIVE_NITRO_TICKS,
  mortarOverdriveHeldEffectFromWire,
} from './pickup_effects';
export {
  MORTAR_OVERDRIVE_PICKUP_BOX_HALF,
  MORTAR_OVERDRIVE_PICKUP_REACH,
  mortarOverdrivePickupBoxes,
  mortarOverdrivePickupLaneGap,
  mortarOverdriveStripPickups,
} from './pickups';
export { forwardArcDelta } from './progress';
export type { MortarOverdrivePlacedPond, MortarOverdrivePlacedProp } from './props_resolve';
export {
  mortarOverdriveFootprintRadius,
  mortarOverdrivePlacedPonds,
  mortarOverdrivePlacedProps,
  mortarOverdrivePlacements,
} from './props_resolve';
export type { MortarOverdriveState } from './race';
export {
  MORTAR_OVERDRIVE_COUNTDOWN_TICKS,
  MORTAR_OVERDRIVE_GARDEN_BAND,
  MORTAR_OVERDRIVE_GROUND_BLAST_AURA,
  MORTAR_OVERDRIVE_OFF_TRACK_AURA,
  MORTAR_OVERDRIVE_VERGE_BAND,
  MORTAR_OVERDRIVE_WARD_AURA,
  MORTAR_OVERDRIVE_WARD_AURA_SECONDS,
  mortarOverdriveCircuitOf,
  mortarOverdriveMatchOf,
  mortarOverdriveMovementLocked,
  mortarOverdriveMovementLockedAt,
  mortarOverdriveOffTrackBand,
  mortarOverdriveOnTrack,
  mortarOverdriveReady,
  mortarOverdriveSeatedOrQueued,
  mortarOverdriveSlickReconFor,
  mortarOverdriveToCanonical,
  mortarOverdriveUnready,
} from './race';
export type { MortarOverdriveMatchClock, MortarOverdriveStillInfo } from './readout_clock';
export {
  mergeMortarOverdriveInfo,
  mortarOverdriveClockOf,
  splitMortarOverdriveInfo,
} from './readout_clock';
export { inMortarOverdriveHeat } from './seat';
export type { MortarOverdriveSlickContact, MortarOverdriveSlickRecon } from './slick_contact';
export {
  applyMortarOverdriveSlickSurface,
  biteMortarOverdriveSlick,
  mortarOverdriveSlickCrossing,
} from './slick_contact';
export type { MortarOverdriveSlick, MortarOverdriveSlickRacer } from './slicks';
export {
  MORTAR_OVERDRIVE_SLICK_CAP,
  MORTAR_OVERDRIVE_SLICK_GRIP,
  MORTAR_OVERDRIVE_SLICK_GRIP_TICKS,
  MORTAR_OVERDRIVE_SLICK_LIFETIME_TICKS,
  MORTAR_OVERDRIVE_SLICK_RADIUS,
  MORTAR_OVERDRIVE_SLICK_SLIP_CAP,
  stepMortarOverdriveSlicks,
} from './slicks';
export type { MortarOverdriveSample, MortarOverdriveTrackModel } from './spline';
export {
  MORTAR_OVERDRIVE_PROJECTION_ENVELOPE,
  MORTAR_OVERDRIVE_PROJECTION_WINDOW,
  memoizePerCircuit,
  mortarOverdriveGardenEdgeOffsetAt,
  mortarOverdriveGates,
  mortarOverdriveStarts,
  mortarOverdriveTrack,
} from './spline';
export {
  MORTAR_OVERDRIVE_CUT_TOLERANCE_YD,
  MORTAR_OVERDRIVE_OFF_ROAD_EXCHANGE_RATE,
} from './track_limits';
export { mortarOverdriveZoneAt } from './zone';
