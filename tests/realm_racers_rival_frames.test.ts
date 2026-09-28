import { beforeAll, describe, expect, it, vi } from 'vitest';

// Postgres is mocked before the server/game import the harness pulls in
// (tests/CLAUDE.md, Server tests): the same factory as
// tests/realm_racers_v2_prediction.test.ts.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
  insertBankLedgerRow: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  loadRiftState: vi.fn(async () => null),
  saveRiftState: vi.fn(async () => {}),
  loadGuildBankRow: vi.fn(async () => null),
  loadGuildBankRows: vi.fn(async () => []),
  saveCharacterAndGuildBankState: vi.fn(async () => {}),
  GUILD_BANK_ROW_MAX_BYTES: 262144,
}));

import { GROUND_BLAST_RADIUS, groundBlastFalloff } from '../src/sim/realm_racers_ground_blast';
import { TICK_RATE } from '../src/sim/types';
import {
  CONTACT_REACH_YD,
  type ContactOutcome,
  type DuelResult,
  type DuelScenario,
  runDuel,
  type ViewerScores,
} from './helpers/rival_frames';

// Two HUMAN pilots, each a real ClientWorld over its own latency link, in one
// public heat (tests/helpers/racer_harness.ts createRacerDuelHarness). Each
// screen's rival is drawn through the renderer's own remote racing projection
// (stepRemoteRacerView, the step renderer.sync calls), and set
// against the server at the same wall instant (tests/helpers/rival_frames.ts).
//
// Three kinds of pin. Ceilings: how far a screen may sit from the server, at
// the measured worst case plus a margin, one-sided so a better display stays
// green. Invariants: what holds whatever the display (the server bumps at the
// reach, events arrive within the link). And the block "baseline R1 is
// expected to flip": the defects of the stood-down display (driver prediction
// off, the `?drivepredict=0` arm of src/render/self_prediction.ts), where a
// rival is projected off its arrival age with no downlink term. Drawing rivals
// in the local kart's own time frame flipped those (the "R1 flipped" block),
// and the forward contact window that fired bumps before the hulls met is gone
// (the "lot 7 flipped" block).
//
// Every scenario step is timed from the SERVER tick that dropped the flag.
// Measured stood down (evergarden_express_tour, the drawn circuit; closed
// loop house-pilot brain; links RTT/2 each way plus 0 to 10 ms seeded jitter;
// racing speed on this circuit is about 30 yd/s, not the loaner's 60 top speed):
//
//   Display, every scenario's approach (both screens):
//     RTT   self frame   rival frame   gap (self - rival)   rival along p95   separation err p95
//      60     -78 ms       -35 ms          -43 ms           1.3 to 1.5 yd       1.7 to 2.5 yd
//     120    -105 ms       -66 ms          -39 ms           2.5 to 2.7 yd       1.8 to 2.8 yd
//     200    -148 ms      -106 ms          -42 ms           3.9 to 4.2 yd       1.5 to 3.3 yd
//   The rival sits one downlink in the past (S - d), the self a further ~42 ms
//   behind it, at every RTT. A 60/200 pair shows each screen on its own link:
//   A -78 / -36 ms, B -148 / -106 ms.
//
//   Contacts (server bump vs the screens), with no forward window:
//     rear ram   RTT 60/120/200: the server bumps at the touch (3.40 yd, the
//                reach), while the rammer's screen shows 5.0 / 5.3 / 6.7 yd;
//                its drawn touch, when there is one, comes 767 ms AFTER the
//                bump. The rammed screen touches 33 ms before to 100 ms after.
//     side swipe RTT 60/120/200: bumps at 3.40 yd, screens at 3.9 to 5.0 yd; a
//                drawn touch comes 117 to 1233 ms after the bump.
//   (With the retired two-tick window the bumps fired at 3.6 to 5.2 yd, and
//   the rammer's screen showed 6.1 / 6.5 / 8.7 yd.)
//
//   Ground Blast, A one second behind B, a perfect visual lead on its drawn B:
//     RTT 60: hit, falloff 0.47, miss 3.2 yd (along -1.7)
//     RTT 120: hit, falloff 0.02, miss 5.9 yd (along -5.1)
//     RTT 200: MISS, 8.8 yd (along -8.4); the same lead on the server's own
//              poses misses by 2.6 to 4.3 yd at every RTT.
//
//   Drawing the raw mirrored pose instead of the projection fails the display
//   ceilings at every RTT and the blast ceilings at 120 and 200 ms.
//
// The same runs with driver prediction on (`predictDrivers`, the shipped
// default): each self is drawn ahead of the server and each rival in that
// self's frame (remote_vehicle_display_core.ts remoteRacerHorizon), measured
// at the R1 commit:
//
//   Display, every scenario (both screens):
//     RTT   self frame    rival frame   gap         rival in the self frame p95
//      60    +12/+14 ms    +10/+14 ms    0 to 2 ms   0.1 to 0.4 yd
//     120    +34/+82 ms    +34/+82 ms    0 to 4 ms   0.3 to 1.1 yd
//     200    +92/+94 ms    +88/+94 ms    0 to 4 ms   0.2 to 1.9 yd
//   (A and B differ at 120 ms by the arrival phase of their own links.) The
//   stood-down arm puts the same rival 1.5 to 1.7 yd off the self's frame at
//   every RTT, 42 ms of rival travel. A tailgate at 300 ms holds the gap at 0
//   to 2 ms (rival 2.5 to 2.6 yd off the self frame, p95); the fixed 250 ms
//   arrival-age cap would leave it 84 ms behind at 260 ms and 140 at 300.
//
//   Contacts, re-measured with the forward window removed: the server bumps
//   at the touch (3.40 yd), and every screen has already drawn the hulls
//   touching 17 to 100 ms before it (the self frame's lead); its drawn gap at
//   the bump sits 0.08 to 1.68 yd inside the server's. With the two-tick
//   window the rear ram at 60 ms fired at 4.15 yd while both screens stayed
//   above the reach (3.53 / 3.59 yd): a bounce off air.
//
//   Ground Blast, the same visual lead: hit at every RTT, falloff 0.45 / 0.65 /
//   0.01, miss 3.3 / 2.1 / 5.9 yd with its along part -0.07 / -1.8 / -2.8 yd
//   (stood down: -1.7 / -5.1 / -8.4). What is left at 200 ms is mostly across
//   (-5.2 yd): the lead rule's straight line through a bend, which misses by
//   4.3 yd there with no latency at all.

