// Phase 4.4b — Category D provenance pattern analysis (read-only).
//
// Category C is fully dispositioned (raw 138 → resolved 138 → unresolved 0 via
// PLACEHOLDER_PRESERVED_AS_NULL). This module performs the equivalent *grouping*
// step for the remaining Category-D findings, before any individual adjudication.
//
// Invariants:
//  - No finding is reclassified or resolved by this analysis. `raw_category`
//    stays "D" and every disposition is left exactly as the comparison produced.
//  - Exact source values, worksheet/row, stable ID and the canonical ODS SHA are
//    preserved verbatim on every group and every underlying finding.
//  - No schema change, no normalization change, no ODS edit, no FarmOps write.
import type {
  NumericDiagnosticsReport,
  NumericFinding,
} from "@/lib/electrical-numeric-diagnostics";
import { CLOSED_DISPOSITIONS } from "@/lib/electrical-convergence";

export const CATEGORY_D_ANALYSIS_VERSION = "4.4b-category-d-provenance-analysis-2";

/** What is missing before the group could be adjudicated at all. */
export type MissingProvenance =
  | "PROVENANCE_ESTABLISHED_NO_FURTHER_EVIDENCE_REQUIRED"
  | "SOURCE_DOCUMENT_REQUIRED"
  | "EQUIPMENT_NAMEPLATE_REQUIRED"
  | "FARMOPS_ZERO_ORIGIN_PROVENANCE_REQUIRED"
  | "FIELD_VERIFICATION_REQUIRED"
  | "ODS_SEMANTIC_CONTEXT_REQUIRED"
  | "FARMOPS_PROVENANCE_REQUIRED"
  | "IDENTITY_OR_MAPPING_PROVENANCE_REQUIRED"
  | "OTHER_PROVENANCE_REQUIRED";


export const MISSING_PROVENANCE_LABELS: Record<MissingProvenance, string> = {
  PROVENANCE_ESTABLISHED_NO_FURTHER_EVIDENCE_REQUIRED:
    "Provenance has been established and the finding is adjudicated; nothing further is owed. The raw Category-D finding is retained for historical reporting.",
  SOURCE_DOCUMENT_REQUIRED:
    "The canonical workbook states nothing for this quantity; a design document, panel schedule or drawing must establish it.",

  EQUIPMENT_NAMEPLATE_REQUIRED:
    "The quantity is an equipment rating; only the nameplate (or its datasheet) can establish it.",
  FARMOPS_ZERO_ORIGIN_PROVENANCE_REQUIRED:
    "FarmOps holds a zero against a blank canonical cell; the origin of that zero must be established before any field or nameplate verification is requested.",
  FIELD_VERIFICATION_REQUIRED:
    "The quantity describes the physical installation; only an as-installed field observation can establish it.",
  ODS_SEMANTIC_CONTEXT_REQUIRED:
    "Neither side holds an interpretable value; the meaning of the canonical cell must be established before adjudication.",
  FARMOPS_PROVENANCE_REQUIRED:
    "The canonical workbook states a value FarmOps never captured; the import/entry provenance for the FarmOps silence must be established.",
  IDENTITY_OR_MAPPING_PROVENANCE_REQUIRED:
    "The record identity or worksheet→column mapping is not established, so the two sides may not describe the same thing.",
  OTHER_PROVENANCE_REQUIRED:
    "No systematic provenance deficiency recognised — individual review required.",
};

export const RESOLUTION_SOURCE_LABELS: Record<MissingProvenance, string> = {
  PROVENANCE_ESTABLISHED_NO_FURTHER_EVIDENCE_REQUIRED:
    "Already established — see the recorded adjudication provenance on each finding",

  SOURCE_DOCUMENT_REQUIRED:
    "Canonical ODS / original design documentation (panel schedule, load calc, drawing set)",
  EQUIPMENT_NAMEPLATE_REQUIRED: "Equipment nameplate photograph or manufacturer datasheet",
  FARMOPS_ZERO_ORIGIN_PROVENANCE_REQUIRED:
    "FarmOps creation/import/entry provenance for the recorded zero (see the zero-origin refinement)",
  FIELD_VERIFICATION_REQUIRED: "Field observation / as-installed verification by the electrician",
  ODS_SEMANTIC_CONTEXT_REQUIRED: "Canonical ODS author — field meaning and units",
  FARMOPS_PROVENANCE_REQUIRED: "FarmOps import history and entry audit for this record",
  IDENTITY_OR_MAPPING_PROVENANCE_REQUIRED:
    "Field mapping matrix and stable-ID register (identity confirmation first)",
  OTHER_PROVENANCE_REQUIRED: "Individual engineering review",
};

