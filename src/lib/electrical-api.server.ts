// Server-side implementation of the FarmOps Electrical API (v1).
//
// Phase 1 is the read-only integration. Every request is authenticated, scoped,
// rate-limited and correlated; every response carries the API version and the
// request ID. Reads are projections of the reconciliation snapshot — the same
// builder the FarmOps UI and /electrical/export use, so API output and UI cannot
// disagree.
//
// Phase 2 (field observations) and Phase 3 (relationships) handlers exist below
// but their HTTP surfaces are NOT activated: `requireActivatedSurface` refuses
// them with 503 `write_scopes_not_activated` until Phase 1 acceptance is signed
// off. Their protocol requirements (expected record version, idempotency key,
// preview binding, transactional audit) are still outstanding and are documented
// as such in the OpenAPI document.
import { requireElectricalAccess } from "@/lib/addons.server";
import { recordElectricalChange } from "@/lib/electrical-audit.server";
import { ENTITIES } from "@/lib/electrical-entities";
import { applyRelations, relationsFor } from "@/lib/electrical-relations";
import { SNAPSHOT_COLLECTIONS, type SnapshotCollection } from "@/lib/electrical-snapshot";
import {
  API_ERROR_CODES,
  API_RATE_LIMITS,
  API_SCOPES,
  CANONICAL_ODS,
  KNOWN_UNRELIABLE_FIELDS,
  STABLE_ID_FORMATS,
  buildSnapshotEnvelope,
  deriveRelationships,
  isApiScope,
  isActivatedApiScope,

  projectObservations,
  rateLimitFor,
  resolveRequestId,
  sha256Hex,
  stableIdFormat,
  statusForErrorCode,
  SCOPES_FOR_ENTITLEMENT,
  unreliableFieldWarnings,
  type ApiErrorCode,
  type ApiScope,
  type SnapshotEnvelope,
} from "@/lib/electrical-api-envelope";
import {
  API_RESOURCES,
  COLLECTION_TABLE,
  ELECTRICAL_API_BASE,
  ELECTRICAL_API_ENDPOINTS,
  ELECTRICAL_API_EXCLUSIONS,
  ELECTRICAL_API_LEGACY_BASE,
  ELECTRICAL_API_SCHEMA_VERSION,
  ELECTRICAL_API_VERSION,
  LEGACY_PATH_ALIAS,
  OPENAPI_PATH,
  RELATIONSHIP_CAPABILITIES,
  WRITE_SCOPES_ACTIVATED,
  apiEndpoint,
  apiResource,
  relationSpec,
  relationshipWritableColumns,
  validateObservationProposal,
  validateRelationshipProposal,
  type ObservationProposal,
  type RelationshipProposal,
} from "@/lib/electrical-api";
import type { ElectricalEntityKind } from "@/lib/electrical";

type LooseDb = { from: (table: string) => any };

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  // Session-scoped data: never shared-cacheable.
  "cache-control": "private, no-store",
};

export interface ApiPrincipal {
  type: "user" | "service_principal";
  id: string;
  label: string;
  scopes: ApiScope[];
}

export interface ApiCaller {
  supabase: unknown;
  userId: string;
  principal?: ApiPrincipal;
  requestId?: string;
  rateLimit?: { limit: number; remaining: number; reset_at: string };
}

function callerRequestId(caller: ApiCaller): string {
  return caller.requestId ?? resolveRequestId(null);
}

function responseHeaders(caller?: ApiCaller, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...JSON_HEADERS, ...extra };
  if (caller?.requestId) headers["x-request-id"] = caller.requestId;
  if (caller?.rateLimit) {
    headers["x-ratelimit-limit"] = String(caller.rateLimit.limit);
    headers["x-ratelimit-remaining"] = String(caller.rateLimit.remaining);
    headers["x-ratelimit-reset"] = caller.rateLimit.reset_at;
  }
  return headers;
}

/** Every successful response carries the API version and the correlation ID. */
export function apiJson(
  body: Record<string, unknown>,
  status = 200,
  caller?: ApiCaller,
  extraHeaders?: Record<string, string>,
): Response {
  const envelope = {
    api_version: ELECTRICAL_API_VERSION,
    request_id: caller ? callerRequestId(caller) : resolveRequestId(null),
    ...body,
  };
  return new Response(JSON.stringify(envelope), {
    status,
    headers: responseHeaders(caller, extraHeaders),
  });
}

/** Structured error: `{ error: { code, message, details? }, request_id, api_version }`. */
export function apiError(
  code: ApiErrorCode,
  message: string,
  options?: { caller?: ApiCaller; requestId?: string; details?: unknown; headers?: Record<string, string> },
): Response {
  const requestId = options?.caller?.requestId ?? options?.requestId ?? resolveRequestId(null);
  const body = {
    error: {
      code,
      message,
      ...(options?.details === undefined ? {} : { details: options.details }),
    },
    request_id: requestId,
    api_version: ELECTRICAL_API_VERSION,
  };
  return new Response(JSON.stringify(body), {
    status: statusForErrorCode(code),
    headers: responseHeaders(options?.caller, { ...options?.headers, "x-request-id": requestId }),
  });
}

/* -------------------------------------------------------------- rate limits */

const buckets = new Map<string, { count: number; resetAt: number }>();