const RTTS = [60, 120, 200] as const;
type Rtt = (typeof RTTS)[number];
const SCENARIOS: readonly DuelScenario[] = [
  'sideBySide',
  'tailgate',
  'rearRam',
  'sideSwipe',
  'blast',
];

// Quality ceilings: the measured worst case over every scenario and both
// screens at that RTT, plus a small margin. One-sided, so work that draws the
// rival closer to the server keeps them green and a regression reds them.
const RIVAL_ALONG_P95_CEIL: Record<Rtt, number> = { 60: 1.9, 120: 3.0, 200: 4.6 };
const SEPARATION_P95_CEIL: Record<Rtt, number> = { 60: 3.0, 120: 3.1, 200: 3.8 };
/** How far a screen's centre distance at the server bump may sit from the
 *  server's own, yd. */
const BUMP_GAP_ERR_CEIL: Record<Rtt, number> = { 60: 2.5, 120: 2.5, 200: 4.0 };
const BLAST_MISS_CEIL: Record<Rtt, number> = { 60: 4.0, 120: 6.5, 200: 9.2 };

// Self-frame ceilings (driver prediction on): the measured worst case over
// every scenario and both screens plus about a fifth, rounded up.
/** How far the rival may be drawn from the server's rival at the instant the
 *  drawn self shows, p95, yd. */
