/**
 * Load_Master field-mapping audit — PREVIEW ONLY.
 *
 * Purpose: prove (or disprove) that the live FarmOps load values are the result
 * of a deterministic import-column mapping defect, rather than of semantics.
 *
 * Authority rules baked into this module:
 * - Field identity comes from the canonical workbook's *physical column
 *   position + exact header text*, never from header text alone and never from
 *   what FarmOps currently contains.
 * - Nothing here writes. Every proposal is a preview row for human release.
 * - Duplicate headers, unnamed-but-populated columns and canonical fields with
 *   no FarmOps home are reported, never silently resolved.
 */
import type { Sheet } from "@/lib/electrical-ods";

export type MappingStatus =
  | "EXACT_MAPPING"
  | "SHIFTED_COLUMN_MAPPING"
  | "DUPLICATE_HEADER_AMBIGUITY"
  | "UNMAPPED_CANONICAL_FIELD"
  | "WRONG_DESTINATION_FIELD"
  | "NORMALIZATION_ONLY"
  | "REQUIRES_REVIEW";

export type MappingConfidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";

/** Canonical Load_Master field identity: exact header text -> semantic field. */
export interface CanonicalLoadField {
  /** Normalized semantic field name (workbook meaning, not FarmOps column). */
  semantic: string;
  /** Exact canonical header spellings, normalized. */
  headers: string[];
  /**
   * The only FarmOps column that may hold this canonical field, or null when
   * the FarmOps load record has no home for it at all.
   */
  destination: string | null;
  /** Verified explicitly by the audit acceptance list. */
  required: boolean;
}

export const CANONICAL_LOAD_FIELDS: CanonicalLoadField[] = [
  { semantic: "load_id", headers: ["load id"], destination: "load_id", required: false },
  { semantic: "description", headers: ["load description", "description"], destination: "description", required: false },
  { semantic: "equipment_model", headers: ["equipment / model", "equipment model", "equipment"], destination: "equipment_model", required: false },
  { semantic: "area", headers: ["area"], destination: "area", required: false },
  { semantic: "grid", headers: ["grid", "grid ref", "grid reference", "grid location"], destination: "grid", required: false },
  { semantic: "location", headers: ["location"], destination: "location", required: false },
  { semantic: "count", headers: ["count", "qty", "quantity", "load count"], destination: "count", required: false },
  { semantic: "volts", headers: ["volts"], destination: "volts", required: false },
  { semantic: "amps", headers: ["amps"], destination: "amps", required: false },
  { semantic: "connected_va", headers: ["connected va", "connected kva"], destination: "connected_va", required: false },
  { semantic: "demand_basis", headers: ["demand basis"], destination: "demand_basis", required: false },
  { semantic: "demand_va", headers: ["demand va"], destination: "demand_va", required: true },
  { semantic: "phase", headers: ["phase"], destination: "phase", required: true },
  { semantic: "critical", headers: ["critical"], destination: "critical", required: true },
  { semantic: "future", headers: ["future"], destination: "future", required: false },
  { semantic: "continuous_load", headers: ["continuous load", "continuous"], destination: "continuous_load", required: true },
  { semantic: "dedicated_shared", headers: ["d/s", "d s", "ds", "dedicated / shared", "dedicated shared"], destination: "dedicated_shared", required: true },
  { semantic: "circuit_group_id", headers: ["circuit group id", "circuit group"], destination: "circuit_group_ref", required: true },
  { semantic: "suggested_panel", headers: ["suggested panel", "proposed panel", "panel suggestion"], destination: "suggested_panel", required: true },
  { semantic: "backup_eligible", headers: ["backup eligible"], destination: "backup_eligible", required: true },
  { semantic: "backup_priority", headers: ["backup priority"], destination: "backup_priority", required: true },
  { semantic: "backup_panel", headers: ["backup panel", "generator panel"], destination: "backup_panel", required: true },
  { semantic: "load_shed_group", headers: ["load shed group"], destination: "load_shed_group", required: true },
  // Load_Master carries these, but the FarmOps *load* record has no column for
  // them (they exist on circuit groups only). Reported, never guessed into a
  // neighbouring column.
  { semantic: "generator_start_class", headers: ["generator start class"], destination: null, required: true },
  { semantic: "generator_start_amps", headers: ["generator start amps"], destination: null, required: true },
  { semantic: "source_circuit", headers: ["source circuit"], destination: "source_circuit", required: false },
  { semantic: "source_reference", headers: ["source / reference", "source reference", "source ref"], destination: "source_reference", required: false },
  { semantic: "install_status", headers: ["status", "install status"], destination: "install_status", required: false },
  { semantic: "completion_percent", headers: ["complete", "complete %", "% complete", "completion %"], destination: "completion_percent", required: false },
  { semantic: "notes", headers: ["notes", "remarks", "comments"], destination: "notes", required: false },
];

