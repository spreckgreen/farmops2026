/* ============================================================================
 * Farm Shop grid-map recovery validation — canonical-derived, read-only.
 *
 * The displayed grid map is rebuilt from the SHA-authorized canonical ODS Grid
 * field (bound by Contract v3), never from the current FarmOps grid column,
 * because the original Load_Master import had proven column-mapping defects.
 *
 * Nothing here writes. No location field is ever produced for persistence, no
 * geometry is changed (the frozen old→new transformation is reused verbatim),
 * and no location is invented where the record does not state one.
 * ========================================================================= */
import {
  SHOP_DEPTH_FT,
  SHOP_WIDTH_FT,
  migrateRow,
  type GridConfidence,
  type GridMigrationRow,
  type GridPrecision,
  type MigrationInputRow,
} from "@/lib/electrical-grid-migration";

export const GRID_RECOVERY_VERSION = "farm-shop-grid-recovery-validation-1";
export const NOT_IN_RECORD = "NOT IN RECORD";

export type RecoveryOverlay =
  | "EXACT"
  | "NEAREST"
  | "INTERVAL"
  | "UNRESOLVED"
  | "NON_FIXED"
  | "FARMOPS_GRID_DISAGREES_WITH_CANONICAL";

export const OVERLAY_ORDER: RecoveryOverlay[] = [
  "EXACT",
  "NEAREST",
  "INTERVAL",
  "UNRESOLVED",
  "NON_FIXED",
  "FARMOPS_GRID_DISAGREES_WITH_CANONICAL",
];

export const OVERLAY_META: Record<RecoveryOverlay, { label: string; dot: string; swatch: string }> =
  {
    EXACT: { label: "Exact intersection", dot: "bg-emerald-500", swatch: "bg-emerald-500" },
    NEAREST: { label: "Nearest gridline", dot: "bg-sky-500", swatch: "bg-sky-500" },
    INTERVAL: { label: "Interval preserved", dot: "bg-amber-500", swatch: "bg-amber-500" },
    UNRESOLVED: { label: "Unresolved", dot: "bg-muted-foreground", swatch: "bg-muted-foreground" },
    NON_FIXED: { label: "Non-fixed (MOBILE)", dot: "bg-violet-500", swatch: "bg-violet-500" },
    FARMOPS_GRID_DISAGREES_WITH_CANONICAL: {
      label: "FarmOps grid disagrees with canonical",
      dot: "bg-red-500",
      swatch: "bg-red-500",
    },
  };

const s = (v: unknown): string => (v == null ? "" : String(v)).trim();

/** Grid text comparison: case and internal whitespace are not meaningful. */
export function normalizeGridText(raw: string): string {
  return s(raw).toUpperCase().replace(/\s+/g, "");
}

export interface CanonicalGridRow {
  stable_id: string;
  description: string;
  area: string;
  location: string;
  /** Raw Grid cell text from the canonical workbook, Contract-v3 bound. */
  canonical_grid_raw: string;
}

export interface FarmOpsGridRow {
  stable_id: string;
  description: string;
  area: string;
  location: string;
  grid: string;
}

export interface RecoveryRow {
  kind: "load" | "panel";
  stable_id: string;
  description: string;
  canonical_grid_raw: string;
  farmops_grid_current: string;
  x_ft: number | null;
  y_ft: number | null;
  derived_new_grid: string | null;
  precision: GridPrecision;
  evidence: string[];
  confidence: GridConfidence;
  provenance: string;
  review_required: boolean;
  /** True when the current FarmOps grid text differs from canonical. */
  farmops_disagrees: boolean;
  disagreement_note: string;
  overlay: RecoveryOverlay;
  /** Plot position as a percentage of the corrected plan envelope. */
  x_pct: number | null;
  y_pct: number | null;
  stack_index: number;
  stack_size: number;
}