const SELF_FRAME_RIVAL_P95_CEIL: Record<Rtt, number> = { 60: 0.5, 120: 1.4, 200: 2.3 };
/** The same at a 300 ms round trip (tailgate only, measured 2.52 / 2.58). */
const SELF_FRAME_RIVAL_P95_CEIL_300 = 3.1;
const SELF_FRAME_SEPARATION_P95_CEIL: Record<Rtt, number> = { 60: 0.7, 120: 3.2, 200: 3.4 };
/** |drawn - server| centre distance at the server bump, yd. With no forward
 *  window the screens are the closer ones: drawn about the uplink ahead, they
 *  already overlap when the server touches (measured 0.39 / 1.10 / 1.68). */
const SELF_FRAME_BUMP_GAP_ERR_CEIL: Record<Rtt, number> = { 60: 0.47, 120: 1.4, 200: 2.1 };
/** The part of the blast miss along the rival's motion, |yd|: what latency
 *  costs a visual lead. */
const SELF_FRAME_BLAST_ALONG_CEIL: Record<Rtt, number> = { 60: 0.5, 120: 2.2, 200: 3.4 };
/** The two frames agree to the offset search's resolution (2 ms steps) plus
 *  the arrival-phase wobble, ms. */
const SELF_FRAME_GAP_CEIL_MS = 10;
/** One server tick, ms: a screen reaching the bump's separation later than
 *  this after the server's bump is drawing a past frame again. */
const TICK_MS = 1000 / TICK_RATE;

const results = new Map<string, DuelResult>();
const predicted = new Map<string, DuelResult>();
const key = (scenario: DuelScenario, rttA: number, rttB = rttA) => `${scenario}:${rttA}:${rttB}`;
function found(
  runs: Map<string, DuelResult>,
  scenario: DuelScenario,
  rttA: number,
  rttB = rttA,
): DuelResult {
  const run = runs.get(key(scenario, rttA, rttB));
  if (!run) throw new Error(`no run for ${key(scenario, rttA, rttB)}`);
  return run;
}
const result = (scenario: DuelScenario, rttA: number, rttB = rttA) =>
  found(results, scenario, rttA, rttB);
/** The same run with driver prediction on. */
const predictedResult = (scenario: DuelScenario, rttA: number, rttB = rttA) =>
  found(predicted, scenario, rttA, rttB);
function contactIn(run: DuelResult): ContactOutcome {
  if (!run.contact) throw new Error(`${run.scenario} at ${run.rttA} ms recorded no contact`);
  return run.contact;
}
function blastIn(run: DuelResult): NonNullable<DuelResult['blast']> {
  if (!run.blast) throw new Error(`the blast at ${run.rttA} ms recorded no outcome`);
  return run.blast;
}
const contactOf = (scenario: DuelScenario, rtt: number) => contactIn(result(scenario, rtt));
const blastOf = (rtt: number) => blastIn(result('blast', rtt));
const predictedContactOf = (scenario: DuelScenario, rtt: number) =>
  contactIn(predictedResult(scenario, rtt));
const predictedBlastOf = (rtt: number) => blastIn(predictedResult('blast', rtt));

beforeAll(() => {
  // Stood down is the `?drivepredict=0` arm; the predicted arm is the shipped
  // default (the option left out).
  for (const [runs, predictDrivers] of [
    [results, false],
    [predicted, undefined],
  ] as const) {
    for (const scenario of SCENARIOS) {
      for (const rtt of RTTS) {
        runs.set(key(scenario, rtt), runDuel(scenario, rtt, rtt, { predictDrivers }));
      }
    }
    runs.set(key('sideBySide', 60, 200), runDuel('sideBySide', 60, 200, { predictDrivers }));
  }
  // Past the arrival-age cap: only the scaled cap keeps this rival in frame.
  predicted.set(key('tailgate', 300), runDuel('tailgate', 300));
}, 240_000);

