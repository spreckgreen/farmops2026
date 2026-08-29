// Phase 5A — Electrical Reconciliation Snapshot (pure builder).
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
import type { ElectricalEntityKind } from "@/lib/electrical";

export const SNAPSHOT_SCHEMA_VERSION = "1.0";

export type FieldOwnership =
  | "engineering_design"
  | "farmops_as_built"
  | "imported_legacy"
  | "unknown";

export type SnapshotCollection =
  | "panels"
  | "loads"
  | "circuit_groups"
  | "raceways"
  | "raceway_waypoints"
  | "junction_boxes"
  | "branch_runs";

/** Collection name for each entity kind. Stable part of the wire contract. */
export const COLLECTION_FOR_KIND: Record<ElectricalEntityKind, SnapshotCollection> = {
  panel: "panels",
  load: "loads",
  circuit_group: "circuit_groups",
  raceway: "raceways",
  jbox: "junction_boxes",
  branch: "branch_runs",
};

/** Deterministic collection order in the emitted document. */
export const SNAPSHOT_COLLECTIONS: SnapshotCollection[] = [
  "panels",
  "loads",
  "circuit_groups",
  "raceways",
  "raceway_waypoints",
  "junction_boxes",
  "branch_runs",
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
  raceways: SnapshotRecord[];
  raceway_waypoints: SnapshotRecord[];
  junction_boxes: SnapshotRecord[];
  branch_runs: SnapshotRecord[];
}

export type RawRow = Record<string, unknown>;

export interface SnapshotInput {
  generatedAt: string;
  rows: Record<ElectricalEntityKind, RawRow[]>;
  waypoints: RawRow[];
  qa?: SnapshotQaFinding[];
}

function ownershipFor(field: EntityField): FieldOwnership {
  if (field.engineering) return "engineering_design";
  if (field.readOnly) return "imported_legacy";
  return "farmops_as_built";
}

/** Ownership map for one entity kind, including its derived relation keys. */
export function ownershipMap(kind: ElectricalEntityKind): Record<string, FieldOwnership> {
  const out: Record<string, FieldOwnership> = {};
  for (const field of ENTITIES[kind].fields) out[field.key] = ownershipFor(field);
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

  const counts = {} as Record<SnapshotCollection, number>;
  const ownership = {} as Record<SnapshotCollection, Record<string, FieldOwnership>>;
  for (const collection of SNAPSHOT_COLLECTIONS) {
    counts[collection] = collections[collection]?.length ?? 0;
  }
  for (const kind of kinds) ownership[COLLECTION_FOR_KIND[kind]] = ownershipMap(kind);
  ownership.raceway_waypoints = WAYPOINT_OWNERSHIP;

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
    raceways: collections.raceways ?? [],
    raceway_waypoints: collections.raceway_waypoints ?? [],
    junction_boxes: collections.junction_boxes ?? [],
    branch_runs: collections.branch_runs ?? [],
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
