// FarmOps Electrical API — Phase 1 acceptance contract (pure module).
//
// Everything the read-only integration promises about identity, scopes, errors,
// hashes and provenance is defined here so the HTTP layer, the OpenAPI document,
// the in-app documentation and the acceptance tests all read one definition.
//
// Authority model (unchanged by this API):
//   * PremoFarmElectrical.ods is the engineering system of record and is never
//     written by FarmOps;
//   * FarmOps owns the field/as-built record and is the authority for it;
//   * this API is a read projection of the FarmOps record plus provenance.
import {
  SNAPSHOT_COLLECTIONS,
  type ElectricalSnapshot,
  type SnapshotCollection,
  type SnapshotRecord,
} from "@/lib/electrical-snapshot";
import { PHASE_44A_BASELINE_SHA256 } from "@/lib/electrical-adjudication-baseline";

/* ------------------------------------------------------------------ scopes */

/**
 * Named scopes. A caller (interactive user or service principal) carries a set
 * of scopes; every endpoint declares exactly one required scope.
 */
export const API_SCOPES = {
  "electrical:read": "Read the electrical record: snapshot, collections, records and QA.",
  "electrical:sor:read": "Read system-of-record status and provenance (no record data).",
  "electrical:documents:read": "Read document-generation bundles and document payloads.",
  "electrical:audit-batches:read":
    "Read field-audit batch metadata and export a stored batch manifest for peer-instance staging.",
  "electrical:observations:write":
    "Append field observations to the field journal (Phase 2 — not activated).",
  "electrical:relationships:write":
    "Record allow-listed relationship links (Phase 3 — not activated).",
} as const;

export type ApiScope = keyof typeof API_SCOPES;
export const API_SCOPE_LIST = Object.keys(API_SCOPES) as ApiScope[];

/** Scopes granted to an interactive user by electrical entitlement mode. */
export const SCOPES_FOR_ENTITLEMENT: Record<"read" | "field_write", ApiScope[]> = {
  read: [
    "electrical:read",
    "electrical:sor:read",
    "electrical:documents:read",
    "electrical:audit-batches:read",
  ],
  field_write: [
    "electrical:read",
    "electrical:sor:read",
    "electrical:documents:read",
    "electrical:audit-batches:read",
    "electrical:observations:write",
    "electrical:relationships:write",
  ],
};

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPE_LIST as string[]).includes(value);
}

/**
 * Scopes that are recognised AND currently activated. Phase 2/3 write scopes are
 * defined but not activated, so they are deliberately absent. This list is the
 * TypeScript twin of `public.electrical_api_activated_scopes()`; a database
 * CHECK constraint enforces the same set, so a direct Supabase write cannot
 * store a key carrying an unactivated scope.
 */
export const ACTIVATED_API_SCOPES: ApiScope[] = [
  "electrical:read",
  "electrical:sor:read",
  "electrical:documents:read",
  "electrical:audit-batches:read",
];

export function isActivatedApiScope(value: string): value is ApiScope {
  return (ACTIVATED_API_SCOPES as string[]).includes(value);
}


/* ------------------------------------------------------------ error codes */

/**
 * Structured error codes. The wire shape is always
 * `{ error: { code, message, details? }, request_id, api_version }`.
 */