/** Canonical fields the audit must state a verdict for, by acceptance list. */
export const REQUIRED_VERIFIED_FIELDS = CANONICAL_LOAD_FIELDS.filter((f) => f.required).map(
  (f) => f.semantic,
);

export function normHeader(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s_]+/g, " ")
    .trim()
    .replace(/\s*\(.*\)\s*$/, "");
}

const HEADER_INDEX = new Map<string, CanonicalLoadField>();
for (const f of CANONICAL_LOAD_FIELDS) {
  for (const h of f.headers) if (!HEADER_INDEX.has(h)) HEADER_INDEX.set(h, f);
}

export function canonicalFieldForHeader(header: string): CanonicalLoadField | null {
  return HEADER_INDEX.get(normHeader(header)) ?? null;
}

/* ------------------------------------------------------------ value compare */

const TRUE_TOKENS = new Set(["y", "yes", "true", "t", "1", "x", "✓"]);
const FALSE_TOKENS = new Set(["n", "no", "false", "f", "0"]);

/** Comparable form of a cell/record value. Never used to *decide* semantics. */
export function comparable(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v).trim();
  if (!s) return "";
  const low = s.toLowerCase();
  if (TRUE_TOKENS.has(low)) return "true";
  if (FALSE_TOKENS.has(low)) return "false";
  const numeric = low.replace(/[,$%]/g, "").replace(/\s+/g, "");
  if (numeric && Number.isFinite(Number(numeric))) {
    const n = Number(numeric);
    return String(Math.round(n * 1000) / 1000);
  }
  return low;
}

/** True when the two values differ only by formatting/typing, not content. */
export function normalizationOnly(ods: unknown, farmops: unknown): boolean {
  const a = String(ods ?? "").trim();
  const b = String(farmops ?? "").trim();
  if (!a || !b) return false;
  return a !== b && comparable(a) === comparable(b);
}

/* ---------------------------------------------------------------- structures */

export interface AuditPhysicalColumn {
  /** 1-based physical column position on the worksheet. */
  physical_column: number;
  /** Exact header text as it appears in the workbook. */
  ods_header: string;
  /** Canonical semantic field for this physical column, or null. */
  semantic_field: string | null;
  /** Where the current importer actually sends this column. */
  farmops_destination: string | null;
  /** Where the canonical field must land. */
  expected_destination: string | null;
  duplicate_header: boolean;
  populated_cells: number;
  sample_ods_values: string[];
  sample_farmops_values: string[];
  status: MappingStatus;
  /**
   * When the FarmOps destination content actually came from a different
   * physical column, this is that column (1-based) and its header.
   */
  content_source_column: number | null;
  content_source_header: string | null;
  match_ratio: number;
  confidence: MappingConfidence;
  finding: string;
}

export interface AuditPreviewRow {
  stable_id: string;
  field: string;
  canonical_value: string;
  current_farmops_value: string;
  proposed_farmops_value: string;
  mapping_defect: MappingStatus;
  confidence: MappingConfidence;
}

export interface LoadMappingAudit {
  sheet: string;
  header_row: number;
  ods_row_count: number;
  farmops_row_count: number;
  columns: AuditPhysicalColumn[];
  /** Canonical fields the acceptance list demands, with their verdict. */
  required_verdicts: { semantic_field: string; status: MappingStatus; finding: string }[];
  duplicate_headers: string[];
  unnamed_populated_columns: number[];
  preview: AuditPreviewRow[];
  /** True when at least one destination is provably fed by the wrong column. */
  deterministic_shift_detected: boolean;
  counts: Record<MappingStatus, number>;
}

