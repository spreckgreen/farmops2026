// First-class building levels (floors) in the FarmOps location model.
//
// Location hierarchy:
//   site → building → building level → grid scheme → grid reference
//
// Invariants enforced here (see tests/building-levels.test.ts):
//   * Location components are stored separately. A display reference such as
//     "House / Level 2 / C4" or "HS-L02-C4" is DERIVED, never the record.
//   * A grid reference is unique only within
//     (building_uuid, building_level_uuid, grid_scheme_uuid, grid_reference).
//     A1 on the ground floor and A1 on the second floor are distinct places.
//   * Object stable IDs are independent of level and grid location. Moving an
//     object between floors never renames it.
//   * Location-source precedence applies independently on each level. A source
//     with no known level never silently overwrites a level-qualified location;
//     it is flagged for reconciliation instead.
//   * Crossing a level boundary is a vertical (riser) run segment, not a new
//     circuit group.

/** Named level presets. Sort order is low → high in the building. */
export const LEVEL_PRESETS = [
  { display_name: "Basement", short_code: "B", sort_order: -100 },
  { display_name: "Crawl Space", short_code: "CS", sort_order: -50 },
  { display_name: "Ground Floor", short_code: "L01", sort_order: 0 },
  { display_name: "Mezzanine", short_code: "MZ", sort_order: 50 },
  { display_name: "First Floor", short_code: "L02", sort_order: 100 },
  { display_name: "Second Floor", short_code: "L03", sort_order: 200 },
  { display_name: "Third Floor", short_code: "L04", sort_order: 300 },
  { display_name: "Attic", short_code: "AT", sort_order: 800 },
  { display_name: "Roof", short_code: "RF", sort_order: 900 },
] as const;

export const LEVEL_LIFECYCLE_STATES = ["planned", "in_progress", "as_built"] as const;
export type LevelLifecycleState = (typeof LEVEL_LIFECYCLE_STATES)[number];

export interface BuildingLevel {
  id: string;
  site_building_id: string;
  /** Permanent stable ID, e.g. LVL-HS-L02. Never renumbered. */
  level_stable_id: string;
  display_name: string;
  short_code: string;
  sort_order: number;
  elevation_ft?: number | null;
  /** Grid dimensions may differ per level; null falls back to the building. */
  grid_rows?: number | null;
  grid_columns?: number | null;
  grid_cell_ft?: number | null;
  grid_scheme_uuid: string;
  lifecycle_state?: string | null;
  evidence_ref?: string | null;
  evidence_observed_at?: string | null;
  is_default?: boolean | null;
  notes?: string | null;
}

const norm = (v: unknown) => String(v ?? "").trim();
const up = (v: unknown) => norm(v).toUpperCase();

/** Permanent level stable ID. Derived once, then stored and never recomputed. */
export function levelStableId(buildingCode: string, shortCode: string): string {
  const b = up(buildingCode).replace(/[^A-Z0-9]+/g, "") || "BLDG";
  const c = up(shortCode).replace(/[^A-Z0-9]+/g, "") || "L01";
  return `LVL-${b}-${c}`;
}

/** Sort levels bottom-to-top, then by code, deterministically. */
export function sortLevels<T extends Pick<BuildingLevel, "sort_order" | "short_code">>(
  levels: T[],
): T[] {
  return [...levels].sort(
    (a, b) => a.sort_order - b.sort_order || up(a.short_code).localeCompare(up(b.short_code)),
  );
}

// ---------------------------------------------------------------------------
// Location components
// ---------------------------------------------------------------------------

export type LevelLocationSource =
  | "FIELD_OBSERVED_POLE_ALIGNMENT"
  | "FIELD_OBSERVED_LEVEL_GRID"
  | "APPROVED_DESIGN_XY"
  | "LEVEL_GRID_REMAPPED"
  | "ORIGINAL_GRID";

/** Highest priority first; the index is the rank. Applied per level. */
export const LEVEL_LOCATION_PRIORITY: LevelLocationSource[] = [
  "FIELD_OBSERVED_POLE_ALIGNMENT",
  "FIELD_OBSERVED_LEVEL_GRID",
  "APPROVED_DESIGN_XY",
  "LEVEL_GRID_REMAPPED",
  "ORIGINAL_GRID",
];

