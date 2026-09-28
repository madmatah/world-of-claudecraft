import type { VehicleDrive } from '../src/sim/types';
import { round2 } from './tick_perf_log';

/**
 * Live vehicle state, for the two seated racers of a running minigame and
 * nobody else. It is ACTIONABLE, not cosmetic: the v1 self-extrapolator and
 * the rival projection run the same movement kernel off it (a v2 self record
 * carries the full-precision `rdv` instead), so without it a race would
 * rubber-band. The renderer reads the same fields for engine pitch and drift
 * smoke. Omitted entirely (like mcr/mck) for everyone on foot.
 */
export function driveWire(drive: VehicleDrive): Record<string, unknown> {
  return {
    k: drive.profileKey,
    sp: round2(drive.speed),
    sl: round2(drive.slip),
    yr: round2(drive.yawRate),
    // Where the wheel is, not where the keys are. It rides because the
    // self-extrapolator RAMPS it from the same flags: re-anchoring onto a
    // record without it would centre the wheel of a pilot who is mid-corner,
    // and the prediction would straighten for the length of the ramp every
    // time a snapshot landed. Sparse like ci/lk: a machine running straight
    // has a centred wheel and pays nothing.
    ...(drive.steerAngle !== 0 ? { st: round2(drive.steerAngle) } : {}),
    sn: round2(drive.spin),
    hb: round2(drive.handbrake),
    g: round2(drive.gripMult),
    dg: round2(drive.dragMult),
    c: round2(drive.speedCap),
    sc: round2(drive.slipCap),
    ...(drive.collisionImpact > 0.01 ? { ci: round2(drive.collisionImpact) } : {}),
    // The activity holding the controls (a racer on the grid). Sent only
    // while true, so an ordinary driving frame costs nothing: the client
    // greys the weapon slot off exactly the fact the server refuses on.
    ...(drive.controlsLocked ? { lk: 1 } : {}),
  };
}
