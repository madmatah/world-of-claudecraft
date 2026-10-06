import { describe, expect, it, vi } from 'vitest';

// Postgres is mocked before the server/game import the harness pulls in
// (tests/CLAUDE.md, Server tests): the same factory as the other racer suites.
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

import type { SimEvent } from '../src/sim/types';
import type { LatencyLinkConfig } from './helpers/latency_link';
import {
  createRacerDuelHarness,
  type DuelRecording,
  type ScreenFrame,
  type ServerTickRow,
} from './helpers/racer_harness';

// The bump drawn at the seen touch (src/render/mortar_overdrive/contact_kick_core.ts:
// started by src/render/mortar_overdrive/scene.ts, stepped and retired by the self
// display, self_render_position_core.ts), on two human screens over their own
// links, with the same race run twice: the kick on and off. Both pilots read
// the SERVER's machine and their keys are scripted, so the two runs are the
// same race to the tick and differ only in what each screen draws.
//
// The error is a drawn machine against the server's at the instant the local
// kart is drawn (its median frame offset on the approach), over the contact:
// 150 ms before the server's contact to 600 ms after it (or around the
// closest approach of a near miss).
//
// Measured (scratch sweep, not committed: scripted side jinks, brake checks
// and close passes; 60 / 120 / 200 ms RTT, 10 and 30 ms jitter, two link
// seeds, 60 fps; and 20 / 30 / 60 / 144 fps at 120 ms): the numbers are in
// docs/prd/mortar-overdrive-contact-lag-compensation.md.

const WINDOW_BEFORE_MS = 150;
const WINDOW_AFTER_MS = 600;

function link(rtt: number, seed: number, jitterMs: number): LatencyLinkConfig {
  return {
    toServer: { baseMs: rtt / 2, jitterMs, seed },
    toClient: { baseMs: rtt / 2, jitterMs, seed: seed + 1 },
  };
}

type Kind = 'jink' | 'brake';

interface RaceOptions {
  kick: boolean;
  /** Hold the server's per-pair bump-event throttle shut: every contact
   *  still moves both machines, and none is announced. */
  throttle?: boolean;
  frameMs?: number;
  seed?: number;
  /** Link jitter, ms (10 by default). */
  jitterMs?: number;
}

/** Per frame, what a screen's prediction and mirror held (never drawn). */
interface PipelineFrame {
  head: string;
  mirror: string;
  kickLive: boolean;
}

interface Run {
  rec: DuelRecording;
  a: number;
  b: number;
  fromMs: number;
  pipeline: Record<number, PipelineFrame[]>;
  reconciles: Record<number, string>;
}

/**
 * jink: side by side, then A steers at B for `holdMs`, counter-steers as long
 * and takes its lane back. brake: one line, A 0.4 s behind; B brakes for
 * `holdMs` and drives on.
 */