export const LEVEL_SOURCE_PHRASE: Record<LevelLocationSource, string> = {
  FIELD_OBSERVED_POLE_ALIGNMENT: "observed pole alignment",
  FIELD_OBSERVED_LEVEL_GRID: "observed level grid",
  APPROVED_DESIGN_XY: "approved design X/Y on this level",
  LEVEL_GRID_REMAPPED: "remapped level grid",
  ORIGINAL_GRID: "original grid",
};

export const LEVEL_LOCATION_PRECISION: Record<LevelLocationSource, string> = {
  FIELD_OBSERVED_POLE_ALIGNMENT: "field verified",
  FIELD_OBSERVED_LEVEL_GRID: "field verified",
  APPROVED_DESIGN_XY: "approved design, not field verified",
  LEVEL_GRID_REMAPPED: "derived",
  ORIGINAL_GRID: "fallback",
};

/** The stored, separated location components. Never one concatenated string. */
export interface LevelQualifiedLocation {
  site_building_uuid: string | null;
  building_level_uuid: string | null;
  grid_scheme_uuid: string | null;
  grid_reference: string | null;
  x_ft: number | null;
  y_ft: number | null;
  z_ft: number | null;
  location_source: LevelLocationSource | null;
  location_precision: string | null;
}

export function emptyLocation(): LevelQualifiedLocation {
  return {
    site_building_uuid: null,
    building_level_uuid: null,
    grid_scheme_uuid: null,
    grid_reference: null,
    x_ft: null,
    y_ft: null,
    z_ft: null,
    location_source: null,
    location_precision: null,
  };
}

/**
 * Uniqueness scope of a grid reference. Mirrors the database unique index on
 * (site_building_id, building_level_uuid, grid_scheme_uuid, upper(grid_reference)).
 */
export function gridRefScopeKey(loc: Partial<LevelQualifiedLocation>): string {
  return [
    norm(loc.site_building_uuid),
    norm(loc.building_level_uuid),
    norm(loc.grid_scheme_uuid),
    up(loc.grid_reference),
  ].join("|");
}

export function sameGridRefScope(
  a: Partial<LevelQualifiedLocation>,
  b: Partial<LevelQualifiedLocation>,
): boolean {
  return gridRefScopeKey(a) === gridRefScopeKey(b);
}

/** Human display reference, e.g. "House / Level 2 / C4". */
export function displayLevelRef(
  buildingName: string,
  level: Pick<BuildingLevel, "display_name"> | null | undefined,
  gridReference?: string | null,
): string {
  return [norm(buildingName), norm(level?.display_name), up(gridReference)]
    .filter(Boolean)
    .join(" / ");
}

/** Compact reference for labels and exports, e.g. "HS-L02-C4". */
export function compactLevelRef(
  buildingCode: string,
  level: Pick<BuildingLevel, "short_code"> | null | undefined,
  gridReference?: string | null,
): string {
  return [up(buildingCode), up(level?.short_code), up(gridReference)].filter(Boolean).join("-");
}

/**
 * Backward-compatible display for single-level structures: the level segment is
 * omitted on screen while the API still returns structured level data.
 */
export function displayForContext(
  buildingName: string,
  buildingCode: string,
  level: BuildingLevel | null | undefined,
  gridReference: string | null | undefined,
  opts: { levelCount: number; compact?: boolean },
): string {
  const hideLevel = opts.levelCount <= 1;
  const lvl = hideLevel ? null : level;
  return opts.compact
    ? compactLevelRef(buildingCode, lvl, gridReference)
    : displayLevelRef(buildingName, lvl, gridReference);
}

// ---------------------------------------------------------------------------
// Level-aware precedence
// ---------------------------------------------------------------------------

export interface LevelLocationStatement {
  id?: string | null;
  source: LevelLocationSource;
  /** null = the source does not know which level it describes. */
  building_level_uuid: string | null;
  grid_reference?: string | null;
  x_ft?: number | null;
  y_ft?: number | null;
  z_ft?: number | null;
  /** Observed sources must be accepted (applied observation) to be eligible. */
  accepted?: boolean | null;
  evidence?: string | null;
  observed_at?: string | null;
  /** Pole alignment only applies to perimeter locations. */
  perimeter?: boolean | null;
}

