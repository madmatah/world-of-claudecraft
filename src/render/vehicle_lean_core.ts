// Display-only vehicle weight: longitudinal acceleration pitches the machine
// and lateral slip rolls it into a drift. Pure math; the renderer composes this
// with terrain tilt on both the machine and its rider.

export interface VehicleLeanState {
  pitch: number;
  roll: number;
  /** Exponentially filtered speed; filtering makes acceleration render-FPS neutral. */
  lastSpeed: number;
  /** Longitudinal acceleration stays available to audio/VFX even when lean is disabled. */
  acceleration: number;
  active: boolean;
}

const MAX_PITCH = 0.11;
const MAX_ROLL = 0.16;
const LEAN_OMEGA = 7;
const SPEED_FILTER_OMEGA = 12;

const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));

/** Surface presentation follows drag, not grip: Arc Shell temporarily lowers
 * grip on asphalt and must not masquerade as dirt dust/footfall audio. */
export function vehicleIsOffRoad(dragMult: number): boolean {
  return dragMult > 1.05;
}

export function createVehicleLean(): VehicleLeanState {
  return { pitch: 0, roll: 0, lastSpeed: 0, acceleration: 0, active: false };
}

export function stepVehicleLean(
  state: VehicleLeanState,
  speed: number,
  slip: number,
  maxSlip: number,
  dt: number,
  enabled: boolean,
): void {
  const step = Math.min(0.25, Math.max(0, dt));
  let acceleration = 0;
  if (state.active && step > 0) {
    const speedEase = 1 - Math.exp(-SPEED_FILTER_OMEGA * step);
    const filteredSpeed = state.lastSpeed + (speed - state.lastSpeed) * speedEase;
    acceleration = (filteredSpeed - state.lastSpeed) / step;
    state.lastSpeed = filteredSpeed;
  } else {
    state.lastSpeed = speed;
  }
  state.acceleration = acceleration;
  state.active = true;
  const targetPitch = enabled ? clamp(-acceleration * 0.0045, -MAX_PITCH, MAX_PITCH) : 0;
  const targetRoll = enabled ? clamp(-slip / Math.max(0.01, maxSlip), -1, 1) * MAX_ROLL : 0;
  const ease = Math.exp(-LEAN_OMEGA * step);
  state.pitch = targetPitch + (state.pitch - targetPitch) * ease;
  state.roll = targetRoll + (state.roll - targetRoll) * ease;
}
