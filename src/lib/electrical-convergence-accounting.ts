// Phase 4.4b — convergence accounting clarification (read-only).
//
// Purpose: make the numeric-semantics accounting explicit instead of adjusting
// counts so they "look" reconciled. Three layers stay distinct and none of them
// is rewritten here:
//
//   1. Raw comparison layer   — raw_category, produced by the immutable
//                               ODS ↔ FarmOps comparison.
//   2. Adjudication layer     — an established, SHA-bound adjudication record.
//   3. Phase 4.5 disposition  — whether the finding still blocks Phase 4.5.
//
// The central rule enforced by this module: ADJUDICATED IS NOT RESOLVED. A
// finding can carry a valid adjudication record and remain unresolved for Phase
// 4.5 (for example an amperage finding whose adjudication states that the field
// semantics are unproven). Therefore Raw B = 5 with Unresolved B = 3 is a
// correct, explainable result — not an inconsistency to be flattened.
//
// No writes, no reclassification, no schema or normalization changes.
import type {
  NumericCategory,
  NumericDiagnosticsReport,
  NumericFinding,
} from "@/lib/electrical-numeric-diagnostics";
import {
  CONVERGENCE_DISPOSITION_LABELS,
  CLOSED_DISPOSITIONS,
  type ConvergenceDisposition,
} from "@/lib/electrical-convergence";

export const CONVERGENCE_ACCOUNTING_VERSION = "4.4b-convergence-accounting-1";

/** Why a finding is (or is not) a Phase 4.5 blocker, stated in plain terms. */
export type UnresolvedReasonCode =
  /** No adjudication record bound to this run's workbook SHA. */
  | "NO_ADJUDICATION"
  /** An adjudication exists but references a different workbook SHA. */
  | "STALE_ADJUDICATION_DIFFERENT_SHA"
  /** Adjudicated: the electrical concept of the source field is unproven. */
  | "FIELD_SEMANTICS_UNPROVEN"
  /** Adjudicated: provenance / field verification still owed. */
  | "VERIFICATION_OUTSTANDING"
  /** Adjudicated and closed: correction is owned by the canonical ODS workflow. */
  | "NOT_UNRESOLVED_CANONICAL_CORRECTION_QUEUED"
  /** Adjudicated and closed: both concepts are represented, nothing is owed. */
  | "NOT_UNRESOLVED_REPRESENTATION_DIFFERENCE"
  /** Adjudicated and closed for another decided reason. */
  | "NOT_UNRESOLVED_DECIDED";

export const UNRESOLVED_REASON_LABELS: Record<UnresolvedReasonCode, string> = {
  NO_ADJUDICATION:
    "No adjudication bound to this workbook SHA — the disagreement has not been examined.",
  STALE_ADJUDICATION_DIFFERENT_SHA:
    "An adjudication names this finding but references a different canonical workbook SHA, so it reduces nothing.",
  FIELD_SEMANTICS_UNPROVEN:
    "Adjudicated, and the adjudication itself states the electrical concept of the source field is not established. Adjudicated \u2260 resolved: still a Phase 4.5 blocker.",
  VERIFICATION_OUTSTANDING:
    "Adjudicated, but the decision defers to provenance or field verification that has not been performed.",
  NOT_UNRESOLVED_CANONICAL_CORRECTION_QUEUED:
    "Adjudicated and closed for Phase 4.5: the value is a canonical ODS correction owned by the controlled ODS workflow, not an open engineering disagreement.",
  NOT_UNRESOLVED_REPRESENTATION_DIFFERENCE:
    "Adjudicated and closed for Phase 4.5: both source values state different, correct concepts and both are preserved.",
  NOT_UNRESOLVED_DECIDED:
    "Adjudicated and closed for Phase 4.5: a decided outcome requiring no further evidence.",
};

export interface AccountingRow {
  stable_id: string;
  entity_type: string;
  farmops_entity: string | null;
  field: string;
  field_label: string;
  unit: string;
  ods_raw: string;
  farmops_raw: string;
  /** Layer 1 — never rewritten. */
  raw_category: NumericCategory;
  /** Layer 2 — the adjudication record, or the absence of one. */
  adjudication: string;
  adjudication_id: string | null;
  adjudicated: boolean;
  stale_adjudication: boolean;
  /** Layer 3 — the Phase 4.5 disposition. */
  disposition: ConvergenceDisposition;
  disposition_label: string;
  unresolved_for_phase_4_5: boolean;
  unresolved_reason: UnresolvedReasonCode;
  unresolved_reason_detail: string;
  preserved: string[];
}

export interface CurrentSemanticsMember extends AccountingRow {
  /** True when this row was expected from the three Bryant amperage findings. */
  expected_bryant_amperage: boolean;
  /** Why this row carries the current-semantics disposition. */
  inclusion_basis: string;
}

