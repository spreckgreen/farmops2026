/**
 * Phase 4.4 — Lossless Parallel Validation engine.
 *
 * Semantic comparison between the canonical engineering workbook
 * (PremoFarmElectrical.ods) and the normalized FarmOps electrical model.
 *
 * Read-only by construction: this module takes already-parsed ODS rows plus a
 * FarmOps reconciliation snapshot and returns a report. It has no database
 * access, produces no write plan, and never touches the workbook. Engineering
 * meaning is compared — never ODS XML, ordering, styling or serialization.
 *
 * FarmOps remains the CANDIDATE system of record; SOR_AUTHORITY stays
 * `canonical_ods` (see electrical-sor.ts).
 */
import {
  ENTITIES,
  importColumns,
  relationshipFields,
  type EntityField,
} from "@/lib/electrical-entities";
import {
  COLLECTION_FOR_KIND,
  ownershipMap,
  relationStableIdKey,
  type ElectricalSnapshot,
  type FieldOwnership,
  type SnapshotRecord,
} from "@/lib/electrical-snapshot";
import { FIELD_MAP, FIELD_MAP_VERSION } from "@/lib/electrical-field-map";
import type { ElectricalEntityKind } from "@/lib/electrical";

export const VALIDATION_SCHEMA_VERSION = "1.0";
export const NORMALIZATION_VERSION = "1.0";
export const MAPPING_VERSION = FIELD_MAP_VERSION;

/* ------------------------------------------------------------------ classes */

export const CLASSIFICATIONS = [
  "MATCH",
  "EXPECTED_TRANSFORMATION",
  "FARMOPS_AS_BUILT_ADDITION",
  "ODS_ONLY",
  "FARMOPS_ONLY",
  "CONFLICT",
  "LOSS",
  "INCOMPLETE",
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const CLASSIFICATION_LABELS: Record<Classification, string> = {
  MATCH: "Match",
  EXPECTED_TRANSFORMATION: "Expected transformation",
  FARMOPS_AS_BUILT_ADDITION: "FarmOps as-built addition",
  ODS_ONLY: "ODS only",
  FARMOPS_ONLY: "FarmOps only",
  CONFLICT: "Conflict",
  LOSS: "Semantic loss",
  INCOMPLETE: "Incomplete / unknown",
};

/**
 * Entities whose records are legitimately created in the field after the
 * canonical design release. A FarmOps-only record here is evidence, not a
 * defect: CON-### raceways, JB-###-## boxes and BR-###-##-## branches.
 */
export const AS_BUILT_KINDS = new Set<ElectricalEntityKind>(["raceway", "jbox", "branch"]);

/* ----------------------------------------------------------- normalization */

export interface NormalizationRule {
  id: string;
  description: string;
}

export const NORMALIZATION_RULES: NormalizationRule[] = [
  { id: "whitespace_trim", description: "Leading/trailing and repeated whitespace collapsed." },
  { id: "case_fold", description: "Text compared case-insensitively where case carries no engineering meaning." },
  { id: "null_equivalence", description: "Empty string and null are the same absence of a value." },
  { id: "not_applicable_null", description: '"n/a", "na", "none", "tbd", "-" read as no value.' },
  { id: "boolean_yes_no", description: 'Yes/Y/True/1/X -> true; No/N/False/0 -> false.' },
  { id: "strip_units", description: 'Unit suffixes removed before numeric comparison ("20 A" -> 20, "45 ft" -> 45).' },
  { id: "thousands_separator", description: '"12,000" -> 12000.' },
  { id: "percent", description: '"65%" -> 65; a 0-1 fraction is read as a percentage of 100.' },
  { id: "dual_voltage", description: '"120/240V" keeps the higher nominal voltage (240).' },
  { id: "numeric_tolerance", description: "Numbers equal within 0.005 are the same value." },
  { id: "relational_fk_from_text", description: "Workbook stable-ID text compared against the resolved FarmOps relationship's stable ID." },
  { id: "set_ordering", description: "Set-like relationships (circuit-group membership) compared as sorted stable-ID sets, independent of row order." },
];

export type NormalValue = string | number | boolean | null;

export interface Normalized {
  value: NormalValue;
  rules: string[];
}

const NULLISH = new Set(["", "n/a", "na", "none", "null", "tbd", "-", "—"]);
const TRUEISH = new Set(["yes", "y", "true", "t", "1", "x", "✓"]);
const FALSEISH = new Set(["no", "n", "false", "f", "0"]);

function collapse(raw: unknown): { text: string; rules: string[] } {
  const rules: string[] = [];
  const original = raw === null || raw === undefined ? "" : String(raw);
  const text = original.replace(/\s+/g, " ").trim();
  if (text !== original) rules.push("whitespace_trim");
  return { text, rules };
}

/** Normalize one cell/column value for semantic comparison. */
export function normalizeValue(field: EntityField, raw: unknown): Normalized {
  if (typeof raw === "boolean") return { value: raw, rules: [] };
  const { text, rules } = collapse(raw);
  const lower = text.toLowerCase();

  if (NULLISH.has(lower)) {
    return { value: null, rules: [...rules, text === "" ? "null_equivalence" : "not_applicable_null"] };
  }

  if (field.kind === "bool") {
    if (TRUEISH.has(lower)) return { value: true, rules: [...rules, "boolean_yes_no"] };
    if (FALSEISH.has(lower)) return { value: false, rules: [...rules, "boolean_yes_no"] };
    return { value: text, rules };
  }

  if (field.kind === "number") {
    if (typeof raw === "number") return { value: raw, rules };
    let work = lower;
    const applied = [...rules];
    if (work.includes(",")) {
      work = work.replace(/,/g, "");
      applied.push("thousands_separator");
    }
    const dual = work.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
    if (dual) {
      applied.push("dual_voltage");
      const high = Math.max(Number(dual[1]), Number(dual[2]));
      return { value: high, rules: applied };
    }
    const percent = work.endsWith("%");
    const numeric = Number(work.replace(/[^0-9.\-]/g, ""));
    if (!Number.isFinite(numeric)) return { value: text, rules: applied };
    if (/[a-z"'%]/.test(work)) applied.push(percent ? "percent" : "strip_units");
    let value = numeric;
    if (field.key === "completion_percent" && !percent && value > 0 && value <= 1) {
      value = value * 100;
      applied.push("percent");
    }
    return { value, rules: applied };
  }

  return { value: text, rules };
}

/** Semantic equality of two normalized values. */
export function sameNormalized(a: NormalValue, b: NormalValue): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a === "boolean" || typeof b === "boolean") return Boolean(a) === Boolean(b);
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.005;
  if (typeof a === "number" || typeof b === "number") {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) < 0.005;
    return false;
  }
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function display(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v).trim();
}

