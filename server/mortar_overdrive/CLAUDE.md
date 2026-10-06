<!-- server/mortar_overdrive/: the Mortar Overdrive server side. Hot-path seams and the
     monolith rules for game.ts live in server/CLAUDE.md; reference them. -->

# server/mortar_overdrive/: the Mortar Overdrive server side

What the authoritative server adds around the shared sim for the race: the command
cases, the snapshot interest of a seated pilot, and the wire encoding of the race
readouts and the drive record. The race itself runs in the shared `Sim`
(`src/sim/mortar_overdrive/`).

## File map
- `commands.ts`: the race command-case bodies behind one case group in
  `server/game.ts` (`dispatchMortarOverdriveCommand`), plus the moderation exit
  (`leaveMortarOverdriveForModeration`).
- `self_wire.ts`: the race keys of the snapshot self record, beside the quest and bank
  self-key leaves: `mo`, `moc` (per tick while seated in a live heat), `mot`, and the
  wireRev-gated `mokit`. The idle `mo` is built once per pass for every idle viewer
  (`mortarOverdriveIdleReadout`, a realm readout memo).
- `drive_wire.ts`: `driveWire`, the live vehicle state of the seated racers of a live
  race and nobody else.
- `interest.ts`: every seated pilot except the snapshot anchor, in the match's frozen
  grid order, so rivals stay in each other's interest for the whole race.

## Seams and conventions
- The decoder side is `src/net/mortar_overdrive/`; keys change on both sides in one
  change. Per-tick payload size is pinned in `tests/bandwidth.test.ts` and
  `tests/mortar_overdrive_online.test.ts`: a bound moves only with its measured reason.
- Everything here runs on the 20 Hz broadcast path: dispatch
  `server-hot-path-reviewer` on any change.
- `index.ts` is the public surface (the barrel `server/game.ts` imports). Files here
  import their siblings directly, never the barrel.
- Tests: `tests/mortar_overdrive_online.test.ts`, `tests/bandwidth.test.ts`,
  `tests/snapshots.test.ts`.
