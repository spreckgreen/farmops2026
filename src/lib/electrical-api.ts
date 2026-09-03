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
import { ENTITIES } from "@/lib/electrical-entities";
import { RELATIONS, relationsFor, type RelationSpec } from "@/lib/electrical-relations";
import { SNAPSHOT_COLLECTIONS, type SnapshotCollection } from "@/lib/electrical-snapshot";
import { ENTITY_KINDS, type ElectricalEntityKind } from "@/lib/electrical";

export const ELECTRICAL_API_VERSION = "v1";
/** Bumped when the wire shape changes in a breaking way. */
export const ELECTRICAL_API_SCHEMA_VERSION = "1.0";
export const ELECTRICAL_API_BASE = `/api/electrical/${ELECTRICAL_API_VERSION}`;

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

const COLLECTION_TABLE: Record<SnapshotCollection, string> = {
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
    "Branch conductor runs (BR-*) between endpoints.",
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
  /** Access mode enforced server-side. */
  access: "read" | "field_write" | "public";
  writes: boolean;
  intended_use: string;
}

export const ELECTRICAL_API_ENDPOINTS: ApiEndpoint[] = [
  {
    method: "GET",
    path: `${ELECTRICAL_API_BASE}`,
    summary: "API index: version, resources, endpoints and exclusions.",
    access: "read",
    writes: false,
    intended_use: "Capability discovery before generating documents.",
  },
  {
    method: "GET",
    path: `${ELECTRICAL_API_BASE}/openapi.json`,
    summary: "OpenAPI 3.1 specification for this version.",
    access: "public",
    writes: false,
    intended_use: "Client/SDK generation and contract tests.",
  },
  {
    method: "GET",
    path: `${ELECTRICAL_API_BASE}/snapshot`,
    summary: "Full versioned reconciliation snapshot (all collections + QA).",
    access: "read",
    writes: false,
    intended_use: "One-shot pull for external reconciliation and document builds.",
  },
  {
    method: "GET",
    path: `${ELECTRICAL_API_BASE}/resources/{collection}`,
    summary: "One snapshot collection.",
    access: "read",
    writes: false,
    intended_use: "Targeted document sections (panel schedules, conduit schedules).",
  },
  {
    method: "GET",
    path: `${ELECTRICAL_API_BASE}/records/{stable_id}`,
    summary: "Every collection record carrying this stable ID.",
    access: "read",
    writes: false,
    intended_use: "Per-asset documentation and QR/label detail pages.",
  },
  {
    method: "GET",
    path: `${ELECTRICAL_API_BASE}/qa`,
    summary: "QA findings (reported, never enforced).",
    access: "read",
    writes: false,
    intended_use: "QA appendices and gap reporting in generated documents.",
  },
  {
    method: "GET",
    path: `${ELECTRICAL_API_BASE}/documents/bundle`,
    summary: "Document-generation bundle: snapshot, QA summary and section manifest.",
    access: "read",
    writes: false,
    intended_use: "Single call that feeds the external document generator.",
  },
  {
    method: "POST",
    path: `${ELECTRICAL_API_BASE}/relationships/preview`,
    summary: "Preview relationship changes. No writes.",
    access: "read",
    writes: false,
    intended_use: "Show before/after and mirror columns before anyone approves.",
  },
  {
    method: "POST",
    path: `${ELECTRICAL_API_BASE}/relationships/apply`,
    summary: "Apply approved relationship changes (FK + derived mirrors only).",
    access: "field_write",
    writes: true,
    intended_use: "Record a verified physical connection; audited per record.",
  },
  {
    method: "POST",
    path: `${ELECTRICAL_API_BASE}/field-observations/preview`,
    summary: "Validate field observations and echo the exact row to be written.",
    access: "read",
    writes: false,
    intended_use: "Client-side validation before a walkaround submission.",
  },
  {
    method: "POST",
    path: `${ELECTRICAL_API_BASE}/field-observations/apply`,
    summary: "Append approved field observations to the field journal.",
    access: "field_write",
    writes: true,
    intended_use: "Capture what was actually observed; engineering rows untouched.",
  },
];

/* ----------------------------------------------------------------- OpenAPI */

const jsonResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: { type: "object" } } },
});

const errorResponses = {
  "401": jsonResponse("Missing or invalid bearer token."),
  "403": jsonResponse("Electrical entitlement missing for the requested access mode."),
};

