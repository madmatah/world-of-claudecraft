// Display-only forward projection of REMOTE racing machines, factored out of
// the renderer so it unit-tests without a WebGL context (the net_interp_core /
// step_smooth_core pattern).
//
// A remote body is normally drawn interpolating between its last two wire
// poses, which shows it one downlink plus one snapshot interval in the past
// (~110 ms at a 120 ms RTT) and turns arrival-time jitter straight into
// freeze-and-dash: the interpolation clock chases measured arrival gaps, so a
// packet arriving late stalls the machine at the extrapolation cap and the
// next one makes it lunge. Both hurt racing specifically: rivals stutter, and
// a machine shown 110 ms in the past is 3 to 6 yards up the road on the
// server, so a visually clean lunge lands in empty space (the contact reach
// is 3.4 yd).
//
// A racing machine is the one remote body whose VELOCITY already rides the
// wire (VehicleDrive speed/slip in the body frame, plus yawRate and carried
// spin), so its present pose can be projected instead of interpolated: take
// the NEWEST wire pose, advance it by how old that pose is (time since the
// snapshot arrived plus half the echo), and glide the drawn pose toward that
// target. Between snapshots the target moves at the wire velocity, so arrival
// jitter no longer moves the display at all; on arrival the target steps only
// by the projection error accrued over one interval (small on a straight,
// moderate in a hairpin), and the glide absorbs it.
//
// Display-only, like self_motion.ts: the projected pose feeds the mesh and
// nothing else. Targeting, range checks and every server decision keep using
// authoritative positions (src/net/CLAUDE.md), and the projection is bounded:
// the horizon is capped, and a target far from the drawn pose snaps outright
// (teleports, track resets, respawns must not glide).

export interface RemoteVehiclePose {
  x: number;
  z: number;
  facing: number;
}

/**
 * Projection horizon cap. The age of a freshly arrived pose is about half the
 * echo (~60 ms at 120 RTT) and grows by one snapshot interval until the next
 * arrival, so ordinary racing sits well under this. The cap only bites on a
 * broadcast stall, where projecting further would run the machine through a
 * corner it never took; past it the target holds and the glide settles.
 */
export const REMOTE_VEHICLE_AGE_CAP_MS = 250;
/**
 * Pull rate of the drawn pose toward the projected target (1/s). The target
 * is continuous between arrivals, so this rate only shows on the per-arrival
 * projection-error step; 14/s glides it in over ~70 ms, under one snapshot
 * interval.
 */
export const REMOTE_VEHICLE_SMOOTH_RATE = 14;
/** Beyond this displacement the move is a teleport or a track reset and the
 *  drawn pose adopts the target outright; racing corrections are far smaller. */
export const REMOTE_VEHICLE_SNAP_DIST = 6;
/** Facing gap that snaps rather than glides (a reset re-orients the machine). */
export const REMOTE_VEHICLE_SNAP_FACING_RAD = Math.PI / 2;

export interface RemoteVehicleDisplayState extends RemoteVehiclePose {
  active: boolean;
}

export function createRemoteVehicleDisplay(): RemoteVehicleDisplayState {
  return { active: false, x: 0, z: 0, facing: 0 };
}

export function resetRemoteVehicleDisplay(s: RemoteVehicleDisplayState): void {
  s.active = false;
}

function wrapAngle(d: number): number {
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Advance the drawn pose one rendered frame. Writes into `s` and returns it.
 *
 * The projection rotates the velocity by HALF the yaw advance (the midpoint
 * rule): over a 100 to 150 ms horizon a hairpin's arc and its chord diverge
 * visibly, and the midpoint heading recovers most of the arc for the cost of
 * one sin/cos pair.
 *
 * The glide is absorb-then-decay, not a plain pull toward the target: an
 * exponential smoother chasing a target that MOVES lags it by speed/rate in
 * steady state (2+ yd at racing speed), which would quietly reintroduce the
 * past-pose display this core exists to remove. Instead the drawn pose is
 * carried forward by the wire velocity every frame (zero lag while the
 * projection agrees), and only the continuity gap against the fresh target,
 * which is nonzero exactly at snapshot arrivals and jitter wobbles, is
 * absorbed and decayed.
 */
export function stepRemoteVehicleDisplay(
  s: RemoteVehicleDisplayState,
  // The newest wire state, passed as scalars: this runs in the renderer's
  // per-entity loop, and a wire object per racer per frame is exactly the
  // hot-path allocation the render rules ban.
  wireX: number,
  wireZ: number,
  wireFacing: number,
  /** World velocity of the drive state, yd/s (vehicleVelocityX/Z). */
  wireVx: number,
  wireVz: number,
  /** Total body yaw velocity, rad/s: steering yawRate plus carried spin. */
  yawRate: number,
  ageMs: number,
  dt: number,
): RemoteVehicleDisplayState {
  const ageSec = Math.min(Math.max(ageMs, 0), REMOTE_VEHICLE_AGE_CAP_MS) / 1000;
  const halfTurn = yawRate * ageSec * 0.5;
  const cos = Math.cos(halfTurn);
  const sin = Math.sin(halfTurn);
  // Rotating (vx, vz) by a facing advance t maps vx to vx cos t + vz sin t
  // and vz to vz cos t - vx sin t in this codebase's frame (forward is
  // (sin f, cos f), facing integrates yawRate + spin).
  const vx = wireVx * cos + wireVz * sin;
  const vz = wireVz * cos - wireVx * sin;
  const tx = wireX + vx * ageSec;
  const tz = wireZ + vz * ageSec;
  const tf = wrapAngle(wireFacing + yawRate * ageSec);
  const step = Math.max(0, Math.min(dt, 1 / 30));
  if (!s.active) {
    s.active = true;
    s.x = tx;
    s.z = tz;
    s.facing = tf;
    return s;
  }
  // Where the drawn pose would be if it kept moving with the projection: the
  // continuity gap against the fresh target is the only thing to smooth. Once
  // the horizon is at the cap (a broadcast stall) the target is frozen, so
  // the carry stops too: otherwise the pose would keep sailing speed/rate
  // past the cap before the decay caught it.
  const carrying = ageMs < REMOTE_VEHICLE_AGE_CAP_MS;
  const carriedX = s.x + (carrying ? vx * step : 0);
  const carriedZ = s.z + (carrying ? vz * step : 0);
  const carriedF = wrapAngle(s.facing + (carrying ? yawRate * step : 0));
  const offX = carriedX - tx;
  const offZ = carriedZ - tz;
  const offF = wrapAngle(carriedF - tf);
  if (
    offX * offX + offZ * offZ > REMOTE_VEHICLE_SNAP_DIST * REMOTE_VEHICLE_SNAP_DIST ||
    Math.abs(offF) > REMOTE_VEHICLE_SNAP_FACING_RAD
  ) {
    s.x = tx;
    s.z = tz;
    s.facing = tf;
    return s;
  }
  const decay = Math.exp(-REMOTE_VEHICLE_SMOOTH_RATE * step);
  s.x = tx + offX * decay;
  s.z = tz + offZ * decay;
  s.facing = wrapAngle(tf + offF * decay);
  return s;
}