/** Which side, if any, actually states something. Description only. */
export type DSide = "ODS_ONLY" | "FARMOPS_ONLY" | "NEITHER_INTERPRETABLE";

export const D_SIDE_LABELS: Record<DSide, string> = {
  ODS_ONLY: "Canonical ODS states a value; FarmOps is silent",
  FARMOPS_ONLY: "FarmOps holds a value; the canonical ODS is silent",
  NEITHER_INTERPRETABLE: "Neither side holds an interpretable value",
};

/** Equipment-rating concepts: only a nameplate can establish them. */
const NAMEPLATE_FIELDS = new Set([
  "amps",
  "volts",
  "connected_va",
  "demand_va",
  "hp",
  "kw",
  "watts",
  "phase",
  "frequency_hz",
  "mocp_amps",
  "mca_amps",
  "fla_amps",
]);

/** Physical / as-installed concepts: only a field observation can establish them. */
const FIELD_FIELDS = new Set([
  "measured_length_ft",
  "planned_length_ft",
  "length_ft",
  "conduit_size_in",
  "trade_size_in",
  "conductor_count",
  "conductor_size",
  "fill_percent",
  "burial_depth_in",
  "height_in",
  "width_in",
  "depth_in",
  "slot_count",
  "position",
  "ocp_amps",
]);

const IDENTITY_FIELD = /(^|_)(id|ref|reference|parent|source|destination|panel|feeder|raceway)(_|$)/i;

export function side(f: NumericFinding): DSide {
  const odsSilent = f.ods_state === "absent";
  const fpSilent = f.farmops_state === "absent";
  const odsStates = f.ods_state === "value" || f.ods_state === "zero";
  const fpStates = f.farmops_state === "value" || f.farmops_state === "zero";
  if (odsStates && fpSilent) return "ODS_ONLY";
  if (fpStates && odsSilent) return "FARMOPS_ONLY";
  return "NEITHER_INTERPRETABLE";
}

/**
 * Classify the provenance deficiency. This is a statement about *what evidence
 * is missing*, never a resolution of the finding.
 */
export function missingProvenance(f: NumericFinding): MissingProvenance {
  // An adjudicated finding owes no further evidence. Its raw category stays D and
  // it stays visible here; it simply no longer requests provenance.
  if (f.adjudicated && CLOSED_DISPOSITIONS.has(f.convergence_disposition)) {
    return "PROVENANCE_ESTABLISHED_NO_FURTHER_EVIDENCE_REQUIRED";
  }
  const s = side(f);
  const field = f.farmops_field;


  if (!f.farmops_entity || !f.ods_worksheet || IDENTITY_FIELD.test(field)) {
    return "IDENTITY_OR_MAPPING_PROVENANCE_REQUIRED";
  }
  if (s === "NEITHER_INTERPRETABLE") return "ODS_SEMANTIC_CONTEXT_REQUIRED";
  // A FarmOps zero against a blank canonical cell is a provenance question about
  // the zero itself, not yet a nameplate/field verification request.
  if (s === "FARMOPS_ONLY" && f.farmops_state === "zero" && f.ods_state === "absent") {
    return "FARMOPS_ZERO_ORIGIN_PROVENANCE_REQUIRED";
  }
  if (FIELD_FIELDS.has(field)) return "FIELD_VERIFICATION_REQUIRED";
  if (s === "FARMOPS_ONLY") {
    return NAMEPLATE_FIELDS.has(field)
      ? "EQUIPMENT_NAMEPLATE_REQUIRED"
      : "SOURCE_DOCUMENT_REQUIRED";
  }
  if (s === "ODS_ONLY") return "FARMOPS_PROVENANCE_REQUIRED";
  return "OTHER_PROVENANCE_REQUIRED";
}