export type LevelFlagCode =
  | "UNQUALIFIED_LEVEL_WITHHELD"
  | "UNQUALIFIED_LEVEL_ONLY_STATEMENT"
  | "POLE_ALIGNMENT_NOT_PERIMETER"
  | "OBSERVATION_NOT_ACCEPTED"
  | "LEVEL_CONFLICT";

export interface LevelFlag {
  code: LevelFlagCode;
  severity: "warning" | "error";
  message: string;
  statementId?: string | null;
}

export interface ResolvedLevelLocation {
  winner: LevelLocationStatement | null;
  /** Eligible statements, highest precedence first. Nothing is discarded. */
  ranked: LevelLocationStatement[];
  /** Every statement supplied, preserved verbatim as superseded evidence. */
  preserved: LevelLocationStatement[];
  flags: LevelFlag[];
  location: LevelQualifiedLocation;
}

export interface ResolveLevelContext {
  site_building_uuid: string | null;
  levels: BuildingLevel[];
  /** Used only when the building is confirmed single-level. */
  defaultLevelUuid?: string | null;
}

function rank(source: LevelLocationSource): number {
  const i = LEVEL_LOCATION_PRIORITY.indexOf(source);
  return i < 0 ? LEVEL_LOCATION_PRIORITY.length : i;
}

/**
 * Resolve the effective location for one object, applying precedence
 * independently on each level.
 */
export function resolveLevelLocation(
  statements: LevelLocationStatement[],
  ctx: ResolveLevelContext,
): ResolvedLevelLocation {
  const flags: LevelFlag[] = [];
  const singleLevel = ctx.levels.length <= 1;
  const defaultLevel = ctx.defaultLevelUuid ?? (singleLevel ? ctx.levels[0]?.id ?? null : null);

  const qualified: LevelLocationStatement[] = [];
  const unqualified: LevelLocationStatement[] = [];

  for (const s of statements) {
    if (s.source === "FIELD_OBSERVED_POLE_ALIGNMENT" && s.perimeter !== true) {
      flags.push({
        code: "POLE_ALIGNMENT_NOT_PERIMETER",
        severity: "warning",
        statementId: s.id ?? null,
        message: "Pole alignment only applies to a perimeter location, so it was not used.",
      });
      continue;
    }
    const observed = s.source.startsWith("FIELD_OBSERVED");
    if (observed && s.accepted !== true) {
      flags.push({
        code: "OBSERVATION_NOT_ACCEPTED",
        severity: "warning",
        statementId: s.id ?? null,
        message: "Field observation is not accepted yet, so it does not set the location.",
      });
      continue;
    }
    if (s.building_level_uuid) qualified.push(s);
    else if (singleLevel && defaultLevel)
      qualified.push({ ...s, building_level_uuid: defaultLevel });
    else unqualified.push(s);
  }

  const ranked = [...qualified].sort((a, b) => rank(a.source) - rank(b.source));
  const winner = ranked[0] ?? null;

  for (const s of unqualified) {
    flags.push({
      code: winner ? "UNQUALIFIED_LEVEL_WITHHELD" : "UNQUALIFIED_LEVEL_ONLY_STATEMENT",
      severity: "warning",
      statementId: s.id ?? null,
      message: winner
        ? "A location with no known building level was kept as evidence only; it cannot overwrite the level-qualified location."
        : "This location has no known building level. Assign a level through the normal preview and approval workflow.",
    });
  }

  if (winner) {
    const rivals = ranked.filter(
      (s) => s !== winner && rank(s.source) === rank(winner.source) && !supersededBy(winner, s),
    );
    for (const r of rivals) {
      const disagrees =
        up(r.grid_reference) !== up(winner.grid_reference) ||
        r.building_level_uuid !== winner.building_level_uuid;
      if (disagrees) {
        flags.push({
          code: "LEVEL_CONFLICT",
          severity: "error",
          statementId: r.id ?? null,
          message:
            "Two accepted statements of the same precedence disagree about the level or grid reference. This needs adjudication.",
        });
      }
    }
  }

  const scheme = winner
    ? ctx.levels.find((l) => l.id === winner.building_level_uuid)?.grid_scheme_uuid ?? null
    : null;

  return {
    winner,
    ranked,
    preserved: statements,
    flags,
    location: winner
      ? {
          site_building_uuid: ctx.site_building_uuid,
          building_level_uuid: winner.building_level_uuid,
          grid_scheme_uuid: scheme,
          grid_reference: winner.grid_reference ? up(winner.grid_reference) : null,
          x_ft: winner.x_ft ?? null,
          y_ft: winner.y_ft ?? null,
          z_ft: winner.z_ft ?? null,
          location_source: winner.source,
          location_precision: LEVEL_LOCATION_PRECISION[winner.source],
        }
      : emptyLocation(),
  };
}

