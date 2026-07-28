// Client-side detection of the server's AiJobInFlightError (see
// src/lib/ai-idempotency.server.ts). The server throws with code
// "AI_JOB_IN_FLIGHT" and a message containing "already running for this
// request". createServerFn strips custom classes across the wire, so match
// on either the `code` property (when preserved) or the message text.

import { toast } from "sonner";

export function isAiJobInFlightError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const anyE = e as { code?: unknown; message?: unknown; name?: unknown };
  if (anyE.code === "AI_JOB_IN_FLIGHT") return true;
  const msg = typeof anyE.message === "string" ? anyE.message : "";
  return /already running for this request/i.test(msg);
}

/**
 * If `e` is an AiJobInFlightError, show a friendly toast and return true.
 * Callers should skip their generic error toast AND skip stopping the
 * `useAiJobProgress` job — that keeps the existing progress bar visible
 * so the user can watch the original in-flight run finish.
 */
export function handleAiJobInFlight(e: unknown): boolean {
  if (!isAiJobInFlightError(e)) return false;
  toast.info("Already working on this — reusing the in-flight job", {
    description: "Your previous request is still processing. Watch the progress above.",
  });
  return true;
}