function race(kind: Kind, holdMs: number, rtt: number, opts: RaceOptions): Run {
  const seed = opts.seed ?? 1337;
  const d = createRacerDuelHarness({
    latencyA: link(rtt, seed, opts.jitterMs ?? 10),
    latencyB: link(rtt, seed + 5000, opts.jitterMs ?? 10),
    contactKick: opts.kick,
    frameMs: opts.frameMs,
  });
  try {
    d.seat();
    const { a, b } = d;
    if (opts.throttle) {
      d.harness.onServerTick(() => {
        const heat = d.match();
        heat.bumpTicks.clear();
        for (let pair = 0; pair < heat.pids.length ** 2; pair++) {
          heat.bumpTicks.set(pair, d.harness.server.sim.tickCount);
        }
      });
    }
    if (kind === 'jink') {
      a.autopilot({ lineOffsetYd: -2.75, observe: 'server' });
      b.autopilot({ lineOffsetYd: 2.75, observe: 'server' });
    } else {
      b.autopilot({ observe: 'server' });
      a.keys({});
    }
    const pipeline: Record<number, PipelineFrame[]> = { [a.pid]: [], [b.pid]: [] };
    for (const pilot of [a, b]) {
      pilot.peer.onFrame((frame) => {
        const head = pilot.peer.predictionHead();
        const mirror = pilot.client.player;
        pipeline[pilot.pid].push({
          head: head
            ? `${head.ct}:${head.state.pos.x}:${head.state.pos.z}:${head.state.drive?.speed}`
            : '-',
          mirror: `${mirror.pos.x}:${mirror.pos.z}:${mirror.drive?.speed}`,
          kickLive: frame.selfRender.contactKick.rivalId !== -1,
        });
      });
    }
    const rec = d.record();
    d.advanceToGo();
    const fromMs = d.goWallMs() + 1500;
    if (kind === 'jink') {
      d.advanceToRaceMs(2000);
      a.keys({ throttle: true, steer: -1 });
      d.advanceToRaceMs(2000 + holdMs);
      a.keys({ throttle: true, steer: 1 });
      d.advanceToRaceMs(2000 + 2 * holdMs);
      a.autopilot({ lineOffsetYd: -2.75, observe: 'server' });
      d.advanceToRaceMs(4500);
    } else {
      d.advanceToRaceMs(400);
      a.autopilot({ observe: 'server' });
      d.advanceToRaceMs(3000);
      b.keys({ brake: true });
      d.advanceToRaceMs(3000 + holdMs);
      b.autopilot({ observe: 'server' });
      d.advanceToRaceMs(5500);
    }
    d.stopRecording();
    return {
      rec,
      a: a.pid,
      b: b.pid,
      fromMs,
      pipeline,
      reconciles: {
        [a.pid]: JSON.stringify(a.peer.reconcileOutcomes()),
        [b.pid]: JSON.stringify(b.peer.reconcileOutcomes()),
      },
    };
  } finally {
    d.dispose();
  }
}

function isPairBump(ev: SimEvent, a: number, b: number): boolean {
  return (
    ev.type === 'mortarOverdriveBump' &&
    ((ev.aId === a && ev.bId === b) || (ev.aId === b && ev.bId === a))
  );
}

function serverPose(ticks: readonly ServerTickRow[], pid: number, tMs: number) {
  if (tMs < ticks[0].tMs || tMs > ticks[ticks.length - 1].tMs) return null;
  let lo = 0;
  let hi = ticks.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ticks[mid].tMs <= tMs) lo = mid;
    else hi = mid;
  }
  const p = ticks[lo].poses[pid];
  const q = ticks[hi].poses[pid];
  if (!p || !q) return null;
  const span = ticks[hi].tMs - ticks[lo].tMs;
  const f = span > 0 ? (tMs - ticks[lo].tMs) / span : 0;
  return { x: p.x + (q.x - p.x) * f, z: p.z + (q.z - p.z) * f };
}

/** The wall instant the contact is scored around: the server's bump, or the
 *  pair's closest approach when there was none. */
function contactMs(run: Run): { tMs: number; bumped: boolean } {
  const ticks = run.rec.ticks.filter((row) => row.tMs >= run.fromMs);
  const bump = ticks.find((row) => row.events.some((ev) => isPairBump(ev, run.a, run.b)));
  if (bump) return { tMs: bump.tMs, bumped: true };
  let best = ticks[0];
  let gap = Number.POSITIVE_INFINITY;
  for (const row of ticks) {
    const p = row.poses[run.a];
    const q = row.poses[run.b];
    const d = Math.hypot(p.x - q.x, p.z - q.z);
    if (d < gap) {
      gap = d;
      best = row;
    }
  }
  return { tMs: best.tMs, bumped: false };
}

/** Median shift (ms) that best lays the drawn self on the server's track
 *  over the approach. */
function selfOffsetMs(run: Run, pid: number, untilMs: number): number {
  const taus: number[] = [];
  for (const f of run.rec.screens[pid]) {
    if (f.tMs < run.fromMs || f.tMs > untilMs) continue;
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let tau = -400; tau <= 400; tau += 4) {
      const at = serverPose(run.rec.ticks, pid, f.tMs + tau);
      if (!at) continue;
      const d = (at.x - f.selfX) ** 2 + (at.z - f.selfZ) ** 2;
      if (d < bestD) {
        bestD = d;
        best = tau;
      }
    }
    taus.push(best);
  }
  taus.sort((x, y) => x - y);
  return taus[taus.length >> 1];
}