export function buildOpenApiDocument(serverUrl?: string): Record<string, unknown> {
  const paths: Record<string, unknown> = {
    [ELECTRICAL_API_BASE]: {
      get: {
        summary: "API index",
        operationId: "electricalApiIndex",
        responses: { "200": jsonResponse("API descriptor."), ...errorResponses },
      },
    },
    [`${ELECTRICAL_API_BASE}/openapi.json`]: {
      get: {
        summary: "OpenAPI specification",
        operationId: "electricalApiOpenApi",
        responses: { "200": jsonResponse("This document.") },
      },
    },
    [`${ELECTRICAL_API_BASE}/snapshot`]: {
      get: {
        summary: "Reconciliation snapshot",
        operationId: "electricalApiSnapshot",
        responses: { "200": jsonResponse("Versioned snapshot."), ...errorResponses },
      },
    },
    [`${ELECTRICAL_API_BASE}/resources/{collection}`]: {
      get: {
        summary: "One collection",
        operationId: "electricalApiResource",
        parameters: [
          {
            name: "collection",
            in: "path",
            required: true,
            schema: { type: "string", enum: API_RESOURCES.map((r) => r.name) },
          },
        ],
        responses: {
          "200": jsonResponse("Collection records."),
          "404": jsonResponse("Unknown collection."),
          ...errorResponses,
        },
      },
    },
    [`${ELECTRICAL_API_BASE}/records/{stable_id}`]: {
      get: {
        summary: "Records for one stable ID",
        operationId: "electricalApiRecord",
        parameters: [
          { name: "stable_id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": jsonResponse("Matching records per collection."),
          "404": jsonResponse("No record with that stable ID."),
          ...errorResponses,
        },
      },
    },
    [`${ELECTRICAL_API_BASE}/qa`]: {
      get: {
        summary: "QA findings",
        operationId: "electricalApiQa",
        responses: { "200": jsonResponse("Findings with counts."), ...errorResponses },
      },
    },
    [`${ELECTRICAL_API_BASE}/documents/bundle`]: {
      get: {
        summary: "Document-generation bundle",
        operationId: "electricalApiDocumentBundle",
        responses: { "200": jsonResponse("Snapshot, QA and section manifest."), ...errorResponses },
      },
    },
    [`${ELECTRICAL_API_BASE}/relationships/preview`]: {
      post: {
        summary: "Preview relationship changes",
        operationId: "electricalApiRelationshipsPreview",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["proposals"],
                properties: {
                  proposals: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["kind", "stable_id", "relation"],
                      properties: {
                        kind: { type: "string" },
                        stable_id: { type: "string" },
                        relation: { type: "string" },
                        target_stable_id: { type: ["string", "null"] },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { "200": jsonResponse("Per-proposal preview."), ...errorResponses },
      },
    },
    [`${ELECTRICAL_API_BASE}/relationships/apply`]: {
      post: {
        summary: "Apply approved relationship changes",
        operationId: "electricalApiRelationshipsApply",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["proposals"],
                properties: {
                  proposals: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["kind", "stable_id", "relation", "approved", "reason"],
                      properties: {
                        kind: { type: "string" },
                        stable_id: { type: "string" },
                        relation: { type: "string" },
                        target_stable_id: { type: ["string", "null"] },
                        approved: { type: "boolean", enum: [true] },
                        reason: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { "200": jsonResponse("Per-proposal apply result."), ...errorResponses },
      },
    },
    [`${ELECTRICAL_API_BASE}/field-observations/preview`]: {
      post: {
        summary: "Validate field observations",
        operationId: "electricalApiObservationsPreview",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object" } } },
        },
        responses: { "200": jsonResponse("Validation and row echo."), ...errorResponses },
      },
    },
    [`${ELECTRICAL_API_BASE}/field-observations/apply`]: {
      post: {
        summary: "Append approved field observations",
        operationId: "electricalApiObservationsApply",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object" } } },
        },
        responses: { "200": jsonResponse("Inserted observation ids."), ...errorResponses },
      },
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "FarmOps Electrical API",
      version: `${ELECTRICAL_API_VERSION} (${ELECTRICAL_API_SCHEMA_VERSION})`,
      description: [
        "Read-only access to the FarmOps electrical field record, plus two narrowly",
        "scoped write endpoints (record relationships and field observations).",
        "",
        "Out of scope by design:",
        ...ELECTRICAL_API_EXCLUSIONS.map((e) => `- ${e.title}: ${e.detail}`),
      ].join("\n"),
    },
    servers: [{ url: serverUrl ?? "/" }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
    "x-farmops-exclusions": ELECTRICAL_API_EXCLUSIONS,
    "x-farmops-resources": API_RESOURCES,
    "x-farmops-relationship-capabilities": RELATIONSHIP_CAPABILITIES,
    paths,
  };
}
