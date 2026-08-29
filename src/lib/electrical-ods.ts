// Pure ODS (OpenDocument Spreadsheet) parsing + classification for the
// electrical import. No DOM, no Node built-ins: this runs in the Worker and in
// tests. Unzipping lives in electrical-ods.functions.ts (fflate).
//
// The canonical ODS stays the engineering release authority: this import is
// always a reviewable dry run first, and it never destructively merges raceway
// segments — merges are proposed, never applied automatically.
import type { ElectricalEntityKind } from "@/lib/electrical";
import { classifyGrid } from "@/lib/electrical-grid";

export type Sheet = { name: string; rows: string[][] };

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`${name}="([^"]*)"`).exec(tag);
  return m ? decodeXmlEntities(m[1]) : null;
}

function cellText(cellXml: string): string {
  const parts: string[] = [];
  const re = /<text:p\b[^>]*>([\s\S]*?)<\/text:p>|<text:p\b[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cellXml))) {
    parts.push(decodeXmlEntities((m[1] ?? "").replace(/<[^>]+>/g, "")));
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Parse the `content.xml` of an .ods file into sheets of string cells. */
export function parseOdsContentXml(xml: string): Sheet[] {
  const sheets: Sheet[] = [];
  const tableRe = /<table:table\b([^>]*)>([\s\S]*?)<\/table:table>/g;
  let t: RegExpExecArray | null;
  while ((t = tableRe.exec(xml))) {
    const name = attr(t[1], "table:name") ?? `Sheet ${sheets.length + 1}`;
    const body = t[2];
    const rows: string[][] = [];

    const rowRe = /<table:table-row\b([^>]*)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g;
    let r: RegExpExecArray | null;
    while ((r = rowRe.exec(body))) {
      const rowRepeat = Math.min(Number(attr(r[1], "table:number-rows-repeated") ?? "1") || 1, 1000);
      const rowBody = r[2] ?? "";
      const cells: string[] = [];

      // Cell annotations (comments) also contain <text:p>; they are not cell
      // values and must never become one.
      const cleanBody = rowBody.replace(
        /<office:annotation\b[\s\S]*?<\/office:annotation>/g,
        "",
      );
      const cellRe =
        /<table:(?:covered-)?table-cell\b([^>]*)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g;
      let c: RegExpExecArray | null;
      while ((c = cellRe.exec(cleanBody))) {
        const repeat = Math.min(
          Number(attr(c[1], "table:number-columns-repeated") ?? "1") || 1,
          1000,
        );
        const value = c[2] ? cellText(c[2]) : (attr(c[1], "office:value") ?? "");
        for (let i = 0; i < repeat; i++) cells.push(value);
      }

      while (cells.length && cells[cells.length - 1] === "") cells.pop();
      for (let i = 0; i < rowRepeat; i++) rows.push([...cells]);
    }

    while (rows.length && rows[rows.length - 1].every((c) => c === "")) rows.pop();
    sheets.push({ name, rows });
  }
  return sheets;
}

// ------------------------------------------------------------ classification

const HEADER_HINTS: Record<ElectricalEntityKind, string[]> = {
  load: ["load id", "load_id", "load description"],
  circuit_group: ["circuit group", "circuit_group_id", "suggested panel"],
  panel: ["panel id", "panel_id", "bus rating", "spaces"],
  raceway: ["conduit id", "conduit_id", "trade size", "raceway"],
  jbox: ["jbox", "j-box", "junction box"],
  branch: ["branch id", "branch_id", "wiring method"],
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s_]+/g, " ").trim();
}

/**
 * Find the header row. A title/subtitle row above the real header would shift
 * every column binding, so a row that actually contains known column names
 * always wins over the "first row with two filled cells" fallback.
 */
export function findHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, 25);
  let best = { idx: -1, score: 0 };
  for (let i = 0; i < limit; i++) {
    const score = rows[i].filter((c) => {
      const n = norm(c).replace(/\s*\(.*\)\s*$/, "");
      return Boolean(n) && n in COLUMN_ALIASES;
    }).length;
    if (score > best.score) best = { idx: i, score };
  }
  if (best.score >= 2) return best.idx;
  for (let i = 0; i < limit; i++) {
    if (rows[i].filter((c) => c.trim()).length >= 2) return i;
  }
  return -1;
}

export function classifySheet(sheet: Sheet): ElectricalEntityKind | null {
  const headerIdx = findHeaderRow(sheet.rows);
  const header = headerIdx >= 0 ? sheet.rows[headerIdx].map(norm) : [];
  const haystack = [norm(sheet.name), ...header].join(" | ");
  let best: { kind: ElectricalEntityKind; score: number } | null = null;
  for (const kind of Object.keys(HEADER_HINTS) as ElectricalEntityKind[]) {
    const score = HEADER_HINTS[kind].filter((h) => haystack.includes(h)).length;
    if (score > 0 && (!best || score > best.score)) best = { kind, score };
  }
  return best?.kind ?? null;
}

