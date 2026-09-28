// Rival frame measurement for two human racers: what each pilot's screen shows
// of the other, set against the server at the same wall instant, and what the
// server makes of the contacts and Ground Blast shots the screens suggest. It
// is the baseline for drawing rivals in the local kart's own time frame and
// the measurement that retired the server's forward contact window.
//
// Built on createRacerDuelHarness (tests/helpers/racer_harness.ts): both pilots
// are real ClientWorlds on one GameServer, each over its own LatencyLink, and
// each screen's rival is drawn through the renderer's own remote racing
// projection. This module adds the scripted scenarios and the scoring.
//
// The frame convention every number rests on: the server's pose after a tick
// is the world at the wall instant that tick ran, and between two ticks it is
// interpolated linearly. A drawn pose's FRAME OFFSET is the shift, in ms, that
// best matches it to that server trajectory (negative: the screen shows the
// past). The PERCEIVED SEPARATION error is what contact aim depends on: the
// rival-minus-self vector the screen shows against the server's at the same
// instant.
//
// A suite using this module must mock Postgres itself, hoisted above its own
// import of this module (copy the factory at the top of
// tests/realm_racers_v2_prediction.test.ts).

import { REALM_RACERS_ABILITY_ID } from '../../src/sim/content/realm_racers';
import { vehicleProfile } from '../../src/sim/content/vehicles';
import { groundBlastFlightSeconds } from '../../src/sim/realm_racers_ground_blast';
import { REALM_RACERS_VEHICLE_KEY } from '../../src/sim/social/realm_racers';
import { type SimEvent, TICK_RATE } from '../../src/sim/types';
import { vehicleVelocityX, vehicleVelocityZ } from '../../src/sim/vehicle_motion';
import { clampAimToRange } from '../../src/ui/hud/action_bar/ground_aim';
import type { LatencyLinkConfig } from './latency_link';
import {
  createRacerDuelHarness,
  type DuelPilot,
  type DuelRecording,
  type RacerDuelHarness,
  type ScreenFrame,
  type ServerTickRow,
} from './racer_harness';

/** Contact reach: the two machines' body radii (the loaner races alone). */
export const CONTACT_REACH_YD = 2 * vehicleProfile(REALM_RACERS_VEHICLE_KEY).bodyRadius;
/** Link jitter every scenario runs with, ms (seeded). */
export const LINK_JITTER_MS = 10;
/** Frames slower than this are left out of the display scores, yd/s: the
 *  standing start is not racing, and an offset in ms means nothing at rest. */
export const SCORE_MIN_SPEED = 12;
/** How far either way the frame-offset search looks, ms. */
const OFFSET_SEARCH_MS = 400;
const OFFSET_STEP_MS = 2;

export function racerLink(rttMs: number, seed: number): LatencyLinkConfig {
  return {
    toServer: { baseMs: rttMs / 2, jitterMs: LINK_JITTER_MS, seed },
    toClient: { baseMs: rttMs / 2, jitterMs: LINK_JITTER_MS, seed: seed + 1 },
  };
}

export interface Stats {
  n: number;
  mean: number;
  p95: number;
  max: number;
}

export function stats(values: readonly number[]): Stats {
  if (values.length === 0) return { n: 0, mean: Number.NaN, p95: Number.NaN, max: Number.NaN };
  const sorted = [...values].sort((x, y) => x - y);
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  return { n: sorted.length, mean, p95, max: sorted[sorted.length - 1] };
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface ServerPoseAt {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

/** The server's pose of `pid` at wall instant `tMs`, interpolated between the
 *  two ticks around it; null outside the recorded span. */
export function serverPoseAt(
  ticks: readonly ServerTickRow[],
  pid: number,
  tMs: number,
): ServerPoseAt | null {
  if (ticks.length === 0 || tMs < ticks[0].tMs || tMs > ticks[ticks.length - 1].tMs) return null;
  let lo = 0;
  let hi = ticks.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ticks[mid].tMs <= tMs) lo = mid;
    else hi = mid;
  }
  const a = ticks[lo].poses[pid];
  const b = ticks[hi].poses[pid];
  if (!a || !b) return null;
  const span = ticks[hi].tMs - ticks[lo].tMs;
  const f = span > 0 ? (tMs - ticks[lo].tMs) / span : 0;
  return {
    x: a.x + (b.x - a.x) * f,
    z: a.z + (b.z - a.z) * f,
    vx: a.vx + (b.vx - a.vx) * f,
    vz: a.vz + (b.vz - a.vz) * f,
  };
}