function consumeRateLimit(principalKey: string, bucket: "read" | "write") {
  const policy = rateLimitFor(bucket);
  const now = Date.now();
  const key = `${bucket}:${principalKey}`;
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    const resetAt = now + policy.window_seconds * 1000;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, limit: policy.requests, remaining: policy.requests - 1, resetAt };
  }
  current.count += 1;
  const remaining = Math.max(0, policy.requests - current.count);
  return {
    allowed: current.count <= policy.requests,
    limit: policy.requests,
    remaining,
    resetAt: current.resetAt,
  };
}

/** Test seam: clear the in-memory rate-limit state. */
export function resetRateLimits() {
  buckets.clear();
}

/* ----------------------------------------------------------- authorization */

const SERVICE_KEY_PREFIX = "farmops_sk_";

async function loadServicePrincipal(token: string): Promise<
  | { principal: ApiPrincipal; ownerUserId: string }
  | { failure: ApiErrorCode; message: string }
> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const keyHash = await sha256Hex(token);
  const { data, error } = await (supabaseAdmin as unknown as LooseDb)
    .from("electrical_api_principals")
    .select("id, name, user_id, scopes, disabled_at, expires_at")
    .eq("key_sha256", keyHash)
    .maybeSingle();
  if (error || !data) {
    return { failure: "unauthorized_invalid_token", message: "Unknown service-principal key." };
  }
  const row = data as Record<string, unknown>;
  if (row["disabled_at"]) {
    return { failure: "unauthorized_principal_disabled", message: "This service principal is disabled." };
  }
  const expires = row["expires_at"] ? String(row["expires_at"]) : null;
  if (expires && new Date(expires).getTime() <= Date.now()) {
    return { failure: "unauthorized_principal_expired", message: "This service-principal key has expired." };
  }
  // Stored scopes are narrowed twice: to recognised names, and to scopes that
  // are activated right now. A key issued (or written directly) with a scope
  // that is no longer activated silently loses it rather than gaining reach.
  const scopes = ((row["scopes"] as string[] | null) ?? [])
    .filter(isApiScope)
    .filter(isActivatedApiScope);
  if (!scopes.length) {
    return {
      failure: "forbidden_scope_missing",
      message: "This service principal carries no currently activated scope.",
    };
  }
  // The owner's entitlement is rechecked on every use: revoking or expiring the
  // Electrical add-on immediately stops keys issued while it was active.
  try {
    const { supabaseAdmin: gateClient } = await import("@/integrations/supabase/client.server");
    await requireElectricalAccess(gateClient, String(row["user_id"]), "read");
  } catch (err) {
    return {
      failure: "forbidden_entitlement_missing",
      message:
        err instanceof Error
          ? `Service-principal owner has no active electrical access. ${err.message}`
          : "Service-principal owner has no active electrical access.",
    };
  }

  // Best-effort usage stamp; never blocks the read.
  void (supabaseAdmin as unknown as LooseDb)
    .from("electrical_api_principals")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", String(row["id"]));
  return {
    principal: {
      type: "service_principal",
      id: String(row["id"]),
      label: String(row["name"] ?? "service principal"),
      scopes,
    },
    ownerUserId: String(row["user_id"]),
  };
}

/**
 * Owner-scoped wrapper around the service-role client.
 *
 * A `farmops_sk_*` service principal authenticates without a Supabase session,
 * so RLS cannot scope its statements. This wrapper re-imposes the same
 * ownership boundary: every select/update/delete is filtered to the principal
 * owner's `user_id`, and every insert is stamped with it, so a key can never
 * read or touch another household's electrical records.
 */
/**
 * Not every electrical table names its owner `user_id`. Tables listed here are
 * scoped by their real owner column; tables with NO owner column at all are
 * listed as `null` and can only be reached through an owner-scoped parent.
 */
export const OWNER_COLUMN_BY_TABLE: Record<string, string | null> = {
  electrical_audit_batches: "created_by",
  // Items belong to their batch; ownership lives on the parent row only.
  electrical_audit_batch_items: null,
};

export function ownerColumnFor(table: string): string | null {
  return table in OWNER_COLUMN_BY_TABLE ? OWNER_COLUMN_BY_TABLE[table]! : "user_id";
}

export function ownerScopedDb(admin: unknown, ownerUserId: string) {
  const db = admin as unknown as LooseDb;
  const stamp = (column: string, values: unknown) =>
    Array.isArray(values)
      ? values.map((v) => ({ ...(v as Record<string, unknown>), [column]: ownerUserId }))
      : { ...(values as Record<string, unknown>), [column]: ownerUserId };
  return {
    from(table: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b = (db as any).from(table);
      const column = ownerColumnFor(table);
      if (column === null) {
        // Ownership cannot be expressed on this table. Refuse an unscoped
        // service-role read outright; callers must resolve the owner-scoped
        // parent batch first and query by its batch_uuid.
        const refuse = () => {
          throw new Error(
            `${table} has no owner column; resolve an owner-scoped parent row and query by its foreign key instead.`,
          );
        };
        return {
          select: refuse,
          insert: refuse,
          upsert: refuse,
          update: refuse,
          delete: refuse,
        };
      }
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        select: (...args: any[]) => b.select(...args).eq(column, ownerUserId),
        insert: (values: unknown) => b.insert(stamp(column, values)),
        upsert: (values: unknown, opts?: unknown) => b.upsert(stamp(column, values), opts),
        update: (values: unknown) => b.update(values).eq(column, ownerUserId),
        delete: () => b.delete().eq(column, ownerUserId),
      };
    },
  };
}

