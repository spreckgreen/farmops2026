// Phase 4.4b — Category C pattern analysis (read-only).
//
// Purpose: decide whether Category C is 138 independent engineering decisions or
// a small number of systematic representation / modeling issues.
//
// This module NEVER reclassifies a finding, never adds schema, mappings or
// normalization rules, and never writes FarmOps or the canonical ODS. It groups
// the immutable Category-C findings produced by `numericDiagnostics` and, per
// group, states a *likely cause* hypothesis alongside the untouched raw
// classification. Every group preserves the workbook SHA and the identity of its
// underlying findings so a future adjudication stays bound to the same baseline.
import type {
  NumericDiagnosticsReport,
  NumericFinding,
} from "@/lib/electrical-numeric-diagnostics";

export const CATEGORY_C_ANALYSIS_VERSION = "4.4b-category-c-pattern-analysis-1";

export type CategoryCLikelyCause =
  | "MISSING_MODEL_CONCEPT"
  | "MISSING_MAPPING"
  | "TEXT_IN_NUMERIC_FIELD"
  | "BLANK_OR_NULL_SEMANTICS"
  | "FORMULA_OR_DERIVED_VALUE"
  | "COMPOSITE_VALUE_NOT_REPRESENTABLE"
  | "PLACEHOLDER_OR_UNKNOWN"
  | "SOURCE_PARSE_ISSUE"
  | "OTHER_REQUIRES_REVIEW";

export const CATEGORY_C_CAUSE_LABELS: Record<CategoryCLikelyCause, string> = {
  MISSING_MODEL_CONCEPT:
    "The workbook states an engineering concept the model has no field for (qualifier, tolerance, condition).",
  MISSING_MAPPING:
    "A value the workbook does state, in a unit or shape no mapping rule currently accepts.",
  TEXT_IN_NUMERIC_FIELD:
    "Prose or an engineering note recorded in a cell the model treats as a number.",
  BLANK_OR_NULL_SEMANTICS:
    "A dash / n-a / none marker meaning \u201cnot applicable\u201d or \u201cnot stated\u201d rather than a number.",
  FORMULA_OR_DERIVED_VALUE:
    "A spreadsheet formula or explicitly derived expression, not a stated engineering quantity.",
  COMPOSITE_VALUE_NOT_REPRESENTABLE:
    "Several quantities in one cell (range, list, pair) that a single scalar column cannot hold.",
  PLACEHOLDER_OR_UNKNOWN:
    "An explicit unresolved-state marker (TBD, ?, verify, unknown) — engineering has not decided yet.",
  SOURCE_PARSE_ISSUE:
    "Cell content that looks like extraction or header noise rather than engineering data.",
  OTHER_REQUIRES_REVIEW:
    "No systematic pattern recognised — each row needs individual engineering review.",
};

/** Structural signature of the ODS cell text, with no interpretation applied. */
export type OdsPattern =
  | "PLACEHOLDER_TOKEN"
  | "NOT_APPLICABLE_MARKER"
  | "RANGE"
  | "APPROXIMATE"
  | "MULTI_VALUE_LIST"
  | "SLASH_PAIR"
  | "FORMULA"
  | "NUMBER_WITH_UNRECOGNISED_UNIT"
  | "NUMBER_WITH_QUALIFIER_TEXT"
  | "FREE_TEXT"
  | "NON_PRINTING_OR_NOISE";

export const ODS_PATTERN_LABELS: Record<OdsPattern, string> = {
  PLACEHOLDER_TOKEN: "placeholder / unresolved marker",
  NOT_APPLICABLE_MARKER: "not-applicable / none marker",
  RANGE: "numeric range (a\u2013b)",
  APPROXIMATE: "approximate value (~, approx, min/max)",
  MULTI_VALUE_LIST: "several values in one cell",
  SLASH_PAIR: "slash-separated pair",
  FORMULA: "spreadsheet formula",
  NUMBER_WITH_UNRECOGNISED_UNIT: "number with a unit this field does not accept",
  NUMBER_WITH_QUALIFIER_TEXT: "number carrying qualifying words",
  FREE_TEXT: "free text / engineering note",
  NON_PRINTING_OR_NOISE: "non-printing or noise content",
};

