// Farm Shop physical-location migration — controlled apply gate (pure logic).
//
// This module decides ONLY which previewed migration rows may be written and
// what exactly may be written for each. The frozen coordinate dictionaries in
// electrical-grid-migration.ts are treated as an immutable input: nothing here
// recomputes geometry, re-derives a grid reference, or reinterprets a precision
// classification. The physical X/Y pair is authoritative; grid_reference is the
// derived human-readable representation of that pair.
//
// Withheld by design until an owner/field decision exists:
//   * every INTERVAL row (equidistant — never snapped),
//   * every UNRESOLVED row,
//   * PNL-FS-NW and PNL-FS-NE (corner designation, mounting not confirmed).
// PNL-FS-CRIT / PNL-FS-EQ carry no location evidence at all and stay unresolved.
import {
  GRID_MIGRATION_VERSION,
  NEW_COLS,
  NEW_ROWS,
  SHOP_DEPTH_FT,
  SHOP_WIDTH_FT,
  type GridMigrationRow,
  type GridPrecision,
} from "@/lib/electrical-grid-migration";

export const GRID_APPLY_GATE_VERSION = "farm-shop-physical-location-apply-gate-1";

/**
 * Fingerprint of the frozen transformation. Any change to the row/column
 * dictionaries or the envelope changes this string and blocks every apply,
 * because a previewed coordinate would no longer mean the same thing.
 */
export const GRID_TRANSFORM_FINGERPRINT = [
  GRID_MIGRATION_VERSION,
  `envelope=${SHOP_WIDTH_FT}x${SHOP_DEPTH_FT}`,
  `rows=${NEW_ROWS.map((r) => `${r.label}@${r.yFt}`).join(",")}`,
  `cols=${NEW_COLS.map((c) => `${c.label}@${c.xFt}`).join(",")}`,
].join("|");

/** Physical-location columns this gate is permitted to write. Nothing else. */
export const LOCATION_COLUMNS = [
  "location_x_ft",
  "location_y_ft",
  "grid_reference",
  "grid_reference_precision",
  "grid_migration_provenance",
  "legacy_grid",
] as const;

export type LocationColumn = (typeof LOCATION_COLUMNS)[number];

export type GridApplyStatus =
  | "would_change"
  | "already_correct"
  | "withheld_interval"
  | "withheld_unresolved"
  | "field_confirmation_required"
  | "non_fixed"
  | "drifted"
  | "newer_evidence"
  | "not_approved"
  | "failed"
  | "applied";

/** Panels whose corner designation is a proposal only until the field confirms. */
export const FIELD_CONFIRMATION_PANELS = ["PNL-FS-NW", "PNL-FS-NE"];

/** Panels with no location evidence whatsoever — never invented. */
export const NO_EVIDENCE_PANELS = ["PNL-FS-CRIT", "PNL-FS-EQ"];

export interface GridApplyProposal {
  table: "electrical_loads" | "electrical_panels";
  kind: GridMigrationRow["kind"];
  stable_id: string;
  row_uuid: string | null;
  description: string;
  /** Legacy Grid value carried into legacy_grid for audit history. */
  legacy_grid: string;
  /** The Grid column as it currently stands in FarmOps (never modified). */
  current_farmops_grid: string;
  location_x_ft: number | null;
  location_y_ft: number | null;
  grid_reference: string | null;
  grid_reference_precision: GridPrecision;
  grid_migration_provenance: string;
  supporting_evidence: string[];
  transform_fingerprint: string;
  /** Columns this row would write, in order. */
  writes: LocationColumn[];
  status: GridApplyStatus;
  detail?: string;
  applied_at: string | null;
}

export function applyKey(p: { table: string; stable_id: string }): string {
  return `${p.table}|${p.stable_id}`;
}

export function tableFor(kind: GridMigrationRow["kind"]): GridApplyProposal["table"] {
  return kind === "panel" ? "electrical_panels" : "electrical_loads";
}

export function stableIdColumn(kind: GridMigrationRow["kind"]): string {
  return kind === "panel" ? "panel_id" : "load_id";
}