/** The ceilings on how far a screen may sit from the server. */
function expectDisplayCeilings(screen: ViewerScores, rtt: Rtt): void {
  expect(screen.frames).toBeGreaterThan(20);
  expect(screen.rivalOffsetMs).toBeGreaterThanOrEqual(-rtt / 2 - 20);
  expect(screen.selfOffsetMs).toBeGreaterThanOrEqual(-rtt / 2 - 70);
  expect(Math.abs(screen.frameGapMs)).toBeLessThanOrEqual(60);
  expect(screen.rivalAlongP95Yd).toBeLessThanOrEqual(RIVAL_ALONG_P95_CEIL[rtt]);
  // The projection stays on the rival's line; the error is along it.
  expect(screen.rivalAcrossP95Yd).toBeLessThan(0.5);
  expect(screen.separationErr.p95).toBeLessThanOrEqual(SEPARATION_P95_CEIL[rtt]);
  expect(screen.separationErr.max).toBeLessThan(5);
}

/** The ceilings with driver prediction on: every rival in the self's frame. */
function expectSelfFrameCeilings(screen: ViewerScores, rtt: Rtt): void {
  expect(screen.frames).toBeGreaterThan(20);
  expect(Math.abs(screen.frameGapMs)).toBeLessThanOrEqual(SELF_FRAME_GAP_CEIL_MS);
  // The self leads the server by about the uplink, never more than it plus a
  // tick (the frame the input buffer holds).
  expect(screen.selfOffsetMs).toBeLessThanOrEqual(rtt / 2 + TICK_MS);
  expect(screen.rivalInSelfFrameP95Yd).toBeLessThanOrEqual(SELF_FRAME_RIVAL_P95_CEIL[rtt]);
  expect(screen.separationErr.p95).toBeLessThanOrEqual(SELF_FRAME_SEPARATION_P95_CEIL[rtt]);
  expect(screen.separationErr.max).toBeLessThan(5);
}

/** The frames R1 draws: the flip of expectStoodDownFrames. */
function expectSelfFrames(screen: ViewerScores): void {
  // Both drawn ahead of the server, the rival in the self's own frame.
  expect(screen.selfOffsetMs).toBeGreaterThan(0);
  expect(screen.rivalOffsetMs).toBeGreaterThan(0);
  expect(Math.abs(screen.frameGapMs)).toBeLessThanOrEqual(SELF_FRAME_GAP_CEIL_MS);
  expect(screen.rivalAlongMeanYd).toBeGreaterThan(0);
}

/** Today's frames: what drawing rivals in the local kart's frame changes. */
function expectStoodDownFrames(screen: ViewerScores, rtt: number): void {
  // The rival is drawn one downlink in the past: its arrival age carries no
  // downlink term on v2 (stepRemoteRacerView).
  expect(screen.rivalOffsetMs).toBeLessThanOrEqual(-rtt / 2 + 5);
  // The stood-down self is drawn further back still (the fallback lags the
  // mirror by the smoother on top of the alpha lead): self BEHIND rival, by
  // about the same at every RTT.
  expect(screen.selfOffsetMs).toBeLessThanOrEqual(-rtt / 2 - 25);
  expect(screen.frameGapMs).toBeLessThanOrEqual(-25);
  expect(screen.rivalAlongMeanYd).toBeLessThan(0);
}

