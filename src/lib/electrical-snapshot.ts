// Phase 4.2 — Electrical Reconciliation Snapshot (pure builder).
//
// Produces a deterministic, versioned, read-only view of the FarmOps electrical
// records so the external BosteadFarmsBuildDocs reconciler can compare them
// against the canonical engineering workbook (PremoFarmElectrical.ods).
//
// Hard rules encoded here:
//  - FarmOps never writes the ODS and this module never mutates anything;
//  - stable IDs (PNL-*, CON-###, JB-###, BR-###, FS-###) are the integration
//    identity; UUIDs are exported for traceability only;
//  - null means "unknown / not established" and is never replaced by a guess;
//  - every relationship is exported as an explicit UUID *and* stable ID pair,
//    never as a formatted display string;
//  - collections are always present, even when empty.
import { ENTITIES, type EntityField } from "@/lib/electrical-entities";
import { relationsFor } from "@/lib/electrical-relations";
import { FARMOPS_NATIVE_KINDS, type ElectricalEntityKind } from "@/lib/electrical";

export const SNAPSHOT_SCHEMA_VERSION = "1.3";

export type FieldOwnership =
  | "engineering_design"
  | "farmops_as_built"
  | "imported_legacy"
  | "unknown";

export type SnapshotCollection =
  | "panels"
  | "loads"
  | "circuit_groups"
  | "feeders"
  | "raceways"
  | "raceway_waypoints"
  | "junction_boxes"
  | "branch_runs"
  | "panel_breaker_positions"
  | "panel_exits"
  | "equipment_racks"
  | "power_assets"
  | "devices"
  | "switch_banks"
  | "switch_devices"
  | "control_groups"
  | "control_targets"
  | "control_wiring_segments";

/** Collection name for each entity kind. Stable part of the wire contract. */
export const COLLECTION_FOR_KIND: Record<ElectricalEntityKind, SnapshotCollection> = {
  panel: "panels",
  load: "loads",
  circuit_group: "circuit_groups",
  feeder: "feeders",
  raceway: "raceways",
  jbox: "junction_boxes",
  branch: "branch_runs",
  rack: "equipment_racks",
  power_asset: "power_assets",
  device: "devices",
};

/** Deterministic collection order in the emitted document. */
export const SNAPSHOT_COLLECTIONS: SnapshotCollection[] = [
  "panels",
  "loads",
  "circuit_groups",
  "feeders",
  "raceways",
  "raceway_waypoints",
  "junction_boxes",
  "branch_runs",
  "panel_breaker_positions",
  "panel_exits",
  "equipment_racks",
  "power_assets",
  "devices",
  "switch_banks",
  "switch_devices",
  "control_groups",
  "control_targets",
  "control_wiring_segments",
];


/** Row-level bookkeeping columns — not owned engineering or field values. */
export const METADATA_FIELDS = ["uuid", "stable_id", "created_at", "updated_at"] as const;

export type SnapshotValue = string | number | boolean | null;
export type SnapshotRecord = Record<string, SnapshotValue>;

export interface SnapshotQaFinding {
  code: string;
  severity: "error" | "warning";
  stable_id: string;
  message: string;
}

export interface ElectricalSnapshot {
  schema_version: string;
  generated_at: string;
  source: "FarmOps";
  authority: "field-as-built";
  engineering_system_of_record: string;
  counts: Record<SnapshotCollection, number>;
  /** Per-collection field -> ownership classification. */
  field_ownership: Record<SnapshotCollection, Record<string, FieldOwnership>>;
  metadata_fields: string[];
  /** QA is reported, never enforced: warnings do not block the export. */
  qa: {
    errors: number;
    warnings: number;
    findings: SnapshotQaFinding[];
  };
  panels: SnapshotRecord[];
  loads: SnapshotRecord[];
  circuit_groups: SnapshotRecord[];
  feeders: SnapshotRecord[];
  raceways: SnapshotRecord[];
  raceway_waypoints: SnapshotRecord[];
  junction_boxes: SnapshotRecord[];
  branch_runs: SnapshotRecord[];
  /** Phase 4.3: one record per physical breaker space in a panel. */
  panel_breaker_positions: SnapshotRecord[];
  /** Phase 4.3: one record per physical raceway penetration of a panel. */
  panel_exits: SnapshotRecord[];
  /**
   * FarmOps-native infrastructure with no canonical ODS counterpart. Exported
   * for reconciliation transparency only — never written back to the workbook.
   */
  equipment_racks: SnapshotRecord[];
  power_assets: SnapshotRecord[];
  devices: SnapshotRecord[];
  /**
   * Switching and control topology (schema 1.3). Switch banks and switching
   * devices are never loads, and a control group is never a circuit group.
   */
  switch_banks: SnapshotRecord[];
  switch_devices: SnapshotRecord[];
  control_groups: SnapshotRecord[];
  control_targets: SnapshotRecord[];
  control_wiring_segments: SnapshotRecord[];
}