interface ContactError {
  selfMean: number;
  selfMax: number;
  rivalMean: number;
  rivalMax: number;
}

function contactError(run: Run, viewer: number, rival: number, offsetMs: number, atMs: number) {
  const self: number[] = [];
  const other: number[] = [];
  for (const f of run.rec.screens[viewer]) {
    if (f.tMs < atMs - WINDOW_BEFORE_MS || f.tMs > atMs + WINDOW_AFTER_MS) continue;
    if (f.rivalX === null || f.rivalZ === null) continue;
    const s = serverPose(run.rec.ticks, viewer, f.tMs + offsetMs);
    const r = serverPose(run.rec.ticks, rival, f.tMs + offsetMs);
    if (!s || !r) continue;
    self.push(Math.hypot(f.selfX - s.x, f.selfZ - s.z));
    other.push(Math.hypot(f.rivalX - r.x, f.rivalZ - r.z));
  }
  const mean = (v: number[]) => v.reduce((x, y) => x + y, 0) / v.length;
  return {
    selfMean: mean(self),
    selfMax: Math.max(...self),
    rivalMean: mean(other),
    rivalMax: Math.max(...other),
  } satisfies ContactError;
}

/** The first frame (ms) the two arms drew differently, or null. */
function firstDivergenceMs(on: ScreenFrame[], off: ScreenFrame[]): number | null {
  for (let i = 0; i < Math.min(on.length, off.length); i++) {
    const p = on[i];
    const q = off[i];
    const rivalMoved =
      p.rivalX !== null && q.rivalX !== null && p.rivalZ !== null && q.rivalZ !== null
        ? Math.hypot(p.rivalX - q.rivalX, p.rivalZ - q.rivalZ)
        : 0;
    if (Math.hypot(p.selfX - q.selfX, p.selfZ - q.selfZ) > 1e-9 || rivalMoved > 1e-9) return p.tMs;
  }
  return null;
}

function arrivalMs(screen: ScreenFrame[], a: number, b: number): number | null {
  return screen.find((f) => f.events.some((ev) => isPairBump(ev, a, b)))?.tMs ?? null;
}

const pairs = new Map<string, { on: Run; off: Run }>();
function pair(
  kind: Kind,
  holdMs: number,
  rtt: number,
  extra: Omit<RaceOptions, 'kick'> = {},
): { on: Run; off: Run } {
  const key = `${kind}:${holdMs}:${rtt}:${JSON.stringify(extra)}`;
  let got = pairs.get(key);
  if (!got) {
    got = {
      on: race(kind, holdMs, rtt, { ...extra, kick: true }),
      off: race(kind, holdMs, rtt, { ...extra, kick: false }),
    };
    pairs.set(key, got);
  }
  return got;
}

const RTTS = [60, 120, 200] as const;
type Rtt = (typeof RTTS)[number];
/** Scripted contacts the server bumps at each RTT (with these link seeds): a
 *  side jink, and a brake check whose hold is set where the follower arrives. */
const CONTACTS: Record<Rtt, readonly [Kind, number][]> = {
  60: [
    ['jink', 150],
    ['jink', 200],
    ['brake', 500],
  ],
  120: [
    ['jink', 150],
    ['jink', 200],
    ['brake', 150],
  ],
  200: [
    ['jink', 150],
    ['jink', 200],
    ['brake', 350],
  ],
};

/** Summed mean drawn error over every contact and both screens, yd. */
function summedError(rtt: number, contacts: readonly [Kind, number][], extra = {}) {
  const sum = { selfOn: 0, selfOff: 0, rivalOn: 0, rivalOff: 0 };
  for (const [kind, hold] of contacts) {
    const { on, off } = pair(kind, hold, rtt, extra);
    const at = contactMs(off).tMs;
    for (const [viewer, rival] of [
      [off.a, off.b],
      [off.b, off.a],
    ]) {
      const offset = selfOffsetMs(off, viewer, at - 300);
      const withKick = contactError(on, viewer, rival, offset, at);
      const without = contactError(off, viewer, rival, offset, at);
      sum.selfOn += withKick.selfMean;
      sum.selfOff += without.selfMean;
      sum.rivalOn += withKick.rivalMean;
      sum.rivalOff += without.rivalMean;
    }
  }
  return sum;
}

