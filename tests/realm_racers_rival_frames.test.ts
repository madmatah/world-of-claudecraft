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
// green. Invariants: what holds whatever the display (the server bumps over
// the reach, events arrive within the link). And the block "baseline R1 is
// expected to flip": today's defects, as they stand while a v2 driver is
// stood down (src/render/self_prediction.ts) and a rival is projected off its
// arrival age with no downlink term. Drawing rivals in the local kart's own
// time frame, and retuning the forward contact window
// (REALM_RACERS_CONTACT_EARLY_TICKS), are meant to flip those knowingly.
//
// Every scenario step is timed from the SERVER tick that dropped the flag.
// Measured at this commit (evergarden_express_tour, the drawn circuit; closed
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
//   Contacts (server bump vs the screens):
//     rear ram   RTT 60/120/200: the server bumps at 4.2 / 4.5 / 5.2 yd (the
//                forward window, reach 3.4), while the rammer's screen shows
//                6.1 / 6.5 / 8.7 yd. A drawn touch, when there is one, comes
//                250 to 1383 ms AFTER the server's bump. The event lands
//                33 to 50 / 67 to 83 / 117 ms later.
//     side swipe RTT 60/120/200: bumps at 3.8 / 3.9 / 3.6 yd, screens at 4.1 to
//                5.5 yd; a drawn touch comes 250 to 2500 ms after the bump.
//
//   Ground Blast, A one second behind B, a perfect visual lead on its drawn B:
//     RTT 60: hit, falloff 0.47, miss 3.2 yd (along -1.7)
//     RTT 120: hit, falloff 0.02, miss 5.9 yd (along -5.1)
//     RTT 200: MISS, 8.8 yd (along -8.4); the same lead on the server's own
//              poses misses by 2.6 to 4.3 yd at every RTT.
//
//   Drawing the raw mirrored pose instead of the projection fails the display
//   ceilings at every RTT and the blast ceilings at 120 and 200 ms.

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

const results = new Map<string, DuelResult>();
const key = (scenario: DuelScenario, rttA: number, rttB = rttA) => `${scenario}:${rttA}:${rttB}`;
function result(scenario: DuelScenario, rttA: number, rttB = rttA): DuelResult {
  const found = results.get(key(scenario, rttA, rttB));
  if (!found) throw new Error(`no run for ${key(scenario, rttA, rttB)}`);
  return found;
}
function contactOf(scenario: DuelScenario, rtt: number): ContactOutcome {
  const contact = result(scenario, rtt).contact;
  if (!contact) throw new Error(`${scenario} at ${rtt} ms recorded no contact outcome`);
  return contact;
}
function blastOf(rtt: number): NonNullable<DuelResult['blast']> {
  const blast = result('blast', rtt).blast;
  if (!blast) throw new Error(`the blast at ${rtt} ms recorded no outcome`);
  return blast;
}

beforeAll(() => {
  for (const scenario of SCENARIOS) {
    for (const rtt of RTTS) results.set(key(scenario, rtt), runDuel(scenario, rtt));
  }
  results.set(key('sideBySide', 60, 200), runDuel('sideBySide', 60, 200));
}, 120_000);

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
    expect(runDuel(s, rtt)).toEqual(result(s, rtt));
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
    '%s: the server bumps over the reach and the event arrives within the link',
    (s) => {
      const contact = contactOf(s, rtt);
      expect(contact.serverBumped).toBe(true);
      // The forward window fires the contact before the server hulls meet.
      expect(contact.serverGapAtBumpYd).toBeGreaterThan(CONTACT_REACH_YD);
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
    expect(blast.hudClamped).toBe(false);
    expect(blast.serverClamped).toBe(false);
    expect(blast.flightTicks).toBe(Math.round(blast.flightSeconds * TICK_RATE));
    // The scorer's miss is the server's own geometry: falloff is 1 - d / radius.
    expect(blast.falloff).toBeCloseTo(Math.max(0, 1 - blast.missYd / GROUND_BLAST_RADIUS), 9);
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

  it.each(RTTS)('contacts at %i ms: no screen shows the touch before the server bumps', (rtt) => {
    for (const s of ['rearRam', 'sideSwipe'] as const) {
      const contact = contactOf(s, rtt);
      for (const screen of [contact.a, contact.b]) {
        expect(screen.drawnGapAtServerBumpYd).toBeGreaterThan(CONTACT_REACH_YD);
        if (screen.drawnTouchVsServerMs !== null) {
          expect(screen.drawnTouchVsServerMs).toBeGreaterThan(0);
        }
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
