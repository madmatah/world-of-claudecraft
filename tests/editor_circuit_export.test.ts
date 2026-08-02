// Getting a drawn circuit out of the tool: the pasteable literal, the reader
// that takes one back, and the validator the dev-server save endpoint runs
// before it writes a file named after the payload's own id.
//
// The validator is checked one field at a time on purpose. A single "rejects a
// malformed payload" case passes while every other dimension is unguarded, and
// what the endpoint actually needs is that no single bad field gets through.

import { describe, expect, it } from 'vitest';
import {
  circuitFromTypeScript,
  circuitToTypeScript,
  draftFileContents,
  roundCircuit,
  validateCircuitPayload,
} from '../src/editor/circuit/export_core';
import type { RealmRacersCircuit } from '../src/sim/content/realm_racers_circuits';
import {
  REALM_RACERS_PRACTICE_CIRCUIT as GARDEN,
  REALM_RACERS_CIRCUIT_LIST,
} from '../src/sim/content/realm_racers_circuits';
import { realmRacersCircuitMetrics } from '../src/sim/realm_racers_circuit_metrics';

/** The garden circuit under a draft id, plus an apron ceiling so the optional
 *  field is exercised by the round trip rather than skipped by it. */
const DRAFT: RealmRacersCircuit = {
  ...GARDEN,
  id: 'draft_export_fixture',
  apronBands: [
    { s: 0, maxApron: 15 },
    { s: 0.4, maxApron: 9 },
    { s: 1, maxApron: 15 },
  ],
};

/** The payload the browser posts, as plain JSON. */
const payload = (circuit: RealmRacersCircuit): Record<string, unknown> =>
  JSON.parse(JSON.stringify(circuit));

const withField = (key: string, value: unknown): Record<string, unknown> => ({
  ...payload(DRAFT),
  [key]: value,
});

describe('circuit editor export: the pasteable literal', () => {
  it('round-trips through TypeScript with the record and the metrics intact', () => {
    const parsed = circuitFromTypeScript(circuitToTypeScript(DRAFT));
    expect(parsed).toEqual(roundCircuit(DRAFT));
    if (!parsed) throw new Error('the export did not parse back');
    // The point of the round trip: what gets pasted derives the same circuit.
    const before = realmRacersCircuitMetrics({ ...roundCircuit(DRAFT), id: 'export_before' });
    const after = realmRacersCircuitMetrics({ ...parsed, id: 'export_after' });
    expect(after.lapLength).toBe(before.lapLength);
    expect(after.turningDegrees).toBe(before.turningDegrees);
    expect(after.shoreOverlapYards).toBe(before.shoreOverlapYards);
    expect(after.nearestApproach).toEqual(before.nearestApproach);
  });

  it('round-trips a circuit that authors no apron ceiling', () => {
    const plain = { ...GARDEN, id: 'draft_no_apron' };
    expect(plain.apronBands).toBeUndefined();
    const text = circuitToTypeScript(plain);
    expect(text).not.toContain('apronBands');
    expect(circuitFromTypeScript(text)).toEqual(roundCircuit(plain));
  });

  it('is byte-stable, so two exports of one circuit diff as nothing', () => {
    expect(circuitToTypeScript(DRAFT)).toBe(circuitToTypeScript(DRAFT));
    expect(circuitToTypeScript(DRAFT)).toContain("id: 'draft_export_fixture'");
    expect(circuitToTypeScript(DRAFT)).toContain('const DRAFT_EXPORT_FIXTURE: RealmRacersCircuit');
  });

  it('rounds the live record to exactly what it exports', () => {
    // An editor measuring more precision than it can paste would render a
    // readout of a circuit nobody can reproduce.
    const messy: RealmRacersCircuit = {
      ...GARDEN,
      id: 'draft_rounding',
      controlPoints: GARDEN.controlPoints.map((p) => ({ x: p.x + 0.04999, z: p.z - 0.04999 })),
    };
    const rounded = roundCircuit(messy);
    expect(rounded.controlPoints[0].x).toBe(GARDEN.controlPoints[0].x);
    expect(roundCircuit(rounded)).toEqual(rounded);
  });

  it('reads nothing out of text that is not a record', () => {
    expect(circuitFromTypeScript('')).toBeNull();
    expect(circuitFromTypeScript('const X = 3;')).toBeNull();
    expect(circuitFromTypeScript('{ id: "nope" }')).toBeNull();
  });

  it('writes a draft file that says what it is and is not the curated module', () => {
    const contents = draftFileContents(DRAFT);
    expect(contents).toContain('Scratch only');
    expect(contents).toContain('draft_export_fixture');
    expect(contents).toContain('const DRAFT_EXPORT_FIXTURE: RealmRacersCircuit');
    expect(circuitFromTypeScript(contents)).toEqual(roundCircuit(DRAFT));
  });
});

