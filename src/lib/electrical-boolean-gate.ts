// Phase 4.4b — Boolean Category-A production correction gate.
//
// Pure module: it defines the gate's row/summary shapes, the arithmetic that must
// reconcile against the Category-A finding count, and the CSV/Markdown exports.
// Nothing here writes; nothing here decides eligibility beyond the two proven
// artifact rules (A1/A2) already established by the diagnostics.
import {
  ARTIFACT_LABELS,
  DEFAULTED_COLUMNS,
  type BooleanArtifactType,
  type BooleanCorrectionPlan,
  type BooleanDiagnosticsReport,
} from "@/lib/electrical-boolean-diagnostics";

export type GateStatus =
  | "would_change"
  | "already_correct"
  | "drifted"
  | "not_found"
  | "failed"
  | "not_approved"
  | "applied";

/** One row per Category-A finding, revalidated against live FarmOps state. */
export interface GateRow {
  table: string;
  stable_id: string;
  row_uuid: string | null;
  column: string;
  /** Canonical ODS cell text ("" means blank / not stated). */
  ods_value: string;
  /** FarmOps value the reconciliation finding was based on. */
  reconciliation_value: boolean | null;
  /** Value read back from production during this run. */
  live_value: boolean | null;
  artifact_type: BooleanArtifactType;
  proposed_value: boolean | null;
  status: GateStatus;
  evidence: string;
  detail?: string;
}

export interface GateSummary {
  category_a_findings: number;
  a1_artifacts: number;
  a2_artifacts: number;
  would_change: number;
  already_correct: number;
  drifted: number;
  not_found: number;
  failed: number;
  not_approved: number;
  applied: number;
  category_d: number;
  /** would_change + already_correct + drifted + not_found + failed (+ apply buckets). */
  accounted: number;
  reconciles: boolean;
}

/** Human display for a tri-state boolean. NULL is never rendered as false. */
export function displayBool(v: boolean | null | undefined): string {
  if (v === true) return "Yes / true";
  if (v === false) return "No / false";
  return "Not stated / NULL";
}

export function displayOds(raw: string): string {
  return raw.trim() === "" ? "Not stated / NULL" : raw;
}

export function gateKey(r: { table: string; stable_id: string; column: string }): string {
  return `${r.table}|${r.stable_id}|${r.column}`;
}

/**
 * Verify a proposed correction still matches one of the two proven artifact rules
 * given the value that is live in production right now.
 */
export function artifactStillJustified(input: {
  artifact_type: BooleanArtifactType;
  column: string;
  table: string;
  live_value: boolean | null;
  proposed_value: boolean | null;
}): { ok: true } | { ok: false; reason: string } {
  if (input.artifact_type === "A1_N_COERCED_TRUE") {
    if (input.live_value !== true || input.proposed_value !== false) {
      return { ok: false, reason: "A1 requires live true and a proposed false." };
    }
    return { ok: true };
  }
  if (input.live_value !== false || input.proposed_value !== null) {
    return { ok: false, reason: "A2 requires live false and a proposed NULL." };
  }
  if (!DEFAULTED_COLUMNS.has(`${input.table}.${input.column}`)) {
    return {
      ok: false,
      reason: `A2 is limited to documented NOT NULL DEFAULT false columns; ${input.table}.${input.column} is not one.`,
    };
  }
  return { ok: true };
}

export function summarizeGate(input: {
  diag: BooleanDiagnosticsReport;
  plan: BooleanCorrectionPlan;
  rows: GateRow[];
}): GateSummary {
  const count = (s: GateStatus) => input.rows.filter((r) => r.status === s).length;
  const would_change = count("would_change");
  const already_correct = count("already_correct");
  const drifted = count("drifted");
  const not_found = count("not_found");
  const failed = count("failed");
  const not_approved = count("not_approved");
  const applied = count("applied");
  const accounted =
    would_change + already_correct + drifted + not_found + failed + not_approved + applied;
  return {
    category_a_findings: input.diag.counts_by_category.A,
    a1_artifacts: input.plan.artifact_counts.A1_N_COERCED_TRUE,
    a2_artifacts: input.plan.artifact_counts.A2_BLANK_DEFAULTED_FALSE,
    would_change,
    already_correct,
    drifted,
    not_found,
    failed,
    not_approved,
    applied,
    category_d: input.diag.counts_by_category.D,
    accounted,
    reconciles: accounted === input.diag.counts_by_category.A,
  };
}

function csv(rows: string[][]): string {
  return rows
    .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\n");
}

export const GATE_PLAN_FILENAME = "phase-4.4b-category-a-plan.csv";
export const GATE_REPORT_FILENAME = "phase-4.4b-category-a-gate.md";

