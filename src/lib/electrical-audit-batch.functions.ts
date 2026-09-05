// FARMOPS-ELEC-AUDIT-BATCH-V1 — authenticated server operations for the bulk
// electrical field audit.
//
// Import and preview never write an operational electrical record. Apply writes
// only the field/as-built columns of items the owner explicitly approved, after
// re-reading every target and refusing the whole transaction when any approved
// target changed since the preview. The canonical PremoFarmElectrical.ods
// workbook is never read, written or regenerated here.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireElectricalAccess } from "@/lib/addons.server";
import { requireAdminRole } from "@/lib/admin-role.server";
import { recordElectricalChange } from "@/lib/electrical-audit.server";
import { assertPeerUrl, peerFetch } from "@/lib/electrical-peer-net";
import { diffManifests, type ManifestDiff } from "@/lib/electrical-audit-manifest-diff";
import { collectSnapshot } from "@/lib/electrical-snapshot.functions";
import {
  AUDIT_BATCH_GATE_VERSION,
  AUDIT_BATCH_SCHEMA_VERSION,
  AUDIT_ENTITY_TARGETS,
  assignProposedCircuitGroupIds,
  buildManifestGraph,
  classifyItem,
  classifyStoredManifest,
  compensatingManifest,
  isPendingRef,
  manifestChecksum,
  orderForApply,
  parseManifest,
  pendingRefItemKey,
  summarize,
  type AuditBatchItemInput,
  type AuditBatchManifest,
  type AuditDisposition,
  type AuditEntityKind,
  type BatchSummary,
  type ClassifiedItem,
  type ManifestGraph,
} from "@/lib/electrical-audit-batch";


type LooseDb = { from: (table: string) => any };

const BATCHES = "electrical_audit_batches";
const ITEMS = "electrical_audit_batch_items";
const AUDIT_SECTION = "field_audit_batch";

const s = (v: unknown) => (v == null ? "" : String(v)).trim();
const up = (v: unknown) => s(v).toUpperCase();

/* ------------------------------------------------------------------ *
 * Shared shapes
 * ------------------------------------------------------------------ */

export interface AuditBatchRecord {
  id: string;
  batch_id: string;
  schema_version: string;
  title: string;
  scope: string | null;
  building: string | null;
  observed_date: string | null;
  observed_time_precision: string | null;
  timezone: string | null;
  source: string | null;
  manifest_sha256: string;
  evidence: { name: string; label?: string | null; subject?: string | null }[];
  status: string;
  summary: BatchSummary | Record<string, never>;
  compensates_batch_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  applied_at: string | null;
  created_at: string;
}

export interface QaCounts {
  total: number;
  error: number;
  warning: number;
  info: number;
}

export interface AuditBatchPreview {
  batch: AuditBatchRecord;
  gate_version: string;
  generated_at: string;
  items: ClassifiedItem[];
  /** Owner approval flags, keyed by item_key. */
  approved: string[];
  summary: BatchSummary;
  qa: QaCounts | null;
  qa_before: QaCounts | null;
  applied: boolean;
  refused_reason: string | null;
}

/* ------------------------------------------------------------------ *
 * Live snapshot used for resolution + classification
 * ------------------------------------------------------------------ */

interface LiveSnapshot {
  resolved: Map<string, string>;
  byKind: Record<string, Map<string, Record<string, unknown>>>;
  breakerByPanelNumber: Map<string, Record<string, unknown>>;
  branchIds: string[];
  jboxIds: string[];
}

async function readSnapshot(db: LooseDb): Promise<LiveSnapshot> {
  const kinds: AuditEntityKind[] = [
    "panel",
    "circuit_group",
    "raceway",
    "jbox",
    "branch",
    "load",
  ];
  const byKind: Record<string, Map<string, Record<string, unknown>>> = {};
  const resolved = new Map<string, string>();

  for (const kind of kinds) {
    const t = AUDIT_ENTITY_TARGETS[kind];
    const { data, error } = await db.from(t.table).select("*");
    if (error) throw new Error(error.message);
    const map = new Map<string, Record<string, unknown>>();
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const id = up(row[t.stableIdColumn as string]);
      if (!id) continue;
      map.set(id, row);
      resolved.set(`${kind}|${id}`, String(row["id"]));
    }
    byKind[kind] = map;
  }

  const { data: positions, error: posError } = await db
    .from(AUDIT_ENTITY_TARGETS.breaker_position.table)
    .select("*");
  if (posError) throw new Error(posError.message);
  const breakerByPanelNumber = new Map<string, Record<string, unknown>>();
  for (const row of (positions ?? []) as Record<string, unknown>[]) {
    breakerByPanelNumber.set(`${s(row["panel_uuid"])}|${s(row["breaker_number"])}`, row);
  }

  return {
    resolved,
    byKind,
    breakerByPanelNumber,
    branchIds: [...(byKind["branch"]?.keys() ?? [])],
    jboxIds: [...(byKind["jbox"]?.keys() ?? [])],
  };
}

