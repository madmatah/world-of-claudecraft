// What a Realm Racers BARRIER KIT is, as far as the sim is concerned: how thick
// the run it lays is, and how tall it stands.
//
// A barrier is a hand-placed run of modules along authored points: a hedge down
// the outside of a corner, a stone wall closing a courtyard, a line of ironwork
// between the road and the lawn. It is FURNITURE, exactly like a solid prop, and
// it carries no track-limits duty of any kind: a gap in a fence is a view, never
// a shortcut, and `realm_racers_track_limits.ts` remains the sole authority on
// where the racing surface ends. Four earlier designs put a derived line of
// scenery in charge of containment and all four were retired in 16b; this is not
// a fifth.
//
// It exists for the same reason `realm_racers_props.ts` does: `src/sim/` cannot
// import the render catalog, and a collider needs dimensions a url cannot carry.
// Every key here resolves render side through
// `src/render/realm_racers_barrier_visuals.ts`, which owns the model, the run one
// module covers and what stands at a joint; `tests/realm_racers_barriers.test.ts`
// pins both halves against each other.
//
// WHERE THE TABLE CAME FROM, because it is not a set anybody sat down and
// invented: each entry is one of the kit configurations the THEME registry used
// to carry as its `perimeter` field, promoted with its measurements. Those were
// measured against the shipped GLBs and looked at in a seat, one per world zone,
// and the alternative to promoting them was deleting them and re-deriving a
// handful later. Zero new art, zero new judgement.
//
// Fourteen configurations became eleven kits. Three of them drew ONE model: the
// world ships `hex_wall.glb` and `hexn_palisade.glb` as separate files whose
// binary chunks are byte for byte identical, and the registry described them as
// a town wall and a log palisade. Two kits differing only in `scale` are not two
// kits, because a scale is a field on the record. A fourteenth was dropped for a
// different reason, recorded in the render half: its module is authored a whole
// unit off its own origin.
//
// THE NUMBERS ARE THE KIT AS DRAWN, not the GLB at scale 1, and that is the one
// convention worth stating plainly. A kit IS a model-and-scale pairing (the
// world's palisade at 2.5 is a garden fence, the same logs at 3.2 are a
// stockade, and both are here), so a def whose height meant "at scale 1" would
// be a number no reader could compare with what they see. A record's own `scale`
// multiplies both halves, so they cannot drift.
//
// Every number is MEASURED from the shipped GLB's bounding box times the
// visual's scale, on the prop catalog's own rule: a half thickness is trimmed
// DOWN to the centimetre and never up, because a forgiving footprint costs a
// racer nothing while a too-generous one reads as a bug. HEIGHT is the model's
// top ABOVE ITS OWN ORIGIN rather than its full extent, which is not the same
// number for a module authored partly underground: `dungeon_wall_stone` sinks a
// yard below its origin, so it stands 1.81 yards rather than the 3.6 its own
// theme comment claimed.
//
// Pure leaf: data only, no SimContext, no rng, no clock.

export interface RallyBarrierDef {
  /**
   * Half thickness of the run's collider, yards, at the kit's own scale.
   *
   * The run's LENGTH comes from the authored points, so this is the only
   * dimension of the collider a kit decides. A hedge is thicker than ironwork,
   * and that is the whole difference between driving into one and the other.
   *
   * A very thin kit is safe and was checked rather than assumed: static
   * collision sweeps in 0.2 yard steps and pushes a body of its own radius out,
   * so a rail 6 centimetres thick is tested over a band half a yard wide.
   */
  halfThickness: number;
  /**
   * Visual height at the kit's own scale, yards. Becomes the collider's
   * `cameraTopY`, so the chase camera rides over the barrier instead of being
   * pulled inside it.
   */
  height: number;
}

/**
 * The authorable kits, grouped by what they are rather than by which zone
 * happened to wear one first: a record may name any of them.
 */
export const REALM_RACERS_BARRIERS: Record<string, RallyBarrierDef> = {
  // --- ironwork and railings ---
  // garden_iron_fence at 1: 4.00 long, 2.20 tall, 0.50 deep. The Evergarden's.
  ironwork: { halfThickness: 0.25, height: 2.2 },
  // city_fence_ornament at 1: 1.95 long, 2.85 tall, 0.16 deep. The finest
  // module in the registry, what an avenue under turning trees is lined with.
  ornateRailing: { halfThickness: 0.07, height: 2.85 },

  // --- growing things ---
  // maze_hedge_wall at 3: 2.94 long, 1.70 tall, 1.14 deep. The maze's own.
  hedge: { halfThickness: 0.57, height: 1.7 },

  // --- timber ---
  // city_fence_wood at 1.6: 3.30 long, 1.30 tall, 0.19 deep. A rough paling.
  woodPaling: { halfThickness: 0.09, height: 1.3 },
  // props/fence at 3: 2.37 long, 0.97 tall, 0.08 deep. The village rail the
  // world runs along Eastbrook's paddocks, and barely knee high.
  paddockRail: { halfThickness: 0.03, height: 0.97 },

  // --- masonry ---
  // hex_wall at 2.4: 4.80 long, 2.64 tall, 1.92 deep. A harbour parapet, and
  // the only kit this model gets: `hexn_palisade.glb` is the SAME file under
  // another name (identical binary chunk), so the two kits that drew it at 2.5
  // and 3.2 were one wall at three sizes. A record's own `scale` is where a
  // size lives.
  stoneWall: { halfThickness: 0.95, height: 2.64 },
  // dungeon/wall at 1: 4.00 long, 4.00 tall, 1.00 deep. Ruin masonry, and tall
  // enough to be a real enclosure rather than a boundary marker.
  ruinWall: { halfThickness: 0.5, height: 4.0 },
  // dungeon/wall_cracked at 1.1: 4.40 long, 4.40 tall, 1.38 deep.
  crackedWall: { halfThickness: 0.69, height: 4.4 },
  // dungeon_wall_stone at 1.8: 3.60 long, 1.81 tall, 0.79 deep. Mountain
  // masonry, half of whose module is authored below its own origin.
  mountainWall: { halfThickness: 0.39, height: 1.81 },
  // kcas_barrier at 1.5: 6.00 long, 1.65 tall, 0.75 deep. The castle kit's
  // crenellated parapet, which a pilot sees over.
  battlement: { halfThickness: 0.37, height: 1.65 },
  // kcas_wall at 1.2: 4.80 long, 4.80 tall, 1.20 deep. The castle curtain wall.
  curtainWall: { halfThickness: 0.6, height: 4.8 },
};

/** The def for a kit key, or undefined for one nothing authors. Undefined is a
 *  readout problem (`unknown_barrier_kit`), never a throw: a half-typed draft
 *  still has to draw. */
export function realmRacersBarrierDef(kit: string): RallyBarrierDef | undefined {
  return REALM_RACERS_BARRIERS[kit];
}

/** Every authored kit key, in table order: the whole vocabulary the editor
 *  palette can fall back to past a theme's own short list. */
export const REALM_RACERS_BARRIER_KEYS: readonly string[] = Object.keys(REALM_RACERS_BARRIERS);
