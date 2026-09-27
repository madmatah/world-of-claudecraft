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

import { GROUND_BLAST_RADIUS } from '../src/sim/realm_racers_ground_blast';
import { TICK_RATE } from '../src/sim/types';
import {
  CONTACT_REACH_YD,
  type DuelResult,
  type DuelScenario,
  runDuel,
  type ViewerScores,
} from './helpers/rival_frames';

// Two HUMAN pilots, each a real ClientWorld over its own latency link, in one
// public heat (tests/helpers/racer_harness.ts createRacerDuelHarness). Each
// screen's rival is drawn through the renderer's own remote racing projection
// (stepRemoteVehicleDisplay, with the arguments renderer.sync passes), and set
// against the server at the same wall instant (tests/helpers/rival_frames.ts).
//
// These pins hold the CURRENT behaviour loosely: a v2 driver is stood down and
// drawn by the interpolated fallback (src/render/self_prediction.ts), and a
// rival is projected off its arrival age with no downlink term. They are the
// regression bar that drawing rivals in the local kart's own time frame, and
// retuning the forward contact window (REALM_RACERS_CONTACT_EARLY_TICKS), are
// meant to tighten.
//
// Measured at this commit (evergarden_express_tour, the drawn circuit; closed
// loop house-pilot brain; links RTT/2 each way plus 0 to 10 ms seeded jitter;
// racing speed on this circuit is about 30 yd/s, not the loaner's 60 top speed):
//
//   Display, side by side and tailgate (medians over both screens):
//     RTT   self frame   rival frame   gap (self - rival)   rival along p95   separation err p95
//      60     -78 ms       -35 ms          -43 ms               1.4 yd            1.9 to 2.5 yd
//     120    -105 ms       -66 ms          -39 ms               2.5 yd            1.8 to 2.5 yd
//     200    -148 ms      -106 ms          -42 ms               4.1 yd            1.8 to 3.4 yd
//   The rival sits one downlink in the past (S - d), the self a further ~42 ms
//   behind it, at every RTT. A 60/200 pair shows each screen on its own link:
//   A -78 / -36 ms, B -148 / -106 ms.
//
//   Contacts (server bump vs the screens):
//     rear ram   RTT 60/120/200: the server bumps at 4.7 / 4.2 / 4.5 yd (the
//                forward window, reach 3.4), while the rammer's screen shows
//                7.1 / 6.8 / 8.2 yd; neither screen ever draws the hulls
//                touching (closest 3.6 to 5.6 yd). The event lands 50 / 67 to
//                83 / 117 ms later.
//     side swipe RTT 60/120/200: bumps at 3.9 / 3.7 / 3.6 yd, screens at 3.9 to
//                5.3 yd; a drawn touch, when there is one, comes 183 to 1867 ms
//                AFTER the server's (during the rub).
//
//   Ground Blast, A one second behind B, a perfect visual lead on its drawn B:
//     RTT 60: hit, falloff 0.43, miss 3.4 yd (along -1.6)
//     RTT 120: hit, falloff 0.02, miss 5.9 yd (along -5.4)
//     RTT 200: MISS, 8.8 yd (along -8.2); the same lead on the server's own
//              poses misses by 2.1 to 3.9 yd at every RTT.

const RTTS = [60, 120, 200] as const;
const SCENARIOS: readonly DuelScenario[] = [
  'sideBySide',
  'tailgate',
  'rearRam',
  'sideSwipe',
  'blast',
];

const results = new Map<string, DuelResult>();
const key = (scenario: DuelScenario, rttA: number, rttB = rttA) => `${scenario}:${rttA}:${rttB}`;
function result(scenario: DuelScenario, rttA: number, rttB = rttA): DuelResult {
  const found = results.get(key(scenario, rttA, rttB));
  if (!found) throw new Error(`no run for ${key(scenario, rttA, rttB)}`);
  return found;
}

beforeAll(() => {
  for (const scenario of SCENARIOS) {
    for (const rtt of RTTS) results.set(key(scenario, rtt), runDuel(scenario, rtt));
  }
  results.set(key('sideBySide', 60, 200), runDuel('sideBySide', 60, 200));
}, 120_000);

function expectDisplayPins(screen: ViewerScores, rtt: number): void {
  expect(screen.frames).toBeGreaterThan(20);
  // The rival is drawn one downlink in the past: its arrival age carries no
  // downlink term on v2 (renderer.sync's remote racing branch).
  expect(screen.rivalOffsetMs).toBeGreaterThanOrEqual(-rtt / 2 - 20);
  expect(screen.rivalOffsetMs).toBeLessThanOrEqual(-rtt / 2 + 5);
  // The stood-down self is drawn further back still (the fallback lags the
  // mirror by the smoother on top of the alpha lead).
  expect(screen.selfOffsetMs).toBeGreaterThanOrEqual(-rtt / 2 - 70);
  expect(screen.selfOffsetMs).toBeLessThanOrEqual(-rtt / 2 - 25);
  // The stood-down frame gap: self BEHIND rival, by about the same at every RTT.
  expect(screen.frameGapMs).toBeGreaterThanOrEqual(-60);
  expect(screen.frameGapMs).toBeLessThanOrEqual(-25);
  expect(screen.rivalAlongMeanYd).toBeLessThan(0);
  // The projection stays on the rival's line; the error is along it.
  expect(screen.rivalAcrossP95Yd).toBeLessThan(0.5);
  expect(screen.separationErr.p95).toBeLessThan(4.5);
  expect(screen.separationErr.max).toBeLessThan(5);
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

  it('replays identically for the same seeds and links', () => {
    expect(runDuel('tailgate', 120)).toEqual(result('tailgate', 120));
  });
});