/** The server instant a drawn pose best matches, as an offset from the frame's
 *  own instant in ms; null when the search window leaves the record. */
export function frameOffsetMs(
  ticks: readonly ServerTickRow[],
  pid: number,
  tMs: number,
  x: number,
  z: number,
): number | null {
  let best: number | null = null;
  let bestD2 = Number.POSITIVE_INFINITY;
  for (let tau = -OFFSET_SEARCH_MS; tau <= OFFSET_SEARCH_MS; tau += OFFSET_STEP_MS) {
    const at = serverPoseAt(ticks, pid, tMs + tau);
    if (!at) continue;
    const d2 = (at.x - x) ** 2 + (at.z - z) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = tau;
    }
  }
  // An argmin on the window's edge is a clip, not a measurement.
  if (best === null || Math.abs(best) >= OFFSET_SEARCH_MS) return null;
  return best;
}

/** Split an error vector into the part along a velocity and the part across. */
export function alongAcross(
  ex: number,
  ez: number,
  vx: number,
  vz: number,
): { along: number; across: number } {
  const speed = Math.hypot(vx, vz);
  if (speed < 1e-6) return { along: 0, across: Math.hypot(ex, ez) };
  const ux = vx / speed;
  const uz = vz / speed;
  return { along: ex * ux + ez * uz, across: -ex * uz + ez * ux };
}

/** One viewer's display scores over a window of its screen. */
export interface ViewerScores {
  frames: number;
  /** Median frame offset of the drawn self and the drawn rival, ms. */
  selfOffsetMs: number;
  rivalOffsetMs: number;
  /** Self minus rival: positive when the self is drawn further in the future. */
  frameGapMs: number;
  /** Drawn minus server at the same instant, along the machine's own motion,
   *  yd (signed mean; negative: drawn behind), and its absolute p95. */
  rivalAlongMeanYd: number;
  rivalAlongP95Yd: number;
  rivalAcrossP95Yd: number;
  selfAlongMeanYd: number;
  selfAlongP95Yd: number;
  /** |drawn separation - server separation| at the same instant, yd. */
  separationErr: Stats;
  /** The drawn rival against the server's rival at the instant the drawn SELF
   *  shows (the frame's instant plus the median self offset), yd, p95: how
   *  well the rival sits in the local kart's frame, whatever frame that is. */
  rivalInSelfFrameP95Yd: number;
  /** Mean rival ground speed over the window, yd/s. */
  rivalSpeed: number;
}

