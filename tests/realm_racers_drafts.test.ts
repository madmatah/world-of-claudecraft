// The dev draft overlay: circuits that exist for one session so a drawing can
// be driven without a source edit.
//
// Two properties carry the whole feature, and neither is about the draft. The
// first is that an AUTHORED lane never moves: dev lanes append after every one
// of them, so a practice copy cannot relocate under a player standing on it.
// The second is that a broken drawing is refused BY NAME rather than seated and
// discovered at speed, which is the failure the metrics core exists to prevent.

import { afterEach, describe, expect, it } from 'vitest';
import {
  REALM_RACERS_PRACTICE_CIRCUIT as GARDEN,
  type RealmRacersCircuit,
  realmRacersCircuitById,
} from '../src/sim/content/realm_racers_circuits';
import { realmRacersColliders } from '../src/sim/realm_racers_colliders';
import { clearRealmRacersDraftCircuits } from '../src/sim/realm_racers_draft_registry';
import { realmRacersRegisterDraftCircuit } from '../src/sim/realm_racers_drafts';
import {
  REALM_RACERS_GRID_SIZE,
  REALM_RACERS_LANE_DZ,
  REALM_RACERS_LANES,
  REALM_RACERS_ORIGIN,
  realmRacersLaneAt,
  realmRacersLaneOffset,
  realmRacersPublicLane,
} from '../src/sim/realm_racers_layout';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { startRealmRacersDevRace } from '../src/sim/social/realm_racers_bots';

/** A drawn circuit: the garden's own geometry under a draft id, which is the
 *  shape the editor exports (`loadCircuit` loads a shipped record as
 *  `draft_<id>`). */
function draft(id: string, over: Partial<RealmRacersCircuit> = {}): RealmRacersCircuit {
  return { ...GARDEN, id, roles: ['competition'], practiceCopies: 0, ...over };
}

/** A context with only what registration reads: the dev gate and the live
 *  matches it must not swap a record out from under. */
const devCtx = (devCommands = true) =>
  ({ devCommands, realmRacers: { match: null, practices: [] } }) as unknown as SimContext;

/** The problem CODES a refusal named, sorted, with the axis suffix kept: a
 *  refusal is only useful if it says which check caught it. */
const codesOf = (registration: { problems: readonly string[] }): string[] =>
  registration.problems.map((problem) => problem.split(':')[0]).sort();

afterEach(() => {
  clearRealmRacersDraftCircuits();
});

