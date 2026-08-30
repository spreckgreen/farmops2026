// Phase 4.4a — reconciliation artifacts.
//
// Pure functions that turn one Phase 4.4 validation report into the four
// Phase 4.4a deliverables. Nothing here writes to the database and nothing
// here writes the canonical workbook: reconciliation records a disposition,
// it never synchronizes one system into the other.
import {
  CLASSIFICATIONS,
  CLASSIFICATION_LABELS,
  DISPOSITIONS,
  FARMOPS_ONLY_CATEGORIES,
  csvCell,
  recordsToCsv,
  type Classification,
  type ComparisonRecord,
  type FarmOpsOnlyCategory,
  type ValidationReport,
} from "@/lib/electrical-parallel-validation";

export const RECONCILIATION_PHASE = "4.4a";

/**
 * The Phase 4.4 run recorded before Phase 4.4a began, kept verbatim so every
 * artifact can show before/after counts. These are reported numbers, not
 * numbers this codebase recomputed.
 */
export interface ReconciliationBaseline {
  label: string;
  ods_sha256: string;
  counts: Record<Classification, number>;
}

export const PRE_4_4A_BASELINE: ReconciliationBaseline = {
  label: "Phase 4.4 run reported before 4.4a hardening",
  ods_sha256: "89da43c7...77388",
  counts: {
    MATCH: 1558,
    EXPECTED_TRANSFORMATION: 488,
    FARMOPS_AS_BUILT_ADDITION: 279,
    ODS_ONLY: 3,
    FARMOPS_ONLY: 589,
    CONFLICT: 203,
    LOSS: 67,
    INCOMPLETE: 111,
    UNKNOWN: 0,
  },
};

export interface ReconciliationJson {
  phase: string;
  generated_at: string;
  sor_authority: "canonical_ods";
  farmops_role: "candidate_sor";
  ods: ValidationReport["ods"];
  farmops: ValidationReport["farmops"];
  baseline: ReconciliationBaseline;
  final_counts: Record<Classification, number>;
  delta: Record<Classification, number>;
  by_root_cause: Record<string, number>;
  by_disposition: Record<string, number>;
  farmops_only_by_category: Record<FarmOpsOnlyCategory, number>;
  gate: ValidationReport["gate"];
  conflicts: ComparisonRecord[];
  unresolved: ComparisonRecord[];
  losses: ComparisonRecord[];
  ods_only: ComparisonRecord[];
}

export const isConflict = (r: ComparisonRecord) => r.classification === "CONFLICT";

/** Anything a human still has to decide, including TBD engineering states. */
export const isUnresolved = (r: ComparisonRecord) =>
  r.disposition !== "ACCEPTED" && r.classification !== "CONFLICT";

export function buildReconciliation(
  report: ValidationReport,
  baseline: ReconciliationBaseline = PRE_4_4A_BASELINE,
): ReconciliationJson {
  const delta = {} as Record<Classification, number>;
  for (const c of CLASSIFICATIONS) delta[c] = report.summary[c] - (baseline.counts[c] ?? 0);
  return {
    phase: RECONCILIATION_PHASE,
    generated_at: report.compared_at,
    sor_authority: "canonical_ods",
    farmops_role: "candidate_sor",
    ods: report.ods,
    farmops: report.farmops,
    baseline,
    final_counts: report.summary,
    delta,
    by_root_cause: report.by_root_cause,
    by_disposition: report.by_disposition,
    farmops_only_by_category: report.farmops_only_by_category,
    gate: report.gate,
    conflicts: report.records.filter(isConflict),
    unresolved: report.records.filter(isUnresolved),
    losses: report.records.filter((r) => r.classification === "LOSS"),
    ods_only: report.records.filter((r) => r.classification === "ODS_ONLY"),
  };
}

export function reconciliationJson(report: ValidationReport, baseline?: ReconciliationBaseline) {
  return JSON.stringify(buildReconciliation(report, baseline), null, 2);
}

