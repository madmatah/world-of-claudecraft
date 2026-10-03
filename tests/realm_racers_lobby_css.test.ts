// The lobby curtain's stacking: it covers every HUD surface in #ui except the
// chat frame, which is lifted above it so the grid can talk while it waits.
// jsdom does no layout, so the order is pinned where it is decided: the
// stylesheet rules and the DOM order they rely on.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RALLY_LOBBY_SHOWN_CLASS, RALLY_RACE_ON_CLASS } from '../src/ui/root_state_classes';

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

// The race strip and the standings are HUD chrome, so an open window draws over
// them. hud.ts raises every window it shows into a band that starts one above
// its floor; at z-index 58 both panels sat over a freshly opened map or
// character window, and over the Esc menu's scrim.
describe('Realm Racers race strip stacking', () => {
  const components = read('src/styles/components.css');
  const hudCss = read('src/styles/hud.css');
  const mobile = read('src/styles/hud.mobile.css');
  const hud = read('src/ui/hud.ts');
  const PANELS = ['#realm-racers-hud', '#realm-racers-standings'];

  it('raises every shown window into a band that starts at 51', () => {
    expect(hud).toContain('private windowZ = 50;');
    expect(hud).toContain('this.windowZ = 50;');
    expect(hud).toContain('el.style.zIndex = String(++this.windowZ);');
  });

  it('keeps both panels under that band, the Esc scrim and the open touch chat', () => {
    const scrim = zIndexOf(components, '#ui::before');
    const touchChat = zIndexOf(mobile, 'body.mobile-touch.mobile-chat-open #chatlog-wrap');
    for (const panel of PANELS) {
      const z = zIndexOf(components, panel);
      expect(z, panel).toBeLessThan(51);
      expect(z, panel).toBeLessThan(scrim);
      expect(z, panel).toBeLessThan(touchChat);
      // ...and still over the party frames the standings is laid over.
      expect(z, panel).toBeGreaterThan(zIndexOf(hudCss, '#party-frames'));
    }
    // The touch sheet re-seats both panels without re-stacking them.
    for (const panel of PANELS) {
      const rule = mobile.slice(mobile.indexOf(`body.mobile-touch ${panel} {`));
      expect(rule.slice(0, rule.indexOf('}')), panel).not.toMatch(/z-index/);
    }
  });
});

/** Every body of a rule whose selector is exactly `selector`. */
function rulesOf(css: string, selector: string): string[] {
  const bodies: string[] = [];
  let at = css.indexOf(`${selector} {`);
  while (at >= 0) {
    const open = at + selector.length + 2;
    bodies.push(css.slice(open, css.indexOf('}', open)).replace(/\s+/g, ' '));
    at = css.indexOf(`${selector} {`, open);
  }
  return bodies;
}

/** The sheet with every whitespace run collapsed (and none just inside a
 *  parenthesis), so a selector the formatter wrapped over several lines still
 *  matches its one-line spelling. */
function flat(css: string): string {
  return css.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')');
}

function declOf(body: string, property: string): string {
  const match = new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(body);
  if (!match) throw new Error(`no ${property} in ${body}`);
  return match[1].trim();
}

