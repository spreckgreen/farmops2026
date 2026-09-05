// FarmOps Electrical API — versioned wire contract (pure module).
//
// One place defines what the machine interface exposes, what it will never
// expose, and how each resource is meant to be used. Both the HTTP routes, the
// OpenAPI document, the in-app wiki page and the tests read from here, so the
// published contract and the running code cannot drift apart.
//
// Hard boundaries encoded below (see `ELECTRICAL_API_EXCLUSIONS`):
//   * reads are read-only projections of the reconciliation snapshot;
//   * the only writes are two narrowly scoped, approval-bearing endpoints —
//     record relationships (FK + its derived mirror columns) and field
//     observations (an append-only field journal row);
//   * no system-of-record administration, no canonical ODS write-back, and no
//     general-purpose table/column mutation.
import { ENTITIES, ENTITY_KINDS } from "@/lib/electrical-entities";
import { RELATIONS, relationsFor, type RelationSpec } from "@/lib/electrical-relations";
import { SNAPSHOT_COLLECTIONS, type SnapshotCollection } from "@/lib/electrical-snapshot";
import {
  API_ERROR_CODES,
  API_RATE_LIMITS,
  API_SCOPES,
  KNOWN_UNRELIABLE_FIELDS,
  rateLimitFor,
  STABLE_ID_FORMATS,
  type ApiScope,
} from "@/lib/electrical-api-envelope";
import type { ElectricalEntityKind } from "@/lib/electrical";

export const ELECTRICAL_API_VERSION = "v1";
/** Bumped when the wire shape changes in a breaking way. */
export const ELECTRICAL_API_SCHEMA_VERSION = "1.1";
/** Published base path. */
export const ELECTRICAL_API_BASE = `/api/${ELECTRICAL_API_VERSION}/electrical`;
/** Pre-acceptance path, still served but deprecated. */
export const ELECTRICAL_API_LEGACY_BASE = `/api/electrical/${ELECTRICAL_API_VERSION}`;
/** Public, unauthenticated specification path. */
export const OPENAPI_PATH = "/api/openapi.json";


/* ------------------------------------------------------------------ reads */

export interface ApiResource {
  /** Path segment: `/resources/{name}`. Equals the snapshot collection name. */
  name: SnapshotCollection;
  /** Owning entity kind, when the collection maps to one. */
  kind: ElectricalEntityKind | null;
  /** FarmOps table the rows come from. */
  table: string;
  /** What the collection is. */
  purpose: string;
  /** How the collection is intended to be consumed. */
  intended_use: string;
}

export const COLLECTION_TABLE: Record<SnapshotCollection, string> = {
  panels: ENTITIES.panel.table,
  loads: ENTITIES.load.table,
  circuit_groups: ENTITIES.circuit_group.table,
  feeders: ENTITIES.feeder.table,
  raceways: ENTITIES.raceway.table,
  raceway_waypoints: "electrical_raceway_waypoints",
  junction_boxes: ENTITIES.jbox.table,
  branch_runs: ENTITIES.branch.table,
  panel_breaker_positions: "electrical_breaker_positions",
  panel_exits: "electrical_panel_exits",
  equipment_racks: ENTITIES.rack.table,
  power_assets: ENTITIES.power_asset.table,
  devices: ENTITIES.device.table,
  switch_banks: "electrical_switch_banks",
  switch_devices: "electrical_switch_devices",
  control_groups: "electrical_control_groups",
  control_targets: "electrical_control_targets",
  control_wiring_segments: "electrical_control_wiring_segments",
};

const COLLECTION_KIND: Partial<Record<SnapshotCollection, ElectricalEntityKind>> = {
  panels: "panel",
  loads: "load",
  circuit_groups: "circuit_group",
  feeders: "feeder",
  raceways: "raceway",
  junction_boxes: "jbox",
  branch_runs: "branch",
  equipment_racks: "rack",
  power_assets: "power_asset",
  devices: "device",
};

const COLLECTION_PURPOSE: Record<SnapshotCollection, [string, string]> = {
  panels: [
    "Distribution equipment (PNL-*) with rating, location and install state.",
    "Panel schedules, cover labels and as-built panel documentation.",
  ],
  loads: [
    "Canonical Load_Master-derived loads (FS-*) with electrical and location fields.",
    "Load schedules, critical-load reporting and grid/location documents.",
  ],
  circuit_groups: [
    "Logical circuits grouping loads onto one overcurrent device.",
    "Circuit directories and breaker-to-load traces.",
  ],
  feeders: ["Feeders between service or panel equipment.", "One-line and feeder schedules."],
  raceways: [
    "Conduit runs (EMT-*) with endpoints, fill and environment.",
    "Conduit schedules, pull sheets and routing documents.",
  ],
  raceway_waypoints: [
    "Ordered physical waypoints along a raceway.",
    "Routing drawings and measured run lengths.",
  ],
  junction_boxes: [
    "Junction boxes (JB-*) positioned along a raceway.",
    "Pull-point documentation and box-fill checks.",
  ],
  branch_runs: [
    "Branch runs — branch-circuit conductor routing (BR-*) between endpoints.",
    "Home-run schedules and conductor documentation.",
  ],
  panel_breaker_positions: [
    "One record per physical breaker space in a panel.",
    "Panel-schedule generation and breaker directory labels.",
  ],
  panel_exits: [
    "Physical raceway penetrations of a panel enclosure.",
    "Panel elevation drawings and conduit-entry documentation.",
  ],
  equipment_racks: [
    "FarmOps-native equipment racks (RACK-*).",
    "Rack elevations and power-dependency documents.",
  ],
  power_assets: [
    "FarmOps-native power assets (PSU-*, UPS, inverters).",
    "Power dependency chains and backup documentation.",
  ],
  devices: [
    "FarmOps-native powered devices linked to loads and racks.",
    "Device inventories and dependency documents.",
  ],
};

