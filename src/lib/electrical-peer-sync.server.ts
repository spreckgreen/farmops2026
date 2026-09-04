// Scheduled one-way pull of applied field-audit batches from a peer FarmOps
// instance (the self-hosted copy) into this instance as PREVIEW ONLY.
//
// What this job does NOT do, by design:
//   - it never applies anything: every pulled batch lands as `validated`,
//     approvals are not carried over, and per-item owner approval plus the
//     expected_updated_at conflict check still gate any write here,
//   - it never pushes anything back to the peer,
//   - it never touches the canonical ODS workbook or engineering values.
//
// Safety rails required of every background job:
//   - bounded work per run (max_batches_per_run, hard ceiling below),
//   - single-flight lease in `job_locks` (the caller holds it),
//   - idempotent progress: staging keys off batch_id + manifest checksum, and
//     batches already present locally are skipped, so a re-run redoes nothing,
//   - circuit breaker + paused-state guard in `job_locks`, checked by the
//     caller before any work happens.
import {
  fetchPeerBatchList,
  fetchPeerManifest,
  stageManifestText,
} from "@/lib/electrical-audit-batch.functions";

/** Hard ceiling regardless of configuration — one run never walks a whole peer. */
export const PEER_SYNC_MAX_BATCHES = 10;
export const PEER_SYNC_LOCK_NAME = "electrical-peer-sync";

/** Peer statuses worth pulling: the audit is finished on the peer side. */
const PULLABLE = new Set(["applied", "partially_applied"]);

type LooseDb = { from: (table: string) => any };

export interface PeerSyncConfigRow {
  id: string;
  enabled: boolean;
  peer_base_url: string;
  run_as_user_id: string;
  max_batches_per_run: number;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  batches_staged_total: number;
}

export interface PeerSyncItemResult {
  batch_id: string;
  outcome: "staged" | "skipped_present" | "skipped_status" | "failed";
  peer_status: string | null;
  peer_applied_at: string | null;
  manifest_sha256?: string;
  message?: string;
}

export interface PeerSyncRunResult {
  ran_at: string;
  peer_origin: string | null;
  peer_batches_seen: number;
  candidates: number;
  staged: number;
  failed: number;
  capped: boolean;
  items: PeerSyncItemResult[];
}

export async function readPeerSyncConfig(db: LooseDb): Promise<PeerSyncConfigRow | null> {
  const { data, error } = await db
    .from("electrical_peer_sync_config")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PeerSyncConfigRow | null) ?? null;
}

/** One row of the append-only execution log shown on the audit batches page. */
export interface PeerSyncRunLogInput {
  started_at: string;
  trigger: "scheduled" | "manual";
  outcome: "success" | "partial" | "failed" | "skipped";
  skipped_reason?: string | null;
  peer_origin?: string | null;
  peer_batches_seen?: number;
  candidates?: number;
  staged?: number;
  failed?: number;
  capped?: boolean;
  error?: string | null;
  items?: unknown;
}

/**
 * Append one execution-log entry. Logging is best-effort on purpose: a failure
 * to record must never fail (or retry) the pull itself.
 */
