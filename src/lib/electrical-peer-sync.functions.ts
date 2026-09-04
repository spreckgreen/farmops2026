// Admin controls for the scheduled, preview-only peer audit-batch pull.
// Reading, saving, pausing and resuming only. The pull itself never applies a
// batch and never carries a peer approval across.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminRole } from "@/lib/admin-role.server";
import { assertPeerUrl } from "@/lib/electrical-peer-net";

const LOCK_NAME = "electrical-peer-sync";

export interface PeerSyncState {
  config: {
    id: string;
    enabled: boolean;
    peer_base_url: string;
    max_batches_per_run: number;
    last_run_at: string | null;
    last_success_at: string | null;
    last_error: string | null;
    batches_staged_total: number;
  } | null;
  job: {
    paused: boolean;
    paused_reason: string | null;
    last_run_at: string | null;
    consecutive_failures: number;
    running: boolean;
  } | null;
  token_configured: boolean;
  cron_secret_configured: boolean;
  runs: PeerSyncRunLogRow[];
}

/** One recorded execution of the scheduled pull (append-only, admin-read). */
export interface PeerSyncRunLogRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  trigger: "scheduled" | "manual";
  outcome: "success" | "partial" | "failed" | "skipped";
  skipped_reason: string | null;
  peer_origin: string | null;
  peer_batches_seen: number;
  candidates: number;
  staged: number;
  failed: number;
  capped: boolean;
  error: string | null;
}

export const getPeerSyncState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PeerSyncState> => {
    await requireAdminRole(context.supabase, context.userId);
    const { data: config } = await (context.supabase as never as any)
      .from("electrical_peer_sync_config")
      .select(
        "id, enabled, peer_base_url, max_batches_per_run, last_run_at, last_success_at, last_error, batches_staged_total",
      )
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const { data: job } = await (context.supabase as never as any)
      .from("job_locks")
      .select("paused, paused_reason, last_run_at, consecutive_failures, locked_until")
      .eq("name", LOCK_NAME)
      .maybeSingle();
    const { data: runs } = await (context.supabase as never as any)
      .from("electrical_peer_sync_runs")
      .select(
        "id, started_at, finished_at, duration_ms, trigger, outcome, skipped_reason, peer_origin, peer_batches_seen, candidates, staged, failed, capped, error",
      )
      .order("started_at", { ascending: false })
      .limit(25);
    return {
      runs: (runs ?? []) as PeerSyncRunLogRow[],
      config: (config as PeerSyncState["config"]) ?? null,
      job: job
        ? {
            paused: Boolean(job.paused),
            paused_reason: job.paused_reason ?? null,
            last_run_at: job.last_run_at ?? null,
            consecutive_failures: job.consecutive_failures ?? 0,
            running: Boolean(job.locked_until && job.locked_until > new Date().toISOString()),
          }
        : null,
      token_configured: Boolean(process.env["ELECTRICAL_PEER_SYNC_TOKEN"]),
      cron_secret_configured: Boolean(process.env["ELECTRICAL_PEER_SYNC_CRON_SECRET"]),
    };
  });

export const savePeerSyncConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        peer_base_url: z.string().trim().min(8).max(300),
        enabled: z.boolean(),
        max_batches_per_run: z.number().int().min(1).max(10),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminRole(context.supabase, context.userId);
    // Reuse the same URL guard the pull itself applies, so an unreachable or
    // unsafe peer address can never be saved in the first place.
    const base = assertPeerUrl(data.peer_base_url);
    const db = context.supabase as never as any;
    const { data: existing } = await db
      .from("electrical_peer_sync_config")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const row = {
      peer_base_url: base.origin,
      enabled: data.enabled,
      max_batches_per_run: data.max_batches_per_run,
      run_as_user_id: context.userId,
    };
    if (existing?.id) {
      const { error } = await db
        .from("electrical_peer_sync_config")
        .update(row)
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db.from("electrical_peer_sync_config").insert(row);
      if (error) throw new Error(error.message);
    }
    await db
      .from("job_locks")
      .upsert({ name: LOCK_NAME }, { onConflict: "name", ignoreDuplicates: true });
    return { saved: true, peer_origin: base.origin };
  });

/** Clear a paused (circuit-broken) job so the next scheduled run tries again. */
export const resumePeerSyncJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminRole(context.supabase, context.userId);
    const { error } = await (context.supabase as never as any)
      .from("job_locks")
      .update({ paused: false, paused_reason: null, consecutive_failures: 0, locked_until: null })
      .eq("name", LOCK_NAME);
    if (error) throw new Error(error.message);
    return { resumed: true };
  });

/* -------------------------------------------------------------------------- */
/* Scheduling credential rotation                                             */
/* -------------------------------------------------------------------------- */
//
// The scheduled job reads the ACTIVE credential from a private store when it
// runs, so rotating is a database-only action: no schedule edit, no redeploy.
// A rotation optionally leaves the previous credential valid for a short grace
// window (in case a tick is already in flight), and it can be invalidated
// immediately at any time. Plaintext credentials are never returned to the UI —
// only a short fingerprint.

export interface CronSecretRow {
  id: string;
  fingerprint: string;
  status: "active" | "retiring" | "revoked";
  activated_at: string;
  retire_after: string | null;
  revoked_at: string | null;
  note: string | null;
}

export const listPeerSyncCronSecrets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ secrets: CronSecretRow[] }> => {
    await requireAdminRole(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as never as any).rpc(
      "list_peer_sync_cron_secrets",
      { _actor: context.userId },
    );
    if (error) throw new Error(error.message);
    return { secrets: (data ?? []) as CronSecretRow[] };
  });

export const rotatePeerSyncCronSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ grace_minutes: z.number().int().min(0).max(1440) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminRole(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await (supabaseAdmin as never as any).rpc(
      "rotate_peer_sync_cron_secret",
      { _actor: context.userId, _grace_minutes: data.grace_minutes },
    );
    if (error) throw new Error(error.message);
    const row = (Array.isArray(rows) ? rows[0] : rows) ?? {};
    return {
      rotated: true,
      fingerprint: (row.fingerprint ?? null) as string | null,
      retired_fingerprint: (row.retired_fingerprint ?? null) as string | null,
      retire_after: (row.retire_after ?? null) as string | null,
    };
  });

export const revokeRetiringPeerSyncCronSecrets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminRole(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as never as any).rpc(
      "revoke_retiring_peer_sync_cron_secrets",
      { _actor: context.userId },
    );
    if (error) throw new Error(error.message);
    return { revoked: Number(data ?? 0) };
  });