export const API_RESOURCES: ApiResource[] = SNAPSHOT_COLLECTIONS.map((name) => {
  const [purpose, intended] = COLLECTION_PURPOSE[name];
  return {
    name,
    kind: COLLECTION_KIND[name] ?? null,
    table: COLLECTION_TABLE[name],
    purpose,
    intended_use: intended,
  };
});

export function apiResource(name: string): ApiResource | undefined {
  return API_RESOURCES.find((r) => r.name === name);
}

/* ------------------------------------------------------- exclusion notice */

export interface ApiExclusion {
  id: string;
  title: string;
  detail: string;
}

export const ELECTRICAL_API_EXCLUSIONS: ApiExclusion[] = [
  {
    id: "sor_administration",
    title: "System-of-record administration is out of scope",
    detail:
      "Import contracts, mapping repair, adjudication, apply gates, entitlement and role administration are UI-only, owner-approved workflows. The API exposes no endpoint for them.",
  },
  {
    id: "canonical_ods_write_back",
    title: "No canonical ODS write-back",
    detail:
      "PremoFarmElectrical.ods remains the engineering system of record and is never written by FarmOps. The API neither uploads nor mutates canonical workbook values.",
  },
  {
    id: "unrestricted_mutation",
    title: "No unrestricted database mutation",
    detail:
      "There is no generic PATCH/PUT/DELETE and no SQL passthrough. The only writes are the relationship endpoint (an allow-listed FK plus its derived mirror columns) and the field-observation endpoint (an append-only journal row). Both require explicit per-record approval and are audited.",
  },
];

/* ----------------------------------------------------------- relationships */

export interface RelationshipProposal {
  /** Entity kind of the record being linked, e.g. "raceway". */
  kind: string;
  /** Stable ID of the record being linked, e.g. "EMT-104". */
  stable_id: string;
  /** FK column to set, e.g. "source_panel_uuid". Must be in the allow-list. */
  relation: string;
  /** Stable ID of the target record, or null to clear the relationship. */
  target_stable_id?: string | null;
  /** Required on apply: why this relationship is being recorded. */
  reason?: string | null;
  /** Required on apply: the caller's explicit per-record approval. */
  approved?: boolean;
}

export interface RelationshipCapability {
  kind: ElectricalEntityKind;
  relation: string;
  target_kind: ElectricalEntityKind;
  /** Derived legacy mirror column kept in sync with the FK. */
  mirror_column: string;
  endpoint_slot: "source" | "dest" | null;
}

export const RELATIONSHIP_CAPABILITIES: RelationshipCapability[] = ENTITY_KINDS.flatMap((kind) =>
  relationsFor(kind).map((spec) => ({
    kind,
    relation: spec.fkColumn,
    target_kind: spec.targetKind,
    mirror_column: spec.refColumn,
    endpoint_slot: spec.slot ?? null,
  })),
);

export function relationSpec(kind: string, relation: string): RelationSpec | undefined {
  const specs = RELATIONS[kind as ElectricalEntityKind];
  if (!specs) return undefined;
  return specs.find((s) => s.fkColumn === relation);
}

/** Columns the relationship endpoint may ever write for a given relation. */
export function relationshipWritableColumns(spec: RelationSpec): string[] {
  const cols = [spec.fkColumn, spec.refColumn];
  if (spec.typeColumn) cols.push(spec.typeColumn);
  return cols;
}

/** Pure shape validation. Existence of the rows is checked server-side. */
export function validateRelationshipProposal(p: RelationshipProposal): string[] {
  const errors: string[] = [];
  if (!p.kind || !ENTITY_KINDS.includes(p.kind as ElectricalEntityKind)) {
    errors.push(`Unknown entity kind "${p.kind}".`);
  }
  if (!p.stable_id || !String(p.stable_id).trim()) errors.push("stable_id is required.");
  if (!p.relation) {
    errors.push("relation is required.");
  } else if (!relationSpec(p.kind, p.relation)) {
    errors.push(`"${p.relation}" is not a recordable relationship for kind "${p.kind}".`);
  }
  if (p.target_stable_id !== null && p.target_stable_id !== undefined) {
    if (!String(p.target_stable_id).trim()) {
      errors.push("target_stable_id must be a stable ID or null to clear the link.");
    }
  }
  return errors;
}

/* ------------------------------------------------------ field observations */

/** Columns the field-observation endpoint may write. Nothing else is allowed. */
export const OBSERVATION_WRITABLE_COLUMNS = [
  "workbook",
  "worksheet",
  "source_row",
  "source_column",
  "panel_ref",
  "panel_uuid",
  "side",
  "position",
  "poles",
  "field",
  "observed_text",
  "interpreted_value",
  "confidence",
  "notes",
  "scope",
  "disposition",
  "verification_status",
  "observed_at",
  "apply_status",
] as const;

export const OBSERVATION_CONFIDENCE = ["high", "medium", "low"] as const;
export const OBSERVATION_VERIFICATION = [
  "verified_as_installed",
  "field_confirmation_required",
  "updated_from_field_observation",
  "intentionally_mobile",
  "not_yet_installed",
] as const;

