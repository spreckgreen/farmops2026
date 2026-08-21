/**
 * Nightly task-health job.
 *
 * Scans every user's tasks for duplicate checkbox-derived tasks and status
 * drift, applies the merges/fixes, and records one `task_health_runs` row per
 * user so `/admin/task-health` can report what happened.
 *
 * Safety rails (see `job_locks`):
 * - single-flight lease so two overlapping cron ticks can't both process,
 * - bounded work per run (`MAX_USERS`, and a merge cap per user),
 * - paused-state guard: after 3 consecutive failures the job parks itself and
 *   every later tick exits until an admin clears the pause.
 */
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

const LOCK_NAME = "task-health-nightly";
const LEASE_MS = 10 * 60 * 1000;
const MAX_USERS = 50;
const MAX_FAILURES = 3;

function secretOk(provided: string, expected: string): boolean {
  if (!expected || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export const Route = createFileRoute("/api/public/hooks/task-health")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const anon = process.env.SUPABASE_ANON_KEY ?? "";
        const provided =
          request.headers.get("apikey") ??
          (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
        if (!secretOk(provided, anon)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { scanTaskHealth, recordTaskHealthRun } = await import("@/lib/task-health.server");

        const now = new Date();
        const nowIso = now.toISOString();

        // Ensure the lock row exists, then read its state.
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

        // Acquire the lease. The predicate makes the write itself the guard, so
        // a racing tick that lost cannot take the lease.
        const { data: leased } = await supabaseAdmin
          .from("job_locks")
          .update({ locked_until: new Date(now.getTime() + LEASE_MS).toISOString() })
          .eq("name", LOCK_NAME)
          .or(`locked_until.is.null,locked_until.lt.${nowIso}`)
          .select("name");
        if (!leased || leased.length === 0) {
          return Response.json({ skipped: "lease-lost" }, { status: 200 });
        }

        const summary: Array<{
          userId: string;
          ok: boolean;
          merges: number;
          drift: number;
          error?: string;
        }> = [];
        let failures = 0;

        try {
          const { data: profiles, error: pErr } = await supabaseAdmin
            .from("profiles")
            .select("id")
            .eq("status", "approved")
            .order("created_at", { ascending: true })
            .limit(MAX_USERS);
          if (pErr) throw new Error(pErr.message);

          for (const p of profiles ?? []) {
            const userId = p.id as string;
            try {
              const report = await scanTaskHealth(supabaseAdmin, userId, {
                apply: true,
                maxMerges: 200,
              });
              await recordTaskHealthRun(supabaseAdmin, report, "scheduled");
              summary.push({
                userId,
                ok: true,
                merges: report.mergesApplied,
                drift: report.driftFixed,
              });
            } catch (e) {
              failures += 1;
              const message = e instanceof Error ? e.message : String(e);
              console.error(`[task-health] user ${userId} failed: ${message}`);
              summary.push({ userId, ok: false, merges: 0, drift: 0, error: message });
            }
          }

          const allFailed = failures > 0 && failures === summary.length;
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
                  ? `paused after ${nextFailures} consecutive failed runs`
                  : null,
            })
            .eq("name", LOCK_NAME);

          return Response.json(
            { ok: true, users: summary.length, failures, results: summary },
            { status: 200 },
          );
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
                  ? `paused after ${nextFailures} consecutive failed runs: ${message}`
                  : null,
            })
            .eq("name", LOCK_NAME);
          console.error(`[task-health] run failed: ${message}`);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
