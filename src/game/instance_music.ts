import { REALM_RACERS_CIRCUIT_LIST } from '../sim/content/realm_racers_circuits';
import { delveAt, dungeonAt, isBgPos, isDelvePos, type ZoneDef } from '../sim/data';
import { realmRacersLaneAt } from '../sim/realm_racers_layout';
import { isAtSowfield } from '../sim/vale_cup_layout';
import {
  type MusicZone,
  musicZoneForLocation,
  riftMusicZoneForTheme,
  shouldResetMusicForDungeonEntry,
} from './music';
import { type AreaTrackId, isAreaTrackId } from './music_tracks';

/**
 * The area track of whichever circuit stands on this point's lane, or null off
 * the band entirely. A circuit naming a track this build does not ship is
 * treated as no track rather than as a missing file: silence beats a 404 loop,
 * and `tests/instance_music.test.ts` pins that no shipped circuit does it.
 */
export function realmRacersAreaTrackAt(x: number, z: number): AreaTrackId | null {
  const track = realmRacersLaneAt(x, z)?.circuit.musicTrack;
  return track !== undefined && isAreaTrackId(track) ? track : null;
}

/** Whether an area track belongs to a rally circuit, which is what decides
 *  whether a new race RESTARTS it. Derived from the circuit records, so a new
 *  circuit joins it by existing. */
export function isRealmRacersAreaTrack(track: AreaTrackId | null): boolean {
  return track !== null && REALM_RACERS_CIRCUIT_TRACKS.has(track);
}

const REALM_RACERS_CIRCUIT_TRACKS: ReadonlySet<string> = new Set(
  REALM_RACERS_CIRCUIT_LIST.map((circuit) => circuit.musicTrack),
);

export interface InstanceMusicEntity {
  kind: string;
  dead: boolean;
  templateId: string;
  aggroTargetId: number | null;
}

export interface InstanceMusicMatch {
  phase: string;
  origin: { x: number; z: number };
}

export interface InstanceMusicCupInfo {
  match: InstanceMusicMatch | null;
  spectate: InstanceMusicMatch | null;
}

// The slice of RiftFloorView the soundtrack needs: the floor's environment
// archetype plus enough identity to key per-floor phrasing resets.
export interface InstanceMusicRiftFloor {
  instanceId: number;
  floorIndex: number;
  themeName: string;
}

export interface InstanceMusicInput {
  now: number;
  lastCombatEventAt: number;
  lastBossCombatEventAt: number;
  playerId: number;
  playerPos: { x: number; z: number };
  zone: Pick<ZoneDef, 'id' | 'biome' | 'hub'>;
  inDungeon: boolean;
  entities: Iterable<InstanceMusicEntity>;
  cupInfo: InstanceMusicCupInfo | null;
  realmRacersMatchId: number | null;
  // The active procedural Rift floor (null outside a rift). A rift floor scores
  // by its RiftTheme, not the dungeon fallback, and each floor counts as its own
  // instance entry so the crawl cue re-phrases from the top even when two floors
  // roll the same theme.
  riftFloor: InstanceMusicRiftFloor | null;
}

export interface InstanceMusicDecision {
  zone: MusicZone;
  inCombat: boolean;
  musicCombat: boolean;
  bossEngaged: boolean;
  instanceId: string | null;
  atSowfield: boolean;
  areaTrack: AreaTrackId | null;
}

export interface InstanceMusicPort {
  // A procedural Rift floor has no DUNGEON_MUSIC row (its cue follows the
  // floor's RiftTheme), so the resolved zone rides along explicitly.
  resetForDungeonEntry(dungeonId: string | null, zone?: MusicZone): void;
  update(zone: MusicZone, inCombat: boolean): void;
  setBossCombat(active: boolean): void;
  setAreaTrack(track: AreaTrackId | null, restart?: boolean): void;
}

const RAID_ARENA_ID = 'nythraxis_boss_arena';
const RAID_BOSS_ID = 'nythraxis_scourge_of_thornpeak';
const FALLBACK_DELVE_ID = 'collapsed_reliquary';
const RECENT_COMBAT_MS = 5000;
const RECENT_BOSS_COMBAT_MS = 10000;