export interface MappedRow {
  values: Record<string, string>;
  stableId: string;
  sourceRow: number;
}

export interface RejectedCell {
  sourceRow: number;
  stableId: string;
  column: string;
  value: string;
  reason: string;
}

export interface SheetImport {
  sheet: string;
  kind: ElectricalEntityKind | null;
  headerRow: number;
  columns: { source: string; target: string | null }[];
  rows: MappedRow[];
  skipped: number;
  /** Cells refused because the value cannot belong to that column. */
  rejected: RejectedCell[];
}

/**
 * Explicit header aliases for the canonical workbook. Fuzzy substring matching
 * alone silently mis-binds columns (a "Purpose" column landing in Notes), so
 * these exact aliases are tried first and the loose fallback is only used for
 * headers that already read like the target column name.
 */
const COLUMN_ALIASES: Record<string, string> = {
  // Conduit_Runs
  "conduit id": "conduit_id",
  conduit: "conduit_id",
  "route group": "route_group",
  route: "route_group",
  "run group": "route_group",
  from: "from_label",
  "from location": "from_label",
  source: "from_label",
  to: "to_label",
  "to location": "to_label",
  destination: "to_label",
  purpose: "purpose",
  "conduit purpose": "purpose",
  "service type": "service_type",
  service: "service_type",
  "conduit type": "raceway_type",
  "raceway type": "raceway_type",
  "trade size": "trade_size",
  size: "trade_size",
  "conduit size": "trade_size",
  material: "material",
  "length ft": "planned_length_ft",
  length: "planned_length_ft",
  "planned length": "planned_length_ft",
  "planned length ft": "planned_length_ft",
  "measured length": "measured_length_ft",
  "measured length ft": "measured_length_ft",
  "as built length": "measured_length_ft",
  environment: "environment",
  status: "install_status",
  "install status": "install_status",
  "complete %": "completion_percent",
  "% complete": "completion_percent",
  "complete percent": "completion_percent",
  "percent complete": "completion_percent",
  "completion": "completion_percent",
  "completion %": "completion_percent",
  "completion percent": "completion_percent",
  "pct complete": "completion_percent",
  // Header text like "Complete (%)" normalises to "complete" because the
  // trailing parenthetical is stripped, so the bare forms are aliased too.
  complete: "completion_percent",
  "percent done": "completion_percent",
  "% done": "completion_percent",
  progress: "completion_percent",
  "install complete": "completion_percent",
  "installed percent": "completion_percent",
  "installed %": "completion_percent",
  "install %": "completion_percent",
  notes: "notes",
  comments: "notes",

  "circuit refs": "circuit_refs",
  circuits: "circuit_refs",
  "exit order": "exit_order",
  "exit side": "exit_side",
  // Load_Master
  "load id": "load_id",
  "load description": "description",
  description: "description",
  area: "area",
  grid: "grid",
  "grid ref": "grid",
  "grid reference": "grid",
  "grid location": "grid",
  "grid coord": "grid",
  "grid coordinate": "grid",
  "grid cell": "grid",
  "grid square": "grid",
  location: "location",
  "circuit group id": "circuit_group_ref",
  "circuit group": "circuit_group_ref",
  "circuit group description": "description",
  "source circuit": "source_circuit",
  amps: "amps",
  volts: "volts",
  voltage: "voltage",
  "connected va": "connected_va",
  "demand va": "demand_va",
  "demand basis": "demand_basis",
  count: "count",
  // Panels
  "panel id": "panel_id",
  "bus rating": "bus_rating_amps",
  "bus rating amps": "bus_rating_amps",
  spaces: "spaces",
  building: "building",
};

/**
 * Map a sheet's columns onto entity columns.
 * `targets` is the writable column list for the detected kind.
 */