/* --------------------------------------------------------------- interfaces */

export interface OdsEntityRow {
  stableId: string;
  values: Record<string, string>;
  sourceRow?: number;
}

export interface OdsSheetRows {
  /** Worksheet name exactly as it appears in the workbook. */
  sheet: string;
  kind: ElectricalEntityKind | null;
  rows: OdsEntityRow[];
  /** Headers that bound to no FarmOps column, with a sample of their values. */
  unmapped?: { column: string; populated: boolean }[];
}

export interface ValidationInput {
  odsFileName: string;
  odsSha256: string;
  comparedAt: string;
  sheets: OdsSheetRows[];
  snapshot: ElectricalSnapshot;
}

export interface ComparisonRecord {
  domain: string;
  stable_id: string;
  field: string;
  label: string;
  ods_worksheet: string | null;
  ods_column: string | null;
  ods_value: string;
  farmops_entity: string | null;
  farmops_field: string | null;
  farmops_value: string;
  authority: FieldOwnership | "structural";
  classification: Classification;
  /** Normalization / transformation rules that applied. */
  rules: string[];
  note: string;
}

export interface ValidationReport {
  schema_version: string;
  normalization_version: string;
  mapping_version: string;
  compared_at: string;
  sor_authority: "canonical_ods";
  farmops_role: "candidate_sor";
  ods: { file_name: string; sha256: string; worksheets: string[] };
  farmops: { snapshot_schema_version: string; snapshot_generated_at: string };
  summary: Record<Classification, number>;
  by_domain: Record<string, Record<Classification, number>>;
  as_built_additions_by_entity: Record<string, number>;
  records: ComparisonRecord[];
}

/* ---------------------------------------------------------------- comparing */

function emptySummary(): Record<Classification, number> {
  const out = {} as Record<Classification, number>;
  for (const c of CLASSIFICATIONS) out[c] = 0;
  return out;
}

