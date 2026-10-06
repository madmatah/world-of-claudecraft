// Remastered soundtrack catalog: the streamed mp3 renders of the procedural
// themes, served from public/audio/music/. The composition machinery in
// music.ts remains the authoring source (music editor + offline render
// pipeline); these files are its remastered renders and own runtime playback.
// Pure data + math, DOM-free, so it unit-tests in plain Node.
//
// Each URL carries a `?v=<hash12>` content hash (first 12 hex chars of the
// file's sha256), same convention as the sampled SFX manifest
// (scripts/sfx/manifest.mjs), so server/static_cache.ts can serve these large
// (multi-MB) tracks with a year-long immutable Cache-Control instead of
// falling through to no-cache. When you replace a public/audio/music/<file>
// with a new remaster, recompute its hash (`sha256sum <file> | cut -c1-12`,
// same truncation `scripts/render_music.mjs --hash` prints) and update every
// URL that references it here; tests/music_tracks.test.ts pins the hash
// against the committed file so a forgotten update fails the gate rather than
// serving stale audio to a returning player forever.

import type { MusicZone } from './music';

/** Streamed remaster for each zone cue. */
export const ZONE_STREAM_URLS: Record<MusicZone, string | null> = {
  town_eastbrook: '/audio/music/town_eastbrook.mp3?v=251c46caf6ce',
  town_fenbridge: '/audio/music/town_fenbridge.mp3?v=1a94215a28f8',
  town_highwatch: '/audio/music/town_highwatch.mp3?v=8daa06e91073',
  vale: '/audio/music/vale.mp3?v=d40a82892e1e',
  // The legacy vale cue has no dedicated remaster and is not routed by
  // musicZoneForLocation; the vale remaster stands in for completeness.
  vale_legacy: '/audio/music/vale.mp3?v=d40a82892e1e',
  marsh: '/audio/music/marsh.mp3?v=ad5dcf5613b9',
  peaks: '/audio/music/peaks.mp3?v=b41ca1a8edcc',
  // STAND-INS (same precedent as vale_legacy): Veiled Hollow, Drakelands, and
  // Wraithwood do not have supplied remasters yet, so they stream the nearest
  // existing render instead of falling silent. Replace these three URLs when
  // their dedicated public/audio/music/<zone>.mp3 files land.
  dusk: '/audio/music/marsh.mp3?v=ad5dcf5613b9',
  ember: '/audio/music/peaks.mp3?v=b41ca1a8edcc',
  frost: '/audio/music/frost.mp3?v=88500e3eb213',
  amber: '/audio/music/amber.mp3?v=338cb1c002c2',
  fen: '/audio/music/fen.mp3?v=1ff84a71dd31',
  night: '/audio/music/night.mp3?v=44f582c43720',
  haunt: '/audio/music/marsh.mp3?v=ad5dcf5613b9',
  jungle: '/audio/music/jungle.mp3?v=9b86b3bbeb7b',
  garden: '/audio/music/garden.mp3?v=9ec0e18f6d81',
  gale: '/audio/music/gale.mp3?v=a940defc3275',
  farshore: '/audio/music/farshore.mp3?v=69d713cd3f3c',
  // The tutorial island's own cue ("Welcome to Adventure", the owner-supplied
  // 2026-08 replacement for "A First Light at Dawnrest"). The one supplied
  // track with NO composed counterpart in buildMusicThemes(): it was written
  // for the island rather than remastered from the procedural score, so the
  // music editor and scripts/render_music.mjs do not know about it. That is
  // deliberate, not a missing theme; the runtime only ever streams.
  proving_shore: '/audio/music/proving_shore.mp3?v=51e9b5a6c01f',
  dungeon_hollow_crypt: '/audio/music/dungeon_hollow_crypt.mp3?v=4bb48c2d90fc',
  dungeon_sunken_bastion: '/audio/music/dungeon_sunken_bastion.mp3?v=db67d7df0f4b',
  dungeon_gravewyrm_sanctum: '/audio/music/dungeon_gravewyrm_sanctum.mp3?v=19f49e28f3af',
  ignivar_forge_approach: '/audio/music/ignivar_forge_approach.mp3?v=b0699abaf914',
  ignivar_raid_arena: '/audio/music/ignivar_raid_arena.mp3?v=797023a0d280',
  ignivar_inner_crucible: '/audio/music/ignivar_inner_crucible.mp3?v=f20a68a10819',
  // Rift crawl stand-ins borrow the nearest-mood dungeon crawl render.
  rift_frost: '/audio/music/dungeon_gravewyrm_sanctum.mp3?v=19f49e28f3af',
  rift_ember: '/audio/music/dungeon_hollow_crypt.mp3?v=4bb48c2d90fc',
  rift_venom: '/audio/music/dungeon_sunken_bastion.mp3?v=db67d7df0f4b',
  rift_bone: '/audio/music/dungeon_gravewyrm_sanctum.mp3?v=19f49e28f3af',
  rift_brute: '/audio/music/dungeon_hollow_crypt.mp3?v=4bb48c2d90fc',
  rift_void: '/audio/music/dungeon_gravewyrm_sanctum.mp3?v=19f49e28f3af',
  rift_storm: '/audio/music/dungeon_hollow_crypt.mp3?v=4bb48c2d90fc',
  rift_tide: '/audio/music/dungeon_sunken_bastion.mp3?v=db67d7df0f4b',
};