/** Withholding decision taken purely from the previewed classification. */
export function eligibility(row: GridMigrationRow): {
  eligible: boolean;
  status: GridApplyStatus;
  reason: string | null;
} {
  const id = row.stable_id.trim().toUpperCase();
  if (NO_EVIDENCE_PANELS.includes(id)) {
    return {
      eligible: false,
      status: "withheld_unresolved",
      reason: `${id} has no location evidence on record; no location is invented for it.`,
    };
  }
  if (FIELD_CONFIRMATION_PANELS.includes(id)) {
    return {
      eligible: false,
      status: "field_confirmation_required",
      reason: `${id} is a corner designation only. Withheld until the mounted enclosure location is confirmed in the field.`,
    };
  }
  switch (row.grid_reference_precision) {
    case "EXACT":
    case "NEAREST":
      return { eligible: true, status: "would_change", reason: null };
    case "NON_FIXED":
      return { eligible: true, status: "non_fixed", reason: null };
    case "INTERVAL":
      return {
        eligible: false,
        status: "withheld_interval",
        reason: `Equidistant position preserved as the interval ${row.grid_reference ?? "(interval)"}; withheld until an owner decision fixes the axis.`,
      };
    default:
      return {
        eligible: false,
        status: "withheld_unresolved",
        reason: "No physical position could be derived; withheld until independent location evidence exists.",
      };
  }
}

/**
 * The exact column patch for an eligible row. NON_FIXED rows carry only their
 * classification, provenance and legacy grid — never an X/Y pair and never a
 * fixed grid reference.
 */
export function patchFor(row: GridMigrationRow): Partial<Record<LocationColumn, unknown>> {
  if (row.grid_reference_precision === "NON_FIXED") {
    return {
      grid_reference_precision: "NON_FIXED",
      grid_migration_provenance: row.grid_migration_provenance,
      legacy_grid: row.legacy_grid,
    };
  }
  return {
    location_x_ft: row.location_x_ft,
    location_y_ft: row.location_y_ft,
    grid_reference: row.grid_reference,
    grid_reference_precision: row.grid_reference_precision,
    grid_migration_provenance: row.grid_migration_provenance,
    legacy_grid: row.legacy_grid,
  };
}

function sameNumber(a: unknown, b: number | null): boolean {
  if (b === null) return a === null || a === undefined;
  if (a === null || a === undefined) return false;
  return Math.abs(Number(a) - b) < 1e-6;
}

function sameText(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
  return norm(a) === norm(b);
}

/** True when the stored row already equals the patch this gate would write. */
export function alreadyStored(
  live: Record<string, unknown>,
  patch: Partial<Record<LocationColumn, unknown>>,
): boolean {
  for (const [k, v] of Object.entries(patch)) {
    if (k === "location_x_ft" || k === "location_y_ft") {
      if (!sameNumber(live[k], v as number | null)) return false;
    } else if (!sameText(live[k], v)) return false;
  }
  return true;
}

export interface ApplyGuardInput {
  stable_id: string;
  /** Stable ID read back from the live row immediately before the write. */
  live_stable_id: string;
  row_uuid: string | null;
  /** Legacy Grid source cell as previewed, and as it stands now. */
  previewed_legacy_grid: string;
  live_legacy_grid: string;
  /** Transformation fingerprint at preview time, and now. */
  previewed_fingerprint: string;
  current_fingerprint: string;
  /** Precision classification at preview time, and recomputed now. */
  previewed_precision: GridPrecision;
  current_precision: GridPrecision;
  /** Derived grid reference at preview time, and as re-derived from X/Y now. */
  previewed_grid_reference: string | null;
  rederived_grid_reference: string | null;
  eligible: boolean;
  withheld_status: GridApplyStatus | null;
  newer_evidence: string | null;
  approved: boolean;
}

