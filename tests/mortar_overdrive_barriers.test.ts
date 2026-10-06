// The barrier kits and what an authored fence resolves to.
//
// Two halves are pinned here, and the seam between them is the point: the SIM
// catalog carries what a collider needs and the RENDER catalog carries what a
// draw needs, and a key only one of them knows is a barrier that either draws
// with no collision or collides with nothing to see.

import { describe, expect, it } from 'vitest';
import {
  MORTAR_OVERDRIVE_BARRIER_ASSET_URLS,
  MORTAR_OVERDRIVE_BARRIER_VISUALS,
  mortarOverdriveBarrierKitUrls,
} from '../src/render/mortar_overdrive/barrier_visuals';
import { mortarOverdriveDressingRoute } from '../src/render/mortar_overdrive/dressing_material';
import { CIRCUIT_THEMES } from '../src/render/mortar_overdrive/themes';
import { mortarOverdriveFencePieces } from '../src/render/mortar_overdrive/track_core';
import {
  MORTAR_OVERDRIVE_BARRIER_KEYS,
  MORTAR_OVERDRIVE_BARRIERS,
  mortarOverdriveBarrierDef,
} from '../src/sim/content/mortar_overdrive/barriers';
import type {
  MortarOverdriveCircuit,
  MortarOverdriveFence,
} from '../src/sim/content/mortar_overdrive/circuits';
import {
  MORTAR_OVERDRIVE_CIRCUIT_LIST,
  MORTAR_OVERDRIVE_PRACTICE_CIRCUIT,
} from '../src/sim/content/mortar_overdrive/circuits';
import { DUNGEON_FLOOR_Y } from '../src/sim/data';
import { mortarOverdriveColliders } from '../src/sim/mortar_overdrive/colliders';
import {
  mortarOverdriveFencePlacements,
  mortarOverdriveFenceRunSamples,
  mortarOverdriveFenceRuns,
} from '../src/sim/mortar_overdrive/fences';
import { MORTAR_OVERDRIVE_ORIGIN } from '../src/sim/mortar_overdrive/layout';
import { glbBinarySha1, glbBounds, glbSize } from './helpers/glb_bounds';

let fixtureSeq = 0;

/** A circuit carrying exactly the fences handed in, and nothing else placed. */
function withFences(fences: readonly MortarOverdriveFence[]): MortarOverdriveCircuit {
  fixtureSeq += 1;
  return {
    ...MORTAR_OVERDRIVE_PRACTICE_CIRCUIT,
    // A genuinely fresh id per call, because every derived geometry on a circuit
    // is memoized by id AND record identity. A shape-derived id was NOT fresh:
    // every two-point single-fence circuit in this file shared one, and only the
    // identity half of the guard was keeping the answers apart.
    id: `barrier_fixture_${fixtureSeq}`,
    props: undefined,
    scatters: undefined,
    ponds: undefined,
    basin: undefined,
    pickupRows: undefined,
    fences,
  };
}