export interface ObservationProposal {
  /** Stable ID the observation is about, e.g. "PNL-FS-NW" or "FS-082". */
  stable_id: string;
  /** Which aspect was observed, e.g. "install_status", "grid", "breaker". */
  field: string;
  /** Verbatim field text as observed. Never normalised away. */
  observed_text: string;
  /** Optional interpretation of the observation. */
  interpreted_value?: string | null;
  confidence?: string | null;
  verification_status?: string | null;
  notes?: string | null;
  side?: string | null;
  position?: number | null;
  poles?: number | null;
  /** Required on apply: the caller's explicit per-record approval. */
  approved?: boolean;
}

export function validateObservationProposal(o: ObservationProposal): string[] {
  const errors: string[] = [];
  if (!o.stable_id || !String(o.stable_id).trim()) errors.push("stable_id is required.");
  if (!o.field || !String(o.field).trim()) errors.push("field is required.");
  if (!o.observed_text || !String(o.observed_text).trim()) {
    errors.push("observed_text is required — record what was actually seen.");
  }
  if (o.confidence && !OBSERVATION_CONFIDENCE.includes(o.confidence as never)) {
    errors.push(`confidence must be one of ${OBSERVATION_CONFIDENCE.join(", ")}.`);
  }
  if (
    o.verification_status &&
    !OBSERVATION_VERIFICATION.includes(o.verification_status as never)
  ) {
    errors.push(`verification_status must be one of ${OBSERVATION_VERIFICATION.join(", ")}.`);
  }
  if (o.position != null && !Number.isInteger(o.position)) errors.push("position must be an integer.");
  if (o.poles != null && !Number.isInteger(o.poles)) errors.push("poles must be an integer.");
  return errors;
}

/* --------------------------------------------------------------- endpoints */

export interface ApiEndpoint {
  method: "GET" | "POST";
  path: string;
  summary: string;
  /** Required named scope, or "public" for the unauthenticated specification. */
  scope: ApiScope | "public";
  /** Entitlement mode enforced server-side for interactive callers. */
  access: "read" | "field_write" | "public";
  rate_bucket: "read" | "write";
  writes: boolean;
  /** Delivery phase. Phase 1 is the read-only integration. */
  phase: 1 | 2 | 3;
  /**
   * Whether the endpoint is reachable. Phase 2 and 3 surfaces stay unactivated
   * until Phase 1 acceptance is signed off; they answer 503
   * `write_scopes_not_activated` instead of doing anything.
   */
  activated: boolean;
  intended_use: string;
}

/**
 * Phase 2/3 activation switch. Deliberately a source constant, not an env flag:
 * turning production write scopes on is a reviewed code change, not a config
 * toggle someone can flip by accident.
 */
export const WRITE_SCOPES_ACTIVATED = false;

