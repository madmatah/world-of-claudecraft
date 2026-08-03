// The 3D preview's DOCK: a floating, movable, resizable panel over the plan.
//
// It replaced a fixed half-screen split, and the reason is what the two views
// are for: the plan is the workshop and the 3D is a MONITOR on it. A monitor
// that permanently eats half the bench makes drawing a 1100 yard lap a
// scrolling exercise, so this one floats where the operator parks it, blows up
// to the whole plan on one chord, and remembers both between sessions.
//
// Chrome only. The preview itself (the scene, the rebuild lifecycle, the camera
// modes) is `preview3d.ts`, and the geometry rules are `layout_core.ts`: this
// module turns pointers into calls and clamped numbers into pixels.

import { editorIcon } from './editor_icons';
import {
  clampDock,
  DOCK_MIN_HEIGHT,
  DOCK_MIN_WIDTH,
  type DockGeometry,
  defaultDock,
  formatShortcut,
  type PlanArea,
  type ShortcutPlatform,
} from './layout_core';
import type { PreviewFlySpeed } from './preview_camera_core';

export interface DockHost {
  /** The operator moved or resized it: worth persisting. */
  onGeometry(dock: DockGeometry): void;
  onFullscreen(on: boolean): void;
  onFollowCursor(on: boolean): void;
  onInvertLook(on: boolean): void;
  onCameraMode(mode: 'fly' | 'orbit'): void;
  onFlySpeed(speed: PreviewFlySpeed): void;
  onFlyFraction(fraction: number): void;
  onClose(): void;
  /** Any geometry change: the GL canvas needs its own resize afterwards. */
  onResized(): void;
}

export class CircuitDock {
  private readonly root = document.getElementById('dock') as HTMLDivElement;
  private readonly headEl = document.getElementById('dockHead') as HTMLDivElement;
  private readonly tabsEl = document.getElementById('dockTabs') as HTMLDivElement;
  private readonly followEl = document.getElementById('dockFollow') as HTMLButtonElement;
  private readonly invertEl = document.getElementById('dockInvert') as HTMLButtonElement;
  private readonly fullEl = document.getElementById('dockFull') as HTMLButtonElement;
  private readonly closeEl = document.getElementById('dockClose') as HTMLButtonElement;
  private readonly resizeEl = document.getElementById('dockResize') as HTMLDivElement;
  private readonly atEl = document.getElementById('dockAt') as HTMLSpanElement;
  private readonly speedEl = document.getElementById('dockSpeed') as HTMLSelectElement;
  private readonly rangeEl = document.getElementById('dockRange') as HTMLInputElement;
  private readonly hintEl = document.getElementById('dockHint') as HTMLSpanElement;
  private readonly flyTab: HTMLButtonElement;
  private readonly orbitTab: HTMLButtonElement;

  private geometry: DockGeometry | null = null;
  private area: PlanArea = { width: 0, height: 0 };
  private fullscreen = false;
  private drag: {
    kind: 'move' | 'resize';
    clientX: number;
    clientY: number;
    from: DockGeometry;
  } | null = null;

  constructor(
    private readonly host: DockHost,
    platform: ShortcutPlatform,
  ) {
    this.flyTab = this.tab('fly', 'Ride the racing line at pace');
    this.orbitTab = this.tab('orbit', 'Orbit the whole circuit from above');
    this.flyTab.onclick = () => this.host.onCameraMode('fly');
    this.orbitTab.onclick = () => this.host.onCameraMode('orbit');

    this.followEl.textContent = 'follows cursor';
    this.followEl.title =
      'The 3D camera rides to wherever the pointer is on the plan, so a corner is looked at by hovering it';
    this.followEl.onclick = () => this.host.onFollowCursor(!this.followEl.classList.contains('on'));

    this.invertEl.textContent = 'invert look';
    this.invertEl.title =
      'Flip the VERTICAL of the fly-through drag: pointer down tips the view up. The horizontal is never inverted';
    this.invertEl.onclick = () => this.host.onInvertLook(!this.invertEl.classList.contains('on'));

    this.fullEl.innerHTML = editorIcon('fullscreen');
    this.fullEl.title = `Fullscreen (${formatShortcut('shift+f', platform)})`;
    this.fullEl.onclick = () => this.host.onFullscreen(!this.fullscreen);

    this.closeEl.innerHTML = editorIcon('close');
    this.closeEl.title = 'Close the 3D dock';
    this.closeEl.onclick = () => this.host.onClose();

    this.speedEl.onchange = () =>
      this.host.onFlySpeed(this.speedEl.value === 'scenic' ? 'scenic' : 'race');
    this.rangeEl.oninput = () => this.host.onFlyFraction(Number(this.rangeEl.value) / 1000);

    this.hintEl.textContent = `${formatShortcut('shift+f', platform)} fullscreen`;

    this.headEl.addEventListener('pointerdown', (ev) => {
      // Buttons in the header are still buttons: only the bar itself drags.
      if (ev.target !== this.headEl && ev.target !== this.tabsEl) return;
      this.startDrag('move', ev);
    });
    this.resizeEl.addEventListener('pointerdown', (ev) => this.startDrag('resize', ev));
    window.addEventListener('pointermove', (ev) => this.moveDrag(ev));
    window.addEventListener('pointerup', () => this.endDrag());
    window.addEventListener('pointercancel', () => this.endDrag());
  }