describe('the barrier kit catalog', () => {
  it('is keyed identically on both sides, in both directions', () => {
    for (const kit of Object.keys(MORTAR_OVERDRIVE_BARRIERS)) {
      expect(MORTAR_OVERDRIVE_BARRIER_VISUALS[kit], `${kit} has no visual`).toBeDefined();
    }
    for (const kit of Object.keys(MORTAR_OVERDRIVE_BARRIER_VISUALS)) {
      expect(MORTAR_OVERDRIVE_BARRIERS[kit], `${kit} has no footprint`).toBeDefined();
    }
    expect(MORTAR_OVERDRIVE_BARRIER_KEYS.length).toBeGreaterThan(10);
  });

  it('measures every kit against the shipped GLB, at the scale it is drawn', () => {
    // The catalog's own stated convention, and the one an eye cannot check: the
    // numbers are the model TIMES the visual's scale, not the model at scale 1.
    // Height is the top above the model's own ORIGIN, which differs from its
    // full extent for a module authored partly underground (the mountain wall
    // sinks a yard), and a half thickness is trimmed DOWN and never up.
    for (const [kit, def] of Object.entries(MORTAR_OVERDRIVE_BARRIERS)) {
      const visual = MORTAR_OVERDRIVE_BARRIER_VISUALS[kit];
      const size = glbSize(visual.panelUrl);
      // The thickness axis is whichever one the run does NOT lie along.
      const thickness = visual.lengthAxis === 'x' ? size.z : size.x;
      const drawnHalf = (thickness * visual.scale) / 2;
      expect(
        def.halfThickness,
        `${kit} half thickness is trimmed down, never up`,
      ).toBeLessThanOrEqual(drawnHalf + 1e-6);
      expect(def.halfThickness, `${kit} half thickness is close to the model`).toBeGreaterThan(
        drawnHalf - 0.011,
      );
      // HEIGHT is the model's top ABOVE ITS OWN ORIGIN times the scale, which is
      // NOT its full extent for a module authored partly underground: the
      // mountain wall sinks a yard, so it stands 1.81 rather than the 3.61 its
      // own extent would claim. Without this line the whole convention the
      // catalog header argues for is unpinned, and re-authoring that kit at 3.6
      // passes every other case in this file.
      expect(def.height, `${kit} height is the top above its own origin`).toBeCloseTo(
        glbBounds(visual.panelUrl).max.y * visual.scale,
        2,
      );
      // The run one module covers has to match the model too, or panels gap.
      const along = visual.lengthAxis === 'x' ? size.x : size.z;
      expect(visual.panelYards, `${kit} panel run`).toBeGreaterThan(0);
      expect(visual.panelYards, `${kit} panel run is at most the module's own`).toBeLessThanOrEqual(
        along * visual.scale + 0.01,
      );
    }
  });

  it.each(Object.keys(MORTAR_OVERDRIVE_BARRIER_VISUALS))(
    '%s lays its module ALONG the run, on the axis the GLB actually runs on',
    (kit) => {
      // Moved here from the theme suite, which is where it was paid for: the
      // defect was visible from the grid, the Galecrest wall's every stone
      // module standing broadside to the wall it was meant to be, because the
      // yaw was the ironwork's and that kit runs along a different local axis.
      //
      // The axis is MEASURED off the shipped GLB rather than read off the
      // record, which is the whole difference between a test and a
      // restatement: the first version of this took `lengthAxis` from the
      // record and then checked a yaw derived from `lengthAxis`, so it passed
      // with the field set wrong.
      const visual = MORTAR_OVERDRIVE_BARRIER_VISUALS[kit];
      const size = glbSize(visual.panelUrl);
      expect(
        Math.max(size.x, size.z) / Math.min(size.x, size.z),
        `${kit} is not a run`,
      ).toBeGreaterThan(2);
      const measured = size.x >= size.z ? 'x' : 'z';
      expect(visual.lengthAxis, `${kit}`).toBe(measured);

      // ...and the RUN is measured too. `panelYards` is how far the builder
      // steps between modules, so it has to be what one module actually covers
      // at this kit's scale: step further and the run gaps all the way along,
      // step much shorter and it stacks into itself.
      //
      // Bounded rather than exact, and asymmetrically, because the slack has a
      // direction: an UNDERCUT overlaps neighbours slightly and is invisible,
      // while an overshoot is a hole. The floor admits the ironwork's own
      // deliberate 12.5 percent undercut (3.5 authored on a 4 yard module),
      // which is the widest any kit takes. The ceiling carries one centimetre,
      // which is not slop but the grain the numbers are authored at.
      const run = size[measured] * visual.scale;
      expect(visual.panelYards, `${kit} overshoots its module`).toBeLessThanOrEqual(run + 0.01);
      expect(visual.panelYards, `${kit} undercuts too far`).toBeGreaterThan(run * 0.85);

      // The CORNER piece has to survive the same seating, and it gets no axis
      // of its own to be measured against: it is centred on the joint under one
      // yaw. So the only module that can be right there is one whose mass is
      // centred on its own origin.
      //
      // An L is the shape this refuses, and it is not hypothetical: two castle
      // kit corner modules (`kcas_barrier_corner`, `kcas_wall_corner`) reach to
      // -2.00 on their local x and +2.00 on their local z, so seated this way
      // one arm stands off the line while the run leaving the joint goes
      // uncapped. Both were authored into the registry this replaced and both
      // had to come back out. Measured rather than listed by name, so the next
      // kit that happens to be an L fails the same way.
      if (visual.corner === 'none') return;
      const corner = glbBounds(visual.corner.url);
      for (const axis of ['x', 'z'] as const) {
        const reach = [Math.abs(corner.min[axis]), Math.abs(corner.max[axis])];
        expect(
          Math.max(...reach) / Math.max(Math.min(...reach), 1e-6),
          `${kit} corner piece is lopsided on ${axis}`,
        ).toBeLessThan(2);
      }
    },
  );

  it('cuts a run into fewer panels when the module is longer', () => {
    // The other half of `panelYards` meaning anything: the same ground, cut by
    // a longer module, is fewer and bigger pieces. Moved from the theme suite,
    // where it compared two walls around one rectangle.
    const points = [
      { x: -60, z: -40 },
      { x: -60, z: 40 },
    ];
    const panelsFor = (kit: string): number =>
      mortarOverdriveFencePieces(withFences([{ kit, points }]))[0].panels.length;
    const ironwork = panelsFor('ironwork');
    for (const [kit, visual] of Object.entries(MORTAR_OVERDRIVE_BARRIER_VISUALS)) {
      if (visual.panelYards <= MORTAR_OVERDRIVE_BARRIER_VISUALS.ironwork.panelYards) continue;
      expect(panelsFor(kit), `${kit} against the ironwork`).toBeLessThan(ironwork);
    }
  });

  it('never uses a kitPANEL as its own corner piece', () => {
    // The defect the first seat test of this feature found, on nine kits at
    // once. A corner piece is seated centred on the joint under one yaw, so a
    // WALL module put there lies diagonally across the corner and sticks out
    // both ways; what belongs there is a module SHAPED like a joint (a pillar, a
    // post) or nothing at all, in which case the runs overlap instead.
    //
    // It hid in the registry this replaced because a derived RECTANGLE only ever
    // has 90 degree corners inside a uniform box: ten of the fourteen themes put
    // the same url in `fenceUrl` and `pillarUrl` and nobody saw it. An authored
    // run turns wherever the operator drew it, so it is immediate.
    for (const [kit, visual] of Object.entries(MORTAR_OVERDRIVE_BARRIER_VISUALS)) {
      if (visual.corner === 'none') continue;
      // Compared by GEOMETRY, not by url, for the reason the duplicate-model
      // guard below exists: this tree ships one asset under two filenames, so a
      // corner authored as a byte-identical twin of its own panel is the same
      // defect wearing a different path.
      expect(glbBinarySha1(visual.corner.url), `${kit} corners itself with its own panel`).not.toBe(
        glbBinarySha1(visual.panelUrl),
      );
    }
    // Not vacuous: some kit still HAS a corner piece, or the rule above is a
    // rule about an empty set.
    expect(
      Object.values(MORTAR_OVERDRIVE_BARRIER_VISUALS).filter((visual) => visual.corner !== 'none')
        .length,
    ).toBeGreaterThan(0);
  });

  it('draws one kit per model, so no two kits are the same wall twice', () => {
    // Three kits drew ONE model when this shipped: the world carries
    // `hex_wall.glb` and `hexn_palisade.glb` as separate files whose binary
    // chunks are byte for byte identical, and the registry described them as a
    // town wall and a log palisade, so `stoneWall`, `palisade` and `stockade`
    // were one wall at three scales. A scale is a field on the RECORD, so two
    // kits differing only by it are not two kits.
    //
    // Compared by the GLB's own binary chunk rather than by url, which is what
    // catches the duplicate-file case a url comparison cannot see.
    const seen = new Map<string, string>();
    for (const [kit, visual] of Object.entries(MORTAR_OVERDRIVE_BARRIER_VISUALS)) {
      const fingerprint = glbBinarySha1(visual.panelUrl);
      const held = seen.get(fingerprint);
      expect(held, `${kit} draws the same model as ${held}`).toBeUndefined();
      seen.set(fingerprint, kit);
    }
  });

  it('exposes every kit url to the disk and manifest guards', () => {
    for (const visual of Object.values(MORTAR_OVERDRIVE_BARRIER_VISUALS)) {
      expect(MORTAR_OVERDRIVE_BARRIER_ASSET_URLS).toContain(visual.panelUrl);
      if (visual.corner !== 'none') {
        expect(MORTAR_OVERDRIVE_BARRIER_ASSET_URLS).toContain(visual.corner.url);
      }
    }
  });

  it('scopes the race-time barrier fetch to the kits the circuits author', () => {
    // A circuit build fetches the kits its record authors and nothing else: it
    // must never widen to "everything the catalog could offer", which would pin
    // a parsed scene per kit on a map that never clears.
    //
    // Derived from the shipped RECORDS rather than pinned to a list: the first
    // circuit to author a hedge must not need a test edit.
    const worn = new Set(
      MORTAR_OVERDRIVE_CIRCUIT_LIST.flatMap((circuit) => circuit.fences ?? []).map(
        (fence) => fence.kit,
      ),
    );
    const fetched = mortarOverdriveBarrierKitUrls(MORTAR_OVERDRIVE_CIRCUIT_LIST);
    expect([...fetched].sort()).toEqual(
      [
        ...new Set(
          [...worn].flatMap((kit) => {
            const visual = MORTAR_OVERDRIVE_BARRIER_VISUALS[kit];
            expect(visual, `${kit} should be a real kit`).toBeDefined();
            // A kit drawn from the world's templates is never fetched (the case
            // below), which the Drakelands Rampart Run's two kits are.
            if (visual.worldTemplate) return [];
            return visual.corner === 'none'
              ? [visual.panelUrl]
              : [visual.panelUrl, visual.corner.url];
          }),
        ),
      ].sort(),
    );
    // ...and the scoping bought something: the fetch is strictly smaller than
    // the catalog it is scoped from. Holds until every kit is worn somewhere,
    // and on that day it is correct that it bought nothing.
    expect(fetched.length).toBeLessThan(MORTAR_OVERDRIVE_BARRIER_ASSET_URLS.length);
  });

  it('flags exactly the kits the dressing draws from the world templates', () => {
    // The race-time fetch reads the flag rather than the route, so the barrier
    // catalog stays Three-free; this is what keeps the two from disagreeing.
    let flagged = 0;
    for (const [kit, visual] of Object.entries(MORTAR_OVERDRIVE_BARRIER_VISUALS)) {
      const urls = [visual.panelUrl, ...(visual.corner === 'none' ? [] : [visual.corner.url])];
      for (const url of urls) {
        expect(mortarOverdriveDressingRoute(url) === 'worldKit', `${kit} ${url}`).toBe(
          visual.worldTemplate === true,
        );
      }
      if (visual.worldTemplate) flagged++;
    }
    expect(flagged).toBe(2);
  });

  it('never fetches a kit drawn from the world templates, whoever authors it', () => {
    // The fortress wall and its tower caps are the world's own env-prop
    // templates, resident from world entry; a parse of their files would be a
    // second copy nothing draws. A plain kit on the same record is still
    // fetched, which is what keeps this from passing on an empty list.
    const run = (kit: string): MortarOverdriveFence => ({
      kit,
      points: [
        { x: -60, z: -40 },
        { x: -60, z: 40 },
      ],
    });
    const circuit: MortarOverdriveCircuit = {
      ...MORTAR_OVERDRIVE_CIRCUIT_LIST[0],
      id: 'barrier_boot_probe',
      fences: [run('fortressWall'), run('keepFence'), run('ironwork')],
    };
    const lane = mortarOverdriveBarrierKitUrls([circuit]);
    const fortress = MORTAR_OVERDRIVE_BARRIER_VISUALS.fortressWall;
    expect(fortress.corner).not.toBe('none');
    const kitUrls = [
      fortress.panelUrl,
      fortress.corner === 'none' ? '' : fortress.corner.url,
      MORTAR_OVERDRIVE_BARRIER_VISUALS.keepFence.panelUrl,
    ];
    for (const url of kitUrls) expect(lane, url).not.toContain(url);
    expect(lane).toContain(MORTAR_OVERDRIVE_BARRIER_VISUALS.ironwork.panelUrl);
    // And on the shipped pool, where a circuit really does author both kits:
    // racing it never fetches them.
    const worn = new Set(
      MORTAR_OVERDRIVE_CIRCUIT_LIST.flatMap((c) => c.fences ?? []).map((fence) => fence.kit),
    );
    expect(worn.has('fortressWall') && worn.has('keepFence')).toBe(true);
    const fetched = mortarOverdriveBarrierKitUrls(MORTAR_OVERDRIVE_CIRCUIT_LIST);
    for (const url of kitUrls) expect(fetched, url).not.toContain(url);
  });

  it('gives every theme a vocabulary of real kits', () => {
    for (const [id, theme] of Object.entries(CIRCUIT_THEMES)) {
      expect(theme.barriers.length, `${id} offers kits`).toBeGreaterThan(0);
      for (const kit of theme.barriers) {
        expect(mortarOverdriveBarrierDef(kit), `${id} offers ${kit}`).toBeDefined();
      }
    }
  });
});

