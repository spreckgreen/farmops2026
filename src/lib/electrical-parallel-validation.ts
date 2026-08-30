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
import {
  FARMOPS_NATIVE_KINDS,
  ODS_EXTRAS_FIELD,
  type ElectricalEntityKind,
} from "@/lib/electrical";

export const VALIDATION_SCHEMA_VERSION = "1.2";
export const NORMALIZATION_VERSION = "1.2";
export const MAPPING_VERSION = FIELD_MAP_VERSION;

/* -------------------------------------------------- 4.4a disposition model */

/**
 * Who is allowed to decide a difference. Phase 4.4a never lets one system
 * silently win: a design field is the workbook's, an as-built field is
 * FarmOps's, a derived field must be recomputed, and anything else is an
 * engineering decision that stays visible until a human makes it.
 */
export const AUTHORITY_CLASSES = [
  "DESIGN_CANONICAL",
  "AS_BUILT_OPERATIONAL",
  "DERIVED",
  "DECISION_REQUIRED",
  "STRUCTURAL",
] as const;
export type AuthorityClass = (typeof AUTHORITY_CLASSES)[number];

export const DISPOSITIONS = [
  "ACCEPTED",
  "REVIEW_REQUIRED",
  "ENGINEERING_DECISION_REQUIRED",
  "CORRECT_FARMOPS",
  "CORRECT_MAPPING",
  "UNRESOLVED_ENGINEERING_REFERENCE",
  "TBD_ENGINEERING_STATE",
] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

/** Phase 4.4a §6 buckets for FarmOps-only information. */
export const FARMOPS_ONLY_CATEGORIES = {
  A: "Legitimate as-built / operational extension",
  B: "Valid schema enrichment",
  C: "Import / default artifact",
  D: "Duplicate or identity error",
  E: "Engineering decision required",
} as const;
export type FarmOpsOnlyCategory = keyof typeof FARMOPS_ONLY_CATEGORIES;


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
/** FarmOps-native infrastructure kinds are always FarmOps-only by design. */
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
  { id: "not_applicable_null", description: '"n/a", "na", "none", "-" read as no value.' },
  { id: "tbd_unknown", description: '"TBD", "?", "unknown" is a third state: not a value, and never equal to blank, true, false or 0.' },
  { id: "boolean_yes_no", description: 'Yes/Y/True/X -> true; No/N/False -> false. Blank and TBD stay unknown; 1/0 only count for a column already stored as a boolean.' },
  { id: "strip_units", description: 'Unit suffixes removed before numeric comparison ("20 A" -> 20, "45 ft" -> 45).' },
  { id: "kva_to_va", description: '"12 kVA" -> 12000 VA when the destination column is volt-amperes.' },
  { id: "thousands_separator", description: '"12,000" -> 12000.' },
  { id: "percent", description: '"65%" -> 65; a 0-1 fraction is read as a percentage of 100.' },
  { id: "dual_voltage", description: '"120/240V" keeps the higher nominal voltage (240).' },
  { id: "numeric_tolerance", description: "Numbers equal within 0.005 are the same value." },
  { id: "relational_fk_from_text", description: "Workbook stable-ID text compared against the resolved FarmOps relationship's stable ID." },
  { id: "verbatim_preservation", description: "A canonical column with no dedicated FarmOps field is stored verbatim in ods_extras under its exact workbook header." },
  { id: "set_ordering", description: "Set-like relationships (circuit-group membership) compared as sorted stable-ID sets, independent of row order." },
];

export type NormalValue = string | number | boolean | null;

export interface Normalized {
  value: NormalValue;
  rules: string[];
  /** True when the source states "to be determined" rather than a value. */
  tbd?: boolean;
}