export type RawRow = Record<string, unknown>;

export interface SnapshotInput {
  generatedAt: string;
  rows: Record<ElectricalEntityKind, RawRow[]>;
  waypoints: RawRow[];
  /** Phase 4.3 child collections; optional so older callers keep compiling. */
  breakerPositions?: RawRow[];
  panelExits?: RawRow[];
  /** Schema 1.3 switch/control collections; optional for older callers. */
  switchBanks?: RawRow[];
  switchDevices?: RawRow[];
  controlGroups?: RawRow[];
  controlTargets?: RawRow[];
  controlWiringSegments?: RawRow[];
  qa?: SnapshotQaFinding[];
}

/**
 * Columns FarmOps captures in the field. Everything else on an ODS-derived
 * entity belongs to the engineering workbook.
 */
export const FARMOPS_OWNED_FIELDS = new Set([
  "install_status",
  "label_status",
  "completion_percent",
  "notes",
  "measured_length_ft",
  "raceway_uuid",
  "device_side_connected",
  "source_side_connected",
  "exit_order",
  "exit_side",
  "exit_notes",
]);

/** Read-only text imported from the workbook and kept beside the relational FKs. */
export const LEGACY_REFERENCE_FIELDS = new Set([
  "from_label",
  "to_label",
  "source_endpoint_ref",
  "source_endpoint_type",
  "dest_endpoint_ref",
  "dest_endpoint_type",
  "circuit_group_ref",
  "suggested_panel",
  "source_circuit",
]);

function ownershipFor(field: EntityField): FieldOwnership {
  if (LEGACY_REFERENCE_FIELDS.has(field.key)) return "imported_legacy";
  if (field.engineering) return "engineering_design";
  if (FARMOPS_OWNED_FIELDS.has(field.key)) return "farmops_as_built";
  // Relationship pickers are as-built topology established in FarmOps.
  // FK links and the Inventory/Asset link are FarmOps-native: the canonical ODS
  // has no counterpart for either.
  if (field.kind === "entity" || field.kind === "asset") return "farmops_as_built";
  return "engineering_design";
}

/** Ownership map for one entity kind, including its derived relation keys. */
export function ownershipMap(kind: ElectricalEntityKind): Record<string, FieldOwnership> {
  const out: Record<string, FieldOwnership> = {};
  // FarmOps-native infrastructure is owned end-to-end by FarmOps: the canonical
  // workbook has no counterpart, so no field can be engineering-design owned.
  const native = FARMOPS_NATIVE_KINDS.has(kind);
  for (const field of ENTITIES[kind].fields) {
    out[field.key] = native ? "farmops_as_built" : ownershipFor(field);
  }

  for (const spec of relationsFor(kind)) {
    out[relationStableIdKey(spec.fkColumn)] = out[spec.fkColumn] ?? "farmops_as_built";
  }
  return out;
}

/** `source_panel_uuid` -> `source_panel_stable_id`. */
export function relationStableIdKey(fkColumn: string): string {
  return `${fkColumn.replace(/_uuid$/, "")}_stable_id`;
}

function scalar(value: unknown): SnapshotValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  // Arrays/objects never appear on the electrical tables; keep the export
  // machine-readable rather than emitting a formatted string.
  return JSON.stringify(value);
}

/** Sort object keys so byte-identical data yields byte-identical JSON. */
function sortKeys(record: SnapshotRecord): SnapshotRecord {
  const out: SnapshotRecord = {};
  for (const key of Object.keys(record).sort()) out[key] = record[key]!;
  return out;
}