describe.each(RTTS)('rival frames at RTT %i ms', (rtt) => {
  it.each(['sideBySide', 'tailgate'] as const)('%s: the drawn rival and self frames', (s) => {
    const run = result(s, rtt);
    expectDisplayPins(run.a, rtt);
    expectDisplayPins(run.b, rtt);
  });

  it('rear ram: the server bumps before either screen draws the hulls touching', () => {
    const contact = result('rearRam', rtt).contact;
    expect(contact?.serverBumped).toBe(true);
    if (!contact) return;
    // The forward window fires the contact before the server hulls meet.
    expect(contact.serverGapAtBumpYd).toBeGreaterThan(CONTACT_REACH_YD);
    for (const screen of [contact.a, contact.b]) {
      expect(screen.drawnGapAtServerBumpYd).toBeGreaterThan(CONTACT_REACH_YD);
      expect(screen.drawnTouchVsServerMs).toBeNull();
      expect(screen.minDrawnGapYd).toBeGreaterThan(CONTACT_REACH_YD);
      expect(screen.eventArrivalMs).toBeGreaterThanOrEqual(rtt / 2);
      expect(screen.eventArrivalMs).toBeLessThanOrEqual(rtt / 2 + 60);
    }
    // The rammer, following, sees the gap wider than the one it is rammed from.
    expect(contact.a.drawnGapAtServerBumpYd).toBeGreaterThan(contact.serverGapAtBumpYd + 1);
  });

  it('side swipe: the server bumps first, a drawn touch only ever comes later', () => {
    const contact = result('sideSwipe', rtt).contact;
    expect(contact?.serverBumped).toBe(true);
    if (!contact) return;
    expect(contact.serverGapAtBumpYd).toBeGreaterThan(CONTACT_REACH_YD);
    for (const screen of [contact.a, contact.b]) {
      expect(screen.drawnGapAtServerBumpYd).toBeGreaterThan(CONTACT_REACH_YD);
      if (screen.drawnTouchVsServerMs !== null) {
        expect(screen.drawnTouchVsServerMs).toBeGreaterThan(0);
      }
      expect(screen.eventArrivalMs).toBeGreaterThanOrEqual(rtt / 2);
      expect(screen.eventArrivalMs).toBeLessThanOrEqual(rtt / 2 + 60);
    }
  });

  it('Ground Blast: a visual lead on the drawn rival lands behind it', () => {
    const blast = result('blast', rtt).blast;
    expect(blast?.fired).toBe(true);
    if (!blast) return;
    expect(blast.hudClamped).toBe(false);
    expect(blast.serverClamped).toBe(false);
    expect(blast.flightTicks).toBe(Math.round(blast.flightSeconds * TICK_RATE));
    // The scorer's miss is the server's own geometry: falloff is 1 - d / radius.
    expect(blast.falloff).toBeCloseTo(Math.max(0, 1 - blast.missYd / GROUND_BLAST_RADIUS), 9);
    expect(blast.missAlongYd).toBeLessThan(0);
    // The lead rule itself lands inside the blast without latency.
    expect(blast.zeroLatencyMissYd).toBeLessThan(GROUND_BLAST_RADIUS);
  });
});

describe('rival frames across RTTs', () => {
  it('each screen follows its own link in an asymmetric pair', () => {
    const run = result('sideBySide', 60, 200);
    expectDisplayPins(run.a, 60);
    expectDisplayPins(run.b, 200);
  });

  it('the rival falls further behind its server pose as the RTT grows', () => {
    const along = RTTS.map((rtt) => result('tailgate', rtt).a.rivalAlongP95Yd);
    expect(along[0]).toBeLessThan(along[1]);
    expect(along[1]).toBeLessThan(along[2]);
  });

  it('Ground Blast: the visual lead hits at 60 ms and misses at 200 ms', () => {
    const miss = RTTS.map((rtt) => result('blast', rtt).blast?.missYd ?? Number.NaN);
    expect(miss[0]).toBeLessThan(miss[1]);
    expect(miss[1]).toBeLessThan(miss[2]);
    expect(result('blast', 60).blast?.hit).toBe(true);
    expect(result('blast', 200).blast?.hit).toBe(false);
  });
});
