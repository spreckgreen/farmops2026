// Printable field labels for every electrical entity, not just panels.
//
// Pure module: which fields a label carries, how the QR URL is formed, how a
// batch is ordered, and which records a print scope selects. No I/O, no writes.
//
// Ordering rule (all kinds, matching the released load sheet): first by panel,
// then by Farm Shop walk order of the record's grid, then alphabetically by
// stable ID. Ordering is print sequence only — it never affects stable IDs.
import { farmShopWalkOrder, type ElectricalEntityKind } from "@/lib/electrical";
import { ENTITIES } from "@/lib/electrical-entities";
import type { LabelLine } from "@/lib/electrical-panel-access";

export type LabelKind = ElectricalEntityKind;

/** Every kind that can be printed as a label, in tab order. */
export const LABEL_KINDS: LabelKind[] = [
  "panel",
  "raceway",
  "jbox",
  "branch",
  "load",
  "circuit_group",
  "feeder",
  "rack",
  "power_asset",
  "device",
];

export interface LabelFieldSpec {
  key: string;
  label: string;
  /** Suffix appended when the value is present, e.g. " A". */
  unit?: string;
  /** Carried onto the shortened (Avery 8593) label. */
  short?: boolean;
}

/**
 * What each label prints under (or beside) the QR code. Deliberately short:
 * only what an electrician reads while standing at the thing.
 */
export const LABEL_FIELDS: Record<LabelKind, LabelFieldSpec[]> = {
  panel: [
    { key: "description", label: "Description", short: true },
    { key: "building", label: "Building" },
    { key: "grid", label: "Grid" },
    { key: "feeder_source", label: "Fed from" },
    { key: "bus_rating_amps", label: "Main / bus", unit: " A" },
    { key: "voltage", label: "Voltage", unit: " V" },
    { key: "phase", label: "Phase" },
    { key: "spaces", label: "Spaces" },
  ],
  raceway: [
    { key: "description", label: "Description", short: true },
    { key: "from_label", label: "From", short: true },
    { key: "to_label", label: "To", short: true },
    { key: "raceway_type", label: "Type" },
    { key: "trade_size", label: "Trade size", short: true },
    { key: "route_group", label: "Route group" },
    { key: "environment", label: "Environment" },
  ],
  jbox: [
    { key: "description", label: "Description", short: true },
    { key: "building", label: "Building" },
    { key: "grid", label: "Grid", short: true },
    { key: "box_type", label: "Box type" },
    { key: "raceway_ref", label: "On raceway", short: true },
    { key: "raceway_sequence", label: "Position" },
  ],
  branch: [
    { key: "source_endpoint_ref", label: "From", short: true },
    { key: "dest_endpoint_ref", label: "To", short: true },
    { key: "circuit_rating_amps", label: "OCP", unit: " A", short: true },
    { key: "voltage", label: "Voltage", unit: " V" },
    { key: "wiring_method", label: "Method" },
    { key: "conductor_size", label: "Conductor", short: true },
  ],
  load: [
    { key: "description", label: "Load", short: true },
    { key: "area", label: "Area", short: true },
    { key: "grid", label: "Grid", short: true },
    { key: "suggested_panel", label: "Panel" },
    { key: "circuit_group_ref", label: "Circuit", short: true },
    { key: "source_circuit", label: "Source circuit" },
    { key: "amps", label: "Amps", unit: " A" },
    { key: "volts", label: "Volts", unit: " V" },
  ],
  circuit_group: [
    { key: "description", label: "Description", short: true },
    { key: "suggested_panel", label: "Panel", short: true },
    { key: "breaker_number", label: "Breaker", short: true },
    { key: "circuit_rating_amps", label: "Rating", unit: " A", short: true },
    { key: "voltage", label: "Voltage", unit: " V" },
    { key: "phase", label: "Phase" },
  ],
  feeder: [
    { key: "description", label: "Description", short: true },
    { key: "source_endpoint_ref", label: "From", short: true },
    { key: "dest_endpoint_ref", label: "To", short: true },
    { key: "raceway_ref", label: "Raceway" },
  ],
  rack: [
    { key: "description", label: "Description", short: true },
    { key: "rack_role", label: "Role", short: true },
    { key: "site_area", label: "Site" },
    { key: "building", label: "Building", short: true },
    { key: "location_note", label: "Location" },
    { key: "rack_size_u", label: "Size", unit: " U" },
  ],
  power_asset: [
    { key: "description", label: "Description", short: true },
    { key: "asset_type", label: "Type", short: true },
    { key: "rack_ref", label: "In rack", short: true },
    { key: "output_voltage", label: "Output", unit: " V" },
    { key: "output_current_amps", label: "Output", unit: " A" },
    { key: "building", label: "Building" },
  ],
  device: [
    { key: "description", label: "Description", short: true },
    { key: "device_role", label: "Role", short: true },
    { key: "device_type", label: "Type" },
    { key: "rack_ref", label: "In rack", short: true },
    { key: "power_asset_ref", label: "Powered by", short: true },
    { key: "building", label: "Building" },
  ],
};

