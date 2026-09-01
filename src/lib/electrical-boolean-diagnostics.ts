// Phase 4.4b Task 1/1B — grouped diagnostics for the boolean_or_default_semantics
// conflict group. Read-only: this module explains findings, it never writes.
//
// Task 1B classifies every finding into one of four categories:
//   A — proven implementation artifact (importer coercion / DB default)
//   B — genuine engineering disagreement (both sides explicit)
//   C — ODS state not representable as a boolean (blank / TBD / N/A)
//   D — provenance insufficient (values disagree, cause unprovable)
// Only Category A is ever eligible for automatic correction, and only after an
// explicit preview + apply by a human.

import type { ComparisonRecord, ValidationReport } from "@/lib/electrical-parallel-validation";
import { parseBooleanCell } from "@/lib/electrical-boolean";
import { ENTITIES } from "@/lib/electrical-entities";

export type DefaultSource =
  | "importer_boolean_coercion"
  | "database_column_default"
  | "ui_form_default"
  | "true_engineering_disagreement"
  | "workbook_tbd_state"
  | "provenance_unknown";

/** Task 1B disposition category. */
export type BooleanCategory = "A" | "B" | "C" | "D";

/**
 * The two — and only two — proven historical implementation artifacts that make
 * a finding Category A. Anything else is never automatically correctable.
 *
 * A1: canonical ODS says "N", FarmOps holds true, because the old importer ran
 *     Boolean("N") === true. Correction: true → false.
 * A2: canonical ODS cell is genuinely blank/not stated, FarmOps holds false, and
 *     the column is one of the documented NOT NULL DEFAULT false columns.
 *     Correction: false → NULL. Never generalised to other boolean columns.
 */
export type BooleanArtifactType = "A1_N_COERCED_TRUE" | "A2_BLANK_DEFAULTED_FALSE";

export const ARTIFACT_LABELS: Record<BooleanArtifactType, string> = {
  A1_N_COERCED_TRUE: 'A1 — old string→Boolean coercion (Boolean("N") === true): true → false',
  A2_BLANK_DEFAULTED_FALSE:
    "A2 — old NOT NULL DEFAULT false column artifact on a blank workbook cell: false → NULL",
};


export interface BooleanDiagnosticRow {
  domain: string;
  field: string;
  farmops_entity: string | null;
  farmops_field: string | null;
  ods_value: string;
  /** What the workbook cell actually means under tri-state rules. */
  ods_meaning: "yes" | "no" | "unknown" | "tbd";
  farmops_value: string;
  /** Value persisted in FarmOps today. */
  persisted_value: string;
  default_source: DefaultSource;
  /** Human-readable provenance of the FarmOps value. */
  provenance: string;
  /** The pre-4.4b coercion/default behaviour that could have produced it. */
  legacy_behavior: string;
  category: BooleanCategory;
  /** Set only for Category A; identifies which proven artifact rule applies. */
  artifact_type: BooleanArtifactType | null;
  /** True only for Category A: our own code demonstrably created the value. */
  implementation_created: boolean;
  /** Value the correction tool would write. undefined = no correction. */
  proposed_value?: boolean | null;
  affected_records: number;
  stable_ids: string[];
  proposed_correction: string;
}