describe('two human racers under latency: the harness', () => {
  it('seats both humans over their own links in one public heat, both stood down', () => {
    for (const scenario of SCENARIOS) {
      for (const rtt of RTTS) {
        const run = result(scenario, rtt);
        expect(run.circuitId).toBe('evergarden_express_tour');
        // Stood down: no racing frame of either self is drawn by the predictor.
        expect(run.predictedFrames).toBe(0);
        expect(run.a.frames).toBeGreaterThan(20);
        expect(run.b.frames).toBeGreaterThan(20);
      }
    }
  });

  it.each([
    ['tailgate', 120],
    ['sideBySide', 60],
    ['sideBySide', 200],
    ['blast', 200],
  ] as const)('replays %s at %i ms identically for the same seeds and links', (s, rtt) => {
    expect(runDuel(s, rtt, rtt, { predictDrivers: false })).toEqual(result(s, rtt));
  });

  it('times every scripted event from the server GO, not from each screen', () => {
    // The same step lands at the same server race time, give or take the
    // uplink the pilots' keys ride, and at about the same place on the lap.
    for (const scenario of ['rearRam', 'sideSwipe', 'blast'] as const) {
      const at = RTTS.map((rtt) => result(scenario, rtt).event);
      for (const event of at) expect(event).not.toBeNull();
    }
    const fired = RTTS.map((rtt) => result('blast', rtt).event?.raceMs ?? Number.NaN);
    for (const [i, rtt] of RTTS.entries()) {
      expect(fired[i]).toBeGreaterThanOrEqual(4000);
      expect(fired[i]).toBeLessThanOrEqual(4000 + rtt / 2 + 2 * 50);
    }
  });
});

describe.each(RTTS)('rival frames at RTT %i ms: ceilings and invariants', (rtt) => {
  it.each(SCENARIOS)('%s: each screen stays within the display ceilings', (s) => {
    const run = result(s, rtt);
    expectDisplayCeilings(run.a, rtt);
    expectDisplayCeilings(run.b, rtt);
  });

  it.each(['rearRam', 'sideSwipe'] as const)(
    '%s: the server bumps at the reach and the event arrives within the link',
    (s) => {
      const contact = contactOf(s, rtt);
      expect(contact.serverBumped).toBe(true);
      // No forward window: the server bumps on the real touch, and the
      // same-tick contact settles the pair at exactly the reach.
      expect(Math.abs(contact.serverGapAtBumpYd - CONTACT_REACH_YD)).toBeLessThan(1e-6);
      for (const screen of [contact.a, contact.b]) {
        expect(screen.eventArrivalMs).toBeGreaterThanOrEqual(rtt / 2);
        expect(screen.eventArrivalMs).toBeLessThanOrEqual(rtt / 2 + 60);
        expect(
          Math.abs(screen.drawnGapAtServerBumpYd - contact.serverGapAtBumpYd),
        ).toBeLessThanOrEqual(BUMP_GAP_ERR_CEIL[rtt]);
      }
    },
  );

  it('side swipe: at least one screen draws the hulls touching', () => {
    const contact = contactOf('sideSwipe', rtt);
    expect([contact.a, contact.b].some((screen) => screen.drawnTouchVsServerMs !== null)).toBe(
      true,
    );
  });

  it('Ground Blast: the shot is the server geometry, within the miss ceiling', () => {
    const blast = blastOf(rtt);
    expect(blast.fired).toBe(true);
    // Stood down, the HUD clamps from the mirrored self (selfAimPose is null).
    expect(blast.caster).toBe('mirror');
    expect(blast.hudClamped).toBe(false);
    expect(blast.serverClamped).toBe(false);
    expect(blast.flightTicks).toBe(Math.round(blast.flightSeconds * TICK_RATE));
    // The scorer's miss is the server's own geometry: the falloff at that miss.
    expect(blast.falloff).toBeCloseTo(groundBlastFalloff(blast.missYd, 0, 0, 0), 9);
    expect(blast.missYd).toBeLessThanOrEqual(BLAST_MISS_CEIL[rtt]);
    // The lead rule itself lands inside the blast without latency.
    expect(blast.zeroLatencyMissYd).toBeLessThan(GROUND_BLAST_RADIUS);
  });
});

describe('rival frames across RTTs', () => {
  it('each screen follows its own link in an asymmetric pair', () => {
    const run = result('sideBySide', 60, 200);
    expectDisplayCeilings(run.a, 60);
    expectDisplayCeilings(run.b, 200);
  });
});

