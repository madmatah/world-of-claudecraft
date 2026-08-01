// Remastered soundtrack catalog: the streamed mp3 renders of the procedural
// themes, served from public/audio/music/. The composition machinery in
// music.ts remains the authoring source (music editor + offline render
// pipeline); these files are its remastered renders and own runtime playback.
// Pure data + math, DOM-free, so it unit-tests in plain Node.

import type { MusicZone } from './music';

/** Streamed remaster for each zone cue. null means the zone has no stream:
 *  vale_cup is only ever active at the Sowfield stadium, where the dedicated
 *  sowfield-waiting/sowfield-match tracks own the mix and the zone bus is
 *  ducked to silence, so streaming a file for it would only waste bandwidth. */
export const ZONE_STREAM_URLS: Record<MusicZone, string | null> = {
  town_eastbrook: '/audio/music/town_eastbrook.mp3',
  town_fenbridge: '/audio/music/town_fenbridge.mp3',
  town_highwatch: '/audio/music/town_highwatch.mp3',
  vale: '/audio/music/vale.mp3',
  // The legacy vale cue has no dedicated remaster and is not routed by
  // musicZoneForLocation; the vale remaster stands in for completeness.
  vale_legacy: '/audio/music/vale.mp3',
  marsh: '/audio/music/marsh.mp3',
  peaks: '/audio/music/peaks.mp3',
  // STAND-INS (same precedent as vale_legacy): Veiled Hollow, Drakelands, and
  // Wraithwood do not have supplied remasters yet, so they stream the nearest
  // existing render instead of falling silent. Replace these three URLs when
  // their dedicated public/audio/music/<zone>.mp3 files land.
  dusk: '/audio/music/marsh.mp3',
  ember: '/audio/music/peaks.mp3',
  frost: '/audio/music/frost.mp3',
  amber: '/audio/music/amber.mp3',
  fen: '/audio/music/fen.mp3',
  night: '/audio/music/night.mp3',
  haunt: '/audio/music/marsh.mp3',
  jungle: '/audio/music/jungle.mp3',
  garden: '/audio/music/garden.mp3',
  gale: '/audio/music/gale.mp3',
  farshore: '/audio/music/farshore.mp3',
  vale_cup: null,
  dungeon_hollow_crypt: '/audio/music/dungeon_hollow_crypt.mp3',
  dungeon_sunken_bastion: '/audio/music/dungeon_sunken_bastion.mp3',
  dungeon_gravewyrm_sanctum: '/audio/music/dungeon_gravewyrm_sanctum.mp3',
  // Rift crawl stand-ins borrow the nearest-mood dungeon crawl render.
  rift_frost: '/audio/music/dungeon_gravewyrm_sanctum.mp3',
  rift_ember: '/audio/music/dungeon_hollow_crypt.mp3',
  rift_venom: '/audio/music/dungeon_sunken_bastion.mp3',
  rift_bone: '/audio/music/dungeon_gravewyrm_sanctum.mp3',
  rift_brute: '/audio/music/dungeon_hollow_crypt.mp3',
  rift_void: '/audio/music/dungeon_gravewyrm_sanctum.mp3',
  rift_storm: '/audio/music/dungeon_hollow_crypt.mp3',
  rift_tide: '/audio/music/dungeon_sunken_bastion.mp3',
};

/** Area file tracks: looped mp3s that OWN the mix while the player stands in a
 *  place with its own soundtrack, ducking the procedural score and the zone
 *  streams for as long as one is active. Unlike the zone cues these are not
 *  renders of a composed theme in music.ts, so they live at the top level of
 *  public/audio/ next to the boss loop rather than under music/. At most one is
 *  active at a time: their areas are mutually exclusive. */
export type AreaTrackId = 'sowfield_waiting' | 'sowfield_match' | 'realm_racers';

export const AREA_TRACK_URLS: Record<AreaTrackId, string> = {
  sowfield_waiting: '/audio/sowfield-waiting.mp3',
  sowfield_match: '/audio/sowfield-match.mp3',
  realm_racers: '/audio/realm-racers.mp3',
};

/** Which tracks belong to the same place. Activating one warms every track of
 *  its group, because the next crossfade inside a place is abrupt and must not
 *  wait on a first-byte fetch (the Sowfield flips waiting to match on kickoff);
 *  the other groups stay undownloaded, since reaching them means a loading
 *  screen or a long ride. */
export const AREA_TRACK_GROUP: Record<AreaTrackId, string> = {
  sowfield_waiting: 'sowfield',
  sowfield_match: 'sowfield',
  realm_racers: 'realm_racers',
};

/** The remastered battle themes; each fight opens on one chosen at random. */
export const COMBAT_STREAM_URLS: string[] = [
  '/audio/music/combat_1.mp3',
  '/audio/music/combat_2.mp3',
];

/** Pick which battle theme opens the next fight: uniform over the catalog.
 *  rand is injected (Math.random at the call site) so tests can drive it;
 *  the result is clamped so rand() returning exactly 1 stays in range. */
export function pickCombatTrackIndex(trackCount: number, rand: () => number): number {
  if (trackCount <= 0) return 0;
  const idx = Math.floor(rand() * trackCount);
  return Math.min(trackCount - 1, Math.max(0, idx));
}