/** Area file tracks: looped mp3s that OWN the mix while the player stands in a
 *  place with its own soundtrack, ducking the procedural score and the zone
 *  streams for as long as one is active. Unlike the zone cues these are not
 *  renders of a composed theme in music.ts, so they live at the top level of
 *  public/audio/ next to the boss loop rather than under music/. At most one is
 *  active at a time: their areas are mutually exclusive. */
export type AreaTrackId =
  | 'mortar_overdrive_evergarden'
  | 'mortar_overdrive_nightbloom'
  | 'mortar_overdrive_drakelands'
  | 'mortar_overdrive_palmreach';

export const AREA_TRACK_URLS: Record<AreaTrackId, string> = {
  mortar_overdrive_evergarden: '/audio/mortar-overdrive-evergarden.mp3',
  mortar_overdrive_nightbloom: '/audio/mortar-overdrive-nightbloom.mp3',
  mortar_overdrive_drakelands: '/audio/mortar-overdrive-drakelands.mp3',
  mortar_overdrive_palmreach: '/audio/mortar-overdrive-palmreach.mp3',
};

/** Which tracks belong to the same place. Activating one warms every track of
 *  its group, because the next crossfade inside a place is abrupt and must not
 *  wait on a first-byte fetch; the other groups stay undownloaded, since
 *  reaching them means a loading screen or a long ride.
 *
 *  The unit is the TRACK, not the place that plays it: two Mortar Overdrive circuits
 *  of the same zone may share one track and therefore its group, but two
 *  different circuit tracks must never share a group, or activating either would
 *  download both. You never cross from one circuit to another without a race
 *  start, so there is nothing to prewarm across them. */
export const AREA_TRACK_GROUP: Record<AreaTrackId, string> = {
  mortar_overdrive_evergarden: 'mortar_overdrive_evergarden',
  mortar_overdrive_nightbloom: 'mortar_overdrive_nightbloom',
  mortar_overdrive_drakelands: 'mortar_overdrive_drakelands',
  mortar_overdrive_palmreach: 'mortar_overdrive_palmreach',
};

/** The tracks a Mortar Overdrive circuit may name, one per zone that has a
 *  circuit. The music director restarts any of these from the top on every
 *  circuit visit and every new race, which is a rule about the PLACE rather
 *  than about one track, so it is asked here rather than by track id. */
export const MORTAR_OVERDRIVE_AREA_TRACKS: ReadonlySet<AreaTrackId> = new Set<AreaTrackId>([
  'mortar_overdrive_evergarden',
  'mortar_overdrive_nightbloom',
  'mortar_overdrive_drakelands',
  'mortar_overdrive_palmreach',
]);

/** Whether a plain string names an area track. The Mortar Overdrive circuit records
 *  carry their track as a string, because `src/sim/` may not import this union;
 *  this is where that string is proved to be one of these. */
export function isAreaTrackId(value: string): value is AreaTrackId {
  return Object.hasOwn(AREA_TRACK_URLS, value);
}

/** The remastered battle themes; each fight opens on one chosen at random. */
export const COMBAT_STREAM_URLS: string[] = [
  '/audio/music/combat_1.mp3?v=c2587cdfa73a',
  '/audio/music/combat_2.mp3?v=36f7fc946e3a',
];

/** Pick which battle theme opens the next fight: uniform over the catalog.
 *  rand is injected (Math.random at the call site) so tests can drive it;
 *  the result is clamped so rand() returning exactly 1 stays in range. */
export function pickCombatTrackIndex(trackCount: number, rand: () => number): number {
  if (trackCount <= 0) return 0;
  const idx = Math.floor(rand() * trackCount);
  return Math.min(trackCount - 1, Math.max(0, idx));
}
