import { describe, expect, it } from 'vitest';
import {
  REALM_RACERS_ABILITY_ID,
  REALM_RACERS_NITRO_ABILITY_ID,
  REALM_RACERS_SLICK_ABILITY_ID,
  REALM_RACERS_WEAPON_CHARGES,
} from '../src/sim/content/realm_racers';
import { REALM_RACERS_PRACTICE_CIRCUIT } from '../src/sim/content/realm_racers_circuits';
import { parseBisGearFor } from '../src/sim/dev/parse_bis_loadouts';
import { realmRacersPickupBoxes } from '../src/sim/realm_racers_pickups';
import { realmRacersTrack } from '../src/sim/realm_racers_spline';
import { Sim } from '../src/sim/sim';
import { realmRacersForfeit, realmRacersSpendPickupEffect } from '../src/sim/social/realm_racers';
import { startRealmRacersPractice } from '../src/sim/social/realm_racers_bots';
import { MAX_LEVEL } from '../src/sim/types';
import { installScriptedRng } from './helpers/realm_racers_rng';
import { EMPTY_TEST_WORLD } from './sim_shared';

function devSim(seed = 42): Sim {
  return new Sim({
    seed,
    playerClass: 'warrior',
    autoEquip: true,
    devCommands: true,
    world: EMPTY_TEST_WORLD,
  });
}

function devSpawns(sim: Sim, ownerId = sim.playerId) {
  return [...sim.entities.values()]
    .filter((entity) => entity.devSpawnOwnerId === ownerId)
    .sort((a, b) => a.id - b.id);
}