export function scoreViewer(
  rec: DuelRecording,
  viewerPid: number,
  rivalPid: number,
  fromMs: number,
  toMs: number,
): ViewerScores {
  const selfOffsets: number[] = [];
  const rivalOffsets: number[] = [];
  const rivalAlong: number[] = [];
  const rivalAcross: number[] = [];
  const selfAlong: number[] = [];
  const sepErr: number[] = [];
  const speeds: number[] = [];
  let frames = 0;
  for (const f of rec.screens[viewerPid] ?? []) {
    if (f.tMs < fromMs || f.tMs > toMs || f.rivalX === null || f.rivalZ === null) continue;
    const self = serverPoseAt(rec.ticks, viewerPid, f.tMs);
    const rival = serverPoseAt(rec.ticks, rivalPid, f.tMs);
    if (!self || !rival) continue;
    const rivalSpeed = Math.hypot(rival.vx, rival.vz);
    if (rivalSpeed < SCORE_MIN_SPEED || Math.hypot(self.vx, self.vz) < SCORE_MIN_SPEED) continue;
    frames++;
    speeds.push(rivalSpeed);
    const r = alongAcross(f.rivalX - rival.x, f.rivalZ - rival.z, rival.vx, rival.vz);
    rivalAlong.push(r.along);
    rivalAcross.push(Math.abs(r.across));
    selfAlong.push(alongAcross(f.selfX - self.x, f.selfZ - self.z, self.vx, self.vz).along);
    sepErr.push(
      Math.hypot(f.rivalX - f.selfX - (rival.x - self.x), f.rivalZ - f.selfZ - (rival.z - self.z)),
    );
    const selfTau = frameOffsetMs(rec.ticks, viewerPid, f.tMs, f.selfX, f.selfZ);
    const rivalTau = frameOffsetMs(rec.ticks, rivalPid, f.tMs, f.rivalX, f.rivalZ);
    if (selfTau !== null) selfOffsets.push(selfTau);
    if (rivalTau !== null) rivalOffsets.push(rivalTau);
  }
  const selfOffsetMs = median(selfOffsets);
  const rivalOffsetMs = median(rivalOffsets);
  const inSelfFrame: number[] = [];
  for (const f of rec.screens[viewerPid] ?? []) {
    if (f.tMs < fromMs || f.tMs > toMs || f.rivalX === null || f.rivalZ === null) continue;
    const self = serverPoseAt(rec.ticks, viewerPid, f.tMs);
    const rival = serverPoseAt(rec.ticks, rivalPid, f.tMs);
    if (!self || !rival) continue;
    if (Math.hypot(rival.vx, rival.vz) < SCORE_MIN_SPEED) continue;
    if (Math.hypot(self.vx, self.vz) < SCORE_MIN_SPEED) continue;
    const there = serverPoseAt(rec.ticks, rivalPid, f.tMs + selfOffsetMs);
    if (there) inSelfFrame.push(Math.hypot(f.rivalX - there.x, f.rivalZ - there.z));
  }
  const abs = (values: number[]) => values.map(Math.abs);
  return {
    frames,
    selfOffsetMs,
    rivalOffsetMs,
    frameGapMs: selfOffsetMs - rivalOffsetMs,
    rivalAlongMeanYd: stats(rivalAlong).mean,
    rivalAlongP95Yd: stats(abs(rivalAlong)).p95,
    rivalAcrossP95Yd: stats(rivalAcross).p95,
    selfAlongMeanYd: stats(selfAlong).mean,
    selfAlongP95Yd: stats(abs(selfAlong)).p95,
    separationErr: stats(sepErr),
    rivalInSelfFrameP95Yd: stats(inSelfFrame).p95,
    rivalSpeed: stats(speeds).mean,
  };
}

function isPairBump(ev: SimEvent, a: number, b: number): boolean {
  if (ev.type !== 'realmRacersBump') return false;
  const bump = ev as SimEvent & { aId: number; bId: number };
  return (bump.aId === a && bump.bId === b) || (bump.aId === b && bump.bId === a);
}

/** What one screen showed around the server's contact. */
export interface ViewerContact {
  /** First frame the drawn hulls overlapped, ms after the server bump
   *  (negative: the screen touched first), or null when they never did. */
  drawnTouchVsServerMs: number | null;
  /** Drawn centre distance on the frame at the server bump's instant, yd. */
  drawnGapAtServerBumpYd: number;
  /** Smallest drawn centre distance from the approach to half a second past
   *  the server bump (the reaction has reached every screen by then), yd. */
  minDrawnGapYd: number;
  /** When the bump event reached this client, ms after the server bump. */
  eventArrivalMs: number | null;
  /** First frame the drawn centres came as close as the server's were at its
   *  bump, ms after that bump (negative: the screen got there first), or null
   *  when they never did: the screen's view of the contact against the
   *  server's, whatever made the server fire it. */
  drawnAtBumpGapVsServerMs: number | null;
}

export interface ContactOutcome {
  /** Whether the server announced a bump between the two pilots. */
  serverBumped: boolean;
  /** Wall instant of that tick, ms (NaN when none). */
  serverBumpTMs: number;
  impact: number;
  /** Server centre distance at the end of the bump tick, yd: a same-tick
   *  contact settles the pair at exactly the reach. */
  serverGapAtBumpYd: number;
  /** First tick whose end-of-tick hulls overlapped, ms after the bump (null:
   *  never). */
  serverOverlapVsBumpMs: number | null;
  /** Smallest end-of-tick server centre distance over the record, yd. */
  serverMinGapYd: number;
  a: ViewerContact;
  b: ViewerContact;
}

/** How long past the server bump the drawn gap is still watched, ms. */
const CONTACT_WATCH_MS = 500;