describe('resolving an authored fence', () => {
  it('lays ONE collider per straight run, whatever its length', () => {
    const circuit = withFences([
      {
        kit: 'ironwork',
        points: [
          { x: -40, z: -40 },
          { x: 40, z: -40 },
        ],
      },
    ]);
    const runs = mortarOverdriveFenceRuns(circuit);
    expect(runs).toHaveLength(1);
    expect(runs[0].run.length).toBeCloseTo(80, 6);
    expect(runs[0].height).toBeCloseTo(MORTAR_OVERDRIVE_BARRIERS.ironwork.height, 6);
    // A run 80 yards long that cost 80 colliders would be a barrier paying for
    // its own art. Against the circuit's own baseline, which is the four
    // perimeter slabs plus whatever it authors.
    const bare = mortarOverdriveColliders(withFences([]));
    expect(mortarOverdriveColliders(circuit)).toHaveLength(bare.length + 1);
  });

  it('hands the collision set the run box, with the kit height as the camera top', () => {
    // Only the COUNT was pinned, so `hw`/`hd` swapped, a lost `rot`, or a missing
    // `cameraTopY` all passed. `cameraTopY` is why the sim catalog carries a
    // height at all: without it the chase camera is pulled inside the barrier
    // instead of riding over it.
    const circuit = withFences([
      {
        kit: 'ironwork',
        points: [
          { x: -30, z: 12 },
          { x: 30, z: 12 },
        ],
      },
    ]);
    const bare = mortarOverdriveColliders(withFences([]));
    const built = mortarOverdriveColliders(circuit);
    expect(built).toHaveLength(bare.length + 1);
    // Appended AFTER the four derived perimeter slabs and before any solid
    // prop, which this fixture places none of.
    const added = built[bare.length];
    const [{ run }] = mortarOverdriveFenceRuns(circuit);
    expect(added).toEqual({
      type: 'obb',
      x: run.x,
      z: run.z,
      hw: run.hw,
      hd: run.hd,
      rot: run.rot,
      cameraTopY: DUNGEON_FLOOR_Y + MORTAR_OVERDRIVE_BARRIERS.ironwork.height,
    });
    // Not standable: a racer may not mantle out of the garden over a barrier.
    expect(added).not.toHaveProperty('standable');
  });

  it('lays the collider along the run, with its own thickness', () => {
    const circuit = withFences([
      {
        kit: 'hedge',
        points: [
          { x: 0, z: 0 },
          { x: 0, z: 30 },
        ],
      },
    ]);
    const [{ run }] = mortarOverdriveFenceRuns(circuit);
    expect(run.hw).toBeCloseTo(15, 6);
    expect(run.hd).toBeCloseTo(MORTAR_OVERDRIVE_BARRIERS.hedge.halfThickness, 6);
    // A run along +z under the three.js yaw convention, which maps local +x to
    // (cos, -sin): laying `hw` along (0, 1) needs a quarter turn back.
    expect(Math.cos(run.rot)).toBeCloseTo(0, 6);
    expect(Math.sin(run.rot)).toBeCloseTo(-1, 6);
    expect(run.x).toBeCloseTo(0, 6);
    expect(run.z).toBeCloseTo(15, 6);
  });

  it('reaches a half thickness past a JOINT and not past an open end', () => {
    const circuit = withFences([
      {
        kit: 'stoneWall',
        points: [
          { x: 0, z: 0 },
          { x: 20, z: 0 },
          { x: 20, z: 20 },
        ],
      },
    ]);
    const runs = mortarOverdriveFenceRuns(circuit).map((entry) => entry.run);
    const half = MORTAR_OVERDRIVE_BARRIERS.stoneWall.halfThickness;
    expect(runs).toHaveLength(2);
    // Both runs are 20 yards of authored length, and each is extended at the
    // end that meets the other and at neither open end. Without it a corner has
    // a wedge of nothing to squeeze through, which is why the perimeter box has
    // always done exactly this.
    for (const run of runs) expect(run.length).toBeCloseTo(20, 6);
    expect(runs[0].hw).toBeCloseTo((20 + half) / 2, 6);
    expect(runs[1].hw).toBeCloseTo((20 + half) / 2, 6);
    // And the extension is on the JOINT side: the first run's box centre slides
    // forward, the second's slides back.
    expect(runs[0].x).toBeCloseTo(10 + half / 2, 6);
    expect(runs[1].z).toBeCloseTo(10 - half / 2, 6);
  });

  it('closes a ring, and refuses to close two points into one doubled run', () => {
    // The ironwork, because it is a kit that HAS a corner piece: the corner
    // count below says nothing about a kit whose corner is deliberately 'none'.
    const ring = withFences([
      {
        kit: 'ironwork',
        points: [
          { x: 0, z: 0 },
          { x: 30, z: 0 },
          { x: 30, z: 30 },
        ],
        closed: true,
      },
    ]);
    const ringRuns = mortarOverdriveFenceRuns(ring).map((entry) => entry.run);
    expect(ringRuns).toHaveLength(3);
    // The third run joins the LAST point back to the first, which a count alone
    // cannot say.
    expect([ringRuns[2].ax, ringRuns[2].az]).toEqual([30, 30]);
    expect([ringRuns[2].bx, ringRuns[2].bz]).toEqual([0, 0]);
    // And EVERY end is a joint on a ring, so every run is extended at both,
    // unlike the open case where the two outer ends are not.
    const ringHalf = MORTAR_OVERDRIVE_BARRIERS.ironwork.halfThickness;
    for (const run of ringRuns) {
      expect(run.hw).toBeCloseTo(run.length / 2 + ringHalf, 6);
    }
    // One corner per authored point, none repeated for the closing joint.
    const [ringDrawing] = mortarOverdriveFencePieces(ring);
    expect(ringDrawing.corners).toHaveLength(3);
    const twoPoints = withFences([
      {
        kit: 'stoneWall',
        points: [
          { x: 0, z: 0 },
          { x: 30, z: 0 },
        ],
        closed: true,
      },
    ]);
    // Closing two points would lay the same ground twice back to back and
    // double every collider on it.
    expect(mortarOverdriveFenceRuns(twoPoints)).toHaveLength(1);
  });

  it('skips a repeated point rather than putting NaN in a collider', () => {
    const circuit = withFences([
      {
        kit: 'ironwork',
        points: [
          { x: 5, z: 5 },
          { x: 5, z: 5 },
          { x: 25, z: 5 },
        ],
      },
    ]);
    const runs = mortarOverdriveFenceRuns(circuit);
    expect(runs).toHaveLength(1);
    for (const { run } of runs) {
      expect(Number.isFinite(run.x) && Number.isFinite(run.z) && Number.isFinite(run.rot)).toBe(
        true,
      );
    }
  });

  it('multiplies both halves by the record scale, so they cannot drift', () => {
    const circuit = withFences([
      {
        kit: 'hedge',
        points: [
          { x: 0, z: 0 },
          { x: 20, z: 0 },
        ],
        scale: 2,
      },
    ]);
    const [placed] = mortarOverdriveFencePlacements(circuit).fences;
    expect(placed.height).toBeCloseTo(MORTAR_OVERDRIVE_BARRIERS.hedge.height * 2, 6);
    expect(placed.runs[0].hd).toBeCloseTo(MORTAR_OVERDRIVE_BARRIERS.hedge.halfThickness * 2, 6);
  });

  it('names an unknown kit rather than throwing, and draws the rest', () => {
    const circuit = withFences([
      {
        kit: 'nothingAuthorsThis',
        points: [
          { x: 0, z: 0 },
          { x: 10, z: 0 },
        ],
      },
      {
        kit: 'ironwork',
        points: [
          { x: 0, z: 20 },
          { x: 10, z: 20 },
        ],
      },
    ]);
    const placements = mortarOverdriveFencePlacements(circuit);
    expect(placements.unknownKits).toEqual(['nothingAuthorsThis']);
    expect(placements.fences).toHaveLength(1);
  });

  it('samples a run end to end, at no more than the spacing asked for', () => {
    const circuit = withFences([
      {
        kit: 'ironwork',
        points: [
          { x: 0, z: 0 },
          { x: 9, z: 0 },
        ],
      },
    ]);
    const [{ run }] = mortarOverdriveFenceRuns(circuit);
    const samples = mortarOverdriveFenceRunSamples(run, 2);
    expect(samples[0]).toEqual({ x: 0, z: 0 });
    expect(samples[samples.length - 1].x).toBeCloseTo(9, 6);
    for (let i = 1; i < samples.length; i++) {
      expect(
        Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z),
      ).toBeLessThanOrEqual(2 + 1e-6);
    }
  });
});