export interface AuditInput {
  sheet: Sheet;
  headerRow: number;
  /** Importer column bindings, aligned index-for-index with the header row. */
  importerColumns: { source: string; target: string | null; collidedWith?: string }[];
  /** Data rows: worksheet row index (0-based into sheet.rows) + stable id. */
  odsRows: { sourceRow: number; stableId: string }[];
  /** Current FarmOps load records. */
  dbRows: Record<string, unknown>[];
}

const SAMPLE = 4;

function samples(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    const s = String(v ?? "").trim();
    if (!s || out.includes(s)) continue;
    out.push(s);
    if (out.length >= SAMPLE) break;
  }
  return out;
}

/**
 * Build the audit. Pure: given the parsed worksheet, the importer's own column
 * bindings and the live FarmOps rows, it decides each physical column's status
 * from position + exact header, and proves content provenance by matching
 * FarmOps values row-by-row against every physical column of the same row.
 */
export function auditLoadMasterMapping(input: AuditInput): LoadMappingAudit {
  const { sheet, headerRow, importerColumns, odsRows, dbRows } = input;
  const header = sheet.rows[headerRow] ?? [];
  const width = Math.max(header.length, ...sheet.rows.map((r) => r.length), 0);

  const db = new Map<string, Record<string, unknown>>();
  for (const r of dbRows) {
    const id = String(r["load_id"] ?? "").trim();
    if (id) db.set(id, r);
  }

  // Rows that exist on both sides: the only rows where provenance is provable.
  const paired = odsRows
    .map((r) => ({ ...r, db: db.get(r.stableId.trim()) }))
    .filter((r) => r.stableId && r.db) as {
    sourceRow: number;
    stableId: string;
    db: Record<string, unknown>;
  }[];

  const cell = (rowIdx: number, col0: number): string =>
    String(sheet.rows[rowIdx]?.[col0] ?? "").trim();

  const counts: Record<string, number> = {};
  const headerCounts = new Map<string, number>();
  for (let i = 0; i < width; i++) {
    const n = normHeader(header[i] ?? "");
    if (n) headerCounts.set(n, (headerCounts.get(n) ?? 0) + 1);
  }
  const duplicateHeaders = [...headerCounts.entries()].filter(([, n]) => n > 1).map(([h]) => h);
  const unnamedPopulated: number[] = [];

  const columns: AuditPhysicalColumn[] = [];
  const preview: AuditPreviewRow[] = [];

  for (let i = 0; i < width; i++) {
    const headerText = (header[i] ?? "").trim();
    const canonical = headerText ? canonicalFieldForHeader(headerText) : null;
    const binding = importerColumns[i];
    const destination = binding?.target ?? null;
    const expected = canonical?.destination ?? null;
    const odsValues = paired.map((r) => cell(r.sourceRow, i));
    const populated = odsValues.filter(Boolean).length;
    if (!headerText && populated > 0) unnamedPopulated.push(i + 1);

    // Provenance: which physical column's canonical values actually match the
    // content sitting in this canonical field's FarmOps destination? The
    // column's own position always wins ties, so an incidentally identical
    // neighbour (two columns both holding "1") is never called a shift.
    let contentSource: number | null = null;
    let bestRatio = 0;
    if (expected) {
      const farmVals = paired.map((r) => comparable(r.db[expected]));
      const comparableRows = farmVals.filter((v) => v !== "").length;
      const ratioFor = (j: number) => {
        let hits = 0;
        for (let k = 0; k < paired.length; k++) {
          if (farmVals[k] === "") continue;
          if (farmVals[k] === comparable(cell(paired[k].sourceRow, j))) hits++;
        }
        return hits / comparableRows;
      };
      if (comparableRows > 0) {
        bestRatio = ratioFor(i);
        contentSource = i;
        for (let j = 0; j < width; j++) {
          if (j === i) continue;
          const ratio = ratioFor(j);
          if (ratio > bestRatio) {
            bestRatio = ratio;
            contentSource = j;
          }
        }
      }
    }

    const normalizedHeader = normHeader(headerText);
    const isDuplicate = Boolean(normalizedHeader) && duplicateHeaders.includes(normalizedHeader);

    let status: MappingStatus;
    let confidence: MappingConfidence = "MEDIUM";
    let finding: string;

    if (!headerText) {
      status = populated > 0 ? "REQUIRES_REVIEW" : "NORMALIZATION_ONLY";
      confidence = populated > 0 ? "LOW" : "NONE";
      finding =
        populated > 0
          ? `Unnamed but populated physical column ${i + 1}; identity cannot be established from the workbook header.`
          : "Empty, unnamed column. No canonical field, no data.";
      if (populated === 0) status = "REQUIRES_REVIEW";
    } else if (!canonical) {
      status = "REQUIRES_REVIEW";
      confidence = "LOW";
      finding = `Header "${headerText}" is not in the canonical Load_Master field identity list; ${
        destination ? `importer sends it to ${destination}.` : "importer binds it to nothing."
      }`;
    } else if (isDuplicate) {
      status = "DUPLICATE_HEADER_AMBIGUITY";
      confidence = "LOW";
      finding = `Header "${headerText}" occurs ${headerCounts.get(normalizedHeader)}× on this worksheet; field identity cannot come from header text alone.`;
    } else if (!expected) {
      status = "UNMAPPED_CANONICAL_FIELD";
      confidence = "NONE";
      finding = `Canonical field ${canonical.semantic} has no FarmOps load column. Values exist in the workbook (${populated} populated row(s)) and are not represented.`;
    } else if (!destination) {
      status = "UNMAPPED_CANONICAL_FIELD";
      confidence = populated > 0 ? "HIGH" : "MEDIUM";
      finding = `Importer binds this column to nothing; canonical ${canonical.semantic} should land in ${expected}.`;
    } else if (destination !== expected) {
      status = "WRONG_DESTINATION_FIELD";
      confidence = "HIGH";
      finding = `Importer sends canonical ${canonical.semantic} to ${destination}; it belongs in ${expected}.`;
    } else if (contentSource !== null && contentSource !== i && bestRatio >= 0.7) {
      status = "SHIFTED_COLUMN_MAPPING";
      confidence = bestRatio >= 0.9 ? "HIGH" : "MEDIUM";
      finding = `FarmOps ${expected} matches physical column ${contentSource + 1} ("${(header[contentSource] ?? "").trim() || "unnamed"}") on ${Math.round(bestRatio * 100)}% of comparable rows, not column ${i + 1}.`;
    } else if (populated > 0 && paired.every((r) => comparable(r.db[expected]) === "")) {
      status = "REQUIRES_REVIEW";
      confidence = "HIGH";
      finding = `Workbook has ${populated} populated value(s) but FarmOps ${expected} is empty on every compared row: values were dropped on import.`;
    } else {
      const normOnly = paired.some((r) =>
        normalizationOnly(cell(r.sourceRow, i), r.db[expected] as unknown),
      );
      const allEqual = paired.every(
        (r) => comparable(cell(r.sourceRow, i)) === comparable(r.db[expected]),
      );
      if (allEqual && normOnly) {
        status = "NORMALIZATION_ONLY";
        confidence = "HIGH";
        finding = `Content agrees; representation differs (booleans/percent/number formatting) between workbook and ${expected}.`;
      } else if (allEqual) {
        status = "EXACT_MAPPING";
        confidence = "HIGH";
        finding = `Column ${i + 1} -> ${expected} verified on ${paired.length} compared row(s).`;
      } else {
        status = "REQUIRES_REVIEW";
        confidence = "MEDIUM";
        finding = `Destination is correct but values disagree on some rows; not explainable by a single column shift.`;
      }
    }

    counts[status] = (counts[status] ?? 0) + 1;

    columns.push({
      physical_column: i + 1,
      ods_header: headerText,
      semantic_field: canonical?.semantic ?? null,
      farmops_destination: destination ?? binding?.collidedWith ?? null,
      expected_destination: expected,
      duplicate_header: isDuplicate,
      populated_cells: populated,
      sample_ods_values: samples(odsValues),
      sample_farmops_values: expected
        ? samples(paired.map((r) => String(r.db[expected] ?? "")))
        : [],
      status,
      content_source_column: contentSource !== null && contentSource !== i ? contentSource + 1 : null,
      content_source_header:
        contentSource !== null && contentSource !== i
          ? (header[contentSource] ?? "").trim() || null
          : null,
      match_ratio: Math.round(bestRatio * 1000) / 1000,
      confidence,
      finding,
    });

    // Row-level preview for every affected load. Proposals restate the
    // canonical cell for the canonical column — no inference, no coercion of
    // meaning, and nothing is written.
    const defective =
      status === "SHIFTED_COLUMN_MAPPING" ||
      status === "WRONG_DESTINATION_FIELD" ||
      status === "UNMAPPED_CANONICAL_FIELD" ||
      status === "DUPLICATE_HEADER_AMBIGUITY" ||
      (status === "REQUIRES_REVIEW" && Boolean(canonical));
    if (!defective) continue;

    for (const r of paired) {
      const canonicalValue = cell(r.sourceRow, i);
      const currentValue = expected ? String(r.db[expected] ?? "") : "";
      if (!canonicalValue && !currentValue) continue;
      if (comparable(canonicalValue) === comparable(currentValue)) continue;
      preview.push({
        stable_id: r.stableId,
        field: canonical ? canonical.semantic : `physical_column_${i + 1}`,
        canonical_value: canonicalValue || "(blank)",
        current_farmops_value: currentValue || "(blank)",
        proposed_farmops_value: expected
          ? canonicalValue || "(clear to blank)"
          : "NOT REPRESENTABLE — no FarmOps column",
        mapping_defect: status,
        confidence,
      });
    }
  }

  const required_verdicts = REQUIRED_VERIFIED_FIELDS.map((semantic) => {
    const col = columns.find((c) => c.semantic_field === semantic);
    if (!col) {
      return {
        semantic_field: semantic,
        status: "REQUIRES_REVIEW" as MappingStatus,
        finding:
          "No physical column on this worksheet carries this canonical header; field identity unverifiable from this workbook.",
      };
    }
    return { semantic_field: semantic, status: col.status, finding: col.finding };
  });

  const full: Record<MappingStatus, number> = {
    EXACT_MAPPING: 0,
    SHIFTED_COLUMN_MAPPING: 0,
    DUPLICATE_HEADER_AMBIGUITY: 0,
    UNMAPPED_CANONICAL_FIELD: 0,
    WRONG_DESTINATION_FIELD: 0,
    NORMALIZATION_ONLY: 0,
    REQUIRES_REVIEW: 0,
    ...(counts as Record<MappingStatus, number>),
  };

  return {
    sheet: sheet.name,
    header_row: headerRow + 1,
    ods_row_count: odsRows.length,
    farmops_row_count: db.size,
    columns,
    required_verdicts,
    duplicate_headers: duplicateHeaders,
    unnamed_populated_columns: unnamedPopulated,
    preview,
    deterministic_shift_detected:
      full.SHIFTED_COLUMN_MAPPING > 0 || full.WRONG_DESTINATION_FIELD > 0,
    counts: full,
  };
}

/* --------------------------------------------------------------- exports/CSV */

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function mappingAuditColumnsCsv(audit: LoadMappingAudit): string {
  const lines = [
    "physical_column,ods_header,semantic_field,farmops_destination,expected_destination,sample_ods_values,sample_farmops_values,status,content_source_column,match_ratio,confidence,finding",
  ];
  for (const c of audit.columns) {
    lines.push(
      [
        String(c.physical_column),
        c.ods_header,
        c.semantic_field ?? "",
        c.farmops_destination ?? "",
        c.expected_destination ?? "",
        c.sample_ods_values.join(" | "),
        c.sample_farmops_values.join(" | "),
        c.status,
        c.content_source_column ? String(c.content_source_column) : "",
        String(c.match_ratio),
        c.confidence,
        c.finding,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

export function mappingAuditPreviewCsv(audit: LoadMappingAudit): string {
  const lines = [
    "stable_id,field,canonical_value,current_farmops_value,proposed_farmops_value,mapping_defect,confidence",
  ];
  for (const r of audit.preview) {
    lines.push(
      [
        r.stable_id,
        r.field,
        r.canonical_value,
        r.current_farmops_value,
        r.proposed_farmops_value,
        r.mapping_defect,
        r.confidence,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}