function viewerContact(
  screens: readonly ScreenFrame[],
  fromMs: number,
  bumpTMs: number,
  serverGapAtBumpYd: number,
  a: number,
  b: number,
): ViewerContact {
  let drawnTouch: number | null = null;
  let drawnAtBumpGap: number | null = null;
  let gapAtBump = Number.NaN;
  let minGap = Number.POSITIVE_INFINITY;
  let arrival: number | null = null;
  for (const f of screens) {
    if (f.tMs < fromMs || f.rivalX === null || f.rivalZ === null) continue;
    const gap = Math.hypot(f.rivalX - f.selfX, f.rivalZ - f.selfZ);
    if (!(f.tMs > bumpTMs + CONTACT_WATCH_MS)) minGap = Math.min(minGap, gap);
    if (drawnTouch === null && gap < CONTACT_REACH_YD) drawnTouch = f.tMs;
    if (drawnAtBumpGap === null && gap <= serverGapAtBumpYd) drawnAtBumpGap = f.tMs;
    if (f.tMs <= bumpTMs) gapAtBump = gap;
    if (arrival === null && f.events.some((ev) => isPairBump(ev, a, b))) arrival = f.tMs;
  }
  return {
    drawnTouchVsServerMs: drawnTouch === null ? null : drawnTouch - bumpTMs,
    drawnGapAtServerBumpYd: gapAtBump,
    minDrawnGapYd: minGap,
    eventArrivalMs: arrival === null ? null : arrival - bumpTMs,
    drawnAtBumpGapVsServerMs: drawnAtBumpGap === null ? null : drawnAtBumpGap - bumpTMs,
  };
}

/** The first bump between `a` and `b` in the record and what each screen
 *  showed around it, from `fromMs` on (the approach, not the grid). */
export function contactOutcome(
  rec: DuelRecording,
  a: number,
  b: number,
  fromMs: number,
): ContactOutcome {
  const bumpRow = rec.ticks.find((row) => row.events.some((ev) => isPairBump(ev, a, b)));
  const gapOf = (row: ServerTickRow) =>
    Math.hypot(row.poses[a].x - row.poses[b].x, row.poses[a].z - row.poses[b].z);
  const bumpTMs = bumpRow ? bumpRow.tMs : Number.NaN;
  const overlapRow = rec.ticks.find(
    (row) => row.poses[a] && row.poses[b] && gapOf(row) < CONTACT_REACH_YD,
  );
  const bumpEvent = bumpRow?.events.find((ev) => isPairBump(ev, a, b)) as
    | (SimEvent & { impact: number })
    | undefined;
  const serverGapAtBumpYd = bumpRow ? gapOf(bumpRow) : Number.NaN;
  return {
    serverBumped: bumpRow !== undefined,
    serverBumpTMs: bumpTMs,
    impact: bumpEvent?.impact ?? 0,
    serverGapAtBumpYd,
    serverOverlapVsBumpMs: overlapRow && bumpRow ? overlapRow.tMs - bumpTMs : null,
    serverMinGapYd: Math.min(...rec.ticks.filter((row) => row.poses[a] && row.poses[b]).map(gapOf)),
    a: viewerContact(rec.screens[a] ?? [], fromMs, bumpTMs, serverGapAtBumpYd, a, b),
    b: viewerContact(rec.screens[b] ?? [], fromMs, bumpTMs, serverGapAtBumpYd, a, b),
  };
}

export interface BlastOutcome {
  fired: boolean;
  /** The server's clamp moved the aim (the HUD's own clamp is applied first). */
  serverClamped: boolean;
  /** Whether the landing caught the rival, and how hard (falloff, 0 to 1). */
  hit: boolean;
  falloff: number;
  /** Rival's server centre against the shell at impact, yd, and that miss
   *  along and across the rival's motion. */
  missYd: number;
  missAlongYd: number;
  missAcrossYd: number;
  /** The same lead rule applied to the server's own poses at the tick the
   *  command was processed: what a zero-latency pilot aiming the same way
   *  would have missed by, yd. The difference is what latency costs. */
  zeroLatencyMissYd: number;
  /** Shell flight the server gave the shot, s. */
  flightSeconds: number;
  /** Server ticks from the one that processed the command to the landing. */
  flightTicks: number;
}

/** Lead a moving rival by the shell's own flight: the aim a pilot takes by eye,
 *  iterated so the flight matches the distance it is aimed at. */
export function visualLeadAim(
  shooter: { x: number; z: number },
  rival: { x: number; z: number; vx: number; vz: number },
): { x: number; z: number; flight: number } {
  let flight = groundBlastFlightSeconds(Math.hypot(rival.x - shooter.x, rival.z - shooter.z));
  let x = rival.x;
  let z = rival.z;
  for (let i = 0; i < 4; i++) {
    x = rival.x + rival.vx * flight;
    z = rival.z + rival.vz * flight;
    flight = groundBlastFlightSeconds(Math.hypot(x - shooter.x, z - shooter.z));
  }
  return { x, z, flight };
}