export const ELECTRICAL_API_ENDPOINTS: ApiEndpoint[] = [
  {
    method: "GET",
    path: `${ELECTRICAL_API_BASE}`,
    summary: "API index: version, scopes, resources, endpoints, limits and exclusions.",
    scope: "electrical:read",
    access: "read",
    rate_bucket: "read",
    writes: false,
    phase: 1,
    activated: true,
    intended_use: "Capability discovery before generating documents.",
  },
  {
    method: "GET",
    path: OPENAPI_PATH,
    summary: "OpenAPI 3.1 specification for this version.",
    scope: "public",
    access: "public",
    rate_bucket: "read",
    writes: false,
    phase: 1,
    activated: true,
    intended_use: "Client/SDK generation and contract tests.",
  },
  {
    method: "GET",
    path: `${ELECTRICAL_API_BASE}/sor/status`,
    summary: "System-of-record status: authority, canonical baseline hash, phase activation.",
    scope: "electrical:sor:read",
    access: "read",
    rate_bucket: "read",
    writes: false,
    phase: 1,
    activated: true,
    intended_use: "Prove which truth a consumer is reading before it prints anything.",
  },
  {
    method: "GET",
    path: `${ELECTRICAL_API_BASE}/snapshot`,
    summary: "Full versioned snapshot envelope: collections, hashes, manifest, QA, warnings.",
    scope: "electrical:read",
    access: "read",
    rate_bucket: "read",
    writes: false,
    phase: 1,
    activated: true,
    intended_use: "One-shot pull for external reconciliation and document builds.",
  },
  {
    method: "GET",
    path: `${ELECTRICAL_API_BASE}/resources/{collection}`,
    summary: "One snapshot collection.",
    scope: "electrical:read",
    access: "read",
    rate_bucket: "read",
    writes: false,
    phase: 1,
    activated: true,
    intended_use: "Targeted document sections (panel schedules, conduit schedules).",
  },
  {
    method: "GET",
    path: `${ELECTRICAL_API_BASE}/records/{stable_id}`,
    summary: "Every collection record carrying this stable ID.",
    scope: "electrical:read",
    access: "read",
    rate_bucket: "read",
    writes: false,
    phase: 1,
    activated: true,
    intended_use: "Per-asset documentation and QR/label detail pages.",
  },
  {
    method: "GET",
    path: `${ELECTRICAL_API_BASE}/qa`,
    summary: "QA findings (reported, never enforced).",
    scope: "electrical:read",
    access: "read",
    rate_bucket: "read",
    writes: false,
    phase: 1,
    activated: true,
    intended_use: "QA appendices and gap reporting in generated documents.",
  },
  {
    method: "GET",
    path: `${ELECTRICAL_API_BASE}/documents/bundle`,
    summary: "Document-generation bundle: snapshot envelope, QA summary and section manifest.",
    scope: "electrical:documents:read",
    access: "read",
    rate_bucket: "read",
    writes: false,
    phase: 1,
    activated: true,
    intended_use: "Single call that feeds the external document generator.",
  },
  {
    method: "GET",
    path: `${ELECTRICAL_API_BASE}/audit-batches`,
    summary: "Field-audit batch metadata staged or applied on this instance.",
    scope: "electrical:audit-batches:read",
    access: "read",
    rate_bucket: "read",
    writes: false,
    phase: 1,
    activated: true,
    intended_use: "Let a peer instance discover which audit batches exist and their status.",
  },
  {
    method: "GET",
    path: `${ELECTRICAL_API_BASE}/audit-batches/{batch_id}/manifest`,
    summary:
      "Export one stored field-audit manifest with its checksum, for preview-only staging on a peer instance.",
    scope: "electrical:audit-batches:read",
    access: "read",
    rate_bucket: "read",
    writes: false,
    phase: 1,
    activated: true,
    intended_use:
      "Keep a second FarmOps instance in sync: the importer stages a preview and still requires per-item owner approval.",
  },
  {
    method: "POST",
    path: `${ELECTRICAL_API_BASE}/relationships/preview`,
    summary: "Preview relationship changes. No writes. Not activated.",
    scope: "electrical:relationships:write",
    access: "field_write",
    rate_bucket: "write",
    writes: false,
    phase: 3,
    activated: WRITE_SCOPES_ACTIVATED,
    intended_use: "Show before/after and mirror columns before anyone approves.",
  },
  {
    method: "POST",
    path: `${ELECTRICAL_API_BASE}/relationships/apply`,
    summary: "Apply approved relationship changes (FK + derived mirrors only). Not activated.",
    scope: "electrical:relationships:write",
    access: "field_write",
    rate_bucket: "write",
    writes: true,
    phase: 3,
    activated: WRITE_SCOPES_ACTIVATED,
    intended_use: "Record a verified physical connection; audited per record.",
  },
  {
    method: "POST",
    path: `${ELECTRICAL_API_BASE}/field-observations/preview`,
    summary: "Validate field observations and echo the exact row to be written. Not activated.",
    scope: "electrical:observations:write",
    access: "field_write",
    rate_bucket: "write",
    writes: false,
    phase: 2,
    activated: WRITE_SCOPES_ACTIVATED,
    intended_use: "Client-side validation before a walkaround submission.",
  },
  {
    method: "POST",
    path: `${ELECTRICAL_API_BASE}/field-observations/apply`,
    summary: "Append approved field observations to the field journal. Not activated.",
    scope: "electrical:observations:write",
    access: "field_write",
    rate_bucket: "write",
    writes: true,
    phase: 2,
    activated: WRITE_SCOPES_ACTIVATED,
    intended_use: "Capture what was actually observed; engineering rows untouched.",
  },
];

export function apiEndpoint(method: string, path: string): ApiEndpoint | undefined {
  return ELECTRICAL_API_ENDPOINTS.find(
    (e) => e.method === method.toUpperCase() && e.path === path,
  );
}

/** Read endpoints accepted at the pre-acceptance path, with a deprecation notice. */
export const LEGACY_PATH_ALIAS = {
  base: ELECTRICAL_API_LEGACY_BASE,
  openapi: `${ELECTRICAL_API_LEGACY_BASE}/openapi.json`,
  status: "deprecated",
  successor_base: ELECTRICAL_API_BASE,
  successor_openapi: OPENAPI_PATH,
  note: "Served for existing callers. Responses carry Deprecation and Link headers.",
} as const;

/* ----------------------------------------------------------------- OpenAPI */

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const json = (description: string, schema: Record<string, unknown>) => ({
  description,
  content: { "application/json": { schema } },
});

const errorResponses = (extra?: Record<string, unknown>) => ({
  "400": json("Malformed request.", ref("Error")),
  "401": json("Missing, invalid, disabled or expired credential.", ref("Error")),
  "403": json("Entitlement missing, or the credential lacks the required scope.", ref("Error")),
  "429": json("Rate limit exceeded for this principal.", ref("Error")),
  "500": json("Unexpected server error.", ref("Error")),
  ...extra,
});

const requestIdHeader = {
  name: "X-Request-Id",
  in: "header",
  required: false,
  description:
    "Optional correlation ID (8-64 chars of [A-Za-z0-9_.:-]). Echoed in the response body and the X-Request-Id header; generated when absent or unusable.",
  schema: { type: "string", pattern: "^[A-Za-z0-9_.:-]{8,64}$" },
};

const secured = (scope: ApiScope) => [{ bearerAuth: [] }, { servicePrincipal: [] }, { scopedToken: [scope] }];

function operation(endpoint: ApiEndpoint, extra: Record<string, unknown>): Record<string, unknown> {
  const notActivated = endpoint.activated
    ? {}
    : {
        "503": json(
          "Write scopes are not activated: Phase 1 acceptance gates Phase 2 and 3.",
          ref("Error"),
        ),
      };
  return {
    summary: endpoint.summary,
    description: `${endpoint.intended_use}\n\nRequired scope: \`${endpoint.scope}\`. Rate bucket: \`${endpoint.rate_bucket}\`.`,
    tags: [endpoint.phase === 1 ? "read" : "write (not activated)"],
    parameters: [requestIdHeader],
    security: endpoint.scope === "public" ? [] : secured(endpoint.scope),
    "x-farmops-phase": endpoint.phase,
    "x-farmops-activated": endpoint.activated,
    "x-required-scope": endpoint.scope,
    "x-rate-limit": rateLimitFor(endpoint.rate_bucket),
    responses: {
      ...(extra["responses"] as Record<string, unknown>),
      ...(endpoint.scope === "public" ? {} : errorResponses(notActivated)),
    },
    ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== "responses")),
  };
}

