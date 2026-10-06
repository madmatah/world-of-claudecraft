// The inspector: the numbers behind the selection, editable.
//
// Repainted with the readout, EXCEPT while one of its own inputs has the caret:
// a drag repaints the panel, and rebuilding under a half-typed number would take
// the focus out of it.
//
// Every edit goes back through `commitDressing`, so the basin stays in step with
// the ponds and the undo stack gets one step per change, exactly as a canvas
// gesture does.

import type {
  MortarOverdrivePond,
  MortarOverdriveProp,
  MortarOverdriveScatter,
} from '../../sim/content/mortar_overdrive';
import { MORTAR_OVERDRIVE_PROPS } from '../../sim/content/mortar_overdrive/props';
import { mortarOverdrivePlacements } from '../../sim/mortar_overdrive/props_resolve';
import {
  detailLine,
  fieldRow,
  heading,
  hintLine,
  numberOr,
  type PanelHost,
  panelButton,
} from './panels';
import {
  convertedProp,
  placementIndexOf,
  propFrameOf,
  replacedAt,
  toggledCollide,
} from './props_core';

export class InspectorPanel {
  readonly el = document.createElement('div');

  constructor(private readonly host: PanelHost) {
    this.el.id = 'inspector';
  }

  private row(
    label: string,
    value: string,
    write: (raw: string) => void,
    attrs: Partial<HTMLInputElement> = {},
  ): void {
    const { wrap, name } = fieldRow(label);
    const input = document.createElement('input');
    input.type = attrs.type ?? 'number';
    Object.assign(input, attrs);
    input.value = value;
    input.onchange = () => write(input.value);
    name.append(input);
    this.el.append(wrap);
  }

  paint(): void {
    if (this.el.hidden || this.el.contains(document.activeElement)) return;
    this.el.replaceChildren();
    const selection = this.host.selection();
    if (!selection) {
      this.el.append(
        hintLine(
          this.host.mode() === 'props'
            ? 'click a prop, a scatter or a pond on the plan'
            : 'the PROPS tool is where a piece is selected',
        ),
      );
      return;
    }
    this.el.append(heading(`${selection.kind} ${selection.index}`));
    if (selection.kind === 'prop') this.paintProp(selection.index);
    else if (selection.kind === 'scatter') this.paintScatter(selection.index);
    else this.paintPond(selection.index);
  }

  private paintProp(index: number): void {
    const record = this.host.record();
    const prop = (record.props ?? [])[index];
    if (!prop) return;
    const placedIndex = placementIndexOf(record.props, MORTAR_OVERDRIVE_PROPS, index);
    const placed = mortarOverdrivePlacements(record).props[placedIndex];
    const edit = (next: MortarOverdriveProp): void =>
      this.host.commitDressing({ props: replacedAt(record.props, index, next) });

    if ('s' in prop.at) {
      const at = prop.at;
      this.row(
        'lap fraction',
        String(at.s),
        (raw) => edit({ ...prop, at: { s: numberOr(raw, at.s), offset: at.offset } }),
        { step: '0.001', min: '0', max: '1' },
      );
      this.row(
        'offset (yd)',
        String(at.offset),
        (raw) => edit({ ...prop, at: { s: at.s, offset: numberOr(raw, at.offset) } }),
        { step: '0.5' },
      );
    } else {
      const at = prop.at;
      this.row(
        'x',
        String(at.x),
        (raw) => edit({ ...prop, at: { x: numberOr(raw, at.x), z: at.z } }),
        {
          step: '0.5',
        },
      );
      this.row(
        'z',
        String(at.z),
        (raw) => edit({ ...prop, at: { x: at.x, z: numberOr(raw, at.z) } }),
        {
          step: '0.5',
        },
      );
    }
    this.row(
      'yaw (rad)',
      prop.yaw === 'tangent' ? '' : String(prop.yaw ?? 0),
      (raw) => edit({ ...prop, yaw: numberOr(raw, 0) }),
      { step: '0.05' },
    );
    this.row(
      'scale',
      String(prop.scale ?? 1),
      (raw) => edit({ ...prop, scale: numberOr(raw, 1) }),
      {
        step: '0.05',
        min: '0.05',
        max: '50',
      },
    );
    if (placed) {
      this.el.append(
        detailLine(
          `${propFrameOf(prop)}, ${placed.solid ? 'solid' : 'decor'}, stands at ${placed.x.toFixed(1)}, ${placed.z.toFixed(1)}`,
        ),
      );
      this.el.append(
        panelButton('to the other frame', () =>
          edit(convertedProp(record, prop, placed.x, placed.z)),
        ),
      );
    }
    this.el.append(
      panelButton(prop.collide === 'none' ? 'make it solid again' : 'stop it colliding', () =>
        edit(toggledCollide(prop)),
      ),
    );
  }