/** Wall statements available as independent physical-location evidence. */
const WALL_RULES: { match: RegExp; axis: "x" | "y"; ft: number; label: string }[] = [
  { match: /east\s*wall/i, axis: "x", ft: SHOP_WIDTH_FT, label: "east wall (column 9)" },
  { match: /west\s*wall/i, axis: "x", ft: 0, label: "west wall (column 1)" },
  { match: /north\s*wall/i, axis: "y", ft: 0, label: "north wall (row A)" },
  { match: /south\s*wall/i, axis: "y", ft: SHOP_DEPTH_FT, label: "south wall (row F)" },
];

/** Half the envelope on each axis — the threshold a wall statement must satisfy. */
const X_MID = SHOP_WIDTH_FT / 2;
const Y_MID = SHOP_DEPTH_FT / 2;

export interface CanonicalPlacementConflict {
  stable_id: string;
  description: string;
  canonical_grid_raw: string;
  x_ft: number | null;
  y_ft: number | null;
  derived_new_grid: string | null;
  evidence: string;
  conflict: string;
}

/**
 * Does the canonical Grid value itself place the equipment somewhere its own
 * recorded wall designation contradicts? This is the only signal that can
 * implicate the canonical assignments rather than the FarmOps import.
 */
export function canonicalPlacementConflict(
  row: RecoveryRow,
  text: string,
): CanonicalPlacementConflict | null {
  if (row.x_ft == null || row.y_ft == null) return null;
  for (const rule of WALL_RULES) {
    if (!rule.match.test(text)) continue;
    if (rule.axis === "x") {
      const far = rule.ft === 0 ? row.x_ft > X_MID : row.x_ft < X_MID;
      if (far) {
        return {
          stable_id: row.stable_id,
          description: row.description,
          canonical_grid_raw: row.canonical_grid_raw,
          x_ft: row.x_ft,
          y_ft: row.y_ft,
          derived_new_grid: row.derived_new_grid,
          evidence: `Location/description states ${rule.label}.`,
          conflict: `Canonical Grid "${row.canonical_grid_raw}" derives ${row.x_ft} ft east, which is on the opposite half of the building from the stated ${rule.label}.`,
        };
      }
    } else {
      const far = rule.ft === 0 ? row.y_ft > Y_MID : row.y_ft < Y_MID;
      if (far) {
        return {
          stable_id: row.stable_id,
          description: row.description,
          canonical_grid_raw: row.canonical_grid_raw,
          x_ft: row.x_ft,
          y_ft: row.y_ft,
          derived_new_grid: row.derived_new_grid,
          evidence: `Location/description states ${rule.label}.`,
          conflict: `Canonical Grid "${row.canonical_grid_raw}" derives ${row.y_ft} ft south, which is on the opposite half of the building from the stated ${rule.label}.`,
        };
      }
    }
  }
  return null;
}

function overlayFor(precision: GridPrecision, disagrees: boolean): RecoveryOverlay {
  if (disagrees) return "FARMOPS_GRID_DISAGREES_WITH_CANONICAL";
  return precision;
}

function toRecovery(
  input: MigrationInputRow,
  canonicalGridRaw: string,
  farmOpsGrid: string,
): RecoveryRow {
  const migrated: GridMigrationRow = migrateRow(input);
  const canon = normalizeGridText(canonicalGridRaw);
  const current = normalizeGridText(farmOpsGrid);
  const disagrees = canon.length > 0 && current.length > 0 && canon !== current;
  return {
    kind: input.kind,
    stable_id: migrated.stable_id,
    description: migrated.description || NOT_IN_RECORD,
    canonical_grid_raw: canonicalGridRaw || NOT_IN_RECORD,
    farmops_grid_current: farmOpsGrid || NOT_IN_RECORD,
    x_ft: migrated.location_x_ft,
    y_ft: migrated.location_y_ft,
    derived_new_grid: migrated.grid_reference,
    precision: migrated.grid_reference_precision,
    evidence: migrated.supporting_evidence,
    confidence: migrated.confidence,
    provenance: migrated.grid_migration_provenance,
    review_required: migrated.review_required,
    farmops_disagrees: disagrees,
    disagreement_note: disagrees
      ? `Canonical Grid "${canonicalGridRaw}" vs current FarmOps grid "${farmOpsGrid}". Canonical is the source of location here; FarmOps is not trusted for grid.`
      : canon.length === 0
        ? "Canonical Grid is empty for this record, so no comparison is possible."
        : current.length === 0
          ? "FarmOps has no grid value for this record, so no comparison is possible."
          : "Canonical and FarmOps grid text agree.",
    overlay: overlayFor(migrated.grid_reference_precision, disagrees),
    x_pct: migrated.location_x_ft == null ? null : (migrated.location_x_ft / SHOP_WIDTH_FT) * 100,
    y_pct: migrated.location_y_ft == null ? null : (migrated.location_y_ft / SHOP_DEPTH_FT) * 100,
    stack_index: 0,
    stack_size: 1,
  };
}