/**
 * Fetch audit-batch items only through an owner-scoped parent batch. The parent
 * lookup carries the ownership boundary (`batch_id` + owner), so items can never
 * cross it.
 */
export async function fetchOwnedBatchItems(
  db: LooseDb,
  batchId: string,
  columns = "*",
): Promise<
  | { ok: true; batch: Record<string, unknown>; items: Record<string, unknown>[] }
  | { ok: false; reason: "not_found" | "query_failed"; message: string }
> {
  const parent = await db
    .from("electrical_audit_batches")
    .select("id, batch_id")
    .eq("batch_id", batchId)
    .maybeSingle();
  if (parent.error) {
    return { ok: false, reason: "query_failed", message: String(parent.error.message ?? parent.error) };
  }
  if (!parent.data) return { ok: false, reason: "not_found", message: `No field-audit batch "${batchId}".` };
  const parentRow = parent.data as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (db as any).__admin ?? db;
  const items = await raw
    .from("electrical_audit_batch_items")
    .select(columns)
    .eq("batch_uuid", String(parentRow["id"]));
  if (items.error) {
    return { ok: false, reason: "query_failed", message: String(items.error.message ?? items.error) };
  }
  return { ok: true, batch: parentRow, items: (items.data ?? []) as Record<string, unknown>[] };
}


/**
 * Authenticate the caller, resolve its granted scopes, enforce the endpoint's
 * required scope and consume its rate-limit budget. Returns a Response on
 * failure. Two credential types:
 *   * a Supabase user access token — scopes derive from electrical entitlement;
 *   * a `farmops_sk_*` service-principal key — scopes are stored with the
 *     principal and cannot be widened by the caller.
 */
export async function authorizeApiRequest(
  request: Request,
  mode: "read" | "field_write",
  options?: { scope?: ApiScope; bucket?: "read" | "write" },
): Promise<ApiCaller | Response> {
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  const requiredScope: ApiScope =
    options?.scope ?? (mode === "read" ? "electrical:read" : "electrical:observations:write");
  const bucket = options?.bucket ?? (mode === "read" ? "read" : "write");

  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) {
    return apiError("backend_not_configured", "Backend not configured.", { requestId });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return apiError(
      "unauthorized_missing_token",
      "Send Authorization: Bearer <access token or farmops_sk_ key>.",
      { requestId },
    );
  }

  const { createClient } = await import("@supabase/supabase-js");
  let principal: ApiPrincipal;
  let userId: string;
  let supabase: unknown;

  if (token.startsWith(SERVICE_KEY_PREFIX)) {
    const resolved = await loadServicePrincipal(token);
    if ("failure" in resolved) {
      return apiError(resolved.failure, resolved.message, { requestId });
    }
    principal = resolved.principal;
    userId = resolved.ownerUserId;
    // A service principal has no user session, so RLS cannot scope its reads.
    // Every query it issues is forced to the principal owner's own rows, which
    // reproduces the ownership boundary RLS gives a user access token.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    supabase = ownerScopedDb(supabaseAdmin, resolved.ownerUserId);
  } else {
    const client = createClient(url, key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser();
    const id = data?.user?.id;
    if (error || !id) {
      return apiError("unauthorized_invalid_token", "That access token is not valid.", { requestId });
    }
    try {
      await requireElectricalAccess(client, id, mode);
    } catch (err) {
      return apiError(
        "forbidden_entitlement_missing",
        err instanceof Error ? err.message : "Electrical access denied.",
        { requestId },
      );
    }
    let scopes = SCOPES_FOR_ENTITLEMENT.read;
    try {
      await requireElectricalAccess(client, id, "field_write");
      scopes = SCOPES_FOR_ENTITLEMENT.field_write;
    } catch {
      scopes = SCOPES_FOR_ENTITLEMENT.read;
    }
    principal = {
      type: "user",
      id,
      label: data?.user?.email ?? "authenticated user",
      scopes,
    };
    userId = id;
    supabase = client;
  }

  if (!principal.scopes.includes(requiredScope)) {
    return apiError(
      "forbidden_scope_missing",
      `This credential does not carry the "${requiredScope}" scope.`,
      { requestId, details: { required_scope: requiredScope, granted_scopes: principal.scopes } },
    );
  }

  const limit = consumeRateLimit(`${principal.type}:${principal.id}`, bucket);
  const rateLimit = {
    limit: limit.limit,
    remaining: limit.remaining,
    reset_at: new Date(limit.resetAt).toISOString(),
  };
  const caller: ApiCaller = { supabase, userId, principal, requestId, rateLimit };
  if (!limit.allowed) {
    return apiError("rate_limited", `Rate limit of ${limit.limit} requests exceeded.`, {
      caller,
      details: rateLimitFor(bucket),
      headers: { "retry-after": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) },
    });
  }
  return caller;
}

/**
 * Phase gate: refuse any surface that is not activated yet. Called by the route
 * BEFORE authorization, so an unactivated write endpoint never even looks at a
 * credential.
 */
/** Required scope for a read path: documents and SOR status are scoped apart. */
export function scopeForReadPath(segments: string[]): ApiScope {
  if (segments[0] === "sor") return "electrical:sor:read";
  if (segments[0] === "documents") return "electrical:documents:read";
  if (segments[0] === "audit-batches") return "electrical:audit-batches:read";
  return "electrical:read";
}