  private tab(label: 'fly' | 'orbit', detail: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dock-tab';
    button.textContent = label;
    button.title = detail;
    this.tabsEl.append(button);
    return button;
  }

  // ---- geometry ----

  /** The plan resized, or the dock is being shown: re-apply within the area. */
  reflow(area: PlanArea): void {
    this.area = area;
    if (!this.geometry) this.geometry = defaultDock(area);
    this.apply();
  }

  setGeometry(dock: DockGeometry | null, area: PlanArea): void {
    this.area = area;
    this.geometry = dock ? clampDock(dock, area) : defaultDock(area);
    this.apply();
  }

  setOpen(open: boolean): void {
    this.root.hidden = !open;
    if (open) this.apply();
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  setFullscreen(on: boolean): void {
    this.fullscreen = on;
    this.fullEl.classList.toggle('on', on);
    this.apply();
  }

  /**
   * Fullscreen writes the SAME inline geometry as a placed dock rather than a
   * class with `inset: 0`: the placed size lives in inline styles, and a
   * stylesheet rule cannot outrank those without `!important` anywhere.
   */
  private apply(): void {
    const geometry = this.geometry;
    if (!geometry) return;
    const shown = this.fullscreen
      ? { left: 0, top: 0, width: this.area.width, height: this.area.height }
      : clampDock(geometry, this.area);
    this.root.style.left = `${shown.left}px`;
    this.root.style.top = `${shown.top}px`;
    this.root.style.width = `${shown.width}px`;
    this.root.style.height = `${shown.height}px`;
    this.root.classList.toggle('full', this.fullscreen);
    this.host.onResized();
  }

  private startDrag(kind: 'move' | 'resize', ev: PointerEvent): void {
    if (this.fullscreen || !this.geometry) return;
    ev.preventDefault();
    this.drag = { kind, clientX: ev.clientX, clientY: ev.clientY, from: { ...this.geometry } };
  }

  private moveDrag(ev: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    const dx = ev.clientX - drag.clientX;
    const dy = ev.clientY - drag.clientY;
    this.geometry =
      drag.kind === 'move'
        ? { ...drag.from, left: drag.from.left + dx, top: drag.from.top + dy }
        : {
            ...drag.from,
            width: Math.max(DOCK_MIN_WIDTH, drag.from.width + dx),
            height: Math.max(DOCK_MIN_HEIGHT, drag.from.height + dy),
          };
    this.apply();
  }

  private endDrag(): void {
    if (!this.drag) return;
    this.drag = null;
    if (this.geometry) this.host.onGeometry(clampDock(this.geometry, this.area));
  }

  // ---- readouts ----

  setCameraMode(mode: 'fly' | 'orbit', playing: boolean): void {
    // The tab reads the CAMERA, not the transport: a paused ride is a first-class
    // state you look around from, and requiring `playing` here left a paused
    // fly-through showing no selected camera at all.
    this.flyTab.classList.toggle('on', mode === 'fly');
    this.flyTab.textContent = mode === 'fly' && !playing ? 'fly (paused)' : 'fly';
    this.orbitTab.classList.toggle('on', mode === 'orbit');
  }

  setFollowCursor(on: boolean): void {
    this.followEl.classList.toggle('on', on);
  }

  setInvertLook(on: boolean): void {
    this.invertEl.classList.toggle('on', on);
  }

  /** Where on the lap the preview camera sits, in yards, or null before a
   *  circuit is drawn. */
  setAt(yards: number | null, fraction: number): void {
    this.atEl.textContent = yards === null ? 'no circuit yet' : `at ${yards.toFixed(0)} yd`;
    if (document.activeElement !== this.rangeEl) {
      this.rangeEl.value = String(Math.round(fraction * 1000));
    }
  }
}