/** Legacy workbook text columns that carry a relationship for each FK column. */
const RELATION_TEXT_COLUMNS: Record<string, string[]> = {
  circuit_group_uuid: ["circuit_group_ref", "source_circuit"],
  panel_uuid: ["suggested_panel"],
  source_panel_uuid: ["source_endpoint_ref", "from_label", "feeder_source"],
  dest_panel_uuid: ["dest_endpoint_ref", "to_label"],
  source_jbox_uuid: ["source_endpoint_ref", "from_label"],
  dest_jbox_uuid: ["dest_endpoint_ref", "to_label"],
  raceway_uuid: ["raceway_ref"],
  load_uuid: ["dest_endpoint_ref"],
};

const TEXT_FIELD: EntityField = { key: "__text", label: "text", kind: "text" };

function odsColumnLabel(kind: ElectricalEntityKind, key: string): string {
  const def = ENTITIES[kind];
  if (key === def.stableIdField) return def.stableIdLabel;
  return def.fields.find((f) => f.key === key)?.label ?? key;
}

function mapRowFor(worksheet: string, column: string) {
  const w = worksheet.toLowerCase();
  const c = column.toLowerCase().replace(/\s*\(.*\)\s*$/, "").trim();
  return FIELD_MAP.find(
    (r) =>
      r.worksheet.toLowerCase() === w &&
      r.field.toLowerCase().replace(/\s*\(.*\)\s*$/, "").trim() === c,
  );
}

