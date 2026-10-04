// The pickup splash, on screen: one big icon plus one line, popped over the HUD
// the instant a box gives a racer something, held about a second, then gone.
//
// It is EVENT driven, not per-frame. `Hud.handleEvents` calls `show()` on the
// `realmRacersPickup` it already routes; the visuals are one CSS animation and a
// single one-shot timer, so nothing here runs on the frame loop and nothing has
// to be elided every tick. That is the same shape the banner family uses, and it
// is why this is a cold module rather than a hot painter.
//
// The three contracts it does hold, per `src/ui/CLAUDE.md`:
//
//  - NO forced-reflow layout read (no `offsetWidth`, no `getBoundingClientRect`,
//    no `getComputedStyle`), and no repeating driver of its own: the only timer
//    is a one-shot that takes the element down again.
//  - Every write that can repeat goes through the shared elided writers, so a
//    second splash of the same effect re-stamps nothing; the element itself is
//    built once, lazily, on the first splash a race produces.
//  - FAIRNESS: no graphics tier, no effects preset, no governor. Every player
//    sees the same splash, because it is the only readout of what a box gave.
//
// Placement is deliberate and mobile-first: the splash sits UNDER the race strip
// at the top of the screen, never centred over the lower half, so it can never
// cover the touch stick or the on-screen buttons.

import type { RallyPickupEffect } from '../sim/realm_racers_pickup_effects';
import { t } from './i18n';
import type { PainterHostWriters } from './painter_host';
import {
  RALLY_SPLASH_LIFE_MS,
  type RallyPickupSplashIcon,
  rallyPickupSplashView,
} from './realm_racers_pickup_splash_view';

export interface RallyPickupSplashDeps {
  /** The HUD layer the element is parented to, or null before it exists. */
  layer(): HTMLElement | null;
  /** The shared write-elision facet (`Hud`'s), never a second cache. */
  writers: PainterHostWriters;
  /** Composes the icon through the shared icon machinery. */
  iconUrl(icon: RallyPickupSplashIcon): string;
  /** One-shot scheduling, injected so a test drives it with no timers. Returns
   *  a handle the next splash cancels. */
  schedule(callback: () => void, delayMs: number): number;
  cancel(handle: number): void;
}

export class RealmRacersPickupSplash {
  private root: HTMLElement | null = null;
  private iconEl: HTMLImageElement | null = null;
  private labelEl: HTMLElement | null = null;
  private timer = 0;
  /** Flips every splash so the CSS animation restarts even when the same effect
   *  is drawn twice in a row (a class that is already there animates nothing). */
  private flip = false;

  constructor(private readonly deps: RallyPickupSplashDeps) {}

  /** Show what a box just gave. Cancels whatever is on screen: a second box a
   *  second later is a new moment, not a queue. */
  show(effect: RallyPickupEffect): void {
    const root = this.ensure();
    if (!root || !this.iconEl || !this.labelEl) return;
    const view = rallyPickupSplashView(effect);
    const w = this.deps.writers;
    if (this.timer) this.deps.cancel(this.timer);
    w.setAttr(this.iconEl, 'src', this.deps.iconUrl(view.icon));
    // Decorative: the LINE beside it is the accessible text, and a duplicate
    // alt would announce the same thing twice.
    w.setAttr(this.iconEl, 'alt', '');
    w.setText(this.labelEl, t(view.labelKey));
    this.flip = !this.flip;
    for (const tone of TONES) w.toggleClass(root, `rally-splash-${tone}`, tone === view.tone);
    w.toggleClass(root, 'rally-splash-a', this.flip);
    w.toggleClass(root, 'rally-splash-b', !this.flip);
    w.setDisplay(root, 'flex');
    this.timer = this.deps.schedule(() => {
      this.timer = 0;
      if (this.root) this.deps.writers.setDisplay(this.root, 'none');
    }, RALLY_SPLASH_LIFE_MS);
  }

  /** Take it down at once (a race ending under a splash, a locale flip). The
   *  splash is a moment of about a second whose label was resolved at show(),
   *  so rather than re-resolve it mid-flight, Hud's locale fan-out takes it down. */
  clear(): void {
    if (this.timer) {
      this.deps.cancel(this.timer);
      this.timer = 0;
    }
    if (this.root) this.deps.writers.setDisplay(this.root, 'none');
  }

  private ensure(): HTMLElement | null {
    if (this.root) return this.root;
    const layer = this.deps.layer();
    if (!layer) return null;
    const root = document.createElement('div');
    root.id = 'realm-racers-splash';
    // Polite, and NOT an alert: it is a reward, not something to interrupt a
    // screen reader mid-sentence for.
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    root.style.display = 'none';
    const icon = document.createElement('img');
    icon.className = 'rally-splash-icon';
    const label = document.createElement('div');
    label.className = 'rally-splash-label';
    root.appendChild(icon);
    root.appendChild(label);
    layer.appendChild(root);
    this.root = root;
    this.iconEl = icon;
    this.labelEl = label;
    return root;
  }
}

/** Every tone token the view can hand back, so the swap clears the previous
 *  one. A closed list rather than a class scrub, because the element carries
 *  the two animation-restart tokens too. */
const TONES = ['charge', 'nitro', 'ward', 'slick'] as const;
