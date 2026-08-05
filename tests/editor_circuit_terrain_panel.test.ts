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
import { MIN_PERIMETER_HALF } from '../src/editor/circuit/enclosure_core';
import { MAX_PERIMETER_HALF_X, MAX_PERIMETER_HALF_Z } from '../src/editor/circuit/envelope_core';
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
    groundArmed: () => false,
    setFenceScale: vi.fn(),
    removeFence: vi.fn(),
    groundSelection: () => null,
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

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('the terrain palette', () => {
  it('opens on the POINTER, which is the whole point of it', () => {
    // With a kit permanently armed, a click that hit nothing would start a run
    // nobody asked for at a place nobody chose. That is the props tool's lesson
    // and the race tool's, and this is the third tool to take it. The STATE is
    // what does that work; the row that used to announce it is gone, because it
    // was a third way to say what the lit tile and `esc` already say, and what
    // it said while nothing was armed was that nothing was armed.
    const { palette } = mount();
    expect(palette.armed).toBeNull();
    expect(document.querySelector('button.pointer-mode')).toBeNull();
    expect(tile('ironwork').classList.contains('on')).toBe(false);
    // The hint line is what carries the idle state now, and it says what a click
    // will do rather than what it will not.
    expect(document.querySelector('.hint-line')?.textContent).toContain('select it');
  });

  it('arms a kit, and a second click on the armed tile gives the pointer back', () => {
    const { palette, host } = mount();
    tile('hedge').click();
    expect(palette.armed).toBe('hedge');
    expect(tile('hedge').classList.contains('on')).toBe(true);
    expect(host.onArmed).toHaveBeenLastCalledWith('hedge');

    tile('hedge').click();
    expect(palette.armed).toBeNull();
    // The tile has to go dark too: an arm that is off in state and lit on screen
    // is the failure this panel is watched for, and with the pointer row gone
    // the tile IS the state.
    expect(tile('hedge').classList.contains('on')).toBe(false);
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

  it('offers KITS and nothing else, the land having left it', () => {
    // A palette is for picking one of many. A circuit has ONE ground, drawn with
    // a gesture that is not a barrier's, so it arms from the mode's action bar
    // and this panel is kits from top to bottom.
    mount();
    const buttons = [...document.querySelectorAll<HTMLElement>('button')];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.classList.contains('lib-tile'), button.textContent ?? '').toBe(true);
    }
    // No ENTRY offers the land. The hint line still mentions a ground handle,
    // and it should: the pointer selects one.
    for (const button of buttons) {
      expect(button.textContent?.toLowerCase() ?? '').not.toContain('ground');
    }
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
    // It says what a click WILL do rather than naming the state after the row
    // that used to announce it: with nothing armed, a click selects.
    const idle = terrainArmStateText(null, null);
    expect(idle).toContain('select it');
    expect(idle).toContain('drag it to move it');
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

  it('says the GROUND is what the next drag shapes, in the palette, not only in the status bar', () => {
    // The right column stays pinned to this palette for the whole gesture (the
    // page counts an armed ground as placing), so a hint line still reading
    // "click a barrier to select it" is the panel in front of the operator
    // contradicting the tool.
    const { palette } = mount({ groundArmed: () => true });
    palette.paint();
    expect(palette.el.textContent).toContain('shaping the ground');
    expect(palette.el.textContent).not.toContain('click a barrier or a ground handle');
  });

  it('says how a RUN in progress ends, even with no kit in hand', () => {
    // The inspector asks with `kit = null` while a draft is open, and the idle
    // sentence is not an answer to "how do I finish this run".
    expect(terrainArmStateText(null, 2)).toContain('enter finishes the run');
    expect(terrainArmStateText(null, 4)).toContain('close the ring');
    expect(terrainArmStateText(null, null)).toContain('select it');
  });

  it('says the ground is drawn in ONE gesture, not point by point', () => {
    // The two gestures of this tool end differently: a run is finished or closed
    // by a click, and a ground shape is one stroke that ends on the release. The
    // held line has to say which of the two the operator is in the middle of,
    // and the ground wins outright: it is armed from the bar, so an armed kit
    // and an armed ground cannot both be true.
    const armed = terrainArmStateText(null, null, true);
    expect(armed).toContain('drag');
    expect(armed).toContain('closed');
    // Nothing about points: a count would be a barrier's question asked of a
    // freehand loop.
    expect(armed).not.toContain('click to drop');
    expect(terrainArmStateText('hedge', 2, true)).toBe(armed);
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

  it('shows THREE permanent groups, the land, the barriers on it, then the wall', () => {
    // The defect this closes was a reading one: the land's lines and the
    // barriers' ran into each other as one column, so nothing on screen said
    // which of the two a number belonged to. Every title is always there, in
    // this order, whether or not any of them has a selection to report.
    //
    // The order is outward: the ground a race sits on, what stands on it, then
    // the box around both.
    const { inspector } = mount({ record: () => walled });
    inspector.paint();
    const titles = (panel: TerrainInspectorPanel) =>
      [...panel.el.querySelectorAll('h2')].map((node) => node.textContent);
    expect(titles(inspector)).toEqual(['the land', 'barriers', 'the wall']);
    // WITH a barrier selected too, which is the state the source edit was made
    // for: the selected barrier's own name used to be an extra `h2`, so a test
    // that only ever mounted the empty state would stay green over a panel that
    // grew its title back.
    const selected = mount({ record: () => walled, fenceSelection: () => 0 });
    selected.inspector.paint();
    expect(titles(selected.inspector)).toEqual(['the land', 'barriers', 'the wall']);
    expect(selected.inspector.el.textContent).toContain('ironwork 1 of 1');
  });

  it('edits the wall here, where its grips and its fit already are', () => {
    // The wall was authored from the RACE tool's record form, one rail entry
    // from the mode that carries its grips and its fit. Two half-extents,
    // spelled as halves because that is what the record holds and what a grip
    // writes: a field called "width" over half of one is a field typed into
    // wrong.
    const commits: RealmRacersCircuit[] = [];
    const { inspector } = mount({ record: () => walled, commit: (next) => commits.push(next) });
    inspector.paint();
    const inputs = [...inspector.el.querySelectorAll('input[type="number"]')].filter(
      (input) => (input as HTMLInputElement).step === '1',
    ) as HTMLInputElement[];
    expect(inputs).toHaveLength(2);
    expect(inputs.map((input) => input.value)).toEqual([
      String(walled.perimeter.halfX),
      String(walled.perimeter.halfZ),
    ]);
    // The ceiling on the control is the one the readout refuses past, so the
    // two ways of sizing this box cannot disagree about where it stops.
    expect(inputs[0].max).toBe(String(MAX_PERIMETER_HALF_X));
    expect(inputs[1].max).toBe(String(MAX_PERIMETER_HALF_Z));
    expect(inputs[0].min).toBe(String(MIN_PERIMETER_HALF));

    inputs[1].value = '77';
    inputs[1].onchange?.(new Event('change'));
    expect(commits).toHaveLength(1);
    expect(commits[0].perimeter.halfZ).toBe(77);
    // The other axis and the wall's dressing are untouched: this field owns one
    // number.
    expect(commits[0].perimeter.halfX).toBe(walled.perimeter.halfX);
    expect(commits[0].perimeter.height).toBe(walled.perimeter.height);
  });

  it('names the land as a state, whether or not a shape has been drawn', () => {
    // "There is no shape here" is the NORMAL answer (both shipped circuits give
    // it), so an operator has to be able to tell it apart from a shape that
    // failed to draw, and from one whose handles are simply off screen.
    const { inspector } = mount({ record: () => walled });
    inspector.paint();
    expect(inspector.el.textContent).toContain('no shape drawn');
    // ...and it points at the bar, which is where both ways to make one live.
    expect(inspector.el.textContent).toContain('Draw ground shape');

    const island: RealmRacersCircuit = {
      ...walled,
      id: 'terrain_panel_island',
      groundOutline: [
        { x: -100, z: -80 },
        { x: 100, z: -80 },
        { x: 100, z: 80 },
        { x: -100, z: 80 },
      ],
    };
    const drawn = mount({ record: () => island });
    drawn.inspector.paint();
    expect(drawn.inspector.el.textContent).toContain('4 handles');

    const held = mount({ record: () => island, groundSelection: () => 2 });
    held.inspector.paint();
    expect(held.inspector.el.textContent).toContain('handle 3 of 4');
  });

  it('offers no button of its own on the land, since both act on the whole terrain', () => {
    // Drawing a shape and discarding one are not selection edits: there is one
    // ground, so they belong on the mode's action bar. What stays here is the
    // barrier's own delete, which acts on one of many.
    const island: RealmRacersCircuit = {
      ...walled,
      id: 'terrain_panel_island_buttons',
      groundOutline: [
        { x: -100, z: -80 },
        { x: 100, z: -80 },
        { x: 0, z: 80 },
      ],
    };
    const { inspector } = mount({ record: () => island, fenceSelection: () => 0 });
    inspector.paint();
    const labels = [...inspector.el.querySelectorAll('button')].map((el) => el.textContent);
    expect(labels).toEqual(['delete barrier']);
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

  it('REFUSES a typed value the save endpoint would not carry, and says so', () => {
    // The `min` and `max` attributes are a hint to a spinner and nothing to a
    // typed value. Losing the record form's validation in the move was a
    // data-loss bug, not a style one: a committed record the validator refuses
    // still reaches the autosave, and boot re-validates what it finds, so the
    // stored draft degrades to a fresh canvas and the session is gone.
    const commits: RealmRacersCircuit[] = [];
    const setStatus = vi.fn();
    const { inspector } = mount({
      record: () => walled,
      commit: (next) => commits.push(next),
      setStatus,
    });
    inspector.paint();
    const input = [...inspector.el.querySelectorAll('input[type="number"]')].filter(
      (node) => (node as HTMLInputElement).step === '1',
    )[0] as HTMLInputElement;

    input.value = '0';
    input.onchange?.(new Event('change'));
    expect(commits).toEqual([]);
    expect(setStatus).toHaveBeenCalledWith(expect.stringContaining('half x'), 'err');
    // The control goes back to what the record carries, so it never keeps a
    // number the circuit does not.
    expect(input.value).toBe(String(walled.perimeter.halfX));

    // A legal one still lands, so the guard is a floor and not a wall.
    input.value = '150';
    input.onchange?.(new Event('change'));
    expect(commits).toHaveLength(1);
    expect(commits[0].perimeter.halfX).toBe(150);
  });
});
