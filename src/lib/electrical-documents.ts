// Pure mapping from a FarmOps Electrical API document bundle to the printable
// models: the Farm Shop electrical sheet, the Avery label set and the grid map.
//
// Everything here is a projection of `GET /api/electrical/v1/documents/bundle`.
// No second query, no fallback data source: if a document shows a value, that
// value came from the API response that produced the version stamp, so a print
// and its version code can never describe different data.
//
// Absent values print NOT IN RECORD. Nothing is inferred — no panel guessed
// from a description, no criticality guessed from amps or VA.
import { ENTITIES } from "@/lib/electrical-entities";
import {
  GRID_KEYS,
  LABEL_FIELDS,
  labelColumns,
  labelWalkGroups,
  sortLabelRecords,
  type LabelKind,
  type LabelRecord,
} from "@/lib/electrical-labels";
import {
  buildGridMapPoints,
  summarizeGridMap,
  type GridMapLoadInput,
  type GridMapPoint,
  type GridMapSummary,
} from "@/lib/electrical-grid-map";
import { COLLECTION_FOR_KIND, type SnapshotQaFinding, type SnapshotRecord } from "@/lib/electrical-snapshot";

export const NOT_IN_RECORD = "NOT IN RECORD";
export const ALL_SCOPE = "ALL";

/** JSON payload shape, so the server function stays provably serializable. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface DocumentBundle {
  schema_version: string;
  generated_at: string;
  manifest: { collection: string; count: number; purpose: string; intended_use: string }[];
  qa: { errors: number; warnings: number; findings: SnapshotQaFinding[] };
  counts: Record<string, number>;
  snapshot: { schema_version: string; generated_at: string } & Record<string, JsonValue>;
  excluded_by_design?: JsonValue;
}

export interface DocScope {
  /** Building / area value, or ALL_SCOPE. */
  building: string;
  /** Panel stable ID, or ALL_SCOPE. */
  panel: string;
}

export const DEFAULT_SCOPE: DocScope = { building: "Farm Shop", panel: ALL_SCOPE };

/* ------------------------------------------------------------------- helpers */

const str = (v: unknown): string => (v == null ? "" : String(v).trim());
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** A record value for printing: real value or the explicit gap marker. */
export function shown(record: SnapshotRecord | undefined, key: string): string {
  if (!record) return NOT_IN_RECORD;
  const v = record[key];
  if (v === null || v === undefined || v === "") return NOT_IN_RECORD;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

export function collection(bundle: DocumentBundle, name: string): SnapshotRecord[] {
  // The API envelope nests record arrays under `collections`; older captured
  // bundles carry them at the top level of the snapshot. Both are read, so a
  // reprint from a saved capture shows the same rows as a live print.
  const nested = (bundle.snapshot as Record<string, JsonValue>)["collections"];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const rows = (nested as Record<string, JsonValue>)[name];
    if (Array.isArray(rows)) return rows as unknown as SnapshotRecord[];
  }
  const rows = bundle.snapshot[name];
  return Array.isArray(rows) ? (rows as unknown as SnapshotRecord[]) : [];
}

/** Panel stable ID for a load, and the evidence for it. Never guessed. */
export function loadPanel(
  load: SnapshotRecord,
  groupsById: Map<string, SnapshotRecord>,
  breakerByLoad: Map<string, SnapshotRecord>,
): { panel: string; basis: string } {
  const group = groupsById.get(str(load["circuit_group_stable_id"]));
  const groupPanel = group ? str(group["panel_stable_id"]) : "";
  if (groupPanel) {
    return {
      panel: groupPanel,
      basis: `Proven: circuit ${str(group?.["stable_id"]) || "group"} → panel.`,
    };
  }
  const pos = breakerByLoad.get(str(load["stable_id"]));
  const posPanel = pos ? str(pos["panel_stable_id"]) : "";
  if (posPanel) return { panel: posPanel, basis: "Proven: breaker position → panel." };
  const suggested = str(load["suggested_panel"]);
  if (suggested) {
    return {
      panel: suggested,
      basis: "Design intent only (Suggested Panel); no proven breaker relationship.",
    };
  }
  return { panel: "", basis: "No proven or suggested panel in the record." };
}