export type FarmopsState = "value" | "zero" | "absent" | "other";

const PLACEHOLDER =
  /^(tbd|t\.b\.d\.?|tba|\?+|unk(nown)?|n\/?d|pending|verify( field| in field)?|field verify|check|to be (determined|verified|confirmed)|confirm)$/i;
const NOT_APPLICABLE = /^(n\/?a|none|-{1,3}|\u2014|x|na\b.*)$/i;
const RANGE = /^\s*[\d.,]+\s*(?:-|\u2013|\u2014|to|thru|through)\s*[\d.,]+/i;
const APPROX = /(^|\s)(~|\u2248|approx\.?|about|min|max|>=|<=|>|<)/i;
const MULTI = /[,;&]|(\s(and|or)\s)|(\s\+\s)/i;
const SLASH_PAIR = /^\s*[\d.,]+\s*\/\s*[\d.,]+/;
const FORMULA = /^\s*=/;
const NUMBER_UNIT = /^\s*[\d.,]+\s*[a-zµΩ°%/]+\s*$/i;
const HAS_NUMBER = /[\d]/;
const NOISE = /^[^\p{L}\p{N}]+$/u;

/** Structural pattern of the raw ODS cell. Description only — no reclassification. */
export function odsPattern(raw: string): OdsPattern {
  const s = (raw ?? "").trim();
  if (!s) return "NON_PRINTING_OR_NOISE";
  if (FORMULA.test(s)) return "FORMULA";
  if (PLACEHOLDER.test(s)) return "PLACEHOLDER_TOKEN";
  if (NOT_APPLICABLE.test(s)) return "NOT_APPLICABLE_MARKER";
  if (NOISE.test(s)) return "NON_PRINTING_OR_NOISE";
  if (RANGE.test(s)) return "RANGE";
  if (SLASH_PAIR.test(s)) return "SLASH_PAIR";
  if (APPROX.test(s) && HAS_NUMBER.test(s)) return "APPROXIMATE";
  if (MULTI.test(s) && HAS_NUMBER.test(s)) return "MULTI_VALUE_LIST";
  if (NUMBER_UNIT.test(s)) return "NUMBER_WITH_UNRECOGNISED_UNIT";
  if (HAS_NUMBER.test(s)) return "NUMBER_WITH_QUALIFIER_TEXT";
  return "FREE_TEXT";
}

/**
 * Hypothesis only. The finding stays Category C; this is the shape of the work
 * that would resolve the group, never an automatic disposition.
 */
export function likelyCause(
  pattern: OdsPattern,
  odsState: NumericFinding["ods_state"],
): CategoryCLikelyCause {
  switch (pattern) {
    case "PLACEHOLDER_TOKEN":
      return "PLACEHOLDER_OR_UNKNOWN";
    case "NOT_APPLICABLE_MARKER":
      return "BLANK_OR_NULL_SEMANTICS";
    case "FORMULA":
      return "FORMULA_OR_DERIVED_VALUE";
    case "RANGE":
    case "MULTI_VALUE_LIST":
    case "SLASH_PAIR":
      return "COMPOSITE_VALUE_NOT_REPRESENTABLE";
    case "APPROXIMATE":
      return "MISSING_MODEL_CONCEPT";
    case "NUMBER_WITH_UNRECOGNISED_UNIT":
      return odsState === "ambiguous_unit" ? "MISSING_MAPPING" : "OTHER_REQUIRES_REVIEW";
    case "NUMBER_WITH_QUALIFIER_TEXT":
      return "TEXT_IN_NUMERIC_FIELD";
    case "FREE_TEXT":
      return "TEXT_IN_NUMERIC_FIELD";
    case "NON_PRINTING_OR_NOISE":
      return "SOURCE_PARSE_ISSUE";
    default:
      return "OTHER_REQUIRES_REVIEW";
  }
}

