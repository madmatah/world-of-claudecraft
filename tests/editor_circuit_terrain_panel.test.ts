// @vitest-environment jsdom
//
// The TERRAIN tool's two panels as ELEMENTS.
//
// The same reason the RACE panel suite exists, plus one more. The arm grammar
// (a POINTER state that is the default, arming that is deliberate, a second
// click that gives the pointer back) cannot be read off a core, and neither can
// the two things a wrong arm looks like from outside: a tile still lit after the
// pointer comes back, and a second click on the armed tile that does nothing.
//
// The one more is the DRAWING state. A barrier is not dropped, it is drawn point
// by point, so the panel has to say how a run ENDS as well as what it is made
// of: an operator who cannot find the way out of a gesture is stuck in it. That
// sentence is the only thing on screen that answers "am I still drawing", so it
// is pinned here against the point counts that change which exits are available.
//
// Dev tool, so English lives in the assertions.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  barrierKitLabel,
  TerrainInspectorPanel,
  TerrainPalettePanel,
  type TerrainPanelHost,
  terrainArmStateText,
} from '../src/editor/circuit/panel_terrain';
import { REALM_RACERS_BARRIERS } from '../src/sim/content/realm_racers_barriers';
import {
  REALM_RACERS_PRACTICE_CIRCUIT as GARDEN,
  type RealmRacersCircuit,
} from '../src/sim/content/realm_racers_circuits';
import { realmRacersCircuitMetrics } from '../src/sim/realm_racers_circuit_metrics';
import { realmRacersTrack } from '../src/sim/realm_racers_spline';

/** The Evergarden's own vocabulary, which is what the palette folds on. */
const ZONE_KITS = ['ironwork', 'hedge', 'stoneWall'];

function mount(overrides: Partial<TerrainPanelHost> = {}): {
  palette: TerrainPalettePanel;
  inspector: TerrainInspectorPanel;
  host: TerrainPanelHost;
} {
  document.body.innerHTML = '';
  const record = (overrides.record?.() ?? GARDEN) as RealmRacersCircuit;
  const host: TerrainPanelHost = {
    record: () => record,
    metrics: () => realmRacersCircuitMetrics(record),
    track: () => realmRacersTrack(record),
    drawn: () => true,
    mode: () => 'terrain',
    selection: () => null,
    commit: vi.fn(),
    commitDressing: vi.fn(),
    setStatus: vi.fn(),
    fenceSelection: () => null,
    draftPointCount: () => null,
    setFenceScale: vi.fn(),
    removeFence: vi.fn(),
    finishDraft: vi.fn(),
    onArmed: vi.fn(),
    themeBarriers: () => ZONE_KITS,
    ...overrides,
  };
  const palette = new TerrainPalettePanel(host);
  const inspector = new TerrainInspectorPanel(host);
  document.body.append(palette.el, inspector.el);
  return { palette, inspector, host };
}

const tile = (kit: string): HTMLElement =>
  document.querySelector(`button.lib-tile[data-kit="${kit}"]`) as HTMLElement;

const pointerRow = (): HTMLElement => document.querySelector('button.pointer-mode') as HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('the terrain palette', () => {
  it('opens on the POINTER, which is the whole point of it', () => {
    // With a kit permanently armed, a click that hit nothing would start a run
    // nobody asked for at a place nobody chose. That is the props tool's lesson
    // and the race tool's, and this is the third tool to take it.
    const { palette } = mount();
    expect(palette.armed).toBeNull();
    expect(pointerRow().classList.contains('on')).toBe(true);
    expect(tile('ironwork').classList.contains('on')).toBe(false);
  });

  it('arms a kit, and a second click on the armed tile gives the pointer back', () => {
    const { palette, host } = mount();
    tile('hedge').click();
    expect(palette.armed).toBe('hedge');
    expect(tile('hedge').classList.contains('on')).toBe(true);
    expect(pointerRow().classList.contains('on')).toBe(false);
    expect(host.onArmed).toHaveBeenLastCalledWith('hedge');

    tile('hedge').click();
    expect(palette.armed).toBeNull();
    // The tile has to go dark too: an arm that is off in state and lit on screen
    // is the failure this panel is watched for.
    expect(tile('hedge').classList.contains('on')).toBe(false);
    expect(pointerRow().classList.contains('on')).toBe(true);
    expect(host.onArmed).toHaveBeenLastCalledWith(null);
  });

  it('arms the NEXT kit rather than toggling off, when a different tile is clicked', () => {
    const { palette } = mount();
    tile('ironwork').click();
    tile('stoneWall').click();
    expect(palette.armed).toBe('stoneWall');
    expect(tile('ironwork').classList.contains('on')).toBe(false);
    expect(tile('stoneWall').classList.contains('on')).toBe(true);
  });

  it('offers this zone’s kits first and hides none of the others', () => {
    // The theme's vocabulary is an authoring aid, never a filter: a record may
    // name any kit, so every one of them has to be reachable.
    mount();
    const kits = [...document.querySelectorAll<HTMLElement>('button.lib-tile')].map(
      (el) => el.dataset.kit as string,
    );
    expect(kits.slice(0, ZONE_KITS.length)).toEqual(ZONE_KITS);
    expect(new Set(kits)).toEqual(new Set(Object.keys(REALM_RACERS_BARRIERS)));
    // ...and no kit is offered twice, which the two groups make possible.
    expect(kits.length).toBe(new Set(kits).size);
  });

  it('rebuilds the grid only when the zone vocabulary changes', () => {
    // The props library's hard-won rule at one remove: `paint()` runs on every
    // repaint, and a grid rebuilt under the pointer is a click that lands on an
    // element that no longer exists.
    let vocabulary = ZONE_KITS;
    const { palette } = mount({ themeBarriers: () => vocabulary });
    const before = tile('ironwork');
    palette.paint();
    expect(tile('ironwork')).toBe(before);

    vocabulary = ['hedge', 'ironwork', 'stoneWall'];
    palette.paint();
    expect(tile('ironwork')).not.toBe(before);
  });

  it('keeps the armed tile lit across a repaint', () => {
    const { palette } = mount();
    tile('ironwork').click();
    palette.paint();
    expect(palette.armed).toBe('ironwork');
    expect(tile('ironwork').classList.contains('on')).toBe(true);
  });
});