export interface BooleanDiagnosticsReport {
  total_findings: number;
  implementation_created: number;
  true_disagreements: number;
  counts_by_category: Record<BooleanCategory, number>;
  affected_fields: string[];
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

interface Classified {
  source: DefaultSource;
  category: BooleanCategory;
  artifact?: BooleanArtifactType;
  provenance: string;
  legacy: string;
  proposed?: boolean | null;
  fix: string;
}

function classify(rec: ComparisonRecord): Classified {
  const ods = parseBooleanCell(rec.ods_value);
  const fp = parseBooleanCell(rec.farmops_value);
  const column = `${rec.farmops_entity ?? ""}.${rec.farmops_field ?? rec.field}`;
  const defaulted = DEFAULTED_COLUMNS.has(column);

  // A — importer coercion. Boolean("N") === true: nothing but our own importer
  // can turn an explicit workbook "no" into a stored yes.
  if (ods.state === "false" && fp.value === true) {
    return {
      source: "importer_boolean_coercion",
      category: "A",
      artifact: "A1_N_COERCED_TRUE",
      provenance: 'Importer coercion: Boolean("N") evaluated true.',
      legacy: 'coerceValue used Boolean(raw); any non-empty text — including "N" — became true.',
      proposed: false,
      fix: 'Explicit "N" must be stored as false.',
    };
  }

  // A — NOT NULL column default. The workbook never stated a value, and the
  // column could not hold null, so false is provably code-created.
  if (ods.state === "unknown" && ods.recognized && fp.value === false && defaulted) {
    return {
      source: "database_column_default",
      category: "A",
      artifact: "A2_BLANK_DEFAULTED_FALSE",
      provenance: `Database default: ${column} was NOT NULL DEFAULT false before 4.4b.`,
      legacy: "Blank cell inserted nothing; the column default supplied false.",
      proposed: null,
      fix: "Blank workbook cell must be null (not stated); clear the default-created false.",
    };
  }

  // C — the workbook state is not a boolean at all.
  if (ods.state === "tbd") {
    return {
      source: "workbook_tbd_state",
      category: "C",
      provenance: "Workbook states TBD — an unresolved engineering state.",
      legacy: "TBD text was coerced to true by Boolean(raw).",
      fix: "TBD must never be collapsed to yes or no. Resolve in the ODS first.",
    };
  }
  if (ods.state === "unknown") {
    // Blank / unrecognised ODS with an explicit FarmOps value we cannot
    // attribute to a default: could be a deliberate as-built observation.
    return {
      source: ods.recognized ? "ui_form_default" : "provenance_unknown",
      category: ods.recognized ? "C" : "D",
      provenance: ods.recognized
        ? "Workbook cell is blank; FarmOps holds an explicit value of unknown origin."
        : `Workbook text "${rec.ods_value}" is not a recognised Yes/No token.`,
      legacy: "Untouched form checkboxes submitted false; blank cells coerced to false.",
      fix: "Not automatically correctable — requires human disposition.",
    };
  }

  // Both sides explicit and in disagreement.
  if (fp.state === "true" || fp.state === "false") {
    return {
      source: "true_engineering_disagreement",
      category: "B",
      provenance: "Both ODS and FarmOps hold explicit Yes/No values.",
      legacy: "No coercion path produces this pair.",
      fix: "Genuine disagreement — requires explicit engineering disposition, no automatic change.",
    };
  }

  return {
    source: "provenance_unknown",
    category: "D",
    provenance: "FarmOps value is null/unrecognised; origin cannot be proven.",
    legacy: "Unknown.",
    fix: "Insufficient provenance — leave untouched and review manually.",
  };
}

/** Group every boolean_or_default_semantics conflict by entity/field/value pair. */
export function booleanDiagnostics(report: ValidationReport): BooleanDiagnosticsReport {
  const findings = report.records.filter(
    (r) => r.classification === "CONFLICT" && r.root_cause === "boolean_or_default_semantics",
  );
  const byKey = new Map<string, BooleanDiagnosticRow>();

  for (const rec of findings) {
    const c = classify(rec);
    const key = [rec.domain, rec.field, rec.ods_value, rec.farmops_value, c.source].join("|");
    const existing = byKey.get(key);
    if (existing) {
      existing.affected_records += 1;
      existing.stable_ids.push(rec.stable_id);
      continue;
    }
    byKey.set(key, {
      domain: rec.domain,
      field: rec.field,
      farmops_entity: rec.farmops_entity,
      farmops_field: rec.farmops_field ?? rec.field,
      ods_value: rec.ods_value,
      farmops_value: rec.farmops_value,
      ods_meaning: parseBooleanCell(rec.ods_value).state === "tbd" ? "tbd" : booleanWord(rec.ods_value),
      persisted_value: rec.farmops_value,
      default_source: c.source,
      provenance: c.provenance,
      legacy_behavior: c.legacy,
      category: c.category,
      artifact_type: c.artifact ?? null,
      implementation_created: c.category === "A",
      proposed_value: c.proposed,
      affected_records: 1,
      stable_ids: [rec.stable_id],
      proposed_correction: c.fix,
    });
  }

  const groups = [...byKey.values()].sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      b.affected_records - a.affected_records ||
      a.domain.localeCompare(b.domain) ||
      a.field.localeCompare(b.field) ||
      a.default_source.localeCompare(b.default_source),
  );

  const counts: Record<BooleanCategory, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const g of groups) counts[g.category] += g.affected_records;

  const affected = new Set(groups.map((g) => `${g.domain}.${g.field}`));

  return {
    total_findings: findings.length,
    implementation_created: counts.A,
    true_disagreements: counts.B,
    counts_by_category: counts,
    affected_fields: [...affected].sort(),
    groups,
  };
}

function booleanWord(raw: unknown): "yes" | "no" | "unknown" {
  const parsed = parseBooleanCell(raw);
  if (parsed.value === true) return "yes";
  if (parsed.value === false) return "no";
  return "unknown";
}

function csv(rows: string[][]): string {
  return rows
    .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\n");
}