function compareRecords(a: SnapshotRecord, b: SnapshotRecord): number {
  const sa = String(a["stable_id"] ?? "");
  const sb = String(b["stable_id"] ?? "");
  if (sa !== sb) return sa < sb ? -1 : 1;
  const ua = String(a["uuid"] ?? "");
  const ub = String(b["uuid"] ?? "");
  return ua < ub ? -1 : ua > ub ? 1 : 0;
}

/** Index of row UUID -> stable ID for one kind, used to resolve relations. */
function stableIdIndex(kind: ElectricalEntityKind, rows: RawRow[]): Map<string, string> {
  const field = ENTITIES[kind].stableIdField;
  const map = new Map<string, string>();
  for (const row of rows) {
    const id = row["id"];
    if (typeof id !== "string") continue;
    const stable = row[field];
    if (typeof stable === "string" && stable.trim()) map.set(id, stable.trim());
  }
  return map;
}

function buildEntityRecord(
  kind: ElectricalEntityKind,
  row: RawRow,
  indexes: Record<ElectricalEntityKind, Map<string, string>>,
): SnapshotRecord {
  const def = ENTITIES[kind];
  const record: SnapshotRecord = {
    uuid: scalar(row["id"]),
    stable_id: scalar(row[def.stableIdField]),
    created_at: scalar(row["created_at"]),
    updated_at: scalar(row["updated_at"]),
  };
  for (const field of def.fields) record[field.key] = scalar(row[field.key]);
  // Phase 4.4b: panel system-voltage designation. Not an editable entity field —
  // it is a semantic representation written only by the apply gate, and it is
  // exported so reconciliation can read it without touching the scalar voltage.
  if (kind === "panel") {
    record["system_voltage"] = scalar(row["system_voltage"]);
    record["system_voltage_applied_at"] = scalar(row["system_voltage_applied_at"]);
  }

  // Stable-ID counterpart for every FK. An unset FK stays null on both keys:
  // unknown is preferable to a guessed relationship.
  for (const spec of relationsFor(kind)) {
    const uuid = row[spec.fkColumn];
    record[spec.fkColumn] = scalar(uuid);
    record[relationStableIdKey(spec.fkColumn)] =
      typeof uuid === "string" ? (indexes[spec.targetKind].get(uuid) ?? null) : null;
  }
  return sortKeys(record);
}

function buildWaypointRecord(row: RawRow, raceways: Map<string, string>): SnapshotRecord {
  const racewayUuid = row["raceway_id"];
  return sortKeys({
    uuid: scalar(row["id"]),
    // Waypoints carry no stable ID of their own: they are ordered attributes of
    // one raceway and must never be reconciled as junction boxes.
    stable_id: null,
    raceway_uuid: scalar(racewayUuid),
    raceway_stable_id:
      typeof racewayUuid === "string" ? (raceways.get(racewayUuid) ?? null) : null,
    sequence: scalar(row["sequence"]),
    label: scalar(row["label"]),
    grid: scalar(row["grid"]),
    direction: scalar(row["direction"]),
    notes: scalar(row["notes"]),
    created_at: scalar(row["created_at"]),
    updated_at: scalar(row["updated_at"]),
  });
}

export const WAYPOINT_OWNERSHIP: Record<string, FieldOwnership> = {
  raceway_uuid: "farmops_as_built",
  raceway_stable_id: "farmops_as_built",
  sequence: "farmops_as_built",
  label: "farmops_as_built",
  grid: "engineering_design",
  direction: "farmops_as_built",
  notes: "farmops_as_built",
};