/**
 * Columns that may hold the panel this record belongs to. Only values that look
 * like a panel stable ID are used; nothing is inferred from anything else.
 * `circuit_group_panel` is derived server-side from the linked circuit group.
 */
export const PANEL_REF_KEYS: Record<LabelKind, string[]> = {
  panel: ["panel_id"],
  raceway: ["source_endpoint_ref", "dest_endpoint_ref"],
  // A junction box records its parent raceway, not a panel — nothing is inferred.
  jbox: [],
  branch: ["source_endpoint_ref"],
  load: ["suggested_panel", "circuit_group_panel"],
  circuit_group: ["suggested_panel"],
  feeder: ["source_endpoint_ref", "dest_endpoint_ref"],
  rack: [],
  power_asset: ["source_panel_ref"],
  device: ["circuit_group_panel"],
};

/** Columns that describe where the record physically is, best first. */
export const LOCATION_KEYS: Record<LabelKind, string[]> = {
  panel: ["building", "grid"],
  raceway: ["route_group", "from_label"],
  jbox: ["building", "grid"],
  branch: ["path_notes"],
  load: ["area", "location", "grid"],
  circuit_group: ["breaker_position"],
  feeder: ["description"],
  rack: ["building", "site_area", "location_note"],
  power_asset: ["building", "location_note"],
  device: ["building"],
};

/** Column holding the grid coordinate used for Farm Shop walk ordering. */
export const GRID_KEYS: Record<LabelKind, string | null> = {
  panel: "grid",
  raceway: null,
  jbox: "grid",
  branch: null,
  load: "grid",
  circuit_group: null,
  feeder: null,
  rack: "grid",
  power_asset: "grid",
  device: null,
};

/** One record as it comes back from the server, ready to print. */
export interface LabelRecord {
  id: string;
  kind: LabelKind;
  stable_id: string;
  values: Record<string, string>;
}

/** Every column the server must read for one kind. */
export function labelColumns(kind: LabelKind): string[] {
  const def = ENTITIES[kind];
  const keys = new Set<string>(["id", def.stableIdField]);
  for (const f of LABEL_FIELDS[kind]) keys.add(f.key);
  for (const k of PANEL_REF_KEYS[kind]) if (k !== "circuit_group_panel") keys.add(k);
  for (const k of LOCATION_KEYS[kind]) keys.add(k);
  const grid = GRID_KEYS[kind];
  if (grid) keys.add(grid);
  if (kind === "load" || kind === "device") keys.add("circuit_group_uuid");
  return [...keys];
}

const PANEL_ID_LIKE = /^PNL[-_]/i;

/** The panel a record belongs to, or "" when it is genuinely unknown. */
export function panelKeyOf(record: LabelRecord): string {
  for (const key of PANEL_REF_KEYS[record.kind]) {
    const v = (record.values[key] ?? "").trim();
    if (v && PANEL_ID_LIKE.test(v)) return v.toUpperCase();
  }
  return "";
}

/** Where the record is, or "" when nothing locational is recorded. */
export function locationKeyOf(record: LabelRecord): string {
  for (const key of LOCATION_KEYS[record.kind]) {
    const v = (record.values[key] ?? "").trim();
    if (v) return v;
  }
  return "";
}

export function gridOf(record: LabelRecord): string {
  const key = GRID_KEYS[record.kind];
  return key ? (record.values[key] ?? "").trim() : "";
}