describe('dev commands', () => {
  it('/dev bis uses the selected spec parse loadout without changing the live spec', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'mage',
      autoEquip: true,
      devCommands: true,
      world: EMPTY_TEST_WORLD,
    });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('frost')).toBe(true);

    sim.chat('/dev bis fire');

    expect(sim.meta(sim.playerId)?.talents.spec).toBe('frost');
    expect(sim.meta(sim.playerId)?.equipment).toEqual(parseBisGearFor('mage', 'fire'));
    expect(
      sim
        .drainEvents()
        .some(
          (event) => event.type === 'log' && event.text.includes('top-parse mage fire loadout'),
        ),
    ).toBe(true);
  });

  it('/dev bis rejects a spec owned by another class without changing gear', () => {
    const sim = devSim();
    const before = { ...sim.meta(sim.playerId)?.equipment };

    sim.chat('/dev bis fire');

    expect(sim.meta(sim.playerId)?.equipment).toEqual(before);
    expect(
      sim
        .drainEvents()
        .some(
          (event) =>
            event.type === 'error' &&
            event.text === "[dev] 'fire' is not a warrior spec. Try: arms, fury, prot.",
        ),
    ).toBe(true);
  });

  it('/dev bis removes stale pieces that are not part of the selected parse loadout', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'paladin',
      autoEquip: true,
      devCommands: true,
      world: EMPTY_TEST_WORLD,
    });
    const meta = sim.meta(sim.playerId);
    expect(meta).toBeDefined();
    if (!meta) throw new Error('missing player metadata');
    meta.equipment.offhand = 'highwatch_wallshield';
    meta.equipmentInstance.offhand = { rolled: { quality: 'fine' } };

    sim.chat('/dev bis retribution');

    expect(meta.equipment).toEqual(parseBisGearFor('paladin', 'retribution'));
    expect(meta.equipment.offhand).toBeUndefined();
    expect(meta.equipmentInstance.offhand).toBeUndefined();
  });

  it('spawns concrete mob templates without drawing RNG', () => {
    const sim = devSim();
    let draws = 0;
    sim.rng.setObserver(() => draws++);

    sim.chat('/dev spawn forest_wolf 3 17');

    const spawned = devSpawns(sim);
    expect(spawned).toHaveLength(3);
    expect(spawned.map((mob) => [mob.templateId, mob.level, mob.devSpawnOwnerId])).toEqual([
      ['forest_wolf', 17, sim.playerId],
      ['forest_wolf', 17, sim.playerId],
      ['forest_wolf', 17, sim.playerId],
    ]);
    expect(new Set(spawned.map((mob) => `${mob.pos.x},${mob.pos.y},${mob.pos.z}`)).size).toBe(3);
    expect(draws).toBe(0);
  });

  it('keeps spawn placement deterministic and clamps oversized batches', () => {
    const run = () => {
      const sim = devSim(77);
      sim.player.facing = 0.7;
      sim.chat('/dev spawn forest_wolf 999 999');
      return devSpawns(sim).map((mob) => ({ level: mob.level, pos: mob.pos }));
    };

    const first = run();
    expect(first).toHaveLength(20);
    expect(first.every((mob) => mob.level === MAX_LEVEL)).toBe(true);
    expect(run()).toEqual(first);
  });

  it('despawns only mobs created by the requesting developer', () => {
    const sim = new Sim({
      seed: 9,
      playerClass: 'warrior',
      noPlayer: true,
      devCommands: true,
      world: EMPTY_TEST_WORLD,
    });
    const alpha = sim.addPlayer('warrior', 'Alpha');
    const beta = sim.addPlayer('mage', 'Beta');
    sim.chat('/dev spawn forest_wolf 2', alpha);
    sim.chat('/dev spawn wild_boar 1', beta);
    const betaSpawn = devSpawns(sim, beta)[0];
    const alphaEntity = sim.entities.get(alpha);
    expect(alphaEntity).toBeDefined();
    if (!alphaEntity) throw new Error('missing alpha player');
    alphaEntity.targetId = betaSpawn.id;

    sim.chat('/dev despawn target', alpha);
    expect(sim.entities.has(betaSpawn.id)).toBe(true);
    expect(alphaEntity.targetId).toBe(betaSpawn.id);

    sim.chat('/dev despawn spawned', alpha);
    expect(devSpawns(sim, alpha)).toEqual([]);
    expect(devSpawns(sim, beta).map((mob) => mob.id)).toEqual([betaSpawn.id]);
  });

  it('clears every player target and owned spawn when its developer leaves', () => {
    const sim = new Sim({
      seed: 15,
      playerClass: 'warrior',
      noPlayer: true,
      devCommands: true,
      world: EMPTY_TEST_WORLD,
    });
    const alpha = sim.addPlayer('warrior', 'Alpha');
    const beta = sim.addPlayer('mage', 'Beta');
    sim.chat('/dev spawn forest_wolf 2', alpha);
    const [first, second] = devSpawns(sim, alpha);
    const alphaEntity = sim.entities.get(alpha);
    const betaEntity = sim.entities.get(beta);
    expect(alphaEntity).toBeDefined();
    expect(betaEntity).toBeDefined();
    if (!alphaEntity || !betaEntity) throw new Error('missing test players');
    alphaEntity.targetId = first.id;
    betaEntity.targetId = second.id;

    sim.chat('/dev despawn spawned', alpha);
    expect(alphaEntity.targetId).toBeNull();
    expect(betaEntity.targetId).toBeNull();

    sim.chat('/dev spawn wild_boar 2', alpha);
    sim.removePlayer(alpha);
    expect(devSpawns(sim, alpha)).toEqual([]);
  });

  it('restores player test state and clears combat relationships', () => {
    const sim = devSim();
    const player = sim.player;
    sim.chat('/dev spawn forest_wolf');
    const mob = devSpawns(sim)[0];
    player.hp = 1;
    player.resource = 0;
    player.cooldowns.set('heroic_strike', 50);
    player.gcdRemaining = 1;
    player.potionCooldownUntil = sim.time + 60;
    player.potionCdRemaining = 60;
    player.inCombat = true;
    player.autoAttack = true;
    mob.inCombat = true;
    mob.targetId = player.id;
    mob.aggroTargetId = player.id;
    mob.threat.set(player.id, 100);

    sim.chat('/dev heal');
    sim.chat('/dev resource');
    sim.chat('/dev cooldowns');
    sim.chat('/dev combatreset');

    expect(player.hp).toBe(player.maxHp);
    expect(player.resource).toBe(player.maxResource);
    expect(player.cooldowns.size).toBe(0);
    expect(player.gcdRemaining).toBe(0);
    expect(player.potionCooldownUntil).toBe(sim.time);
    expect(player.inCombat).toBe(false);
    expect(player.autoAttack).toBe(false);
    expect(mob.threat.has(player.id)).toBe(false);
    expect(mob.aggroTargetId).toBeNull();
    expect(mob.targetId).toBeNull();
    expect(mob.inCombat).toBe(false);
  });

  it('revives through the normal resurrection teardown', () => {
    const sim = devSim();
    sim.chat('/dev kill');
    expect(sim.player.dead).toBe(true);

    sim.chat('/dev revive');

    expect(sim.player.dead).toBe(false);
    expect(sim.player.ghost).toBe(false);
    expect(sim.player.hp).toBe(sim.player.maxHp);
    expect(sim.player.inCombat).toBe(false);
  });

  it('mobilestation places through the REAL specialization gate, not around it', () => {
    const sim = devSim();
    const meta = (sim as any).players.get(sim.playerId);

    // Unspecialized: the cheat saves the walk, never the gate (dev_commands.ts
    // routes through placeMobileStationForPlayer).
    sim.chat('/dev mobilestation engineering');
    expect(meta.mobileStation).toBeNull();

    meta.craftSkills.engineering = 75; // the specialization threshold (#1134)
    sim.chat('/dev mobilestation ENGINEERING'); // the arm lowercases the craft id
    expect(meta.mobileStation?.craftId).toBe('engineering');
    // The IWorld read agrees while the station is active.
    expect(sim.activeMobileStationCraft).toBe('engineering');
  });

  it('fills the whole rally kit at once, weapon and every pickup effect', () => {
    const sim = devSim();
    const pid = sim.playerId;
    expect(startRealmRacersPractice(sim, 'rookie', pid)).toBe(true);
    const race = sim.realmRacers.practices[0];
    race.phase = 'racing';
    const progress = race.progress.get(pid);
    const meta = (sim as any).players.get(pid);
    if (!progress) throw new Error('missing progress');

    sim.chat('/dev rallykit');

    expect(progress.heldWeapon?.charges).toBe(50);
    expect(progress.devHeldCharges).toEqual({ nitro: 50, slick: 50 });
    // BOTH on the bar at once, each with its stack: the whole point of the grant
    // is that a session never has to choose which half of the kit it is judging.
    expect(
      meta.known
        .map((known: { def: { id: string }; charges?: number }) => [known.def.id, known.charges])
        .sort(),
    ).toEqual(
      [
        [REALM_RACERS_ABILITY_ID, 50],
        [REALM_RACERS_NITRO_ABILITY_ID, 50],
        [REALM_RACERS_SLICK_ABILITY_ID, 50],
      ].sort(),
    );

    // Spending draws the stack down one at a time, and only the effect spent.
    sim.castAbility(REALM_RACERS_SLICK_ABILITY_ID, pid);
    sim.castAbility(REALM_RACERS_SLICK_ABILITY_ID, pid);
    expect(race.slicks).toHaveLength(2);
    expect(progress.devHeldCharges).toEqual({ nitro: 50, slick: 48 });

    // And zero hands the race its own rules back, or a tuning session could
    // never return to the one-charge pickup it is meant to be judging.
    sim.chat('/dev rallykit 0');
    expect(progress.devHeldCharges).toBeNull();
    expect(meta.known.map((known: { def: { id: string } }) => known.def.id)).toEqual([
      REALM_RACERS_ABILITY_ID,
    ]);
  });

  it('gives the race its own rules back, weapon budget included', () => {
    // `0` means "stop cheating", never "leave me empty": zeroing the weapon
    // would hand the tuning session a spent gun at exactly the moment it wants
    // to judge the ordinary budget.
    const sim = devSim();
    const pid = sim.playerId;
    expect(startRealmRacersPractice(sim, 'rookie', pid)).toBe(true);
    const race = sim.realmRacers.practices[0];
    race.phase = 'racing';
    const progress = race.progress.get(pid);
    if (!progress) throw new Error('missing progress');

    sim.chat('/dev rallykit');
    expect(progress.heldWeapon?.charges).toBe(50);
    sim.chat('/dev rallykit 0');
    expect(progress.devHeldCharges).toBeNull();
    expect(progress.heldWeapon?.charges).toBe(REALM_RACERS_WEAPON_CHARGES);
  });

  it('stands the drained stack aside for an ordinary pickup', () => {
    // The stack is checked for STOCK, not for existence. Tested by existence, a
    // spent grant left the record in place and shadowed the real slot, so a
    // pilot who then took a box held an effect with no button and no way to
    // re-acquire it (a full slot turns every later box into a refill).
    const sim = devSim();
    const pid = sim.playerId;
    expect(startRealmRacersPractice(sim, 'rookie', pid)).toBe(true);
    const race = sim.realmRacers.practices[0];
    race.phase = 'racing';
    const progress = race.progress.get(pid);
    const meta = (sim as any).players.get(pid);
    if (!progress) throw new Error('missing progress');

    sim.chat('/dev rallykit 1');
    sim.castAbility(REALM_RACERS_SLICK_ABILITY_ID, pid);
    sim.castAbility(REALM_RACERS_NITRO_ABILITY_ID, pid);
    expect(progress.devHeldCharges).toEqual({ nitro: 0, slick: 0 });
    // Drained: the bar is back to the weapon alone, not stuck on empty buttons.
    expect(meta.known.map((known: { def: { id: string } }) => known.def.id)).toEqual([
      REALM_RACERS_ABILITY_ID,
    ]);

    // And an ordinary pickup now reaches the bar exactly as it would have with
    // no grant in this race at all. Driven through a REAL box take: that is the
    // only path that republishes the kit while the drained record is still in
    // place, and any republish that clears the record first would erase the very
    // condition under test (it did, in the first draft of this case).
    const racer = sim.entities.get(pid);
    if (!racer) throw new Error('missing racer');
    const box = realmRacersPickupBoxes(REALM_RACERS_PRACTICE_CIRCUIT)[0];
    racer.pos.x = race.origin.x + box.x;
    racer.pos.z = race.origin.z + box.z;
    racer.prevPos = { ...racer.pos };
    const projection = realmRacersTrack(REALM_RACERS_PRACTICE_CIRCUIT).project(box.x, box.z);
    progress.lastS = projection.s;
    progress.trackIndex = projection.index;
    // The oil is LAST in all three position tables, so a roll inside the top
    // slice draws it whichever band this pilot is ranked in; the house pilots
    // are driving the same lane, so more than one take can land on this tick.
    const rng = installScriptedRng(sim);
    rng.script(...Array.from({ length: 8 }, () => 0.96));
    sim.tick();

    expect(progress.heldEffect).toBe('slick');
    expect(meta.known.map((known: { def: { id: string } }) => known.def.id)).toEqual([
      REALM_RACERS_ABILITY_ID,
      REALM_RACERS_SLICK_ABILITY_ID,
    ]);
  });

  it('takes the granted kit off the bar at the flag', () => {
    // A dev grant leaves `heldEffect` null, so a republish gated on the SLOT
    // alone never fired and the whole armoury stayed on the bar through the
    // post-race tableau, which is what the code there forbids in as many words.
    const sim = devSim();
    const pid = sim.playerId;
    expect(startRealmRacersPractice(sim, 'rookie', pid)).toBe(true);
    const race = sim.realmRacers.practices[0];
    race.phase = 'racing';
    const meta = (sim as any).players.get(pid);

    sim.chat('/dev rallykit');
    expect(meta.known).toHaveLength(3);

    realmRacersForfeit(sim.ctx, pid);
    expect(race.progress.get(pid)?.devHeldCharges).toBeNull();
    expect(meta.known.map((known: { def: { id: string } }) => known.def.id)).toEqual([
      REALM_RACERS_ABILITY_ID,
    ]);
  });

  it('does not let the race command swallow the kit command', () => {
    // `/dev rally <circuit>` is matched first and `rallykit` starts with it: only
    // the whitespace after `rally` keeps them apart, which is exactly the kind of
    // thing a later edit to either pattern breaks silently.
    const sim = devSim();
    const pid = sim.playerId;
    expect(startRealmRacersPractice(sim, 'rookie', pid)).toBe(true);
    sim.realmRacers.practices[0].phase = 'racing';

    sim.chat('/devrallykit 7');

    const progress = sim.realmRacers.practices[0].progress.get(pid);
    expect(progress?.heldWeapon?.charges).toBe(7);
    expect(progress?.devHeldCharges).toEqual({ nitro: 7, slick: 7 });
  });

  it('leaves the rally kit alone outside dev builds', () => {
    // The latch is read behind `ctx.devCommands` at the spend site as well as at
    // the grant, so a slot cannot refill itself on a real realm.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true, devCommands: false });
    const pid = sim.playerId;
    expect(startRealmRacersPractice(sim, 'rookie', pid)).toBe(true);
    const race = sim.realmRacers.practices[0];
    race.phase = 'racing';
    const progress = race.progress.get(pid);
    if (!progress) throw new Error('missing progress');

    sim.chat('/dev rallykit');
    expect(progress.heldEffect).toBeNull();
    expect(progress.devHeldCharges).toBeNull();

    // Even with a stack forced on, the spend site refuses to honour it and falls
    // back to the one real charge. Driven through the seam function rather than
    // a cast: without the grant the pilot never learned the ability, so a cast
    // would be refused upstream and this would pass on a spend site that had
    // never run.
    const racer = sim.entities.get(pid);
    if (!racer) throw new Error('missing racer');
    progress.devHeldCharges = { nitro: 50, slick: 50 };
    progress.heldEffect = 'slick';
    realmRacersSpendPickupEffect(sim.ctx, racer, 'slick');
    expect(race.slicks).toHaveLength(1);
    expect(progress.heldEffect).toBeNull();
    expect(progress.devHeldCharges).toEqual({ nitro: 50, slick: 50 });
    // The second cast finds an empty slot and a stack it may not read: nothing.
    realmRacersSpendPickupEffect(sim.ctx, racer, 'slick');
    expect(race.slicks).toHaveLength(1);
  });

  it('is inert when dev commands are disabled', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      devCommands: false,
      world: EMPTY_TEST_WORLD,
    });
    const beforeIds = [...sim.entities.keys()];

    sim.chat('/dev spawn forest_wolf 4');
    sim.chat('/dev level 60');

    expect([...sim.entities.keys()]).toEqual(beforeIds);
    expect(sim.player.level).toBe(1);
    expect(devSpawns(sim)).toEqual([]);
  });

  it('sets the current target to a percent of max health, else self', () => {
    const sim = devSim();
    const player = sim.player;
    player.maxHp = 200;
    player.hp = 1;
    sim.chat('/dev hp 50');
    expect(player.hp).toBe(100);

    sim.chat('/dev spawn forest_wolf');
    const mob = devSpawns(sim)[0];
    mob.maxHp = 1000;
    mob.hp = 1000;
    player.targetId = mob.id;
    sim.chat('/dev hp 40');
    expect(mob.hp).toBe(400);
    expect(player.hp).toBe(100);

    sim.chat('/dev hp 0');
    expect(mob.hp).toBe(10);
    sim.chat('/dev hp 999');
    expect(mob.hp).toBe(1000);
  });

  it('never leaves a body at zero, however small its pool', () => {
    const sim = devSim();
    const sub = sim.player;
    sub.maxHp = 50;
    sub.hp = 50;
    // 1% of 50 floors to 0, and a body at 0 hp that no death path produced is
    // a state nothing else in the sim can reach.
    sim.chat('/dev hp 1');
    expect(sub.hp).toBe(1);
  });

  it('refuses a dead or non-self player target instead of silently hitting self', () => {
    const sim = devSim();
    const player = sim.player;
    player.maxHp = 200;
    player.hp = 200;
    sim.chat('/dev spawn forest_wolf');
    const mob = devSpawns(sim)[0];
    mob.maxHp = 1000;
    mob.hp = 1000;
    mob.dead = true;
    player.targetId = mob.id;
    const dead = sim.chat('/dev hp 10');
    expect(dead).toBeNull();
    expect(mob.hp).toBe(1000);
    // The caller's own hp must NOT have moved: an automation caller whose
    // target did not land would otherwise measure itself and never know.
    expect(player.hp).toBe(200);

    const other = sim.addPlayer('mage', 'Otherling');
    const otherEntity = sim.entities.get(other);
    if (!otherEntity) throw new Error('second player missing');
    otherEntity.maxHp = 300;
    otherEntity.hp = 300;
    player.targetId = other;
    sim.chat('/dev hp 10');
    expect(otherEntity.hp).toBe(300);
    expect(player.hp).toBe(200);

    // ...and targeting YOURSELF still works.
    player.targetId = player.id;
    sim.chat('/dev hp 25');
    expect(player.hp).toBe(50);
  });

  it("refuses another tester's pet, which is an owned mob and not a player", () => {
    const sim = devSim();
    const player = sim.player;
    player.maxHp = 200;
    player.hp = 200;
    sim.chat('/dev spawn forest_wolf');
    const pet = devSpawns(sim)[0];
    pet.maxHp = 1000;
    pet.hp = 1000;

    const other = sim.addPlayer('mage', 'Otherling');
    pet.ownerId = other;
    player.targetId = pet.id;
    sim.chat('/dev hp 10');
    expect(pet.hp).toBe(1000);
    expect(player.hp).toBe(200);

    // ...while the caller's OWN pet stays theirs to drive.
    pet.ownerId = player.id;
    sim.chat('/dev hp 10');
    expect(pet.hp).toBe(100);
  });

  it('errors, and changes nothing, when the caller is dead with no target', () => {
    const sim = devSim();
    const player = sim.player;
    player.maxHp = 200;
    player.hp = 0;
    player.dead = true;
    player.targetId = null;
    sim.chat('/dev hp 90');
    expect(player.hp).toBe(0);
  });

  it('draws no rng, like every dev command', () => {
    const sim = devSim();
    const player = sim.player;
    player.maxHp = 200;
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    sim.chat('/dev hp 50');
    sim.chat('/dev hp 100');
    sim.rng.setObserver(null);
    expect(draws).toBe(0);
  });
});