export function stillSafeToApply(
  input: ApplyGuardInput,
): { ok: true } | { ok: false; status: GridApplyStatus; reason: string } {
  if (!input.eligible) {
    return {
      ok: false,
      status: input.withheld_status ?? "withheld_unresolved",
      reason: "Record is in the withheld set and may not be written by this gate.",
    };
  }
  if (!input.row_uuid) {
    return { ok: false, status: "failed", reason: "No FarmOps row UUID for this stable ID." };
  }
  if (input.live_stable_id.trim() !== input.stable_id.trim()) {
    return {
      ok: false,
      status: "failed",
      reason: `Row identity changed: expected ${input.stable_id}, read ${input.live_stable_id || "(none)"}.`,
    };
  }
  if (input.current_fingerprint !== input.previewed_fingerprint) {
    return {
      ok: false,
      status: "failed",
      reason: "The frozen coordinate transformation changed since preview; no write is authorized.",
    };
  }
  if (input.live_legacy_grid.trim() !== input.previewed_legacy_grid.trim()) {
    return {
      ok: false,
      status: "drifted",
      reason: `Legacy Grid changed since preview ("${input.previewed_legacy_grid}" → "${input.live_legacy_grid}").`,
    };
  }
  if (input.current_precision !== input.previewed_precision) {
    return {
      ok: false,
      status: "drifted",
      reason: `Precision classification changed since preview (${input.previewed_precision} → ${input.current_precision}).`,
    };
  }
  if (input.rederived_grid_reference !== input.previewed_grid_reference) {
    return {
      ok: false,
      status: "drifted",
      reason: `The proposed coordinates no longer derive the previewed grid reference (${input.previewed_grid_reference ?? "null"} → ${input.rederived_grid_reference ?? "null"}).`,
    };
  }
  if (input.newer_evidence) {
    return {
      ok: false,
      status: "newer_evidence",
      reason: `Newer physical-location evidence supersedes the migration: ${input.newer_evidence}`,
    };
  }
  if (!input.approved) {
    return { ok: false, status: "not_approved", reason: "This record was not approved for apply." };
  }
  return { ok: true };
}

export interface GridApplySummary {
  rows: number;
  would_change: number;
  already_correct: number;
  withheld_interval: number;
  withheld_unresolved: number;
  field_confirmation_required: number;
  non_fixed: number;
  drifted: number;
  newer_evidence: number;
  not_approved: number;
  failed: number;
  applied: number;
  eligible: number;
  withheld: number;
}

export function summarizeApply(rows: GridApplyProposal[]): GridApplySummary {
  const by = (s: GridApplyStatus) => rows.filter((r) => r.status === s).length;
  return {
    rows: rows.length,
    would_change: by("would_change"),
    already_correct: by("already_correct"),
    withheld_interval: by("withheld_interval"),
    withheld_unresolved: by("withheld_unresolved"),
    field_confirmation_required: by("field_confirmation_required"),
    non_fixed: by("non_fixed"),
    drifted: by("drifted"),
    newer_evidence: by("newer_evidence"),
    not_approved: by("not_approved"),
    failed: by("failed"),
    applied: by("applied"),
    eligible: rows.filter(
      (r) => r.status === "would_change" || r.status === "non_fixed" || r.status === "applied" || r.status === "already_correct",
    ).length,
    withheld: rows.filter(
      (r) =>
        r.status === "withheld_interval" ||
        r.status === "withheld_unresolved" ||
        r.status === "field_confirmation_required",
    ).length,
  };
}

/** Human-readable audit summary written alongside every applied row. */
export function applyAuditSummary(p: GridApplyProposal): string {
  const coords =
    p.location_x_ft === null || p.location_y_ft === null
      ? "no X/Y (non-fixed)"
      : `x=${p.location_x_ft} ft E of west wall, y=${p.location_y_ft} ft S of north wall`;
  return [
    `Farm Shop physical-location migration applied to ${p.stable_id}:`,
    `legacy grid "${p.legacy_grid || "(blank)"}" preserved;`,
    `${coords};`,
    `derived grid ${p.grid_reference ?? "none (non-fixed)"} (${p.grid_reference_precision});`,
    `transformation ${p.transform_fingerprint};`,
    p.supporting_evidence.length
      ? `evidence: ${p.supporting_evidence.join(" | ")}`
      : "evidence: frozen coordinate transformation only.",
  ].join(" ");
}

function cell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function applyProposalsCsv(rows: GridApplyProposal[]): string {
  const head = [
    "stable_id",
    "description",
    "legacy_grid",
    "current_farmops_grid",
    "x_ft",
    "y_ft",
    "proposed_grid",
    "precision",
    "evidence",
    "status",
    "detail",
    "transform_fingerprint",
  ];
  const body = rows.map((r) =>
    [
      r.stable_id,
      r.description,
      r.legacy_grid,
      r.current_farmops_grid,
      r.location_x_ft ?? "",
      r.location_y_ft ?? "",
      r.grid_reference ?? "",
      r.grid_reference_precision,
      r.supporting_evidence.join(" | "),
      r.status,
      r.detail ?? "",
      r.transform_fingerprint,
    ]
      .map((v) => cell(String(v)))
      .join(","),
  );
  return [head.join(","), ...body].join("\n");
}