export interface CategoryCGroup {
  group_id: string;
  entity_type: string;
  farmops_entity: string | null;
  /** Field / concept under analysis. */
  field: string;
  field_label: string;
  unit: string;
  /** The Category-C reason from the immutable comparison (parser state). */
  c_reason: NumericFinding["ods_state"];
  ods_pattern: OdsPattern;
  farmops_state: FarmopsState;
  count: number;
  representative_stable_ids: string[];
  representative_ods_values: string[];
  representative_farmops_values: string[];
  source_worksheets: string[];
  /** Descriptive mapping rule already in force (worksheet column → column). */
  mapping_rule: string;
  /** Normalization rules the parser reported for these cells; may be empty. */
  normalization_rule: string;
  likely_cause: CategoryCLikelyCause;
  /** True when the group is a repeated pattern rather than a one-off row. */
  systematic: boolean;
  /** Identity of every underlying finding — preserved, never mutated. */
  findings: NumericFinding[];
}

export interface CategoryCAnalysis {
  analysis_version: string;
  ods_file_name: string;
  /** Baseline binding for any future adjudication of these groups. */
  ods_sha256: string;
  compared_at: string;
  raw_c: number;
  groups_count: number;
  rows_explained_by_systematic_pattern: number;
  rows_requiring_individual_review: number;
  counts_by_cause: Record<CategoryCLikelyCause, number>;
  counts_by_pattern: Partial<Record<OdsPattern, number>>;
  groups: CategoryCGroup[];
  /** No reclassification, no schema, no mappings, no writes. */
  read_only: true;
}

const EMPTY_CAUSES = (): Record<CategoryCLikelyCause, number> => ({
  MISSING_MODEL_CONCEPT: 0,
  MISSING_MAPPING: 0,
  TEXT_IN_NUMERIC_FIELD: 0,
  BLANK_OR_NULL_SEMANTICS: 0,
  FORMULA_OR_DERIVED_VALUE: 0,
  COMPOSITE_VALUE_NOT_REPRESENTABLE: 0,
  PLACEHOLDER_OR_UNKNOWN: 0,
  SOURCE_PARSE_ISSUE: 0,
  OTHER_REQUIRES_REVIEW: 0,
});

function farmopsState(f: NumericFinding): FarmopsState {
  return f.farmops_state === "value" || f.farmops_state === "zero" || f.farmops_state === "absent"
    ? f.farmops_state
    : "other";
}

const uniq = (v: string[]) => [...new Set(v.filter((s) => s !== ""))].sort();