export async function recordPeerSyncRun(db: LooseDb, input: PeerSyncRunLogInput): Promise<void> {
  const finishedAt = new Date();
  try {
    await db.from("electrical_peer_sync_runs").insert({
      started_at: input.started_at,
      finished_at: finishedAt.toISOString(),
      duration_ms: Math.max(0, finishedAt.getTime() - new Date(input.started_at).getTime()),
      trigger: input.trigger,
      outcome: input.outcome,
      skipped_reason: input.skipped_reason ?? null,
      peer_origin: input.peer_origin ?? null,
      peer_batches_seen: input.peer_batches_seen ?? 0,
      candidates: input.candidates ?? 0,
      staged: input.staged ?? 0,
      failed: input.failed ?? 0,
      capped: input.capped ?? false,
      error: input.error ?? null,
      items: (input.items ?? null) as never,
    });
  } catch (e) {
    console.error(
      `[electrical-peer-sync] could not record run log: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * One bounded sync pass. `db` must be a service-role client for the scheduled
 * path (there is no session) or the caller's client for a manual run.
 */
export async function runPeerAuditSync(
  db: LooseDb,
  options: { peerToken: string; trigger: "scheduled" | "manual" },
): Promise<PeerSyncRunResult> {
  const ranAt = new Date().toISOString();
  const empty: PeerSyncRunResult = {
    ran_at: ranAt,
    peer_origin: null,
    peer_batches_seen: 0,
    candidates: 0,
    staged: 0,
    failed: 0,
    capped: false,
    items: [],
  };
  const skip = async (reason: string) => {
    await recordPeerSyncRun(db, {
      started_at: ranAt,
      trigger: options.trigger,
      outcome: "skipped",
      skipped_reason: reason,
    });
    return empty;
  };
  const config = await readPeerSyncConfig(db);
  // Not configured / switched off / no token is "nothing to do", not a failure:
  // a scheduled run must not trip the circuit breaker just because the owner
  // has not set the peer up yet.
  if (!config) {
    if (options.trigger === "scheduled") return await skip("no peer instance configured");
    throw new Error(
      "No peer instance is configured yet. Save the peer address on the audit batches page first.",
    );
  }
  if (!config.enabled && options.trigger === "scheduled") {
    return await skip("automatic pull is switched off");
  }
  if (!options.peerToken) {
    if (options.trigger === "scheduled") return await skip("peer access key not configured");
    throw new Error(
      "The peer access token is not configured, so the pull cannot authenticate to the peer instance.",
    );
  }


  const limit = Math.max(1, Math.min(config.max_batches_per_run || 5, PEER_SYNC_MAX_BATCHES));
  let peerRows: Record<string, unknown>[];
  try {
    peerRows = await fetchPeerBatchList(config.peer_base_url, options.peerToken);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // A run that could not even list the peer's batches is a failed run, and it
    // is logged as one before the error travels on to the circuit breaker.
    await recordPeerSyncRun(db, {
      started_at: ranAt,
      trigger: options.trigger,
      outcome: "failed",
      peer_origin: config.peer_base_url,
      error: message,
    });
    await db
      .from("electrical_peer_sync_config")
      .update({ last_run_at: ranAt, last_error: message })
      .eq("id", config.id);
    throw e;
  }


  // Everything already known here is skipped: identity is the batch ID, and the
  // staging path additionally refuses a same-ID manifest with a different checksum.
  const localIds = new Set<string>();
  const local = await db.from("electrical_audit_batches").select("batch_id");
  for (const row of (local.data ?? []) as Record<string, unknown>[]) {
    if (row["batch_id"]) localIds.add(String(row["batch_id"]));
  }

  const items: PeerSyncItemResult[] = [];
  const candidates: Record<string, unknown>[] = [];
  for (const row of peerRows) {
    const batchId = row["batch_id"] == null ? "" : String(row["batch_id"]);
    if (!batchId) continue;
    const status = row["status"] == null ? null : String(row["status"]);
    const appliedAt = row["applied_at"] == null ? null : String(row["applied_at"]);
    if (!status || !PULLABLE.has(status)) {
      items.push({ batch_id: batchId, outcome: "skipped_status", peer_status: status, peer_applied_at: appliedAt });
      continue;
    }
    if (localIds.has(batchId)) {
      items.push({ batch_id: batchId, outcome: "skipped_present", peer_status: status, peer_applied_at: appliedAt });
      continue;
    }
    candidates.push(row);
  }

  // Oldest applied first, so a capped run still makes forward progress in order.
  candidates.sort((a, b) => String(a["applied_at"] ?? "").localeCompare(String(b["applied_at"] ?? "")));
  const take = candidates.slice(0, limit);

  let staged = 0;
  let failed = 0;
  let origin: string | null = null;

  for (const row of take) {
    const batchId = String(row["batch_id"]);
    const status = row["status"] == null ? null : String(row["status"]);
    const appliedAt = row["applied_at"] == null ? null : String(row["applied_at"]);
    try {
      const fetched = await fetchPeerManifest(config.peer_base_url, batchId, options.peerToken);
      origin = fetched.origin;
      await stageManifestText(
        { supabase: db, userId: config.run_as_user_id },
        JSON.stringify(fetched.manifest),
        {
          source_note: `pulled automatically from peer ${fetched.origin} on ${ranAt} (peer status ${fetched.status ?? "unknown"}, preview only)`,
        },
      );
      staged += 1;
      items.push({
        batch_id: batchId,
        outcome: "staged",
        peer_status: fetched.status,
        peer_applied_at: fetched.applied_at,
        manifest_sha256: fetched.local_checksum,
      });
    } catch (e) {
      failed += 1;
      items.push({
        batch_id: batchId,
        outcome: "failed",
        peer_status: status,
        peer_applied_at: appliedAt,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const result: PeerSyncRunResult = {
    ran_at: ranAt,
    peer_origin: origin,
    peer_batches_seen: peerRows.length,
    candidates: candidates.length,
    staged,
    failed,
    capped: candidates.length > take.length,
    items,
  };

  const firstError = items.find((i) => i.outcome === "failed")?.message ?? null;
  await db
    .from("electrical_peer_sync_config")
    .update({
      last_run_at: ranAt,
      last_success_at: failed === 0 ? ranAt : config.last_success_at,
      last_error: firstError,
      last_result: result as unknown,
      batches_staged_total: (config.batches_staged_total ?? 0) + staged,
    })
    .eq("id", config.id);

  await recordPeerSyncRun(db, {
    started_at: ranAt,
    trigger: options.trigger,
    outcome: failed === 0 ? "success" : staged > 0 ? "partial" : "failed",
    peer_origin: origin ?? config.peer_base_url,
    peer_batches_seen: peerRows.length,
    candidates: candidates.length,
    staged,
    failed,
    capped: result.capped,
    error: firstError,
    items,
  });

  return result;

}