export const API_ERROR_CODES = {
  unauthorized_missing_token: 401,
  unauthorized_invalid_token: 401,
  unauthorized_principal_disabled: 401,
  unauthorized_principal_expired: 401,
  forbidden_entitlement_missing: 403,
  forbidden_scope_missing: 403,
  not_found_endpoint: 404,
  not_found_collection: 404,
  not_found_record: 404,
  bad_request_json: 400,
  bad_request_validation: 400,
  bad_request_missing_parameter: 400,
  conflict_record_version: 409,
  conflict_preview_expired: 409,
  conflict_idempotency_replay: 409,
  rate_limited: 429,
  write_scopes_not_activated: 503,
  backend_not_configured: 500,
  backend_query_failed: 500,
  internal_error: 500,
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_CODES;

export function statusForErrorCode(code: ApiErrorCode): number {
  return API_ERROR_CODES[code];
}

/* ------------------------------------------------------------ rate limits */

export interface RateLimitPolicy {
  bucket: "read" | "write";
  requests: number;
  window_seconds: number;
  description: string;
}

export const API_RATE_LIMITS: RateLimitPolicy[] = [
  {
    bucket: "read",
    requests: 120,
    window_seconds: 60,
    description: "Read endpoints, per principal. Exceeding returns 429 rate_limited.",
  },
  {
    bucket: "write",
    requests: 30,
    window_seconds: 60,
    description:
      "Scoped write endpoints, per principal. Not reachable while write scopes are unactivated.",
  },
];

export function rateLimitFor(bucket: "read" | "write"): RateLimitPolicy {
  return API_RATE_LIMITS.find((p) => p.bucket === bucket)!;
}

/* ------------------------------------------------------- stable ID formats */

export interface StableIdFormat {
  collection: SnapshotCollection;
  /** Anchored regular expression source, as published in the OpenAPI document. */
  pattern: string;
  example: string;
  note: string;
}

export const STABLE_ID_FORMATS: StableIdFormat[] = [
  {
    collection: "panels",
    pattern: "^PNL-[A-Z0-9-]+$",
    example: "PNL-FS-NW",
    note: "Permanent panel identity. Never renamed or renumbered.",
  },
  {
    collection: "loads",
    pattern: "^(FS|H|SH|GH|BR)-[0-9]{3}$",
    example: "FS-082",
    note: "Canonical Load_Master identity, building prefix plus three digits.",
  },
  {
    collection: "circuit_groups",
    pattern: "^CG-[0-9]{3,}$",
    example: "CG-014",
    note: "Logical circuit grouping loads on one overcurrent device.",
  },
  {
    collection: "feeders",
    pattern: "^FDR-[0-9]{3,}$",
    example: "FDR-001",
    note: "Feeder between service or panel equipment.",
  },
  {
    collection: "raceways",
    pattern: "^(EMT|CON)-[0-9]{3}$",
    example: "EMT-104",
    note: "Conduit run. CON-### is the legacy imported form of the same identity.",
  },
  {
    collection: "junction_boxes",
    pattern: "^JB-[0-9]{3}-[0-9]{2}$",
    example: "JB-104-01",
    note: "Hierarchical: parent raceway number, then box sequence.",
  },
  {
    collection: "branch_runs",
    pattern: "^BR-[0-9]{3}-[0-9]{2}-[0-9]{2}$",
    example: "BR-104-01-01",
    note: "Hierarchical: raceway, junction box, then run sequence.",
  },
  {
    collection: "panel_breaker_positions",
    pattern: "^PNL-[A-Z0-9-]+:[LR][0-9]{1,2}$",
    example: "PNL-FS-NW:L3",
    note: "Composite: panel identity plus physical side and slot.",
  },
  {
    collection: "panel_exits",
    pattern: "^PNL-[A-Z0-9-]+:X[0-9]{1,2}$",
    example: "PNL-FS-NW:X2",
    note: "Composite: panel identity plus exit order.",
  },
  {
    collection: "equipment_racks",
    pattern: "^RACK-[0-9]{3}$",
    example: "RACK-001",
    note: "FarmOps-native rack. No canonical ODS counterpart.",
  },
  {
    collection: "power_assets",
    pattern: "^PSU-[0-9]{3}$",
    example: "PSU-002",
    note: "FarmOps-native power asset. No canonical ODS counterpart.",
  },
  {
    collection: "devices",
    pattern: "^DEV-[0-9]{3}$",
    example: "DEV-011",
    note: "FarmOps-native powered device. No canonical ODS counterpart.",
  },
  {
    collection: "raceway_waypoints",
    pattern: "",
    example: "",
    note: "Waypoints carry no stable ID: they are ordered attributes of one raceway.",
  },
];

export function stableIdFormat(collection: SnapshotCollection): StableIdFormat | undefined {
  return STABLE_ID_FORMATS.find((f) => f.collection === collection);
}

/* ------------------------------------------------- known-unreliable fields */

export interface UnreliableField {
  field: string;
  collections: SnapshotCollection[];
  severity: "warning";
  reason: string;
  guidance: string;
}

/**
 * Fields the record carries but which must NOT be treated as engineering truth
 * by a consumer. Reported on every snapshot so a document generator cannot
 * silently print an unreliable value as if it were verified.
 */
export const KNOWN_UNRELIABLE_FIELDS: UnreliableField[] = [
  {
    field: "demand_va",
    collections: ["loads"],
    severity: "warning",
    reason:
      "Demand VA in the imported record is a placeholder derived during import, not an adjudicated demand calculation.",
    guidance:
      "Do not print demand VA as a load-calculation input. Use connected VA plus the canonical workbook demand analysis.",
  },
  {
    field: "continuous_load",
    collections: ["loads"],
    severity: "warning",
    reason:
      "Continuous-load flags were imported from a tri-state spreadsheet column where blank, N and 0 were not distinguished at capture time.",
    guidance:
      "Treat null as unknown. Do not infer a non-continuous load from a missing flag when sizing conductors or OCP.",
  },
  {
    field: "phase",
    collections: ["loads", "panels", "feeders", "circuit_groups"],
    severity: "warning",
    reason:
      "Phase is partially populated and, where present, has not been reconciled against the panel system-voltage designation.",
    guidance:
      "Read the panel system_voltage designation for voltage/phase configuration; report phase as unknown when null.",
  },
];

export function unreliableFieldWarnings(snapshot: ElectricalSnapshot): {
  field: string;
  collection: SnapshotCollection;
  severity: "warning";
  populated_records: number;
  total_records: number;
  reason: string;
  guidance: string;
}[] {
  const out: ReturnType<typeof unreliableFieldWarnings> = [];
  for (const spec of KNOWN_UNRELIABLE_FIELDS) {
    for (const collection of spec.collections) {
      const rows = snapshot[collection] ?? [];
      // Only report a field the collection actually carries.
      if (!rows.some((r) => spec.field in r)) continue;
      out.push({
        field: spec.field,
        collection,
        severity: "warning",
        populated_records: rows.filter((r) => r[spec.field] != null && r[spec.field] !== "").length,
        total_records: rows.length,
        reason: spec.reason,
        guidance: spec.guidance,
      });
    }
  }
  return out;
}

/* ------------------------------------------------------- derived collections */

export interface CircuitRecord {
  stable_id: string | null;
  circuit_group_uuid: string | null;
  panel_stable_id: string | null;
  breaker_position_stable_ids: string[];
  breaker_ocp_amps: number | null;
  load_stable_ids: string[];
  load_count: number;
  /** How the panel was established for this circuit. Never inferred. */
  panel_basis: "circuit_group_fk" | "breaker_position" | "not_in_record";
}

/**
 * Circuits as their own collection: the logical circuit plus the breaker
 * positions and loads that resolve to it through recorded relationships only.
 */
export function deriveCircuits(snapshot: ElectricalSnapshot): CircuitRecord[] {
  const positions = snapshot.panel_breaker_positions ?? [];
  const loads = snapshot.loads ?? [];
  const out: CircuitRecord[] = (snapshot.circuit_groups ?? []).map((group) => {
    const uuid = group["uuid"] == null ? null : String(group["uuid"]);
    const stableId = group["stable_id"] == null ? null : String(group["stable_id"]);
    const groupPositions = positions.filter(
      (p) => uuid != null && String(p["circuit_group_uuid"] ?? "") === uuid,
    );
    const fkPanel = group["panel_stable_id"] == null ? null : String(group["panel_stable_id"]);
    const positionPanel = groupPositions.find((p) => p["panel_stable_id"] != null);
    const panel = fkPanel ?? (positionPanel ? String(positionPanel["panel_stable_id"]) : null);
    const ocp = groupPositions.find((p) => typeof p["ocp_amps"] === "number");
    return {
      stable_id: stableId,
      circuit_group_uuid: uuid,
      panel_stable_id: panel,
      breaker_position_stable_ids: groupPositions
        .map((p) => (p["stable_id"] == null ? "" : String(p["stable_id"])))
        .filter(Boolean)
        .sort(),
      breaker_ocp_amps: ocp ? (ocp["ocp_amps"] as number) : null,
      load_stable_ids: loads
        .filter((l) => uuid != null && String(l["circuit_group_uuid"] ?? "") === uuid)
        .map((l) => (l["stable_id"] == null ? "" : String(l["stable_id"])))
        .filter(Boolean)
        .sort(),
      load_count: 0,
      panel_basis: fkPanel ? "circuit_group_fk" : panel ? "breaker_position" : "not_in_record",
    };
  });
  for (const c of out) c.load_count = c.load_stable_ids.length;
  return out.sort((a, b) => String(a.stable_id).localeCompare(String(b.stable_id)));
}

export interface RelationshipEdge {
  from_collection: SnapshotCollection;
  from_stable_id: string;
  relation: string;
  to_stable_id: string;
  /** Only ever "recorded_fk": nothing here is inferred from labels or text. */
  basis: "recorded_fk";
}

/**
 * Relationships as their own collection: one edge per recorded foreign key that
 * resolves to a stable ID. An unset or unresolvable FK produces no edge — the
 * absence of an edge means "not established in the record".
 */
export function deriveRelationships(snapshot: ElectricalSnapshot): RelationshipEdge[] {
  const edges: RelationshipEdge[] = [];
  for (const collection of SNAPSHOT_COLLECTIONS) {
    for (const record of snapshot[collection] ?? []) {
      const from = record["stable_id"];
      if (from == null || !String(from)) continue;
      for (const key of Object.keys(record)) {
        if (key === "stable_id" || !key.endsWith("_stable_id")) continue;
        const value = record[key];
        if (value == null || !String(value)) continue;
        edges.push({
          from_collection: collection,
          from_stable_id: String(from),
          relation: key.replace(/_stable_id$/, ""),
          to_stable_id: String(value),
          basis: "recorded_fk",
        });
      }
    }
  }
  return edges.sort(
    (a, b) =>
      a.from_collection.localeCompare(b.from_collection) ||
      a.from_stable_id.localeCompare(b.from_stable_id) ||
      a.relation.localeCompare(b.relation) ||
      a.to_stable_id.localeCompare(b.to_stable_id),
  );
}

export interface ObservationRecord {
  observed_at: string | null;
  stable_id: string | null;
  field: string | null;
  observed_text: string | null;
  interpreted_value: string | null;
  confidence: string | null;
  verification_status: string | null;
  disposition: string | null;
  scope: string | null;
}

/**
 * Field observations as their own collection: the append-only field journal,
 * projected without any submitter identity.
 */
export function projectObservations(rows: Record<string, unknown>[]): ObservationRecord[] {
  const text = (v: unknown) => (v == null ? null : String(v));
  return rows
    .map((r) => ({
      observed_at: text(r["observed_at"]),
      stable_id: text(r["panel_ref"]),
      field: text(r["field"]),
      observed_text: text(r["observed_text"]),
      interpreted_value: text(r["interpreted_value"]),
      confidence: text(r["confidence"]),
      verification_status: text(r["verification_status"]),
      disposition: text(r["disposition"]),
      scope: text(r["scope"]),
    }))
    .sort(
      (a, b) =>
        String(b.observed_at ?? "").localeCompare(String(a.observed_at ?? "")) ||
        String(a.stable_id ?? "").localeCompare(String(b.stable_id ?? "")) ||
        String(a.field ?? "").localeCompare(String(b.field ?? "")),
    );
}

export interface ChangeLogSummary {
  total: number;
  by_section: Record<string, number>;
  by_action: Record<string, number>;
  by_entity_kind: Record<string, number>;
  first_change_at: string | null;
  latest_change_at: string | null;
}

/** Change log as a summary collection: volumes and window, never row bodies. */
export function summarizeChangeLog(rows: Record<string, unknown>[]): ChangeLogSummary {
  const count = (key: string) => {
    const out: Record<string, number> = {};
    for (const r of rows) {
      const k = r[key] == null ? "unknown" : String(r[key]);
      out[k] = (out[k] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
  };
  const stamps = rows
    .map((r) => (r["created_at"] == null ? "" : String(r["created_at"])))
    .filter(Boolean)
    .sort();
  return {
    total: rows.length,
    by_section: count("section"),
    by_action: count("action"),
    by_entity_kind: count("entity_kind"),
    first_change_at: stamps[0] ?? null,
    latest_change_at: stamps[stamps.length - 1] ?? null,
  };
}

/* ---------------------------------------------------------- source manifest */

export interface SourceManifestEntry {
  collection: SnapshotCollection | "circuits" | "relationships" | "observations";
  /** FarmOps table, or the derivation when the collection is computed. */
  source: string;
  origin: "farmops_table" | "derived_from_snapshot";
  authority: "farmops_field_as_built" | "engineering_design_via_import" | "farmops_native";
  record_count: number;
  /** Newest `updated_at`/`observed_at` in the collection, when it carries one. */
  data_updated_through: string | null;
  canonical_counterpart: string;
}

const ENGINEERING_DERIVED: SnapshotCollection[] = [
  "panels",
  "loads",
  "circuit_groups",
  "feeders",
  "raceways",
  "junction_boxes",
  "branch_runs",
  "panel_breaker_positions",
];
const FARMOPS_NATIVE: SnapshotCollection[] = [
  "equipment_racks",
  "power_assets",
  "devices",
  "panel_exits",
  "raceway_waypoints",
];

function newestStamp(rows: SnapshotRecord[] | Record<string, unknown>[], key: string): string | null {
  let newest: string | null = null;
  for (const row of rows as Record<string, unknown>[]) {
    const value = row[key];
    if (typeof value !== "string" || !value) continue;
    if (newest == null || value > newest) newest = value;
  }
  return newest;
}

/** Newest `updated_at` anywhere in the snapshot: how current the data is. */
export function dataUpdatedThrough(snapshot: ElectricalSnapshot): string | null {
  let newest: string | null = null;
  for (const collection of SNAPSHOT_COLLECTIONS) {
    const stamp = newestStamp(snapshot[collection] ?? [], "updated_at");
    if (stamp && (newest == null || stamp > newest)) newest = stamp;
  }
  return newest;
}

export function buildSourceManifest(
  snapshot: ElectricalSnapshot,
  tables: Record<SnapshotCollection, string>,
  derived: { circuits: number; relationships: number; observations: number },
  observationRows: Record<string, unknown>[],
): SourceManifestEntry[] {
  const entries: SourceManifestEntry[] = SNAPSHOT_COLLECTIONS.map((collection) => ({
    collection,
    source: tables[collection],
    origin: "farmops_table" as const,
    authority: FARMOPS_NATIVE.includes(collection)
      ? ("farmops_native" as const)
      : ENGINEERING_DERIVED.includes(collection)
        ? ("engineering_design_via_import" as const)
        : ("farmops_field_as_built" as const),
    record_count: snapshot.counts[collection] ?? 0,
    data_updated_through: newestStamp(snapshot[collection] ?? [], "updated_at"),
    canonical_counterpart: FARMOPS_NATIVE.includes(collection)
      ? "none — FarmOps-native, no canonical ODS counterpart"
      : "PremoFarmElectrical.ods (canonical, never written by FarmOps)",
  }));
  entries.push(
    {
      collection: "circuits",
      source: "derived: electrical_circuit_groups + electrical_breaker_positions + electrical_loads",
      origin: "derived_from_snapshot",
      authority: "engineering_design_via_import",
      record_count: derived.circuits,
      data_updated_through: newestStamp(snapshot.circuit_groups ?? [], "updated_at"),
      canonical_counterpart: "PremoFarmElectrical.ods circuit assignments",
    },
    {
      collection: "relationships",
      source: "derived: recorded foreign keys across every collection",
      origin: "derived_from_snapshot",
      authority: "farmops_field_as_built",
      record_count: derived.relationships,
      data_updated_through: dataUpdatedThrough(snapshot),
      canonical_counterpart: "none — as-built topology established in FarmOps",
    },
    {
      collection: "observations",
      source: "electrical_field_observations",
      origin: "farmops_table",
      authority: "farmops_field_as_built",
      record_count: derived.observations,
      data_updated_through: newestStamp(observationRows, "observed_at"),
      canonical_counterpart: "none — append-only field journal",
    },
  );
  return entries;
}

/* ------------------------------------------------------------------ hashing */

/** SHA-256 hex of a UTF-8 string, using Web Crypto (Workers and Node). */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stable JSON: object keys sorted at every depth, so equal data hashes equal. */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const src = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(src).sort()) out[key] = walk(src[key]);
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

/** The canonical engineering baseline this API reports provenance against. */
export const CANONICAL_ODS = {
  file: "PremoFarmElectrical.ods",
  sha256: PHASE_44A_BASELINE_SHA256,
  authorization: "Owner-authorized Phase 4.4a baseline",
  written_by_farmops: false,
} as const;

/* --------------------------------------------------------------- envelope */

export interface SnapshotEnvelopeInput {
  apiVersion: string;
  apiSchemaVersion: string;
  generatedAt: string;
  snapshot: ElectricalSnapshot;
  tables: Record<SnapshotCollection, string>;
  observationRows: Record<string, unknown>[];
  changeLogRows: Record<string, unknown>[];
  exclusions: unknown;
}

export interface SnapshotEnvelope {
  api_version: string;
  api_schema_version: string;
  snapshot_schema_version: string;
  snapshot_id: string;
  generated_at: string;
  data_updated_through: string | null;
  authority: Record<string, unknown>;
  hashes: {
    algorithm: "sha256";
    canonical_ods_sha256: string;
    farmops_snapshot_hash: string;
    content_hash: string;
    stability: string;
  };
  source_manifest: SourceManifestEntry[];
  counts: Record<string, number>;
  warnings: {
    known_unreliable_fields: ReturnType<typeof unreliableFieldWarnings>;
  };
  qa: ElectricalSnapshot["qa"];
  change_log: ChangeLogSummary;
  field_ownership: ElectricalSnapshot["field_ownership"];
  metadata_fields: string[];
  collections: Record<string, unknown[]>;
  excluded_by_design: unknown;
}

/**
 * Build the versioned snapshot envelope.
 *
 * Two hashes, both independent of when the request happened, so a repeated
 * request over unchanged data returns identical hashes:
 *   * `farmops_snapshot_hash` covers the record data only;
 *   * `content_hash` covers the whole envelope except the volatile identity
 *     fields (`generated_at`, `snapshot_id` and the hash block itself).
 */
export async function buildSnapshotEnvelope(
  input: SnapshotEnvelopeInput,
): Promise<SnapshotEnvelope> {
  const snap = input.snapshot;
  const circuits = deriveCircuits(snap);
  const relationships = deriveRelationships(snap);
  const observations = projectObservations(input.observationRows);

  const collections: Record<string, unknown[]> = {};
  for (const collection of SNAPSHOT_COLLECTIONS) collections[collection] = snap[collection] ?? [];
  collections["circuits"] = circuits;
  collections["relationships"] = relationships;
  collections["observations"] = observations;

  const counts: Record<string, number> = { ...snap.counts };
  counts["circuits"] = circuits.length;
  counts["relationships"] = relationships.length;
  counts["observations"] = observations.length;

  const changeLog = summarizeChangeLog(input.changeLogRows);
  const farmopsSnapshotHash = await sha256Hex(
    canonicalJson({ counts, collections, qa: snap.qa.findings }),
  );

  const body = {
    api_version: input.apiVersion,
    api_schema_version: input.apiSchemaVersion,
    snapshot_schema_version: snap.schema_version,
    data_updated_through: dataUpdatedThrough(snap),
    authority: {
      engineering_system_of_record: CANONICAL_ODS.file,
      canonical_authorization: CANONICAL_ODS.authorization,
      canonical_written_by_farmops: false,
      farmops_role: "field/as-built authority for the records in this snapshot",
      this_api: "read-only projection; performs no engineering or canonical write",
    },
    source_manifest: buildSourceManifest(
      snap,
      input.tables,
      {
        circuits: circuits.length,
        relationships: relationships.length,
        observations: observations.length,
      },
      input.observationRows,
    ),
    counts,
    warnings: { known_unreliable_fields: unreliableFieldWarnings(snap) },
    qa: snap.qa,
    change_log: changeLog,
    field_ownership: snap.field_ownership,
    metadata_fields: snap.metadata_fields,
    collections,
    excluded_by_design: input.exclusions,
  };

  const contentHash = await sha256Hex(canonicalJson(body));
  return {
    ...body,
    snapshot_id: `snap_${farmopsSnapshotHash.slice(0, 24)}`,
    generated_at: input.generatedAt,
    hashes: {
      algorithm: "sha256",
      canonical_ods_sha256: CANONICAL_ODS.sha256,
      farmops_snapshot_hash: farmopsSnapshotHash,
      content_hash: contentHash,
      stability:
        "Both hashes exclude generated_at and snapshot_id, so repeated requests over unchanged data return identical hashes.",
    },
  };
}

/* -------------------------------------------------------------- request ids */

const REQUEST_ID_OK = /^[A-Za-z0-9_.:-]{8,64}$/;

/**
 * Correlation ID for one request: the caller's `x-request-id` when it is a safe
 * token, otherwise a generated one. Echoed in the body and the response header.
 */
export function resolveRequestId(supplied: string | null | undefined): string {
  const trimmed = (supplied ?? "").trim();
  if (trimmed && REQUEST_ID_OK.test(trimmed)) return trimmed;
  const random = crypto.randomUUID().replace(/-/g, "");
  return `req_${random}`;
}