export function categoryCAnalysis(r: NumericDiagnosticsReport): CategoryCAnalysis {
  const cFindings = r.findings.filter((f) => f.raw_category === "C");
  const buckets = new Map<string, CategoryCGroup>();

  for (const f of cFindings) {
    const pattern = odsPattern(f.ods_raw);
    const fpState = farmopsState(f);
    const key = [f.domain, f.farmops_field, f.ods_state, pattern, fpState].join("|");
    let g = buckets.get(key);
    if (!g) {
      g = {
        group_id: key,
        entity_type: f.domain,
        farmops_entity: f.farmops_entity,
        field: f.farmops_field,
        field_label: f.label,
        unit: f.unit,
        c_reason: f.ods_state,
        ods_pattern: pattern,
        farmops_state: fpState,
        count: 0,
        representative_stable_ids: [],
        representative_ods_values: [],
        representative_farmops_values: [],
        source_worksheets: [],
        mapping_rule: "",
        normalization_rule: "",
        likely_cause: likelyCause(pattern, f.ods_state),
        systematic: false,
        findings: [],
      };
      buckets.set(key, g);
    }
    g.count += 1;
    g.findings.push(f);
  }

  const groups = [...buckets.values()].map((g) => {
    const sorted = [...g.findings].sort((a, b) => a.stable_id.localeCompare(b.stable_id));
    const worksheets = uniq(sorted.map((f) => f.ods_worksheet));
    const columns = uniq(sorted.map((f) => f.ods_column));
    const rules = uniq(sorted.flatMap((f) => f.normalization_rules));
    return {
      ...g,
      findings: sorted,
      representative_stable_ids: sorted.slice(0, 5).map((f) => f.stable_id),
      representative_ods_values: uniq(sorted.map((f) => f.ods_raw)).slice(0, 5),
      representative_farmops_values: uniq(
        sorted.map((f) => f.farmops_raw || "(not stated)"),
      ).slice(0, 5),
      source_worksheets: worksheets,
      mapping_rule: `${worksheets.join(" + ") || "(unknown worksheet)"} \u2192 ${
        g.farmops_entity ?? "(unmapped entity)"
      }.${g.field}${columns.length ? ` (column${columns.length > 1 ? "s" : ""}: ${columns.join(", ")})` : ""}`,
      normalization_rule: rules.length
        ? rules.join("; ")
        : "none applied \u2014 the cell never reached numeric normalization",
      systematic: g.count > 1 && g.likely_cause !== "OTHER_REQUIRES_REVIEW",
    };
  });

  groups.sort(
    (a, b) =>
      b.count - a.count ||
      a.entity_type.localeCompare(b.entity_type) ||
      a.field.localeCompare(b.field) ||
      a.ods_pattern.localeCompare(b.ods_pattern),
  );

  const counts_by_cause = EMPTY_CAUSES();
  const counts_by_pattern: Partial<Record<OdsPattern, number>> = {};
  let systematicRows = 0;
  for (const g of groups) {
    counts_by_cause[g.likely_cause] += g.count;
    counts_by_pattern[g.ods_pattern] = (counts_by_pattern[g.ods_pattern] ?? 0) + g.count;
    if (g.systematic) systematicRows += g.count;
  }

  return {
    analysis_version: CATEGORY_C_ANALYSIS_VERSION,
    ods_file_name: r.generated_from_ods,
    ods_sha256: r.ods_sha256,
    compared_at: r.compared_at,
    raw_c: cFindings.length,
    groups_count: groups.length,
    rows_explained_by_systematic_pattern: systematicRows,
    rows_requiring_individual_review: cFindings.length - systematicRows,
    counts_by_cause,
    counts_by_pattern,
    groups,
    read_only: true,
  };
}

/* ------------------------------------------------------------------ exports */

function csv(rows: string[][]): string {
  return rows
    .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\n");
}

export function categoryCGroupsCsv(a: CategoryCAnalysis): string {
  const head = [
    "ods_sha256",
    "group_id",
    "entity_type",
    "field",
    "field_label",
    "unit",
    "c_reason",
    "ods_representation_pattern",
    "farmops_representation_state",
    "count",
    "representative_stable_ids",
    "representative_ods_values",
    "representative_farmops_values",
    "source_worksheets",
    "mapping_rule",
    "normalization_rule",
    "likely_cause",
    "systematic",
  ];
  return csv([
    head,
    ...a.groups.map((g) => [
      a.ods_sha256,
      g.group_id,
      g.entity_type,
      g.field,
      g.field_label,
      g.unit,
      g.c_reason,
      g.ods_pattern,
      g.farmops_state,
      String(g.count),
      g.representative_stable_ids.join(" | "),
      g.representative_ods_values.join(" | "),
      g.representative_farmops_values.join(" | "),
      g.source_worksheets.join(" | "),
      g.mapping_rule,
      g.normalization_rule,
      g.likely_cause,
      String(g.systematic),
    ]),
  ]);
}