describe('circuit editor export: the save endpoint validator', () => {
  it('accepts every shipped circuit', () => {
    for (const circuit of REALM_RACERS_CIRCUIT_LIST) {
      expect(validateCircuitPayload(payload(circuit)), circuit.id).toEqual(circuit);
    }
  });

  it.each([
    ['nothing at all', undefined],
    ['a string', 'circuit'],
    ['an array', []],
  ])('rejects %s', (_label, raw) => {
    expect(validateCircuitPayload(raw)).toBeNull();
  });

  it.each([
    // The id names the file the endpoint writes, so it is the one field where a
    // miss is a path, not a bad record.
    ['id: a traversal', 'id', '../../../etc/passwd'],
    ['id: a separator', 'id', 'draft/one'],
    ['id: uppercase', 'id', 'Draft'],
    ['id: too short', 'id', 'ab'],
    ['id: not a string', 'id', 12],
    ['musicTrack: a path', 'musicTrack', '../music'],
    [
      'controlPoints: too few',
      'controlPoints',
      [
        { x: 0, z: 0 },
        { x: 1, z: 1 },
      ],
    ],
    [
      'controlPoints: not finite',
      'controlPoints',
      [
        { x: 0, z: 0 },
        { x: 1, z: 1 },
        { x: Number.NaN, z: 0 },
      ],
    ],
    [
      'controlPoints: off the map',
      'controlPoints',
      [
        { x: 0, z: 0 },
        { x: 1, z: 1 },
        { x: 1e9, z: 0 },
      ],
    ],
    [
      'widthBands: unsorted',
      'widthBands',
      [
        { s: 0, halfWidth: 10 },
        { s: 0.5, halfWidth: 10 },
        { s: 0.2, halfWidth: 10 },
        { s: 1, halfWidth: 10 },
      ],
    ],
    [
      'widthBands: not spanning the lap',
      'widthBands',
      [
        { s: 0.1, halfWidth: 10 },
        { s: 0.9, halfWidth: 10 },
      ],
    ],
    [
      'widthBands: a negative width',
      'widthBands',
      [
        { s: 0, halfWidth: -10 },
        { s: 1, halfWidth: 10 },
      ],
    ],
    [
      'apronBands: unsorted',
      'apronBands',
      [
        { s: 0, maxApron: 10 },
        { s: 0.5, maxApron: 8 },
        { s: 0.2, maxApron: 8 },
        { s: 1, maxApron: 10 },
      ],
    ],
    [
      'apronBands: a zero ceiling',
      'apronBands',
      [
        { s: 0, maxApron: 0 },
        { s: 1, maxApron: 0 },
      ],
    ],
    ['laps: fractional', 'laps', 2.5],
    ['laps: zero', 'laps', 0],
    ['practiceCopies: negative', 'practiceCopies', -1],
    ['timeLimitSeconds: absurd', 'timeLimitSeconds', 999_999],
    ['regionHalfX: not a number', 'regionHalfX', 'wide'],
    ['startSpacing: zero', 'startSpacing', 0],
    ['perimeter: missing', 'perimeter', undefined],
    [
      'perimeter: a bad member',
      'perimeter',
      { halfX: 118, halfZ: 92, halfThickness: 0, height: 2.2 },
    ],
    ['basin: a bad member', 'basin', { waterY: -0.55, bankSlope: 0, depthMax: 6, wadeYards: 4 }],
    ['roles: empty', 'roles', []],
    ['roles: unknown', 'roles', ['spectator']],
    ['roles: repeated', 'roles', ['practice', 'practice']],
  ])('rejects %s', (_label, key, value) => {
    expect(validateCircuitPayload(withField(key, value))).toBeNull();
  });

  it('drops fields it does not know rather than passing them through', () => {
    const validated = validateCircuitPayload({ ...payload(DRAFT), nastiness: '<script>' });
    expect(validated).toEqual(roundCircuit(DRAFT));
    expect(validated && 'nastiness' in validated).toBe(false);
  });
});
