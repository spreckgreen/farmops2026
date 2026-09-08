/**
 * Measured field X/Y audit entry.
 *
 * Turns hand-entered instrument measurements into a normal FarmOps field-audit
 * manifest, so measured coordinates travel the same guarded path as every other
 * audit observation: staged, previewed as an exact before/after difference,
 * approved per record, then applied as one batch.
 *
 * Only the record kinds whose canonical rows carry both a coordinate pair and
 * the measured-X/Y provenance columns may receive one. Every entry is a
 * FIELD_AS_BUILT observation — a measured coordinate is by definition something
 * observed on site, never a design value, and it is the only source FarmOps
 * presents as a measured coordinate.
 */
import {
  AUDIT_ENTITY_TARGETS,
  AUDIT_BATCH_SCHEMA_VERSION,
  fieldsAllowed,
  type AuditBatchManifest,
  type AuditBatchItemInput,
  type AuditEntityKind,
} from "@/lib/electrical-audit-batch";
import { MEASURED_XY_METHODS, type MeasuredXyMethod } from "@/lib/electrical-measured-xy";

/** Record kinds that can carry a measured field X/Y coordinate. */
export const MEASURED_XY_ENTITY_KINDS: AuditEntityKind[] = (
  Object.keys(AUDIT_ENTITY_TARGETS) as AuditEntityKind[]
).filter((kind) => {
  const allowed = new Set(fieldsAllowed(kind, "FIELD_AS_BUILT"));
  return allowed.has("measured_xy_method") && allowed.has("location_x_ft");
});

export function measuredXyKindTitle(kind: AuditEntityKind): string {
  return AUDIT_ENTITY_TARGETS[kind].title;
}

/** One entry line as typed on the screen: everything is still free text. */
export interface MeasuredXyEntryRow {
  id: string;
  entityKind: AuditEntityKind;
  stableId: string;
  x: string;
  y: string;
  method: MeasuredXyMethod;
  accuracyFt: string;
  datum: string;
  measuredAt: string;
  measuredBy: string;
  evidence: string;
  notes: string;
}

export function emptyMeasuredXyRow(id: string, defaults?: Partial<MeasuredXyEntryRow>): MeasuredXyEntryRow {
  return {
    id,
    entityKind: "load",
    stableId: "",
    x: "",
    y: "",
    method: "TAPE",
    accuracyFt: "",
    datum: "",
    measuredAt: "",
    measuredBy: "",
    evidence: "",
    notes: "",
    ...defaults,
  };
}

export interface MeasuredXyEntryHeader {
  batchId: string;
  title: string;
  observedDate: string;
  building: string;
  scope: string;
  source: string;
}

/** Deterministic batch ID suggestion: MXY-<site>-<date>-R<revision>. */
export function suggestMeasuredXyBatchId(
  siteToken: string,
  date: Date | string = new Date(),
  revision = 1,
): string {
  const day = typeof date === "string" ? date : date.toISOString().slice(0, 10);
  const site = (siteToken || "SITE").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `MXY-${site}-${day}-R${Math.max(1, Math.trunc(revision))}`;
}

