/**
 * Field-by-field comparison of FarmOps Loads against the canonical
 * Load_Master worksheet.
 *
 * This module is read-only by design: it produces a report, never a write
 * plan. FarmOps is not the authority for engineering values, so a mismatch is
 * something a human reviews and releases through the ODS import — with the
 * single exception of Grid, which has its own targeted correction path.
 */
import { ENTITIES, coerceValue, type EntityField } from "@/lib/electrical-entities";
import { classifyGrid } from "@/lib/electrical-grid";

/** Status/label/notes are FarmOps field-work columns, not ODS-owned. */
export const FARMOPS_OWNED_LOAD_FIELDS = new Set([
  "install_status",
  "label_status",
  "notes",
]);

/** Load columns the canonical workbook owns, in display order. */
export function odsOwnedLoadFields(): EntityField[] {
  return ENTITIES.load.fields.filter(
    (f) => f.kind !== "entity" && !FARMOPS_OWNED_LOAD_FIELDS.has(f.key),
  );
}

export type CompareVerdict =
  | "match"
  | "mismatch"
  | "farmops_blank"
  | "ods_blank"
  | "invalid_ods_value";

export interface CompareCell {
  loadId: string;
  field: string;
  label: string;
  engineering: boolean;
  ods: string;
  farmops: string;
  verdict: CompareVerdict;
  reason?: string;
}

export interface LoadCompareReport {
  odsRowCount: number;
  farmOpsRowCount: number;
  comparedFields: string[];
  /** Load IDs present in the workbook but not in FarmOps. */
  missingInFarmOps: string[];
  /** Load IDs present in FarmOps but absent from the workbook. */
  missingInOds: string[];
  /** Load IDs the workbook lists more than once. */
  duplicateOdsIds: string[];
  cells: CompareCell[];
  counts: Record<CompareVerdict, number>;
}

export interface CompletionCorrection {
  load_id: string;
  completion_percent: number;
}

function show(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v).trim();
}

/** Compare two already-coerced values of the same field. */
function sameValue(field: EntityField, a: unknown, b: unknown): boolean {
  if (field.kind === "bool") return Boolean(a) === Boolean(b);
  if (field.kind === "number") {
    const na = a === null || a === undefined || a === "" ? null : Number(a);
    const nb = b === null || b === undefined || b === "" ? null : Number(b);
    if (na === null || nb === null) return na === nb;
    if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
    return Math.abs(na - nb) < 0.005;
  }
  return show(a).toLowerCase() === show(b).toLowerCase();
}

export interface OdsLoadRow {
  stableId: string;
  values: Record<string, string>;
}

/**
 * Build the comparison report. `odsRows` are the mapped Load_Master rows (raw
 * cell text, keyed by FarmOps column), `dbRows` the current FarmOps records.
 */
export function compareLoads(
  odsRows: OdsLoadRow[],
  dbRows: Record<string, unknown>[],
): LoadCompareReport {
  const fields = odsOwnedLoadFields();
  const db: Record<string, Record<string, unknown>> = {};
  for (const r of dbRows) db[String(r["load_id"] ?? "").trim()] = r;

  const seen = new Set<string>();
  const duplicateOdsIds: string[] = [];
  const missingInFarmOps: string[] = [];
  const cells: CompareCell[] = [];
  const counts: Record<CompareVerdict, number> = {
    match: 0,
    mismatch: 0,
    farmops_blank: 0,
    ods_blank: 0,
    invalid_ods_value: 0,
  };

  for (const row of odsRows) {
    const id = row.stableId.trim();
    if (!id) continue;
    if (seen.has(id)) {
      if (!duplicateOdsIds.includes(id)) duplicateOdsIds.push(id);
      continue;
    }
    seen.add(id);
    const current = db[id];
    if (!current) {
      missingInFarmOps.push(id);
      continue;
    }

    for (const field of fields) {
      const rawOds = row.values[field.key];
      const hasOds = rawOds !== undefined && String(rawOds).trim() !== "";

      // Grid gets the convention validator so a drifted cell is reported as an
      // invalid workbook value instead of a mismatch to copy in.
      let reason: string | undefined;
      let odsValue: unknown = null;
      if (hasOds) {
        if (field.key === "grid") {
          const g = classifyGrid(rawOds);
          if (g.status === "invalid") {
            reason = g.reason;
            odsValue = null;
          } else {
            odsValue = g.value;
          }
        } else {
          odsValue = coerceValue(field, rawOds);
        }
      }

      const mine = current[field.key];
      const odsText = hasOds ? String(rawOds).trim() : "";
      const mineText = show(mine);

      let verdict: CompareVerdict;
      if (hasOds && reason) verdict = "invalid_ods_value";
      else if (!hasOds && field.kind !== "bool") {
        verdict = mineText ? "ods_blank" : "match";
      } else if (sameValue(field, odsValue, mine)) verdict = "match";
      else if (!mineText || (field.kind === "number" && mine === null)) {
        verdict = "farmops_blank";
      } else verdict = "mismatch";

      counts[verdict]++;
      if (verdict === "match") continue;
      cells.push({
        loadId: id,
        field: field.key,
        label: field.label,
        engineering: Boolean(field.engineering),
        ods: odsText,
        farmops: mineText,
        verdict,
        reason,
      });
    }
  }

  const missingInOds = Object.keys(db)
    .filter((id) => id && !seen.has(id))
    .sort();

  return {
    odsRowCount: seen.size,
    farmOpsRowCount: Object.keys(db).filter(Boolean).length,
    comparedFields: fields.map((f) => f.key),
    missingInFarmOps: missingInFarmOps.sort(),
    missingInOds,
    duplicateOdsIds: duplicateOdsIds.sort(),
    cells,
    counts,
  };
}