export function gatePlanCsv(rows: GateRow[]): string {
  const head = [
    "entity",
    "stable_id",
    "row_uuid",
    "field",
    "canonical_ods",
    "reconciliation_farmops",
    "live_farmops",
    "artifact_type",
    "proposed_value",
    "status",
    "provenance_reason",
  ];
  return csv([
    head,
    ...rows.map((r) => [
      r.table,
      r.stable_id,
      r.row_uuid ?? "",
      r.column,
      displayOds(r.ods_value),
      displayBool(r.reconciliation_value),
      displayBool(r.live_value),
      r.artifact_type,
      displayBool(r.proposed_value),
      r.status,
      r.detail ? `${r.evidence} — ${r.detail}` : r.evidence,
    ]),
  ]);
}

/** Archivable Markdown: summary, artifact definitions, full plan, Category-D exclusion. */
export function gateMarkdown(input: {
  generatedAt: string;
  summary: GateSummary;
  rows: GateRow[];
  applied: boolean;
}): string {
  const s = input.summary;
  const lines: string[] = [];
  lines.push("# Phase 4.4b — Boolean Category-A correction gate");
  lines.push("");
  lines.push(`Generated: ${input.generatedAt}`);
  lines.push(
    input.applied
      ? "Mode: **Apply** — approved Category-A rows were written."
      : "Mode: **Preview only — no production values changed.**",
  );
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("| --- | --- |");
  lines.push(`| Category A findings | ${s.category_a_findings} |`);
  lines.push(`| A1 N→true artifacts | ${s.a1_artifacts} |`);
  lines.push(`| A2 blank→false artifacts | ${s.a2_artifacts} |`);
  lines.push(`| would change | ${s.would_change} |`);
  lines.push(`| already correct | ${s.already_correct} |`);
  lines.push(`| drifted | ${s.drifted} |`);
  lines.push(`| not found | ${s.not_found} |`);
  lines.push(`| failed | ${s.failed} |`);
  if (s.not_approved) lines.push(`| not approved | ${s.not_approved} |`);
  if (s.applied) lines.push(`| applied | ${s.applied} |`);
  lines.push(`| Category D (not eligible for automatic correction) | ${s.category_d} |`);
  lines.push("");
  lines.push(
    `Arithmetic: ${s.accounted} accounted vs ${s.category_a_findings} Category-A findings — ` +
      (s.reconciles ? "reconciles." : "**does not reconcile — investigate before Apply.**"),
  );
  lines.push("");
  lines.push("## Artifact definitions");
  lines.push("");
  for (const [k, v] of Object.entries(ARTIFACT_LABELS)) lines.push(`- \`${k}\` — ${v}`);
  lines.push("");
  lines.push(
    "A2 is never generalised beyond the documented NOT NULL DEFAULT false columns. " +
      "Amperage, labels and every non-Boolean field are out of scope.",
  );
  lines.push("");
  lines.push("## Correction plan");
  lines.push("");
  lines.push(
    "| entity | stable_id | row_uuid | field | canonical ODS | reconciliation FarmOps | live FarmOps | artifact | proposed | status | provenance |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of input.rows) {
    lines.push(
      `| ${r.table} | ${r.stable_id} | ${r.row_uuid ?? "—"} | ${r.column} | ${displayOds(r.ods_value)} | ${displayBool(r.reconciliation_value)} | ${displayBool(r.live_value)} | ${r.artifact_type} | ${displayBool(r.proposed_value)} | ${r.status} | ${(r.detail ? `${r.evidence} — ${r.detail}` : r.evidence).replace(/\|/g, "/")} |`,
    );
  }
  lines.push("");
  lines.push("## Category-D exclusion");
  lines.push("");
  lines.push(
    `${s.category_d} Category-D finding(s) have insufficient provenance and are **not eligible for automatic correction**. ` +
      "They are untouched by this gate, as are Categories B and C, non-Boolean fields, IDs, relationships, " +
      "`ods_extras`, service topology, breaker positions, House field observations and the canonical ODS.",
  );
  lines.push("");
  lines.push("## Post-Apply gate");
  lines.push("");
  lines.push(
    "After an explicitly approved Apply, re-run reconciliation against the unchanged canonical ODS and confirm: " +
      "the corrected Category-A artifacts are gone, no new Boolean disagreements appeared, Category D is unchanged, " +
      "and unrelated reconciliation domains are unchanged. Phase 4.4b Boolean reconciliation is not complete until that review.",
  );
  lines.push("");
  return lines.join("\n");
}