describe('what the tool says it is doing', () => {
  it('names the pointer state for as long as it is true', () => {
    expect(terrainArmStateText(null, null)).toContain('pointer');
  });

  it('names the two exits at the point counts that make each one available', () => {
    // The whole reason the count is in the sentence: a run of two can be
    // finished open and cannot be closed, a run of three can be either, and an
    // operator who cannot find the way out of a drawing gesture is stuck in it.
    expect(terrainArmStateText('ironwork', 0)).toContain('first point');
    expect(terrainArmStateText('ironwork', 1)).toContain('esc');
    const two = terrainArmStateText('ironwork', 2);
    expect(two).toContain('enter');
    expect(two).not.toContain('close');
    const three = terrainArmStateText('ironwork', 3);
    expect(three).toContain('close');
    expect(three).toContain('enter');
  });

  it('reads a catalog key as words', () => {
    expect(barrierKitLabel('ornateRailing')).toBe('ornate railing');
    expect(barrierKitLabel('hedge')).toBe('hedge');
  });
});

describe('the terrain inspector', () => {
  const walled: RealmRacersCircuit = {
    ...GARDEN,
    id: 'terrain_panel_fixture',
    fences: [
      {
        kit: 'ironwork',
        points: [
          { x: -60, z: -40 },
          { x: -60, z: 40 },
        ],
      },
    ],
  };

  it('says what to do when nothing is selected, and still reports the cost', () => {
    const { inspector } = mount({ record: () => walled });
    inspector.paint();
    expect(inspector.el.textContent).toContain('click a barrier');
    expect(inspector.el.textContent).toContain('colliders');
  });

  it('reports the selected barrier by its kit, its runs and its size', () => {
    const { inspector } = mount({ record: () => walled, fenceSelection: () => 0 });
    inspector.paint();
    const text = inspector.el.textContent ?? '';
    expect(text).toContain('ironwork');
    expect(text).toContain('1 of 1');
    // One run of 80 yards, one collider, and the kit's own drawn height.
    expect(text).toContain('80.0 yd');
    expect(text).toContain('an open run');
    expect(text).toContain(REALM_RACERS_BARRIERS.ironwork.height.toFixed(2));
  });

  it('reports a barrier whose kit precedes it in the record, not the one beside it', () => {
    // The aliasing this exists to refuse: the resolver SKIPS an unknown kit, so
    // the placement list is shorter than the record's and a positional lookup
    // reports the wrong barrier's numbers for the selection.
    const withUnknownFirst: RealmRacersCircuit = {
      ...GARDEN,
      id: 'terrain_panel_aliasing',
      fences: [
        {
          kit: 'nothingAuthorsThis',
          points: [
            { x: 10, z: 10 },
            { x: 10, z: 20 },
          ],
        },
        {
          kit: 'ironwork',
          points: [
            { x: -60, z: -40 },
            { x: -60, z: 40 },
          ],
        },
      ],
    };
    const { inspector } = mount({ record: () => withUnknownFirst, fenceSelection: () => 1 });
    inspector.paint();
    const text = inspector.el.textContent ?? '';
    expect(text).toContain('ironwork');
    // The ironwork run is 80 yards; the unknown-kit entry is 10 and resolves to
    // nothing at all, so a positional lookup would report zero runs here.
    expect(text).toContain('80.0 yd');
    expect(text).toContain('1 runs');
  });

  it('offers a way to finish a run WHILE one is being drawn', () => {
    // The button used to sit inside the branch that only runs when something is
    // selected, and starting a draft clears the selection, so it never rendered.
    // With NO selection, which is the state a draft is actually in: starting a
    // run clears it.
    const { inspector, host } = mount({
      record: () => walled,
      fenceSelection: () => null,
      draftPointCount: () => 2,
    });
    inspector.paint();
    const buttons = [...inspector.el.querySelectorAll('button')].map((el) => el.textContent);
    expect(buttons).toContain('finish the run');
    (
      [...inspector.el.querySelectorAll('button')].find(
        (el) => el.textContent === 'finish the run',
      ) as HTMLButtonElement
    ).click();
    expect(host.finishDraft).toHaveBeenCalled();
  });

  it('does not repaint over a half-typed number', () => {
    // The rule every inspector on this page keeps: a drag repaints the panel,
    // and rebuilding under the caret takes the focus out of the field.
    const { inspector } = mount({ record: () => walled, fenceSelection: () => 0 });
    inspector.paint();
    const input = inspector.el.querySelector('input') as HTMLInputElement;
    input.focus();
    input.value = '2.7';
    inspector.paint();
    expect(inspector.el.querySelector('input')).toBe(input);
    expect(input.value).toBe('2.7');
  });
});
