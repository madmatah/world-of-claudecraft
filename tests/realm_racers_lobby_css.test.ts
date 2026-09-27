// The lobby curtain's stacking: it covers every HUD surface in #ui except the
// chat frame, which is lifted above it so the grid can talk while it waits.
// jsdom does no layout, so the order is pinned where it is decided: the
// stylesheet rules and the DOM order they rely on.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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

  it('lifts nothing else: the chat frame is the only sibling the curtain lets over it', () => {
    const lifts = [
      ...`${components}\n${mobile}`.matchAll(/#realm-racers-lobby\.shown\s*~\s*([^\s{,]+)/g),
    ];
    expect(lifts.map((m) => m[1])).toEqual(['#chatlog-wrap', '#chatlog-wrap']);
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