export function instanceMusicDecision(input: InstanceMusicInput): InstanceMusicDecision {
  let aggroed = false;
  let bossEngaged = false;
  for (const entity of input.entities) {
    if (entity.kind !== 'mob' || entity.dead) continue;
    if (entity.aggroTargetId === input.playerId) aggroed = true;
    if (entity.templateId === RAID_BOSS_ID && entity.aggroTargetId !== null) bossEngaged = true;
  }

  const dungeon = dungeonAt(input.playerPos.x);
  const inRaidArena = dungeon?.id === RAID_ARENA_ID;
  // Thornhollow Fields battleground: the whole match rides the existing battle track
  // (the raid-arena musicCombat treatment; no dedicated audio asset).
  const inBattleground = isBgPos(input.playerPos.x);
  const inCombat = aggroed || input.now - input.lastCombatEventAt < RECENT_COMBAT_MS;
  bossEngaged =
    bossEngaged || inRaidArena || input.now - input.lastBossCombatEventAt < RECENT_BOSS_COMBAT_MS;

  const { hub } = input.zone;
  const inHub =
    !input.inDungeon &&
    Math.hypot(input.playerPos.x - hub.x, input.playerPos.z - hub.z) < hub.radius + 10;
  const instanceId = isDelvePos(input.playerPos.x)
    ? (delveAt(input.playerPos.x)?.id ?? FALLBACK_DELVE_ID)
    : (dungeon?.id ?? null);
  const atSowfield = !input.inDungeon && isAtSowfield(input.playerPos.x, input.playerPos.z);
  // A rally circuit sits on the flat instance plane, so inDungeon is true there
  // and the zone cue would otherwise fall back to the dungeon crawl theme. The
  // circuit's own race track owns the mix instead, for the whole visit: players
  // only ever stand there for a race (grid, countdown, laps, results). The
  // track comes off the CIRCUIT standing on that lane, so a themed circuit
  // brings its zone's music with it.
  const realmRacersTrack = realmRacersAreaTrackAt(input.playerPos.x, input.playerPos.z);
  const riftFloor = input.riftFloor;
  const zone = atSowfield
    ? 'vale_cup'
    : riftFloor
      ? riftMusicZoneForTheme(riftFloor.themeName)
      : musicZoneForLocation(
          input.zone.id,
          input.zone.biome,
          inHub,
          input.inDungeon || inRaidArena,
          instanceId,
        );
  const musicInstanceId = riftFloor
    ? `rift:${riftFloor.instanceId}:${riftFloor.floorIndex}`
    : input.inDungeon || inRaidArena
      ? instanceId
      : null;

  const cupMatchView = input.cupInfo?.match ?? input.cupInfo?.spectate ?? null;
  const cupKickedOff =
    cupMatchView?.phase === 'active' ||
    cupMatchView?.phase === 'goal' ||
    cupMatchView?.phase === 'golden';
  const ownMatch = input.cupInfo?.match;
  const inPracticeMatch = !!ownMatch && (ownMatch.origin.x !== 0 || ownMatch.origin.z !== 0);

  return {
    zone,
    inCombat,
    musicCombat: inCombat || inRaidArena || inBattleground,
    bossEngaged,
    instanceId: musicInstanceId,
    atSowfield,
    areaTrack:
      atSowfield || inPracticeMatch
        ? cupKickedOff
          ? 'sowfield_match'
          : 'sowfield_waiting'
        : realmRacersTrack,
  };
}

export class InstanceMusicController {
  private lastInstanceId: string | null = null;
  private lastRealmRacersMatchId: number | null = null;

  constructor(private readonly music: InstanceMusicPort) {}

  update(input: InstanceMusicInput): InstanceMusicDecision {
    const decision = instanceMusicDecision(input);
    const restartRealmRacers =
      isRealmRacersAreaTrack(decision.areaTrack) &&
      input.realmRacersMatchId !== null &&
      input.realmRacersMatchId !== this.lastRealmRacersMatchId;
    if (shouldResetMusicForDungeonEntry(this.lastInstanceId, decision.instanceId)) {
      this.music.resetForDungeonEntry(decision.instanceId, decision.zone);
    }
    this.lastInstanceId = decision.instanceId;
    this.lastRealmRacersMatchId = input.realmRacersMatchId;
    this.music.update(decision.zone, decision.musicCombat);
    this.music.setBossCombat(decision.bossEngaged);
    if (restartRealmRacers) this.music.setAreaTrack(decision.areaTrack, true);
    else this.music.setAreaTrack(decision.areaTrack);
    return decision;
  }
}