export interface ConvergenceAccounting {
  accounting_version: string;
  ods_file_name: string;
  ods_sha256: string;
  compared_at: string;
  /** Every raw-Category-B finding, fully accounted for. */
  category_b_rows: AccountingRow[];
  raw_b: number;
  adjudicated_b: number;
  unresolved_b: number;
  /** Raw-B rows closed by adjudication (adjudicated, not unresolved). */
  closed_b: number;
  /** Every finding carrying CURRENT_SEMANTICS_UNRESOLVED, in any raw category. */
  current_semantics_rows: CurrentSemanticsMember[];
  current_semantics_unresolved: number;
  /**
   * Rows beyond the three established Bryant amperage findings — the reason the
   * "current semantics unresolved" count exceeds three.
   */
  current_semantics_beyond_bryant_amperage: CurrentSemanticsMember[];
  /** Plain-language explanation of the count difference. */
  reconciliation_notes: string[];
  read_only: true;
}

const BRYANT_AMPERAGE = new Set(["FS-082|amps", "FS-083|amps", "FS-084|amps"]);

function unresolvedReason(f: NumericFinding): UnresolvedReasonCode {
  if (f.unresolved) {
    if (f.convergence_disposition === "CURRENT_SEMANTICS_UNRESOLVED")
      return "FIELD_SEMANTICS_UNPROVEN";
    if (
      f.convergence_disposition === "PROVENANCE_VERIFICATION_REQUIRED" ||
      f.convergence_disposition === "FIELD_VERIFICATION_REQUIRED"
    )
      return "VERIFICATION_OUTSTANDING";
    if (f.stale_adjudication) return "STALE_ADJUDICATION_DIFFERENT_SHA";
    return "NO_ADJUDICATION";
  }
  if (f.convergence_disposition === "CANONICAL_ODS_CORRECTION_REQUIRED")
    return "NOT_UNRESOLVED_CANONICAL_CORRECTION_QUEUED";
  if (f.convergence_disposition === "SEMANTIC_REPRESENTATION_DIFFERENCE")
    return "NOT_UNRESOLVED_REPRESENTATION_DIFFERENCE";
  return "NOT_UNRESOLVED_DECIDED";
}

function row(f: NumericFinding): AccountingRow {
  const reason = unresolvedReason(f);
  return {
    stable_id: f.stable_id,
    entity_type: f.domain,
    farmops_entity: f.farmops_entity,
    field: f.farmops_field,
    field_label: f.label,
    unit: f.unit,
    ods_raw: f.ods_raw || "(not stated)",
    farmops_raw: f.farmops_raw || "(not stated)",
    raw_category: f.raw_category,
    adjudication: f.adjudicated
      ? f.adjudication_classification ?? "(adjudicated, unclassified)"
      : f.stale_adjudication
        ? "stale — different workbook SHA"
        : "none",
    adjudication_id: f.adjudication_id,
    adjudicated: f.adjudicated,
    stale_adjudication: f.stale_adjudication,
    disposition: f.convergence_disposition,
    disposition_label: CONVERGENCE_DISPOSITION_LABELS[f.convergence_disposition],
    unresolved_for_phase_4_5: f.unresolved,
    unresolved_reason: reason,
    unresolved_reason_detail: UNRESOLVED_REASON_LABELS[reason],
    preserved: f.preserved,
  };
}

