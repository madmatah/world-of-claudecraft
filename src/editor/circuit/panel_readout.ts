// The readout, as elements: one builder per section, plus the two surfaces that
// show them.
//
// Sections rather than one paint, because two surfaces show them: the drawer
// shows every one, and a tabless mode's right column shows the SECTIONS ITS OWN
// TOOL IS ABOUT (shape's geometry while shaping, the road profile while painting
// it). One builder each, so the two can never quote a different number for the
// same measurement.
//
// Every number here is read off `src/sim/realm_racers_circuit_metrics.ts`, the
// same readout a content test runs over every shipped circuit. Nothing is
// computed in this file.

import type { RealmRacersCircuitProblem } from '../../sim/realm_racers_circuit_metrics';
import { realmRacersPlacements } from '../../sim/realm_racers_props_resolve';
import { realmRacersGates } from '../../sim/realm_racers_spline';
import { MAX_PERIMETER_HALF_X, MAX_PERIMETER_HALF_Z } from './envelope_core';
import { problemDetail, problemHeadline } from './layout_core';
import {
  MAX_LISTED_PROBLEMS,
  MODE_READOUT,
  READOUT_SECTIONS,
  type ReadoutSection,
} from './panel_core';
import { heading, hintLine, type PanelHost } from './panels';

function row(table: HTMLTableElement, key: string, value: string, cls = ''): void {
  const tr = table.insertRow();
  const k = tr.insertCell();
  k.className = 'k';
  k.textContent = key;
  const v = tr.insertCell();
  v.className = `v ${cls}`.trim();
  v.textContent = value;
}

function problemLine(problem: RealmRacersCircuitProblem): HTMLDivElement {
  const div = document.createElement('div');
  div.className = `problem ${problem.severity}`;
  const label = document.createElement('div');
  label.className = 'c';
  label.textContent = problemHeadline(problem);
  const detail = document.createElement('div');
  detail.className = 'd';
  detail.textContent = problemDetail(problem);
  div.append(label, detail);
  return div;
}