export interface CategoryDGroup {
  group_id: string;
  entity_type: string;
  farmops_entity: string | null;
  /** Field / concept under analysis. */
  field: string;
  field_label: string;
  unit: string;
  /** Which side states something — description of the D shape. */
  side: DSide;
  /** ODS representation (parser state of the canonical cell). */
  ods_representation: string;
  /** FarmOps representation (parser state of the stored column). */
  farmops_representation: string;
  /** Why provenance is insufficient, in plain terms. */
  provenance_deficiency: string;
  missing_provenance: MissingProvenance;
  likely_resolution_source: string;
  count: number;
  representative_stable_ids: string[];
  /** Exact ODS values, verbatim. */
  ods_values: string[];
  /** Exact FarmOps values, verbatim. */
  farmops_values: string[];
  source_worksheets: string[];
  source_rows: number[];
  /** Descriptive mapping already in force — nothing is added. */
  mapping_rule: string;
  /** True when the deficiency repeats across more than one finding. */
  systematic: boolean;
  /** True when every finding in the group carries a closed adjudication. */
  adjudicated: boolean;
  /** Rows whose disposition is closed (no further evidence owed). */
  resolved_count: number;
  /** Rows still open for Phase 4.5. */
  open_count: number;
  /** Identity of every underlying finding — preserved, never mutated. */
  findings: NumericFinding[];
}

export interface CategoryDAnalysis {
  analysis_version: string;
  ods_file_name: string;
  ods_sha256: string;
  compared_at: string;
  raw_d: number;
  /** Raw D rows now closed by an established adjudication (still reported here). */
  rows_resolved_by_adjudication: number;
  /** Raw D rows still open for Phase 4.5. */
  rows_open: number;
  groups_count: number;
  systematic_groups_count: number;
  individual_review_groups_count: number;
  rows_explained_by_systematic_pattern: number;
  rows_requiring_individual_review: number;

  counts_by_missing_provenance: Record<MissingProvenance, number>;
  counts_by_side: Record<DSide, number>;
  groups: CategoryDGroup[];
  /** No reclassification, no resolution, no schema, no writes. */
  read_only: true;
  write_authorized: false;
}

const EMPTY_PROVENANCE = (): Record<MissingProvenance, number> => ({
  PROVENANCE_ESTABLISHED_NO_FURTHER_EVIDENCE_REQUIRED: 0,
  SOURCE_DOCUMENT_REQUIRED: 0,

  EQUIPMENT_NAMEPLATE_REQUIRED: 0,
  FIELD_VERIFICATION_REQUIRED: 0,
  ODS_SEMANTIC_CONTEXT_REQUIRED: 0,
  FARMOPS_PROVENANCE_REQUIRED: 0,
  IDENTITY_OR_MAPPING_PROVENANCE_REQUIRED: 0,
  FARMOPS_ZERO_ORIGIN_PROVENANCE_REQUIRED: 0,
  OTHER_PROVENANCE_REQUIRED: 0,
});

const EMPTY_SIDES = (): Record<DSide, number> => ({
  ODS_ONLY: 0,
  FARMOPS_ONLY: 0,
  NEITHER_INTERPRETABLE: 0,
});

const uniq = (v: string[]) => [...new Set(v.filter((s) => s !== ""))].sort();

function deficiency(f: NumericFinding, s: DSide, unit: string): string {
  switch (s) {
    case "ODS_ONLY":
      return `The canonical workbook states ${f.ods_raw || "(blank)"} ${unit} and FarmOps holds nothing; there is no record of whether the value was never imported, deliberately omitted or superseded.`;
    case "FARMOPS_ONLY":
      return `FarmOps holds ${f.farmops_raw || "(blank)"} ${unit} with no canonical statement behind it; the originating source for the FarmOps value is not established.`;
    default:
      return `Neither side holds an interpretable ${unit} value (ODS: ${f.ods_state}, FarmOps: ${f.farmops_state}); nothing can be adjudicated until the cell's meaning is established.`;
  }
}
const isResolved = (f: NumericFinding) =>
  f.adjudicated && CLOSED_DISPOSITIONS.has(f.convergence_disposition);


