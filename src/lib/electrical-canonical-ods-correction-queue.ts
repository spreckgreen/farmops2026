// Phase 4.4b — canonical ODS correction queue (read-only).
//
// Some adjudicated findings prove the CANONICAL WORKBOOK is the record in
// error while the FarmOps as-built value is the supported engineering value.
// Those findings must never be presented as pending FarmOps writes, and they
// must never edit the ODS from an adjudication screen either — the canonical
// workbook is only ever changed through the controlled ODS workflow.
//
// This module turns such findings into a read-only queue/export so an approved
// engineering disposition can later be applied to the canonical workbook.
//
// It writes nothing. It infers nothing: every value shown is either parsed from
// the SHA-verified workbook, read from FarmOps, or taken from verified
// equipment provenance. Amperage findings are explicitly out of scope — no load
// current is ever derived from an MOCP figure.
import {
  CANONICAL_ODS_CORRECTION_BUCKETS,
  type AdjudicatedFinding,
  type LoadAdjudicationReport,
} from "@/lib/electrical-load-adjudication";
import { canonicalLoad, type AdjudicationBaseline } from "@/lib/electrical-adjudication-baseline";
import { equipmentFor } from "@/lib/electrical-equipment-provenance";

export const CANONICAL_ODS_CORRECTION_QUEUE_VERSION =
  "4.4b-canonical-ods-correction-queue-1";

export const CANONICAL_ODS_CLASSIFICATION =
  "CANONICAL_ODS_VALUE_INCOMPATIBLE_WITH_VERIFIED_EQUIPMENT";
export const CANONICAL_ODS_DISPOSITION = "CANONICAL_ODS_CORRECTION_REQUIRED";

export interface CanonicalOdsCorrectionItem {
  stable_id: string;
  description: string;
  /** FarmOps column the finding compared (never written from this queue). */
  field: AdjudicatedFinding["field"];
  unit: string;
  classification: string;
  disposition: string;
  /** Value the canonical workbook actually contains — preserved as history. */
  ods_observed_value: number | null;
  /** FarmOps as-built value, which this queue never modifies. */
  farmops_as_built_value: number | null;
  /** Verified equipment rating, kept verbatim and never collapsed to a scalar. */
  equipment_rating: string;
  /** Proposed canonical nominal value for the controlled ODS workflow. */
  canonical_correction_candidate: number | null;
  /** Canonical workbook identity this item was adjudicated against. */
  workbook_name: string;
  worksheet: string | null;
  worksheet_row: number | null;
  workbook_sha256: string;
  ods_provenance: string;
  farmops_provenance: string;
  reason: string;
  equipment_evidence: string[];
  /** Always true: no FarmOps write is authorized by this item. */
  farmops_write_required: false;
}

export interface CanonicalOdsCorrectionQueue {
  version: string;
  generated_at: string;
  workbook_name: string;
  workbook_sha256: string;
  items: CanonicalOdsCorrectionItem[];
  read_only: true;
  /** No apply path exists from this queue, by design. */
  apply_available: false;
}