/**
 * Extract only reviewed, nonblank Complete % differences from a comparison.
 * Workbook blanks and invalid values are deliberately excluded: applying this
 * list can never erase a stored percentage or touch another Load field.
 */
export function completionCorrectionsFromReport(
  report: LoadCompareReport,
): CompletionCorrection[] {
  const out: CompletionCorrection[] = [];
  for (const cell of report.cells) {
    if (cell.field !== "completion_percent") continue;
    if (cell.verdict !== "mismatch" && cell.verdict !== "farmops_blank") continue;
    const value = coerceValue(
      ENTITIES.load.fields.find((field) => field.key === "completion_percent") as EntityField,
      cell.ods,
    );
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    out.push({ load_id: cell.loadId, completion_percent: value });
  }
  return out;
}

const CSV_HEADER = "load_id,field,label,ods_owned,ods_value,farmops_value,verdict,reason";

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function loadCompareCsv(report: LoadCompareReport): string {
  const lines = [CSV_HEADER];
  for (const c of report.cells) {
    lines.push(
      [
        c.loadId,
        c.field,
        c.label,
        c.engineering ? "engineering" : "descriptive",
        c.ods,
        c.farmops,
        c.verdict,
        c.reason ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  for (const id of report.missingInFarmOps) {
    lines.push([id, "", "", "", "", "", "missing_in_farmops", ""].map(csvCell).join(","));
  }
  for (const id of report.missingInOds) {
    lines.push([id, "", "", "", "", "", "missing_in_ods", ""].map(csvCell).join(","));
  }
  for (const id of report.duplicateOdsIds) {
    lines.push([id, "", "", "", "", "", "duplicate_in_ods", ""].map(csvCell).join(","));
  }
  return lines.join("\n");
}

export function loadCompareMarkdown(report: LoadCompareReport): string {
  const out: string[] = [
    "# Load_Master field-by-field comparison",
    "",
    `- Loads in workbook: ${report.odsRowCount}`,
    `- Loads in FarmOps: ${report.farmOpsRowCount}`,
    `- Fields compared: ${report.comparedFields.length}`,
    `- Mismatches: ${report.counts.mismatch}`,
    `- FarmOps blank where workbook has a value: ${report.counts.farmops_blank}`,
    `- Workbook blank where FarmOps has a value: ${report.counts.ods_blank}`,
    `- Invalid workbook values: ${report.counts.invalid_ods_value}`,
    `- Missing in FarmOps: ${report.missingInFarmOps.join(", ") || "none"}`,
    `- Missing in workbook: ${report.missingInOds.join(", ") || "none"}`,
    `- Duplicated in workbook: ${report.duplicateOdsIds.join(", ") || "none"}`,
    "",
    "| Load ID | Field | Owner | Load_Master | FarmOps | Verdict | Reason |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const c of report.cells) {
    out.push(
      `| ${c.loadId} | ${c.label} | ${c.engineering ? "engineering" : "descriptive"} | ${c.ods || "(blank)"} | ${c.farmops || "(blank)"} | ${c.verdict} | ${c.reason ?? ""} |`,
    );
  }
  out.push("", "Nothing in this report is written back automatically.");
  return out.join("\n");
}
