// Server-side implementation of the FarmOps Electrical API (v1).
//
// Every handler here is reached only through an HTTP route that first
// authenticated a Supabase user bearer token, so RLS scopes all data to that
// user. Reads are projections of the reconciliation snapshot — the same builder
// the FarmOps UI and /electrical/export use, so API output and UI cannot
// disagree. Writes are limited to the two scoped endpoints and audited.
import { requireElectricalAccess } from "@/lib/addons.server";
import { recordElectricalChange } from "@/lib/electrical-audit.server";
import { ENTITIES } from "@/lib/electrical-entities";
import { applyRelations, relationsFor } from "@/lib/electrical-relations";
import { SNAPSHOT_COLLECTIONS, type SnapshotCollection } from "@/lib/electrical-snapshot";
import {
  API_RESOURCES,
  ELECTRICAL_API_BASE,
  ELECTRICAL_API_ENDPOINTS,
  ELECTRICAL_API_EXCLUSIONS,
  ELECTRICAL_API_SCHEMA_VERSION,
  ELECTRICAL_API_VERSION,
  RELATIONSHIP_CAPABILITIES,
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

export function apiJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function apiError(message: string, status: number, extra?: Record<string, unknown>): Response {
  return apiJson({ error: message, ...extra }, status);
}

export interface ApiCaller {
  supabase: unknown;
  userId: string;
}

/**
 * Authenticate the bearer token and check the electrical entitlement for the
 * requested access mode. Returns a Response on failure.
 */
export async function authorizeApiRequest(
  request: Request,
  mode: "read" | "field_write",
): Promise<ApiCaller | Response> {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return apiError("Backend not configured", 500);

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return apiError("Unauthorized: send Authorization: Bearer <access_token>", 401);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser();
  const userId = data?.user?.id;
  if (error || !userId) return apiError("Unauthorized: invalid token", 401);

  try {
    await requireElectricalAccess(supabase, userId, mode);
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Electrical access denied", 403);
  }
  return { supabase, userId };
}

/* -------------------------------------------------------------------- reads */

async function snapshotFor(caller: ApiCaller) {
  const { collectSnapshot } = await import("@/lib/electrical-snapshot.functions");
  return collectSnapshot(caller.supabase);
}

export function apiIndexBody() {
  return {
    api: "FarmOps Electrical API",
    version: ELECTRICAL_API_VERSION,
    schema_version: ELECTRICAL_API_SCHEMA_VERSION,
    base_path: ELECTRICAL_API_BASE,
    openapi: `${ELECTRICAL_API_BASE}/openapi.json`,
    authority: {
      engineering_system_of_record: "PremoFarmElectrical.ods (canonical, never written by FarmOps)",
      field_as_built: "FarmOps electrical records (this API)",
    },
    resources: API_RESOURCES,
    endpoints: ELECTRICAL_API_ENDPOINTS,
    relationship_capabilities: RELATIONSHIP_CAPABILITIES,
    excluded_by_design: ELECTRICAL_API_EXCLUSIONS,
  };
}

export async function handleApiRead(caller: ApiCaller, segments: string[]): Promise<Response> {
  const [head, tail] = segments;

  if (!head) return apiJson(apiIndexBody());

  if (head === "snapshot" && !tail) {
    const { serializeSnapshot } = await import("@/lib/electrical-snapshot");
    return new Response(serializeSnapshot(await snapshotFor(caller)), {
      status: 200,
      headers: JSON_HEADERS,
    });
  }

  if (head === "qa" && !tail) {
    const snap = await snapshotFor(caller);
    return apiJson({
      schema_version: snap.schema_version,
      generated_at: snap.generated_at,
      ...snap.qa,
    });
  }

  if (head === "resources") {
    if (!tail) return apiJson({ resources: API_RESOURCES });
    const resource = apiResource(tail);
    if (!resource) {
      return apiError(`Unknown collection "${tail}".`, 404, {
        available: API_RESOURCES.map((r) => r.name),
      });
    }
    const snap = await snapshotFor(caller);
    const records = snap[resource.name as SnapshotCollection];
    return apiJson({
      schema_version: snap.schema_version,
      generated_at: snap.generated_at,
      collection: resource.name,
      purpose: resource.purpose,
      intended_use: resource.intended_use,
      field_ownership: snap.field_ownership[resource.name],
      count: records.length,
      records,
    });
  }

  if (head === "records") {
    if (!tail) return apiError("Provide a stable ID: /records/{stable_id}", 400);
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
    if (!total) return apiError(`No record with stable ID "${wanted}".`, 404);
    return apiJson({
      schema_version: snap.schema_version,
      generated_at: snap.generated_at,
      stable_id: wanted,
      count: total,
      collections: found,
    });
  }

  if (head === "documents" && tail === "bundle") {
    const snap = await snapshotFor(caller);
    return apiJson({
      schema_version: snap.schema_version,
      generated_at: snap.generated_at,
      // Document generators consume the manifest first, then the collections.
      manifest: API_RESOURCES.map((r) => ({
        collection: r.name,
        count: snap.counts[r.name],
        purpose: r.purpose,
        intended_use: r.intended_use,
      })),
      qa: { errors: snap.qa.errors, warnings: snap.qa.warnings, findings: snap.qa.findings },
      counts: snap.counts,
      field_ownership: snap.field_ownership,
      snapshot: snap,
      excluded_by_design: ELECTRICAL_API_EXCLUSIONS,
    });
  }

  return apiError(`Unknown endpoint "${ELECTRICAL_API_BASE}/${segments.join("/")}".`, 404, {
    endpoints: ELECTRICAL_API_ENDPOINTS.map((e) => `${e.method} ${e.path}`),
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
): Promise<{ items: unknown[] } | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Body must be JSON.", 400);
  }
  const raw = (body as Record<string, unknown> | null)?.[key];
  if (!Array.isArray(raw) || raw.length === 0) {
    return apiError(`Body must contain a non-empty "${key}" array.`, 400);
  }
  if (raw.length > 200) return apiError(`At most 200 ${key} per request.`, 400);
  return { items: raw };
}