/** Current row for a manifest item, or null when the record does not exist. */
function findTarget(
  item: AuditBatchItemInput,
  live: LiveSnapshot,
): Record<string, unknown> | null {
  if (item.entity_kind === "breaker_position") {
    const panelUuid = live.resolved.get(`panel|${up(item.refs?.panel_ref)}`);
    const number = (item.fields ?? {})["breaker_number"];
    if (!panelUuid || number == null) return null;
    return live.breakerByPanelNumber.get(`${panelUuid}|${s(number)}`) ?? null;
  }
  const map = live.byKind[item.entity_kind];
  if (!map) return null;
  return map.get(up(item.target_stable_id)) ?? null;
}

interface PreparedBatch {
  items: ClassifiedItem[];
  graph: ManifestGraph;
  /** item_key → proposed CG-FS-## identity awaiting owner approval. */
  proposed: Record<string, string>;
}

/**
 * Normalize proposed circuit-group identities, build the manifest dependency
 * graph, then classify every item against one live snapshot.
 */
function prepareBatch(manifest: AuditBatchManifest, live: LiveSnapshot): PreparedBatch {
  const groupIds = [...(live.byKind["circuit_group"]?.keys() ?? [])];
  const { items: normalized, proposed } = assignProposedCircuitGroupIds(manifest.items, groupIds);
  const exists = (kind: string, id: string) => Boolean(live.byKind[kind]?.has(id));
  const graph = buildManifestGraph(normalized, exists);

  const items = normalized.map((item) => {
    const classified = classifyItem(item, {
      target: findTarget(item, live),
      existingBranchIds: live.branchIds,
      existingJboxIds: live.jboxIds,
      resolved: live.resolved,
      pendingCreates: graph.pendingCreates,
    });

    const id = up(item.target_stable_id);
    const key = `${item.entity_kind}|${id}`;
    const ambiguous =
      Boolean(id) &&
      AUDIT_ENTITY_TARGETS[item.entity_kind].creatable &&
      !exists(item.entity_kind, id) &&
      graph.pendingCreates.get(key) !== item.item_key;

    if (ambiguous) {
      return {
        ...classified,
        operation: "CONFLICT" as ClassifiedItem["operation"],
        disposition: "conflict" as AuditDisposition,
        patch: {},
        changes: [],
        messages: [
          ...classified.messages,
          {
            level: "error" as const,
            text:
              graph.conflicts.find((c) => c.includes(item.item_key)) ??
              `${id} is proposed by more than one item; the reference is ambiguous.`,
          },
        ],
      };
    }

    const proposedId = proposed[item.item_key];
    if (proposedId) {
      return {
        ...classified,
        messages: [
          ...classified.messages,
          {
            level: "info" as const,
            text: `${proposedId} is the next unused circuit-group identity proposed by FarmOps. It is independent of panel, breaker number and tape label, and needs your approval.`,
          },
        ],
      };
    }
    return classified;
  });

  return { items, graph, proposed };
}

function classifyAll(manifest: AuditBatchManifest, live: LiveSnapshot): ClassifiedItem[] {
  return prepareBatch(manifest, live).items;
}


async function qaCounts(supabase: unknown): Promise<QaCounts | null> {
  try {
    const snapshot = await collectSnapshot(supabase);
    const findings = (snapshot as unknown as { qa?: { severity?: string }[] }).qa ?? [];
    const count = (sev: string) => findings.filter((f) => f.severity === sev).length;
    return {
      total: findings.length,
      error: count("error"),
      warning: count("warning"),
      info: count("info"),
    };
  } catch (err) {
    console.error("[audit-batch] QA snapshot failed", err);
    return null;
  }
}

function toRecord(row: Record<string, unknown>): AuditBatchRecord {
  return {
    id: String(row["id"]),
    batch_id: s(row["batch_id"]),
    schema_version: s(row["schema_version"]),
    title: s(row["title"]),
    scope: (row["scope"] as string | null) ?? null,
    building: (row["building"] as string | null) ?? null,
    observed_date: (row["observed_date"] as string | null) ?? null,
    observed_time_precision: (row["observed_time_precision"] as string | null) ?? null,
    timezone: (row["timezone"] as string | null) ?? null,
    source: (row["source"] as string | null) ?? null,
    manifest_sha256: s(row["manifest_sha256"]),
    evidence: Array.isArray(row["evidence"]) ? (row["evidence"] as never) : [],
    status: s(row["status"]),
    summary: (row["summary"] as BatchSummary) ?? {},
    compensates_batch_id: (row["compensates_batch_id"] as string | null) ?? null,
    approved_by: (row["approved_by"] as string | null) ?? null,
    approved_at: (row["approved_at"] as string | null) ?? null,
    applied_at: (row["applied_at"] as string | null) ?? null,
    created_at: s(row["created_at"]),
  };
}