// Each pin below holds a DEFECT of today's display: rivals one downlink in the
// past and the stood-down self behind them, so contacts fire before any screen
// shows a touch and a visual lead lands behind the rival. Drawing rivals in the
// local kart's own time frame is expected to flip them; flip each knowingly.
describe('baseline R1 is expected to flip', () => {
  it.each(RTTS)('the drawn frames at %i ms: rival in the past, self behind it', (rtt) => {
    for (const s of SCENARIOS) {
      expectStoodDownFrames(result(s, rtt).a, rtt);
      expectStoodDownFrames(result(s, rtt).b, rtt);
    }
  });

  it('the asymmetric pair: each screen one downlink in the past', () => {
    const run = result('sideBySide', 60, 200);
    expectStoodDownFrames(run.a, 60);
    expectStoodDownFrames(run.b, 200);
  });

  it('the rival falls further behind its server pose as the RTT grows', () => {
    const along = RTTS.map((rtt) => result('tailgate', rtt).a.rivalAlongP95Yd);
    expect(along[0]).toBeLessThan(along[1]);
    expect(along[1]).toBeLessThan(along[2]);
  });

  it.each(RTTS)('contacts at %i ms: the chasing screen never shows the touch first', (rtt) => {
    // The rammer and the swiper (A) see their own kart about 42 ms further in
    // the past than the rival they close on. (The rammed pilot's screen can
    // touch first now: with no forward window the server bumps on the real
    // touch, one tick after a screen drawn ahead of it.)
    for (const s of ['rearRam', 'sideSwipe'] as const) {
      const screen = contactOf(s, rtt).a;
      expect(screen.drawnGapAtServerBumpYd).toBeGreaterThan(CONTACT_REACH_YD);
      if (screen.drawnTouchVsServerMs !== null) {
        expect(screen.drawnTouchVsServerMs).toBeGreaterThan(0);
      }
    }
    // The rammer, following, sees the gap wider than the one it is rammed from.
    const ram = contactOf('rearRam', rtt);
    expect(ram.a.drawnGapAtServerBumpYd).toBeGreaterThan(ram.serverGapAtBumpYd + 1);
  });

  it('Ground Blast: the visual lead lands behind the rival, hits at 60 ms, misses at 200', () => {
    for (const rtt of RTTS) expect(blastOf(rtt).missAlongYd).toBeLessThan(0);
    const miss = RTTS.map((rtt) => blastOf(rtt).missYd);
    expect(miss[0]).toBeLessThan(miss[1]);
    expect(miss[1]).toBeLessThan(miss[2]);
    expect(blastOf(60).hit).toBe(true);
    expect(blastOf(200).hit).toBe(false);
  });
});

describe('two human racers under latency, driver prediction on', () => {
  it('predicts both racers through the approach on every screen', () => {
    for (const scenario of SCENARIOS) {
      for (const rtt of RTTS) {
        const run = predictedResult(scenario, rtt);
        expect(run.circuitId).toBe('evergarden_express_tour');
        // Both screens' racing frames, bar the suspends at GO and race end.
        expect(run.predictedFrames).toBeGreaterThan(run.a.frames + run.b.frames);
      }
    }
  });

  it.each([
    ['rearRam', 120],
    ['blast', 200],
  ] as const)('replays %s at %i ms identically for the same seeds and links', (s, rtt) => {
    expect(runDuel(s, rtt)).toEqual(predictedResult(s, rtt));
  });
});

