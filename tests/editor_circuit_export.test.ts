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

/** The garden circuit under a draft id. It carries the two pools and the
 *  fountain it ships with, so the dressing rides the round trip rather than
 *  being skipped by it. */
const DRAFT: RealmRacersCircuit = {
  ...GARDEN,
  id: 'draft_export_fixture',
};

/** A circuit with no water at all: no pond and no basin. The round trip has to
 *  carry the ABSENCE of a field as carefully as its presence. */
const DRY: RealmRacersCircuit = {
  ...GARDEN,
  id: 'draft_export_dry',
  ponds: undefined,
  basin: undefined,
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
    expect(after.nearestApproach).toEqual(before.nearestApproach);
  });

  it('carries the theme, including one no shipped circuit wears', () => {
    // The tool is how a themed circuit gets authored at all, so the field has
    // to survive both directions. An id the registry does not know is carried
    // rather than refused on purpose: the readout is what calls it out
    // (`unknown_theme`), and a theme being written in the same change is not in
    // the list yet.
    const themed: RealmRacersCircuit = {
      ...DRAFT,
      id: 'draft_export_themed',
      theme: 'galecrest',
    };
    expect(circuitToTypeScript(themed)).toContain("theme: 'galecrest',");
    expect(circuitFromTypeScript(circuitToTypeScript(themed))?.theme).toBe('galecrest');
    expect(validateCircuitPayload(payload(themed))?.theme).toBe('galecrest');
    const unknown: RealmRacersCircuit = { ...themed, theme: 'frostveil' };
    expect(validateCircuitPayload(payload(unknown))?.theme).toBe('frostveil');
  });

  it('round-trips a dry circuit, carrying the ABSENCE of a basin', () => {
    const text = circuitToTypeScript(DRY);
    expect(text).not.toContain('basin:');
    expect(text).not.toContain('ponds:');
    const parsed = circuitFromTypeScript(text);
    expect(parsed).toEqual(roundCircuit(DRY));
    expect(parsed?.basin).toBeUndefined();
    // ...and the same record makes it through the save endpoint's validator,
    // which is the other half of "a circuit with zero water is authorable".
    expect(validateCircuitPayload(payload(DRY))).toEqual(roundCircuit(DRY));
  });

  it('carries the authored dressing through both directions', () => {
    // The one authorable placement a circuit used to have was dropped by the
    // validator once, and that was a live divergence rather than a missing
    // niceness: the editor's 3D preview builds the record it holds while a
    // draft raced in game arrives through the validator, so the two views of
    // one circuit disagreed about the island in the lake. The dressing is a
    // whole document of such placements now, so all three fields ride together.
    const dressed: RealmRacersCircuit = {
      ...DRAFT,
      id: 'draft_dressed_fixture',
      props: [
        { asset: 'fountain', at: { x: -4, z: 4 }, scale: 2.2, collide: 'none' },
        { asset: 'bench', at: { s: 0.25, offset: 28.5 }, yaw: 'tangent' },
        {
          asset: 'gardenIronFence',
          at: { s: 0.8, offset: -30 },
          yaw: 1.25,
          collide: { kind: 'obb', hw: 2, hd: 0.25, rot: 1.25 },
        },
      ],
      scatters: [
        { asset: 'shrub', zone: 'outfield', spacing: 9, seed: 41 },
        { asset: 'bedRound', zone: 'infield', span: { s0: 0.9, s1: 0.1 }, spacing: 12, seed: 7 },
      ],
      ponds: [{ x: 20, z: -10, rx: 18, rz: 11, rot: 0.4, wobble: 0.2, seed: 3 }],
    };
    const text = circuitToTypeScript(dressed);
    expect(text).toContain("asset: 'fountain'");
    expect(text).toContain("yaw: 'tangent'");
    expect(text).toContain("kind: 'obb'");
    expect(text).toContain('ponds: [');
    expect(circuitFromTypeScript(text)).toEqual(roundCircuit(dressed));
    expect(validateCircuitPayload(payload(dressed))).toEqual(roundCircuit(dressed));

    // A circuit that dresses nothing carries nothing, and gains nothing.
    const bare = { ...DRAFT, id: 'draft_bare_fixture', props: undefined };
    expect(circuitToTypeScript(bare)).not.toContain('props: [');
    expect(validateCircuitPayload(payload(bare))?.props).toBeUndefined();
  });

  it('carries the authored BARRIERS through both directions', () => {
    // Same rule as the dressing above, and the same failure it exists to
    // prevent: a field the validator silently drops makes the editor's preview
    // draw an enclosure the raced draft does not have.
    const walled: RealmRacersCircuit = {
      ...DRAFT,
      id: 'draft_walled_fixture',
      fences: [
        {
          kit: 'ironwork',
          points: [
            { x: -60, z: -40 },
            { x: -60, z: 40 },
          ],
        },
        {
          kit: 'hedge',
          points: [
            { x: 60, z: -40 },
            { x: 80, z: -40 },
            { x: 80, z: 40 },
          ],
          closed: true,
          scale: 1.5,
        },
      ],
    };
    const text = circuitToTypeScript(walled);
    expect(text).toContain("kit: 'ironwork'");
    expect(text).toContain('closed: true');
    expect(text).toContain('scale: 1.5');
    expect(circuitFromTypeScript(text)).toEqual(roundCircuit(walled));
    expect(validateCircuitPayload(payload(walled))).toEqual(roundCircuit(walled));

    const bare = { ...DRAFT, id: 'draft_unwalled_fixture', fences: undefined };
    expect(circuitToTypeScript(bare)).not.toContain('fences: [');
    expect(validateCircuitPayload(payload(bare))?.fences).toBeUndefined();
  });

  it('carries the authored GROUND SHAPE through both directions', () => {
    // The third field with this rule, and it is the one with the most to lose by
    // being dropped: the outline decides where the land STOPS, so a validator
    // that swallowed it would race a draft whose road runs over open water while
    // the editor's own preview showed an island.
    const island: RealmRacersCircuit = {
      ...DRAFT,
      id: 'draft_island_fixture',
      groundOutline: [
        { x: -120, z: -90 },
        { x: 0, z: -110 },
        { x: 120, z: -90 },
        { x: 140, z: 0 },
        { x: 120, z: 90 },
        { x: 0, z: 110 },
        { x: -120, z: 90 },
        { x: -140, z: 0 },
      ],
    };
    const text = circuitToTypeScript(island);
    expect(text).toContain('groundOutline: [');
    expect(text).toContain('{ x: -120, z: -90 }');
    expect(circuitFromTypeScript(text)).toEqual(roundCircuit(island));
    expect(validateCircuitPayload(payload(island))).toEqual(roundCircuit(island));

    const bare = { ...DRAFT, id: 'draft_no_island_fixture', groundOutline: undefined };
    expect(circuitToTypeScript(bare)).not.toContain('groundOutline: [');
    expect(validateCircuitPayload(payload(bare))?.groundOutline).toBeUndefined();
  });

  it('refuses a ground shape that is not a closed ring of real points', () => {
    const base = { ...DRAFT, id: 'draft_bad_ground' };
    const withOutline = (groundOutline: unknown) =>
      validateCircuitPayload(payload({ ...base, groundOutline } as RealmRacersCircuit));
    expect(
      withOutline([
        { x: -10, z: -10 },
        { x: 10, z: -10 },
        { x: 0, z: 10 },
      ]),
    ).not.toBeNull();
    // Two points enclose nothing, which is the same floor the control ring keeps.
    expect(
      withOutline([
        { x: 0, z: 0 },
        { x: 10, z: 0 },
      ]),
    ).toBeNull();
    expect(withOutline('an island')).toBeNull();
    // Both axes and a non-finite, one case each: the reader guards x and z in
    // one `||`, so an arm tested on one side only is an arm nobody tested.
    expect(
      withOutline([
        { x: 0, z: 0 },
        { x: 10, z: 0 },
        { x: 0, z: 1e9 },
      ]),
    ).toBeNull();
    expect(
      withOutline([
        { x: 0, z: 0 },
        { x: 1e9, z: 0 },
        { x: 0, z: 10 },
      ]),
    ).toBeNull();
    expect(
      withOutline([
        { x: 0, z: 0 },
        { x: Number.NaN, z: 0 },
        { x: 0, z: 10 },
      ]),
    ).toBeNull();
  });

  it('refuses a barrier the game could not build, one field at a time', () => {
    const base = { ...DRAFT, id: 'draft_bad_fence' };
    const withFence = (fence: unknown) =>
      validateCircuitPayload(payload({ ...base, fences: [fence] } as RealmRacersCircuit));
    const good = {
      kit: 'ironwork',
      points: [
        { x: 0, z: 0 },
        { x: 10, z: 0 },
      ],
    };
    expect(withFence(good)).not.toBeNull();
    // A kit the sim has no dimensions for: the tool must not bless a barrier the
    // game cannot give a collider.
    expect(withFence({ ...good, kit: 'nothingAuthorsThis' })).toBeNull();
    // One point is not a run, and an entry with none is a record every consumer
    // would have to special-case.
    expect(withFence({ ...good, points: [{ x: 0, z: 0 }] })).toBeNull();
    expect(
      withFence({
        ...good,
        points: [
          { x: 0, z: 1e9 },
          { x: 1, z: 0 },
        ],
      }),
    ).toBeNull();
    expect(withFence({ ...good, closed: 'yes' })).toBeNull();
    expect(withFence({ ...good, scale: 0 })).toBeNull();
    expect(withFence({ ...good, scale: 99 })).toBeNull();
  });

  it('refuses a prop the game could not place, and a pond with no bank to shade it', () => {
    // The tool cannot bless a key the sim has no footprint for: the collision
    // default has to come from the catalog the GAME reads, or the two disagree
    // about what is standing on the circuit.
    const unknown = {
      ...DRAFT,
      id: 'draft_unknown_asset',
      props: [{ asset: 'not_a_prop', at: { x: 0, z: 0 } }],
    };
    expect(validateCircuitPayload(payload(unknown))).toBeNull();

    // Membership must be an OWN key of the catalog: a prototype-chain name is
    // not a prop the game has dimensions for, however truthy `key in table` is.
    for (const ghost of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
      const ghostProp = {
        ...DRAFT,
        id: 'draft_proto_asset',
        props: [{ asset: ghost, at: { x: 0, z: 0 } }],
      };
      expect(validateCircuitPayload(payload(ghostProp)), `prop asset ${ghost}`).toBeNull();
      const ghostScatter = {
        ...DRAFT,
        id: 'draft_proto_scatter',
        scatters: [{ asset: ghost, zone: 'outfield' as const, spacing: 9, seed: 1 }],
      };
      expect(validateCircuitPayload(payload(ghostScatter)), `scatter asset ${ghost}`).toBeNull();
    }

    // A placed pond is water, so the basin IFF covers it exactly as it covers a
    // water span: a pond with no bank profile is water made of nothing.
    const pondNoBasin = {
      ...DRY,
      id: 'draft_pond_no_basin',
      ponds: [{ x: 0, z: 0, rx: 10, rz: 8 }],
    };
    expect(validateCircuitPayload(payload(pondNoBasin))).toBeNull();
    expect(validateCircuitPayload(payload({ ...pondNoBasin, basin: GARDEN.basin }))).not.toBeNull();
  });

  it('round-trips a circuit that authors no dressing at all', () => {
    const plain = {
      ...GARDEN,
      id: 'draft_bare',
      props: undefined,
      ponds: undefined,
      basin: undefined,
    };
    const text = circuitToTypeScript(plain);
    expect(text).not.toContain('props');
    expect(text).not.toContain('ponds');
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
    ['theme: a path', 'theme', '../evergarden'],
    ['theme: not a string', 'theme', 3],
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
    ['ponds: a radius of zero', 'ponds', [{ x: 0, z: 0, rx: 0, rz: 8 }]],
    [
      'ponds: a wobble past what an outline can take',
      'ponds',
      [{ x: 0, z: 0, rx: 8, rz: 8, wobble: 0.9 }],
    ],
    ['ponds: a centre off the band', 'ponds', [{ x: 99_999, z: 0, rx: 8, rz: 8 }]],
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
    ['basin: a bad member', 'basin', { waterY: -0.55, bankSlope: 0, depthMax: 6 }],
    ['roles: empty', 'roles', []],
    ['roles: unknown', 'roles', ['spectator']],
    ['roles: repeated', 'roles', ['practice', 'practice']],
  ])('rejects %s', (_label, key, value) => {
    expect(validateCircuitPayload(withField(key, value))).toBeNull();
  });

  it('refuses a water span on a payload that carries no basin', () => {
    // The one cross-field rule the record has: a pond is MADE of water. A
    // payload with neither is a lake circuit that forgot its lake, and the
    // absent table means a whole lap of water, so it is refused too.
    expect(validateCircuitPayload({ ...payload(DRAFT), basin: undefined })).toBeNull();
    expect(validateCircuitPayload({ ...payload(GARDEN), basin: undefined })).toBeNull();
    // ...while every span dry and no basin is a circuit the game can drive.
    expect(validateCircuitPayload(payload(DRY))).not.toBeNull();
  });

  it('refuses a vestigial basin on a payload with no water left', () => {
    // The other half of the same iff, and the one a paint session reaches: an
    // all-dry record still carrying the lake it used to have validates, saves
    // and re-exports as a `basin:` literal that says this circuit has water.
    expect(validateCircuitPayload({ ...payload(DRY), basin: payload(GARDEN).basin })).toBeNull();
    // ...and the record the editor's own paint produces has none, so the rule
    // is one the tool can actually satisfy.
    expect(DRY.basin).toBeUndefined();
    expect(validateCircuitPayload(payload(DRY))?.basin).toBeUndefined();
  });

  it('drops fields it does not know rather than passing them through', () => {
    const validated = validateCircuitPayload({ ...payload(DRAFT), nastiness: '<script>' });
    expect(validated).toEqual(roundCircuit(DRAFT));
    expect(validated && 'nastiness' in validated).toBe(false);
  });
});
