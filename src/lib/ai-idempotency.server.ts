// Server-side idempotency for AI jobs. Deduplicates concurrent or repeated
// requests keyed by (user_id, surface, sha256(canonical input)).
//
// Semantics:
//   - First caller inserts a row with status='running' and executes work.
//   - Concurrent callers see 'running' and receive a 409-shaped error unless
//     the running row is stale (older than STALE_MS) — then they take it over.
//   - A subsequent caller within CACHE_MS of a 'done' row receives the cached
//     result instead of re-running the model.
//   - 'error' rows are always retryable.
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const CACHE_MS = 30_000; // return cached success for 30s
const STALE_MS = 120_000; // running row this old is considered abandoned

export class AiJobInFlightError extends Error {
  code = "AI_JOB_IN_FLIGHT" as const;
  constructor(surface: string) {
    super(
      `An AI job for "${surface}" is already running for this request. ` +
        `Wait for it to finish or cancel it before retrying.`,
    );
  }
}

function canonicalize(value: unknown): string {
  // Stable JSON: sort object keys so key order can't change the hash.
  const seen = new WeakSet<object>();
  const norm = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v as object)) return null;
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(norm);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = norm((v as Record<string, unknown>)[k]);
    }
    return out;
  };
  return JSON.stringify(norm(value));
}

export function hashInput(surface: string, input: unknown): string {
  return createHash("sha256")
    .update(surface)
    .update("|")
    .update(canonicalize(input))
    .digest("hex");
}

/**
 * Wrap an AI job body in a single-flight + short-lived result cache.
 * The row is stored under the authenticated user's id via RLS.
 */
export async function withIdempotency<T>(
  args: {
    supabase: SupabaseClient;
    userId: string;
    surface: string;
    input: unknown;
  },
  work: () => Promise<T>,
): Promise<T> {
  const { supabase, userId, surface, input } = args;
  const request_hash = hashInput(surface, input);
  const now = Date.now();

  // Look at any existing row first.
  const { data: existing } = await supabase
    .from("ai_job_idempotency")
    .select("id, status, result, updated_at")
    .eq("user_id", userId)
    .eq("surface", surface)
    .eq("request_hash", request_hash)
    .maybeSingle();

  if (existing) {
    const age = now - new Date(existing.updated_at as string).getTime();
    if (existing.status === "done" && age < CACHE_MS) {
      return existing.result as T;
    }
    if (existing.status === "running" && age < STALE_MS) {
      throw new AiJobInFlightError(surface);
    }
    // Stale running / previous error / expired done → take it over.
    const { error: claimErr } = await supabase
      .from("ai_job_idempotency")
      .update({ status: "running", result: null, error: null })
      .eq("id", existing.id)
      .eq("status", existing.status); // optimistic guard
    if (claimErr) throw new Error(claimErr.message);
  } else {
    // Try to claim the slot. Unique (user_id, surface, request_hash) means
    // a concurrent insert will fail — treat that as "already running".
    const { error: insertErr } = await supabase
      .from("ai_job_idempotency")
      .insert({
        user_id: userId,
        surface,
        request_hash,
        status: "running",
      } as never);
    if (insertErr) {
      if (/duplicate key|unique/i.test(insertErr.message)) {
        throw new AiJobInFlightError(surface);
      }
      throw new Error(insertErr.message);
    }
  }

  try {
    const result = await work();
    await supabase
      .from("ai_job_idempotency")
      .update({ status: "done", result: result as never, error: null })
      .eq("user_id", userId)
      .eq("surface", surface)
      .eq("request_hash", request_hash);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("ai_job_idempotency")
      .update({ status: "error", error: message.slice(0, 500) })
      .eq("user_id", userId)
      .eq("surface", surface)
      .eq("request_hash", request_hash);
    throw err;
  }
}