describe.each(RTTS)('the bump drawn at the seen touch (%i ms RTT)', (rtt) => {
  it('is display-only: the race, the prediction and the mirror are the same frame for frame', () => {
    for (const [kind, hold] of CONTACTS[rtt]) {
      const { on, off } = pair(kind, hold, rtt);
      expect(on.rec.ticks.length).toBeGreaterThan(40);
      expect(on.rec.ticks).toEqual(off.rec.ticks);
      for (const pid of [on.a, on.b]) {
        expect(on.pipeline[pid].map((f) => f.head)).toEqual(off.pipeline[pid].map((f) => f.head));
        expect(on.pipeline[pid].map((f) => f.mirror)).toEqual(
          off.pipeline[pid].map((f) => f.mirror),
        );
        expect(on.reconciles[pid]).toBe(off.reconciles[pid]);
      }
      // ...while the kick did run on the drawn side.
      expect(
        on.pipeline[on.a].some((f) => f.kickLive) || on.pipeline[on.b].some((f) => f.kickLive),
      ).toBe(true);
    }
  });

  it('starts at the drawn touch, before the server contact reaches the screen', () => {
    for (const [kind, hold] of CONTACTS[rtt]) {
      const { on, off } = pair(kind, hold, rtt);
      expect(contactMs(off).bumped).toBe(true);
      let drawn = 0;
      for (const viewer of [on.a, on.b]) {
        const kicked = firstDivergenceMs(on.rec.screens[viewer], off.rec.screens[viewer]);
        if (kicked === null) continue;
        drawn++;
        const arrived = arrivalMs(on.rec.screens[viewer], on.a, on.b);
        expect(arrived).not.toBeNull();
        expect(kicked).toBeLessThan(arrived as number);
      }
      expect(drawn).toBeGreaterThan(0);
    }
  });

  it('draws both machines nearer the server over the contacts, by a margin', () => {
    const sum = summedError(rtt, CONTACTS[rtt]);
    expect(sum.selfOn).toBeLessThan(sum.selfOff * 0.95);
    expect(sum.rivalOn).toBeLessThan(sum.rivalOff * 0.95);
  });
});

describe('a contact the server never announces', () => {
  // The per-pair event throttle held shut: every contact still moves both
  // machines through the replay, and no bump event reaches either screen. On
  // a jitter-free link an event is the only thing the two runs differ by, so
  // a kick that retired on the event, not the acknowledgement, would draw
  // them differently.
  it('retires on the acknowledgement, not the event: drawn the same with or without one', () => {
    const jitterFree: [Kind, number][] = [
      ['jink', 150],
      ['jink', 250],
      ['brake', 500],
    ];
    for (const [kind, hold] of jitterFree) {
      const announced = pair(kind, hold, 120, { jitterMs: 0 });
      const silent = pair(kind, hold, 120, { jitterMs: 0, throttle: true });
      const bumps = (run: Run) =>
        run.rec.ticks
          .flatMap((row) => row.events)
          .filter((ev) => ev.type === 'mortarOverdriveBump');
      expect(bumps(announced.on).length).toBeGreaterThan(0);
      expect(bumps(silent.on)).toEqual([]);
      expect(silent.on.rec.ticks.map((row) => row.poses)).toEqual(
        announced.on.rec.ticks.map((row) => row.poses),
      );
      let kicked = false;
      for (const viewer of [silent.on.a, silent.on.b]) {
        const xz = (run: Run) =>
          run.rec.screens[viewer].map((f) => [f.selfX, f.selfZ, f.rivalX, f.rivalZ]);
        expect(xz(silent.on)).toEqual(xz(announced.on));
        kicked ||= silent.on.pipeline[viewer].some((f) => f.kickLive);
        expect(silent.on.pipeline[viewer].at(-1)?.kickLive).toBe(false);
      }
      expect(kicked).toBe(true);
    }
  });

  // Under the event threshold: a jink at 60 ms whose server contact settles
  // the pair at the reach with too little closing speed to announce, while B's
  // screen saw a real touch (link seed 4242).
  it('a contact under the event threshold is not drawn twice', () => {
    const { on, off } = pair('brake', 300, 60, { seed: 4242 });
    const near = contactMs(off);
    expect(near.bumped).toBe(false);
    const ticks = off.rec.ticks.filter((row) => row.tMs >= off.fromMs);
    const gaps = ticks.map((row) =>
      Math.hypot(row.poses[off.a].x - row.poses[off.b].x, row.poses[off.a].z - row.poses[off.b].z),
    );
    // A real contact (settled at the reach), no announcement.
    expect(Math.min(...gaps)).toBeCloseTo(3.4, 6);
    expect(firstDivergenceMs(on.rec.screens[on.b], off.rec.screens[on.b])).not.toBeNull();
    const offset = selfOffsetMs(off, off.b, near.tMs - 300);
    const withKick = contactError(on, on.b, on.a, offset, near.tMs);
    const without = contactError(off, off.b, off.a, offset, near.tMs);
    expect(withKick.selfMax).toBeLessThan(without.selfMax + 0.25);
    expect(on.pipeline[on.b].at(-1)?.kickLive).toBe(false);
    // Handed over on the acknowledgement that carried the contact: live for
    // about the predicted lead (a 60 ms link), never held to a deadline.
    const live = on.pipeline[on.b].filter((f) => f.kickLive).length;
    expect(live).toBeGreaterThan(0);
    expect(live * (1000 / 60)).toBeLessThan(250);
  });
});

