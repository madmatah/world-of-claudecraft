// While the race lobby curtain is shown, the keys and pad buttons that open a
// window or a menu do nothing: the curtain would hide whatever they opened.
// Chat is the one exception, since the grid talks while it waits. The curtain
// painter owns the flag (realm_racers_lobby_painter.ts), so the hold ends on
// the frame the curtain drops, and the curtain's own bounds (the server's
// countdown, a lost connection, the client failsafe) bound it too.

let held = false;

/** Written only by the lobby painter, on the curtain's show and hide edges. */
export function setRealmRacersLobbyHold(active: boolean): void {
  held = active;
}

export function realmRacersLobbyHoldActive(): boolean {
  return held;
}

/** True when this key or pad action must be swallowed while the curtain is up. */
export function rallyLobbyHoldsAction(action: string): boolean {
  return held && action !== 'chat';
}