const NULLISH = new Set(["", "n/a", "na", "none", "null", "-", "—"]);
const TBDISH = new Set(["tbd", "t.b.d.", "tbd?", "?", "??", "unknown", "unk", "to be determined"]);
const TRUEISH = new Set(["yes", "y", "true", "t", "x", "✓"]);
const FALSEISH = new Set(["no", "n", "false", "f"]);

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

  if (TBDISH.has(lower)) {
    return { value: null, rules: [...rules, "tbd_unknown"], tbd: true };
  }

  if (NULLISH.has(lower)) {
    return { value: null, rules: [...rules, text === "" ? "null_equivalence" : "not_applicable_null"] };
  }

  if (field.kind === "bool") {
    if (TRUEISH.has(lower)) return { value: true, rules: [...rules, "boolean_yes_no"] };
    if (FALSEISH.has(lower)) return { value: false, rules: [...rules, "boolean_yes_no"] };
    // "1"/"0" are only trusted when the value already arrived as a stored
    // number — a workbook cell holding 1 or 0 in a Yes/No column is ambiguous
    // and stays unknown rather than being invented as true or false.
    if (typeof raw === "number") return { value: raw !== 0, rules: [...rules, "boolean_yes_no"] };
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
    if (field.key.endsWith("_va") && /kva/.test(work)) {
      value = value * 1000;
      applied.push("kva_to_va");
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
  /**
   * Headers that bound to no FarmOps column. Phase 4.4a carries per-record
   * evidence so a LOSS finding names the workbook rows and values at risk.
   */
  unmapped?: {
    column: string;
    populated: boolean;
    populatedRows?: number;
    samples?: { stableId: string; value: string }[];
    /** Set when a second header meant a FarmOps column already bound. */
    collidedWith?: string;
  }[];
}

export interface ValidationInput {
  odsFileName: string;
  odsSha256: string;
  comparedAt: string;
  sheets: OdsSheetRows[];
  snapshot: ElectricalSnapshot;
  /** Checksum of the serialized FarmOps snapshot, when the caller computed it. */
  snapshotSha256?: string;
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
  /** Phase 4.4a: who may decide this difference. */
  authority_class: AuthorityClass;
  /** Phase 4.4a: what must happen next. Never an automatic overwrite. */
  disposition: Disposition;
  /** Phase 4.4a: machine-readable cause, "unclassified" when unexplained. */
  root_cause: string;
  /** Phase 4.4a §6 bucket, for FarmOps-only findings only. */
  farmops_only_category: FarmOpsOnlyCategory | null;
  /** The workbook states "to be determined" rather than a value. */
  tbd: boolean;
}

export interface ValidationReport {
  schema_version: string;
  normalization_version: string;
  mapping_version: string;
  compared_at: string;
  sor_authority: "canonical_ods";
  farmops_role: "candidate_sor";
  ods: { file_name: string; sha256: string; worksheets: string[] };
  farmops: {
    snapshot_schema_version: string;
    snapshot_generated_at: string;
    snapshot_sha256: string | null;
  };
  summary: Record<Classification, number>;
  by_domain: Record<string, Record<Classification, number>>;
  as_built_additions_by_entity: Record<string, number>;
  by_root_cause: Record<string, number>;
  by_disposition: Record<Disposition, number>;
  farmops_only_by_category: Record<FarmOpsOnlyCategory, number>;
  /** Phase 4.4a acceptance gate — computed, never asserted by hand. */
  gate: {
    loss: number;
    unexplained_ods_only: number;
    unexplained: number;
    open_dispositions: number;
    status: "PASS" | "FAIL";
    reasons: string[];
  };
  records: ComparisonRecord[];
}

/* -------------------------------------------------- 4.4a record enrichment */

function authorityClassFor(
  authority: FieldOwnership | "structural",
  field?: EntityField,
): AuthorityClass {
  if (authority === "structural") return "STRUCTURAL";
  if (authority === "farmops_as_built") return "AS_BUILT_OPERATIONAL";
  if (authority === "unknown") return "DECISION_REQUIRED";
  if (field && DERIVED_FIELDS.has(field.key)) return "DERIVED";
  return "DESIGN_CANONICAL";
}

/** Columns FarmOps recomputes rather than stores as released design values. */
const DERIVED_FIELDS = new Set([
  "connected_va_total",
  "demand_va_total",
  "load_count",
  "completion_percent",
]);

function dispositionFor(
  classification: Classification,
  cls: AuthorityClass,
  tbd: boolean,
  category: FarmOpsOnlyCategory | null,
): Disposition {
  switch (classification) {
    case "MATCH":
    case "EXPECTED_TRANSFORMATION":
    case "FARMOPS_AS_BUILT_ADDITION":
      return "ACCEPTED";
    case "LOSS":
      return "CORRECT_MAPPING";
    case "ODS_ONLY":
      return "CORRECT_FARMOPS";
    case "FARMOPS_ONLY":
      return category === "A" || category === "B" ? "ACCEPTED" : "REVIEW_REQUIRED";
    case "INCOMPLETE":
      return tbd ? "TBD_ENGINEERING_STATE" : "UNRESOLVED_ENGINEERING_REFERENCE";
    case "CONFLICT":
      if (cls === "DERIVED") return "CORRECT_MAPPING";
      if (cls === "AS_BUILT_OPERATIONAL") return "REVIEW_REQUIRED";
      return "ENGINEERING_DECISION_REQUIRED";
    default:
      return "REVIEW_REQUIRED";
  }
}

type DraftRecord = Omit<
  ComparisonRecord,
  "authority_class" | "disposition" | "root_cause" | "farmops_only_category" | "tbd"
> &
  Partial<
    Pick<
      ComparisonRecord,
      "authority_class" | "disposition" | "root_cause" | "farmops_only_category" | "tbd"
    >
  >;

/**
 * Fill in the Phase 4.4a decision metadata. Defaults never soften a finding:
 * an unexplained difference keeps root cause "unclassified" so the acceptance
 * gate can count it.
 */
export function finalizeRecord(draft: DraftRecord, field?: EntityField): ComparisonRecord {
  const authority_class = draft.authority_class ?? authorityClassFor(draft.authority, field);
  const tbd = draft.tbd ?? false;
  const category = draft.farmops_only_category ?? null;
  return {
    ...draft,
    authority_class,
    tbd,
    farmops_only_category: category,
    root_cause: draft.root_cause ?? "unclassified",
    disposition:
      draft.disposition ?? dispositionFor(draft.classification, authority_class, tbd, category),
  };
}


/** Does the mapping matrix already express this FarmOps column? */
function matrixCoversColumn(table: string, key: string): boolean {
  const needle = `${table}.${key}`.toLowerCase();
  return FIELD_MAP.some((r) => r.farmops.toLowerCase().includes(needle));
}

/**
 * A FarmOps value that merely repeats the column default carries no
 * engineering meaning, so it is an import artifact rather than new data.
 */
function looksLikeDefaultArtifact(field: EntityField, value: NormalValue): boolean {
  if (value === false) return true;
  if (field.kind === "number" && value === 0) return true;
  if (typeof value === "string" && ["planned", "unknown", "tbd"].includes(value.toLowerCase())) {
    return true;
  }
  return false;
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

  const push = (r: DraftRecord, field?: EntityField) => records.push(finalizeRecord(r, field));

  /**
   * Phase 4.4a lossless capture index: `collection:STABLE_ID` -> the workbook
   * columns preserved verbatim on that FarmOps record. A canonical column with
   * no dedicated FarmOps field is only accepted as an expected transformation
   * when the value is provably present here — never by reclassification.
   */
  const extrasIndex = new Map<string, Record<string, string>>();
  for (const kind of Object.keys(ENTITIES) as ElectricalEntityKind[]) {
    const collection = COLLECTION_FOR_KIND[kind];
    for (const rec of snapshot[collection] ?? []) {
      const raw = rec[ODS_EXTRAS_FIELD];
      if (typeof raw !== "string" || !raw.trim()) continue;
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const id = String(rec["stable_id"] ?? "").trim();
          if (id) extrasIndex.set(`${collection}:${id}`, parsed as Record<string, string>);
        }
      } catch {
        // Unparseable capture is not evidence of preservation: leave it out so
        // the column is still reported as loss.
      }
    }
  }
  const preservedVerbatim = (
    collection: string,
    column: string,
    samples: { stableId: string; value: string }[],
  ): boolean =>
    samples.length > 0 &&
    samples.every((s) => {
      const extras = extrasIndex.get(`${collection}:${s.stableId.trim()}`);
      const kept = extras?.[column.trim()];
      return typeof kept === "string" && kept.trim() === s.value.trim();
    });

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
      // A column the mapping matrix calls directly mapped but the importer did
      // not bind is an importer omission, not a missing mapping.
      const samples = (col.samples ?? []).slice(0, 5);
      const collection = sheet.kind ? COLLECTION_FOR_KIND[sheet.kind] : sheet.sheet;
      const preserved = preservedVerbatim(collection, col.column, samples);
      const rootCause = explained
        ? `documented_${mapped!.classification}`
        : preserved
          ? "documented_verbatim_preservation_in_ods_extras"
          : col.collidedWith
            ? "duplicate_header_collision_importer_defect"
            : mapped
              ? "importer_omission_alias_missing"
              : "missing_mapping_no_farmops_destination";
      const evidence = samples.length
        ? ` Affected workbook rows: ${samples.map((s) => `${s.stableId || "(no id)"}="${s.value}"`).join(", ")}${
            col.populatedRows && col.populatedRows > samples.length
              ? ` (+${col.populatedRows - samples.length} more)`
              : ""
          }.`
        : "";
      push({
        domain: collection,
        stable_id: `${sheet.sheet}:${col.column}`,
        field: col.column,
        label: col.column,
        ods_worksheet: sheet.sheet,
        ods_column: col.column,
        ods_value: samples.length
          ? samples.map((s) => s.value).join(" | ")
          : "(populated column)",
        farmops_entity: preserved
          ? `${collection}.${ODS_EXTRAS_FIELD}["${col.column.trim()}"]`
          : (mapped?.farmops ?? null),
        farmops_field: preserved ? ODS_EXTRAS_FIELD : null,
        farmops_value: preserved ? samples.map((s) => s.value).join(" | ") : "",
        authority: "engineering_design",
        classification: explained || preserved ? "EXPECTED_TRANSFORMATION" : "LOSS",
        rules: preserved ? ["verbatim_preservation"] : [],
        root_cause: rootCause,
        note:
          (explained
            ? `Mapping ${mapped!.classification}: ${mapped!.transformation}`
            : preserved
              ? `Canonical column with no dedicated FarmOps field: preserved verbatim in ${collection}.${ODS_EXTRAS_FIELD} under its exact workbook header. No engineering value is dropped and nothing is written back to the workbook.`
              : col.collidedWith
                ? `Two workbook headers mean ${col.collidedWith}; this one bound to nothing. Importer defect — give the column its own destination or preserve it verbatim.`
                : mapped
                  ? `The mapping matrix maps this column to ${mapped.farmops}, but the importer bound no column — add the header alias.`
                  : "Populated workbook column has no FarmOps destination in the mapping matrix.") +
          evidence,
      });
    }

  }

  // Every FarmOps stable ID, so an ODS-only record can be explained by an
  // identity/worksheet mismatch instead of being reported as simply missing.
  const farmopsIndex = new Map<string, string>();
  for (const kind of Object.keys(ENTITIES) as ElectricalEntityKind[]) {
    const collection = COLLECTION_FOR_KIND[kind];
    for (const rec of snapshot[collection] ?? []) {
      const id = String(rec["stable_id"] ?? "").trim();
      if (id) farmopsIndex.set(id.toUpperCase(), collection);
    }
  }
  /** CON-### is the canonical raceway identity; EMT-### is legacy compatibility. */
  const legacyVariants = (id: string): string[] => {
    const m = id.toUpperCase().match(/^(CON|EMT)-(\d+)$/);
    if (!m) return [];
    return m[1] === "CON" ? [`EMT-${m[2]}`] : [`CON-${m[2]}`];
  };

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
      const elsewhere = farmopsIndex.get(id.toUpperCase());
      const legacy = legacyVariants(id).find((v) => farmopsIndex.has(v));
      const rootCause = elsewhere
        ? "identity_present_in_other_collection"
        : legacy
          ? "legacy_stable_id_equivalence"
          : "record_not_populated_in_farmops";
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
        farmops_value: legacy ?? "",
        authority: "structural",
        classification: legacy ? "EXPECTED_TRANSFORMATION" : "ODS_ONLY",
        rules: legacy ? ["relational_fk_from_text"] : [],
        root_cause: rootCause,
        disposition: elsewhere ? "CORRECT_MAPPING" : undefined,
        note: elsewhere
          ? `The same stable ID exists in FarmOps as ${elsewhere}: the worksheet classification or entity mapping is wrong, the record is not missing.`
          : legacy
            ? `Present in FarmOps under the pre-existing legacy identifier ${legacy}; CON-### stays canonical and no record is renamed.`
            : "Workbook record has not been populated in FarmOps.",
      });
    }
    for (const [id] of fpRows) {
      if (!id || odsRows.has(id)) continue;
      const native = FARMOPS_NATIVE_KINDS.has(kind);
      const asBuilt = native || AS_BUILT_KINDS.has(kind);
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
        classification: asBuilt ? "FARMOPS_AS_BUILT_ADDITION" : "FARMOPS_ONLY",
        rules: [],
        farmops_only_category: native ? "B" : asBuilt ? "A" : "E",
        root_cause: native
          ? "farmops_native_infrastructure_entity"
          : asBuilt
            ? "field_installed_after_design_release"
            : "farmops_record_without_workbook_counterpart",
        note: native
          ? `FarmOps-native ${def.singular}: infrastructure/planning entity with no canonical workbook counterpart. It is not added to the ODS and does not indicate loss.`
          : asBuilt
            ? "Field-installed record created after the canonical design release."
            : "FarmOps record with no workbook counterpart — engineering decision required.",
      });
    }


    for (const [id, odsRow] of odsRows) {
      const rec = fpRows.get(id);
      if (!rec) continue;

      for (const field of def.fields) {
        if (field.kind === "entity" || !allowed.has(field.key)) continue;
        // The lossless-capture column is evidence about other columns, not a
        // canonical field of its own: comparing it would double-report.
        if (field.key === ODS_EXTRAS_FIELD) continue;
        const own = ownership[field.key] ?? "engineering_design";
        const odsNorm = normalizeValue(field, odsRow.values[field.key]);
        const fpNorm = normalizeValue(field, rec[field.key]);
        const bothAbsent = odsNorm.value === null && fpNorm.value === null;
        // A workbook "TBD" against a blank FarmOps cell is still reportable:
        // unknown is a state, not an absence.
        if (bothAbsent && !odsNorm.tbd) continue;

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

        // Tri-state semantics: TBD is never equal to blank, false, true or 0,
        // and is never resolved by the validator.
        if (odsNorm.tbd) {
          push(
            {
              ...base,
              classification: "INCOMPLETE",
              tbd: true,
              root_cause: "tbd_engineering_state_in_workbook",
              note:
                fpNorm.value === null
                  ? 'The workbook states "to be determined"; FarmOps holds no value. Unknown is preserved as unknown.'
                  : `The workbook states "to be determined" while FarmOps holds ${fpText}. Only an engineer may decide this.`,
            },
            field,
          );
          continue;
        }

        if (sameNormalized(odsNorm.value, fpNorm.value)) {
          const identical = odsText === fpText;
          push(
            {
              ...base,
              classification: identical ? "MATCH" : "EXPECTED_TRANSFORMATION",
              root_cause: identical ? "identical_value" : "documented_normalization",
              note: identical
                ? "Same engineering value."
                : `Same meaning after normalization (${rules.join(", ") || "representation"}).`,
            },
            field,
          );
          continue;
        }

        if (odsNorm.value === null) {
          const asBuiltField = own === "farmops_as_built";
          const category: FarmOpsOnlyCategory = asBuiltField
            ? "A"
            : looksLikeDefaultArtifact(field, fpNorm.value)
              ? "C"
              : matrixCoversColumn(def.table, field.key)
                ? "E"
                : "B";
          push(
            {
              ...base,
              classification: asBuiltField ? "FARMOPS_AS_BUILT_ADDITION" : "FARMOPS_ONLY",
              farmops_only_category: category,
              root_cause: asBuiltField
                ? "as_built_observation_no_design_counterpart"
                : category === "C"
                  ? "importer_or_column_default_artifact"
                  : category === "B"
                    ? "schema_enrichment_beyond_workbook"
                    : "farmops_value_where_workbook_is_blank",
              note: `${FARMOPS_ONLY_CATEGORIES[category]}: ${
                asBuiltField
                  ? "field/as-built value with no design counterpart in the workbook."
                  : category === "C"
                    ? "value equals the column default, so it carries no engineering meaning."
                    : category === "B"
                      ? "FarmOps models information the workbook does not express."
                      : "FarmOps holds a value the workbook leaves blank — engineering review required."
              }`,
            },
            field,
          );
          continue;
        }

        if (fpNorm.value === null) {
          push(
            {
              ...base,
              classification: own === "farmops_as_built" ? "INCOMPLETE" : "ODS_ONLY",
              root_cause:
                own === "farmops_as_built"
                  ? "field_observation_not_captured_yet"
                  : "workbook_value_not_imported",
              note:
                own === "farmops_as_built"
                  ? "Field value not captured yet; the model can represent it."
                  : "Workbook value is not populated in FarmOps.",
            },
            field,
          );
          continue;
        }

        // Both sides hold a value and they disagree.
        if (own === "farmops_as_built") {
          push(
            {
              ...base,
              classification: "FARMOPS_AS_BUILT_ADDITION",
              farmops_only_category: "A",
              root_cause: "as_built_observation_against_design_value",
              note: "As-built observation recorded against a design value — not a conflict.",
            },
            field,
          );
          continue;
        }
        push(
          {
            ...base,
            classification: "CONFLICT",
            root_cause: DERIVED_FIELDS.has(field.key)
              ? "derived_value_recomputation_difference"
              : field.kind === "bool"
                ? "boolean_or_default_semantics"
                : "design_value_disagreement",
            note: "Both systems hold a value for the same engineering concept and they disagree.",
          },
          field,
        );
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
            farmops_only_category: "A",
            root_cause: "relationship_established_in_the_field",
            note: "Relationship established in FarmOps with no workbook equivalent.",
          });
          continue;
        }
        if (!fpStable) {
          const resolvable = farmopsIndex.has(odsText.toUpperCase());
          push({
            ...base,
            classification: "INCOMPLETE",
            root_cause: resolvable
              ? "relationship_not_established_yet"
              : "unresolved_reference_text_not_a_stable_id",
            note: resolvable
              ? `Workbook reference "${odsText}" names an existing FarmOps record but the relationship is not established yet.`
              : `Workbook reference "${odsText}" is descriptive text, not a stable identifier. It is preserved verbatim and never guessed at.`,
          });
          continue;
        }
        const same = sameNormalized(
          normalizeValue(TEXT_FIELD, odsText).value,
          normalizeValue(TEXT_FIELD, fpStable).value,
        );
        if (same) {
          push({
            ...base,
            classification: "EXPECTED_TRANSFORMATION",
            root_cause: "documented_normalization",
            note: "Workbook reference text represented as a normalized relationship.",
          });
          continue;
        }
        const odsResolvable = farmopsIndex.has(odsText.toUpperCase());
        push({
          ...base,
          classification: odsResolvable ? "CONFLICT" : "INCOMPLETE",
          root_cause: odsResolvable
            ? "relationship_points_at_a_different_record"
            : "unresolved_reference_text_not_a_stable_id",
          note: odsResolvable
            ? "Workbook reference and the FarmOps relationship point at different records."
            : `Workbook reference "${odsText}" is descriptive text; the FarmOps relationship resolves to ${fpStable}. Preserved for engineering review.`,
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
      push({
        ...base,
        classification: "MATCH",
        root_cause: "identical_membership_set",
        note: "Same membership set, row order ignored.",
      });
    } else if (!b.length) {
      push({
        ...base,
        classification: "INCOMPLETE",
        root_cause: "relationship_not_established_yet",
        note: "Membership not resolved in FarmOps yet.",
      });
    } else if (!a.length) {
      push({
        ...base,
        classification: "FARMOPS_ONLY",
        farmops_only_category: "E",
        root_cause: "farmops_grouping_without_workbook_grouping",
        note: "FarmOps group membership with no workbook grouping — engineering decision required.",
      });
    } else {
      push({
        ...base,
        classification: "CONFLICT",
        root_cause: "membership_set_disagreement",
        note: `Circuit-group membership differs: workbook has ${a.length} member(s), FarmOps ${b.length}.`,
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
        farmops_only_category: "A",
        root_cause: "physical_model_without_workbook_design_table",
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
  const byRootCause: Record<string, number> = {};
  const byDisposition = {} as Record<Disposition, number>;
  for (const d of DISPOSITIONS) byDisposition[d] = 0;
  const byCategory = {} as Record<FarmOpsOnlyCategory, number>;
  for (const c of Object.keys(FARMOPS_ONLY_CATEGORIES) as FarmOpsOnlyCategory[]) byCategory[c] = 0;

  let unexplained = 0;
  let unexplainedOdsOnly = 0;
  for (const r of records) {
    summary[r.classification]++;
    byDomain[r.domain] = byDomain[r.domain] ?? emptySummary();
    byDomain[r.domain][r.classification]++;
    if (r.classification === "FARMOPS_AS_BUILT_ADDITION") {
      asBuilt[r.domain] = (asBuilt[r.domain] ?? 0) + 1;
    }
    byRootCause[r.root_cause] = (byRootCause[r.root_cause] ?? 0) + 1;
    byDisposition[r.disposition]++;
    if (r.farmops_only_category) byCategory[r.farmops_only_category]++;
    if (r.root_cause === "unclassified") {
      unexplained++;
      if (r.classification === "ODS_ONLY") unexplainedOdsOnly++;
    }
  }

  // Every finding that is not accepted needs a human disposition. The gate
  // never passes by reclassifying a difference into something benign.
  const openDispositions = records.filter((r) => r.disposition !== "ACCEPTED").length;
  const reasons: string[] = [];
  if (summary.LOSS > 0) reasons.push(`${summary.LOSS} LOSS finding(s) must reach zero.`);
  if (unexplainedOdsOnly > 0) {
    reasons.push(`${unexplainedOdsOnly} ODS-only finding(s) have no root cause.`);
  }
  if (unexplained > 0) reasons.push(`${unexplained} finding(s) are unexplained.`);

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
      snapshot_sha256: input.snapshotSha256 ?? null,
    },
    summary,
    by_domain: Object.fromEntries(Object.keys(byDomain).sort().map((k) => [k, byDomain[k]!])),
    as_built_additions_by_entity: Object.fromEntries(
      Object.keys(asBuilt).sort().map((k) => [k, asBuilt[k]!]),
    ),
    by_root_cause: Object.fromEntries(Object.keys(byRootCause).sort().map((k) => [k, byRootCause[k]!])),
    by_disposition: byDisposition,
    farmops_only_by_category: byCategory,
    gate: {
      loss: summary.LOSS,
      unexplained_ods_only: unexplainedOdsOnly,
      unexplained,
      open_dispositions: openDispositions,
      status: reasons.length === 0 ? "PASS" : "FAIL",
      reasons,
    },
    records,
  };
}


/* ------------------------------------------------------------------ exports */

/** Deterministic JSON, suitable for external validation. */
export function serializeValidationReport(report: ValidationReport): string {
  return JSON.stringify(report, null, 2);
}

export function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const CSV_COLUMNS: { header: string; get: (r: ComparisonRecord) => string }[] = [
  { header: "domain", get: (r) => r.domain },
  { header: "stable_id", get: (r) => r.stable_id },
  { header: "field", get: (r) => r.field },
  { header: "label", get: (r) => r.label },
  { header: "ods_worksheet", get: (r) => r.ods_worksheet ?? "" },
  { header: "ods_column", get: (r) => r.ods_column ?? "" },
  { header: "ods_value", get: (r) => r.ods_value },
  { header: "farmops_entity", get: (r) => r.farmops_entity ?? "" },
  { header: "farmops_field", get: (r) => r.farmops_field ?? "" },
  { header: "farmops_value", get: (r) => r.farmops_value },
  { header: "authority", get: (r) => r.authority },
  { header: "authority_class", get: (r) => r.authority_class },
  { header: "classification", get: (r) => r.classification },
  { header: "disposition", get: (r) => r.disposition },
  { header: "root_cause", get: (r) => r.root_cause },
  { header: "farmops_only_category", get: (r) => r.farmops_only_category ?? "" },
  { header: "tbd", get: (r) => (r.tbd ? "true" : "false") },
  { header: "rules", get: (r) => r.rules.join(";") },
  { header: "note", get: (r) => r.note },
];

export function recordsToCsv(records: ComparisonRecord[]): string {
  const header = CSV_COLUMNS.map((c) => c.header).join(",");
  const lines = records.map((r) => CSV_COLUMNS.map((c) => csvCell(c.get(r))).join(","));
  return [header, ...lines].join("\n");
}

export function validationCsv(report: ValidationReport): string {
  return recordsToCsv(report.records);
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
    `- FarmOps snapshot SHA-256: ${report.farmops.snapshot_sha256 ?? "(not computed)"}`,
    `- Compared at: ${report.compared_at}`,
    `- SOR authority: ${report.sor_authority} (FarmOps role: ${report.farmops_role})`,
    `- Acceptance gate: ${report.gate.status}${report.gate.reasons.length ? ` — ${report.gate.reasons.join(" ")}` : ""}`,
    "",
    "## Summary",
    "",
  ];
  for (const c of CLASSIFICATIONS) out.push(`- ${CLASSIFICATION_LABELS[c]}: ${report.summary[c]}`);
  out.push("", "## Dispositions", "");
  for (const d of DISPOSITIONS) out.push(`- ${d}: ${report.by_disposition[d]}`);
  out.push("", "## FarmOps-only categories", "");
  for (const c of Object.keys(FARMOPS_ONLY_CATEGORIES) as FarmOpsOnlyCategory[]) {
    out.push(`- ${c} — ${FARMOPS_ONLY_CATEGORIES[c]}: ${report.farmops_only_by_category[c]}`);
  }
  out.push(
    "",
    "## Differences",
    "",
    "| Domain | Stable ID | Field | ODS | FarmOps | Authority | Classification | Disposition | Root cause | Note |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const r of report.records) {
    if (r.classification === "MATCH") continue;
    out.push(
      `| ${r.domain} | ${r.stable_id} | ${r.label} | ${r.ods_value || "(blank)"} | ${r.farmops_value || "(blank)"} | ${r.authority_class} | ${r.classification} | ${r.disposition} | ${r.root_cause} | ${r.note.replace(/\|/g, "\\|")} |`,
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
