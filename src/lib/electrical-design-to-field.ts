// FARMOPS-ELEC-DESIGN-TO-FIELD-V1 — design-to-field location workflow.
//
// Two deliberate, separately approved steps for one electrical record:
//
//   1. Submit approved design coordinates. Exact feet inside the frozen Farm
//      Shop envelope, with an approval reference. The lifecycle stays planned
//      and the location stays UNVERIFIED: an approved design is not evidence.
//   2. Accept field evidence. The as-found position is recorded separately and
//      supersedes the design for the derived effective location, while every
//      design value, its approval reference and its timestamp stay on record
//      for comparison.
//
// Nothing here infers a position from a stable ID, a breaker relationship or a
// description, and nothing rewrites descriptions, notes, circuits, panels or
// electrical values. The derived A1–F9 label is a read-out of the exact feet,
// never a source in its own right.
import {
  effectiveLocationForRecord,
  formatLocationProvenance,
  type EffectiveLocation,
} from "@/lib/electrical-effective-location";
import { derivedGridLabel } from "@/lib/electrical-grid-map";
import { SHOP_DEPTH_FT, SHOP_WIDTH_FT } from "@/lib/electrical-grid-migration";

export const DESIGN_TO_FIELD_VERSION = "electrical-design-to-field-1";

/** Section recorded on every history row this workflow writes. */
export const DESIGN_TO_FIELD_SECTION = "design_to_field";

export type DesignToFieldStep = "APPROVED_DESIGN_SUBMITTED" | "FIELD_EVIDENCE_ACCEPTED";

/** Columns the design step may write. Nothing else is ever included. */
export const DESIGN_STEP_COLUMNS = [
  "design_x_ft",
  "design_y_ft",
  "design_grid",
  "design_location_source",
  "grid_migration_provenance",
] as const;

/** Columns the field-evidence step may write. Design columns are excluded. */
export const FIELD_STEP_COLUMNS = [
  "location_x_ft",
  "location_y_ft",
  "field_grid_reference",
  "grid_reference",
  "grid_reference_precision",
  "location_evidence",
  "field_verification_status",
  "verified_at",
] as const;

export type Cell = string | number | boolean | null;

export interface DesignToFieldRow {
  id: string;
  load_id: string;
  description: string | null;
  install_status: string | null;
  design_x_ft: number | null;
  design_y_ft: number | null;
  design_grid: string | null;
  design_location_source: string | null;
  grid_migration_provenance: string | null;
  location_x_ft: number | null;
  location_y_ft: number | null;
  field_grid_reference: string | null;
  grid_reference: string | null;
  grid_reference_precision: string | null;
  location_evidence: string | null;
  field_verification_status: string | null;
  verified_at: string | null;
  legacy_grid: string | null;
  grid: string | null;
  corner_reference: string | null;
  mounting_wall_face: string | null;
  coverage_direction: string | null;
  pole_scheme: string | null;
  pole_location_kind: string | null;
  pole_ref_start: string | null;
  pole_ref_end: string | null;
  updated_at: string;
}

export interface FieldChange {
  column: string;
  before: Cell;
  after: Cell;
}

export interface StepPreview {
  step: DesignToFieldStep;
  stableId: string;
  /** Exact feet the step records. */
  xFt: number;
  yFt: number;
  /** Read-out of those feet, never itself a location source. */
  derivedGrid: string;
  changes: FieldChange[];
  /** Derived effective location before and after the step. */
  effectiveBefore: string;
  effectiveAfter: string;
  supersedes: string | null;
  /** Values this step deliberately leaves alone. */
  preserved: string[];
  warnings: string[];
  expectedUpdatedAt: string;
}

/* ----------------------------------------------------------------- validation */

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface CoordinateCheck {
  ok: boolean;
  xFt: number;
  yFt: number;
  error: string | null;
}

/** Feet must be finite and inside the frozen 60 ft x 40 ft envelope. */
export function checkCoordinates(xFt: unknown, yFt: unknown): CoordinateCheck {
  const x = typeof xFt === "number" ? xFt : Number.parseFloat(String(xFt ?? ""));
  const y = typeof yFt === "number" ? yFt : Number.parseFloat(String(yFt ?? ""));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, xFt: 0, yFt: 0, error: "Enter both distances in feet." };
  }
  if (x < 0 || x > SHOP_WIDTH_FT) {
    return {
      ok: false,
      xFt: 0,
      yFt: 0,
      error: `The east distance must be between 0 and ${SHOP_WIDTH_FT} ft.`,
    };
  }
  if (y < 0 || y > SHOP_DEPTH_FT) {
    return {
      ok: false,
      xFt: 0,
      yFt: 0,
      error: `The south distance must be between 0 and ${SHOP_DEPTH_FT} ft.`,
    };
  }
  return { ok: true, xFt: round1(x), yFt: round1(y), error: null };
}

export interface DesignSubmission {
  stableId: string;
  xFt: number;
  yFt: number;
  approvalReference: string;
}

export interface FieldEvidenceSubmission {
  stableId: string;
  xFt: number;
  yFt: number;
  evidence: string;
  observedAt?: string | null;
}