describe.each(RTTS)('rival frames at RTT %i ms, driver prediction on', (rtt) => {
  it.each(SCENARIOS)('%s: each screen stays within the self-frame ceilings', (s) => {
    const run = predictedResult(s, rtt);
    expectSelfFrameCeilings(run.a, rtt);
    expectSelfFrameCeilings(run.b, rtt);
  });

  it.each(['rearRam', 'sideSwipe'] as const)(
    '%s: each screen shows the bump where and when the server makes it',
    (s) => {
      const contact = predictedContactOf(s, rtt);
      expect(contact.serverBumped).toBe(true);
      for (const screen of [contact.a, contact.b]) {
        expect(screen.eventArrivalMs).toBeGreaterThanOrEqual(rtt / 2);
        expect(screen.eventArrivalMs).toBeLessThanOrEqual(rtt / 2 + 60);
        expect(
          Math.abs(screen.drawnGapAtServerBumpYd - contact.serverGapAtBumpYd),
        ).toBeLessThanOrEqual(SELF_FRAME_BUMP_GAP_ERR_CEIL[rtt]);
        // The screen reaches the separation the server bumped at within the
        // self frame's lead before the bump, and never a tick after it.
        const at = screen.drawnAtBumpGapVsServerMs;
        expect(at).not.toBeNull();
        expect(at as number).toBeGreaterThanOrEqual(-(rtt / 2 + TICK_MS));
        expect(at as number).toBeLessThanOrEqual(TICK_MS);
      }
    },
  );

  it('Ground Blast: a visual lead on the drawn rival hits, within the along ceiling', () => {
    const blast = predictedBlastOf(rtt);
    expect(blast.fired).toBe(true);
    // Predicted, the HUD clamps from the drawn kart (renderer.realmRacers.selfAimPose),
    // exactly the self pose that screen draws.
    expect(blast.caster).toBe('drawn');
    expect(blast.casterPos).toEqual(blast.drawnSelf);
    expect(blast.serverClamped).toBe(false);
    expect(blast.falloff).toBeCloseTo(groundBlastFalloff(blast.missYd, 0, 0, 0), 9);
    expect(blast.hit).toBe(true);
    expect(blast.missYd).toBeLessThan(GROUND_BLAST_RADIUS);
    expect(Math.abs(blast.missAlongYd)).toBeLessThanOrEqual(SELF_FRAME_BLAST_ALONG_CEIL[rtt]);
  });
});

describe('rival frames across RTTs, driver prediction on', () => {
  it('each screen follows its own link in an asymmetric pair', () => {
    const run = predictedResult('sideBySide', 60, 200);
    expectSelfFrameCeilings(run.a, 60);
    expectSelfFrameCeilings(run.b, 200);
  });

  it('keeps the rival in the self frame past the arrival-age cap (300 ms)', () => {
    // The self leads the rival's snapshot by about 290 ms here, over the
    // 250 ms arrival budget: a fixed cap left the rival 140 ms behind the self
    // (measured), the scaled one keeps the two frames together.
    const run = predictedResult('tailgate', 300);
    for (const screen of [run.a, run.b]) {
      expect(screen.frames).toBeGreaterThan(20);
      expect(Math.abs(screen.frameGapMs)).toBeLessThanOrEqual(SELF_FRAME_GAP_CEIL_MS);
      expect(screen.selfOffsetMs).toBeGreaterThan(0);
      expect(screen.selfOffsetMs).toBeLessThanOrEqual(300 / 2 + TICK_MS);
      expect(screen.rivalInSelfFrameP95Yd).toBeLessThanOrEqual(SELF_FRAME_RIVAL_P95_CEIL_300);
    }
  });
});

