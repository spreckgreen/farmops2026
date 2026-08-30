// Pure ODS (OpenDocument Spreadsheet) parsing + classification for the
// electrical import. No DOM, no Node built-ins: this runs in the Worker and in
// tests. Unzipping lives in electrical-ods.functions.ts (fflate).
//
// The canonical ODS stays the engineering release authority: this import is
// always a reviewable dry run first, and it never destructively merges raceway
// segments — merges are proposed, never applied automatically.
import {
  ODS_EXTRAS_FIELD,
  ODS_EXTRAS_SOURCE_KEY,
  odsExtrasEntryKey,
  type ElectricalEntityKind,
  type OdsExtrasSource,
} from "@/lib/electrical";
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

interface ScannedElement {
  attrs: string;
  inner: string;
  start: number;
}

/**
 * Scan same-level XML elements by tag name. A hand-rolled scanner rather than
 * one regex: a single pattern with a `/>|>` alternation backtracks on
 * self-closing tags and swallows the following sibling, which is exactly how
 * empty ODS cells used to shift every later column to the left.
 */
function scanElements(xml: string, tag: string): ScannedElement[] {
  const out: ScannedElement[] = [];
  const open = new RegExp(`<${tag}\\b([^>]*?)(/?)>`, "g");
  const closeTag = `</${tag}>`;
  let m: RegExpExecArray | null;
  while ((m = open.exec(xml))) {
    const start = m.index;
    if (m[2] === "/") {
      out.push({ attrs: m[1], inner: "", start });
      continue;
    }
    // Walk forward honouring nesting of the same tag.
    let depth = 1;
    let cursor = open.lastIndex;
    const contentStart = cursor;
    while (depth > 0) {
      const nextClose = xml.indexOf(closeTag, cursor);
      if (nextClose < 0) break;
      const nextOpen = new RegExp(`<${tag}\\b([^>]*?)(/?)>`, "g");
      nextOpen.lastIndex = cursor;
      const nested = nextOpen.exec(xml);
      if (nested && nested.index < nextClose && nested[2] !== "/") {
        depth++;
        cursor = nextOpen.lastIndex;
        continue;
      }
      depth--;
      cursor = nextClose + closeTag.length;
      if (depth === 0) {
        out.push({ attrs: m[1], inner: xml.slice(contentStart, nextClose), start });
        open.lastIndex = cursor;
      }
    }
    if (depth > 0) break;
  }
  return out;
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

    for (const { attrs: rowAttrs, inner: rowBody } of scanElements(body, "table:table-row")) {
      const rowRepeat = Math.min(Number(attr(rowAttrs, "table:number-rows-repeated") ?? "1") || 1, 1000);
      const cells: string[] = [];

      // Cell annotations (comments) also contain <text:p>; they are not cell
      // values and must never become one.
      const cleanBody = rowBody.replace(
        /<office:annotation\b[\s\S]*?<\/office:annotation>/g,
        "",
      );
      for (const cell of [
        ...scanElements(cleanBody, "table:table-cell"),
        ...scanElements(cleanBody, "table:covered-table-cell"),
      ].sort((a, b) => a.start - b.start)) {
        const repeat = Math.min(
          Number(attr(cell.attrs, "table:number-columns-repeated") ?? "1") || 1,
          1000,
        );
        const value = cell.inner
          ? cellText(cell.inner)
          : (attr(cell.attrs, "office:value") ?? "");
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
  panel: ["panel id", "panel_id", "bus rating", "spaces", "panels", "feeder source", "fed from", "main breaker"],
  feeder: ["feeder id", "feeder_id", "feeders", "feeder", "ocp", "ampacity"],
  raceway: ["conduit id", "conduit_id", "trade size", "raceway"],
  jbox: ["jbox", "j-box", "junction box"],
  branch: ["branch id", "branch_id", "wiring method"],
  // FarmOps-native infrastructure: never imported from the canonical workbook,
  // so no worksheet is ever classified as one of these.
  rack: [],
  power_asset: [],
  device: [],
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
      return Boolean(n) && isKnownHeader(n);
    }).length;

    if (score > best.score) best = { idx: i, score };
  }
  if (best.score >= 2) return best.idx;
  for (let i = 0; i < limit; i++) {
    if (rows[i].filter((c) => c.trim()).length >= 2) return i;
  }
  return -1;
}