/** Machine-readable conflict dispositions (Phase 4.4a §4). */
export function conflictsCsv(report: ValidationReport): string {
  const header = [
    "domain",
    "stable_id",
    "field",
    "ods_value",
    "farmops_value",
    "authority_class",
    "disposition",
    "root_cause",
    "reason",
  ].join(",");
  const lines = report.records.filter(isConflict).map((r) =>
    [
      r.domain,
      r.stable_id,
      r.field,
      r.ods_value,
      r.farmops_value,
      r.authority_class,
      r.disposition,
      r.root_cause,
      r.note,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header, ...lines].join("\n");
}

/** Everything still open that is not a conflict (Phase 4.4a §7). */
export function unresolvedCsv(report: ValidationReport): string {
  return recordsToCsv(report.records.filter(isUnresolved));
}

export function reconciliationMarkdown(
  report: ValidationReport,
  baseline: ReconciliationBaseline = PRE_4_4A_BASELINE,
): string {
  const data = buildReconciliation(report, baseline);
  const sign = (n: number) => (n > 0 ? `+${n}` : String(n));
  const out: string[] = [
    "# Phase 4.4a — Electrical SOR Reconciliation",
    "",
    "Reconciliation only. The canonical workbook is authoritative for engineering",
    "design, FarmOps is authoritative for approved field/as-built observations, and",
    "neither system is written by this report. FarmOps is **not** the System of Record.",
    "",
    `- Phase: ${data.phase}`,
    `- Canonical ODS: ${report.ods.file_name}`,
    `- ODS SHA-256 (unchanged by reconciliation): ${report.ods.sha256}`,
    `- Baseline ODS SHA-256 (as reported): ${baseline.ods_sha256}`,
    `- FarmOps snapshot: ${report.farmops.snapshot_generated_at} (schema ${report.farmops.snapshot_schema_version})`,
    `- FarmOps snapshot SHA-256: ${report.farmops.snapshot_sha256 ?? "(not computed)"}`,
    `- Mapping version: ${report.mapping_version}; normalization version: ${report.normalization_version}`,
    "",
    "## Baseline vs final",
    "",
    "| Classification | Baseline | Final | Delta |",
    "| --- | --- | --- | --- |",
  ];
  for (const c of CLASSIFICATIONS) {
    out.push(
      `| ${CLASSIFICATION_LABELS[c]} | ${baseline.counts[c] ?? 0} | ${report.summary[c]} | ${sign(data.delta[c])} |`,
    );
  }
  out.push("", "## Root causes", "", "| Root cause | Findings |", "| --- | --- |");
  for (const [cause, n] of Object.entries(report.by_root_cause)) out.push(`| ${cause} | ${n} |`);

  out.push("", "## Dispositions", "", "| Disposition | Findings |", "| --- | --- |");
  for (const d of DISPOSITIONS) out.push(`| ${d} | ${report.by_disposition[d]} |`);

  out.push("", "## FarmOps-only categories", "", "| Category | Meaning | Findings |", "| --- | --- | --- |");
  for (const c of Object.keys(FARMOPS_ONLY_CATEGORIES) as FarmOpsOnlyCategory[]) {
    out.push(`| ${c} | ${FARMOPS_ONLY_CATEGORIES[c]} | ${report.farmops_only_by_category[c]} |`);
  }

  out.push(
    "",
    "## Acceptance gate",
    "",
    `- Status: **${report.gate.status}**`,
    `- LOSS: ${report.gate.loss} (must be 0)`,
    `- Unexplained ODS-only: ${report.gate.unexplained_ods_only} (must be 0)`,
    `- Unexplained findings: ${report.gate.unexplained} (must be 0)`,
    `- Open dispositions awaiting a human decision: ${report.gate.open_dispositions}`,
  );
  if (report.gate.reasons.length) {
    out.push("", "Gate reasons:", "");
    for (const r of report.gate.reasons) out.push(`- ${r}`);
  }

  out.push("", "## Conflicts requiring disposition", "");
  if (!data.conflicts.length) {
    out.push("None.");
  } else {
    out.push(
      "| Domain | Stable ID | Field | ODS | FarmOps | Authority | Disposition | Root cause |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const r of data.conflicts) {
      out.push(
        `| ${r.domain} | ${r.stable_id} | ${r.label} | ${r.ods_value || "(blank)"} | ${r.farmops_value || "(blank)"} | ${r.authority_class} | ${r.disposition} | ${r.root_cause} |`,
      );
    }
  }

  out.push("", "## Unresolved / TBD", "");
  if (!data.unresolved.length) {
    out.push("None.");
  } else {
    out.push("| Domain | Stable ID | Field | ODS reference | FarmOps | Disposition |", "| --- | --- | --- | --- | --- | --- |");
    for (const r of data.unresolved) {
      out.push(
        `| ${r.domain} | ${r.stable_id} | ${r.label} | ${r.ods_value || "(blank)"} | ${r.farmops_value || "(blank)"} | ${r.disposition} |`,
      );
    }
  }

  out.push(
    "",
    "## Guarantees",
    "",
    "- No electrical record was inserted, updated or deleted to produce this report.",
    "- The canonical workbook was read only; its SHA-256 above is unchanged.",
    '- "TBD", blank, `true`, `false` and `0` are distinct states and were never coerced into each other.',
    "- No difference was reclassified into a benign class without a named root cause.",
    "",
    `Phase 4.5 and SOR cutover are out of scope. SOR authority remains ${report.sor_authority}.`,
  );
  return out.join("\n");
}

export const RECONCILIATION_FILES = {
  markdown: "phase-4.4a-reconciliation-report.md",
  json: "phase-4.4a-reconciliation.json",
  conflicts: "phase-4.4a-conflicts.csv",
  unresolved: "phase-4.4a-unresolved.csv",
} as const;
