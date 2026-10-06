// The area music layer (a Mortar Overdrive circuit): looped mp3s that crossfade
// against each other and duck the procedural score while you stand there. Same
// file-track pattern as the boss loop; catalog in music_tracks.ts. It sits
// beside MusicDirector instead of inside it (the music.ts monolith ratchet),
// the minigame_music_layer.ts way: the director keeps thin hooks, and this layer
// reads the director's private mix plumbing through an untyped host, welded to
// music.ts in tests/music.test.ts.
import { resumeWhenAllowed } from './audio_unlock';
import {
  AREA_TRACK_GROUP,
  AREA_TRACK_URLS,
  type AreaTrackId,
  MORTAR_OVERDRIVE_AREA_TRACKS,
} from './music_tracks';

export type { AreaTrackId } from './music_tracks';

// Same idea for the area file tracks, whose gain fades on a 0.5s time constant:
// after 2.5s the outgoing track sits below 1% (under -40 dB), so pausing it then
// is inaudible where pausing it mid-fade would clip the tail.
const AREA_FADE_PAUSE_MS = 2500;

/** The private MusicDirector members the layer reads and drives. */
interface MusicDirectorHost {
  ctx: AudioContext | null;
  master: GainNode | null;
  _enabled: boolean;
  _menuPaused: boolean;
  _vol: number;
  masterTarget(): number;
  streamKeeper(): void;
  applyBossPlayback(): void;
}

export class AreaTrackLayer {
  areaEls: Partial<Record<AreaTrackId, HTMLAudioElement>> = {};
  areaGains: Partial<Record<AreaTrackId, GainNode>> = {};
  private areaPauseTimer = 0;
  // A dedicated file track owns the mix, and an AREA track is one: a Mortar Overdrive
  // circuit ducks the procedural score exactly the way the boss loop does,
  // so it rides the policy's one file-track flag (music_mix_policy.ts).
  areaTrack: AreaTrackId | null = null;

  constructor(private readonly director: object) {}

  private get host(): MusicDirectorHost {
    return this.director as MusicDirectorHost;
  }

  /** One silent gain per area track, wired into the director's compressor at init(). */
  wireGains(ctx: AudioContext, compressor: AudioNode): void {
    for (const id of Object.keys(AREA_TRACK_URLS) as AreaTrackId[]) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(compressor);
      this.areaGains[id] = gain;
    }
  }

  /** Drive the area music: which dedicated file track owns the mix right now
   *  (a circuit's own track on the Mortar Overdrive band), null when the player is in none
   *  of those places. Idempotent; the HUD calls it every frame. Crossfades
   *  between the tracks and ducks the procedural score while active. */
  setAreaTrack(track: AreaTrackId | null, restart = false): void {
    const changed = track !== this.areaTrack;
    if (track !== null && MORTAR_OVERDRIVE_AREA_TRACKS.has(track) && (changed || restart)) {
      // Keep the downloaded element cached, but start each circuit visit and
      // each new match from the top of the soundtrack.
      this.ensureAreaElements(track);
      const race = this.areaEls[track];
      if (race) {
        try {
          race.currentTime = 0;
        } catch {
          /* browser may reject seeking before metadata */
        }
      }
    }
    if (track === this.areaTrack) {
      this.applyAreaTracks();
      return;
    }
    const enteringOrLeaving = (this.areaTrack === null) !== (track === null);
    this.areaTrack = track;
    this.applyAreaTracks();
    const h = this.host;
    if (h.ctx && h.master && enteringOrLeaving) {
      h.master.gain.setTargetAtTime(h.masterTarget(), h.ctx.currentTime, track ? 0.4 : 0.7);
    }
    // walking away from the area must revive paused streams now
    if (enteringOrLeaving && track === null) h.streamKeeper();
  }

  // Create (and so start downloading) the tracks of the active track's place.
  // Lazily and per group: an area soundtrack is minutes long, and the places
  // are far apart, so nothing warms a track the player cannot hear next.
  private ensureAreaElements(active: AreaTrackId): void {
    const ctx = this.host.ctx;
    if (!ctx || typeof Audio !== 'function') return;
    for (const [id, url] of Object.entries(AREA_TRACK_URLS) as [AreaTrackId, string][]) {
      if (AREA_TRACK_GROUP[id] !== AREA_TRACK_GROUP[active] || this.areaEls[id]) continue;
      const el = new Audio(url);
      el.loop = true;
      el.preload = 'auto';
      try {
        const src = this.host.ctx?.createMediaElementSource(el);
        const gain = this.areaGains[id];
        if (src && gain) src.connect(gain);
      } catch {
        /* element already wired or unsupported */
      }
      this.areaEls[id] = el;
    }
  }

  // Which area track should be audible right now: the selected one unless the
  // toggle, the menu fade, or a zero volume has the whole mix down. Same rule
  // as streamsAudible(), so a silenced track stops decoding rather than playing
  // to nobody.
  private audibleAreaTrack(): AreaTrackId | null {
    const h = this.host;
    return h._enabled && !h._menuPaused && h._vol > 0 ? this.areaTrack : null;
  }

  /** The director's two dedicated file tracks, in this order: its boss loop,
   *  then the area tracks. The director's mix hooks (volume, toggle, menu fade
   *  and restore) make this one call in place of that pair. */
  applyFileTracks(): void {
    this.host.applyBossPlayback();
    this.applyAreaTracks();
  }

  applyAreaTracks(): void {
    const ctx = this.host.ctx;
    if (!ctx) return;
    const playing = this.audibleAreaTrack();
    const level = 0.5 * this.host._vol;
    if (playing) {
      resumeWhenAllowed(ctx);
      this.ensureAreaElements(playing);
      void this.areaEls[playing]?.play().catch(() => {});
    }
    for (const id of Object.keys(AREA_TRACK_URLS) as AreaTrackId[]) {
      this.areaGains[id]?.gain.setTargetAtTime(id === playing ? level : 0, ctx.currentTime, 0.5);
    }
    // Let the gain fade finish, then pause whatever no longer owns the mix so it
    // stops decoding and downloading (pausing it mid-fade would clip the tail).
    // Re-checked inside the timeout: a quick re-entry may have handed the mix
    // straight back before it fires.
    const stale = (Object.keys(this.areaEls) as AreaTrackId[]).some(
      (id) => id !== playing && this.areaEls[id]?.paused === false,
    );
    if (stale && this.areaPauseTimer === 0) {
      this.areaPauseTimer = window.setTimeout(() => {
        this.areaPauseTimer = 0;
        const keep = this.audibleAreaTrack();
        for (const id of Object.keys(this.areaEls) as AreaTrackId[]) {
          if (id !== keep) this.areaEls[id]?.pause();
        }
      }, AREA_FADE_PAUSE_MS);
    }
  }
}

const layers = new WeakMap<object, AreaTrackLayer>();

/** The one area-track layer of a MusicDirector, created on first use. */
export function areaTrackLayerFor(director: object): AreaTrackLayer {
  let layer = layers.get(director);
  if (!layer) {
    layer = new AreaTrackLayer(director);
    layers.set(director, layer);
  }
  return layer;
}
