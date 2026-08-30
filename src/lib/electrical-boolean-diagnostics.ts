// Phase 4.4b Task 1 — grouped diagnostics for the boolean_or_default_semantics
// conflict group. Read-only: this module explains findings, it never writes.

import type { ComparisonRecord, ValidationReport } from "@/lib/electrical-parallel-validation";
import { parseBooleanCell } from "@/lib/electrical-boolean";

export type DefaultSource =
  | "importer_boolean_coercion"
  | "database_column_default"
  | "ui_form_default"
  | "true_engineering_disagreement"
  | "workbook_tbd_state";

export interface BooleanDiagnosticRow {
  domain: string;
  field: string;
  ods_value: string;
  farmops_value: string;
  /** What the workbook cell actually means under tri-state rules. */
  ods_meaning: "yes" | "no" | "unknown" | "tbd";
  /** Value persisted in FarmOps today. */
  persisted_value: string;
  default_source: DefaultSource;
  /** True when FarmOps' value can only have come from our own code. */
  implementation_created: boolean;
  affected_records: number;
  stable_ids: string[];
  proposed_correction: string;
}

export interface BooleanDiagnosticsReport {
  total_findings: number;
  implementation_created: number;
  true_disagreements: number;
  groups: BooleanDiagnosticRow[];
}

/**
 * Columns that carried a NOT NULL default before Phase 4.4b. A blank workbook
 * cell against one of these is a database artifact, not engineering intent.
 */
const DEFAULTED_COLUMNS = new Set([
  "electrical_loads.critical",
  "electrical_loads.future",
  "electrical_loads.continuous_load",
  "electrical_loads.backup_eligible",
  "electrical_loads.dedicated",
  "electrical_feeders.critical",
  "electrical_feeders.future",
  "electrical_circuit_groups.critical",
  "electrical_circuit_groups.continuous_load",
  "electrical_circuit_groups.backup_eligible",
  "electrical_raceways.spare",
]);

function classify(rec: ComparisonRecord): { source: DefaultSource; implementation: boolean; fix: string } {
  const ods = parseBooleanCell(rec.ods_value);
  const fp = parseBooleanCell(rec.farmops_value);
  const column = `${rec.farmops_entity ?? ""}.${rec.farmops_field ?? rec.field}`;

  if (ods.state === "tbd") {
    return {
      source: "workbook_tbd_state",
      implementation: true,
      fix: "Workbook states TBD; FarmOps must hold null (not stated), never a boolean.",
    };
  }
  if (ods.state === "false" && fp.value === true) {
    return {
      source: "importer_boolean_coercion",
      implementation: true,
      fix: 'Explicit "N" must import as false. Reset to false where the value was never user-entered.',
    };
  }
  if (ods.state === "unknown" && fp.value === false && DEFAULTED_COLUMNS.has(column)) {
    return {
      source: "database_column_default",
      implementation: true,
      fix: "Blank workbook cell must remain null (unknown); clear the default-created false.",
    };
  }
  if (ods.state === "unknown" && fp.value === false) {
    return {
      source: "ui_form_default",
      implementation: true,
      fix: "Form submitted an untouched checkbox as false; store null until stated.",
    };
  }
  return {
    source: "true_engineering_disagreement",
    implementation: false,
    fix: "Genuine disagreement — requires explicit engineering disposition, no automatic change.",
  };
}

/** Group every boolean_or_default_semantics conflict by entity/field/value pair. */
export function booleanDiagnostics(report: ValidationReport): BooleanDiagnosticsReport {
  const findings = report.records.filter(
    (r) => r.classification === "CONFLICT" && r.root_cause === "boolean_or_default_semantics",
  );
  const byKey = new Map<string, BooleanDiagnosticRow>();

  for (const rec of findings) {
    const { source, implementation, fix } = classify(rec);
    const key = [rec.domain, rec.field, rec.ods_value, rec.farmops_value, source].join("|");
    const existing = byKey.get(key);
    if (existing) {
      existing.affected_records += 1;
      if (existing.stable_ids.length < 50) existing.stable_ids.push(rec.stable_id);
      continue;
    }
    byKey.set(key, {
      domain: rec.domain,
      field: rec.field,
      ods_value: rec.ods_value,
      farmops_value: rec.farmops_value,
      ods_meaning: parseBooleanCell(rec.ods_value).state === "tbd" ? "tbd" : booleanWord(rec.ods_value),
      persisted_value: rec.farmops_value,
      default_source: source,
      implementation_created: implementation,
      affected_records: 1,
      stable_ids: [rec.stable_id],
      proposed_correction: fix,
    });
  }

  const groups = [...byKey.values()].sort(
    (a, b) =>
      b.affected_records - a.affected_records ||
      a.domain.localeCompare(b.domain) ||
      a.field.localeCompare(b.field) ||
      a.default_source.localeCompare(b.default_source),
  );

  return {
    total_findings: findings.length,
    implementation_created: groups.filter((g) => g.implementation_created).reduce((n, g) => n + g.affected_records, 0),
    true_disagreements: groups
      .filter((g) => !g.implementation_created)
      .reduce((n, g) => n + g.affected_records, 0),
    groups,
  };
}

function booleanWord(raw: unknown): "yes" | "no" | "unknown" {
  const parsed = parseBooleanCell(raw);
  if (parsed.value === true) return "yes";
  if (parsed.value === false) return "no";
  return "unknown";
}

export function booleanDiagnosticsCsv(report: BooleanDiagnosticsReport): string {
  const head = [
    "domain",
    "field",
    "ods_value",
    "ods_meaning",
    "farmops_value",
    "default_source",
    "implementation_created",
    "affected_records",
    "stable_ids",
    "proposed_correction",
  ];
  const rows = report.groups.map((g) => [
    g.domain,
    g.field,
    g.ods_value,
    g.ods_meaning,
    g.farmops_value,
    g.default_source,
    String(g.implementation_created),
    String(g.affected_records),
    g.stable_ids.join(" "),
    g.proposed_correction,
  ]);
  return [head, ...rows]
    .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\n");
}