export function runParallelComparison(input: ValidationInput): ValidationReport {
  const records: ComparisonRecord[] = [];
  const snapshot = input.snapshot;

  const push = (r: ComparisonRecord) => records.push(r);

  // --- unmapped workbook columns: the semantic-loss detector -----------------
  for (const sheet of input.sheets) {
    for (const col of sheet.unmapped ?? []) {
      if (!col.populated) continue;
      const mapped = mapRowFor(sheet.sheet, col.column);
      const explained =
        mapped &&
        (mapped.classification === "derived" ||
          mapped.classification === "display_only" ||
          mapped.classification === "obsolete" ||
          mapped.classification === "intentionally_excluded");
      push({
        domain: sheet.kind ? COLLECTION_FOR_KIND[sheet.kind] : sheet.sheet,
        stable_id: `${sheet.sheet}:${col.column}`,
        field: col.column,
        label: col.column,
        ods_worksheet: sheet.sheet,
        ods_column: col.column,
        ods_value: "(populated column)",
        farmops_entity: mapped?.farmops ?? null,
        farmops_field: null,
        farmops_value: "",
        authority: "engineering_design",
        classification: explained ? "EXPECTED_TRANSFORMATION" : "LOSS",
        rules: [],
        note: explained
          ? `Mapping ${mapped!.classification}: ${mapped!.transformation}`
          : "Populated workbook column has no FarmOps destination in the Phase 4.3 mapping.",
      });
    }
  }

  // --- per-entity field comparison ------------------------------------------
  for (const kind of Object.keys(ENTITIES) as ElectricalEntityKind[]) {
    const def = ENTITIES[kind];
    const collection = COLLECTION_FOR_KIND[kind];
    const ownership = ownershipMap(kind);
    const allowed = new Set(importColumns(kind));

    const sheetsForKind = input.sheets.filter((s) => s.kind === kind);
    const worksheet = sheetsForKind[0]?.sheet ?? null;
    const odsRows = new Map<string, OdsEntityRow>();
    for (const sheet of sheetsForKind) {
      for (const row of sheet.rows) {
        const id = row.stableId.trim();
        if (id && !odsRows.has(id)) odsRows.set(id, row);
      }
    }

    const fpRows = new Map<string, SnapshotRecord>();
    for (const rec of snapshot[collection] ?? []) {
      fpRows.set(String(rec["stable_id"] ?? "").trim(), rec);
    }

    // records present on one side only
    for (const [id] of odsRows) {
      if (fpRows.has(id)) continue;
      push({
        domain: collection,
        stable_id: id,
        field: "__record",
        label: `${def.singular} record`,
        ods_worksheet: worksheet,
        ods_column: def.stableIdLabel,
        ods_value: id,
        farmops_entity: def.table,
        farmops_field: def.stableIdField,
        farmops_value: "",
        authority: "structural",
        classification: "ODS_ONLY",
        rules: [],
        note: "Workbook record has not been populated in FarmOps.",
      });
    }
    for (const [id] of fpRows) {
      if (!id || odsRows.has(id)) continue;
      push({
        domain: collection,
        stable_id: id,
        field: "__record",
        label: `${def.singular} record`,
        ods_worksheet: worksheet,
        ods_column: null,
        ods_value: "",
        farmops_entity: def.table,
        farmops_field: def.stableIdField,
        farmops_value: id,
        authority: "structural",
        classification: AS_BUILT_KINDS.has(kind)
          ? "FARMOPS_AS_BUILT_ADDITION"
          : "FARMOPS_ONLY",
        rules: [],
        note: AS_BUILT_KINDS.has(kind)
          ? "Field-installed record created after the canonical design release."
          : "FarmOps record with no workbook counterpart — review required.",
      });
    }

    for (const [id, odsRow] of odsRows) {
      const rec = fpRows.get(id);
      if (!rec) continue;

      for (const field of def.fields) {
        if (field.kind === "entity" || !allowed.has(field.key)) continue;
        const own = ownership[field.key] ?? "engineering_design";
        const odsNorm = normalizeValue(field, odsRow.values[field.key]);
        const fpNorm = normalizeValue(field, rec[field.key]);
        if (odsNorm.value === null && fpNorm.value === null) continue;

        const odsText = display(odsRow.values[field.key]);
        const fpText = display(rec[field.key]);
        const rules = [...new Set([...odsNorm.rules, ...fpNorm.rules])].sort();
        const base = {
          domain: collection,
          stable_id: id,
          field: field.key,
          label: field.label,
          ods_worksheet: worksheet,
          ods_column: odsColumnLabel(kind, field.key),
          ods_value: odsText,
          farmops_entity: def.table,
          farmops_field: field.key,
          farmops_value: fpText,
          authority: own,
          rules,
        };

        if (sameNormalized(odsNorm.value, fpNorm.value)) {
          const identical = odsText === fpText;
          push({
            ...base,
            classification: identical ? "MATCH" : "EXPECTED_TRANSFORMATION",
            note: identical
              ? "Same engineering value."
              : `Same meaning after normalization (${rules.join(", ") || "representation"}).`,
          });
          continue;
        }

        if (odsNorm.value === null) {
          push({
            ...base,
            classification:
              own === "farmops_as_built"
                ? "FARMOPS_AS_BUILT_ADDITION"
                : "FARMOPS_ONLY",
            note:
              own === "farmops_as_built"
                ? "Field/as-built value with no design counterpart in the workbook."
                : "FarmOps holds a value the workbook leaves blank — review required.",
          });
          continue;
        }

        if (fpNorm.value === null) {
          push({
            ...base,
            classification: own === "farmops_as_built" ? "INCOMPLETE" : "ODS_ONLY",
            note:
              own === "farmops_as_built"
                ? "Field value not captured yet; the model can represent it."
                : "Workbook value is not populated in FarmOps.",
          });
          continue;
        }

        // Both sides hold a value and they disagree.
        if (own === "farmops_as_built") {
          push({
            ...base,
            classification: "FARMOPS_AS_BUILT_ADDITION",
            note: "As-built observation recorded against a design value — not a conflict.",
          });
          continue;
        }
        push({
          ...base,
          classification: "CONFLICT",
          note: "Both systems hold a value for the same engineering concept and they disagree.",
        });
      }

      // relationship (FK) comparison, always by stable ID — never by UUID
      for (const rel of relationshipFields(kind)) {
        const stableKey = relationStableIdKey(rel.key);
        const fpStable = display(rec[stableKey]);
        const textColumns = RELATION_TEXT_COLUMNS[rel.key] ?? [];
        let odsText = "";
        let odsColumn: string | null = null;
        for (const col of textColumns) {
          const v = display(odsRow.values[col]);
          if (v) {
            odsText = v;
            odsColumn = odsColumnLabel(kind, col);
            break;
          }
        }
        if (!odsText && !fpStable) continue;

        const base = {
          domain: collection,
          stable_id: id,
          field: rel.key,
          label: rel.label,
          ods_worksheet: worksheet,
          ods_column: odsColumn,
          ods_value: odsText,
          farmops_entity: def.table,
          farmops_field: stableKey,
          farmops_value: fpStable,
          authority: (ownership[rel.key] ?? "farmops_as_built") as FieldOwnership,
          rules: ["relational_fk_from_text"],
        };

        if (!odsText) {
          push({
            ...base,
            classification: "FARMOPS_AS_BUILT_ADDITION",
            note: "Relationship established in FarmOps with no workbook equivalent.",
          });
          continue;
        }
        if (!fpStable) {
          push({
            ...base,
            classification: "INCOMPLETE",
            note: "Workbook reference kept read-only; the FarmOps relationship is not established yet.",
          });
          continue;
        }
        const same = sameNormalized(
          normalizeValue(TEXT_FIELD, odsText).value,
          normalizeValue(TEXT_FIELD, fpStable).value,
        );
        push({
          ...base,
          classification: same ? "EXPECTED_TRANSFORMATION" : "CONFLICT",
          note: same
            ? "Workbook reference text represented as a normalized relationship."
            : "Workbook reference and the FarmOps relationship point at different records.",
        });
      }
    }
  }

  // --- circuit-group membership, compared as sorted sets ---------------------
  const odsLoadSheet = input.sheets.find((s) => s.kind === "load");
  const odsMembers = new Map<string, string[]>();
  for (const row of odsLoadSheet?.rows ?? []) {
    const group = display(row.values["circuit_group_ref"] || row.values["source_circuit"]);
    if (!group) continue;
    const list = odsMembers.get(group) ?? [];
    list.push(row.stableId.trim());
    odsMembers.set(group, list);
  }
  const fpMembers = new Map<string, string[]>();
  for (const rec of snapshot.loads ?? []) {
    const group = display(rec["circuit_group_stable_id"]);
    if (!group) continue;
    const list = fpMembers.get(group) ?? [];
    list.push(String(rec["stable_id"] ?? ""));
    fpMembers.set(group, list);
  }
  for (const group of [...new Set([...odsMembers.keys(), ...fpMembers.keys()])].sort()) {
    const a = [...new Set(odsMembers.get(group) ?? [])].sort();
    const b = [...new Set(fpMembers.get(group) ?? [])].sort();
    const base = {
      domain: "circuit_group_membership",
      stable_id: group,
      field: "member_loads",
      label: "Member loads",
      ods_worksheet: odsLoadSheet?.sheet ?? null,
      ods_column: "Circuit Group ID",
      ods_value: a.join(" "),
      farmops_entity: "electrical_loads",
      farmops_field: "circuit_group_uuid",
      farmops_value: b.join(" "),
      authority: "engineering_design" as FieldOwnership,
      rules: ["set_ordering"],
    };
    if (a.length && b.length && a.join(" ") === b.join(" ")) {
      push({ ...base, classification: "MATCH", note: "Same membership set, row order ignored." });
    } else if (!b.length) {
      push({ ...base, classification: "INCOMPLETE", note: "Membership not resolved in FarmOps yet." });
    } else if (!a.length) {
      push({
        ...base,
        classification: "FARMOPS_ONLY",
        note: "FarmOps group membership with no workbook grouping — review required.",
      });
    } else {
      push({
        ...base,
        classification: "CONFLICT",
        note: "Circuit-group membership differs between the workbook and FarmOps.",
      });
    }
  }

  // --- Phase 4.3 child collections are as-built by definition ---------------
  const childCollections: [string, string, string][] = [
    ["raceway_waypoints", "electrical_raceway_waypoints", "Raceway waypoint"],
    ["panel_breaker_positions", "electrical_breaker_positions", "Panel breaker position"],
    ["panel_exits", "electrical_panel_exits", "Panel raceway exit"],
  ];
  for (const [collection, table, label] of childCollections) {
    const rows = (snapshot as unknown as Record<string, SnapshotRecord[]>)[collection] ?? [];
    for (const rec of rows) {
      push({
        domain: collection,
        stable_id: String(rec["stable_id"] ?? rec["uuid"] ?? ""),
        field: "__record",
        label,
        ods_worksheet: null,
        ods_column: null,
        ods_value: "",
        farmops_entity: table,
        farmops_field: "stable_id",
        farmops_value: String(rec["stable_id"] ?? rec["uuid"] ?? ""),
        authority: "farmops_as_built",
        classification: "FARMOPS_AS_BUILT_ADDITION",
        rules: [],
        note: "Physical model captured in FarmOps; the canonical workbook has no equivalent design table.",
      });
    }
  }

  // --- deterministic ordering and summaries ---------------------------------
  records.sort(
    (x, y) =>
      x.domain.localeCompare(y.domain) ||
      x.stable_id.localeCompare(y.stable_id) ||
      x.field.localeCompare(y.field) ||
      x.classification.localeCompare(y.classification),
  );

  const summary = emptySummary();
  const byDomain: Record<string, Record<Classification, number>> = {};
  const asBuilt: Record<string, number> = {};
  for (const r of records) {
    summary[r.classification]++;
    byDomain[r.domain] = byDomain[r.domain] ?? emptySummary();
    byDomain[r.domain][r.classification]++;
    if (r.classification === "FARMOPS_AS_BUILT_ADDITION") {
      asBuilt[r.domain] = (asBuilt[r.domain] ?? 0) + 1;
    }
  }

  return {
    schema_version: VALIDATION_SCHEMA_VERSION,
    normalization_version: NORMALIZATION_VERSION,
    mapping_version: MAPPING_VERSION,
    compared_at: input.comparedAt,
    sor_authority: "canonical_ods",
    farmops_role: "candidate_sor",
    ods: {
      file_name: input.odsFileName,
      sha256: input.odsSha256,
      worksheets: input.sheets.map((s) => s.sheet).sort(),
    },
    farmops: {
      snapshot_schema_version: snapshot.schema_version,
      snapshot_generated_at: snapshot.generated_at,
    },
    summary,
    by_domain: Object.fromEntries(Object.keys(byDomain).sort().map((k) => [k, byDomain[k]!])),
    as_built_additions_by_entity: Object.fromEntries(
      Object.keys(asBuilt).sort().map((k) => [k, asBuilt[k]!]),
    ),
    records,
  };
}

