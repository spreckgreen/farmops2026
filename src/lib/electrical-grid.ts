// Grid coordinate convention + validation for electrical records.
//
// Grid is an ODS engineering-owned value: FarmOps displays it, imports it from
// the canonical Load_Master "Grid" column by header name, and never invents a
// value. Anything that is not a legitimate grid coordinate, area token or
// explicit unknown marker is rejected rather than stored, because column drift
// during import used to leak percents, notes and ratings into this field.
//
// Convention (never drifts): letters are rows, numbers are columns, A6 is the
// Farm Shop northeast corner. Half-bay positions such as G5.5 are legitimate.

/** Farm Shop / building grid coordinate, e.g. A6, G5.5, E1 (via FS46). */
const GRID_RE = /^([A-Z])\s*-?\s*(\d{1,2}(?:\.5)?)$/;
/** Optional trailing provenance annotation the workbook uses: "(via FS46)". */
const VIA_RE = /^\(\s*(?:via\s+)?[A-Z0-9][A-Z0-9\-. ]{0,20}\)$/;

/** Non-grid area tokens the canonical workbook legitimately uses. */
export const GRID_AREA_TOKENS = [
  "PH",
  "GH",
  "BL",
  "HOUSE",
  "HS",
  "SHOP",
  "YARD",
  "SITE",
  "MOBILE",
  "PORTABLE",
] as const;

/** Explicit "not known yet" markers that must be preserved verbatim. */
export const GRID_UNKNOWN_TOKENS = ["NA", "N/A", "TBD", "?", "TBD?"] as const;

export type GridStatus = "grid" | "area" | "unknown" | "blank" | "invalid";

export interface GridClassification {
  status: GridStatus;
  /** Canonical value to store (null = blank). */
  value: string | null;
  /** Why an invalid value was rejected. */
  reason?: string;
}

function invalidReason(t: string): string {
  if (t.includes("%")) return "percent value in Grid (column drift)";
  if (/^[-+]?\d+(\.\d+)?$/.test(t)) return "bare number is not a grid coordinate";
  if (/\d\s*(A|AMP|AMPS|V|VOLT|VOLTS|VA|W|KW|KVA|HP)\b/.test(t))
    return "electrical rating in Grid (column drift)";
  if (t.length > 24 || t.split(/\s+/).length > 4) return "descriptive text in Grid (column drift)";
  return "does not match the grid coordinate convention";
}

/**
 * Classify a raw Grid cell. Blank stays blank, TBD/NA stay as written, and
 * junk is rejected with a reason instead of being stored.
 */
export function classifyGrid(raw: unknown): GridClassification {
  const t = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!t) return { status: "blank", value: null };
  const upper = t.toUpperCase();

  if ((GRID_UNKNOWN_TOKENS as readonly string[]).includes(upper))
    return { status: "unknown", value: upper };

  // "E1 (via FS46)" — coordinate plus a provenance annotation.
  const paren = /^(.*?)\s*(\([^)]*\))$/.exec(upper);
  if (paren && VIA_RE.test(paren[2])) {
    const head = classifyGrid(paren[1]);
    if (head.status === "grid" || head.status === "area")
      return { status: head.status, value: `${head.value} ${paren[2]}` };
    return { status: "invalid", value: null, reason: invalidReason(upper) };
  }

  const m = GRID_RE.exec(upper);
  if (m) return { status: "grid", value: `${m[1]}${m[2]}` };

  if ((GRID_AREA_TOKENS as readonly string[]).includes(upper))
    return { status: "area", value: upper };

  return { status: "invalid", value: null, reason: invalidReason(upper) };
}

export function isValidGrid(raw: unknown): boolean {
  return classifyGrid(raw).status !== "invalid";
}

// --------------------------------------------------------------- audit report

export interface GridAuditRow {
  load_id: string;
  /** Grid from the canonical ODS Load_Master, when a workbook was supplied. */
  ods_grid: string | null;
  previous_grid: string | null;
  corrected_grid: string | null;
  /** ok = keep as-is, correct = write corrected value, clear = blank the junk. */
  action: "ok" | "correct" | "clear" | "unresolved";
  status: GridStatus;
  reason: string | null;
}

export interface GridAudit {
  rows: GridAuditRow[];
  summary: { total: number; ok: number; correct: number; clear: number; unresolved: number };
}

/**
 * Compare FarmOps Grid against the canonical ODS Grid (when available).
 * Conservative: never copies a neighbouring value, never guesses a coordinate,
 * and only proposes clearing values that cannot be a grid at all.
 */
export function buildGridAudit(
  loads: { load_id: string; grid: string | null }[],
  odsGrid: Record<string, string | null> = {},
): GridAudit {
  const rows: GridAuditRow[] = [];
  for (const load of [...loads].sort((a, b) => a.load_id.localeCompare(b.load_id))) {
    const prev = (load.grid ?? "").trim() || null;
    const hasOds = Object.prototype.hasOwnProperty.call(odsGrid, load.load_id);
    const odsRaw = hasOds ? ((odsGrid[load.load_id] ?? "").trim() || null) : null;
    const ods = hasOds ? classifyGrid(odsRaw) : null;
    const current = classifyGrid(prev);

    if (ods && ods.status !== "invalid") {
      const corrected = ods.value;
      rows.push({
        load_id: load.load_id,
        ods_grid: odsRaw,
        previous_grid: prev,
        corrected_grid: corrected,
        action: corrected === prev ? "ok" : "correct",
        status: ods.status,
        reason: corrected === prev ? null : "set from canonical ODS Grid",
      });
      continue;
    }

    if (ods && ods.status === "invalid") {
      rows.push({
        load_id: load.load_id,
        ods_grid: odsRaw,
        previous_grid: prev,
        corrected_grid: null,
        action: "unresolved",
        status: "invalid",
        reason: `canonical ODS Grid is invalid: ${ods.reason}`,
      });
      continue;
    }

    if (current.status === "invalid") {
      rows.push({
        load_id: load.load_id,
        ods_grid: null,
        previous_grid: prev,
        corrected_grid: null,
        action: "clear",
        status: "invalid",
        reason: current.reason ?? null,
      });
      continue;
    }

    rows.push({
      load_id: load.load_id,
      ods_grid: odsRaw,
      previous_grid: prev,
      corrected_grid: current.value,
      action: current.value === prev ? "ok" : "correct",
      status: current.status,
      reason: current.value === prev ? null : "normalised existing value",
    });
  }

  const count = (a: GridAuditRow["action"]) => rows.filter((r) => r.action === a).length;
  return {
    rows,
    summary: {
      total: rows.length,
      ok: count("ok"),
      correct: count("correct"),
      clear: count("clear"),
      unresolved: count("unresolved"),
    },
  };
}

export function gridAuditCsv(audit: GridAudit): string {
  const esc = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const lines = ["Load ID,ODS Grid,Previous FarmOps Grid,Corrected FarmOps Grid,Action,Status,Reason"];
  for (const r of audit.rows) {
    lines.push(
      [
        esc(r.load_id),
        esc(r.ods_grid),
        esc(r.previous_grid),
        esc(r.corrected_grid),
        esc(r.action),
        esc(r.status),
        esc(r.reason),
      ].join(","),
    );
  }
  return lines.join("\n");
}