/** Which pose the HUD's range clamp measured the shot from. */
export type AimCasterSource = 'drawn' | 'mirror';

export interface DrawnRivalShot {
  sent: { x: number; z: number } | null;
  hudClamped: boolean;
  /** 'drawn': renderer.selfAimPose (the predicted display); 'mirror': the
   *  mirrored player the HUD falls back to while the display is not predicted. */
  caster: AimCasterSource | null;
  /** The caster the clamp measured from, and the drawn self on that frame. */
  casterPos: { x: number; z: number } | null;
  drawnSelf: { x: number; z: number } | null;
}

/**
 * Fire the shooter's Ground Blast at its DRAWN rival with a visual lead, on the
 * next frame it draws: the HUD commit path (clampAimToRange from the aim
 * caster, `renderer.selfAimPose ?? sim.player`: the drawn pose while the kart
 * is predicted, the mirrored self while it is stood down, then
 * castAbilityAt). Returns the aim it sent, filled on that frame.
 */
export function fireAtDrawnRival(
  shooter: DuelPilot,
  rivalPid: number,
  rec: DuelRecording,
): DrawnRivalShot {
  const out: DrawnRivalShot = {
    sent: null,
    hudClamped: false,
    caster: null,
    casterPos: null,
    drawnSelf: null,
  };
  const remove = shooter.peer.onFrame((frame) => {
    const screen = rec.screens[shooter.pid];
    const f = screen?.[screen.length - 1];
    const mirror = shooter.client.entities.get(rivalPid);
    if (!f || f.rivalX === null || f.rivalZ === null || f.rivalFacing === null) return;
    if (!mirror?.drive) return;
    remove();
    const lead = visualLeadAim(
      { x: f.selfX, z: f.selfZ },
      {
        x: f.rivalX,
        z: f.rivalZ,
        vx: vehicleVelocityX(mirror.drive, f.rivalFacing),
        vz: vehicleVelocityZ(mirror.drive, f.rivalFacing),
      },
    );
    // The HUD's rallyAimCaster(): the displayed pose first, the mirror as fallback.
    const caster = frame.aimPose ?? shooter.client.player;
    const clamp = clampAimToRange(caster, lead, 0, REALM_RACERS_ABILITY_ID);
    out.sent = clamp.point;
    out.hudClamped = clamp.clamped;
    out.caster = frame.aimPose ? 'drawn' : 'mirror';
    out.casterPos = { x: caster.pos.x, z: caster.pos.z };
    out.drawnSelf = { x: f.selfX, z: f.selfZ };
    shooter.client.castAbilityAt(REALM_RACERS_ABILITY_ID, clamp.point);
  });
  return out;
}

