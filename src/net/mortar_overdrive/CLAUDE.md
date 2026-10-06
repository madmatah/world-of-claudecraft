<!-- src/net/mortar_overdrive/: the Mortar Overdrive online mirror. The ClientWorld
     mirror rules live in src/net/CLAUDE.md; reference them. -->

# src/net/mortar_overdrive/: the Mortar Overdrive online mirror

The client half of the race's wire: decoding what the server ships about the race into
`ClientWorld`'s mirror, so render and UI read the same `IWorld` members online as
offline.

## File map
- `wire_state.ts`: `MortarOverdriveWireState`, the race link of `ClientWorld`'s mirror
  class chain (the `QuestWorldWireState` pattern): it applies the self keys in one pass
  and sends the race commands through the protected `cmd()` helper.
- `self_wire.ts`: the self-record readouts: `mo` (queue, heat and standings), `moc`
  (the heat's per-tick clocks and speed, folded back into the same readout), `mot`
  (the trackside lane the viewer stands on), and the race kit mirror `mokit` with the
  known list it resolves. An absent key keeps the prior mirror. A queued viewer's start
  arrives as an absolute deadline tick; the mirror keeps it and refreshes the ticks left
  against every snapshot's `tick` (`applyMortarOverdriveSelfWire`).
- `drive_wire.ts`: `decodeDriveWire`, the vehicle state of a driving entity (`drv`);
  absent means on foot.

## Seams and conventions
- The encoder side is `server/mortar_overdrive/self_wire.ts` and
  `server/mortar_overdrive/drive_wire.ts`; a key added on one side is added on the other
  in the same change, with the delta-key pins in `tests/snapshots.test.ts`
  (`ALL_DELTA_KEYS`, `TERSE_TO_IWORLD`) re-sorted.
- `index.ts` is the public surface (the barrel `src/net/online.ts` imports). Files here
  import their siblings directly, never the barrel.
- Tests: `tests/mortar_overdrive_online.test.ts`, `tests/snapshots.test.ts`,
  `tests/movement_reconciliation_wire.test.ts`.