function supersededBy(winner: LevelLocationStatement, other: LevelLocationStatement): boolean {
  return Boolean(winner.observed_at && other.observed_at && winner.observed_at > other.observed_at);
}

// ---------------------------------------------------------------------------
// Moving an object between levels
// ---------------------------------------------------------------------------

export interface LevelMoveResult<T extends { stable_id: string }> {
  before: LevelQualifiedLocation;
  after: LevelQualifiedLocation;
  record: T & LevelQualifiedLocation;
  stable_id_changed: false;
}

/**
 * Move an object to another level. Only location components change: the stable
 * ID is copied through untouched.
 */
export function moveToLevel<T extends { stable_id: string } & Partial<LevelQualifiedLocation>>(
  record: T,
  target: { level: BuildingLevel; grid_reference?: string | null; x_ft?: number | null; y_ft?: number | null; z_ft?: number | null },
): LevelMoveResult<T> {
  const before: LevelQualifiedLocation = { ...emptyLocation(), ...stripLocation(record) };
  const after: LevelQualifiedLocation = {
    site_building_uuid: target.level.site_building_id,
    building_level_uuid: target.level.id,
    grid_scheme_uuid: target.level.grid_scheme_uuid,
    grid_reference: target.grid_reference ? up(target.grid_reference) : before.grid_reference,
    x_ft: target.x_ft ?? before.x_ft,
    y_ft: target.y_ft ?? before.y_ft,
    z_ft: target.z_ft ?? before.z_ft,
    location_source: before.location_source,
    location_precision: before.location_precision,
  };
  return { before, after, record: { ...record, ...after }, stable_id_changed: false };
}

function stripLocation(row: Partial<LevelQualifiedLocation>): Partial<LevelQualifiedLocation> {
  const keys: (keyof LevelQualifiedLocation)[] = [
    "site_building_uuid",
    "building_level_uuid",
    "grid_scheme_uuid",
    "grid_reference",
    "x_ft",
    "y_ft",
    "z_ft",
    "location_source",
    "location_precision",
  ];
  const out: Partial<LevelQualifiedLocation> = {};
  for (const k of keys) if (row[k] !== undefined) (out as Record<string, unknown>)[k] = row[k];
  return out;
}

// ---------------------------------------------------------------------------
// Filtering, overlays and counting
// ---------------------------------------------------------------------------

export const ALL_LEVELS = "ALL" as const;
export type LevelSelection = string | typeof ALL_LEVELS;

export interface LocatedObject extends Partial<LevelQualifiedLocation> {
  stable_id: string;
}

/** Objects shown for one level, or every level when "ALL" is selected. */
export function filterByLevel<T extends LocatedObject>(rows: T[], level: LevelSelection): T[] {
  if (level === ALL_LEVELS) return rows;
  return rows.filter((r) => norm(r.building_level_uuid) === norm(level));
}

/**
 * All-levels overview: identical grid references on different floors are kept
 * as separate markers keyed by level, never stacked as if on one floor.
 */
export function allLevelsMarkers<T extends LocatedObject>(
  rows: T[],
  levels: BuildingLevel[],
): { key: string; level: BuildingLevel | null; row: T }[] {
  const byId = new Map(levels.map((l) => [l.id, l]));
  return rows.map((row) => ({
    key: `${gridRefScopeKey(row)}#${row.stable_id}`,
    level: byId.get(norm(row.building_level_uuid)) ?? null,
    row,
  }));
}

/** True when two objects occupy the same cell on the same level. */
export function overlapsInFilteredView(a: LocatedObject, b: LocatedObject): boolean {
  return a.stable_id !== b.stable_id && sameGridRefScope(a, b);
}

/**
 * Demand, circuit and completeness maths must count each object once, even in
 * an all-level view where one object can appear in several level layers.
 */