async function loadBatch(db: LooseDb, batchId: string) {
  const { data, error } = await db.from(BATCHES).select("*").eq("batch_id", batchId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Audit batch ${batchId} was not found.`);
  return data as Record<string, unknown>;
}

async function storeItems(
  db: LooseDb,
  batchUuid: string,
  items: ClassifiedItem[],
  approvedKeys: Set<string>,
) {
  const rows = items.map((i) => ({
    batch_uuid: batchUuid,
    item_key: i.item_key,
    entity_kind: i.entity_kind,
    target_stable_id: i.target_stable_id,
    observation_class: i.observation_class,
    operation: i.operation,
    payload: i.payload as unknown,
    expected_updated_at: i.expected_updated_at,
    preview_before: i.before as unknown,
    preview_after: i.after as unknown,
    disposition: i.disposition satisfies AuditDisposition,
    validation_messages: i.messages as unknown,
    approved: approvedKeys.has(i.item_key) && i.disposition === "ready",
  }));
  const { error } = await db.from(ITEMS).upsert(rows, { onConflict: "batch_uuid,item_key" });
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------ *
 * Import — parses, validates and stages. Writes no electrical record.
 * ------------------------------------------------------------------ */

/**
 * Shared staging path used by manual import and by the peer-instance pull.
 * Validates, records provenance and stages a preview. Writes no electrical record
 * and never approves or applies anything.
 */
export async function stageManifestText(
  context: { supabase: unknown; userId: string },
  manifestText: string,
  provenance?: { source_note: string },
): Promise<AuditBatchPreview> {
  {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    const db = context.supabase as unknown as LooseDb;

    const parsed = parseManifest(manifestText);
    if (!parsed.ok || !parsed.manifest) {
      throw new Error(`Manifest rejected: ${parsed.errors.join(" | ")}`);
    }
    const manifest = parsed.manifest;
    const checksum = await manifestChecksum(manifest);

    const existing = await db
      .from(BATCHES)
      .select("*")
      .eq("batch_id", manifest.batch_id)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);

    let batchRow = existing.data as Record<string, unknown> | null;
    if (batchRow) {
      const verdict = classifyStoredManifest(
        { batch_id: manifest.batch_id, checksum },
        { manifest_sha256: s(batchRow["manifest_sha256"]), status: s(batchRow["status"]) },
      );
      // Strict fingerprint: the stored bytes own the batch ID.
      if (verdict.kind === "fingerprint_conflict") throw new Error(verdict.message);
      if (verdict.kind === "already_applied") {
        // Idempotent re-import of an applied batch: report, never re-stage.
        return previewFor(context, batchRow, manifest, { qaBefore: null });
      }
    } else {

      const insert = await db
        .from(BATCHES)
        .insert({
          batch_id: manifest.batch_id,
          schema_version: AUDIT_BATCH_SCHEMA_VERSION,
          title: manifest.title,
          scope: manifest.scope ?? null,
          building: manifest.building ?? null,
          observed_date: manifest.observed_date ?? null,
          observed_time_precision: manifest.observed_time_precision ?? null,
          timezone: manifest.timezone ?? null,
          source: provenance?.source_note
            ? [manifest.source, provenance.source_note].filter(Boolean).join(" | ")
            : (manifest.source ?? null),
          manifest_sha256: checksum,
          manifest: manifest as unknown,
          evidence: manifest.evidence as unknown,
          compensates_batch_id: manifest.compensates_batch_id ?? null,
          status: "validated",
          created_by: context.userId,
        })
        .select("*")
        .maybeSingle();
      if (insert.error) throw new Error(insert.error.message);
      batchRow = insert.data as Record<string, unknown>;
    }

    return previewFor(context, batchRow!, manifest, { qaBefore: null, stage: true });
  }
}

export const importElectricalAuditBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ manifest: z.string().min(2).max(4_000_000) }).parse(d),
  )
  .handler(({ context, data }): Promise<AuditBatchPreview> =>
    stageManifestText(context, data.manifest),
  );

/* ------------------------------------------------------------------ *
 * Reject — closes out a stored batch that will never be applied (for
 * example, superseded by a corrected revision). The stored manifest and
 * its fingerprint are left untouched: only the batch status and the
 * recorded reason change, so the original import stays auditable.
 * ------------------------------------------------------------------ */

export const rejectElectricalAuditBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        batch_id: z.string().min(3).max(120),
        reason: z.string().min(5).max(500),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    await requireAdminRole(context.supabase, context.userId);
    const db = context.supabase as unknown as LooseDb;

    const batchRow = await loadBatch(db, data.batch_id);
    const status = s(batchRow["status"]);
    if (["applied", "partially_applied"].includes(status)) {
      throw new Error(
        `Batch ${data.batch_id} is ${status}; an applied batch is reversed with a compensating batch, never rejected.`,
      );
    }
    if (status === "rejected") {
      return { ok: true as const, batch_id: data.batch_id, status, already: true as const };
    }

    const { error } = await db
      .from(BATCHES)
      .update({ status: "rejected", approval_reason: data.reason })
      .eq("id", String(batchRow["id"]));
    if (error) throw new Error(error.message);

    await recordElectricalChange(context.supabase, context.userId, {
      section: AUDIT_SECTION,
      action: "update",
      entityKind: "audit_batch",
      entityRef: data.batch_id,
      summary: `${data.batch_id} rejected without application — ${data.reason}`,
      changes: [{ column: "status", before: status, after: "rejected" }],
    });

    return { ok: true as const, batch_id: data.batch_id, status: "rejected", already: false as const };
  });


/* ------------------------------------------------------------------ *
 * Peer-instance pull — stages a manifest exported by another FarmOps
 * deployment through GET /api/v1/electrical/audit-batches/{id}/manifest.
 * One-way, preview only: the pulled batch lands as `validated`, with no
 * approvals carried over and no write performed here.
 * ------------------------------------------------------------------ */

export interface PeerPullResult {
  peer: { base_url: string; batch_id: string; status: string | null; applied_at: string | null };
  checksum: { peer_stored: string | null; peer_recomputed: string | null; matches: boolean };
  /** Absent when the pull was refused; `error` then explains why. Nothing is staged. */
  preview: AuditBatchPreview | null;
  /** Human-readable refusal reason; null on a successful pull. */
  error: string | null;
}

/**
 * Fetch and integrity-check one manifest from a peer instance.
 *
 * Shared by the manual pull and by the scheduled pull job so both run exactly
 * the same safety checks: https-only, resolved-address SSRF guard, no
 * redirects, and a checksum that must match what the peer stored.
 */
export interface PeerManifestFetch {
  origin: string;
  manifest: unknown;
  peer_stored: string | null;
  peer_recomputed: string | null;
  local_checksum: string;
  status: string | null;
  applied_at: string | null;
}

export async function fetchPeerManifest(
  peerBaseUrl: string,
  batchId: string,
  peerToken: string,
): Promise<PeerManifestFetch> {
  const base = assertPeerUrl(peerBaseUrl);
  const endpoint = new URL(
    `/api/v1/electrical/audit-batches/${encodeURIComponent(batchId)}/manifest`,
    base.origin,
  );

  let res: Response;
  try {
    // peerFetch resolves the hostname and refuses private/loopback/link-local
    // /reserved answers, and disables redirects so a 302 cannot escape them.
    res = await peerFetch(endpoint, {
      method: "GET",
      headers: { authorization: `Bearer ${peerToken}`, accept: "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (message.includes("Peer instance")) throw e;
    throw new Error("Peer instance could not be reached.");
  }
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(
        `The peer instance has no field-audit batch "${batchId}" to export (HTTP 404). Check the batch ID exactly as it is stored there — its own batch list at /api/v1/electrical/audit-batches shows the available IDs — and make sure the peer is running a build that serves the manifest endpoint.`,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `The peer instance rejected this key (HTTP ${res.status}). Register the key there and grant it electrical:audit-batches:read.`,
      );
    }
    throw new Error(`Peer instance refused the manifest export (HTTP ${res.status}).`);
  }
  const body = (await res.json()) as Record<string, unknown>;
  const manifest = body["manifest"];
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Peer response carried no manifest object.");
  }
  const peerStored = body["stored_manifest_sha256"] == null ? null : String(body["stored_manifest_sha256"]);
  const peerRecomputed =
    body["recomputed_manifest_sha256"] == null ? null : String(body["recomputed_manifest_sha256"]);
  if (peerStored && peerRecomputed && peerStored !== peerRecomputed) {
    throw new Error(
      "Peer manifest checksum does not match the manifest it stored; refusing to stage a manifest whose integrity the peer cannot prove.",
    );
  }
  const localChecksum = await manifestChecksum(manifest);
  if (peerStored && localChecksum !== peerStored) {
    throw new Error(
      `Manifest checksum mismatch after transfer (peer ${peerStored}, here ${localChecksum}). Nothing was staged.`,
    );
  }
  return {
    origin: base.origin,
    manifest,
    peer_stored: peerStored,
    peer_recomputed: peerRecomputed,
    local_checksum: localChecksum,
    status: body["status"] == null ? null : String(body["status"]),
    applied_at: body["applied_at"] == null ? null : String(body["applied_at"]),
  };
}

/** List the batch metadata a peer instance exposes (no manifests). */
export async function fetchPeerBatchList(
  peerBaseUrl: string,
  peerToken: string,
): Promise<Record<string, unknown>[]> {
  const base = assertPeerUrl(peerBaseUrl);
  const endpoint = new URL("/api/v1/electrical/audit-batches", base.origin);
  let res: Response;
  try {
    res = await peerFetch(endpoint, {
      method: "GET",
      headers: { authorization: `Bearer ${peerToken}`, accept: "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (message.includes("Peer instance")) throw e;
    throw new Error("Peer instance could not be reached.");
  }
  if (!res.ok) {
    throw new Error(
      `Peer instance refused the batch list (HTTP ${res.status}). The token needs electrical:audit-batches:read.`,
    );
  }
  const body = (await res.json()) as Record<string, unknown>;
  const rows = body["batches"];
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

export const pullPeerAuditBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        peer_base_url: z.string().trim().min(8).max(300),
        batch_id: z.string().trim().min(3).max(128),
        peer_token: z.string().trim().min(10).max(4000),
      })
      .parse(d),
  )
  .handler(async ({ context, data }): Promise<PeerPullResult> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    await requireAdminRole(context.supabase, context.userId);

    // A refusal by the peer (missing batch, wrong scope, unreachable) is an
    // expected operator condition, not a crash: report it so the panel can show
    // the reason instead of the page failing on an RPC exception.
    let fetched: PeerManifestFetch;
    try {
      fetched = await fetchPeerManifest(data.peer_base_url, data.batch_id, data.peer_token);
    } catch (e) {
      return {
        peer: { base_url: data.peer_base_url, batch_id: data.batch_id, status: null, applied_at: null },
        checksum: { peer_stored: null, peer_recomputed: null, matches: false },
        preview: null,
        error: e instanceof Error ? e.message : "The peer instance could not be reached.",
      };
    }
    const preview = await stageManifestText(context, JSON.stringify(fetched.manifest), {
      source_note: `pulled from peer ${fetched.origin} on ${new Date().toISOString()} (peer status ${fetched.status ?? "unknown"})`,
    });

    await recordElectricalChange(context.supabase, context.userId, {
      section: AUDIT_SECTION,
      action: "peer_pull_staged",
      entity_kind: "audit_batch",
      entity_ref: data.batch_id,
      detail: {
        peer_origin: fetched.origin,
        peer_status: fetched.status,
        peer_applied_at: fetched.applied_at,
        manifest_sha256: fetched.local_checksum,
        staged_preview_only: true,
      },
    } as never);

    return {
      peer: {
        base_url: fetched.origin,
        batch_id: data.batch_id,
        status: fetched.status,
        applied_at: fetched.applied_at,
      },
      checksum: {
        peer_stored: fetched.peer_stored,
        peer_recomputed: fetched.peer_recomputed,
        matches: !fetched.peer_stored || fetched.peer_stored === fetched.local_checksum,
      },
      preview,
      error: null,
    };
  });

/* ------------------------------------------------------------------ *
 * Preview — recomputed from the live snapshot every time.
 * ------------------------------------------------------------------ */

async function previewFor(
  context: { supabase: unknown; userId: string },
  batchRow: Record<string, unknown>,
  manifest: AuditBatchManifest,
  opts: { qaBefore: QaCounts | null; stage?: boolean; applied?: boolean; refused?: string | null },
): Promise<AuditBatchPreview> {
  const db = context.supabase as unknown as LooseDb;
  const live = await readSnapshot(db);
  const items = classifyAll(manifest, live);

  const priorApproval = await db
    .from(ITEMS)
    .select("item_key, approved, disposition, applied_at")
    .eq("batch_uuid", String(batchRow["id"]));
  if (priorApproval.error) throw new Error(priorApproval.error.message);
  const priorRows = (priorApproval.data ?? []) as {
    item_key: string;
    approved: boolean;
    disposition: string;
    applied_at: string | null;
  }[];
  const approvedKeys = new Set(priorRows.filter((r) => r.approved).map((r) => r.item_key));
  const appliedKeys = new Map(
    priorRows.filter((r) => r.applied_at).map((r) => [r.item_key, r.applied_at as string]),
  );

  // An item already applied reports as applied, never as a second change.
  const finalItems = items.map((i) =>
    appliedKeys.has(i.item_key)
      ? {
          ...i,
          operation: i.changes.length ? i.operation : "NO_CHANGE",
          disposition: "applied" as AuditDisposition,
          messages: [
            ...i.messages,
            {
              level: "info" as const,
              text: `Already applied ${appliedKeys.get(i.item_key)}; a retry writes nothing.`,
            },
          ],
        }
      : i,
  );

  const summary = summarize(finalItems);

  if (opts.stage) {
    await storeItems(db, String(batchRow["id"]), finalItems, approvedKeys);
    const { error } = await db
      .from(BATCHES)
      .update({ summary: summary as unknown })
      .eq("id", String(batchRow["id"]));
    if (error) throw new Error(error.message);
  }

  return {
    batch: toRecord({ ...batchRow, summary }),
    gate_version: AUDIT_BATCH_GATE_VERSION,
    generated_at: new Date().toISOString(),
    items: finalItems,
    approved: [...approvedKeys],
    summary,
    qa: opts.applied ? await qaCounts(context.supabase) : null,
    qa_before: opts.qaBefore,
    applied: Boolean(opts.applied),
    refused_reason: opts.refused ?? null,
  };
}

export const previewElectricalAuditBatch = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ batch_id: z.string().trim().min(1) }).parse(d))
  .handler(async ({ context, data }): Promise<AuditBatchPreview> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    const db = context.supabase as unknown as LooseDb;
    const batchRow = await loadBatch(db, data.batch_id);
    const parsed = parseManifest(batchRow["manifest"]);
    if (!parsed.ok || !parsed.manifest) {
      throw new Error(`Stored manifest is no longer valid: ${parsed.errors.join(" | ")}`);
    }
    return previewFor(context, batchRow, parsed.manifest, { qaBefore: null });
  });

export const listElectricalAuditBatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AuditBatchRecord[]> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    const db = context.supabase as unknown as LooseDb;
    const { data, error } = await db
      .from(BATCHES)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Record<string, unknown>[]).map(toRecord);
  });

/* ------------------------------------------------------------------ *
 * Owner approval — only `ready` items can be approved.
 * ------------------------------------------------------------------ */

export const setElectricalAuditItemApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        batch_id: z.string().trim().min(1),
        item_keys: z.array(z.string().trim().min(1)).max(2000),
        approved: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    await requireAdminRole(context.supabase, context.userId);
    const db = context.supabase as unknown as LooseDb;
    const batchRow = await loadBatch(db, data.batch_id);
    if (!data.item_keys.length) return { ok: true, updated: 0 };

    let query = db
      .from(ITEMS)
      .update({ approved: data.approved })
      .eq("batch_uuid", String(batchRow["id"]))
      .in("item_key", data.item_keys);
    if (data.approved) query = query.eq("disposition", "ready");
    const { error } = await query;
    if (error) throw new Error(error.message);
    return { ok: true, updated: data.item_keys.length };
  });

/* ------------------------------------------------------------------ *
 * Apply — guarded, owner-approved, dependency-ordered.
 * ------------------------------------------------------------------ */

export const applyElectricalAuditBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        batch_id: z.string().trim().min(1),
        statement: z.string().trim().min(10).max(400),
        reason: z.string().trim().min(3).max(1000),
        confirm: z.literal(true),
      })
      .parse(d),
  )
  .handler(async ({ context, data }): Promise<AuditBatchPreview> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    await requireAdminRole(context.supabase, context.userId);
    const db = context.supabase as unknown as LooseDb;

    const batchRow = await loadBatch(db, data.batch_id);
    const parsed = parseManifest(batchRow["manifest"]);
    if (!parsed.ok || !parsed.manifest) {
      throw new Error(`Stored manifest is no longer valid: ${parsed.errors.join(" | ")}`);
    }
    const manifest = parsed.manifest;
    const qaBefore = await qaCounts(context.supabase);

    // Which items the owner approved, and what the preview promised.
    const itemRows = await db
      .from(ITEMS)
      .select("item_key, approved, expected_updated_at, applied_at, applied_row_uuid")
      .eq("batch_uuid", String(batchRow["id"]));
    if (itemRows.error) throw new Error(itemRows.error.message);
    const staged = new Map(
      ((itemRows.data ?? []) as {
        item_key: string;
        approved: boolean;
        expected_updated_at: string | null;
        applied_at: string | null;
        applied_row_uuid: string | null;
      }[]).map((r) => [r.item_key, r]),
    );

    const live = await readSnapshot(db);
    const prepared = prepareBatch(manifest, live);
    const items = prepared.items;
    const approved = items.filter((i) => staged.get(i.item_key)?.approved);
    const pending = approved.filter((i) => !staged.get(i.item_key)?.applied_at);

    if (!pending.length) {
      return previewFor(context, batchRow, manifest, {
        qaBefore,
        refused: approved.length
          ? "Every approved item was already applied; this retry wrote nothing."
          : "No approved items to apply.",
      });
    }

    // Refuse the entire transaction when any approved target drifted.
    for (const item of pending) {
      const promised = staged.get(item.item_key)?.expected_updated_at ?? null;
      const current = item.expected_updated_at;
      if (s(promised) !== s(current)) {
        return previewFor(context, batchRow, manifest, {
          qaBefore,
          refused: `${item.item_key} (${item.target_stable_id ?? item.entity_kind}) changed since the preview was taken. The whole approved transaction was refused — re-import and review the new preview.`,
        });
      }
      if (item.disposition !== "ready") {
        return previewFor(context, batchRow, manifest, {
          qaBefore,
          refused: `${item.item_key} is no longer ready to apply (${item.disposition}). The whole approved transaction was refused.`,
        });
      }
    }

    // Every manifest-local dependency must itself be in this transaction (or
    // already applied), otherwise the whole selection is refused rather than
    // leaving an unlinked child behind.
    const selected = new Set(pending.map((i) => i.item_key));
    const alreadyApplied = new Map<string, string>();
    for (const [key, row] of staged) {
      if (row.applied_at) {
        const uuid = (row as { applied_row_uuid?: string | null }).applied_row_uuid;
        if (uuid) alreadyApplied.set(key, String(uuid));
      }
    }
    for (const item of pending) {
      for (const value of Object.values(item.patch)) {
        if (!isPendingRef(value)) continue;
        const dep = pendingRefItemKey(value);
        if (selected.has(dep) || alreadyApplied.has(dep)) continue;
        return previewFor(context, batchRow, manifest, {
          qaBefore,
          refused: `${item.item_key} depends on ${dep}, which is not approved in this transaction. Approve the parent record first — the whole selection was refused.`,
        });
      }
    }

    const ordered = orderForApply(pending, prepared.graph.dependsOn);

    // Rollback bookkeeping: created rows are deleted and updated rows are
    // restored if any part of the selected transaction fails.
    const createdRows: { table: string; uuid: string; item_key: string }[] = [];
    const updatedRows: {
      table: string;
      uuid: string;
      item_key: string;
      restore: Record<string, unknown>;
    }[] = [];
    const createdUuids = new Map(alreadyApplied);
    const failures: string[] = [];

    const substitute = (patch: Record<string, unknown>) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (isPendingRef(v)) {
          const uuid = createdUuids.get(pendingRefItemKey(v));
          if (!uuid) {
            throw new Error(
              `Manifest-local dependency ${pendingRefItemKey(v)} produced no record; ${k} cannot be linked.`,
            );
          }
          out[k] = uuid;
          continue;
        }
        out[k] = v;
      }
      return out;
    };

    for (const item of ordered) {
      const target = AUDIT_ENTITY_TARGETS[item.entity_kind];
      const nowIso = new Date().toISOString();
      try {
        const patch = substitute(item.patch);
        if (item.operation === "CREATE") {
          const insert = { ...patch, user_id: context.userId };
          const res = await db.from(target.table).insert(insert).select("id").maybeSingle();
          if (res.error) throw new Error(res.error.message);
          const uuid = res.data ? String((res.data as { id: string }).id) : "";
          if (uuid) {
            createdUuids.set(item.item_key, uuid);
            createdRows.push({ table: target.table, uuid, item_key: item.item_key });
          }
          await db
            .from(ITEMS)
            .update({
              disposition: "applied",
              applied_at: nowIso,
              applied_row_uuid: uuid || null,
            })
            .eq("batch_uuid", String(batchRow["id"]))
            .eq("item_key", item.item_key);
        } else {
          const rowUuid = String(item.before?.["id"] ?? "");
          if (!rowUuid) throw new Error("Target row UUID missing.");
          const restore: Record<string, unknown> = {};
          for (const column of Object.keys(patch)) {
            restore[column] = (item.before as Record<string, unknown> | null)?.[column] ?? null;
          }
          const res = await db.from(target.table).update(patch).eq("id", rowUuid);
          if (res.error) throw new Error(res.error.message);
          updatedRows.push({ table: target.table, uuid: rowUuid, item_key: item.item_key, restore });
          await db
            .from(ITEMS)
            .update({ disposition: "applied", applied_at: nowIso, applied_row_uuid: rowUuid })
            .eq("batch_uuid", String(batchRow["id"]))
            .eq("item_key", item.item_key);
        }

        await recordElectricalChange(context.supabase, context.userId, {
          section: AUDIT_SECTION,
          entityKind: item.entity_kind,
          action: item.operation === "CREATE" ? "create" : "update",
          entityUuid: (item.before?.["id"] as string | undefined) ?? null,
          entityRef: item.target_stable_id,
          summary: `${manifest.batch_id}: ${item.operation} ${item.entity_kind} ${
            item.target_stable_id ?? item.item_key
          } — ${item.evidence}`,
          changes: item.changes.length
            ? item.changes
            : Object.entries(patch).map(([column, after]) => ({
                column,
                before: null,
                after: after == null ? null : String(after),
              })),
        });
      } catch (error) {
        failures.push(`${item.item_key}: ${String(error)}`);
        await db
          .from(ITEMS)
          .update({ disposition: "failed" })
          .eq("batch_uuid", String(batchRow["id"]))
          .eq("item_key", item.item_key);
        break;
      }
    }

    // Any failure rolls the whole selected transaction back: created rows are
    // removed and updated columns restored, so no dependent link is orphaned.
    if (failures.length) {
      for (const row of [...updatedRows].reverse()) {
        await db.from(row.table).update(row.restore).eq("id", row.uuid);
      }
      for (const row of [...createdRows].reverse()) {
        await db.from(row.table).delete().eq("id", row.uuid);
      }
      const keys = [...createdRows, ...updatedRows].map((r) => r.item_key);
      if (keys.length) {
        await db
          .from(ITEMS)
          .update({ disposition: "ready", applied_at: null, applied_row_uuid: null })
          .eq("batch_uuid", String(batchRow["id"]))
          .in("item_key", keys);
      }
      await db
        .from(BATCHES)
        .update({ status: "validated" })
        .eq("id", String(batchRow["id"]));
      const fresh = await loadBatch(db, data.batch_id);
      return previewFor(context, fresh, manifest, {
        qaBefore,
        refused: `The approved transaction was rolled back; nothing was left partially applied. Failed items: ${failures.join(" | ")}`,
      });
    }


    const qaAfter = await qaCounts(context.supabase);
    const regressed =
      qaBefore && qaAfter ? qaAfter.error > qaBefore.error : false;

    const allApplied = !failures.length;
    await db
      .from(BATCHES)
      .update({
        status: allApplied ? "applied" : "partially_applied",
        approval_statement: data.statement,
        approval_reason: data.reason,
        approved_by: context.userId,
        approved_at: new Date().toISOString(),
        applied_at: new Date().toISOString(),
      })
      .eq("id", String(batchRow["id"]));

    const refused = [
      failures.length ? `Failed items: ${failures.join(" | ")}` : "",
      regressed
        ? `Post-apply QA regressed (${qaBefore?.error} → ${qaAfter?.error} errors). Batch completion is blocked until the new integrity error is resolved.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");

    const fresh = await loadBatch(db, data.batch_id);
    return previewFor(context, fresh, manifest, {
      qaBefore,
      applied: true,
      refused: refused || null,
    });
  });