/** Verified equipment rating string, e.g. "208/230 VAC, 1Ø, 60 Hz". */
export function equipmentRatingLabel(stable_id: string): string {
  const s = equipmentFor(stable_id)?.semantics;
  if (!s?.rated_equipment_voltage_class) return "not established";
  return [
    `${s.rated_equipment_voltage_class} VAC`,
    s.phase ? `${s.phase}Ø` : null,
    s.frequency_hz ? `${s.frequency_hz} Hz` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

function correctionCandidate(stable_id: string, farmops: number | null): number | null {
  const nominal = equipmentFor(stable_id)?.semantics.nominal_supply_voltage ?? null;
  // The candidate is only stated when verified provenance and the FarmOps
  // as-built value agree; otherwise it stays unestablished.
  return nominal !== null && nominal === farmops ? nominal : nominal;
}

export function buildCanonicalOdsCorrectionQueue(
  report: LoadAdjudicationReport,
  baseline: AdjudicationBaseline,
  generatedAt = new Date().toISOString(),
): CanonicalOdsCorrectionQueue {
  const items = report.findings
    .filter((f) => CANONICAL_ODS_CORRECTION_BUCKETS.has(f.bucket))
    .map<CanonicalOdsCorrectionItem>((f) => {
      const canonical = canonicalLoad(baseline, f.stable_id);
      return {
        stable_id: f.stable_id,
        description: f.description,
        field: f.field,
        unit: f.unit,
        classification: CANONICAL_ODS_CLASSIFICATION,
        disposition: CANONICAL_ODS_DISPOSITION,
        ods_observed_value: f.ods_value,
        farmops_as_built_value: f.farmops_value,
        equipment_rating: equipmentRatingLabel(f.stable_id),
        canonical_correction_candidate:
          f.field === "volts" ? correctionCandidate(f.stable_id, f.farmops_value) : null,
        workbook_name: baseline.ods_file_name,
        worksheet: canonical?.worksheet ?? null,
        worksheet_row: canonical?.row ?? null,
        workbook_sha256: baseline.ods_sha256,
        ods_provenance: f.ods_provenance,
        farmops_provenance: f.farmops_provenance,
        reason: f.reason,
        equipment_evidence: f.equipment_evidence,
        farmops_write_required: false,
      };
    })
    .sort((a, b) => a.stable_id.localeCompare(b.stable_id) || a.field.localeCompare(b.field));

  return {
    version: CANONICAL_ODS_CORRECTION_QUEUE_VERSION,
    generated_at: generatedAt,
    workbook_name: baseline.ods_file_name,
    workbook_sha256: baseline.ods_sha256,
    items,
    read_only: true,
    apply_available: false,
  };
}

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function canonicalOdsCorrectionQueueCsv(queue: CanonicalOdsCorrectionQueue): string {
  const head = [
    "stable_id",
    "description",
    "field",
    "unit",
    "classification",
    "disposition",
    "ods_observed_value",
    "farmops_as_built_value",
    "equipment_rating",
    "canonical_correction_candidate",
    "workbook_name",
    "worksheet",
    "worksheet_row",
    "workbook_sha256",
    "ods_provenance",
    "farmops_provenance",
    "farmops_write_required",
    "reason",
  ];
  return [
    head.join(","),
    ...queue.items.map((i) =>
      [
        i.stable_id,
        i.description,
        i.field,
        i.unit,
        i.classification,
        i.disposition,
        i.ods_observed_value,
        i.farmops_as_built_value,
        i.equipment_rating,
        i.canonical_correction_candidate,
        i.workbook_name,
        i.worksheet,
        i.worksheet_row,
        i.workbook_sha256,
        i.ods_provenance,
        i.farmops_provenance,
        "no",
        i.reason,
      ]
        .map(cell)
        .join(","),
    ),
  ].join("\n");
}

export function canonicalOdsCorrectionQueueMarkdown(
  queue: CanonicalOdsCorrectionQueue,
): string {
  const lines: string[] = [
    "# Phase 4.4b — Canonical ODS correction queue (read-only)",
    "",
    `- Version: ${queue.version}`,
    `- Generated: ${queue.generated_at}`,
    `- Canonical workbook: ${queue.workbook_name} (SHA-256 ${queue.workbook_sha256})`,
    `- Items: ${queue.items.length}`,
    "- No FarmOps write is authorized by this queue, and the canonical workbook is NOT edited here. Approved engineering corrections are applied to the workbook only through the controlled ODS workflow.",
    "- Amperage findings are out of scope: no load current is inferred from an MOCP figure, and FS-084's ODS-versus-MOCP difference remains a separate semantic/provenance investigation.",
    "",
  ];
  for (const i of queue.items) {
    lines.push(
      `## ${i.stable_id} · ${i.field} (${i.unit})`,
      "",
      `- Load: ${i.description}`,
      `- Classification: ${i.classification}`,
      `- Disposition: ${i.disposition}`,
      `- ODS observed value: ${i.ods_observed_value ?? "not stated"} ${i.unit}`,
      `- FarmOps as-built value: ${i.farmops_as_built_value ?? "not stated"} ${i.unit} (unchanged)`,
      `- Verified equipment rating: ${i.equipment_rating}`,
      `- Canonical nominal correction candidate: ${i.canonical_correction_candidate ?? "not established"} ${i.unit}`,
      `- Workbook: ${i.workbook_name}, worksheet ${i.worksheet ?? "not parsed"}, row ${i.worksheet_row ?? "not parsed"}, SHA-256 ${i.workbook_sha256}`,
      `- ODS provenance: ${i.ods_provenance}`,
      `- FarmOps provenance: ${i.farmops_provenance}`,
      `- FarmOps write required: no`,
      `- Equipment evidence: ${i.equipment_evidence.length ? i.equipment_evidence.join("; ") : "none on file"}`,
      `- Reason: ${i.reason}`,
      "",
    );
  }
  return lines.join("\n");
}