function buildBreakerPositionRecord(
  row: RawRow,
  panels: Map<string, string>,
  groups: Map<string, string>,
  loads: Map<string, string>,
): SnapshotRecord {
  const panelUuid = row["panel_uuid"];
  const groupUuid = row["circuit_group_uuid"];
  const loadUuid = row["load_uuid"];
  return sortKeys({
    uuid: scalar(row["id"]),
    // A breaker position is identified by its panel plus its physical slot.
    stable_id:
      typeof panelUuid === "string" && panels.get(panelUuid)
        ? `${panels.get(panelUuid)}:${String(row["side"] ?? "")}${String(row["position"] ?? "")}`
        : null,
    panel_uuid: scalar(panelUuid),
    panel_stable_id: typeof panelUuid === "string" ? (panels.get(panelUuid) ?? null) : null,
    side: scalar(row["side"]),
    position: scalar(row["position"]),
    breaker_number: scalar(row["breaker_number"]),
    poles: scalar(row["poles"]),
    circuit_group_uuid: scalar(groupUuid),
    circuit_group_stable_id: typeof groupUuid === "string" ? (groups.get(groupUuid) ?? null) : null,
    load_uuid: scalar(loadUuid),
    load_stable_id: typeof loadUuid === "string" ? (loads.get(loadUuid) ?? null) : null,
    label: scalar(row["label"]),
    ocp_amps: scalar(row["ocp_amps"]),
    install_status: scalar(row["install_status"]),
    label_status: scalar(row["label_status"]),
    completion_percent: scalar(row["completion_percent"]),
    notes: scalar(row["notes"]),
    created_at: scalar(row["created_at"]),
    updated_at: scalar(row["updated_at"]),
  });
}

function buildPanelExitRecord(
  row: RawRow,
  panels: Map<string, string>,
  raceways: Map<string, string>,
): SnapshotRecord {
  const panelUuid = row["panel_uuid"];
  const racewayUuid = row["raceway_uuid"];
  return sortKeys({
    uuid: scalar(row["id"]),
    stable_id:
      typeof panelUuid === "string" && panels.get(panelUuid)
        ? `${panels.get(panelUuid)}:X${String(row["exit_order"] ?? "")}`
        : null,
    panel_uuid: scalar(panelUuid),
    panel_stable_id: typeof panelUuid === "string" ? (panels.get(panelUuid) ?? null) : null,
    raceway_uuid: scalar(racewayUuid),
    raceway_stable_id:
      typeof racewayUuid === "string" ? (raceways.get(racewayUuid) ?? null) : null,
    raceway_ref: scalar(row["raceway_ref"]),
    exit_order: scalar(row["exit_order"]),
    exit_side: scalar(row["exit_side"]),
    trade_size: scalar(row["trade_size"]),
    install_status: scalar(row["install_status"]),
    label_status: scalar(row["label_status"]),
    completion_percent: scalar(row["completion_percent"]),
    notes: scalar(row["notes"]),
    created_at: scalar(row["created_at"]),
    updated_at: scalar(row["updated_at"]),
  });
}

export const BREAKER_POSITION_OWNERSHIP: Record<string, FieldOwnership> = {
  panel_uuid: "engineering_design",
  panel_stable_id: "engineering_design",
  side: "engineering_design",
  position: "engineering_design",
  breaker_number: "engineering_design",
  poles: "engineering_design",
  circuit_group_uuid: "engineering_design",
  circuit_group_stable_id: "engineering_design",
  load_uuid: "engineering_design",
  load_stable_id: "engineering_design",
  label: "engineering_design",
  ocp_amps: "engineering_design",
  install_status: "farmops_as_built",
  label_status: "farmops_as_built",
  completion_percent: "farmops_as_built",
  notes: "farmops_as_built",
};

export const PANEL_EXIT_OWNERSHIP: Record<string, FieldOwnership> = {
  panel_uuid: "farmops_as_built",
  panel_stable_id: "farmops_as_built",
  raceway_uuid: "farmops_as_built",
  raceway_stable_id: "farmops_as_built",
  raceway_ref: "imported_legacy",
  exit_order: "farmops_as_built",
  exit_side: "farmops_as_built",
  trade_size: "engineering_design",
  install_status: "farmops_as_built",
  label_status: "farmops_as_built",
  completion_percent: "farmops_as_built",
  notes: "farmops_as_built",
};