/* ------------------------------------------------------------------ *
 * Compensating batch — the only supported recovery path.
 * ------------------------------------------------------------------ */

export const compensatingAuditBatchManifest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ batch_id: z.string().trim().min(1) }).parse(d))
  .handler(async ({ context, data }): Promise<{ manifest: AuditBatchManifest }> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    const db = context.supabase as unknown as LooseDb;
    const batchRow = await loadBatch(db, data.batch_id);
    const { data: rows, error } = await db
      .from(ITEMS)
      .select("*")
      .eq("batch_uuid", String(batchRow["id"]))
      .not("applied_at", "is", null);
    if (error) throw new Error(error.message);

    const applied = ((rows ?? []) as Record<string, unknown>[]).map((r) => {
      const before = (r["preview_before"] ?? {}) as Record<string, unknown>;
      const after = (r["preview_after"] ?? {}) as Record<string, unknown>;
      const changes = Object.keys(after)
        .filter((k) => String(after[k] ?? "") !== String(before[k] ?? ""))
        .map((k) => ({
          column: k,
          before: before[k] == null ? null : String(before[k]),
          after: after[k] == null ? null : String(after[k]),
        }));
      return {
        item_key: s(r["item_key"]),
        entity_kind: s(r["entity_kind"]) as AuditEntityKind,
        target_stable_id: (r["target_stable_id"] as string | null) ?? null,
        operation: s(r["operation"]) as ClassifiedItem["operation"],
        changes,
      } as ClassifiedItem;
    });

    return {
      manifest: compensatingManifest(
        {
          batch_id: s(batchRow["batch_id"]),
          title: s(batchRow["title"]),
          building: (batchRow["building"] as string | null) ?? null,
        },
        applied,
      ),
    };
  });

/* ------------------------------------------------------------------ *
 * Revision diff — read-only comparison of two staged/stored manifests.
 * Shows what changed before the owner approves anything. Writes nothing.
 * ------------------------------------------------------------------ */

export const diffElectricalAuditManifests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        base_batch_id: z.string().trim().min(1),
        revision_batch_id: z.string().trim().min(1),
      })
      .parse(d),
  )
  .handler(async ({ context, data }): Promise<ManifestDiff> => {
    await requireElectricalAccess(context.supabase, context.userId, "write");
    const db = context.supabase as unknown as LooseDb;
    const [baseRow, revRow] = await Promise.all([
      loadBatch(db, data.base_batch_id),
      loadBatch(db, data.revision_batch_id),
    ]);
    const base = parseManifest(baseRow["manifest"]);
    const revision = parseManifest(revRow["manifest"]);
    if (!base.ok || !base.manifest) {
      throw new Error(`Stored manifest ${data.base_batch_id} is not valid: ${base.errors.join(" | ")}`);
    }
    if (!revision.ok || !revision.manifest) {
      throw new Error(
        `Stored manifest ${data.revision_batch_id} is not valid: ${revision.errors.join(" | ")}`,
      );
    }
    return diffManifests(base.manifest, revision.manifest);
  });