/** Canonical paths of the Phase 2/3 write surfaces, as declared in the contract. */
export const ELECTRICAL_WRITE_PATHS = {
  relationshipsPreview: `${ELECTRICAL_API_BASE}/relationships/preview`,
  relationshipsApply: `${ELECTRICAL_API_BASE}/relationships/apply`,
  observationsPreview: `${ELECTRICAL_API_BASE}/field-observations/preview`,
  observationsApply: `${ELECTRICAL_API_BASE}/field-observations/apply`,
} as const;



export function requireActivatedSurface(

  request: Request,
  method: "GET" | "POST",
  path: string,
): Response | null {
  const endpoint = apiEndpoint(method, path);
  if (!endpoint || endpoint.activated) return null;
  return apiError(
    "write_scopes_not_activated",
    `${method} ${path} is defined but not activated: Phase ${endpoint.phase} stays disabled until Phase 1 acceptance is signed off.`,
    {
      requestId: resolveRequestId(request.headers.get("x-request-id")),
      details: {
        phase: endpoint.phase,
        required_scope: endpoint.scope,
        outstanding_protocol: [
          "expected record version / optimistic concurrency (409)",
          "idempotency key",
          "expiring preview token bound to the apply",
          "reason, evidence and caller-supplied effective date",
          "single transaction covering the write and its audit row",
        ],
      },
    },
  );
}

/* ------------------------------------------------- deprecated path handling */

export const DEPRECATION_HEADERS: Record<string, string> = {
  deprecation: "true",
  link: `<${ELECTRICAL_API_BASE}>; rel="successor-version"`,
  warning: `299 - "${ELECTRICAL_API_LEGACY_BASE} is deprecated; use ${ELECTRICAL_API_BASE}"`,
};

/* -------------------------------------------------------------------- reads */

async function snapshotFor(caller: ApiCaller) {
  const { collectSnapshot } = await import("@/lib/electrical-snapshot.functions");
  return collectSnapshot(caller.supabase);
}

async function readRows(caller: ApiCaller, table: string, columns: string): Promise<Record<string, unknown>[]> {
  try {
    const { data, error } = await (caller.supabase as LooseDb).from(table).select(columns);
    if (error) return [];
    return (data ?? []) as Record<string, unknown>[];
  } catch {
    // A collection the caller cannot read contributes nothing rather than
    // failing the whole snapshot; the source manifest reports the count.
    return [];
  }
}

/** The full snapshot envelope: data, provenance, hashes and warnings. */
export async function snapshotEnvelopeFor(caller: ApiCaller): Promise<SnapshotEnvelope> {
  const snapshot = await snapshotFor(caller);
  const [observationRows, changeLogRows] = await Promise.all([
    readRows(
      caller,
      "electrical_field_observations",
      "observed_at, panel_ref, field, observed_text, interpreted_value, confidence, verification_status, disposition, scope",
    ),
    readRows(caller, "electrical_change_audit", "created_at, section, action, entity_kind"),
  ]);
  return buildSnapshotEnvelope({
    apiVersion: ELECTRICAL_API_VERSION,
    apiSchemaVersion: ELECTRICAL_API_SCHEMA_VERSION,
    generatedAt: snapshot.generated_at,
    snapshot,
    tables: COLLECTION_TABLE,
    observationRows,
    changeLogRows,
    exclusions: ELECTRICAL_API_EXCLUSIONS,
  });
}

export function apiIndexBody(caller?: ApiCaller) {
  return {
    api: "FarmOps Electrical API",
    version: ELECTRICAL_API_VERSION,
    api_schema_version: ELECTRICAL_API_SCHEMA_VERSION,
    schema_version: ELECTRICAL_API_SCHEMA_VERSION,
    base_path: ELECTRICAL_API_BASE,
    openapi_path: OPENAPI_PATH,
    openapi: OPENAPI_PATH,
    phase: {
      current: 1,
      name: "read-only integration",
      write_scopes_activated: WRITE_SCOPES_ACTIVATED,
      note: "Phase 2 and Phase 3 surfaces answer 503 write_scopes_not_activated.",
    },
    authority: {
      engineering_system_of_record: `${CANONICAL_ODS.file} (canonical, never written by FarmOps)`,
      canonical_sha256: CANONICAL_ODS.sha256,
      field_as_built: "FarmOps electrical records (this API)",
    },
    scopes: API_SCOPES,
    granted_scopes: caller?.principal?.scopes ?? [],
    principal: caller?.principal
      ? { type: caller.principal.type, label: caller.principal.label }
      : null,
    rate_limits: API_RATE_LIMITS,
    error_codes: API_ERROR_CODES,
    stable_id_formats: STABLE_ID_FORMATS,
    known_unreliable_fields: KNOWN_UNRELIABLE_FIELDS,
    resources: API_RESOURCES,
    endpoints: ELECTRICAL_API_ENDPOINTS,
    relationship_capabilities: RELATIONSHIP_CAPABILITIES,
    excluded_by_design: ELECTRICAL_API_EXCLUSIONS,
    legacy_path_alias: LEGACY_PATH_ALIAS,
  };
}