/**
 * Worksheets that are workbook structure — metadata, drop-down lists, legends,
 * instructions — not electrical entities. Fuzzy header hints previously read
 * `Design_Lists` as panels and `Workbook_Info` as feeders, which would turn
 * workbook metadata into engineering records. They are recognised by name and
 * excluded from entity classification entirely; their populated values are
 * preserved as workbook metadata instead.
 */
const NON_ENTITY_SHEET_PATTERNS: RegExp[] = [
  /^workbook[_\s-]*info$/i,
  /^design[_\s-]*lists?$/i,
  /(^|[_\s-])(info|metadata|lists?|legend|lookup|lookups|notes|readme|instructions|revision|revisions|changelog|cover|toc|index|validation)$/i,
];

export function isNonEntitySheet(name: string): boolean {
  const n = name.trim();
  return NON_ENTITY_SHEET_PATTERNS.some((re) => re.test(n));
}

export function classifySheet(sheet: Sheet): ElectricalEntityKind | null {
  if (isNonEntitySheet(sheet.name)) return null;
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
  columns: { source: string; target: string | null; scale?: number; collidedWith?: string }[];
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
 * Per-sheet aliases, tried before the shared table. The shared table is tuned
 * for Conduit_Runs / Load_Master, where headers such as "Source", "Circuits" or
 * "Description" mean something different than they do on the Panels sheet — the
 * reason panel description/building/grid/rating columns previously bound to
 * nothing and stayed NULL.
 */
const KIND_ALIASES: Partial<Record<ElectricalEntityKind, Record<string, string>>> = {
  load: {
    // Phase 4.4a: canonical Load_Master columns that previously bound to
    // nothing and were reported as semantic LOSS.
    "equipment / model": "equipment_model",
    "equipment model": "equipment_model",
    equipment: "equipment_model",
    model: "equipment_model",
    "equipment description": "equipment_model",
    "source / reference": "source_reference",
    "source reference": "source_reference",
    "source ref": "source_reference",
    reference: "source_reference",
    ref: "source_reference",
    "suggested panel": "suggested_panel",
    "panel suggestion": "suggested_panel",
    "proposed panel": "suggested_panel",
    "d/s": "dedicated_shared",
    "d s": "dedicated_shared",
    ds: "dedicated_shared",
    "dedicated / shared": "dedicated_shared",
    "dedicated shared": "dedicated_shared",
    "connected kva": "connected_va",
    kva: "connected_va",
    "connected load kva": "connected_va",
    "connected va": "connected_va",
    critical: "critical",
    future: "future",
    "continuous load": "continuous_load",
    continuous: "continuous_load",
    "backup eligible": "backup_eligible",
    "backup priority": "backup_priority",
    "load shed group": "load_shed_group",
    dedicated: "dedicated",
    "dedicated circuit": "dedicated",
    phase: "phase",
    "load count": "count",
    qty: "count",
    quantity: "count",
    "backup panel": "backup_panel",
    "generator panel": "backup_panel",
    notes: "notes",
    remarks: "notes",
    comments: "notes",
    status: "install_status",
    "install status": "install_status",
  },

  // Phase 4.4a: the canonical Feeders / Conduit_Runs / J-Box / Branch /
  // Circuit_Groups worksheets previously relied on the shared alias table
  // alone, so sheet-specific engineering headers bound to nothing and were
  // reported as semantic LOSS. These per-sheet aliases are the importer fix.
  feeder: {
    "feeder id": "feeder_id",
    feeder: "feeder_id",
    "feeder tag": "feeder_id",
    description: "description",
    "feeder description": "description",
    from: "source_endpoint_ref",
    "from panel": "source_endpoint_ref",
    "source panel": "source_endpoint_ref",
    source: "source_endpoint_ref",
    to: "dest_endpoint_ref",
    "to panel": "dest_endpoint_ref",
    "fed panel": "dest_endpoint_ref",
    destination: "dest_endpoint_ref",
    "serves panel": "dest_endpoint_ref",
    "conduit id": "raceway_ref",
    raceway: "raceway_ref",
    "raceway id": "raceway_ref",
    "service type": "service_type",
    service: "service_type",
    "conductor material": "conductor_material",
    material: "conductor_material",
    "conductor size": "conductor_size",
    "wire size": "conductor_size",
    awg: "conductor_size",
    "conductor count": "conductor_count",
    conductors: "conductor_count",
    neutral: "neutral_conductor",
    "neutral conductor": "neutral_conductor",
    ground: "ground_conductor",
    "ground conductor": "ground_conductor",
    egc: "ground_conductor",
    "equipment grounding conductor": "ground_conductor",
    voltage: "voltage",
    volts: "voltage",
    phase: "phase",
    ampacity: "ampacity_amps",
    "conductor ampacity": "ampacity_amps",
    "ampacity amps": "ampacity_amps",
    ocp: "ocp_rating_amps",
    "ocp rating": "ocp_rating_amps",
    "ocp amps": "ocp_rating_amps",
    "overcurrent rating": "ocp_rating_amps",
    breaker: "ocp_rating_amps",
    "breaker size": "ocp_rating_amps",
    "ocp type": "ocp_type",
    "overcurrent device": "ocp_type",
    "demand basis": "demand_basis",
    "demand va": "demand_va",
    "length ft": "planned_length_ft",
    length: "planned_length_ft",
    "planned length": "planned_length_ft",
    "measured length": "measured_length_ft",
    "backup class": "backup_class",
    "generator class": "backup_class",
    critical: "critical",
    future: "future",
    status: "install_status",
    "install status": "install_status",
    notes: "notes",
    remarks: "notes",
    comments: "notes",
  },

  raceway: {
    "conduit id": "conduit_id",
    conduit: "conduit_id",
    "raceway id": "conduit_id",
    description: "description",
    "run description": "description",
    "route group": "route_group",
    "raceway type": "raceway_type",
    "conduit type": "raceway_type",
    type: "raceway_type",
    "source building": "source_building",
    "destination building": "dest_building",
    "dest building": "dest_building",
    "source grid": "source_grid",
    "destination grid": "dest_grid",
    "dest grid": "dest_grid",
    "exit order": "exit_order",
    "exit side": "exit_side",
    "exit position": "exit_side",
    "exit notes": "exit_notes",
    "circuit refs": "circuit_refs",
    "conductor refs": "circuit_refs",
    circuits: "circuit_refs",
    spare: "spare",
    "spare capacity": "spare",
    reserve: "spare",
  },

  jbox: {
    "jbox id": "jbox_id",
    "j box id": "jbox_id",
    "junction box id": "jbox_id",
    jbox: "jbox_id",
    "junction box": "jbox_id",
    description: "description",
    building: "building",
    "building location": "building",
    location: "building",
    grid: "grid",
    "grid ref": "grid",
    "elevation zone": "elevation_zone",
    elevation: "elevation_zone",
    zone: "elevation_zone",
    "box type": "box_type",
    type: "box_type",
    dimensions: "dimensions",
    size: "dimensions",
    "box size": "dimensions",
    status: "install_status",
    "install status": "install_status",
    notes: "notes",
    remarks: "notes",
    comments: "notes",
  },

  branch: {
    "branch id": "branch_id",
    branch: "branch_id",
    "branch circuit id": "branch_id",
    from: "source_endpoint_ref",
    "from panel": "source_endpoint_ref",
    source: "source_endpoint_ref",
    to: "dest_endpoint_ref",
    "to load": "dest_endpoint_ref",
    destination: "dest_endpoint_ref",
    load: "dest_endpoint_ref",
    "load id": "dest_endpoint_ref",
    "wiring method": "wiring_method",
    method: "wiring_method",
    "cable type": "cable_type",
    cable: "cable_type",
    "conductor type": "cable_type",
    "conductor size": "conductor_size",
    "wire size": "conductor_size",
    awg: "conductor_size",
    "conductor count": "conductor_count",
    conductors: "conductor_count",
    ground: "ground_conductor",
    "ground conductor": "ground_conductor",
    egc: "ground_conductor",
    voltage: "voltage",
    volts: "voltage",
    "circuit rating": "circuit_rating_amps",
    "circuit rating amps": "circuit_rating_amps",
    breaker: "circuit_rating_amps",
    "breaker size": "circuit_rating_amps",
    amps: "circuit_rating_amps",
    "length ft": "planned_length_ft",
    length: "planned_length_ft",
    "planned length": "planned_length_ft",
    "measured length": "measured_length_ft",
    "path notes": "path_notes",
    "grid path": "path_notes",
    routing: "path_notes",
    status: "install_status",
    "install status": "install_status",
    notes: "notes",
    remarks: "notes",
    comments: "notes",
  },

  circuit_group: {
    "circuit group id": "circuit_group_id",
    "circuit group": "circuit_group_id",
    "circuit id": "circuit_group_id",
    "circuit group description": "description",
    description: "description",
    serves: "description",
    "suggested panel": "suggested_panel",
    "proposed panel": "suggested_panel",
    panel: "suggested_panel",
    "breaker number": "breaker_number",
    breaker: "breaker_number",
    "breaker no": "breaker_number",
    "circuit number": "breaker_number",
    "breaker position": "breaker_position",
    position: "breaker_position",
    "circuit rating": "circuit_rating_amps",
    "circuit rating amps": "circuit_rating_amps",
    "breaker size": "circuit_rating_amps",
    amps: "circuit_rating_amps",
    voltage: "voltage",
    volts: "voltage",
    phase: "phase",
    "demand basis": "demand_basis",
    "demand va": "demand_va",
    "continuous load": "continuous_load",
    continuous: "continuous_load",
    critical: "critical",
    "backup eligible": "backup_eligible",
    "backup priority": "backup_priority",
    "backup panel": "backup_panel",
    "load shed group": "load_shed_group",
    "generator start class": "generator_start_class",
    "generator start amps": "generator_start_amps",
    status: "install_status",
    "install status": "install_status",
    notes: "notes",
    remarks: "notes",
    comments: "notes",
  },



  panel: {
    panel: "panel_id",
    "panel id": "panel_id",
    "panel name": "panel_id",
    "panel tag": "panel_id",
    "panel description": "description",
    description: "description",
    "panel desc": "description",
    desc: "description",
    "serves": "description",
    building: "building",
    bldg: "building",
    "building location": "building",
    location: "building",
    "panel location": "building",
    room: "building",
    grid: "grid",
    "grid ref": "grid",
    "grid reference": "grid",
    "grid location": "grid",
    "grid coord": "grid",
    "grid coordinate": "grid",
    "grid cell": "grid",
    "bus rating": "bus_rating_amps",
    "bus rating amps": "bus_rating_amps",
    "bus rating a": "bus_rating_amps",
    "bus amps": "bus_rating_amps",
    bus: "bus_rating_amps",
    "main rating": "bus_rating_amps",
    "main breaker": "bus_rating_amps",
    "main breaker amps": "bus_rating_amps",
    "main breaker a": "bus_rating_amps",
    mcb: "bus_rating_amps",
    "panel rating": "bus_rating_amps",
    "rating amps": "bus_rating_amps",
    "rating a": "bus_rating_amps",
    "amp rating": "bus_rating_amps",
    ampacity: "bus_rating_amps",
    amps: "bus_rating_amps",
    voltage: "voltage",
    volts: "voltage",
    v: "voltage",
    "nominal voltage": "voltage",
    "system voltage": "voltage",
    phase: "phase",
    ph: "phase",
    phasing: "phase",
    "phase wire": "phase",
    "phase config": "phase",
    "phase configuration": "phase",
    wires: "phase",
    spaces: "spaces",
    "spaces available": "spaces",
    "space count": "spaces",
    poles: "spaces",
    "pole spaces": "spaces",
    circuits: "circuits",
    "circuit count": "circuits",
    "number of circuits": "circuits",
    "max circuits": "circuits",
    "circuit positions": "circuits",
    "feeder source": "feeder_source",
    "feeder": "feeder_source",
    "feeder from": "feeder_source",
    "fed from": "feeder_source",
    "fed by": "feeder_source",
    source: "feeder_source",
    "source panel": "feeder_source",
    "upstream panel": "feeder_source",
    "upstream source": "feeder_source",
    "supply source": "feeder_source",
    "backup class": "backup_class",
    "generator class": "backup_class",
    "backup generator class": "backup_class",
    status: "install_status",
    "install status": "install_status",
    notes: "notes",
    comments: "notes",
    remarks: "notes",
  },
};

function aliasFor(kind: ElectricalEntityKind | null, header: string): string | undefined {
  return (kind ? KIND_ALIASES[kind]?.[header] : undefined) ?? COLUMN_ALIASES[header];
}

/** Every header this importer recognises, for header-row detection. */
function isKnownHeader(header: string): boolean {
  if (header in COLUMN_ALIASES) return true;
  return Object.values(KIND_ALIASES).some((m) => m && header in m);
}


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
  // Header text that occurs more than once on this worksheet. Preserved values
  // from such columns are keyed with their column number so one duplicate never
  // silently overwrites the other.
  const headerCounts = new Map<string, number>();
  for (const h of header) {
    const n = norm(h);
    if (n) headerCounts.set(n, (headerCounts.get(n) ?? 0) + 1);
  }
  const duplicateHeaders = new Set(
    [...headerCounts.entries()].filter(([, n]) => n > 1).map(([h]) => h),
  );
  const used = new Set<string>();
  const columns = header.map((source) => {
    const n = norm(source).replace(/\s*\(.*\)\s*$/, "");
    const alias = aliasFor(kind, n);
    const target =
      (alias && targets.includes(alias) ? alias : null) ??
      targets.find((t) => norm(t) === n) ??
      targets.find((t) => norm(t).replace(/ (ft|a|va)$/, "") === n) ??
      null;
    // The lossless-capture column is never bound to a worksheet header: the
    // importer fills it from the columns that bind to nothing.
    if (target === ODS_EXTRAS_FIELD) return { source, target: null };
    if (!target) return { source, target: null };
    // Two headers meaning the same FarmOps column: the first wins, and the
    // second is reported as a collision rather than vanishing silently. Its
    // values are still preserved verbatim in the lossless-capture column.
    if (used.has(target)) return { source, target: null, collidedWith: target };
    used.add(target);
    // A kVA-headed column feeding a VA column is scaled once, here, so the
    // stored engineering value keeps the canonical magnitude.
    const scale = /\bkva\b/.test(n) && target.endsWith("_va") ? 1000 : undefined;
    return { source, target, scale };
  });


  const rows: MappedRow[] = [];
  const rejected: RejectedCell[] = [];
  let skipped = 0;
  for (let i = headerRow + 1; i < sheet.rows.length; i++) {
    const raw = sheet.rows[i];
    if (!raw.some((c) => c.trim())) continue;
    const values: Record<string, string> = {};
    // Phase 4.4a: canonical columns with no dedicated FarmOps field are kept
    // verbatim under their exact workbook header instead of being dropped, with
    // the worksheet/header/column recorded so the value's canonical meaning is
    // recoverable and duplicate header text cannot overwrite itself.
    const extras: Record<string, string> = {};
    const extrasSource: Record<string, OdsExtrasSource> = {};
    // One worksheet column, preserved verbatim under a collision-safe key.
    // A column is keyed with its worksheet column number whenever its header
    // text repeats on the sheet *or* it collided with a column already bound to
    // the same FarmOps field, so two different headers meaning the same thing
    // can never collapse onto one bare-header key.
    const preserve = (idx: number, value: string, collided: boolean) => {
      const source = (columns[idx]?.source ?? "").trim();
      const header = source || `(unnamed column ${idx + 1})`;
      const key = odsExtrasEntryKey(
        header,
        idx,
        collided || duplicateHeaders.has(norm(header)),
      );
      extras[key] = value;
      extrasSource[key] = { sheet: sheet.name, header, column: idx + 1 };
    };
    const scaledColumns: { idx: number; column: string; value: string }[] = [];
    columns.forEach((col, idx) => {
      const v = (raw[idx] ?? "").trim();
      if (!v) return;
      if (!col.target) {
        preserve(idx, v, Boolean(col.collidedWith));
        return;
      }
      if (col.scale) {
        const n = Number(v.replace(/,/g, "").replace(/[^0-9.\-]/g, ""));
        if (Number.isFinite(n)) {
          values[col.target] = String(n * col.scale);
          // The stored engineering magnitude is a transformation of the
          // canonical cell, so the original text is preserved verbatim too.
          scaledColumns.push({ idx, column: col.target, value: v });
          return;
        }
      }
      values[col.target] = v;
    });
    for (const s of scaledColumns) preserve(s.idx, s.value, false);

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
    if (Object.keys(extras).length && targets.includes(ODS_EXTRAS_FIELD)) {
      const sorted = Object.keys(extras).sort();
      values[ODS_EXTRAS_FIELD] = JSON.stringify({
        ...Object.fromEntries(sorted.map((k) => [k, extras[k]!])),
        [ODS_EXTRAS_SOURCE_KEY]: Object.fromEntries(sorted.map((k) => [k, extrasSource[k]!])),
      });
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