/* ------------------------------------------------------------------ exports */

/** Deterministic JSON, suitable for external validation. */
export function serializeValidationReport(report: ValidationReport): string {
  return JSON.stringify(report, null, 2);
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function validationCsv(report: ValidationReport): string {
  const header = [
    "domain",
    "stable_id",
    "field",
    "label",
    "ods_worksheet",
    "ods_column",
    "ods_value",
    "farmops_entity",
    "farmops_field",
    "farmops_value",
    "authority",
    "classification",
    "rules",
    "note",
  ].join(",");
  const lines = report.records.map((r) =>
    [
      r.domain,
      r.stable_id,
      r.field,
      r.label,
      r.ods_worksheet ?? "",
      r.ods_column ?? "",
      r.ods_value,
      r.farmops_entity ?? "",
      r.farmops_field ?? "",
      r.farmops_value,
      r.authority,
      r.classification,
      r.rules.join(";"),
      r.note,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header, ...lines].join("\n");
}

export function validationMarkdown(report: ValidationReport): string {
  const out: string[] = [
    "# Phase 4.4 — Lossless Parallel Validation",
    "",
    `- Report schema: ${report.schema_version}`,
    `- Mapping version: ${report.mapping_version}`,
    `- Normalization version: ${report.normalization_version}`,
    `- Canonical ODS: ${report.ods.file_name}`,
    `- ODS SHA-256: ${report.ods.sha256}`,
    `- FarmOps snapshot: ${report.farmops.snapshot_generated_at} (schema ${report.farmops.snapshot_schema_version})`,
    `- Compared at: ${report.compared_at}`,
    `- SOR authority: ${report.sor_authority} (FarmOps role: ${report.farmops_role})`,
    "",
    "## Summary",
    "",
  ];
  for (const c of CLASSIFICATIONS) out.push(`- ${CLASSIFICATION_LABELS[c]}: ${report.summary[c]}`);
  out.push(
    "",
    "## Differences",
    "",
    "| Domain | Stable ID | Field | ODS | FarmOps | Authority | Classification | Note |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const r of report.records) {
    if (r.classification === "MATCH") continue;
    out.push(
      `| ${r.domain} | ${r.stable_id} | ${r.label} | ${r.ods_value || "(blank)"} | ${r.farmops_value || "(blank)"} | ${r.authority} | ${r.classification} | ${r.note.replace(/\|/g, "\\|")} |`,
    );
  }
  out.push(
    "",
    "Read-only report: no electrical record was modified and the canonical workbook was not written.",
  );
  return out.join("\n");
}

export function validationFilename(comparedAt: string, ext: string): string {
  const stamp = comparedAt.slice(0, 19).replace(/[:T]/g, "-");
  return `farmops-phase-4-4-parallel-validation-${stamp}.${ext}`;
}