/** GET /sor/status — which truth is a consumer reading, and what is activated. */
export async function sorStatusBody(caller: ApiCaller) {
  const envelope = await snapshotEnvelopeFor(caller);
  return {
    system_of_record: {
      engineering: CANONICAL_ODS.file,
      engineering_authority: "Owner-authorized canonical workbook; FarmOps never writes it.",
      field_as_built: "FarmOps electrical records",
      this_api: "read-only projection of the FarmOps record",
    },
    canonical_baseline: {
      file: CANONICAL_ODS.file,
      sha256: CANONICAL_ODS.sha256,
      authorization: CANONICAL_ODS.authorization,
      written_by_farmops: false,
    },
    farmops_record: {
      snapshot_id: envelope.snapshot_id,
      snapshot_schema_version: envelope.snapshot_schema_version,
      farmops_snapshot_hash: envelope.hashes.farmops_snapshot_hash,
      content_hash: envelope.hashes.content_hash,
      data_updated_through: envelope.data_updated_through,
      counts: envelope.counts,
      qa: { errors: envelope.qa.errors, warnings: envelope.qa.warnings },
      change_log: envelope.change_log,
    },
    warnings: envelope.warnings,
    phases: [
      {
        phase: 1,
        name: "Read-only integration",
        status: "implemented — under acceptance",
        endpoints: ELECTRICAL_API_ENDPOINTS.filter((e) => e.phase === 1).map(
          (e) => `${e.method} ${e.path}`,
        ),
      },
      {
        phase: 2,
        name: "Field observations",
        status: WRITE_SCOPES_ACTIVATED ? "activated" : "defined, not activated",
        endpoints: ELECTRICAL_API_ENDPOINTS.filter((e) => e.phase === 2).map(
          (e) => `${e.method} ${e.path}`,
        ),
      },
      {
        phase: 3,
        name: "Relationships",
        status: WRITE_SCOPES_ACTIVATED ? "activated" : "defined, not activated",
        endpoints: ELECTRICAL_API_ENDPOINTS.filter((e) => e.phase === 3).map(
          (e) => `${e.method} ${e.path}`,
        ),
      },
      {
        phase: 4,
        name: "Document generation",
        status: "not implemented",
        endpoints: [],
      },
    ],
    write_scopes: {
      activated: WRITE_SCOPES_ACTIVATED,
      reason: WRITE_SCOPES_ACTIVATED
        ? "Activated by reviewed change."
        : "Phase 1 acceptance gates activation of production write scopes.",
      scopes: ["electrical:observations:write", "electrical:relationships:write"],
    },
    exclusions: ELECTRICAL_API_EXCLUSIONS,
  };
}