export function buildElectricalSnapshot(input: SnapshotInput): ElectricalSnapshot {
  const kinds = Object.keys(ENTITIES) as ElectricalEntityKind[];
  const indexes = {} as Record<ElectricalEntityKind, Map<string, string>>;
  for (const kind of kinds) indexes[kind] = stableIdIndex(kind, input.rows[kind] ?? []);

  const collections = {} as Record<SnapshotCollection, SnapshotRecord[]>;
  for (const kind of kinds) {
    collections[COLLECTION_FOR_KIND[kind]] = (input.rows[kind] ?? [])
      .map((row) => buildEntityRecord(kind, row, indexes))
      .sort(compareRecords);
  }
  collections.raceway_waypoints = (input.waypoints ?? [])
    .map((row) => buildWaypointRecord(row, indexes.raceway))
    .sort((a, b) => {
      const ra = String(a["raceway_stable_id"] ?? "");
      const rb = String(b["raceway_stable_id"] ?? "");
      if (ra !== rb) return ra < rb ? -1 : 1;
      return Number(a["sequence"] ?? 0) - Number(b["sequence"] ?? 0);
    });

  collections.panel_breaker_positions = (input.breakerPositions ?? [])
    .map((row) =>
      buildBreakerPositionRecord(row, indexes.panel, indexes.circuit_group, indexes.load),
    )
    .sort(compareRecords);
  collections.panel_exits = (input.panelExits ?? [])
    .map((row) => buildPanelExitRecord(row, indexes.panel, indexes.raceway))
    .sort(compareRecords);

  const counts = {} as Record<SnapshotCollection, number>;
  const ownership = {} as Record<SnapshotCollection, Record<string, FieldOwnership>>;
  for (const collection of SNAPSHOT_COLLECTIONS) {
    counts[collection] = collections[collection]?.length ?? 0;
  }
  for (const kind of kinds) ownership[COLLECTION_FOR_KIND[kind]] = ownershipMap(kind);
  ownership.raceway_waypoints = WAYPOINT_OWNERSHIP;
  ownership.panel_breaker_positions = BREAKER_POSITION_OWNERSHIP;
  ownership.panel_exits = PANEL_EXIT_OWNERSHIP;

  const findings = [...(input.qa ?? [])].sort(
    (a, b) =>
      a.severity.localeCompare(b.severity) ||
      a.code.localeCompare(b.code) ||
      a.stable_id.localeCompare(b.stable_id) ||
      a.message.localeCompare(b.message),
  );

  return {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    generated_at: input.generatedAt,
    source: "FarmOps",
    authority: "field-as-built",
    engineering_system_of_record: "PremoFarmElectrical.ods",
    counts,
    field_ownership: ownership,
    metadata_fields: [...METADATA_FIELDS],
    qa: {
      errors: findings.filter((f) => f.severity === "error").length,
      warnings: findings.filter((f) => f.severity === "warning").length,
      findings,
    },
    panels: collections.panels ?? [],
    loads: collections.loads ?? [],
    circuit_groups: collections.circuit_groups ?? [],
    feeders: collections.feeders ?? [],
    raceways: collections.raceways ?? [],
    raceway_waypoints: collections.raceway_waypoints ?? [],
    junction_boxes: collections.junction_boxes ?? [],
    branch_runs: collections.branch_runs ?? [],
    panel_breaker_positions: collections.panel_breaker_positions ?? [],
    panel_exits: collections.panel_exits ?? [],
    equipment_racks: collections.equipment_racks ?? [],
    power_assets: collections.power_assets ?? [],
    devices: collections.devices ?? [],

  };
}

/** Canonical serialization: key order is already deterministic per record. */
export function serializeSnapshot(snapshot: ElectricalSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

export function snapshotFilename(generatedAt: string): string {
  // 2026-08-29T16:23:45.123Z -> farmops-electrical-snapshot-2026-08-29T162345.json
  const [date, rest = ""] = generatedAt.split("T");
  const time = rest.replace(/\..*$/, "").replace(/Z$/, "").replace(/:/g, "");
  return `farmops-electrical-snapshot-${date}T${time}.json`;
}

/** Records modified at or after `since`, grouped by collection. */
export function modifiedSince(
  snapshot: ElectricalSnapshot,
  since: string | null,
): Record<SnapshotCollection, number> {
  const out = {} as Record<SnapshotCollection, number>;
  for (const collection of SNAPSHOT_COLLECTIONS) {
    const rows = snapshot[collection];
    out[collection] = !since
      ? 0
      : rows.filter((r) => String(r["updated_at"] ?? "") >= since).length;
  }
  return out;
}