// The race's own overlays share the screen with HUD chrome they do not own: the
// result banner, the touch target frame, the touch player frame. The overlaps
// the race captures showed are pinned here where the placement is decided,
// since jsdom does no layout.
describe('Realm Racers race overlays clear their neighbours', () => {
  const components = read('src/styles/components.css');
  const hudCss = read('src/styles/hud.css');
  const mobile = read('src/styles/hud.mobile.css');
  const tokens = read('src/styles/tokens.css');

  // The race's plain banners (GO, the lap, the result, the circuit) ride the
  // band ABOVE the strip while a race is on: at the default line they landed on
  // the strip's phase line (desktop) and under its readout row (touch).
  // Celebration plates keep their own slot.
  const RACE_BANNER =
    '#banner:not(.banner-with-art, .has-subtext, .banner-world-quest, .banner-loot, .banner-deed, .banner-skill)';

  it('rides the plain race banners in the band above the desktop strip', () => {
    const banner = rulesOf(flat(components), `body.${RALLY_RACE_ON_CLASS} ${RACE_BANNER}`)[0];
    expect(banner).toBeDefined();
    const top = Number.parseFloat(declOf(banner, 'top'));
    const size = /^clamp\((\d+)px, [\d.]+vw, (\d+)px\)$/.exec(declOf(banner, 'font-size'));
    expect(size).not.toBeNull();
    const line =
      Number(size?.[2]) * Number.parseFloat(declOf(rulesOf(hudCss, '#banner')[0], 'line-height'));
    const strip = Number.parseFloat(declOf(rulesOf(components, '#realm-racers-hud')[0], 'top'));
    expect(top + line).toBeLessThan(strip);
  });

  it('rides the plain race banners in the band above the touch strip, at every inset', () => {
    const banner = rulesOf(
      flat(mobile),
      `body.mobile-touch.${RALLY_RACE_ON_CLASS} ${RACE_BANNER}`,
    )[0];
    expect(banner).toBeDefined();
    const top = /^max\((\d+)px, env\(safe-area-inset-top\)\)$/.exec(declOf(banner, 'top'));
    expect(top).not.toBeNull();
    const touchBanner = rulesOf(mobile, 'body.mobile-touch #banner')[0];
    const size = /^calc\((\d+)px \* var\(--mobile-chrome-scale, 1\)\)$/.exec(
      declOf(touchBanner, 'font-size'),
    );
    expect(size).not.toBeNull();
    // Scale 1 is the largest the touch chrome runs at (landscape phones use 0.85).
    const line = Number(size?.[1]) * Number.parseFloat(declOf(touchBanner, 'line-height'));
    const strip = /^max\((\d+)px, calc\(env\(safe-area-inset-top\) \+ (\d+)px\)\)$/.exec(
      declOf(rulesOf(mobile, 'body.mobile-touch #realm-racers-hud')[0], 'top'),
    );
    expect(strip).not.toBeNull();
    // No inset: the fixed floors. A notch: the banner starts at the inset and
    // the strip sits a fixed step below it.
    expect(Number(top?.[1]) + line).toBeLessThan(Number(strip?.[1]));
    expect(line).toBeLessThan(Number(strip?.[2]));
    // Ungated like the 18% rule it overrides: inside the coarse-pointer block,
    // a touch interface on a fine pointer would keep the banner under the strip.
    const lift = flat(mobile).indexOf(`body.mobile-touch.${RALLY_RACE_ON_CLASS} ${RACE_BANNER}`);
    const coarse = flat(mobile).indexOf(
      '@media (pointer: coarse) { body.mobile-touch #realm-racers-window {',
    );
    expect(coarse).toBeGreaterThan(-1);
    expect(lift).toBeLessThan(coarse);
    const layer = flat(mobile).lastIndexOf('@layer hud-mobile {', lift);
    expect(flat(mobile).slice(layer, lift)).not.toContain('@media');
  });

  it('stands the new-adventurer card and its arrow down for the race', () => {
    const rule = rulesOf(
      flat(components),
      `body.${RALLY_RACE_ON_CLASS} .tut-card:not(.nb-popup, .rb-popup), body.${RALLY_RACE_ON_CLASS} .tut-arrow`,
    )[0];
    expect(rule).toBeDefined();
    // visibility, not display: the tutorial writes the arrow's display inline,
    // and the card comes back as it was the moment the class drops.
    expect(declOf(rule, 'visibility')).toBe('hidden');
  });

  it('hangs the desktop podium under the default banner line a finish deed plate takes', () => {
    const banner = rulesOf(hudCss, '#banner')[0];
    const bannerTop = /^(\d+)%$/.exec(declOf(banner, 'top'));
    expect(bannerTop).not.toBeNull();
    const bannerLine =
      Number.parseFloat(declOf(banner, 'font-size')) *
      Number.parseFloat(declOf(banner, 'line-height'));
    const [podium, shown] = [
      rulesOf(components, '#realm-racers-podium')[0],
      rulesOf(components, '#realm-racers-podium.shown')[0],
    ];
    const podiumTop = /^calc\((\d+)% \+ (\d+)px\)$/.exec(declOf(podium, 'top'));
    expect(podiumTop).not.toBeNull();
    const [, percent, offset] = podiumTop as RegExpExecArray;
    expect(percent).toBe((bannerTop as RegExpExecArray)[1]);
    expect(Number(offset)).toBeGreaterThan(bannerLine);
    // Top-anchored: a -50% centring shift would pull it back over the banner.
    expect(declOf(podium, 'transform')).not.toContain('-50%)');
    expect(declOf(shown, 'transform')).toBe('translate(-50%, 0)');
  });

  it('keeps the touch standings under the touch target seat at every tier', () => {
    const seats = rulesOf(mobile, 'body.mobile-touch #target-frame').filter((body) =>
      /transform: scale\(/.test(body),
    );
    const standings = rulesOf(mobile, 'body.mobile-touch #realm-racers-standings');
    expect(seats.length).toBeGreaterThanOrEqual(2);
    for (const seat of seats) {
      const seatTop = declOf(seat, 'top');
      const scale = /var\((--mobile-unit-frame-scale[\w-]*)\)/.exec(seat)?.[1];
      expect(scale, seat).toBeDefined();
      const match = standings.find((body) => {
        const top = declOf(body, 'top');
        return (
          top.includes(seatTop) &&
          top.includes(`var(${scale})`) &&
          top.includes('var(--mobile-chrome-scale, 1)')
        );
      });
      expect(match, `standings under the seat at ${seatTop} scaled by ${scale}`).toBeDefined();
    }
  });

  it('widens the touch standings toward a full house-pilot name, never into the strip', () => {
    const body = rulesOf(flat(mobile), 'body.mobile-touch #realm-racers-standings')[0];
    const left = declOf(body, 'left');
    const width = /^clamp\((\d+)px, calc\(50vw - (\d+)px - (.+)\), (\d+)px\)$/.exec(
      declOf(body, 'width'),
    );
    expect(width, declOf(body, 'width')).not.toBeNull();
    const [, floor, halfStrip, inset, cap] = width as RegExpExecArray;
    // The floor is the width every phone had before, so the narrowest keeps it.
    expect(Number(floor)).toBe(168);
    // The width gives back exactly the left offset, notch included.
    expect(inset).toBe(left);
    // The strip's readout and action rows are about 272px wide, centred: the
    // reserved half keeps a margin past their edge for longer locales.
    expect(Number(halfStrip)).toBeGreaterThanOrEqual(136 + 16);
    // At the cap the longest house pilot fits at the touch size: placing,
    // name (16 characters at about 6px), Bot tag and lap, with the row padding.
    expect(Number(cap)).toBeGreaterThanOrEqual(8 + 13 + 6 + 16 * 6 + 4 + 29 + 6 + 28 + 8);
  });

  it('lays the touch podium on a solid ground over the strip and the banner', () => {
    const podium = rulesOf(mobile, 'body.mobile-touch #realm-racers-podium')[0];
    const ground = /^var\((--[\w-]+)\)$/.exec(declOf(podium, 'background'))?.[1];
    expect(ground).toBeDefined();
    const value = new RegExp(`${ground}:\\s*(#[0-9a-f]+);`).exec(tokens)?.[1];
    expect(value).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('shrinks the touch pickup splash into the band above the landscape player frame', () => {
    const splash = rulesOf(mobile, 'body.mobile-touch #realm-racers-splash')[0];
    const icon = rulesOf(mobile, 'body.mobile-touch .rally-splash-icon')[0];
    const label = rulesOf(mobile, 'body.mobile-touch .rally-splash-label')[0];
    const px = (body: string, property: string): number =>
      Number.parseFloat(declOf(body, property));
    const [padTop, , padBottom] = declOf(label, 'padding')
      .split(' ')
      .map((part) => Number.parseFloat(part));
    const labelHeight = px(label, 'font-size') * 1.25 + padTop + (padBottom ?? padTop) + 2;
    const bottom = px(splash, 'top') + px(icon, 'height') + px(splash, 'gap') + labelHeight;
    // The landscape player frame starts at 321px on a 390px-tall phone; the
    // splash keeps a margin above it.
    expect(bottom).toBeLessThan(310);
    expect(px(icon, 'height')).toBeLessThan(
      px(rulesOf(components, '.rally-splash-icon')[0], 'height'),
    );
  });
});