describe('/dev bg (Thornhollow Fields force-start)', () => {
  it('force-starts a short-handed match from whoever is queued, no bots', () => {
    const sim = new Sim({
      seed: 9,
      playerClass: 'warrior',
      noPlayer: true,
      devCommands: true,
      world: EMPTY_TEST_WORLD,
    });
    const a = sim.addPlayer('warrior', 'Alpha');
    const b = sim.addPlayer('mage', 'Beta');
    const c = sim.addPlayer('priest', 'Gamma');
    for (const p of [a, b, c]) {
      sim.entities.get(p)!.level = 20; // the queue floor; /dev bg itself bypasses it
      sim.bgQueueJoin(p);
    }

    sim.chat('/dev bg', a);

    const match = sim.bgMatchFor(a);
    expect(match).toBeTruthy();
    if (!match) throw new Error('missing match');
    expect(match.teams[0].length + match.teams[1].length).toBe(3);
    expect(match.teams[0].length).toBeGreaterThan(0);
    expect(match.teams[1].length).toBeGreaterThan(0);
    expect([...sim.players.values()].filter((m) => m.isDevBot)).toHaveLength(0);
  });

  it('queues the caller and pads with one dev bot for a solo walk-around, drawing zero rng', () => {
    const sim = devSim();
    let draws = 0;
    sim.rng.setObserver(() => draws++);

    sim.chat('/dev bg');

    const match = sim.bgMatchFor(sim.playerId);
    expect(match).toBeTruthy();
    if (!match) throw new Error('missing match');
    const pids = [...match.teams[0], ...match.teams[1]];
    expect(pids).toHaveLength(2);
    const botPid = pids.find((p) => p !== sim.playerId);
    expect(botPid).toBeDefined();
    expect(sim.players.get(botPid ?? -1)?.isDevBot).toBe(true);
    // exactly ONE draw: the power-rune opening face rolled at match start
    // (startBgMatch); queueing, padding, and team-splitting draw nothing.
    expect(draws).toBe(1);
  });

  it('errors on a repeat call from inside the match', () => {
    const sim = devSim();
    sim.chat('/dev bg');
    expect(sim.bgMatchFor(sim.playerId)).toBeTruthy();
    sim.tick();

    sim.chat('/dev bg');

    const errors = sim
      .tick()
      .filter((e) => e.type === 'error' && e.pid === sim.playerId)
      .map((e) => (e.type === 'error' ? e.text : ''));
    expect(errors).toContain('[dev] You are already in a battleground.');
  });

  it('a refused queue join (not the party leader) starts nothing and leaks no bot', () => {
    const sim = devSim();
    // A dead caller used to be the refusal this pinned. Dying no longer cancels
    // a queue, so the bail-before-padding path is exercised through a refusal
    // that survives: only a party's leader may commit it to the queue.
    const leader = sim.addPlayer('priest', 'Leader');
    sim.partyInvite(sim.playerId, leader);
    sim.partyAccept(sim.playerId);
    expect(sim.partyOf(sim.playerId)!.leader).not.toBe(sim.playerId);

    sim.chat('/dev bg');

    expect(sim.bgMatchFor(sim.playerId)).toBeNull();
    expect([...sim.players.values()].filter((m) => m.isDevBot)).toHaveLength(0);
  });

  it('force-starts for a dead caller, who is seated alive', () => {
    const sim = devSim();
    sim.player.hp = 0;
    sim.player.dead = true;

    sim.chat('/dev bg');

    expect(sim.bgMatchFor(sim.playerId), 'dying must not cancel the queue').toBeTruthy();
    expect(sim.player.dead).toBe(false);
    expect(sim.player.ghost).toBe(false);
    expect(sim.player.hp).toBe(sim.player.maxHp);
  });

  it('reuses an idle leftover dev bot instead of spawning another', () => {
    const sim = devSim();
    sim.chat('/dev bot Riftbot');
    const botCountBefore = [...sim.players.values()].filter((m) => m.isDevBot).length;
    expect(botCountBefore).toBe(1);

    sim.chat('/dev bg');

    expect(sim.bgMatchFor(sim.playerId)).toBeTruthy();
    expect([...sim.players.values()].filter((m) => m.isDevBot)).toHaveLength(1);
  });

  it('is inert without devCommands', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      devCommands: false,
      world: EMPTY_TEST_WORLD,
    });
    sim.chat('/dev bg');
    expect(sim.bgMatchFor(sim.playerId)).toBeNull();
  });
});