const schemas: Record<string, unknown> = {
  Error: {
    type: "object",
    required: ["error", "request_id", "api_version"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message"],
        properties: {
          code: { type: "string", enum: Object.keys(API_ERROR_CODES) },
          message: { type: "string" },
          details: { type: ["object", "array", "null"] },
        },
      },
      request_id: { type: "string" },
      api_version: { type: "string", const: ELECTRICAL_API_VERSION },
    },
  },
  QaFinding: {
    type: "object",
    required: ["code", "severity", "message"],
    properties: {
      code: { type: "string" },
      severity: { type: "string", enum: ["error", "warning", "info"] },
      stable_id: { type: ["string", "null"] },
      message: { type: "string" },
    },
  },
  SourceManifestEntry: {
    type: "object",
    required: ["collection", "source", "origin", "authority", "record_count"],
    properties: {
      collection: { type: "string" },
      source: { type: "string" },
      origin: { type: "string", enum: ["farmops_table", "derived_from_snapshot"] },
      authority: {
        type: "string",
        enum: ["farmops_field_as_built", "engineering_design_via_import", "farmops_native"],
      },
      record_count: { type: "integer", minimum: 0 },
      data_updated_through: { type: ["string", "null"], format: "date-time" },
      canonical_counterpart: { type: "string" },
    },
  },
  UnreliableFieldWarning: {
    type: "object",
    required: ["field", "collection", "severity", "reason", "guidance"],
    properties: {
      field: { type: "string", enum: KNOWN_UNRELIABLE_FIELDS.map((f) => f.field) },
      collection: { type: "string" },
      severity: { type: "string", const: "warning" },
      populated_records: { type: "integer", minimum: 0 },
      total_records: { type: "integer", minimum: 0 },
      reason: { type: "string" },
      guidance: { type: "string" },
    },
  },
  Circuit: {
    type: "object",
    required: ["stable_id", "panel_basis", "load_stable_ids", "load_count"],
    properties: {
      stable_id: { type: ["string", "null"], pattern: "^CG-[0-9]{3,}$" },
      circuit_group_uuid: { type: ["string", "null"], format: "uuid" },
      panel_stable_id: { type: ["string", "null"], pattern: "^PNL-[A-Z0-9-]+$" },
      breaker_position_stable_ids: { type: "array", items: { type: "string" } },
      breaker_ocp_amps: { type: ["number", "null"] },
      load_stable_ids: { type: "array", items: { type: "string" } },
      load_count: { type: "integer", minimum: 0 },
      panel_basis: {
        type: "string",
        enum: ["circuit_group_fk", "breaker_position", "not_in_record"],
      },
    },
  },
  Relationship: {
    type: "object",
    required: ["from_collection", "from_stable_id", "relation", "to_stable_id", "basis"],
    properties: {
      from_collection: { type: "string", enum: [...SNAPSHOT_COLLECTIONS] },
      from_stable_id: { type: "string" },
      relation: { type: "string" },
      to_stable_id: { type: "string" },
      basis: {
        type: "string",
        const: "recorded_fk",
        description: "Nothing here is inferred; a missing edge means not established in the record.",
      },
    },
  },
  Observation: {
    type: "object",
    required: ["stable_id", "field", "observed_text"],
    properties: {
      observed_at: { type: ["string", "null"], format: "date-time" },
      stable_id: { type: ["string", "null"] },
      field: { type: ["string", "null"] },
      observed_text: { type: ["string", "null"] },
      interpreted_value: { type: ["string", "null"] },
      confidence: { type: ["string", "null"], enum: [...OBSERVATION_CONFIDENCE, null] },
      verification_status: { type: ["string", "null"], enum: [...OBSERVATION_VERIFICATION, null] },
      disposition: { type: ["string", "null"] },
      scope: { type: ["string", "null"] },
    },
  },
  ChangeLogSummary: {
    type: "object",
    required: ["total", "by_section", "by_action", "by_entity_kind"],
    properties: {
      total: { type: "integer", minimum: 0 },
      by_section: { type: "object", additionalProperties: { type: "integer" } },
      by_action: { type: "object", additionalProperties: { type: "integer" } },
      by_entity_kind: { type: "object", additionalProperties: { type: "integer" } },
      first_change_at: { type: ["string", "null"], format: "date-time" },
      latest_change_at: { type: ["string", "null"], format: "date-time" },
    },
  },
  SnapshotEnvelope: {
    type: "object",
    required: [
      "api_version",
      "api_schema_version",
      "snapshot_schema_version",
      "snapshot_id",
      "generated_at",
      "data_updated_through",
      "authority",
      "hashes",
      "source_manifest",
      "counts",
      "warnings",
      "qa",
      "change_log",
      "collections",
      "request_id",
    ],
    properties: {
      api_version: { type: "string", const: ELECTRICAL_API_VERSION },
      api_schema_version: { type: "string" },
      snapshot_schema_version: { type: "string" },
      snapshot_id: {
        type: "string",
        pattern: "^snap_[0-9a-f]{24}$",
        description: "Derived from farmops_snapshot_hash: identical data yields an identical id.",
      },
      generated_at: { type: "string", format: "date-time" },
      data_updated_through: { type: ["string", "null"], format: "date-time" },
      request_id: { type: "string" },
      authority: { type: "object", additionalProperties: true },
      hashes: {
        type: "object",
        required: ["algorithm", "canonical_ods_sha256", "farmops_snapshot_hash", "content_hash"],
        properties: {
          algorithm: { type: "string", const: "sha256" },
          canonical_ods_sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
          farmops_snapshot_hash: { type: "string", pattern: "^[0-9a-f]{64}$" },
          content_hash: { type: "string", pattern: "^[0-9a-f]{64}$" },
          stability: { type: "string" },
        },
      },
      source_manifest: { type: "array", items: ref("SourceManifestEntry") },
      counts: { type: "object", additionalProperties: { type: "integer" } },
      warnings: {
        type: "object",
        required: ["known_unreliable_fields"],
        properties: {
          known_unreliable_fields: { type: "array", items: ref("UnreliableFieldWarning") },
        },
      },
      qa: {
        type: "object",
        properties: {
          errors: { type: "integer" },
          warnings: { type: "integer" },
          findings: { type: "array", items: ref("QaFinding") },
        },
      },
      change_log: ref("ChangeLogSummary"),
      field_ownership: { type: "object", additionalProperties: true },
      metadata_fields: { type: "array", items: { type: "string" } },
      collections: {
        type: "object",
        properties: {
          ...Object.fromEntries(
            SNAPSHOT_COLLECTIONS.map((c) => [
              c,
              { type: "array", items: { type: "object", additionalProperties: true } },
            ]),
          ),
          circuits: { type: "array", items: ref("Circuit") },
          relationships: { type: "array", items: ref("Relationship") },
          observations: { type: "array", items: ref("Observation") },
        },
      },
      excluded_by_design: { type: "array", items: { type: "object", additionalProperties: true } },
    },
  },
  CollectionResponse: {
    type: "object",
    required: ["api_version", "request_id", "collection", "count", "records"],
    properties: {
      api_version: { type: "string" },
      request_id: { type: "string" },
      snapshot_id: { type: "string" },
      collection: { type: "string" },
      resource: { type: "object", additionalProperties: true },
      stable_id_format: { type: ["object", "null"], additionalProperties: true },
      count: { type: "integer", minimum: 0 },
      records: { type: "array", items: { type: "object", additionalProperties: true } },
      warnings: { type: "array", items: ref("UnreliableFieldWarning") },
    },
  },
  RecordResponse: {
    type: "object",
    required: ["api_version", "request_id", "stable_id", "count", "collections"],
    properties: {
      api_version: { type: "string" },
      request_id: { type: "string" },
      snapshot_id: { type: "string" },
      stable_id: { type: "string" },
      count: { type: "integer", minimum: 1 },
      collections: { type: "object", additionalProperties: { type: "array" } },
      relationships: { type: "array", items: ref("Relationship") },
      observations: { type: "array", items: ref("Observation") },
    },
  },
  QaResponse: {
    type: "object",
    required: ["api_version", "request_id", "errors", "warnings", "findings"],
    properties: {
      api_version: { type: "string" },
      request_id: { type: "string" },
      snapshot_id: { type: "string" },
      errors: { type: "integer", minimum: 0 },
      warnings: { type: "integer", minimum: 0 },
      findings: { type: "array", items: ref("QaFinding") },
    },
  },
  DocumentBundle: {
    type: "object",
    required: ["api_version", "request_id", "snapshot", "manifest", "excluded_by_design"],
    properties: {
      api_version: { type: "string" },
      request_id: { type: "string" },
      snapshot: ref("SnapshotEnvelope"),
      manifest: {
        type: "array",
        items: {
          type: "object",
          required: ["collection", "count"],
          properties: {
            collection: { type: "string" },
            table: { type: "string" },
            count: { type: "integer" },
            purpose: { type: "string" },
            intended_use: { type: "string" },
          },
        },
      },
      excluded_by_design: { type: "array", items: { type: "object", additionalProperties: true } },
    },
  },
  SorStatus: {
    type: "object",
    required: ["api_version", "request_id", "system_of_record", "canonical_baseline", "phases"],
    properties: {
      api_version: { type: "string" },
      request_id: { type: "string" },
      system_of_record: { type: "object", additionalProperties: true },
      canonical_baseline: {
        type: "object",
        required: ["file", "sha256", "written_by_farmops"],
        properties: {
          file: { type: "string" },
          sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
          authorization: { type: "string" },
          written_by_farmops: { type: "boolean", const: false },
        },
      },
      farmops_record: { type: "object", additionalProperties: true },
      phases: {
        type: "array",
        items: {
          type: "object",
          required: ["phase", "name", "status"],
          properties: {
            phase: { type: "integer" },
            name: { type: "string" },
            status: { type: "string" },
            endpoints: { type: "array", items: { type: "string" } },
          },
        },
      },
      write_scopes: { type: "object", additionalProperties: true },
      exclusions: { type: "array", items: { type: "object", additionalProperties: true } },
    },
  },
  ApiIndex: {
    type: "object",
    required: ["api_version", "request_id", "base_path", "scopes", "endpoints", "resources"],
    properties: {
      api_version: { type: "string" },
      api_schema_version: { type: "string" },
      request_id: { type: "string" },
      base_path: { type: "string" },
      openapi_path: { type: "string" },
      scopes: { type: "object", additionalProperties: { type: "string" } },
      granted_scopes: { type: "array", items: { type: "string" } },
      principal: { type: "object", additionalProperties: true },
      rate_limits: { type: "array", items: { type: "object", additionalProperties: true } },
      error_codes: { type: "object", additionalProperties: { type: "integer" } },
      stable_id_formats: { type: "array", items: { type: "object", additionalProperties: true } },
      endpoints: { type: "array", items: { type: "object", additionalProperties: true } },
      resources: { type: "array", items: { type: "object", additionalProperties: true } },
      exclusions: { type: "array", items: { type: "object", additionalProperties: true } },
      legacy_path_alias: { type: "object", additionalProperties: true },
    },
  },
  RelationshipProposal: {
    type: "object",
    required: ["kind", "stable_id", "relation"],
    properties: {
      kind: { type: "string", enum: [...ENTITY_KINDS] },
      stable_id: { type: "string" },
      relation: { type: "string" },
      target_stable_id: { type: ["string", "null"] },
      reason: { type: ["string", "null"] },
      approved: { type: "boolean" },
      expected_record_version: {
        type: ["string", "null"],
        description: "Phase 3 optimistic concurrency: current updated_at. Mismatch returns 409.",
      },
      idempotency_key: { type: ["string", "null"] },
      preview_token: { type: ["string", "null"] },
      effective_date: { type: ["string", "null"], format: "date" },
    },
  },
  ObservationProposal: {
    type: "object",
    required: ["stable_id", "field", "observed_text"],
    properties: {
      stable_id: { type: "string" },
      field: { type: "string" },
      observed_text: { type: "string" },
      interpreted_value: { type: ["string", "null"] },
      confidence: { type: ["string", "null"], enum: [...OBSERVATION_CONFIDENCE, null] },
      verification_status: { type: ["string", "null"], enum: [...OBSERVATION_VERIFICATION, null] },
      notes: { type: ["string", "null"] },
      side: { type: ["string", "null"] },
      position: { type: ["integer", "null"] },
      poles: { type: ["integer", "null"] },
      approved: { type: "boolean" },
      expected_record_version: { type: ["string", "null"] },
      idempotency_key: { type: ["string", "null"] },
      preview_token: { type: ["string", "null"] },
      effective_date: { type: ["string", "null"], format: "date" },
    },
  },
};