export function validateDesignSubmission(
  input: DesignSubmission,
): { ok: true; value: DesignSubmission } | { ok: false; error: string } {
  const stableId = (input.stableId ?? "").trim().toUpperCase();
  if (!stableId) return { ok: false, error: "Pick a record first." };
  const approvalReference = (input.approvalReference ?? "").trim();
  if (approvalReference.length < 4) {
    return { ok: false, error: "Record who approved this design position." };
  }
  const c = checkCoordinates(input.xFt, input.yFt);
  if (!c.ok) return { ok: false, error: c.error! };
  return { ok: true, value: { stableId, xFt: c.xFt, yFt: c.yFt, approvalReference } };
}

export function validateFieldEvidence(
  input: FieldEvidenceSubmission,
): { ok: true; value: Required<FieldEvidenceSubmission> } | { ok: false; error: string } {
  const stableId = (input.stableId ?? "").trim().toUpperCase();
  if (!stableId) return { ok: false, error: "Pick a record first." };
  const evidence = (input.evidence ?? "").trim();
  if (evidence.length < 4) {
    return { ok: false, error: "Record what was observed in the field." };
  }
  const c = checkCoordinates(input.xFt, input.yFt);
  if (!c.ok) return { ok: false, error: c.error! };
  const observedAt = (input.observedAt ?? "").trim() || new Date().toISOString();
  return { ok: true, value: { stableId, xFt: c.xFt, yFt: c.yFt, evidence, observedAt } };
}

/* -------------------------------------------------- derived effective location */

const asRecord = (row: DesignToFieldRow) => ({
  stableId: row.load_id,
  poleScheme: row.pole_scheme,
  poleLocationKind: row.pole_location_kind,
  poleRefStart: row.pole_ref_start,
  poleRefEnd: row.pole_ref_end,
  fieldGridReference: row.field_grid_reference,
  fieldGridEvidence: row.location_evidence,
  fieldGridObservedAt: row.verified_at,
  designXFt: row.design_x_ft,
  designYFt: row.design_y_ft,
  designApprovalReference: row.grid_migration_provenance,
  designLocationSource: row.design_location_source,
  cornerReference: row.corner_reference,
  mountingWallFace: row.mounting_wall_face,
  coverageDirection: row.coverage_direction,
  remappedGridReference: row.grid_reference,
  originalGrid: row.legacy_grid ?? row.grid,
});

/** Derived, read-only effective location for one record. */
export function effectiveLocationOf(row: DesignToFieldRow): EffectiveLocation {
  return effectiveLocationForRecord(asRecord(row));
}

export function provenanceLine(row: DesignToFieldRow): string {
  const e = effectiveLocationOf(row).effective;
  return e ? formatLocationProvenance(e) : "No usable location on record";
}

/* --------------------------------------------------------------- step previews */

const diff = (row: DesignToFieldRow, patch: Record<string, Cell>): FieldChange[] => {
  const before = row as unknown as Record<string, Cell>;
  const out: FieldChange[] = [];
  for (const column of Object.keys(patch)) {
    const b = before[column] ?? null;
    const a = patch[column] ?? null;
    if (b === a) continue;
    out.push({ column, before: b, after: a });
  }
  return out;
};

/** Step 1 patch: approved design coordinates only. */
export function designPatch(input: DesignSubmission): Record<string, Cell> {
  return {
    design_x_ft: input.xFt,
    design_y_ft: input.yFt,
    design_grid: derivedGridLabel(input.xFt, input.yFt),
    design_location_source: "APPROVED_DESIGN_XY",
    grid_migration_provenance: `Approved design position: ${input.approvalReference}`,
  };
}

/** Step 2 patch: accepted field evidence only. No design column appears here. */
export function fieldEvidencePatch(
  input: Required<FieldEvidenceSubmission>,
): Record<string, Cell> {
  const label = derivedGridLabel(input.xFt, input.yFt);
  return {
    location_x_ft: input.xFt,
    location_y_ft: input.yFt,
    field_grid_reference: label,
    grid_reference: label,
    grid_reference_precision: "EXACT",
    location_evidence: input.evidence,
    field_verification_status: "UPDATED_FROM_FIELD_OBSERVATION",
    verified_at: input.observedAt,
  };
}

const applied = (row: DesignToFieldRow, patch: Record<string, Cell>): DesignToFieldRow =>
  ({ ...row, ...patch }) as DesignToFieldRow;

export function previewDesignStep(row: DesignToFieldRow, input: DesignSubmission): StepPreview {
  const patch = designPatch(input);
  const after = applied(row, patch);
  const warnings: string[] = [];
  const effAfter = effectiveLocationOf(after);
  if (effAfter.effective?.source !== "APPROVED_DESIGN_XY") {
    warnings.push(
      "An accepted field observation already outranks this design position, so the derived location will not move. The design is still recorded for comparison.",
    );
  }
  return {
    step: "APPROVED_DESIGN_SUBMITTED",
    stableId: row.load_id,
    xFt: input.xFt,
    yFt: input.yFt,
    derivedGrid: derivedGridLabel(input.xFt, input.yFt),
    changes: diff(row, patch),
    effectiveBefore: provenanceLine(row),
    effectiveAfter: provenanceLine(after),
    supersedes: null,
    preserved: [
      "lifecycle stays as recorded — an approved design is not installation evidence",
      "field verification status untouched — the position is not field verified",
      "description, notes, circuit group, breaker, panel and electrical values untouched",
    ],
    warnings,
    expectedUpdatedAt: row.updated_at,
  };
}