export async function handleApiRead(caller: ApiCaller, segments: string[]): Promise<Response> {
  const [head, tail] = segments;

  if (!head) return apiJson(apiIndexBody(caller), 200, caller);

  if (head === "sor" && tail === "status") {
    return apiJson(await sorStatusBody(caller), 200, caller);
  }

  if (head === "snapshot" && !tail) {
    return apiJson(
      { ...(await snapshotEnvelopeFor(caller)) } as unknown as Record<string, unknown>,
      200,
      caller,
    );
  }

  if (head === "qa" && !tail) {
    const envelope = await snapshotEnvelopeFor(caller);
    return apiJson(
      {
        snapshot_id: envelope.snapshot_id,
        generated_at: envelope.generated_at,
        content_hash: envelope.hashes.content_hash,
        ...envelope.qa,
      },
      200,
      caller,
    );
  }

  if (head === "resources") {
    if (!tail) return apiJson({ resources: API_RESOURCES }, 200, caller);
    const derivedCollections = ["circuits", "relationships", "observations"];
    const resource = apiResource(tail);
    if (!resource && !derivedCollections.includes(tail)) {
      return apiError("not_found_collection", `Unknown collection "${tail}".`, {
        caller,
        details: { available: [...API_RESOURCES.map((r) => r.name), ...derivedCollections] },
      });
    }
    const envelope = await snapshotEnvelopeFor(caller);
    const records = envelope.collections[tail] ?? [];
    return apiJson(
      {
        snapshot_id: envelope.snapshot_id,
        generated_at: envelope.generated_at,
        collection: tail,
        resource: resource ?? { name: tail, derived: true },
        stable_id_format: stableIdFormat(tail as SnapshotCollection) ?? null,
        field_ownership: resource ? envelope.field_ownership[resource.name] : null,
        warnings: envelope.warnings.known_unreliable_fields.filter((w) => w.collection === tail),
        count: records.length,
        records,
      },
      200,
      caller,
    );
  }

  if (head === "records") {
    if (!tail) {
      return apiError("bad_request_missing_parameter", "Provide a stable ID: /records/{stable_id}", {
        caller,
      });
    }
    const wanted = decodeURIComponent(tail);
    const snap = await snapshotFor(caller);
    const found: Record<string, unknown[]> = {};
    let total = 0;
    for (const collection of SNAPSHOT_COLLECTIONS) {
      const hits = snap[collection].filter((r) => r["stable_id"] === wanted);
      if (hits.length) {
        found[collection] = hits;
        total += hits.length;
      }
    }
    if (!total) {
      return apiError("not_found_record", `No record with stable ID "${wanted}".`, { caller });
    }
    const relationships = deriveRelationships(snap).filter(
      (e) => e.from_stable_id === wanted || e.to_stable_id === wanted,
    );
    const observationRows = await readRows(
      caller,
      "electrical_field_observations",
      "observed_at, panel_ref, field, observed_text, interpreted_value, confidence, verification_status, disposition, scope",
    );
    return apiJson(
      {
        snapshot_schema_version: snap.schema_version,
        generated_at: snap.generated_at,
        stable_id: wanted,
        count: total,
        collections: found,
        relationships,
        observations: projectObservations(
          observationRows.filter((r) => String(r["panel_ref"] ?? "") === wanted),
        ),
        warnings: unreliableFieldWarnings(snap).filter((w) => w.collection in found),
      },
      200,
      caller,
    );
  }

  if (head === "documents" && tail === "bundle") {
    const envelope = await snapshotEnvelopeFor(caller);
    return apiJson(
      {
        snapshot_id: envelope.snapshot_id,
        generated_at: envelope.generated_at,
        content_hash: envelope.hashes.content_hash,
        // Document generators consume the manifest first, then the collections.
        manifest: API_RESOURCES.map((r) => ({
          collection: r.name,
          table: r.table,
          count: envelope.counts[r.name] ?? 0,
          purpose: r.purpose,
          intended_use: r.intended_use,
        })),
        qa: envelope.qa,
        counts: envelope.counts,
        warnings: envelope.warnings,
        field_ownership: envelope.field_ownership,
        snapshot: envelope,
        excluded_by_design: ELECTRICAL_API_EXCLUSIONS,
      },
      200,
      caller,
    );
  }

  // Field-audit batches. Read-only export of what THIS instance already staged or
  // applied, so a peer FarmOps instance can stage the same manifest for its own
  // owner-approved apply. No manifest is ever imported through this path.
  if (head === "audit-batches") {
    const db = caller.supabase as LooseDb;
    const columns =
      "batch_id, schema_version, title, scope, building, observed_date, observed_time_precision, timezone, source, manifest_sha256, status, summary, compensates_batch_id, approved_at, applied_at, created_at";
    if (!tail) {
      const { data, error } = await db
        .from("electrical_audit_batches")
        .select(columns)
        .order("created_at", { ascending: false });
      if (error) {
        return apiError("not_found_collection", "Field-audit batches are not readable for this caller.", {
          caller,
        });
      }
      const rows = (data ?? []) as Record<string, unknown>[];
      return apiJson(
        {
          generated_at: new Date().toISOString(),
          count: rows.length,
          manifest_path: `${ELECTRICAL_API_BASE}/audit-batches/{batch_id}/manifest`,
          batches: rows,
        },
        200,
        caller,
      );
    }

    const wantedBatch = decodeURIComponent(tail);
    if (segments[2] !== "manifest" || segments.length !== 3) {
      return apiError(
        "not_found_endpoint",
        `Use ${ELECTRICAL_API_BASE}/audit-batches/{batch_id}/manifest.`,
        { caller },
      );
    }
    const { data, error } = await db
      .from("electrical_audit_batches")
      .select(`${columns}, manifest, evidence`)
      .eq("batch_id", wantedBatch)
      .maybeSingle();
    if (error || !data) {
      return apiError("not_found_record", `No field-audit batch "${wantedBatch}".`, { caller });
    }
    const row = data as Record<string, unknown>;
    const manifest = row["manifest"];
    const { manifestChecksum } = await import("@/lib/electrical-audit-batch");
    const checksum = manifest == null ? null : await manifestChecksum(manifest);
    return apiJson(
      {
        generated_at: new Date().toISOString(),
        source_instance: {
          api_version: ELECTRICAL_API_VERSION,
          api_schema_version: ELECTRICAL_API_SCHEMA_VERSION,
        },
        batch_id: row["batch_id"],
        schema_version: row["schema_version"],
        status: row["status"],
        applied_at: row["applied_at"],
        approved_at: row["approved_at"],
        compensates_batch_id: row["compensates_batch_id"],
        summary: row["summary"],
        evidence: row["evidence"],
        stored_manifest_sha256: row["manifest_sha256"],
        recomputed_manifest_sha256: checksum,
        checksum_matches: checksum != null && checksum === String(row["manifest_sha256"] ?? ""),
        manifest,
        staging_contract: {
          direction: "export only",
          importer_requirements: [
            "stage as preview; never auto-apply",
            "explicit per-item owner approval before any write",
            "expected_updated_at conflict check re-run against the importing instance",
          ],
          canonical_ods: "never read or written through this API",
        },
      },
      200,
      caller,
    );
  }


  return apiError("not_found_endpoint", `Unknown endpoint "${ELECTRICAL_API_BASE}/${segments.join("/")}".`, {
    caller,
    details: { endpoints: ELECTRICAL_API_ENDPOINTS.map((e) => `${e.method} ${e.path}`) },
  });
}


/* ----------------------------------------------------------- relationships */

interface RowRef {
  id: string;
  stable_id: string;
  row: Record<string, unknown>;
}

async function findByStableId(
  db: LooseDb,
  kind: ElectricalEntityKind,
  stableId: string,
): Promise<RowRef | null> {
  const { data } = await db
    .from(ENTITIES[kind].table)
    .select("*")
    .eq("stable_id", stableId)
    .maybeSingle();
  const row = data as Record<string, unknown> | null;
  if (!row) return null;
  return { id: String(row["id"]), stable_id: String(row["stable_id"]), row };
}

export interface RelationshipOutcome {
  kind: string;
  stable_id: string;
  relation: string;
  target_stable_id: string | null;
  eligible: boolean;
  errors: string[];
  writable_columns: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  applied?: boolean;
}