export function categoryDAnalysis(r: NumericDiagnosticsReport): CategoryDAnalysis {
  const dFindings = r.findings.filter((f) => f.raw_category === "D");
  const buckets = new Map<string, CategoryDGroup>();

  for (const f of dFindings) {
    const s = side(f);
    const missing = missingProvenance(f);
    const key = [f.domain, f.farmops_field, s, f.ods_state, f.farmops_state, missing].join("|");
    let g = buckets.get(key);
    if (!g) {
      g = {
        group_id: key,
        entity_type: f.domain,
        farmops_entity: f.farmops_entity,
        field: f.farmops_field,
        field_label: f.label,
        unit: f.unit,
        side: s,
        ods_representation: f.ods_state,
        farmops_representation: f.farmops_state,
        provenance_deficiency: deficiency(f, s, f.unit),
        missing_provenance: missing,
        likely_resolution_source: RESOLUTION_SOURCE_LABELS[missing],
        count: 0,
        representative_stable_ids: [],
        ods_values: [],
        farmops_values: [],
        source_worksheets: [],
        source_rows: [],
        mapping_rule: "",
        systematic: false,
        adjudicated: false,
        resolved_count: 0,
        open_count: 0,

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
    return {
      ...g,
      findings: sorted,
      representative_stable_ids: sorted.slice(0, 5).map((f) => f.stable_id),
      ods_values: uniq(sorted.map((f) => f.ods_raw)).slice(0, 5),
      farmops_values: uniq(sorted.map((f) => f.farmops_raw)).slice(0, 5),
      source_worksheets: worksheets,
      source_rows: [
        ...new Set(sorted.map((f) => f.ods_row).filter((n): n is number => n !== null)),
      ].sort((a, b) => a - b),
      mapping_rule: `${worksheets.join(" + ") || "(unknown worksheet)"} \u2192 ${
        g.farmops_entity ?? "(unmapped entity)"
      }.${g.field}${columns.length ? ` (column${columns.length > 1 ? "s" : ""}: ${columns.join(", ")})` : ""}`,
      systematic: g.count > 1 && g.missing_provenance !== "OTHER_PROVENANCE_REQUIRED",
      adjudicated: sorted.every((f) => isResolved(f)),
      resolved_count: sorted.filter((f) => isResolved(f)).length,
      open_count: sorted.filter((f) => !isResolved(f)).length,

    };
  });

  groups.sort(
    (a, b) =>
      b.count - a.count ||
      a.entity_type.localeCompare(b.entity_type) ||
      a.field.localeCompare(b.field) ||
      a.missing_provenance.localeCompare(b.missing_provenance),
  );

  const counts_by_missing_provenance = EMPTY_PROVENANCE();
  const counts_by_side = EMPTY_SIDES();
  let systematicRows = 0;
  let systematicRows = 0;
  let openIndividualRows = 0;
  for (const g of groups) {
    counts_by_missing_provenance[g.missing_provenance] += g.count;
    counts_by_side[g.side] += g.count;
    if (g.systematic) systematicRows += g.count;
    else openIndividualRows += g.open_count;
  }


  return {
    analysis_version: CATEGORY_D_ANALYSIS_VERSION,
    ods_file_name: r.generated_from_ods,
    ods_sha256: r.ods_sha256,
    compared_at: r.compared_at,
    raw_d: dFindings.length,
    rows_resolved_by_adjudication: dFindings.filter((f) => isResolved(f)).length,
    rows_open: dFindings.filter((f) => !isResolved(f)).length,

    groups_count: groups.length,
    systematic_groups_count: groups.filter((g) => g.systematic).length,
    individual_review_groups_count: groups.filter((g) => !g.systematic).length,
    rows_explained_by_systematic_pattern: systematicRows,
    rows_requiring_individual_review: dFindings.length - systematicRows,
    counts_by_missing_provenance,
    counts_by_side,
    groups,
    read_only: true,
    write_authorized: false,
  };
}

/* ------------------------------------------------------------------ exports */

function csv(rows: string[][]): string {
  return rows
    .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\n");
}

export function categoryDGroupsCsv(a: CategoryDAnalysis): string {
  const head = [
    "ods_sha256",
    "group_id",
    "entity_type",
    "field",
    "field_label",
    "unit",
    "side",
    "ods_representation",
    "farmops_representation",
    "provenance_deficiency",
    "missing_provenance",
    "likely_resolution_source",
    "count",
    "representative_stable_ids",
    "ods_values",
    "farmops_values",
    "source_worksheets",
    "source_rows",
    "mapping_rule",
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
      g.side,
      g.ods_representation,
      g.farmops_representation,
      g.provenance_deficiency,
      g.missing_provenance,
      g.likely_resolution_source,
      String(g.count),
      g.representative_stable_ids.join(" | "),
      g.ods_values.join(" | "),
      g.farmops_values.join(" | "),
      g.source_worksheets.join(" | "),
      g.source_rows.join(" | "),
      g.mapping_rule,
      String(g.systematic),
    ]),
  ]);
}

