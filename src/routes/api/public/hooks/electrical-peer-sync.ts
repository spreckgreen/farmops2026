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
 * - paused-state guard: after 3 consecutive failed runs the job parks itself,
 *   then RETRIES ITSELF automatically after a growing cooling-off window
 *   (30 min, 2 h, 6 h, 12 h). Only after the 4th automatic pause does it wait
 *   for an admin to resume, so a transient outage never needs a click.
 */
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

const LOCK_NAME = "electrical-peer-sync";
const LEASE_MS = 5 * 60 * 1000;
const MAX_FAILURES = 3;

/** Cooling-off windows between automatic retries, in minutes. */
const AUTO_RESUME_BACKOFF_MIN = [30, 120, 360, 720];

/** When the job pauses, when should it try itself again (null = needs an admin)? */
function autoResumeAt(now: Date, autoPauseCount: number): string | null {
  const minutes = AUTO_RESUME_BACKOFF_MIN[autoPauseCount];
  if (minutes === undefined) return null;
  return new Date(now.getTime() + minutes * 60 * 1000).toISOString();
}

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

        const { runPeerAuditSync, recordPeerSyncRun } = await import(
          "@/lib/electrical-peer-sync.server"
        );


        const now = new Date();
        const nowIso = now.toISOString();

        await supabaseAdmin
          .from("job_locks")
          .upsert({ name: LOCK_NAME }, { onConflict: "name", ignoreDuplicates: true });

        const { data: lock } = await (supabaseAdmin as never as any)
          .from("job_locks")
          .select(
            "paused, paused_reason, locked_until, consecutive_failures, auto_resume_at, auto_pause_count",
          )
          .eq("name", LOCK_NAME)
          .maybeSingle();
        const autoPauseCount: number = lock?.auto_pause_count ?? 0;

        // Every tick leaves a trace, including the ones that do no work, so the
        // history on the audit batches page never has silent gaps.
        const logSkip = async (reason: string) =>
          await recordPeerSyncRun(supabaseAdmin as never, {
            started_at: nowIso,
            trigger: "scheduled",
            outcome: "skipped",
            skipped_reason: reason,
          });

        if (lock?.paused) {
          const retryDue = Boolean(lock.auto_resume_at && lock.auto_resume_at <= nowIso);
          if (!retryDue) {
            const waiting = lock.auto_resume_at
              ? `; automatic retry due ${lock.auto_resume_at}`
              : "; waiting for an administrator to resume";
            await logSkip(
              (lock.paused_reason
                ? `paused after repeated failures: ${lock.paused_reason}`
                : "paused after repeated failures") + waiting,
            );
            return Response.json(
              {
                skipped: "paused",
                reason: lock.paused_reason ?? null,
                auto_resume_at: lock.auto_resume_at ?? null,
              },
              { status: 200 },
            );
          }
          // Cooling-off window elapsed: un-pause and let this tick try again.
          // The failure counter resets so one more transient error does not
          // instantly re-park the job.
          await (supabaseAdmin as never as any)
            .from("job_locks")
            .update({
              paused: false,
              paused_reason: null,
              consecutive_failures: 0,
              auto_resume_at: null,
            })
            .eq("name", LOCK_NAME);
          await recordPeerSyncRun(supabaseAdmin as never, {
            started_at: nowIso,
            trigger: "scheduled",
            outcome: "skipped",
            skipped_reason: `automatic retry after cooling-off (attempt ${autoPauseCount + 1}) — resuming this run`,
          });
        }
        if (lock?.locked_until && lock.locked_until > nowIso) {
          await logSkip("another pull was still running");
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
          await logSkip("another pull claimed this run first");
          return Response.json({ skipped: "lease-lost" }, { status: 200 });
        }


        // An automatic retry starts from a clean failure count.
        const priorFailures = autoResumed ? 0 : (lock?.consecutive_failures ?? 0);

        /** Persist the outcome, arming the next automatic retry when it pauses. */
        const settle = async (nextFailures: number, reason: string | null) => {
          const pausing = nextFailures >= MAX_FAILURES;
          const nextAutoPause = pausing ? autoPauseCount + 1 : nextFailures === 0 ? 0 : autoPauseCount;
          await (supabaseAdmin as never as any)
            .from("job_locks")
            .update({
              locked_until: null,
              last_run_at: nowIso,
              consecutive_failures: nextFailures,
              paused: pausing,
              paused_reason: pausing ? reason : null,
              auto_pause_count: nextAutoPause,
              auto_resume_at: pausing ? autoResumeAt(now, autoPauseCount) : null,
            })
            .eq("name", LOCK_NAME);
        };

        try {
          const result = await runPeerAuditSync(supabaseAdmin as never, {
            peerToken: process.env["ELECTRICAL_PEER_SYNC_TOKEN"] ?? "",
            trigger: "scheduled",
          });
          const allFailed = result.failed > 0 && result.staged === 0;
          const nextFailures = allFailed ? priorFailures + 1 : 0;
          await settle(nextFailures, `paused after ${nextFailures} consecutive failed peer pulls`);
          return Response.json({ ok: true, result }, { status: 200 });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          const alreadyLogged = Boolean((e as { loggedRun?: boolean } | null)?.loggedRun);
          if (!alreadyLogged) {
            await recordPeerSyncRun(supabaseAdmin as never, {
              started_at: nowIso,
              trigger: "scheduled",
              outcome: "failed",
              error: message,
            });
          }
          const nextFailures = priorFailures + 1;
          await settle(
            nextFailures,
            `paused after ${nextFailures} consecutive failed peer pulls: ${message}`,
          );
          console.error(`[electrical-peer-sync] run failed: ${message}`);
          return Response.json({ ok: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