export function mapSheet(
  sheet: Sheet,
  kind: ElectricalEntityKind | null,
  targets: string[],
  stableIdField: string,
): SheetImport {
  const headerRow = findHeaderRow(sheet.rows);
  if (headerRow < 0 || !kind) {
    return {
      sheet: sheet.name,
      kind,
      headerRow,
      columns: [],
      rows: [],
      skipped: sheet.rows.length,
      rejected: [],
    };
  }
  const header = sheet.rows[headerRow];
  const used = new Set<string>();
  const columns = header.map((source) => {
    const n = norm(source).replace(/\s*\(.*\)\s*$/, "");
    const alias = COLUMN_ALIASES[n];
    const target =
      (alias && targets.includes(alias) ? alias : null) ??
      targets.find((t) => norm(t) === n) ??
      targets.find((t) => norm(t).replace(/ (ft|a|va)$/, "") === n) ??
      null;
    if (!target || used.has(target)) return { source, target: null };
    used.add(target);
    return { source, target };
  });


  const rows: MappedRow[] = [];
  const rejected: RejectedCell[] = [];
  let skipped = 0;
  for (let i = headerRow + 1; i < sheet.rows.length; i++) {
    const raw = sheet.rows[i];
    if (!raw.some((c) => c.trim())) continue;
    const values: Record<string, string> = {};
    columns.forEach((col, idx) => {
      if (!col.target) return;
      const v = (raw[idx] ?? "").trim();
      if (!v) return;
      values[col.target] = v;
    });
    const stableId = (values[stableIdField] ?? "").trim();
    if (!stableId) {
      skipped++;
      continue;
    }
    // Grid is ODS-owned but must still be a grid value: a drifted percent,
    // rating or note is refused instead of stored, and never replaced by a
    // neighbouring cell.
    if (values["grid"] != null) {
      const g = classifyGrid(values["grid"]);
      if (g.status === "invalid") {
        rejected.push({
          sourceRow: i + 1,
          stableId,
          column: "grid",
          value: values["grid"],
          reason: g.reason ?? "invalid grid value",
        });
        delete values["grid"];
      } else if (g.value && g.value !== values["grid"]) {
        values["grid"] = g.value;
      }
    }
    rows.push({ values, stableId, sourceRow: i + 1 });
  }

  return { sheet: sheet.name, kind, headerRow, columns, rows, skipped, rejected };
}

export interface ImportPlanRow extends MappedRow {
  action: "create" | "update" | "unchanged";
  existingId: string | null;
  changes: { column: string; from: string; to: string }[];
  warnings: string[];
}

export interface ImportPlanSheet {
  sheet: string;
  kind: ElectricalEntityKind | null;
  skipped: number;
  unmapped: string[];
  /** Every spreadsheet header that bound to a column, for review. */
  mapping: { source: string; target: string }[];
  rows: ImportPlanRow[];
  /** Proposed raceway merges — reviewed and applied by hand, never automatic. */
  mergeProposals: { conduit_id: string; note: string }[];
  /** Cells refused by column validation, shown in the dry-run review. */
  rejected: RejectedCell[];
}

/** Diff mapped rows against what is already in the database. */
export function buildPlanSheet(
  mapped: SheetImport,
  existing: Record<string, Record<string, unknown>>,
  stableIdField: string,
): ImportPlanSheet {
  const rows: ImportPlanRow[] = mapped.rows.map((row) => {
    const current = existing[row.stableId];
    const warnings: string[] = [];
    if (!current) {
      return { ...row, action: "create", existingId: null, changes: [], warnings };
    }
    const changes: { column: string; from: string; to: string }[] = [];
    for (const [column, to] of Object.entries(row.values)) {
      if (column === stableIdField) continue;
      const from = current[column] == null ? "" : String(current[column]);
      if (from.trim() !== to.trim()) changes.push({ column, from, to });
    }
    const measured = changes.find((c) => c.column === "measured_length_ft");
    if (measured && measured.from) {
      warnings.push("Field-measured length would be overwritten by the ODS value.");
    }
    return {
      ...row,
      action: changes.length ? "update" : "unchanged",
      existingId: String(current["id"] ?? ""),
      changes,
      warnings,
    };
  });

  const mergeProposals: { conduit_id: string; note: string }[] = [];
  if (mapped.kind === "raceway") {
    const seen = new Map<string, string[]>();
    for (const row of mapped.rows) {
      const key = `${row.values["source_endpoint_ref"] ?? ""}->${row.values["dest_endpoint_ref"] ?? ""}`;
      if (!key.trim() || key === "->") continue;
      seen.set(key, [...(seen.get(key) ?? []), row.stableId]);
    }
    for (const [key, ids] of seen) {
      if (ids.length > 1) {
        mergeProposals.push({
          conduit_id: ids.join(", "),
          note: `${ids.length} rows share endpoints ${key} — review whether these are one continuous raceway before merging.`,
        });
      }
    }
  }

  return {
    sheet: mapped.sheet,
    kind: mapped.kind,
    skipped: mapped.skipped,
    unmapped: mapped.columns.filter((c) => c.source.trim() && !c.target).map((c) => c.source),
    mapping: mapped.columns
      .filter((c) => c.target)
      .map((c) => ({ source: c.source, target: c.target as string })),
    rows,
    mergeProposals,
    rejected: mapped.rejected,
  };
}

export function planTotals(sheets: ImportPlanSheet[]) {
  let create = 0;
  let update = 0;
  let unchanged = 0;
  let warnings = 0;
  for (const s of sheets) {
    for (const r of s.rows) {
      if (r.action === "create") create++;
      else if (r.action === "update") update++;
      else unchanged++;
      warnings += r.warnings.length;
    }
  }
  return { create, update, unchanged, warnings };
}