/** The printed detail lines for one record. */
export function labelLines(record: LabelRecord): LabelLine[] {
  const out: LabelLine[] = [];
  for (const f of LABEL_FIELDS[record.kind]) {
    const raw = (record.values[f.key] ?? "").trim();
    if (!raw) continue;
    out.push({ label: f.label, value: f.unit ? `${raw}${f.unit}` : raw });
  }
  return out;
}

/**
 * The one-line text an Avery 8593 file-folder label can actually hold
 * (2/3" x 3-7/16"): the stable ID plus the few short fields, truncated.
 */
export function shortLabelText(record: LabelRecord, max = 44): string {
  const parts: string[] = [];
  for (const f of LABEL_FIELDS[record.kind]) {
    if (!f.short) continue;
    const raw = (record.values[f.key] ?? "").trim();
    if (raw) parts.push(f.unit ? `${raw}${f.unit}` : raw);
  }
  const text = parts.join(" · ");
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** QR payload for a non-panel record: its detail page. */
export function itemQrUrl(origin: string, kind: LabelKind, id: string): string {
  return `${origin.replace(/\/+$/, "")}/electrical/item/${kind}/${encodeURIComponent(id)}`;
}

/* ------------------------------------------------------------------ ordering */

/**
 * Panel, then Farm Shop walk order, then alphabetical by stable ID. Records
 * with no panel or no grid sort after the ones that have them, never dropped.
 */
export function sortLabelRecords(records: LabelRecord[]): LabelRecord[] {
  const walk = farmShopWalkOrder(records.map(gridOf));
  const walkIndex = new Map(walk.map((g, i) => [g, i]));
  const rank = (r: LabelRecord) => {
    const grid = gridOf(r).toUpperCase();
    const idx = walkIndex.get(grid);
    return idx === undefined ? Number.MAX_SAFE_INTEGER : idx;
  };
  return [...records].sort((a, b) => {
    const pa = panelKeyOf(a);
    const pb = panelKeyOf(b);
    if (pa !== pb) {
      if (!pa) return 1;
      if (!pb) return -1;
      return pa.localeCompare(pb);
    }
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.stable_id.localeCompare(b.stable_id, undefined, { numeric: true });
  });
}

/* -------------------------------------------------------------- print groups */

export interface PrintGroup {
  id: string;
  name: string;
  description: string;
  kinds: LabelKind[];
}

/**
 * A print group is one printing job covering several kinds — the rough-in walk
 * needs the conduit, its boxes, the branch runs pulled through it and the loads
 * they land on, all in one pass.
 */
export const PRINT_GROUPS: PrintGroup[] = [
  {
    id: "rough-in",
    name: "Rough-in walk — conduit, J-box, branch, load",
    description:
      "Every raceway, junction box, branch run and load in one job, each kind printed in panel / walk / ID order.",
    kinds: ["raceway", "jbox", "branch", "load"],
  },
  {
    id: "distribution",
    name: "Distribution — panel, feeder, circuit group",
    description: "Panel doors, feeders and circuit groups for the service walk.",
    kinds: ["panel", "feeder", "circuit_group"],
  },
  {
    id: "infrastructure",
    name: "Infrastructure — rack, power asset, powered device",
    description: "Equipment racks with the power assets and devices installed in them.",
    kinds: ["rack", "power_asset", "device"],
  },
];

/* --------------------------------------------------------------- print scope */

export type LabelScopeMode = "all" | "panel" | "location";

export interface LabelScope {
  mode: LabelScopeMode;
  /** Panel stable ID or location string; ignored when mode is "all". */
  value?: string;
}

export function filterLabelRecords(
  records: LabelRecord[],
  scope: LabelScope,
  search = "",
): LabelRecord[] {
  const q = search.trim().toLowerCase();
  return records.filter((r) => {
    if (scope.mode === "panel" && panelKeyOf(r) !== (scope.value ?? "").toUpperCase()) return false;
    if (scope.mode === "location" && locationKeyOf(r) !== (scope.value ?? "")) return false;
    if (!q) return true;
    return [r.stable_id, ...Object.values(r.values)].some((v) =>
      String(v ?? "").toLowerCase().includes(q),
    );
  });
}

/** Distinct panels present in a record set, alphabetical. */
export function panelOptions(records: LabelRecord[]): string[] {
  return [...new Set(records.map(panelKeyOf).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** Distinct locations present in a record set, alphabetical. */
export function locationOptions(records: LabelRecord[]): string[] {
  return [...new Set(records.map(locationKeyOf).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