describe('registering a drawn circuit', () => {
  it('makes an id the game did not author resolve', () => {
    expect(realmRacersCircuitById('draft_one')).toBeUndefined();
    const record = draft('draft_one');
    const registration = realmRacersRegisterDraftCircuit(devCtx(), record);
    expect(registration.problems).toEqual([]);
    expect(registration.lane).toBeGreaterThanOrEqual(REALM_RACERS_LANES.length);
    expect(realmRacersCircuitById('draft_one')).toBe(record);
  });

  it('refuses an id the game authors, and disturbs nothing by refusing', () => {
    // The overlay is consulted AFTER the authored table, so a shipped record
    // could never be REPLACED. What the refusal is really for is the lane: an
    // accepted draft here would take a lane of its own and make
    // `realmRacersPublicLane` answer THAT lane for the authored record (the
    // garden is practice-only, so its public lane is -1), putting two views on
    // one lane and crossing the id-keyed derived caches.
    const laneBefore = realmRacersPublicLane(GARDEN);
    const registration = realmRacersRegisterDraftCircuit(devCtx(), draft(GARDEN.id, { laps: 19 }));
    expect(registration.lane).toBe(-1);
    expect(registration.problems.join(' ')).toContain('authored_circuit_id');

    expect(realmRacersCircuitById(GARDEN.id)).toBe(GARDEN);
    expect(realmRacersCircuitById(GARDEN.id)?.laps).toBe(GARDEN.laps);
    expect(realmRacersPublicLane(GARDEN)).toBe(laneBefore);
    for (const lane of REALM_RACERS_LANES) {
      const z = REALM_RACERS_ORIGIN.z + lane.index * REALM_RACERS_LANE_DZ;
      const found = realmRacersLaneAt(REALM_RACERS_ORIGIN.x, z);
      expect(found?.index, `lane ${lane.index}`).toBe(lane.index);
      expect(found?.circuit.id, `lane ${lane.index}`).toBe(lane.circuit.id);
      expect(found?.practice, `lane ${lane.index}`).toBe(lane.practice);
    }
    // And the slot is not burned: the next real draft still takes the first one.
    expect(realmRacersRegisterDraftCircuit(devCtx(), draft('draft_one')).lane).toBe(
      REALM_RACERS_LANES.length,
    );
  });

  it('refuses to swap the record under a race that is already running on it', () => {
    const sim = new Sim({ seed: 11, playerClass: 'warrior', devCommands: true });
    sim.realmRacersRegisterDraftCircuit(draft('draft_one', { laps: 2 }));
    expect(startRealmRacersDevRace(sim, 'draft_one', 'ace', sim.playerId)).toBe(true);

    const again = sim.realmRacersRegisterDraftCircuit(draft('draft_one', { laps: 5 }));
    expect(again.lane).toBe(-1);
    expect(again.problems.join(' ')).toContain('race_in_progress');
    // The record four machines are driving is untouched.
    expect(realmRacersCircuitById('draft_one')?.laps).toBe(2);
  });

  it('draws no rng, so a dev session cannot fork a deterministic world', () => {
    // Registration is content, not gameplay: it runs outside the tick and must
    // not touch the shared stream, or a seeded replay would diverge on a
    // machine where somebody had raced a draft.
    const sim = new Sim({ seed: 4242, playerClass: 'warrior', devCommands: true });
    const before = sim.rng.next();
    const after = new Sim({ seed: 4242, playerClass: 'warrior', devCommands: true });
    after.realmRacersRegisterDraftCircuit(draft('draft_rng'));
    after.realmRacersRegisterDraftCircuit(draft('draft_rng2'));
    // Same seed, same next draw: nothing in between consumed one.
    expect(after.rng.next()).toBe(before);
  });

  it('is process-wide by design: a second Sim sees what the first registered', () => {
    // Stated rather than discovered. The overlay is CONTENT, so it extends the
    // records module, which is also process-wide; the gate that matters is at
    // REGISTRATION, and a host with dev commands off can never fill it. The
    // only host that can is the offline dev client, which has one Sim.
    const dev = new Sim({ seed: 5, playerClass: 'warrior', devCommands: true });
    expect(dev.realmRacersRegisterDraftCircuit(draft('draft_shared')).problems).toEqual([]);
    const plain = new Sim({ seed: 5, playerClass: 'warrior', devCommands: false });
    expect(realmRacersCircuitById('draft_shared')).toBeDefined();
    // ...and that second Sim still cannot register one of its own.
    expect(plain.realmRacersRegisterDraftCircuit(draft('draft_denied')).lane).toBe(-1);
    expect(realmRacersCircuitById('draft_denied')).toBeUndefined();
  });

  it('leaves every authored lane exactly where it was, with three drafts registered', () => {
    const before = REALM_RACERS_LANES.map((lane) => ({
      index: lane.index,
      id: lane.circuit.id,
      practice: lane.practice,
      offset: realmRacersLaneOffset(lane.index),
    }));
    const lastPractice = REALM_RACERS_LANES[REALM_RACERS_LANES.length - 1];
    for (const id of ['draft_a', 'draft_b', 'draft_c']) {
      realmRacersRegisterDraftCircuit(devCtx(), draft(id));
    }
    const after = REALM_RACERS_LANES.map((lane) => ({
      index: lane.index,
      id: lane.circuit.id,
      practice: lane.practice,
      offset: realmRacersLaneOffset(lane.index),
    }));
    // Weak by construction (the table is built once at import, so this sweep
    // cannot fail): it is here to say what "unchanged" means. The DECISIVE
    // assertions are the `realmRacersLaneAt` probes below, which go through the
    // live lookup the drafts actually extend.
    expect(after).toEqual(before);
    // Lane 0 and the last practice copy, pinned by hand as well as by the sweep
    // above: those two are the ones a moved lane would strand a player on.
    expect(realmRacersLaneOffset(0)).toEqual({ x: 0, z: 0 });
    expect(realmRacersLaneAt(REALM_RACERS_ORIGIN.x, REALM_RACERS_ORIGIN.z)?.index).toBe(0);
    const lastZ = REALM_RACERS_ORIGIN.z + lastPractice.index * REALM_RACERS_LANE_DZ;
    expect(realmRacersLaneAt(REALM_RACERS_ORIGIN.x, lastZ)?.circuit.id).toBe(
      lastPractice.circuit.id,
    );
    expect(realmRacersLaneAt(REALM_RACERS_ORIGIN.x, lastZ)?.practice).toBe(lastPractice.practice);
  });

  it('hands each draft its own lane, appended in registration order', () => {
    const base = REALM_RACERS_LANES.length;
    expect(realmRacersRegisterDraftCircuit(devCtx(), draft('draft_a')).lane).toBe(base);
    expect(realmRacersRegisterDraftCircuit(devCtx(), draft('draft_b')).lane).toBe(base + 1);
    expect(realmRacersPublicLane(draft('draft_a'))).toBe(base);
    expect(realmRacersPublicLane(draft('draft_b'))).toBe(base + 1);
  });

  it('replaces the record on re-registration and keeps the lane', () => {
    const first = draft('draft_one', { laps: 2 });
    const lane = realmRacersRegisterDraftCircuit(devCtx(), first).lane;
    const second = draft('draft_one', { laps: 5 });
    const again = realmRacersRegisterDraftCircuit(devCtx(), second);
    expect(again.lane).toBe(lane);
    expect(realmRacersCircuitById('draft_one')).toBe(second);
    expect(realmRacersCircuitById('draft_one')?.laps).toBe(5);
  });

  it('stands the draft on a lane the position lookup resolves, and nothing past it', () => {
    const lane = realmRacersRegisterDraftCircuit(devCtx(), draft('draft_one')).lane;
    const z = REALM_RACERS_ORIGIN.z + lane * REALM_RACERS_LANE_DZ;
    const found = realmRacersLaneAt(REALM_RACERS_ORIGIN.x, z);
    expect(found?.index).toBe(lane);
    expect(found?.circuit.id).toBe('draft_one');
    expect(found?.practice).toBe(false);
    // The next lane along is empty until a second draft claims it.
    expect(realmRacersLaneAt(REALM_RACERS_ORIGIN.x, z + REALM_RACERS_LANE_DZ)).toBeNull();
    // And the band still ends where the circuit's own region says it does, on
    // BOTH axes: the z bound is the lane depth, the x bound is the instance
    // band, and a draft lane is subject to each exactly like an authored one.
    expect(realmRacersLaneAt(REALM_RACERS_ORIGIN.x, z + GARDEN.regionHalfZ + 1)).toBeNull();
    expect(realmRacersLaneAt(REALM_RACERS_ORIGIN.x, z - GARDEN.regionHalfZ - 1)).toBeNull();
    expect(realmRacersLaneAt(REALM_RACERS_ORIGIN.x + GARDEN.regionHalfX + 1, z)).toBeNull();
    expect(realmRacersLaneAt(REALM_RACERS_ORIGIN.x - GARDEN.regionHalfX - 1, z)).toBeNull();
    // ...and still resolves just inside each of them.
    expect(realmRacersLaneAt(REALM_RACERS_ORIGIN.x + GARDEN.regionHalfX - 1, z)?.index).toBe(lane);
    expect(realmRacersLaneAt(REALM_RACERS_ORIGIN.x, z + GARDEN.regionHalfZ - 1)?.index).toBe(lane);
  });

  it('returns the same lane object while the record behind it is unchanged', () => {
    // `realmRacersLaneAt` is on the movement path; a fresh object per call
    // would allocate per tick per racer.
    const lane = realmRacersRegisterDraftCircuit(devCtx(), draft('draft_one')).lane;
    const z = REALM_RACERS_ORIGIN.z + lane * REALM_RACERS_LANE_DZ;
    const first = realmRacersLaneAt(REALM_RACERS_ORIGIN.x, z);
    expect(realmRacersLaneAt(REALM_RACERS_ORIGIN.x, z)).toBe(first);
    const replacement = draft('draft_one', { laps: 4 });
    realmRacersRegisterDraftCircuit(devCtx(), replacement);
    const after = realmRacersLaneAt(REALM_RACERS_ORIGIN.x, z);
    expect(after).not.toBe(first);
    expect(after?.circuit).toBe(replacement);
  });
});