export function blastOutcome(
  rec: DuelRecording,
  shooterPid: number,
  rivalPid: number,
  sent: { x: number; z: number } | null,
): BlastOutcome {
  const firedIndex = rec.ticks.findIndex((row) =>
    row.events.some(
      (ev) =>
        ev.type === 'realmRacersGroundBlastFired' &&
        (ev as SimEvent & { sourceId: number }).sourceId === shooterPid,
    ),
  );
  const hitIndex = rec.ticks.findIndex((row) =>
    row.events.some(
      (ev) =>
        ev.type === 'realmRacersGroundBlastHit' &&
        (ev as SimEvent & { sourceId: number }).sourceId === shooterPid,
    ),
  );
  const none: BlastOutcome = {
    fired: firedIndex >= 0,
    serverClamped: false,
    hit: false,
    falloff: 0,
    missYd: Number.NaN,
    missAlongYd: Number.NaN,
    missAcrossYd: Number.NaN,
    zeroLatencyMissYd: Number.NaN,
    flightSeconds: Number.NaN,
    flightTicks: Number.NaN,
  };
  if (firedIndex < 0 || hitIndex < 0) return none;
  const firedRow = rec.ticks[firedIndex];
  const fired = firedRow.events.find(
    (ev) => ev.type === 'realmRacersGroundBlastFired',
  ) as SimEvent & { targetX: number; targetZ: number; flightSeconds: number };
  const hitRow = rec.ticks[hitIndex];
  const hit = hitRow.events.find((ev) => ev.type === 'realmRacersGroundBlastHit') as SimEvent & {
    targetId: number | null;
    impact: number;
    x: number;
    z: number;
  };
  // The rival where the shell landed: the landing tick's end state (the shove
  // it takes is velocity, which moves it only from the next tick on).
  const rivalAtImpact = hitRow.poses[rivalPid];
  const miss = alongAcross(
    hit.x - rivalAtImpact.x,
    hit.z - rivalAtImpact.z,
    rivalAtImpact.vx,
    rivalAtImpact.vz,
  );
  // Zero latency: the same lead from the server's poses at the processing tick
  // (the tick before the Fired event's end state), landed after the flight the
  // lead itself implies.
  const before = rec.ticks[firedIndex - 1];
  const shooterNow = before.poses[shooterPid];
  const rivalNow = before.poses[rivalPid];
  const refAim = visualLeadAim(shooterNow, rivalNow);
  const refIndex = Math.min(
    rec.ticks.length - 1,
    firedIndex - 1 + Math.round(refAim.flight * TICK_RATE),
  );
  const rivalAtRef = rec.ticks[refIndex].poses[rivalPid];
  const serverClamped =
    sent !== null && Math.hypot(fired.targetX - sent.x, fired.targetZ - sent.z) > 0.05;
  return {
    fired: true,
    serverClamped,
    hit: hit.targetId === rivalPid && hit.impact > 0,
    falloff: hit.targetId === rivalPid ? hit.impact : 0,
    missYd: Math.hypot(miss.along, miss.across),
    missAlongYd: miss.along,
    missAcrossYd: miss.across,
    zeroLatencyMissYd: Math.hypot(refAim.x - rivalAtRef.x, refAim.z - rivalAtRef.z),
    flightSeconds: fired.flightSeconds,
    flightTicks: hitRow.tick - before.tick,
  };
}

export type DuelScenario = 'sideBySide' | 'tailgate' | 'rearRam' | 'sideSwipe' | 'blast';

export interface DuelResult {
  scenario: DuelScenario;
  rttA: number;
  rttB: number;
  circuitId: string;
  /** Display scores on each pilot's screen (A viewing B, B viewing A). */
  a: ViewerScores;
  b: ViewerScores;
  /** Frames on which either self was drawn by the predictor (none while a
   *  v2 driver is stood down). */
  predictedFrames: number;
  contact: ContactOutcome | null;
  blast:
    | (BlastOutcome & Pick<DrawnRivalShot, 'hudClamped' | 'caster' | 'casterPos' | 'drawnSelf'>)
    | null;
  /** The server bump (contact scenarios) or the tick that processed the shot
   *  (blast): when in the race and where on the lap A was. */
  event: RaceEventAt | null;
}

export interface RaceEventAt {
  /** Server race time, ms after the tick that dropped the flag. */
  raceMs: number;
  /** Pilot A's arc length along the lap, yd. */
  arcS: number;
}

/** The wall instant of the tick whose events carry the shooter's Fired. */
function firedRowTMs(rec: DuelRecording, shooterPid: number): number | null {
  const row = rec.ticks.find((r) =>
    r.events.some(
      (ev) =>
        ev.type === 'realmRacersGroundBlastFired' &&
        (ev as SimEvent & { sourceId: number }).sourceId === shooterPid,
    ),
  );
  return row ? row.tMs : null;
}

/** Ms after GO the display scores open: the standing start is excluded. */
const SCORE_FROM_MS = 1500;
/** Ms after GO the side swipe starts. */
const SWIPE_AT_MS = 2000;

/**
 * One scripted duel on the drawn competition circuit, both pilots on the
 * closed-loop brain (reading the server's machine, so the lines are the same
 * whatever the link; their keys still ride their own wires). Every step is
 * timed from the SERVER tick that dropped the flag, so a step lands at the same
 * server race time at every RTT (the pilots' keys still reach the server one
 * uplink later, which is the latency under test):
 *   sideBySide  both at race pace, a lane apart (A on the right, from slot 0).
 *   tailgate    one line; A leaves the grid 0.4 s after B and follows it.
 *   rearRam     the tailgate, then B lifts to 40 pct pace at 3 s: A runs into it.
 *   sideSwipe   side by side, then at 2 s A takes B's lane.
 *   blast       one line, A 1 s behind; at 4 s A fires at its drawn B.
 */