async function evaluateRelationship(
  caller: ApiCaller,
  proposal: RelationshipProposal,
): Promise<RelationshipOutcome> {
  const db = caller.supabase as LooseDb;
  const target_stable_id =
    proposal.target_stable_id == null ? null : String(proposal.target_stable_id).trim();
  const out: RelationshipOutcome = {
    kind: proposal.kind,
    stable_id: proposal.stable_id,
    relation: proposal.relation,
    target_stable_id,
    eligible: false,
    errors: validateRelationshipProposal(proposal),
    writable_columns: [],
    before: null,
    after: null,
  };
  if (out.errors.length) return out;

  const spec = relationSpec(proposal.kind, proposal.relation)!;
  out.writable_columns = relationshipWritableColumns(spec);
  const kind = proposal.kind as ElectricalEntityKind;

  const self = await findByStableId(db, kind, String(proposal.stable_id).trim());
  if (!self) {
    out.errors.push(`No ${kind} record with stable ID "${proposal.stable_id}".`);
    return out;
  }

  let target: RowRef | null = null;
  if (target_stable_id) {
    target = await findByStableId(db, spec.targetKind, target_stable_id);
    if (!target) {
      out.errors.push(`No ${spec.targetKind} record with stable ID "${target_stable_id}".`);
      return out;
    }
    if (target.id === self.id) {
      out.errors.push("A record cannot be its own endpoint.");
      return out;
    }
  }

  const patch: Record<string, unknown> = { [spec.fkColumn]: target ? target.id : null };
  const merged = { ...self.row, ...patch };
  const targets: Record<string, { id: string; kind: ElectricalEntityKind; stableId: string }> = {};
  // Resolve every FK currently on the row so slot conflicts are detected.
  for (const other of relationsFor(kind)) {
    const value = merged[other.fkColumn];
    if (value == null || !String(value)) continue;
    if (other.fkColumn === spec.fkColumn && target) {
      targets[other.fkColumn] = { id: target.id, kind: spec.targetKind, stableId: target.stable_id };
      continue;
    }
    const { data } = await db
      .from(ENTITIES[other.targetKind].table)
      .select("id, stable_id")
      .eq("id", String(value))
      .maybeSingle();
    const row = data as { id?: string; stable_id?: string } | null;
    if (row?.id) {
      targets[other.fkColumn] = {
        id: String(row.id),
        kind: other.targetKind,
        stableId: String(row.stable_id ?? ""),
      };
    }
  }

  const relResult = applyRelations(kind, merged, targets, {
    id: self.id,
    stableId: self.stable_id,
  });
  if (relResult.errors.length) {
    out.errors.push(...relResult.errors);
    return out;
  }

  // Clearing the link also clears its derived mirror columns.
  const derived = target
    ? relResult.derived
    : Object.fromEntries(
        relationshipWritableColumns(spec)
          .filter((c) => c !== spec.fkColumn)
          .map((c) => [c, null]),
      );
  const writePatch: Record<string, unknown> = { ...patch };
  for (const col of relationshipWritableColumns(spec)) {
    if (col in derived) writePatch[col] = derived[col] ?? null;
  }

  out.before = Object.fromEntries(
    relationshipWritableColumns(spec).map((c) => [c, self.row[c] ?? null]),
  );
  out.after = writePatch;
  out.eligible = true;
  return out;
}

export async function handleRelationshipPreview(
  caller: ApiCaller,
  rawProposals: unknown[],
): Promise<Response> {
  const proposals = rawProposals as RelationshipProposal[];
  const results: RelationshipOutcome[] = [];
  for (const p of proposals) results.push(await evaluateRelationship(caller, p));
  return apiJson({
    mode: "preview",
    writes_performed: false,
    total: results.length,
    eligible: results.filter((r) => r.eligible).length,
    rejected: results.filter((r) => !r.eligible).length,
    results,
  });
}

export async function handleRelationshipApply(
  caller: ApiCaller,
  rawProposals: unknown[],
): Promise<Response> {
  const proposals = rawProposals as RelationshipProposal[];
  const db = caller.supabase as LooseDb;
  const results: RelationshipOutcome[] = [];
  for (const p of proposals) {
    const outcome = await evaluateRelationship(caller, p);
    if (outcome.eligible && p.approved !== true) {
      outcome.eligible = false;
      outcome.errors.push("approved must be true — every relationship write needs approval.");
    }
    if (outcome.eligible && !String(p.reason ?? "").trim()) {
      outcome.eligible = false;
      outcome.errors.push("reason is required for a relationship write.");
    }
    if (!outcome.eligible) {
      outcome.applied = false;
      results.push(outcome);
      continue;
    }
    const kind = p.kind as ElectricalEntityKind;
    const { error } = await db
      .from(ENTITIES[kind].table)
      .update(outcome.after!)
      .eq("stable_id", outcome.stable_id);
    if (error) {
      outcome.applied = false;
      outcome.eligible = false;
      outcome.errors.push(error.message);
      results.push(outcome);
      continue;
    }
    outcome.applied = true;
    await recordElectricalChange(caller.supabase, caller.userId, {
      section: "entities",
      entityKind: kind,
      action: "update",
      entityRef: outcome.stable_id,
      summary: `API v1 relationship ${outcome.relation} → ${outcome.target_stable_id ?? "cleared"}: ${String(p.reason ?? "").trim()}`,
      before: outcome.before ?? {},
      patch: outcome.after!,
    });
    results.push(outcome);
  }
  return apiJson({
    mode: "apply",
    writes_performed: results.some((r) => r.applied),
    total: results.length,
    applied: results.filter((r) => r.applied).length,
    rejected: results.filter((r) => !r.applied).length,
    canonical_ods_written: false,
    results,
  });
}

