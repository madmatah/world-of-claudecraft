// The outliner: what is STANDING on this circuit, entry by entry.
//
// The drawer counts the dressing in aggregate, which answers "how much" and
// never "which one", and on a dressed circuit the fourth lantern is the thing
// an operator is looking for.

import { REALM_RACERS_PROPS } from '../../sim/content/realm_racers_props';
import { realmRacersPlacements } from '../../sim/realm_racers_props_resolve';
import { heading, hintLine, type PanelHost } from './panels';
import { placedPropIndices } from './props_core';

function outlinerRow(name: string, detail: string, solid = false): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'outline-row';
  const label = document.createElement('span');
  label.className = 'n';
  label.textContent = name;
  const note = document.createElement('span');
  note.textContent = detail;
  row.append(label, note);
  if (solid) {
    const mark = document.createElement('span');
    mark.className = 'solid';
    mark.textContent = 'solid';
    row.append(mark);
  }
  return row;
}

export class OutlinerPanel {
  readonly el = document.createElement('div');

  constructor(private readonly host: PanelHost) {}

  paint(): void {
    if (this.el.hidden) return;
    this.el.replaceChildren();
    if (!this.host.drawn()) return;
    const record = this.host.record();
    const placements = realmRacersPlacements(record);
    const props = record.props ?? [];
    // Hoisted: called per prop it walks the whole list per prop, which is
    // quadratic and allocates an array each time, on a path that runs per frame.
    const placed = placedPropIndices(props, REALM_RACERS_PROPS);

    this.el.append(heading(`props (${props.length})`));
    if (props.length === 0) this.el.append(outlinerRow('nothing placed', ''));
    props.forEach((prop, index) => {
      const at = placements.props[placed.indexOf(index)];
      const where = at ? `${at.x.toFixed(0)}, ${at.z.toFixed(0)}` : 'not drawn';
      this.el.append(outlinerRow(prop.asset, where, Boolean(at?.solid)));
    });

    const scatters = record.scatters ?? [];
    this.el.append(
      heading(`scatters (${scatters.length}, ${this.host.metrics().scatterCount} pieces)`),
    );
    for (const scatter of scatters) {
      this.el.append(outlinerRow(scatter.asset, `${scatter.zone}, ${scatter.spacing} yd`));
    }

    const ponds = record.ponds ?? [];
    this.el.append(heading(`ponds (${ponds.length})`));
    ponds.forEach((pond, index) => {
      this.el.append(
        outlinerRow(
          `pond ${index}`,
          `${(pond.rx * 2).toFixed(0)} x ${(pond.rz * 2).toFixed(0)} yd`,
        ),
      );
    });

    this.el.append(hintLine('click a piece on the plan to edit its numbers'));
  }
}