const proposalBody = (schema: string) => ({
  required: true,
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: ["proposals"],
        properties: {
          proposals: { type: "array", minItems: 1, items: ref(schema) },
        },
      },
    },
  },
});

const conflict = {
  "409": json(
    "Optimistic-concurrency, preview-binding or idempotency conflict.",
    ref("Error"),
  ),
};

export function buildOpenApiDocument(serverUrl?: string): Record<string, unknown> {
  const find = (method: string, path: string) => apiEndpoint(method, path)!;
  const paths: Record<string, unknown> = {
    [ELECTRICAL_API_BASE]: {
      get: operation(find("GET", ELECTRICAL_API_BASE), {
        operationId: "electricalApiIndex",
        responses: { "200": json("API descriptor.", ref("ApiIndex")) },
      }),
    },
    [OPENAPI_PATH]: {
      get: operation(find("GET", OPENAPI_PATH), {
        operationId: "electricalApiOpenApi",
        responses: {
          "200": json("This document.", { type: "object", additionalProperties: true }),
        },
      }),
    },
    [`${ELECTRICAL_API_BASE}/sor/status`]: {
      get: operation(find("GET", `${ELECTRICAL_API_BASE}/sor/status`), {
        operationId: "electricalApiSorStatus",
        responses: { "200": json("System-of-record status.", ref("SorStatus")) },
      }),
    },
    [`${ELECTRICAL_API_BASE}/snapshot`]: {
      get: operation(find("GET", `${ELECTRICAL_API_BASE}/snapshot`), {
        operationId: "electricalApiSnapshot",
        responses: { "200": json("Versioned snapshot envelope.", ref("SnapshotEnvelope")) },
      }),
    },
    [`${ELECTRICAL_API_BASE}/resources/{collection}`]: {
      get: operation(find("GET", `${ELECTRICAL_API_BASE}/resources/{collection}`), {
        operationId: "electricalApiResource",
        parameters: [
          requestIdHeader,
          {
            name: "collection",
            in: "path",
            required: true,
            schema: { type: "string", enum: [...SNAPSHOT_COLLECTIONS, "circuits", "relationships", "observations"] },
          },
        ],
        responses: {
          "200": json("Collection records.", ref("CollectionResponse")),
          "404": json("Unknown collection.", ref("Error")),
        },
      }),
    },
    [`${ELECTRICAL_API_BASE}/records/{stable_id}`]: {
      get: operation(find("GET", `${ELECTRICAL_API_BASE}/records/{stable_id}`), {
        operationId: "electricalApiRecord",
        parameters: [
          requestIdHeader,
          {
            name: "stable_id",
            in: "path",
            required: true,
            description: STABLE_ID_FORMATS.filter((f) => f.pattern)
              .map((f) => `${f.collection}: ${f.pattern} (e.g. ${f.example})`)
              .join("; "),
            schema: { type: "string", minLength: 2, maxLength: 64 },
          },
        ],
        responses: {
          "200": json("Matching records per collection.", ref("RecordResponse")),
          "404": json("No record with that stable ID.", ref("Error")),
        },
      }),
    },
    [`${ELECTRICAL_API_BASE}/qa`]: {
      get: operation(find("GET", `${ELECTRICAL_API_BASE}/qa`), {
        operationId: "electricalApiQa",
        responses: { "200": json("Findings with counts.", ref("QaResponse")) },
      }),
    },
    [`${ELECTRICAL_API_BASE}/documents/bundle`]: {
      get: operation(find("GET", `${ELECTRICAL_API_BASE}/documents/bundle`), {
        operationId: "electricalApiDocumentBundle",
        responses: { "200": json("Snapshot, QA and section manifest.", ref("DocumentBundle")) },
      }),
    },
    [`${ELECTRICAL_API_BASE}/audit-batches`]: {
      get: operation(find("GET", `${ELECTRICAL_API_BASE}/audit-batches`), {
        operationId: "electricalApiAuditBatches",
        responses: {
          "200": json("Batch metadata for this instance.", {
            type: "object",
            additionalProperties: true,
          }),
        },
      }),
    },
    [`${ELECTRICAL_API_BASE}/audit-batches/{batch_id}/manifest`]: {
      get: operation(find("GET", `${ELECTRICAL_API_BASE}/audit-batches/{batch_id}/manifest`), {
        operationId: "electricalApiAuditBatchManifest",
        parameters: [
          requestIdHeader,
          {
            name: "batch_id",
            in: "path",
            required: true,
            description: "Batch identifier, e.g. FA-FS-2026-09-03-PM.",
            schema: { type: "string", minLength: 3, maxLength: 128 },
          },
        ],
        responses: {
          "200": json("Stored manifest, checksums and staging contract.", {
            type: "object",
            additionalProperties: true,
          }),
          "404": json("No batch with that identifier.", ref("Error")),
        },
      }),
    },
    [`${ELECTRICAL_API_BASE}/relationships/preview`]: {
      post: operation(find("POST", `${ELECTRICAL_API_BASE}/relationships/preview`), {
        operationId: "electricalApiRelationshipsPreview",
        requestBody: proposalBody("RelationshipProposal"),
        responses: {
          "200": json("Per-proposal preview.", { type: "object", additionalProperties: true }),
        },
      }),
    },
    [`${ELECTRICAL_API_BASE}/relationships/apply`]: {
      post: operation(find("POST", `${ELECTRICAL_API_BASE}/relationships/apply`), {
        operationId: "electricalApiRelationshipsApply",
        requestBody: proposalBody("RelationshipProposal"),
        responses: {
          "200": json("Per-proposal apply result.", { type: "object", additionalProperties: true }),
          ...conflict,
        },
      }),
    },
    [`${ELECTRICAL_API_BASE}/field-observations/preview`]: {
      post: operation(find("POST", `${ELECTRICAL_API_BASE}/field-observations/preview`), {
        operationId: "electricalApiObservationsPreview",
        requestBody: proposalBody("ObservationProposal"),
        responses: {
          "200": json("Validation and row echo.", { type: "object", additionalProperties: true }),
        },
      }),
    },
    [`${ELECTRICAL_API_BASE}/field-observations/apply`]: {
      post: operation(find("POST", `${ELECTRICAL_API_BASE}/field-observations/apply`), {
        operationId: "electricalApiObservationsApply",
        requestBody: proposalBody("ObservationProposal"),
        responses: {
          "200": json("Inserted observation ids.", { type: "object", additionalProperties: true }),
          ...conflict,
        },
      }),
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "FarmOps Electrical API",
      version: `${ELECTRICAL_API_VERSION} (${ELECTRICAL_API_SCHEMA_VERSION})`,
      description: [
        "Read-only access to the FarmOps electrical field record.",
        "",
        "Authority: PremoFarmElectrical.ods is the engineering system of record and is",
        "never written by FarmOps. FarmOps is the authority for the field/as-built",
        "record projected here. Every snapshot reports the canonical baseline hash, a",
        "data hash, a content hash and a per-collection source manifest.",
        "",
        "Phase 2 (field observations) and Phase 3 (relationships) write surfaces are",
        `defined but NOT activated: they answer 503 write_scopes_not_activated until`,
        "Phase 1 acceptance is signed off.",
        "",
        "Out of scope by design:",
        ...ELECTRICAL_API_EXCLUSIONS.map((e) => `- ${e.title}: ${e.detail}`),
      ].join("\n"),
    },
    servers: [{ url: serverUrl ?? "/" }],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: "read", description: "Phase 1 read-only integration." },
      { name: "write (not activated)", description: "Phase 2/3 surfaces, currently disabled." },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Interactive user session token. Scopes derive from electrical entitlement.",
        },
        servicePrincipal: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "farmops_sk_*",
          description:
            "Scoped service-principal key. Scopes are stored with the principal and cannot be widened by the caller.",
        },
        scopedToken: {
          type: "oauth2",
          description: "Named scopes enforced per endpoint.",
          flows: {
            clientCredentials: {
              tokenUrl: "https://bostead.lovable.app/settings/api-principals",
              scopes: API_SCOPES,
            },
          },
        },
      },
      schemas,
    },
    "x-farmops-exclusions": ELECTRICAL_API_EXCLUSIONS,
    "x-farmops-resources": API_RESOURCES,
    "x-farmops-relationship-capabilities": RELATIONSHIP_CAPABILITIES,
    "x-farmops-scopes": API_SCOPES,
    "x-farmops-rate-limits": API_RATE_LIMITS,
    "x-farmops-error-codes": API_ERROR_CODES,
    "x-farmops-stable-id-formats": STABLE_ID_FORMATS,
    "x-farmops-legacy-path-alias": LEGACY_PATH_ALIAS,
    "x-farmops-write-scopes-activated": WRITE_SCOPES_ACTIVATED,
    paths,
  };
}