describe('refusing a drawing the game cannot drive', () => {
  it('refuses when dev commands are off, and registers nothing', () => {
    const registration = realmRacersRegisterDraftCircuit(devCtx(false), draft('draft_one'));
    expect(registration.lane).toBe(-1);
    expect(registration.problems).toEqual(['dev commands are disabled']);
    expect(realmRacersCircuitById('draft_one')).toBeUndefined();
  });

  it('refuses a self-crossing loop and names the check that caught it', () => {
    // A figure of eight: total turning cancels to about zero instead of a full
    // turn, which is the crossing the flat band cannot carry.
    const crossing = draft('draft_eight', {
      controlPoints: [
        { x: -60, z: -40 },
        { x: 0, z: -10 },
        { x: 60, z: 20 },
        { x: 60, z: -20 },
        { x: 0, z: 10 },
        { x: -60, z: 40 },
      ],
    });
    const registration = realmRacersRegisterDraftCircuit(devCtx(), crossing);
    expect(registration.lane).toBe(-1);
    expect(registration.problems.join(' ')).toContain('self_crossing');
    expect(realmRacersCircuitById('draft_eight')).toBeUndefined();
  });

  it('refuses a circuit deeper than the gap between two lanes', () => {
    const deep = draft('draft_deep', { regionHalfZ: 4000 });
    const registration = realmRacersRegisterDraftCircuit(devCtx(), deep);
    expect(registration.lane).toBe(-1);
    expect(registration.problems.join(' ')).toContain('region_deeper_than_lane_budget');
  });

  it('reports EVERY error it found, by code, with the measurement and the limit', () => {
    const broken = draft('draft_broken', { regionHalfX: 4000, regionHalfZ: 4000 });
    const registration = realmRacersRegisterDraftCircuit(devCtx(), broken);
    // The exact set, not "more than one": a refusal that named only the first
    // problem would send the operator round the fix-one-meet-the-next loop the
    // readout was built to end.
    expect(codesOf(registration)).toEqual([
      'region_deeper_than_lane_budget',
      'region_outside_band',
    ]);
    for (const problem of registration.problems) expect(problem).toMatch(/against/);
  });

  it('names WHICH axis failed, so the operator knows which box to widen', () => {
    // Both arms of a two-axis check: a wall wider than its region on x AND on z.
    const boxed = draft('draft_boxed', {
      perimeter: { ...GARDEN.perimeter, halfX: 200, halfZ: 200 },
    });
    const registration = realmRacersRegisterDraftCircuit(devCtx(), boxed);
    const perimeterProblems = registration.problems.filter((problem) =>
      problem.startsWith('perimeter_outside_region'),
    );
    expect(perimeterProblems).toHaveLength(2);
    expect(
      perimeterProblems.some((problem) => problem.startsWith('perimeter_outside_region (x)')),
    ).toBe(true);
    expect(
      perimeterProblems.some((problem) => problem.startsWith('perimeter_outside_region (z)')),
    ).toBe(true);
  });

  it('refuses an absurd drawing cheaply, BEFORE building a spline out of it', () => {
    // The payload validator admits 256 points anywhere in a 10 000 yard window.
    // Resampled at a yard that is a 40 000 sample lap under a quadratic sweep,
    // which wedges the tab it is being raced from. The pre-flight bound is what
    // stops that, and it is deliberately twice as permissive as the real rule.
    const absurd = draft('draft_absurd', {
      controlPoints: [
        { x: -4800, z: -4800 },
        { x: 4800, z: -4800 },
        { x: 4800, z: 4800 },
        { x: -4800, z: 4800 },
      ],
    });
    const started = Date.now();
    const registration = realmRacersRegisterDraftCircuit(devCtx(), absurd);
    expect(registration.lane).toBe(-1);
    expect(codesOf(registration)).toEqual(['control_points_out_of_bounds']);
    // Refused without measuring anything: the guard is a bounding box walk.
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('lets a merely oversized drawing through to the REAL check, which names it', () => {
    // Inside the cheap guard, outside the rule: the metrics core is what
    // refuses it, so the pre-flight can never mask a real diagnosis.
    const big = draft('draft_big', {
      controlPoints: GARDEN.controlPoints.map((point) => ({ x: point.x * 3, z: point.z * 3 })),
    });
    const registration = realmRacersRegisterDraftCircuit(devCtx(), big);
    expect(registration.lane).toBe(-1);
    expect(codesOf(registration)).not.toContain('control_points_out_of_bounds');
    // A road three times the garden's own size runs straight out through the
    // wall it inherited, which is the metrics core's diagnosis, not the guard's.
    expect(codesOf(registration)).toEqual([
      'road_outside_perimeter (x)',
      'road_outside_perimeter (z)',
    ]);
  });
});

describe('racing a registered draft', () => {
  it('seats a full grid on the draft own lane', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', devCommands: true });
    const record = draft('draft_one');
    const registration = sim.realmRacersRegisterDraftCircuit(record);
    expect(registration.problems).toEqual([]);

    expect(startRealmRacersDevRace(sim, 'draft_one', 'ace', sim.playerId)).toBe(true);
    const match = sim.realmRacers.match;
    expect(match?.circuitId).toBe('draft_one');
    expect(match?.pids).toHaveLength(REALM_RACERS_GRID_SIZE);
    // The lane the registration reported, not lane 0: an authored circuit is
    // standing there.
    expect(match?.origin).toEqual(realmRacersLaneOffset(registration.lane));
    expect(match?.origin.z).toBe(registration.lane * REALM_RACERS_LANE_DZ);
    // And the pilots are actually out there, not back in the Evergarden.
    for (const pid of match?.pids ?? []) {
      const racer = sim.entities.get(pid);
      expect(realmRacersLaneAt(racer?.pos.x ?? 0, racer?.pos.z ?? 0)?.index).toBe(
        registration.lane,
      );
    }
  });

  it('refuses an id nobody registered', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', devCommands: true });
    expect(startRealmRacersDevRace(sim, 'draft_missing', 'ace', sim.playerId)).toBe(false);
    expect(sim.realmRacers.match).toBeNull();
  });

  it('races off the EXACT command string the client glue emits', () => {
    // The two halves of the loop, composed: the client builds this string
    // (`runRealmRacersDraftCommand`) and the sim's own chat router is what has
    // to accept it. Each half was tested against its own idea of the format,
    // which is exactly how a handoff drifts.
    const sim = new Sim({ seed: 9, playerClass: 'warrior', devCommands: true });
    const registration = sim.realmRacersRegisterDraftCircuit(draft('draft_one'));
    expect(registration.problems).toEqual([]);

    sim.chat('/dev rally draft_one rookie');
    expect(sim.realmRacers.match?.circuitId).toBe('draft_one');
    expect(sim.realmRacers.match?.origin).toEqual(realmRacersLaneOffset(registration.lane));
  });
});