export interface DuelOptions {
  /** Predict both seated pilots on wire v2 (the pipeline's `predictDrivers`,
   *  on by default): each self is drawn ahead of the server, and each rival in
   *  that self's frame. False: both stood down, the `?drivepredict=0` arm. */
  predictDrivers?: boolean;
}

export function runDuel(
  scenario: DuelScenario,
  rttA: number,
  rttB = rttA,
  options: DuelOptions = {},
): DuelResult {
  const d: RacerDuelHarness = createRacerDuelHarness({
    latencyA: racerLink(rttA, 1337),
    latencyB: racerLink(rttB, 7331),
    predictDrivers: options.predictDrivers,
  });
  try {
    d.seat();
    const { a, b } = d;
    const lane = 2.5;
    // Armed before the flag: the brain reads the server's machine, so it
    // starts deciding on the tick the controls unlock.
    if (scenario === 'sideBySide' || scenario === 'sideSwipe') {
      a.autopilot({ lineOffsetYd: -lane, observe: 'server' });
      b.autopilot({ lineOffsetYd: lane, observe: 'server' });
    } else {
      b.autopilot({ observe: 'server' });
      a.keys({});
    }
    const rec = d.record();
    d.advanceToGo();
    const go = d.goWallMs();
    let contact: ContactOutcome | null = null;
    let blast: DuelResult['blast'] = null;
    let blastFiredTMs: number | null = null;
    let scoreToMs = go + 6000;
    if (scenario === 'sideBySide') d.advanceToRaceMs(6000);
    else if (scenario === 'sideSwipe') {
      // Early on the opening stretch, where the two lanes are still level at
      // every link (from the first corner on, the inside lane pulls ahead).
      d.advanceToRaceMs(SWIPE_AT_MS);
      a.autopilot({ lineOffsetYd: lane, observe: 'server' });
      d.advanceToRaceMs(6000);
    } else {
      d.advanceToRaceMs(scenario === 'blast' ? 1000 : 400);
      a.autopilot({ observe: 'server' });
      if (scenario === 'rearRam') {
        d.advanceToRaceMs(3000);
        b.autopilot({ observe: 'server', speedScale: 0.4 });
        d.advanceToRaceMs(6000);
      } else if (scenario === 'blast') {
        d.advanceToRaceMs(4000);
        const shot = fireAtDrawnRival(a, b.pid, rec);
        d.advanceToRaceMs(6000);
        blast = {
          ...blastOutcome(rec, a.pid, b.pid, shot.sent),
          hudClamped: shot.hudClamped,
          caster: shot.caster,
          casterPos: shot.casterPos,
          drawnSelf: shot.drawnSelf,
        };
        blastFiredTMs = firedRowTMs(rec, a.pid);
        scoreToMs = go + 4000;
      } else {
        d.advanceToRaceMs(6000);
      }
    }
    if (scenario === 'rearRam' || scenario === 'sideSwipe') {
      contact = contactOutcome(rec, a.pid, b.pid, go + SCORE_FROM_MS);
      // Score the approach only: after the bump the machines are thrown.
      if (contact.serverBumped) scoreToMs = contact.serverBumpTMs;
    }
    d.stopRecording();
    const predictedFrames = [a.pid, b.pid].reduce(
      (n, pid) => n + (rec.screens[pid] ?? []).filter((f) => f.selfPredicted).length,
      0,
    );
    // Where on the lap, and when in the race, the scored event happened.
    const eventAt = (tMs: number | null): RaceEventAt | null => {
      if (tMs === null || Number.isNaN(tMs)) return null;
      const row = rec.ticks.find((r) => r.tMs === tMs);
      const pose = row?.poses[a.pid];
      if (!pose) return null;
      const at = d.toCanonical(pose.x, pose.z);
      return { raceMs: tMs - go, arcS: d.track().project(at.x, at.z).s };
    };
    return {
      scenario,
      rttA,
      rttB,
      circuitId: d.match().circuitId,
      a: scoreViewer(rec, a.pid, b.pid, go + SCORE_FROM_MS, scoreToMs),
      b: scoreViewer(rec, b.pid, a.pid, go + SCORE_FROM_MS, scoreToMs),
      predictedFrames,
      contact,
      blast,
      event: eventAt(contact ? contact.serverBumpTMs : blastFiredTMs),
    };
  } finally {
    d.dispose();
  }
}