export function booleanDiagnosticsCsv(report: BooleanDiagnosticsReport): string {
  const head = [
    "category",
    "entity_type",
    "field",
    "ods_value",
    "ods_meaning",
    "farmops_value",
    "persisted_value",
    "provenance",
    "old_default_or_coercion",
    "default_source",
    "implementation_created",
    "affected_count",
    "proposed_action",
  ];
  const rows = report.groups.map((g) => [
    g.category,
    g.domain,
    g.field,
    g.ods_value,
    g.ods_meaning,
    g.farmops_value,
    g.persisted_value,
    g.provenance,
    g.legacy_behavior,
    g.default_source,
    String(g.implementation_created),
    String(g.affected_records),
    g.proposed_correction,
  ]);
  return csv([head, ...rows]);
}

/** Drill-down export: one row per affected record, for every category. */
export function booleanRecordCsv(report: BooleanDiagnosticsReport): string {
  const head = [
    "category",
    "entity_type",
    "stable_id",
    "field",
    "farmops_table",
    "farmops_column",
    "ods_value",
    "farmops_value",
    "proposed_value",
    "artifact_type",
    "provenance",
  ];
  const rows: string[][] = [];
  for (const g of report.groups) {
    for (const id of g.stable_ids) {
      rows.push([
        g.category,
        g.domain,
        id,
        g.field,
        g.farmops_entity ?? "",
        g.farmops_field ?? "",
        g.ods_value,
        g.farmops_value,
        g.proposed_value === undefined ? "" : String(g.proposed_value),
        g.artifact_type ?? "",
        g.provenance,
      ]);
    }
  }
  return csv([head, ...rows]);
}

/* ------------------------------------------- Category-A correction proposal */

export interface BooleanCorrectionEntry {
  table: string;
  stable_id_field: string;
  stable_id: string;
  column: string;
  current_value: string;
  ods_value: string;
  proposed_value: boolean | null;
  artifact_type: BooleanArtifactType;
  evidence: string;
}

export interface BooleanCorrectionPlan {
  /** Only Category A implementation artifacts are eligible. */
  entries: BooleanCorrectionEntry[];
  skipped_categories: Record<Exclude<BooleanCategory, "A">, number>;
  /** Groups that are Category A but cannot be mapped to a writable column. */
  unmappable: string[];
}

const BOOL_COLUMNS = new Map<string, { stableIdField: string; columns: Set<string> }>(
  Object.values(ENTITIES).map((def) => [
    def.table,
    {
      stableIdField: def.stableIdField,
      columns: new Set(def.fields.filter((f) => f.kind === "bool" && !f.readOnly).map((f) => f.key)),
    },
  ]),
);

/**
 * Build the preview set for the Category-A boolean correction tool. Pure: it
 * proposes, it never writes, and it refuses anything outside Category A.
 */
export function categoryACorrectionPlan(diag: BooleanDiagnosticsReport): BooleanCorrectionPlan {
  const entries: BooleanCorrectionEntry[] = [];
  const unmappable: string[] = [];
  const skipped: BooleanCorrectionPlan["skipped_categories"] = { B: 0, C: 0, D: 0 };

  for (const g of diag.groups) {
    if (g.category !== "A") {
      skipped[g.category] += g.affected_records;
      continue;
    }
    const table = g.farmops_entity ?? "";
    const column = g.farmops_field ?? "";
    const meta = BOOL_COLUMNS.get(table);
    if (!meta || !meta.columns.has(column) || g.proposed_value === undefined || !g.artifact_type) {
      unmappable.push(`${g.domain}.${g.field} (${table || "?"}.${column || "?"})`);
      continue;
    }
    for (const id of g.stable_ids) {
      entries.push({
        table,
        stable_id_field: meta.stableIdField,
        stable_id: id,
        column,
        current_value: g.farmops_value,
        ods_value: g.ods_value,
        proposed_value: g.proposed_value,
        artifact_type: g.artifact_type,
        evidence: `${g.default_source}: ${g.provenance}`,
      });
    }
  }

  entries.sort(
    (a, b) =>
      a.table.localeCompare(b.table) ||
      a.stable_id.localeCompare(b.stable_id) ||
      a.column.localeCompare(b.column),
  );
  return { entries, skipped_categories: skipped, unmappable: [...new Set(unmappable)].sort() };
}

export function correctionPlanCsv(plan: BooleanCorrectionPlan): string {
  const head = [
    "stable_id",
    "farmops_table",
    "field",
    "current_farmops_value",
    "canonical_ods_value",
    "proposed_value",
    "artifact_type",
    "evidence_root_cause",
  ];
  return csv([
    head,
    ...plan.entries.map((e) => [
      e.stable_id,
      e.table,
      e.column,
      e.current_value,
      e.ods_value,
      e.proposed_value === null ? "(null / not stated)" : String(e.proposed_value),
      e.artifact_type,
      e.evidence,
    ]),
  ]);
}