describe('cutting a run into modules', () => {
  it('comes out even on a run of any length', () => {
    // The count is rounded and the step re-derived from it, so a run never ends
    // on a fraction of a module and never leaves a gap.
    for (const length of [7, 13.5, 41, 100]) {
      const circuit = withFences([
        {
          kit: 'ironwork',
          points: [
            { x: 0, z: 0 },
            { x: length, z: 0 },
          ],
        },
      ]);
      const [drawing] = mortarOverdriveFencePieces(circuit);
      const visual = MORTAR_OVERDRIVE_BARRIER_VISUALS.ironwork;
      // The ironwork wears a pillar, so the tiling is inset at both ends by half
      // of it: the piece has to have somewhere to stand.
      const inset = (visual.corner as { yards: number }).yards / 2;
      const span = length - inset * 2;
      expect(drawing.panels.length, `${length} yd`).toBe(
        Math.max(1, Math.round(span / visual.panelYards)),
      );
      // The pieces come out in WORLD coordinates, which is what the renderer
      // instances them at; the run was authored circuit-local.
      const step = span / drawing.panels.length;
      drawing.panels.forEach((panel, i) => {
        expect(panel.x - MORTAR_OVERDRIVE_ORIGIN.x, `${length} yd, panel ${i}`).toBeCloseTo(
          inset + step * (i + 0.5),
          6,
        );
        expect(panel.z - MORTAR_OVERDRIVE_ORIGIN.z).toBeCloseTo(0, 6);
      });
      // Even, with no cell left over: the first and last cells start and end on
      // the inset, so the run is covered exactly between its two pillars.
      expect(inset + step * drawing.panels.length).toBeCloseTo(length - inset, 6);
    }
  });

  it('makes ROOM for a corner piece, and overlaps the joint when there is none', () => {
    // The two opposite answers to one question, and the seat test that found
    // them: with a pillar at the joint the two arms were tiled PAST each other,
    // so the railing crossed straight through the pillar and came out into the
    // opposite arm. A kit with a corner piece has to stop short of it; a kit
    // without one has to overlap, because that overlap IS the seal.
    const chevron = (kit: string) =>
      withFences([
        {
          kit,
          points: [
            { x: -20, z: 0 },
            { x: 0, z: -20 },
            { x: 20, z: 0 },
          ],
        },
      ]);
    /**
     * How far SHORT of the joint the nearest panel's own cell stops, along the
     * run. Negative means the cell crossed the joint into the other arm.
     *
     * Measured off the drawn pieces alone: two adjacent panels of one run are
     * exactly one cell apart, and the nearest centre sits half a cell inside its
     * own end, so the end of the tiling is `nearest - cell / 2` from the joint.
     */
    const reachPastJoint = (kit: string): number => {
      const [drawing] = mortarOverdriveFencePieces(chevron(kit));
      const local = drawing.panels.map((panel) => ({
        x: panel.x - MORTAR_OVERDRIVE_ORIGIN.x,
        z: panel.z - MORTAR_OVERDRIVE_ORIGIN.z,
      }));
      const cell = Math.hypot(local[0].x - local[1].x, local[0].z - local[1].z);
      const nearest = Math.min(...local.map((point) => Math.hypot(point.x, point.z + 20)));
      return nearest - cell / 2;
    };

    // Ironwork has a pillar: its cell stops short of the joint by the pillar's
    // own half, so the piece has somewhere to stand.
    const withPillar = reachPastJoint('ironwork');
    expect(withPillar).toBeGreaterThan(0);
    expect(withPillar).toBeCloseTo(
      (MORTAR_OVERDRIVE_BARRIER_VISUALS.ironwork.corner as { yards: number }).yards / 2,
      2,
    );
    // The hedge has none, so its cells run PAST the joint and the two arms
    // interpenetrate there. Same measurement, opposite sign.
    expect(reachPastJoint('hedge')).toBeLessThan(0);
  });

  it('puts a corner piece at every authored point, and none for a kit with no corner', () => {
    const points = [
      { x: 0, z: 0 },
      { x: 20, z: 0 },
      { x: 20, z: 20 },
    ];
    const [withCorners] = mortarOverdriveFencePieces(withFences([{ kit: 'ironwork', points }]));
    expect(withCorners.corners).toHaveLength(3);
    // The hedge is the one kit whose corner is `'none'`: a hedge is a mass, so
    // the overlap at a joint reads as growth rather than as a gap.
    const [none] = mortarOverdriveFencePieces(withFences([{ kit: 'hedge', points }]));
    expect(none.corners).toEqual([]);
  });

  it('faces a corner piece along the BISECTOR of the two runs meeting there', () => {
    // A piece square to one arm leaves the other's daylight showing, which is
    // the whole job a corner piece has.
    const [drawing] = mortarOverdriveFencePieces(
      withFences([
        {
          kit: 'ironwork',
          points: [
            { x: 0, z: 0 },
            { x: 20, z: 0 },
            { x: 20, z: 20 },
          ],
        },
      ]),
    );
    // The middle point turns from +x to +z, so its bisector points at 45
    // degrees between them: under the three.js convention that is a yaw whose
    // cosine and negative sine are equal.
    const joint = drawing.corners[1];
    expect(Math.cos(joint.yaw)).toBeCloseTo(-Math.sin(joint.yaw), 6);
  });

  it('turns a kit whose module runs along its own +z by a quarter turn', () => {
    // Both shipped lengthAxis values reach the same drawn line. Asserted
    // against a synthetic pair rather than a shipped kit, because every kit in
    // the catalog happens to be 'x' today and a test that only ever sees one
    // arm proves nothing about the other.
    const visuals = MORTAR_OVERDRIVE_BARRIER_VISUALS;
    const original = visuals.ironwork;
    try {
      visuals.zAxisFixture = { ...original, lengthAxis: 'z' };
      (
        MORTAR_OVERDRIVE_BARRIERS as Record<string, { halfThickness: number; height: number }>
      ).zAxisFixture = MORTAR_OVERDRIVE_BARRIERS.ironwork;
      const points = [
        { x: 0, z: 0 },
        { x: 20, z: 0 },
      ];
      const [alongX] = mortarOverdriveFencePieces(withFences([{ kit: 'ironwork', points }]));
      const [alongZ] = mortarOverdriveFencePieces(
        withFences([{ kit: 'zAxisFixture', points: [...points] }]),
      );
      // The ABSOLUTE yaw first, and it is the load-bearing half. A delta-only
      // assertion survives the one mutation that matters: turning an 'x' kit by
      // a quarter and a 'z' kit by a half keeps the delta at PI/2 while standing
      // every module of every SHIPPED kit broadside to its own run, which is the
      // exact Galecrest defect this guard was moved here to keep catching.
      const [{ run }] = mortarOverdriveFenceRuns(
        withFences([{ kit: 'ironwork', points: [...points] }]),
      );
      expect(alongX.panels[0].yaw).toBeCloseTo(run.rot, 6);
      expect(alongZ.panels[0].yaw - alongX.panels[0].yaw).toBeCloseTo(Math.PI / 2, 6);
    } finally {
      delete visuals.zAxisFixture;
      delete (MORTAR_OVERDRIVE_BARRIERS as Record<string, unknown>).zAxisFixture;
    }
  });
});