export function convergenceAccounting(r: NumericDiagnosticsReport): ConvergenceAccounting {
  const bRows = r.findings
    .filter((f) => f.raw_category === "B")
    .map(row)
    .sort((a, b) => a.stable_id.localeCompare(b.stable_id) || a.field.localeCompare(b.field));

  const semanticRows: CurrentSemanticsMember[] = r.findings
    .filter((f) => f.convergence_disposition === "CURRENT_SEMANTICS_UNRESOLVED")
    .map((f) => {
      const base = row(f);
      const expected = BRYANT_AMPERAGE.has(`${f.stable_id}|${f.farmops_field}`);
      return {
        ...base,
        expected_bryant_amperage: expected,
        inclusion_basis: expected
          ? "One of the three established Bryant amperage findings."
          : `Additional field carried by the same adjudication record${
              base.adjudication_id ? ` (${base.adjudication_id})` : ""
            }: the unresolved Amps concept propagates to this dependent quantity, so it is counted separately.`,
      };
    })
    .sort((a, b) => a.stable_id.localeCompare(b.stable_id) || a.field.localeCompare(b.field));

  const extra = semanticRows.filter((s) => !s.expected_bryant_amperage);
  const adjudicatedB = bRows.filter((b) => b.adjudicated).length;
  const unresolvedB = bRows.filter((b) => b.unresolved_for_phase_4_5).length;

  const notes: string[] = [
    `Raw B = ${bRows.length}: the immutable comparison layer is unchanged.`,
    `Adjudicated B = ${adjudicatedB}; unresolved-for-Phase-4.5 B = ${unresolvedB}. These are different measures: an adjudication record documents that a finding was examined, not that it is resolved.`,
    `Closed B = ${bRows.length - unresolvedB} — dispositions in {${[...CLOSED_DISPOSITIONS].join(", ")}} or a canonical-ODS correction queued outside FarmOps.`,
    `Current semantics unresolved = ${semanticRows.length}. Three of these are the established Bryant amperage findings; ${extra.length} further ${
      extra.length === 1 ? "row is" : "rows are"
    } carried by the same adjudication record${extra.length ? ` (${extra.map((e) => `${e.stable_id}.${e.field}`).join(", ")})` : ""} because the unresolved Amps concept propagates to the dependent quantity.`,
  ];

  return {
    accounting_version: CONVERGENCE_ACCOUNTING_VERSION,
    ods_file_name: r.generated_from_ods,
    ods_sha256: r.ods_sha256,
    compared_at: r.compared_at,
    category_b_rows: bRows,
    raw_b: bRows.length,
    adjudicated_b: adjudicatedB,
    unresolved_b: unresolvedB,
    closed_b: bRows.length - unresolvedB,
    current_semantics_rows: semanticRows,
    current_semantics_unresolved: semanticRows.length,
    current_semantics_beyond_bryant_amperage: extra,
    reconciliation_notes: notes,
    read_only: true,
  };
}

/* ------------------------------------------------------------------ exports */

function csv(rows: string[][]): string {
  return rows
    .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\n");
}

export function convergenceAccountingCsv(a: ConvergenceAccounting): string {
  const head = [
    "layer_set",
    "ods_sha256",
    "stable_id",
    "field",
    "raw_category",
    "adjudication",
    "adjudication_id",
    "disposition",
    "unresolved_for_phase_4_5",
    "unresolved_reason",
    "ods_value",
    "farmops_value",
    "preserved",
  ];
  const line = (set: string, r: AccountingRow) => [
    set,
    a.ods_sha256,
    r.stable_id,
    r.field,
    r.raw_category,
    r.adjudication,
    r.adjudication_id ?? "",
    r.disposition,
    String(r.unresolved_for_phase_4_5),
    r.unresolved_reason,
    r.ods_raw,
    r.farmops_raw,
    r.preserved.join(" | "),
  ];
  return csv([
    head,
    ...a.category_b_rows.map((r) => line("raw_category_B", r)),
    ...a.current_semantics_rows.map((r) => line("current_semantics_unresolved", r)),
  ]);
}

export function convergenceAccountingMarkdown(a: ConvergenceAccounting): string {
  return [
    "# Phase 4.4b — convergence accounting clarification (read-only)",
    "",
    `- Canonical workbook: \`${a.ods_file_name}\``,
    `- Workbook SHA-256: \`${a.ods_sha256}\``,
    `- Compared at: ${a.compared_at}`,
    `- Accounting version: \`${a.accounting_version}\``,
    "- Writes performed: **none** — raw comparison, adjudication and Phase 4.5 disposition stay three distinct layers",
    "",
    "## Rule",
    "",
    "Adjudicated is not resolved. Raw B may exceed Unresolved B without any count being adjusted.",
    "",
    "## Raw Category B accounting",
    "",
    `Raw B = ${a.raw_b} · adjudicated = ${a.adjudicated_b} · unresolved for Phase 4.5 = ${a.unresolved_b} · closed = ${a.closed_b}`,
    "",
    "| stable_id | field | raw_category | adjudication | disposition | unresolved_for_phase_4_5 | unresolved_reason |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...a.category_b_rows.map(
      (r) =>
        `| ${r.stable_id} | ${r.field} | ${r.raw_category} | ${r.adjudication} | ${r.disposition} | ${r.unresolved_for_phase_4_5 ? "yes" : "no"} | ${r.unresolved_reason} |`,
    ),
    "",
    "## Current semantics unresolved — full membership",
    "",
    `Total = ${a.current_semantics_unresolved} (established Bryant amperage findings = ${
      a.current_semantics_unresolved - a.current_semantics_beyond_bryant_amperage.length
    }, additional propagated rows = ${a.current_semantics_beyond_bryant_amperage.length})`,
    "",
    "| stable_id | field | raw_category | adjudication | inclusion basis |",
    "| --- | --- | --- | --- | --- |",
    ...a.current_semantics_rows.map(
      (r) =>
        `| ${r.stable_id} | ${r.field} | ${r.raw_category} | ${r.adjudication} | ${r.inclusion_basis} |`,
    ),
    "",
    "## Notes",
    "",
    ...a.reconciliation_notes.map((n) => `- ${n}`),
  ].join("\n");
}