export function countOnce<T extends LocatedObject>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const key = up(r.stable_id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Vertical (riser) runs between levels
// ---------------------------------------------------------------------------

export const VERTICAL_RUN_KINDS = ["RISER", "DROP", "SLEEVE", "CHASE", "SHAFT"] as const;
export type VerticalRunKind = (typeof VERTICAL_RUN_KINDS)[number];

export interface LevelCrossingRun {
  stable_id: string;
  source_building_level_uuid: string | null;
  dest_building_level_uuid: string | null;
  source_level_grid_reference?: string | null;
  dest_level_grid_reference?: string | null;
  vertical_run_kind?: string | null;
  vertical_rise_ft?: number | null;
  /** Relationship only — crossing a level never creates another group. */
  circuit_group_ref?: string | null;
}

export interface VerticalSegment {
  stable_id: string;
  from_level: BuildingLevel | null;
  to_level: BuildingLevel | null;
  direction: "UP" | "DOWN" | "SAME_LEVEL";
  from_grid_reference: string | null;
  to_grid_reference: string | null;
  kind: VerticalRunKind;
  rise_ft: number | null;
  circuit_group_ref: string | null;
  /** Diagram edge label, e.g. "up to Second Floor". */
  edge_label: string;
}

/** Describe the vertical portion of a run that crosses a level boundary. */
export function verticalSegment(
  run: LevelCrossingRun,
  levels: BuildingLevel[],
): VerticalSegment | null {
  const byId = new Map(levels.map((l) => [l.id, l]));
  const from = byId.get(norm(run.source_building_level_uuid)) ?? null;
  const to = byId.get(norm(run.dest_building_level_uuid)) ?? null;
  if (!from || !to || from.id === to.id) return null;
  const direction = to.sort_order > from.sort_order ? "UP" : "DOWN";
  const rise =
    run.vertical_rise_ft ??
    (from.elevation_ft != null && to.elevation_ft != null
      ? Math.abs(Number(to.elevation_ft) - Number(from.elevation_ft))
      : null);
  const kind = (VERTICAL_RUN_KINDS as readonly string[]).includes(up(run.vertical_run_kind))
    ? (up(run.vertical_run_kind) as VerticalRunKind)
    : direction === "UP"
      ? "RISER"
      : "DROP";
  return {
    stable_id: run.stable_id,
    from_level: from,
    to_level: to,
    direction,
    from_grid_reference: run.source_level_grid_reference
      ? up(run.source_level_grid_reference)
      : null,
    to_grid_reference: run.dest_level_grid_reference ? up(run.dest_level_grid_reference) : null,
    kind,
    rise_ft: rise,
    circuit_group_ref: run.circuit_group_ref ?? null,
    edge_label: `${direction === "UP" ? "up to" : "down to"} ${to.display_name}`,
  };
}

/** Every level-crossing run, for the diagram's explicit up/down connections. */
export function verticalSegments(
  runs: LevelCrossingRun[],
  levels: BuildingLevel[],
): VerticalSegment[] {
  return runs
    .map((r) => verticalSegment(r, levels))
    .filter((s): s is VerticalSegment => s !== null);
}

// ---------------------------------------------------------------------------
// Migration and reconciliation
// ---------------------------------------------------------------------------

export interface LevelMigrationPlanRow {
  stable_id: string;
  action: "ATTACH_TO_DEFAULT_LEVEL" | "WITHHOLD_AMBIGUOUS";
  reason: string;
  before: LevelQualifiedLocation;
  after: LevelQualifiedLocation | null;
  coordinates_unchanged: boolean;
}

export interface LevelMigrationPlan {
  building_confirmed_single_level: boolean;
  default_level_short_code: string | null;
  rows: LevelMigrationPlanRow[];
  attach_count: number;
  withheld_count: number;
}

/**
 * Preview-only plan. For a confirmed single-level building every existing
 * location is attached to the default Ground Floor level, keeping coordinates
 * and stable IDs exactly as recorded. Anything in a multistory structure with no
 * known level is withheld for the read-only reconciliation report.
 */
export function planLevelMigration(
  rows: LocatedObject[],
  opts: { confirmedSingleLevel: boolean; defaultLevel: BuildingLevel | null },
): LevelMigrationPlan {
  const out: LevelMigrationPlanRow[] = rows.map((row) => {
    const before: LevelQualifiedLocation = { ...emptyLocation(), ...stripLocation(row) };
    if (before.building_level_uuid) {
      return {
        stable_id: row.stable_id,
        action: "ATTACH_TO_DEFAULT_LEVEL",
        reason: "Already level-qualified; left exactly as recorded.",
        before,
        after: before,
        coordinates_unchanged: true,
      };
    }
    if (!opts.confirmedSingleLevel || !opts.defaultLevel) {
      return {
        stable_id: row.stable_id,
        action: "WITHHOLD_AMBIGUOUS",
        reason:
          "The building is not confirmed single-level, so no floor can be assigned without evidence.",
        before,
        after: null,
        coordinates_unchanged: true,
      };
    }
    return {
      stable_id: row.stable_id,
      action: "ATTACH_TO_DEFAULT_LEVEL",
      reason: `Confirmed single-level building: attached to ${opts.defaultLevel.display_name}.`,
      before,
      after: {
        ...before,
        site_building_uuid: opts.defaultLevel.site_building_id,
        building_level_uuid: opts.defaultLevel.id,
        grid_scheme_uuid: opts.defaultLevel.grid_scheme_uuid,
      },
      coordinates_unchanged: true,
    };
  });
  return {
    building_confirmed_single_level: opts.confirmedSingleLevel,
    default_level_short_code: opts.defaultLevel?.short_code ?? null,
    rows: out,
    attach_count: out.filter((r) => r.action === "ATTACH_TO_DEFAULT_LEVEL").length,
    withheld_count: out.filter((r) => r.action === "WITHHOLD_AMBIGUOUS").length,
  };
}

export interface LevelReconciliationRow {
  stable_id: string;
  issue: "NO_LEVEL" | "LEVEL_UNKNOWN_TO_BUILDING" | "DUPLICATE_CELL_ON_LEVEL";
  message: string;
}

/** Read-only report. It never writes and never guesses a level. */
export function levelReconciliationReport(
  rows: LocatedObject[],
  levels: BuildingLevel[],
): LevelReconciliationRow[] {
  const known = new Set(levels.map((l) => l.id));
  const seen = new Map<string, string>();
  const out: LevelReconciliationRow[] = [];
  for (const row of rows) {
    const level = norm(row.building_level_uuid);
    if (!level) {
      out.push({
        stable_id: row.stable_id,
        issue: "NO_LEVEL",
        message: "No building level recorded. Assign one through preview and approval.",
      });
      continue;
    }
    if (!known.has(level)) {
      out.push({
        stable_id: row.stable_id,
        issue: "LEVEL_UNKNOWN_TO_BUILDING",
        message: "The recorded level does not belong to this building.",
      });
      continue;
    }
    if (!row.grid_reference) continue;
    const key = gridRefScopeKey(row);
    const prior = seen.get(key);
    if (prior) {
      out.push({
        stable_id: row.stable_id,
        issue: "DUPLICATE_CELL_ON_LEVEL",
        message: `Shares the same grid cell on this level with ${prior}.`,
      });
    } else seen.set(key, row.stable_id);
  }
  return out;
}

/** Structured level payload for the API, exports, labels, AI and peer sync. */
export function levelApiPayload(
  level: BuildingLevel | null | undefined,
  loc: Partial<LevelQualifiedLocation>,
  ctx: { buildingName: string; buildingCode: string; levelCount: number },
): Record<string, unknown> {
  return {
    site_building_uuid: loc.site_building_uuid ?? null,
    building_level_uuid: loc.building_level_uuid ?? null,
    building_level_stable_id: level?.level_stable_id ?? null,
    building_level_name: level?.display_name ?? null,
    building_level_code: level?.short_code ?? null,
    building_level_sort_order: level?.sort_order ?? null,
    elevation_ft: level?.elevation_ft ?? null,
    grid_scheme_uuid: loc.grid_scheme_uuid ?? null,
    grid_reference: loc.grid_reference ?? null,
    x_ft: loc.x_ft ?? null,
    y_ft: loc.y_ft ?? null,
    z_ft: loc.z_ft ?? null,
    location_source: loc.location_source ?? null,
    location_precision: loc.location_precision ?? null,
    display_reference: displayForContext(
      ctx.buildingName,
      ctx.buildingCode,
      level,
      loc.grid_reference ?? null,
      { levelCount: ctx.levelCount },
    ),
    compact_reference: displayForContext(
      ctx.buildingName,
      ctx.buildingCode,
      level,
      loc.grid_reference ?? null,
      { levelCount: ctx.levelCount, compact: true },
    ),
  };
}