/** Contacts a screen draws at each frame rate (120 ms RTT, link seed 1337):
 *  the client's sampling moves the race, so each rate scripts its own. */
const CONTACTS_AT_FPS: Record<number, [Kind, number][]> = {
  20: [
    ['jink', 150],
    ['jink', 200],
    ['brake', 250],
  ],
  30: [
    ['brake', 150],
    ['brake', 250],
    ['brake', 300],
  ],
  60: CONTACTS[120].slice(),
  144: [['brake', 500]],
};

describe.each([20, 30, 60, 144])('at %i fps (120 ms RTT)', (fps) => {
  it('still draws the contacts nearer the server', () => {
    const sum = summedError(120, CONTACTS_AT_FPS[fps], { frameMs: 1000 / fps });
    expect(sum.selfOn).toBeLessThan(sum.selfOff * 0.9);
    expect(sum.rivalOn).toBeLessThan(sum.rivalOff * 0.9);
  });
});

describe('a touch the server never had', () => {
  // A jinks at B and counter-steers in time: the server keeps the pair 3.59 yd
  // apart (the reach is 3.40), while A's screen, at 200 ms, draws the touch.
  it('is drawn, capped, then glides back out to the same pose', () => {
    const { on, off } = pair('jink', 500, 200);
    const near = contactMs(off);
    expect(near.bumped).toBe(false);
    const kicked = firstDivergenceMs(on.rec.screens[on.a], off.rec.screens[on.a]);
    expect(kicked).not.toBeNull();
    let worst = 0;
    for (let i = 0; i < on.rec.screens[on.a].length; i++) {
      const p = on.rec.screens[on.a][i];
      const q = off.rec.screens[off.a][i];
      worst = Math.max(worst, Math.hypot(p.selfX - q.selfX, p.selfZ - q.selfZ));
    }
    expect(worst).toBeGreaterThan(0.2);
    expect(worst).toBeLessThanOrEqual(3);
    const later = on.rec.screens[on.a].filter((f) => f.tMs > (kicked as number) + 800);
    const offLater = off.rec.screens[off.a].filter((f) => f.tMs > (kicked as number) + 800);
    expect(later.length).toBeGreaterThan(5);
    for (let i = 0; i < Math.min(later.length, offLater.length); i++) {
      expect(
        Math.hypot(later[i].selfX - offLater[i].selfX, later[i].selfZ - offLater[i].selfZ),
      ).toBeLessThan(0.01);
    }
  });
});