describe('the derived caches behind a re-registered draft', () => {
  it('rebuilds the collision wall when the record behind an id changes', () => {
    // The collider set is cached per circuit ID. Without the record-identity
    // guard a redrawn draft keeps the OLD perimeter: an invisible wall standing
    // where the new one is wider, and a drive-through gap where it is narrower.
    const widestSlab = (circuit: RealmRacersCircuit): number =>
      Math.max(
        ...realmRacersColliders(circuit).map((collider) =>
          collider.type === 'obb' ? collider.hw : 0,
        ),
      );

    const narrow = draft('draft_one', { perimeter: { ...GARDEN.perimeter, halfX: 118 } });
    expect(realmRacersRegisterDraftCircuit(devCtx(), narrow).problems).toEqual([]);
    const registeredNarrow = realmRacersCircuitById('draft_one') as RealmRacersCircuit;
    const before = realmRacersColliders(registeredNarrow);
    expect(widestSlab(registeredNarrow)).toBeCloseTo(118 + GARDEN.perimeter.halfThickness, 6);

    const wide = draft('draft_one', { perimeter: { ...GARDEN.perimeter, halfX: 160 } });
    expect(realmRacersRegisterDraftCircuit(devCtx(), wide).problems).toEqual([]);
    const registeredWide = realmRacersCircuitById('draft_one') as RealmRacersCircuit;
    expect(widestSlab(registeredWide)).toBeCloseTo(160 + GARDEN.perimeter.halfThickness, 6);
    expect(realmRacersColliders(registeredWide)).not.toBe(before);
  });

  it('still hands the same set back for an unchanged record', () => {
    // The cache is a cache: only IDENTITY evicts it, so the shipped module
    // singletons hit it exactly as before.
    expect(realmRacersColliders(GARDEN)).toBe(realmRacersColliders(GARDEN));
  });
});
