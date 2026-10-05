// Is this player seated in a Realm Racers heat, from the loading lobby to the
// result? The seat owns the pilot's movement and return point, so every other
// mode (a battleground seat, the World PvP rules, a duel) asks before it acts.
// A leaf with no runtime imports, so those modules reach it without an import
// cycle through the race module. Draws no rng, mutates nothing.
import type { SimContext } from '../sim_context';

export function inRealmRacersHeat(ctx: Pick<SimContext, 'players'>, pid: number): boolean {
  return (ctx.players.get(pid)?.realmRacersMatchId ?? null) !== null;
}