export function readoutSection(host: PanelHost, section: ReadoutSection): HTMLElement[] {
  const record = host.record();
  const metrics = host.metrics();
  const table = document.createElement('table');
  switch (section) {
    case 'shape':
      row(table, 'lap', `${metrics.lapLength.toFixed(1)} yd`);
      row(table, 'samples', String(metrics.sampleCount));
      row(
        table,
        'total turning',
        `${metrics.turningDegrees.toFixed(1)} deg`,
        Math.abs(Math.abs(metrics.turningDegrees) - 360) > 5 ? 'bad' : 'good',
      );
      row(
        table,
        'winding',
        metrics.winding > 0 ? 'counter-clockwise' : 'clockwise',
        metrics.winding > 0 ? 'good' : 'bad',
      );
      row(table, 'control points', String(record.controlPoints.length));
      break;
    case 'corners':
      row(table, 'tightest corner', `${metrics.tightestRadius.toFixed(1)} yd`);
      row(
        table,
        'radius / road',
        metrics.minRadiusOverWidth.toFixed(2),
        metrics.minRadiusOverWidth < 1 ? 'bad' : metrics.minRadiusOverWidth < 1.5 ? 'warn' : 'good',
      );
      row(table, 'at', `${metrics.minRadiusOverWidthAtS.toFixed(0)} yd`);
      break;
    case 'stretches': {
      const nearest = metrics.nearestApproach;
      row(
        table,
        'nearest approach',
        Number.isFinite(nearest.distance) ? `${nearest.distance.toFixed(1)} yd` : 'none',
        Number.isFinite(nearest.distance) && nearest.distance < 48 ? 'bad' : 'good',
      );
      row(table, 'tangent dot', nearest.tangentDot.toFixed(2));
      row(table, 'between', `${nearest.s.toFixed(0)} and ${nearest.otherS.toFixed(0)} yd`);
      row(table, 'shooting corridor', `${metrics.shootingCorridorYards.toFixed(0)} yd`);
      break;
    }
    case 'surface': {
      // What the brush actually left on the circuit, read back off the derived
      // samples rather than off the band table: the table is breakpoints and the
      // road is samples, and only the second one is what a racer meets.
      const halfWidths = host.track().samples.map((sample) => sample.halfWidth);
      row(
        table,
        'road half-width',
        `${Math.min(...halfWidths).toFixed(1)} to ${Math.max(...halfWidths).toFixed(1)} yd`,
      );
      row(table, 'width bands', String(record.widthBands.length));
      row(table, 'recovery anchors', String(realmRacersGates(record).length));
      // Beside the anchors rather than with the dressing: both are race
      // furniture the ROAD decides the shape of, and the width the operator is
      // painting here is what a row spreads over.
      row(table, 'pickup rows', String(metrics.pickupRowCount));
      break;
    }
    case 'dressing': {
      // What is STANDING on the circuit, counted off the resolver rather than off
      // the record: a scatter is a handful of rows and hundreds of pieces, and
      // the pieces are what the operator is looking at.
      row(table, 'props', String(metrics.propCount));
      row(table, 'solid props', String(metrics.solidPropCount));
      row(table, 'scatters', `${record.scatters?.length ?? 0} (${metrics.scatterCount} pieces)`);
      row(table, 'ponds', String(metrics.pondCount));
      row(table, 'water authored', record.basin ? 'yes' : 'no');
      const unknown = realmRacersPlacements(record).unknownAssets;
      if (unknown.length > 0) row(table, 'unknown keys', unknown.join(', '), 'bad');
      break;
    }
    default:
      row(table, 'road half-extent x', `${metrics.roadHalfX.toFixed(0)} yd`);
      row(table, 'road half-extent z', `${metrics.roadHalfZ.toFixed(0)} yd`);
      // The two ceilings a WALL lives under, so a circuit that cannot fit the
      // band says so BEFORE the operator has drawn a lap around it. They are the
      // instance volume's own ceilings less the yard that keeps the wall inside
      // it, because the volume itself is no longer a number anybody authors.
      row(
        table,
        'widest wall',
        `${MAX_PERIMETER_HALF_X} yd`,
        record.perimeter.halfX > MAX_PERIMETER_HALF_X ? 'bad' : '',
      );
      row(
        table,
        'deepest wall',
        `${MAX_PERIMETER_HALF_Z} yd`,
        record.perimeter.halfZ > MAX_PERIMETER_HALF_Z ? 'bad' : '',
      );
      break;
  }
  return [heading(section), table];
}

export function problemsBlock(problems: readonly RealmRacersCircuitProblem[]): HTMLElement[] {
  const out: HTMLElement[] = [heading('problems')];
  if (problems.length === 0) {
    const clean = document.createElement('div');
    clean.className = 'clean';
    clean.textContent = 'none: this is drivable geometry';
    out.push(clean);
    return out;
  }
  // Capped, and the cap SAYS so: a list that silently stopped at ten would read
  // as "ten problems" when there are thirty.
  for (const problem of problems.slice(0, MAX_LISTED_PROBLEMS)) out.push(problemLine(problem));
  if (problems.length > MAX_LISTED_PROBLEMS) {
    const more = document.createElement('div');
    more.className = 'd';
    more.textContent = `and ${problems.length - MAX_LISTED_PROBLEMS} more`;
    out.push(more);
  }
  return out;
}

/** The whole readout, section by section, in the drawer the View menu opens. */
export class MetricsDrawerPanel {
  constructor(
    private readonly host: PanelHost,
    private readonly body: HTMLElement,
  ) {}

  paint(): void {
    this.body.replaceChildren();
    if (!this.host.drawn()) return;
    for (const section of READOUT_SECTIONS) this.body.append(...readoutSection(this.host, section));
    this.body.append(...problemsBlock(this.host.metrics().problems));
  }
}

/** What a mode with no tabs shows instead: the measurements its own tool changes. */
export class ModeReadoutPanel {
  readonly el = document.createElement('div');

  constructor(private readonly host: PanelHost) {}

  paint(): void {
    if (this.el.hidden) return;
    this.el.replaceChildren();
    if (!this.host.drawn()) return;
    for (const section of MODE_READOUT[this.host.mode()]) {
      this.el.append(...readoutSection(this.host, section));
    }
    this.el.append(hintLine('the whole readout is under View > metrics detail'));
  }
}