/** Every underlying Category-D finding, tagged with its group. */
export function categoryDFindingsCsv(a: CategoryDAnalysis): string {
  const head = [
    "ods_sha256",
    "group_id",
    "missing_provenance",
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
        g.missing_provenance,
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

export function categoryDAnalysisMarkdown(a: CategoryDAnalysis): string {
  return [
    "# Phase 4.4b \u2014 Category D provenance pattern analysis (read-only)",
    "",
    `- Canonical workbook: \`${a.ods_file_name}\``,
    `- Workbook SHA-256: \`${a.ods_sha256}\``,
    `- Compared at: ${a.compared_at}`,
    `- Analysis version: \`${a.analysis_version}\``,
    "- Writes performed: **none** \u2014 no reclassification, no resolution, no schema or normalization change, no ODS edit, no FarmOps write",
    "",
    "## Totals",
    "",
    `- Raw D = ${a.raw_d}`,
    `- Systematic groups = ${a.systematic_groups_count} (of ${a.groups_count} total groups)`,
    `- Explained by systematic groups = ${a.rows_explained_by_systematic_pattern}`,
    `- Requiring individual review = ${a.rows_requiring_individual_review} across ${a.individual_review_groups_count} group(s)`,
    "",
    "## Missing provenance roll-up",
    "",
    "| Missing provenance | Rows |",
    "| --- | --- |",
    ...(Object.keys(a.counts_by_missing_provenance) as MissingProvenance[])
      .filter((c) => a.counts_by_missing_provenance[c] > 0)
      .map((c) => `| ${c} | ${a.counts_by_missing_provenance[c]} |`),
    "",
    "## Groups",
    "",
    "| # | Entity | Field / concept | ODS representation | FarmOps representation | Provenance deficiency | Count | Representative IDs | ODS values | FarmOps values | Worksheet(s) | Row(s) | Missing provenance | Likely resolution source | Systematic |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...a.groups.map(
      (g, i) =>
        `| ${i + 1} | ${g.entity_type} | ${g.field} | ${g.ods_representation} | ${g.farmops_representation} | ${g.provenance_deficiency} | ${g.count} | ${g.representative_stable_ids.join(", ")} | ${g.ods_values.join(" \u00b7 ") || "(blank)"} | ${g.farmops_values.join(" \u00b7 ") || "(blank)"} | ${g.source_worksheets.join(", ") || "\u2014"} | ${g.source_rows.join(", ") || "\u2014"} | ${g.missing_provenance} | ${g.likely_resolution_source} | ${g.systematic ? "yes" : "no"} |`,
    ),
    "",
    "## Underlying findings per group",
    "",
    ...a.groups.flatMap((g, i) => [
      `### Group ${i + 1} \u2014 ${g.entity_type}.${g.field} \u00b7 ${g.missing_provenance} (${g.count})`,
      "",
      "| Stable ID | Worksheet | Row | ODS value | FarmOps value | Raw category | Current disposition |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...g.findings.map(
        (f) =>
          `| ${f.stable_id} | ${f.ods_worksheet || "\u2014"} | ${f.ods_row ?? "\u2014"} | ${f.ods_raw || "(blank)"} | ${f.farmops_raw || "(blank)"} | ${f.raw_category} | ${f.convergence_disposition} |`,
      ),
      "",
    ]),
  ].join("\n");
}