  private paintScatter(index: number): void {
    const record = this.host.record();
    const scatter = (record.scatters ?? [])[index];
    if (!scatter) return;
    const edit = (next: MortarOverdriveScatter): void =>
      this.host.commitDressing({ scatters: replacedAt(record.scatters, index, next) });
    this.row(
      'spacing (yd)',
      String(scatter.spacing),
      (raw) => edit({ ...scatter, spacing: numberOr(raw, scatter.spacing) }),
      { step: '0.5', min: '1', max: '200' },
    );
    this.row(
      'seed',
      String(scatter.seed),
      (raw) => edit({ ...scatter, seed: Math.round(numberOr(raw, scatter.seed)) }),
      { step: '1' },
    );
    if (scatter.span) {
      const span = scatter.span;
      this.row(
        'span from',
        String(span.s0),
        (raw) => edit({ ...scatter, span: { s0: numberOr(raw, span.s0), s1: span.s1 } }),
        { step: '0.01', min: '0', max: '1' },
      );
      this.row(
        'span to',
        String(span.s1),
        (raw) => edit({ ...scatter, span: { s0: span.s0, s1: numberOr(raw, span.s1) } }),
        { step: '0.01', min: '0', max: '1' },
      );
    }
    this.el.append(detailLine(`${scatter.asset}, ${scatter.zone}`));
    this.el.append(
      panelButton(scatter.zone === 'infield' ? 'move to the outfield' : 'move to the infield', () =>
        edit({ ...scatter, zone: scatter.zone === 'infield' ? 'outfield' : 'infield' }),
      ),
    );
  }

  private paintPond(index: number): void {
    const record = this.host.record();
    const pond = (record.ponds ?? [])[index];
    if (!pond) return;
    const edit = (next: MortarOverdrivePond): void =>
      this.host.commitDressing({ ponds: replacedAt(record.ponds, index, next) });
    this.row('x', String(pond.x), (raw) => edit({ ...pond, x: numberOr(raw, pond.x) }), {
      step: '0.5',
    });
    this.row('z', String(pond.z), (raw) => edit({ ...pond, z: numberOr(raw, pond.z) }), {
      step: '0.5',
    });
    this.row('radius x', String(pond.rx), (raw) => edit({ ...pond, rx: numberOr(raw, pond.rx) }), {
      step: '0.5',
      min: '0.5',
    });
    this.row('radius z', String(pond.rz), (raw) => edit({ ...pond, rz: numberOr(raw, pond.rz) }), {
      step: '0.5',
      min: '0.5',
    });
    this.row('rotation', String(pond.rot ?? 0), (raw) => edit({ ...pond, rot: numberOr(raw, 0) }), {
      step: '0.05',
    });
    this.row(
      'wobble',
      String(pond.wobble ?? 0.15),
      (raw) => edit({ ...pond, wobble: numberOr(raw, 0.15) }),
      { step: '0.01', min: '0', max: '0.35' },
    );
    this.row(
      'seed',
      String(pond.seed ?? 0),
      (raw) => edit({ ...pond, seed: Math.round(numberOr(raw, 0)) }),
      { step: '1' },
    );
  }
}
