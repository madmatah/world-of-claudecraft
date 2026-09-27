// The lobby curtain's stacking: it covers every HUD surface in #ui except the
// chat frame, which is lifted above it so the grid can talk while it waits.
// jsdom does no layout, so the order is pinned where it is decided: the
// stylesheet rules and the DOM order they rely on.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RALLY_LOBBY_SHOWN_CLASS } from '../src/ui/root_state_classes';

const root = new URL('../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');

function zIndexOf(css: string, selector: string): number {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`missing rule ${selector}`);
  const body = css.slice(at, css.indexOf('}', at));
  const match = /z-index:\s*(\d+)/.exec(body);
  if (!match) throw new Error(`no z-index in ${selector}`);
  return Number(match[1]);
}

describe('Realm Racers lobby curtain stacking', () => {
  const components = read('src/styles/components.css');
  const mobile = read('src/styles/hud.mobile.css');

  it('lifts the chat frame above the curtain on desktop and on touch', () => {
    const curtain = zIndexOf(components, '#realm-racers-lobby');
    expect(zIndexOf(components, '#realm-racers-lobby.shown ~ #chatlog-wrap')).toBeGreaterThan(
      curtain,
    );
    expect(
      zIndexOf(mobile, 'body.mobile-touch #realm-racers-lobby.shown ~ #chatlog-wrap'),
    ).toBeGreaterThan(curtain);
    // The touch chat frame's own stacking must stay below the lift.
    expect(zIndexOf(mobile, 'body.mobile-touch.mobile-chat-open #chatlog-wrap')).toBeLessThan(
      curtain,
    );
  });

  it('lifts exactly the chat frame and the touch chat control, nothing else', () => {
    const all = `${components}\n${mobile}`;
    const siblings = [...all.matchAll(/#realm-racers-lobby\.shown\s*~\s*([^\s{,]+)/g)].map(
      (m) => m[1],
    );
    expect(siblings).toEqual(['#chatlog-wrap', '#chatlog-wrap']);
    // The touch controls layer sits under #ui; while the curtain is shown it is
    // raised over #ui and hidden, then only the chat route is shown again.
    const stateSelector = `.${RALLY_LOBBY_SHOWN_CLASS}`;
    const layer = 'body.mobile-touch.game-active.rally-lobby-shown #mobile-controls';
    expect(layer).toContain(stateSelector);
    expect(zIndexOf(mobile, layer)).toBeGreaterThan(
      zIndexOf(mobile, 'body.mobile-touch.game-active #ui'),
    );
    const layerRule = mobile.slice(mobile.indexOf(`${layer} {`));
    expect(layerRule.slice(0, layerRule.indexOf('}'))).toMatch(/visibility:\s*hidden/);
    const shownAgain = [
      ...all.matchAll(/body\.mobile-touch\.rally-lobby-shown (#[\w-]+)[,\s{]/g),
    ].map((m) => m[1]);
    expect(new Set(shownAgain)).toEqual(new Set(['#mobile-menu-anchor', '#mobile-menu-chat']));
    const shownRule = mobile.slice(
      mobile.indexOf('body.mobile-touch.rally-lobby-shown #mobile-menu-anchor'),
    );
    expect(shownRule.slice(0, shownRule.indexOf('}'))).toMatch(/visibility:\s*visible/);
    // Every rule keyed on the state class is one of the two above.
    const keyed = [...all.matchAll(/([^{}]*\.rally-lobby-shown[^{]*)\{/g)].length;
    expect(keyed).toBe(2);
  });

  it('keeps the chat route inside the touch controls layer the rule raises', () => {
    // The layer is a body-level sibling of #ui in both entries (a section in one,
    // a div in the other); both controls come after it opens and before #ui's
    // next sibling after it, the window backdrop.
    for (const entry of ['index.html', 'play.html']) {
      const html = read(entry);
      const layerAt = html.search(/<(section|div) id="mobile-controls"/);
      const layerEnd = html.indexOf('id="mobile-window-backdrop"', layerAt);
      expect(layerAt, entry).toBeGreaterThan(html.indexOf('<div id="ui"'));
      for (const id of ['mobile-menu-anchor', 'mobile-menu-chat']) {
        const at = html.indexOf(`id="${id}"`);
        expect(at > layerAt && at < layerEnd, `${entry} ${id}`).toBe(true);
      }
    }
  });

  it('keeps the chat frame inside #ui, beside the curtain the sibling rule starts from', () => {
    for (const entry of ['index.html', 'play.html']) {
      const html = read(entry);
      const ui = html.indexOf('<div id="ui"');
      const chat = html.indexOf('<div id="chatlog-wrap">');
      expect(ui, entry).toBeGreaterThanOrEqual(0);
      expect(chat, entry).toBeGreaterThan(ui);
    }
  });

  it('mounts the curtain first in the layer and keeps the desktop composer above #ui', () => {
    const painter = read('src/ui/hud/realm_racers/realm_racers_lobby_painter.ts');
    expect(painter).toContain('layer.prepend(el);');
    expect(painter).not.toContain('layer.appendChild(el);');
    expect(zIndexOf(read('src/styles/hud.css'), '#chat-input')).toBeGreaterThan(
      zIndexOf(read('src/styles/base.css'), '#ui'),
    );
  });
});