/* ------------------------------------------------------ field observations */

export interface ObservationOutcome {
  stable_id: string;
  field: string;
  eligible: boolean;
  errors: string[];
  row: Record<string, unknown> | null;
  applied?: boolean;
  id?: string;
}

async function evaluateObservation(
  caller: ApiCaller,
  o: ObservationProposal,
  observedAt: string,
): Promise<ObservationOutcome> {
  const db = caller.supabase as LooseDb;
  const out: ObservationOutcome = {
    stable_id: String(o.stable_id ?? ""),
    field: String(o.field ?? ""),
    eligible: false,
    errors: validateObservationProposal(o),
    row: null,
  };
  if (out.errors.length) return out;

  // Link to a panel when the stable ID is one; otherwise the reference stands
  // on its own (loads, raceways, boxes) — never invented.
  let panelUuid: string | null = null;
  const { data } = await db
    .from(ENTITIES.panel.table)
    .select("id")
    .eq("stable_id", out.stable_id)
    .maybeSingle();
  const panel = data as { id?: string } | null;
  if (panel?.id) panelUuid = String(panel.id);

  out.row = {
    user_id: caller.userId,
    workbook: "FarmOps Electrical API v1",
    worksheet: null,
    source_column: null,
    source_row: null,
    panel_ref: out.stable_id,
    panel_uuid: panelUuid,
    side: o.side ?? null,
    position: o.position ?? null,
    poles: o.poles ?? null,
    field: out.field,
    observed_text: String(o.observed_text),
    interpreted_value: o.interpreted_value ?? null,
    confidence: o.confidence ?? null,
    verification_status: o.verification_status ?? "field_confirmation_required",
    notes: o.notes ?? null,
    scope: "api_v1",
    disposition: "recorded_observation",
    apply_status: "recorded",
    observed_at: observedAt,
  };
  out.eligible = true;
  return out;
}

export async function handleObservationPreview(
  caller: ApiCaller,
  rawObservations: unknown[],
): Promise<Response> {
  const observations = rawObservations as ObservationProposal[];
  const observedAt = new Date().toISOString();
  const results: ObservationOutcome[] = [];
  for (const o of observations) results.push(await evaluateObservation(caller, o, observedAt));
  return apiJson({
    mode: "preview",
    writes_performed: false,
    total: results.length,
    eligible: results.filter((r) => r.eligible).length,
    rejected: results.filter((r) => !r.eligible).length,
    note: "Observations are append-only journal rows. No engineering record is modified.",
    results,
  });
}

export async function handleObservationApply(
  caller: ApiCaller,
  rawObservations: unknown[],
): Promise<Response> {
  const observations = rawObservations as ObservationProposal[];
  const db = caller.supabase as LooseDb;
  const observedAt = new Date().toISOString();
  const results: ObservationOutcome[] = [];
  for (const o of observations) {
    const outcome = await evaluateObservation(caller, o, observedAt);
    if (outcome.eligible && o.approved !== true) {
      outcome.eligible = false;
      outcome.errors.push("approved must be true — every observation write needs approval.");
    }
    if (!outcome.eligible) {
      outcome.applied = false;
      results.push(outcome);
      continue;
    }
    const { data, error } = await db
      .from("electrical_field_observations")
      .insert(outcome.row!)
      .select("id")
      .maybeSingle();
    if (error) {
      outcome.applied = false;
      outcome.eligible = false;
      outcome.errors.push(error.message);
      results.push(outcome);
      continue;
    }
    outcome.applied = true;
    outcome.id = String((data as { id?: string } | null)?.id ?? "");
    await recordElectricalChange(caller.supabase, caller.userId, {
      section: "entities",
      entityKind: "field_observation",
      action: "create",
      entityUuid: outcome.id || null,
      entityRef: outcome.stable_id,
      summary: `API v1 field observation: ${outcome.field} = ${String(o.observed_text)}`,
      changes: [{ column: outcome.field, before: null, after: String(o.observed_text) }],
    });
    results.push(outcome);
  }
  return apiJson({
    mode: "apply",
    writes_performed: results.some((r) => r.applied),
    total: results.length,
    applied: results.filter((r) => r.applied).length,
    rejected: results.filter((r) => !r.applied).length,
    engineering_records_modified: false,
    canonical_ods_written: false,
    results,
  });
}

/* ----------------------------------------------------------------- parsing */

export async function readJsonArray(
  request: Request,
  key: string,
  caller?: ApiCaller,
): Promise<{ items: unknown[] } | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("bad_request_json", "Body must be JSON.", { caller });
  }
  const raw = (body as Record<string, unknown> | null)?.[key];
  if (!Array.isArray(raw) || raw.length === 0) {
    return apiError("bad_request_validation", `Body must contain a non-empty "${key}" array.`, {
      caller,
    });
  }
  if (raw.length > 200) {
    return apiError("bad_request_validation", `At most 200 ${key} per request.`, { caller });
  }
  return { items: raw };

}
