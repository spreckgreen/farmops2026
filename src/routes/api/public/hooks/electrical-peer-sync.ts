/**
 * Scheduled peer audit-batch pull.
 *
 * Calls the self-hosted FarmOps instance, and stages any audit batch it has
 * already applied as a PREVIEW here. Nothing is applied and no approval is
 * carried over — the local owner still approves per item.
 *
 * Safety rails (see `job_locks` row `electrical-peer-sync`):
 * - a private server-only shared secret authenticates the cron caller,
 * - single-flight lease so overlapping ticks cannot both pull,
 * - bounded work per run (max_batches_per_run, hard-capped in the engine),
 * - paused-state guard: after 3 consecutive failed runs the job parks itself
 *   and every later tick exits until an admin resumes it.
 */
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

const LOCK_NAME = "electrical-peer-sync";
const LEASE_MS = 5 * 60 * 1000;
const MAX_FAILURES = 3;

function secretOk(provided: string, expected: string): boolean {
  if (!expected || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export const Route = createFileRoute("/api/public/hooks/electrical-peer-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided =
          request.headers.get("x-electrical-peer-sync-secret") ??
          (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
        if (!provided) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Rotatable credentials live in a private store the scheduled job reads
        // at call time. A rotated-out credential stops working the moment its
        // grace window ends (or immediately, when revoked).
        let authorized = false;
        const { data: verified, error: verifyError } = await (supabaseAdmin as never as any).rpc(
          "verify_peer_sync_cron_secret",
          { _secret: provided },
        );
        if (verifyError) {
          console.error(`[electrical-peer-sync] secret check failed: ${verifyError.message}`);
        } else {
          authorized = verified === true;
        }

        // Bootstrap fallback: only when the rotatable store is unavailable
        // (e.g. an instance that has not run this migration yet).
        if (!authorized && verifyError) {
          const envSecret = process.env["ELECTRICAL_PEER_SYNC_CRON_SECRET"] ?? "";
          if (secretOk(provided, envSecret)) authorized = true;
        }


        if (!authorized) return new Response("Unauthorized", { status: 401 });

        const { runPeerAuditSync } = await import("@/lib/electrical-peer-sync.server");


        const now = new Date();
        const nowIso = now.toISOString();

        await supabaseAdmin
          .from("job_locks")
          .upsert({ name: LOCK_NAME }, { onConflict: "name", ignoreDuplicates: true });

        const { data: lock } = await supabaseAdmin
          .from("job_locks")
          .select("paused, paused_reason, locked_until, consecutive_failures")
          .eq("name", LOCK_NAME)
          .maybeSingle();

        if (lock?.paused) {
          return Response.json(
            { skipped: "paused", reason: lock.paused_reason ?? null },
            { status: 200 },
          );
        }
        if (lock?.locked_until && lock.locked_until > nowIso) {
          return Response.json({ skipped: "already-running" }, { status: 200 });
        }

        // The predicate makes the write itself the guard, so a racing tick that
        // lost the lease cannot start a second pull.
        const { data: leased } = await supabaseAdmin
          .from("job_locks")
          .update({ locked_until: new Date(now.getTime() + LEASE_MS).toISOString() })
          .eq("name", LOCK_NAME)
          .or(`locked_until.is.null,locked_until.lt.${nowIso}`)
          .select("name");
        if (!leased || leased.length === 0) {
          return Response.json({ skipped: "lease-lost" }, { status: 200 });
        }

        try {
          const result = await runPeerAuditSync(supabaseAdmin as never, {
            peerToken: process.env["ELECTRICAL_PEER_SYNC_TOKEN"] ?? "",
            trigger: "scheduled",
          });
          const allFailed = result.failed > 0 && result.staged === 0;
          const nextFailures = allFailed ? (lock?.consecutive_failures ?? 0) + 1 : 0;
          await supabaseAdmin
            .from("job_locks")
            .update({
              locked_until: null,
              last_run_at: nowIso,
              consecutive_failures: nextFailures,
              paused: nextFailures >= MAX_FAILURES,
              paused_reason:
                nextFailures >= MAX_FAILURES
                  ? `paused after ${nextFailures} consecutive failed peer pulls`
                  : null,
            })
            .eq("name", LOCK_NAME);
          return Response.json({ ok: true, result }, { status: 200 });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          const nextFailures = (lock?.consecutive_failures ?? 0) + 1;
          await supabaseAdmin
            .from("job_locks")
            .update({
              locked_until: null,
              last_run_at: nowIso,
              consecutive_failures: nextFailures,
              paused: nextFailures >= MAX_FAILURES,
              paused_reason:
                nextFailures >= MAX_FAILURES
                  ? `paused after ${nextFailures} consecutive failed peer pulls: ${message}`
                  : null,
            })
            .eq("name", LOCK_NAME);
          console.error(`[electrical-peer-sync] run failed: ${message}`);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