function num(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export interface RowValidation {
  id: string;
  errors: string[];
}

/** Per-row checks. Server-side classification still has the final word. */
export function validateMeasuredXyRow(row: MeasuredXyEntryRow): string[] {
  const errors: string[] = [];
  if (!row.stableId.trim()) errors.push("Stable ID is required — a measured point must name the record it belongs to.");
  if (!MEASURED_XY_ENTITY_KINDS.includes(row.entityKind)) {
    errors.push(`${row.entityKind} records cannot carry a measured field X/Y coordinate.`);
  }
  if (num(row.x) === null) errors.push("X (ft east) must be a number.");
  if (num(row.y) === null) errors.push("Y (ft south) must be a number.");
  if (!(MEASURED_XY_METHODS as readonly string[]).includes(row.method)) {
    errors.push("Pick the instrument used for the measurement.");
  }
  if (row.accuracyFt.trim()) {
    const a = num(row.accuracyFt);
    if (a === null || a <= 0) errors.push("Accuracy must be a positive number of feet, or left blank.");
  }
  if (row.measuredAt.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(row.measuredAt.trim())) {
    errors.push("Measured on must be a date like 2026-09-08, or left blank.");
  }
  if (!row.evidence.trim()) errors.push("Evidence is required — state who measured what, and how.");
  return errors;
}

export function validateMeasuredXyHeader(header: MeasuredXyEntryHeader): string[] {
  const errors: string[] = [];
  if (header.batchId.trim().length < 3) errors.push("Batch ID is required.");
  if (!header.title.trim()) errors.push("Batch title is required.");
  if (header.observedDate.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(header.observedDate.trim())) {
    errors.push("Observed date must be a date like 2026-09-08.");
  }
  return errors;
}

/** Stable, collision-free item keys: MXY-<n>-<kind>-<stable id>. */
export function measuredXyItemKey(row: MeasuredXyEntryRow, index: number): string {
  const id = row.stableId.trim().toUpperCase().replace(/[^A-Z0-9-]+/g, "-") || "UNSET";
  return `MXY-${String(index + 1).padStart(3, "0")}-${row.entityKind}-${id}`.slice(0, 160);
}

export interface MeasuredXyBuild {
  ok: boolean;
  manifest: AuditBatchManifest | null;
  headerErrors: string[];
  rowErrors: RowValidation[];
}

/**
 * Build the audit manifest. Duplicate stable IDs within one batch are rejected:
 * two measurements of the same record in one batch is an unresolved conflict,
 * not something the apply step should silently order.
 */
export function buildMeasuredXyManifest(
  header: MeasuredXyEntryHeader,
  rows: MeasuredXyEntryRow[],
): MeasuredXyBuild {
  const headerErrors = validateMeasuredXyHeader(header);
  const rowErrors: RowValidation[] = rows.map((r) => ({ id: r.id, errors: validateMeasuredXyRow(r) }));

  const seen = new Map<string, number>();
  rows.forEach((r, i) => {
    const key = `${r.entityKind}:${r.stableId.trim().toUpperCase()}`;
    if (!r.stableId.trim()) return;
    const first = seen.get(key);
    if (first !== undefined) {
      rowErrors[i]!.errors.push(
        `${r.stableId.trim()} is measured twice in this batch (also on line ${first + 1}); keep one measurement per record.`,
      );
    } else seen.set(key, i);
  });

  if (!rows.length) headerErrors.push("Add at least one measured coordinate.");
  const bad = rowErrors.some((r) => r.errors.length);
  if (headerErrors.length || bad) {
    return { ok: false, manifest: null, headerErrors, rowErrors };
  }

  const items: AuditBatchItemInput[] = rows.map((row, i) => ({
    item_key: measuredXyItemKey(row, i),
    entity_kind: row.entityKind,
    target_stable_id: row.stableId.trim(),
    observation_class: "FIELD_AS_BUILT",
    operation: null,
    fields: {},
    install_state: null,
    pole: null,
    measured_xy: {
      x_ft: num(row.x)!,
      y_ft: num(row.y)!,
      method: row.method,
      accuracy_ft: row.accuracyFt.trim() ? num(row.accuracyFt) : null,
      datum: row.datum.trim() || null,
      measured_at: row.measuredAt.trim() || header.observedDate.trim() || null,
      measured_by: row.measuredBy.trim() || null,
    },
    field_grid_reference: null,
    refs: {},
    observed_label: null,
    evidence: row.evidence.trim(),
    notes: row.notes.trim() || null,
    reason: null,
    ods_field: null,
    ods_candidate_value: null,
  }));

  const manifest: AuditBatchManifest = {
    schema_version: AUDIT_BATCH_SCHEMA_VERSION,
    batch_id: header.batchId.trim(),
    title: header.title.trim(),
    scope: header.scope.trim() || "Measured field X/Y coordinates",
    building: header.building.trim() || null,
    observed_date: header.observedDate.trim() || null,
    observed_time_precision: null,
    timezone: null,
    source: header.source.trim() || "FarmOps measured X/Y entry screen",
    evidence: [],
    compensates_batch_id: null,
    items,
  };

  return { ok: true, manifest, headerErrors: [], rowErrors };
}

export function measuredXyManifestText(manifest: AuditBatchManifest): string {
  return JSON.stringify(manifest, null, 2);
}