// The block above ("baseline R1 is expected to flip"), flipped by drawing each
// rival in the local kart's frame: the same questions, asked with driver
// prediction on.
describe('R1 flipped: rivals drawn in the local kart frame', () => {
  it.each(RTTS)('the drawn frames at %i ms: self ahead, rival in its frame', (rtt) => {
    for (const s of SCENARIOS) {
      expectSelfFrames(predictedResult(s, rtt).a);
      expectSelfFrames(predictedResult(s, rtt).b);
    }
  });

  it('the asymmetric pair: each screen in its own self frame', () => {
    const run = predictedResult('sideBySide', 60, 200);
    expectSelfFrames(run.a);
    expectSelfFrames(run.b);
    // Each lead follows its own link.
    expect(run.b.selfOffsetMs).toBeGreaterThan(run.a.selfOffsetMs + 40);
  });

  it('the rival no longer falls behind its server pose, at any RTT', () => {
    for (const rtt of RTTS) {
      const shown = predictedResult('tailgate', rtt).a;
      expect(shown.rivalAlongMeanYd).toBeGreaterThan(0);
      // The gap the follower sees is nearer the server's than stood down.
      expect(shown.separationErr.p95).toBeLessThan(result('tailgate', rtt).a.separationErr.p95);
    }
  });

  it.each(RTTS)('contacts at %i ms: the screens reach the bump by the time it lands', (rtt) => {
    for (const s of ['rearRam', 'sideSwipe'] as const) {
      const before = contactOf(s, rtt);
      const after = predictedContactOf(s, rtt);
      // Stood down, a screen got there late or never; now at or before.
      for (const side of ['a', 'b'] as const) {
        expect(after[side].drawnAtBumpGapVsServerMs as number).toBeLessThanOrEqual(TICK_MS);
      }
      // The rammer's and the swiper's screen draw the bump closer to the
      // server's separation than they did stood down.
      expect(Math.abs(after.a.drawnGapAtServerBumpYd - after.serverGapAtBumpYd)).toBeLessThan(
        Math.abs(before.a.drawnGapAtServerBumpYd - before.serverGapAtBumpYd),
      );
    }
    // The rammer no longer sees the gap wider than the one it bumps across.
    const ram = predictedContactOf('rearRam', rtt);
    expect(ram.a.drawnGapAtServerBumpYd).toBeLessThanOrEqual(ram.serverGapAtBumpYd + 0.5);
  });

  it('Ground Blast: the visual lead hits at every RTT, 200 ms included', () => {
    for (const rtt of RTTS) {
      const after = predictedBlastOf(rtt);
      expect(after.hit).toBe(true);
      // The along miss, what latency cost the lead, shrank at every RTT.
      expect(Math.abs(after.missAlongYd)).toBeLessThan(Math.abs(blastOf(rtt).missAlongYd));
    }
    expect(blastOf(200).hit).toBe(false);
  });
});

// The server's forward contact window fired a touch up to two ticks before the
// hulls met. With rivals in the local kart's frame it only over-fired (at 60 ms
// the rear ram bumped at 4.15 yd while neither screen ever drew a touch), so it
// is gone: every contact is the same-tick swept one, on every host.
describe('lot 7 flipped: no forward contact window', () => {
  it('rear ram at 60 ms: the server bumps at the touch both screens draw', () => {
    const ram = predictedContactOf('rearRam', 60);
    expect(Math.abs(ram.serverGapAtBumpYd - CONTACT_REACH_YD)).toBeLessThan(1e-6);
    expect(ram.a.minDrawnGapYd).toBeLessThan(CONTACT_REACH_YD);
    expect(ram.b.minDrawnGapYd).toBeLessThan(CONTACT_REACH_YD);
  });

  it.each(RTTS)(
    'contacts at %i ms: every screen draws the touch, at most its lead early',
    (rtt) => {
      for (const s of ['rearRam', 'sideSwipe'] as const) {
        const contact = predictedContactOf(s, rtt);
        expect(Math.abs(contact.serverGapAtBumpYd - CONTACT_REACH_YD)).toBeLessThan(1e-6);
        for (const screen of [contact.a, contact.b]) {
          // Drawn ahead of the server by about the uplink, the screen touches
          // first, by no more than its lead plus a tick, and never after.
          const touch = screen.drawnTouchVsServerMs;
          expect(touch).not.toBeNull();
          expect(touch as number).toBeLessThanOrEqual(0);
          expect(touch as number).toBeGreaterThanOrEqual(-(rtt / 2 + TICK_MS));
        }
      }
    },
  );
});