/** Every underlying Category-C finding, tagged with its group and hypothesis. */
export function categoryCFindingsCsv(a: CategoryCAnalysis): string {
  const head = [
    "ods_sha256",
    "group_id",
    "likely_cause",
    "raw_category",
    "entity_type",
    "stable_id",
    "farmops_entity",
    "farmops_field",
    "farmops_uuid",
    "ods_worksheet",
    "ods_column",
    "ods_row",
    "ods_raw",
    "ods_state",
    "farmops_raw",
    "farmops_state",
    "current_disposition",
  ];
  return csv([
    head,
    ...a.groups.flatMap((g) =>
      g.findings.map((f) => [
        a.ods_sha256,
        g.group_id,
        g.likely_cause,
        f.raw_category,
        f.domain,
        f.stable_id,
        f.farmops_entity ?? "",
        f.farmops_field,
        f.farmops_uuid ?? "",
        f.ods_worksheet,
        f.ods_column,
        f.ods_row === null ? "" : String(f.ods_row),
        f.ods_raw,
        f.ods_state,
        f.farmops_raw,
        f.farmops_state,
        f.convergence_disposition,
      ]),
    ),
  ]);
}

export function categoryCAnalysisMarkdown(a: CategoryCAnalysis): string {
  const lines: string[] = [
    "# Phase 4.4b \u2014 Category C pattern analysis (read-only)",
    "",
    `- Canonical workbook: \`${a.ods_file_name}\``,
    `- Workbook SHA-256: \`${a.ods_sha256}\` (future adjudications of these groups stay bound to this baseline)`,
    `- Compared at: ${a.compared_at}`,
    `- Analysis version: \`${a.analysis_version}\``,
    "- Writes performed: **none** \u2014 no reclassification, no schema, no mapping or normalization rules added, no FarmOps writes, no ODS edits",
    "",
    "## Totals",
    "",
    `- Raw C = ${a.raw_c}`,
    `- Groups = ${a.groups_count}`,
    `- Rows explained by systematic pattern = ${a.rows_explained_by_systematic_pattern}`,
    `- Rows requiring individual review = ${a.rows_requiring_individual_review}`,
    "",
    "## Likely cause roll-up",
    "",
    "| Likely cause | Rows |",
    "| --- | --- |",
    ...(Object.keys(a.counts_by_cause) as CategoryCLikelyCause[])
      .filter((c) => a.counts_by_cause[c] > 0)
      .map((c) => `| ${c} | ${a.counts_by_cause[c]} |`),
    "",
    "## Groups",
    "",
    "| # | Entity | Field / concept | C reason | ODS pattern | FarmOps state | Count | Representative IDs | Representative ODS | Representative FarmOps | Worksheet(s) | Mapping rule | Normalization rule | Likely cause | Systematic |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...a.groups.map(
      (g, i) =>
        `| ${i + 1} | ${g.entity_type} | ${g.field} | ${g.c_reason} | ${g.ods_pattern} | ${g.farmops_state} | ${g.count} | ${g.representative_stable_ids.join(", ")} | ${g.representative_ods_values.join(" \u00b7 ")} | ${g.representative_farmops_values.join(" \u00b7 ")} | ${g.source_worksheets.join(", ")} | ${g.mapping_rule} | ${g.normalization_rule} | ${g.likely_cause} | ${g.systematic ? "yes" : "no"} |`,
    ),
    "",
    "## Underlying findings per group",
    "",
    ...a.groups.flatMap((g, i) => [
      `### Group ${i + 1} \u2014 ${g.entity_type}.${g.field} \u00b7 ${g.ods_pattern} \u00b7 ${g.likely_cause} (${g.count})`,
      "",
      "| Stable ID | Worksheet | Row | ODS value | FarmOps value | Current disposition |",
      "| --- | --- | --- | --- | --- | --- |",
      ...g.findings.map(
        (f) =>
          `| ${f.stable_id} | ${f.ods_worksheet || "\u2014"} | ${f.ods_row ?? "\u2014"} | ${f.ods_raw || "(blank)"} | ${f.farmops_raw || "(not stated)"} | ${f.convergence_disposition} |`,
      ),
      "",
    ]),
  ];
  return lines.join("\n");
}