interface BundleIndex {
  groupsById: Map<string, SnapshotRecord>;
  breakerByLoad: Map<string, SnapshotRecord>;
  panelsById: Map<string, SnapshotRecord>;
}

export function indexBundle(bundle: DocumentBundle): BundleIndex {
  const groupsById = new Map<string, SnapshotRecord>();
  for (const g of collection(bundle, "circuit_groups")) {
    const id = str(g["stable_id"]);
    if (id) groupsById.set(id, g);
  }
  const breakerByLoad = new Map<string, SnapshotRecord>();
  for (const p of collection(bundle, "panel_breaker_positions")) {
    const load = str(p["load_stable_id"]);
    if (load && !breakerByLoad.has(load)) breakerByLoad.set(load, p);
  }
  const panelsById = new Map<string, SnapshotRecord>();
  for (const p of collection(bundle, "panels")) {
    const id = str(p["stable_id"]);
    if (id) panelsById.set(id, p);
  }
  return { groupsById, breakerByLoad, panelsById };
}

/** Distinct building/area values present in the bundle, for the scope picker. */
export function buildingOptions(bundle: DocumentBundle): string[] {
  const seen = new Set<string>();
  for (const l of collection(bundle, "loads")) {
    const v = str(l["area"]) || str(l["location"]);
    if (v) seen.add(v);
  }
  for (const p of collection(bundle, "panels")) {
    const v = str(p["building"]);
    if (v) seen.add(v);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function panelOptionsFor(bundle: DocumentBundle, building: string): string[] {
  const seen = new Set<string>();
  for (const p of collection(bundle, "panels")) {
    const id = str(p["stable_id"]);
    if (!id) continue;
    if (building !== ALL_SCOPE && !matchesBuilding(str(p["building"]), building)) continue;
    seen.add(id);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function matchesBuilding(value: string, building: string): boolean {
  if (building === ALL_SCOPE) return true;
  const a = value.toLowerCase();
  const b = building.toLowerCase();
  return a.includes(b) || b.includes(a);
}

export function scopeLabel(scope: DocScope): string {
  const b = scope.building === ALL_SCOPE ? "All buildings" : scope.building;
  const p = scope.panel === ALL_SCOPE ? "all panels" : scope.panel;
  return `${b} / ${p}`;
}

/** Loads inside scope, with their resolved panel attached. */
export function scopedLoads(
  bundle: DocumentBundle,
  scope: DocScope,
): { load: SnapshotRecord; panel: string; panelBasis: string }[] {
  const idx = indexBundle(bundle);
  const out: { load: SnapshotRecord; panel: string; panelBasis: string }[] = [];
  for (const load of collection(bundle, "loads")) {
    const where = `${str(load["area"])} ${str(load["location"])}`;
    if (scope.building !== ALL_SCOPE && !matchesBuilding(where, scope.building)) continue;
    const { panel, basis } = loadPanel(load, idx.groupsById, idx.breakerByLoad);
    if (scope.panel !== ALL_SCOPE && panel !== scope.panel) continue;
    out.push({ load, panel, panelBasis: basis });
  }
  return out;
}

/* -------------------------------------------------------- electrical sheet */

export interface SheetSection {
  heading: string;
  /** Why this section exists / what authority it carries. */
  note?: string;
  columns: string[];
  rows: string[][];
  /** Relative column widths; defaults to equal when omitted. */
  widths?: number[];
}

export interface SheetModel {
  title: string;
  scope: string;
  sections: SheetSection[];
  counts: Record<string, number>;
  /** Records rendered, hashed into the version stamp. */
  digestSource: unknown;
}

/** Empty values sort after populated ones, so gaps never lead a printed table. */
const blankLast = (a: string, b: string): number => {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, undefined, { numeric: true });
};

const gapCount = (rows: string[][]): number =>
  rows.reduce((n, r) => n + r.filter((c) => c === NOT_IN_RECORD).length, 0);

export function buildSheetModel(bundle: DocumentBundle, scope: DocScope): SheetModel {
  const idx = indexBundle(bundle);
  const loads = scopedLoads(bundle, scope);

  const loadRows = loads
    .slice()
    .sort(
      (a, b) =>
        str(a.load["area"]).localeCompare(str(b.load["area"]), undefined, { numeric: true }) ||
        a.panel.localeCompare(b.panel, undefined, { numeric: true }) ||
        blankLast(str(a.load["grid"]), str(b.load["grid"])) ||
        str(a.load["description"]).localeCompare(str(b.load["description"]), undefined, {
          numeric: true,
        }),
    )
    .map(({ load, panel }) => [
      shown(load, "stable_id"),
      shown(load, "grid"),
      shown(load, "description"),
      panel || NOT_IN_RECORD,
      shown(load, "circuit_group_stable_id"),
      shown(load, "volts"),
      shown(load, "amps"),
      shown(load, "connected_va"),
      shown(load, "dedicated_shared"),
      shown(load, "critical"),
      shown(load, "install_status"),
    ]);

  const panelRows = collection(bundle, "panels")
    .filter(
      (p) =>
        (scope.building === ALL_SCOPE || matchesBuilding(str(p["building"]), scope.building)) &&
        (scope.panel === ALL_SCOPE || str(p["stable_id"]) === scope.panel),
    )
    .map((p) => [
      shown(p, "stable_id"),
      shown(p, "description"),
      shown(p, "building"),
      shown(p, "grid"),
      shown(p, "voltage"),
      shown(p, "bus_rating_amps"),
      shown(p, "spaces"),
      shown(p, "feeder_source"),
    ]);

  const inScopePanels = new Set(panelRows.map((r) => r[0]!));
  const groupRows = collection(bundle, "circuit_groups")
    .filter((g) => scope.panel === ALL_SCOPE || str(g["panel_stable_id"]) === scope.panel)
    .filter(
      (g) =>
        scope.building === ALL_SCOPE ||
        scope.panel !== ALL_SCOPE ||
        inScopePanels.has(str(g["panel_stable_id"])),
    )
    .map((g) => [
      shown(g, "stable_id"),
      shown(g, "description"),
      shown(g, "panel_stable_id"),
      shown(g, "breaker_position"),
      shown(g, "voltage"),
      shown(g, "circuit_rating_amps"),
      shown(g, "conductor_size"),
    ]);

  const feederRows = collection(bundle, "feeders").map((f) => [
    shown(f, "stable_id"),
    shown(f, "description"),
    shown(f, "source_endpoint_ref"),
    shown(f, "dest_endpoint_ref"),
    shown(f, "voltage"),
    shown(f, "ampacity_amps"),
    shown(f, "conductor_size"),
  ]);

  const unresolved = loads
    .filter(({ panel }) => !panel)
    .map(({ load, panelBasis }) => [
      shown(load, "stable_id"),
      shown(load, "description"),
      panelBasis,
    ]);

  const qaRows = bundle.qa.findings
    .slice(0, 200)
    .map((f) => [f.severity.toUpperCase(), f.code, f.stable_id || NOT_IN_RECORD, f.message]);

  const sections: SheetSection[] = [
    {
      heading: "Panels in scope",
      note: "Panel values are engineering-owned; FarmOps never rewrites them.",
      columns: ["Panel", "Description", "Building", "Grid", "V", "Bus A", "Spaces", "Fed from"],
      rows: panelRows,
      widths: [1.1, 1.6, 1.1, 0.7, 0.5, 0.7, 0.6, 1.1],
    },
    {
      heading: "Circuit groups",
      columns: ["Circuit", "Description", "Panel", "Breaker", "V", "Rating A", "Conductor"],
      rows: groupRows,
      widths: [1.1, 2.1, 1.1, 0.9, 0.5, 0.8, 1.0],
    },
    {
      heading: "Loads",
      note: "Panel column shows the proven relationship where one exists; design intent is labelled in the panel-evidence section.",
      columns: [
        "Load",
        "Grid",
        "Description",
        "Panel",
        "Circuit",
        "V",
        "A",
        "VA",
        "D/S",
        "Critical",
        "Install",
      ],
      rows: loadRows,
      widths: [1.0, 0.6, 2.2, 1.1, 1.0, 0.5, 0.5, 0.7, 0.6, 0.7, 0.9],
    },
    {
      heading: "Feeders",
      columns: ["Feeder", "Description", "From", "To", "V", "Ampacity", "Conductor"],
      rows: feederRows,
      widths: [1.0, 2.0, 1.2, 1.2, 0.5, 0.8, 1.0],
    },
    {
      heading: "Explicit gaps — loads with no panel in the record",
      note: "Listed, never filled in. A gap is resolved by field observation, not by the document.",
      columns: ["Load", "Description", "Why unresolved"],
      rows: unresolved,
      widths: [1.0, 2.0, 3.4],
    },
    {
      heading: `QA findings (${bundle.qa.errors} errors, ${bundle.qa.warnings} warnings)`,
      note: "Reported, never enforced. The sheet prints regardless of findings.",
      columns: ["Severity", "Code", "Record", "Message"],
      rows: qaRows,
      widths: [0.8, 1.4, 1.2, 3.2],
    },
  ];

  return {
    title: "Farm Shop electrical sheet",
    scope: scopeLabel(scope),
    sections,
    counts: {
      panels: panelRows.length,
      circuit_groups: groupRows.length,
      loads: loadRows.length,
      feeders: feederRows.length,
      unresolved_panel: unresolved.length,
      qa_findings: qaRows.length,
      gap_cells: gapCount(loadRows) + gapCount(panelRows) + gapCount(groupRows),
    },
    digestSource: sections.map((s) => ({ heading: s.heading, columns: s.columns, rows: s.rows })),
  };
}

/* ---------------------------------------------------------------- labels */

/**
 * Label records built from the same bundle the sheet uses, so a label and a
 * sheet printed in one session always agree.
 */
export function labelRecordsFromBundle(
  bundle: DocumentBundle,
  kinds: LabelKind[],
  scope: DocScope,
): LabelRecord[] {
  const idx = indexBundle(bundle);
  const out: LabelRecord[] = [];

  for (const kind of [...new Set(kinds)]) {
    const def = ENTITIES[kind];
    const rows = collection(bundle, COLLECTION_FOR_KIND[kind]);
    const columns = labelColumns(kind).filter((c) => c !== "id" && c !== def.stableIdField);

    for (const row of rows) {
      const values: Record<string, string> = {};
      for (const col of columns) {
        const v = row[col];
        if (v === null || v === undefined || v === "") continue;
        values[col] = typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
      }
      // Derived panel reference: from the linked circuit group only.
      const group = idx.groupsById.get(str(row["circuit_group_stable_id"]));
      const derivedPanel = group ? str(group["panel_stable_id"]) || str(group["suggested_panel"]) : "";
      if (derivedPanel) values["circuit_group_panel"] = derivedPanel;

      const record: LabelRecord = {
        id: str(row["uuid"]) || str(row["stable_id"]),
        kind,
        stable_id: str(row["stable_id"]) || "(no ID)",
        values,
      };
      if (!inLabelScope(record, scope, idx)) continue;
      out.push(record);
    }
  }
  return sortLabelRecords(out);
}

function inLabelScope(record: LabelRecord, scope: DocScope, idx: BundleIndex): boolean {
  if (scope.building !== ALL_SCOPE) {
    const where = [
      record.values["area"],
      record.values["location"],
      record.values["building"],
      record.values["site_area"],
    ]
      .filter(Boolean)
      .join(" ");
    // A record with nothing locational recorded is kept: dropping it would
    // silently hide an unlabelled item from the walk.
    if (where && !matchesBuilding(where, scope.building)) return false;
  }
  if (scope.panel !== ALL_SCOPE) {
    const panels = [
      record.values["circuit_group_panel"],
      record.values["suggested_panel"],
      record.values["panel_id"],
      record.values["source_panel_ref"],
    ].filter(Boolean) as string[];
    if (panels.length && !panels.includes(scope.panel)) return false;
    if (!panels.length && record.kind !== "panel") return false;
    if (record.kind === "panel" && record.stable_id !== scope.panel) return false;
  }
  void idx;
  return true;
}

export interface LabelDocModel {
  /** Avery 8593 print blocks: one per location + panel, in walk order. */
  groups: { key: string; location: string; panel: string; records: LabelRecord[] }[];
  total: number;
  digestSource: unknown;
}

export function buildLabelModel(
  bundle: DocumentBundle,
  kinds: LabelKind[],
  scope: DocScope,
): LabelDocModel {
  const records = labelRecordsFromBundle(bundle, kinds, scope);
  const groups = labelWalkGroups(records).map((g) => ({
    key: g.key,
    location: g.location || NOT_IN_RECORD,
    panel: g.panel || NOT_IN_RECORD,
    records: g.records,
  }));
  return {
    groups,
    total: records.length,
    digestSource: groups.map((g) => ({
      location: g.location,
      panel: g.panel,
      records: g.records.map((r) => ({ id: r.stable_id, kind: r.kind, values: r.values })),
    })),
  };
}

/** Printed lines for one Avery 8593 cell, from the record only. */
export function averyCellLines(record: LabelRecord): { left: string[]; right: [string, string] } {
  const parts: string[] = [];
  for (const f of LABEL_FIELDS[record.kind]) {
    if (!f.short) continue;
    const raw = (record.values[f.key] ?? "").trim();
    if (raw) parts.push(f.unit ? `${raw}${f.unit}` : raw);
  }
  const gridKey = GRID_KEYS[record.kind];
  const grid = gridKey ? (record.values[gridKey] ?? "").trim() : "";
  const volts = (record.values["volts"] ?? record.values["voltage"] ?? "").trim();
  const amps = (record.values["amps"] ?? record.values["circuit_rating_amps"] ?? "").trim();
  const raw = (record.values["dedicated_shared"] ?? "").trim().toUpperCase();
  const cls = raw.startsWith("D") ? "D" : raw.startsWith("S") ? "S" : "";
  const right: [string, string] = [
    grid,
    [volts ? `${volts}V` : "", amps ? `${amps}A` : "", cls].filter(Boolean).join(" "),
  ];
  return { left: [record.stable_id, parts.join(" · ")], right };
}

/* --------------------------------------------------------------- grid map */

export interface GridMapDocModel {
  points: GridMapPoint[];
  summary: GridMapSummary;
  panels: string[];
  /** Loads that could not be placed on the plan, with the reason. */
  unplaced: { loadId: string; description: string; reason: string }[];
  digestSource: unknown;
}

export function buildGridMapModel(bundle: DocumentBundle, scope: DocScope): GridMapDocModel {
  const inputs: GridMapLoadInput[] = scopedLoads(bundle, {
    building: scope.building === ALL_SCOPE ? "Farm Shop" : scope.building,
    panel: scope.panel,
  }).map(({ load, panel, panelBasis }) => ({
    load_id: str(load["stable_id"]),
    description: str(load["description"]) || null,
    area: str(load["area"]) || null,
    location: str(load["location"]) || null,
    grid: str(load["grid"]) || null,
    legacy_grid: str(load["legacy_grid"]) || null,
    grid_reference: str(load["grid_reference"]) || null,
    location_x_ft: num(load["location_x_ft"]),
    location_y_ft: num(load["location_y_ft"]),
    dedicated: typeof load["dedicated"] === "boolean" ? (load["dedicated"] as boolean) : null,
    dedicated_shared: str(load["dedicated_shared"]) || null,
    circuit_group_ref: str(load["circuit_group_ref"]) || null,
    amps: num(load["amps"]),
    volts: num(load["volts"]),
    connected_va: num(load["connected_va"]),
    design_circuit_ampacity: num(load["design_circuit_ampacity"]),
    installed_ocp_rating: num(load["installed_ocp_rating"]),
    minimum_circuit_ampacity: num(load["minimum_circuit_ampacity"]),
    maximum_overcurrent_protection: num(load["maximum_overcurrent_protection"]),
    panel: panel || null,
    panelBasis: panelBasis,
  }));

  const points = buildGridMapPoints(inputs);
  const summary = summarizeGridMap(points);
  const panels = [...new Set(points.map((p) => p.panel).filter((p) => p !== NOT_IN_RECORD))].sort(
    (a, b) => a.localeCompare(b, undefined, { numeric: true }),
  );
  const unplaced = points
    .filter((p) => p.xPct == null || p.yPct == null)
    .map((p) => ({
      loadId: p.loadId,
      description: p.description,
      reason: p.coordinateNote || p.coordinateBasis || "No coordinate or grid reference in the record.",
    }));

  return {
    points,
    summary,
    panels,
    unplaced,
    digestSource: points.map((p) => ({
      id: p.loadId,
      grid: p.gridReference,
      x: p.xFt,
      y: p.yFt,
      klass: p.klass,
      panel: p.panel,
    })),
  };
}
