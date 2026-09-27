// Realm Racers end-to-end integration test against a running game server
// (npm run server, Postgres via npm run db:up). Covers the whole race flow
// as the wire sees it: the public queue round trip, a Practice seat against
// three house pilots, the countdown to racing handoff, the loaner drive
// block and rally kit on the self record, driving under streamed movement
// intent, the forfeit result event, and the return home to the pre-race
// spot. Practice plus forfeit on purpose, never a full race: the script
// stays under 30 seconds. Override host with SERVER_URL=.
import WebSocket from 'ws';
import { worldAuthMessage } from './lib/world_auth.mjs';

const BASE = process.env.SERVER_URL ?? 'http://localhost:8787';
const WS_BASE = BASE.replace(/^http/, 'ws');
// The tier is re-validated server-side; any RALLY_DRIVER_TIERS value seats a grid.
const TIER = 'rookie';
const GRID_SIZE = 4;
let pass = 0,
  fail = 0;

function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`OK   ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name} ${extra}`);
  }
}

async function api(path, opts = {}, token = null) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// heavy self fields arrive only when they changed; an absent field means
// "same as the previous snapshot". `rr` (the rally readout) and `rrkit`
// (the granted race kit) ride this delta channel; `drv` does NOT (it is a
// per-tick dynamic entity field, present exactly while a machine is driven).
const DELTA_SELF_KEYS = [
  'inv',
  'equip',
  'qlog',
  'qdone',
  'cds',
  'stats',
  'weapon',
  'party',
  'trade',
  'duel',
  'rr',
  'rrkit',
];
function mergeSelf(prev, next) {
  if (prev) for (const k of DELTA_SELF_KEYS) if (!(k in next)) next[k] = prev[k];
  return next;
}

// entity identity fields ride only in "full" records (first sight and
// changes); "lite" records inherit them from the previous state. Ids in
// snap.keep are alive but unchanged; anything absent from both is gone.
const ENTITY_IDENTITY_KEYS = ['k', 'tid', 'nm', 'lv', 'sc', 'c', 'dgn'];
function mergeEnts(prevEnts, snap) {
  const next = new Map();
  for (const w of snap.ents) {
    const prev = prevEnts.get(w.id);
    if (prev && w.k === undefined) {
      for (const key of ENTITY_IDENTITY_KEYS) if (key in prev) w[key] = prev[key];
    }
    next.set(w.id, w);
  }
  for (const id of snap.keep ?? []) {
    const prev = prevEnts.get(id);
    if (prev) next.set(id, prev);
  }
  return next;
}

class Client {
  constructor() {
    this.snapshots = [];
    this.events = [];
    this.self = null;
    this.pid = -1;
    this.entities = new Map();
  }