export function previewFieldStep(
  row: DesignToFieldRow,
  input: Required<FieldEvidenceSubmission>,
): StepPreview {
  const patch = fieldEvidencePatch(input);
  const after = applied(row, patch);
  const beforeEff = effectiveLocationOf(row).effective;
  const warnings: string[] = [];
  if (typeof row.design_x_ft === "number" && typeof row.design_y_ft === "number") {
    const deltaFt = round1(
      Math.hypot(input.xFt - row.design_x_ft, input.yFt - row.design_y_ft),
    );
    if (deltaFt > 0.5) {
      warnings.push(
        `As found ${deltaFt} ft from the approved design position (${row.design_x_ft} ft E / ${row.design_y_ft} ft S). The design position is kept on record for comparison.`,
      );
    }
  }
  return {
    step: "FIELD_EVIDENCE_ACCEPTED",
    stableId: row.load_id,
    xFt: input.xFt,
    yFt: input.yFt,
    derivedGrid: derivedGridLabel(input.xFt, input.yFt),
    changes: diff(row, patch),
    effectiveBefore: provenanceLine(row),
    effectiveAfter: provenanceLine(after),
    supersedes: beforeEff ? beforeEff.source : null,
    preserved: [
      "approved design coordinates, approval reference and design grid all kept",
      "legacy and original grid values kept",
      "description, notes, circuit group, breaker, panel and electrical values untouched",
    ],
    warnings,
    expectedUpdatedAt: row.updated_at,
  };
}

/* ------------------------------------------------------------------- history */

export interface HistoryEvent {
  id: string;
  stableId: string;
  step: DesignToFieldStep | null;
  at: string;
  actor: string | null;
  summary: string;
  changes: FieldChange[];
}

interface RawAuditRow {
  id?: string | null;
  entity_ref?: string | null;
  created_at?: string | null;
  actor_email?: string | null;
  summary?: string | null;
  changes?: unknown;
}

const stepOf = (summary: string): DesignToFieldStep | null =>
  summary.includes("Approved design position")
    ? "APPROVED_DESIGN_SUBMITTED"
    : summary.includes("Field evidence accepted")
      ? "FIELD_EVIDENCE_ACCEPTED"
      : null;

/** Shape stored audit rows into the newest-first history this workflow shows. */
export function historyEvents(rows: RawAuditRow[]): HistoryEvent[] {
  const out: HistoryEvent[] = [];
  for (const r of rows) {
    const summary = (r.summary ?? "").trim();
    const raw = Array.isArray(r.changes) ? (r.changes as Record<string, unknown>[]) : [];
    out.push({
      id: String(r.id ?? `${r.entity_ref}-${r.created_at}`),
      stableId: (r.entity_ref ?? "").trim().toUpperCase(),
      step: stepOf(summary),
      at: r.created_at ?? "",
      actor: r.actor_email ?? null,
      summary,
      changes: raw.map((c) => ({
        column: String(c["column"] ?? ""),
        before: (c["before"] ?? null) as Cell,
        after: (c["after"] ?? null) as Cell,
      })),
    });
  }
  out.sort((a, b) => (b.at > a.at ? 1 : b.at < a.at ? -1 : a.stableId.localeCompare(b.stableId)));
  return out;
}

/** One-line audit summary for each step. */
export function stepSummary(p: StepPreview): string {
  return p.step === "APPROVED_DESIGN_SUBMITTED"
    ? `Approved design position ${p.xFt} ft E / ${p.yFt} ft S (${p.derivedGrid}) recorded for ${p.stableId}; not field verified.`
    : `Field evidence accepted for ${p.stableId} at ${p.xFt} ft E / ${p.yFt} ft S (${p.derivedGrid}); supersedes ${p.supersedes ?? "no earlier location"} while keeping it on record.`;
}

export const DESIGN_TO_FIELD_CSV_HEADER = [
  "recorded_at",
  "stable_id",
  "step",
  "actor",
  "column",
  "before",
  "after",
];

export function historyCsv(events: HistoryEvent[]): string {
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [DESIGN_TO_FIELD_CSV_HEADER.join(",")];
  for (const e of events) {
    if (!e.changes.length) {
      lines.push([e.at, e.stableId, e.step ?? "", e.actor ?? "", "", "", ""].map(q).join(","));
      continue;
    }
    for (const c of e.changes) {
      lines.push(
        [e.at, e.stableId, e.step ?? "", e.actor ?? "", c.column, c.before, c.after]
          .map(q)
          .join(","),
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