/** Fan co-located dots so every device stays individually hoverable. */
function applyFan(rows: RecoveryRow[]): RecoveryRow[] {
  const buckets = new Map<string, number>();
  for (const r of rows) {
    if (r.x_ft == null) continue;
    const key = `${r.x_ft}:${r.y_ft}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return rows.map((r) => {
    if (r.x_ft == null || r.x_pct == null || r.y_pct == null) return r;
    const key = `${r.x_ft}:${r.y_ft}`;
    const size = buckets.get(key) ?? 1;
    const index = seen.get(key) ?? 0;
    seen.set(key, index + 1);
    if (size <= 1 || index === 0) return { ...r, stack_index: index, stack_size: size };
    const ring = Math.ceil(index / 8);
    const slot = (index - 1) % 8;
    const angle = (slot / 8) * Math.PI * 2;
    const radius = 1.6 * ring;
    const clamp = (v: number) => Math.min(100, Math.max(0, v));
    return {
      ...r,
      stack_index: index,
      stack_size: size,
      x_pct: clamp(r.x_pct + ((Math.cos(angle) * radius) / SHOP_WIDTH_FT) * 100),
      y_pct: clamp(r.y_pct + ((Math.sin(angle) * radius) / SHOP_DEPTH_FT) * 100),
    };
  });
}

export interface SourceDelta {
  stable_id: string;
  canonical_grid_raw: string;
  farmops_grid_current: string;
  canonical_position: string;
  farmops_position: string;
  canonical_derived_grid: string;
  farmops_derived_grid: string;
  canonical_precision: GridPrecision;
  farmops_precision: GridPrecision;
  changed_fields: string[];
}

export interface RecoveryDiagnosis {
  verdict:
    | "FARMOPS_IMPORT_DEFECT"
    | "CANONICAL_PLACEMENT_SUSPECT"
    | "MIXED"
    | "NO_DEFECT_DETECTED_IN_EITHER_SOURCE";
  statement: string;
  farmops_grid_disagreements: number;
  canonical_placement_conflicts: number;
  conflicts: CanonicalPlacementConflict[];
}

export interface RecoveryReport {
  version: string;
  rows: RecoveryRow[];
  counts: Record<RecoveryOverlay, number>;
  precision: Record<GridPrecision, number>;
  placed: number;
  unplaced: number;
  total: number;
  /** How the previously generated migration population changes under canonical. */
  delta: {
    compared: number;
    changed: number;
    unchanged: number;
    records: SourceDelta[];
  };
  diagnosis: RecoveryDiagnosis;
}

const emptyOverlayCounts = (): Record<RecoveryOverlay, number> => ({
  EXACT: 0,
  NEAREST: 0,
  INTERVAL: 0,
  UNRESOLVED: 0,
  NON_FIXED: 0,
  FARMOPS_GRID_DISAGREES_WITH_CANONICAL: 0,
});

const emptyPrecisionCounts = (): Record<GridPrecision, number> => ({
  EXACT: 0,
  NEAREST: 0,
  INTERVAL: 0,
  NON_FIXED: 0,
  UNRESOLVED: 0,
});

function position(row: { x_ft: number | null; y_ft: number | null }): string {
  return row.x_ft == null || row.y_ft == null
    ? "NOT PLACED"
    : `${row.x_ft} ft east, ${row.y_ft} ft south`;
}

/**
 * Build the recovery validation. `canonical` supplies location; `farmOps` is
 * only used for the comparison column and for panel records that the canonical
 * Load_Master does not carry.
 */
export function buildGridRecovery(args: {
  canonical: CanonicalGridRow[];
  farmOps: FarmOpsGridRow[];
  panels: FarmOpsGridRow[];
}): RecoveryReport {
  const farmOpsById = new Map(args.farmOps.map((r) => [r.stable_id, r]));

  const loadRows = args.canonical.map((c) => {
    const live = farmOpsById.get(c.stable_id);
    const input: MigrationInputRow = {
      kind: "load",
      stable_id: c.stable_id,
      description: c.description || live?.description || "",
      grid: c.canonical_grid_raw,
      location: c.location || live?.location || "",
      area: c.area || live?.area || "",
    };
    return toRecovery(input, c.canonical_grid_raw, live ? live.grid : "");
  });

  const panelRows = args.panels.map((p) =>
    toRecovery(
      {
        kind: "panel",
        stable_id: p.stable_id,
        description: p.description,
        grid: p.grid,
        location: p.location,
        area: p.area,
      },
      "",
      p.grid,
    ),
  );

  const rows = applyFan([...panelRows, ...loadRows]);

  const counts = emptyOverlayCounts();
  const precision = emptyPrecisionCounts();
  let placed = 0;
  for (const r of rows) {
    counts[r.overlay] += 1;
    precision[r.precision] += 1;
    if (r.x_pct != null && r.y_pct != null) placed += 1;
  }

  // Source-of-legacy-grid delta across the migration population.
  const records: SourceDelta[] = [];
  for (const c of args.canonical) {
    const live = farmOpsById.get(c.stable_id);
    const base = {
      description: c.description || live?.description || "",
      location: c.location || live?.location || "",
      area: c.area || live?.area || "",
    };
    const fromCanonical = migrateRow({
      kind: "load",
      stable_id: c.stable_id,
      grid: c.canonical_grid_raw,
      ...base,
    });
    const fromFarmOps = migrateRow({
      kind: "load",
      stable_id: c.stable_id,
      grid: live ? live.grid : "",
      ...base,
    });
    const changed: string[] = [];
    if (fromCanonical.location_x_ft !== fromFarmOps.location_x_ft) changed.push("location_x_ft");
    if (fromCanonical.location_y_ft !== fromFarmOps.location_y_ft) changed.push("location_y_ft");
    if (fromCanonical.grid_reference !== fromFarmOps.grid_reference) changed.push("grid_reference");
    if (fromCanonical.grid_reference_precision !== fromFarmOps.grid_reference_precision)
      changed.push("grid_reference_precision");
    records.push({
      stable_id: c.stable_id,
      canonical_grid_raw: c.canonical_grid_raw || NOT_IN_RECORD,
      farmops_grid_current: (live ? live.grid : "") || NOT_IN_RECORD,
      canonical_position: position({
        x_ft: fromCanonical.location_x_ft,
        y_ft: fromCanonical.location_y_ft,
      }),
      farmops_position: position({
        x_ft: fromFarmOps.location_x_ft,
        y_ft: fromFarmOps.location_y_ft,
      }),
      canonical_derived_grid: fromCanonical.grid_reference ?? NOT_IN_RECORD,
      farmops_derived_grid: fromFarmOps.grid_reference ?? NOT_IN_RECORD,
      canonical_precision: fromCanonical.grid_reference_precision,
      farmops_precision: fromFarmOps.grid_reference_precision,
      changed_fields: changed,
    });
  }
  const changedRecords = records.filter((r) => r.changed_fields.length > 0);

  // Acceptance question: which source is actually wrong?
  const conflicts: CanonicalPlacementConflict[] = [];
  for (const r of rows) {
    if (r.kind !== "load") continue;
    const c = args.canonical.find((x) => x.stable_id === r.stable_id);
    const conflict = canonicalPlacementConflict(
      r,
      `${r.description} ${c?.location ?? ""} ${c?.area ?? ""}`,
    );
    if (conflict) conflicts.push(conflict);
  }
  const disagreements = counts.FARMOPS_GRID_DISAGREES_WITH_CANONICAL;

  let verdict: RecoveryDiagnosis["verdict"];
  let statement: string;
  if (disagreements > 0 && conflicts.length === 0) {
    verdict = "FARMOPS_IMPORT_DEFECT";
    statement = `${disagreements} Farm Shop record(s) carry a FarmOps grid value that differs from the canonical Grid field, and no canonical assignment contradicts its own recorded wall designation. The wrong map is caused by the corrupted FarmOps grid import, not by the canonical ODS.`;
  } else if (disagreements > 0 && conflicts.length > 0) {
    verdict = "MIXED";
    statement = `${disagreements} record(s) show a corrupted FarmOps grid value and ${conflicts.length} canonical Grid assignment(s) contradict their own recorded wall designation. Both sources contribute; each canonical conflict needs owner adjudication before any location is written.`;
  } else if (disagreements === 0 && conflicts.length > 0) {
    verdict = "CANONICAL_PLACEMENT_SUSPECT";
    statement = `FarmOps grid text matches canonical everywhere, but ${conflicts.length} canonical Grid assignment(s) place equipment on the opposite half of the building from their own recorded wall designation. The canonical assignments themselves are the suspect input.`;
  } else {
    verdict = "NO_DEFECT_DETECTED_IN_EITHER_SOURCE";
    statement =
      "Canonical and FarmOps grid text agree on every compared record, and no canonical assignment contradicts its recorded wall designation. Any remaining map error is a rendering or geometry-interpretation question, not a data defect.";
  }

  return {
    version: GRID_RECOVERY_VERSION,
    rows,
    counts,
    precision,
    placed,
    unplaced: rows.length - placed,
    total: rows.length,
    delta: {
      compared: records.length,
      changed: changedRecords.length,
      unchanged: records.length - changedRecords.length,
      records,
    },
    diagnosis: {
      verdict,
      statement,
      farmops_grid_disagreements: disagreements,
      canonical_placement_conflicts: conflicts.length,
      conflicts,
    },
  };
}

const csvCell = (v: unknown): string => {
  const t = v == null ? "" : String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export function recoveryCsv(rows: RecoveryRow[]): string {
  const head = [
    "stable_id",
    "description",
    "canonical_grid_raw",
    "farmops_grid_current",
    "x_ft",
    "y_ft",
    "derived_new_grid",
    "precision",
    "overlay",
    "evidence",
    "confidence",
  ];
  return [
    head.join(","),
    ...rows.map((r) =>
      [
        r.stable_id,
        r.description,
        r.canonical_grid_raw,
        r.farmops_grid_current,
        r.x_ft ?? "",
        r.y_ft ?? "",
        r.derived_new_grid ?? "",
        r.precision,
        r.overlay,
        r.evidence.join(" | "),
        r.confidence,
      ]
        .map(csvCell)
        .join(","),
    ),
  ].join("\n");
}

export function deltaCsv(records: SourceDelta[]): string {
  const head = [
    "stable_id",
    "canonical_grid_raw",
    "farmops_grid_current",
    "canonical_position",
    "farmops_position",
    "canonical_derived_grid",
    "farmops_derived_grid",
    "canonical_precision",
    "farmops_precision",
    "changed_fields",
  ];
  return [
    head.join(","),
    ...records.map((r) =>
      [
        r.stable_id,
        r.canonical_grid_raw,
        r.farmops_grid_current,
        r.canonical_position,
        r.farmops_position,
        r.canonical_derived_grid,
        r.farmops_derived_grid,
        r.canonical_precision,
        r.farmops_precision,
        r.changed_fields.join(" | "),
      ]
        .map(csvCell)
        .join(","),
    ),
  ].join("\n");
}

export { SHOP_DEPTH_FT, SHOP_WIDTH_FT };