  connect(token, characterId) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${WS_BASE}/ws`);
      const timeout = setTimeout(() => reject(new Error('connect timeout')), 8000);
      this.ws.on('open', () => {
        this.send(worldAuthMessage(token, characterId));
      });
      this.ws.on('message', (data) => {
        const msg = JSON.parse(String(data));
        if (msg.t === 'hello') {
          this.pid = msg.pid;
          clearTimeout(timeout);
          resolve(msg);
        } else if (msg.t === 'snap') {
          this.self = mergeSelf(this.self, msg.self);
          this.entities = mergeEnts(this.entities, msg);
          this.entities.set(this.self.id, this.self);
        } else if (msg.t === 'events') {
          this.events.push(...msg.list);
        } else if (msg.t === 'error') {
          clearTimeout(timeout);
          reject(new Error(msg.error));
        }
      });
      this.ws.on('error', (e) => {
        clearTimeout(timeout);
        reject(e);
      });
    });
  }

  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }
  cmd(payload) {
    this.send({ t: 'cmd', ...payload });
  }
  input(mi, facing) {
    this.send({ t: 'input', mi, ...(facing !== undefined ? { facing } : {}) });
  }
  close() {
    this.ws?.close();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, timeoutMs, stepMs = 100) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = cond();
    if (value) return value;
    if (Date.now() >= until) return null;
    await sleep(stepMs);
  }
}

const uniq = Date.now().toString(36);
// character names must be letters only (classic rules)
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]).slice(-6);

async function main() {
  const status = await api('/api/status');
  check('server status', status.status === 200 && status.body.ok);

  const user = `racer_${uniq}`;
  const reg = await api('/api/register', {
    method: 'POST',
    body: JSON.stringify({ username: user, password: 'hunter22', email: `${user}@example.com` }),
  });
  check('register account', reg.status === 200 && reg.body.token);
  const token = reg.body.token;

  const char = await api(
    '/api/characters',
    { method: 'POST', body: JSON.stringify({ name: `Vroom${alpha}`, class: 'warrior' }) },
    token,
  );
  check('create character', char.status === 200 && char.body.id > 0);

  const c = new Client();
  await c.connect(token, char.body.id);
  check('client joined world', c.pid > 0);

  // A fresh session ships every delta key, so the first snapshot carries the
  // idle rally readout. The spot we stand on now is the spot the race must
  // hand back after the forfeit.
  const idle = await waitFor(() => (c.self?.rr !== undefined ? c.self.rr : null), 3000);
  check('baseline rally readout on the wire', !!idle && idle.match === null, JSON.stringify(idle));
  const prePos = { x: c.self.x, z: c.self.z };

  // --- public queue round trip: join then leave, both acknowledged by event
  c.cmd({ cmd: 'realm_racers_join' });
  const queuedEvent = await waitFor(
    () => c.events.find((e) => e.type === 'realmRacersQueued'),
    3000,
  );
  check(
    'queue join emits realmRacersQueued',
    !!queuedEvent && queuedEvent.position >= 1,
    JSON.stringify(queuedEvent),
  );
  const queuedReadout = await waitFor(() => c.self.rr?.queued === true, 2000);
  check('rr readout shows queued', !!queuedReadout);

  c.cmd({ cmd: 'realm_racers_leave' });
  const unqueuedEvent = await waitFor(
    () => c.events.find((e) => e.type === 'realmRacersUnqueued'),
    3000,
  );
  check('queue leave emits realmRacersUnqueued', !!unqueuedEvent);
  const unqueuedReadout = await waitFor(() => c.self.rr?.queued === false, 2000);
  check('rr readout shows unqueued', !!unqueuedReadout);

  // --- practice: a private grid of house pilots, no queue, no wait
  c.cmd({ cmd: 'realm_racers_practice', tier: TIER });
  const match = await waitFor(() => c.self.rr?.match ?? null, 4000);
  check('practice seats a match', !!match);
  check(
    'match opens in the loading lobby, house pilots ready',
    !!match &&
      match.phase === 'loading' &&
      match.loading?.readyIds?.length === GRID_SIZE - 1 &&
      !match.loading.readyIds.includes(c.pid),
    JSON.stringify(match && { phase: match.phase, loading: match.loading }),
  );
  check('match is flagged practice', !!match && match.practice === true);
  check(
    `standings carry ${GRID_SIZE} racers`,
    !!match &&
      match.gridSize === GRID_SIZE &&
      match.standings?.length === GRID_SIZE &&
      match.participantIds?.length === GRID_SIZE,
    JSON.stringify(match && { gridSize: match.gridSize, n: match.standings?.length }),
  );
  const bots = match?.standings?.filter((r) => r.botTier === TIER) ?? [];
  check(`three house pilots at tier ${TIER}`, bots.length === GRID_SIZE - 1, JSON.stringify(bots));
  check(
    'the human is seated in the standings',
    !!match &&
      match.me?.pid === c.pid &&
      match.standings?.some((r) => r.pid === c.pid && r.botTier === null),
  );

  // Seated means behind the wheel already: the loaner drive block and the
  // rally kit both ride from the countdown on.
  const drv = await waitFor(() => c.self.drv ?? null, 2000);
  check(
    'self carries the loaner drive block',
    !!drv && drv.k === 'rally_loaner',
    JSON.stringify(drv),
  );
  const kit = await waitFor(() => c.self.rrkit ?? null, 2000);
  check(
    'rally kit active with weapon and charge budget',
    !!kit && kit.active === true && kit.w === 'rally_ground_blast' && kit.c === 3,
    JSON.stringify(kit),
  );

  // --- the lobby closes on this client's ready, then the countdown runs
  c.cmd({ cmd: 'realm_racers_ready' });
  const countdown = await waitFor(() => c.self.rr?.match?.phase === 'countdown', 2000, 50);
  check('ready closes the lobby into the countdown', !!countdown);

  // --- the flag: countdown runs 9 seconds, then the phase flips to racing
  const racing = await waitFor(() => c.self.rr?.match?.phase === 'racing', 12000, 50);
  check('countdown hands off to racing', !!racing);

  // --- drive: stream forward intent (about the client's own cadence; the
  // server zeroes stale intent after 750ms of silence). No facing: a
  // machine's heading is steered server-side and streamed facing is refused.
  const startPos = { x: c.self.x, z: c.self.z };
  let maxSpeed = 0;
  const driveUntil = Date.now() + 3500;
  while (Date.now() < driveUntil) {
    c.input({ f: 1 });
    maxSpeed = Math.max(maxSpeed, c.self.drv?.sp ?? 0);
    await sleep(100);
  }
  c.input({});
  const drove = Math.hypot(c.self.x - startPos.x, c.self.z - startPos.z);
  check('throttle spins the machine up', maxSpeed > 0, `maxSpeed=${maxSpeed.toFixed(2)}`);
  check('the racer covers ground', drove > 3, `drove=${drove.toFixed(1)}`);

  // --- forfeit: told at once and placed last, then six seconds of tableau
  // before the Society sends the quitter home
  c.cmd({ cmd: 'realm_racers_forfeit' });
  const result = await waitFor(() => c.events.find((e) => e.type === 'realmRacersResult'), 4000);
  check(
    'forfeit emits realmRacersResult with forfeited true',
    !!result && result.forfeited === true && result.won === false,
    JSON.stringify(result),
  );
  check(
    'quitter classified last of the grid',
    !!result && result.placing === GRID_SIZE && result.gridSize === GRID_SIZE,
    JSON.stringify(result && { placing: result.placing, gridSize: result.gridSize }),
  );

  const home = await waitFor(() => c.self.rr?.match === null && c.self.drv === undefined, 9000);
  check('match clears and the drive block leaves within the return window', !!home);
  const homeDelta = Math.hypot(c.self.x - prePos.x, c.self.z - prePos.z);
  check('returned near the pre-race spot', homeDelta < 5, `delta=${homeDelta.toFixed(1)}`);

  c.close();
  await sleep(300);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
