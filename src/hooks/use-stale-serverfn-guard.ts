/**
 * Detects stale-build server-fn calls. When Vite rebuilds, the content-hashed
 * server-function IDs change; a tab holding an older bundle will POST to a
 * /_serverFn/<old-id> the server no longer knows about, and the response body
 * contains "Invalid server function ID". Instead of letting that bubble up as
 * an opaque 500, we show a sticky toast that offers a hard reload.
 *
 * Every detection + the outcome of the one-shot auto-reload is logged to the
 * browser console and persisted in a small sessionStorage ring buffer so we
 * can correlate user reports with specific releases. The same event is also
 * forwarded to Lovable error reporting (severity: warning) for aggregation.
 */
import { useEffect } from "react";
import { toast } from "sonner";
import { reportLovableError } from "../lib/lovable-error-reporting";

const RETRY_FLAG = "lovable:stale-srvfn-auto-reloaded";
const LOG_KEY = "lovable:stale-srvfn-log";
const PENDING_OUTCOME_KEY = "lovable:stale-srvfn-pending-outcome";
const LOG_MAX = 25;

type StaleEvent = {
  ts: number;
  url: string;
  route: string;
  serverFnId: string;
  serverFnIdShort: string;
  status: number;
  bodySnippet: string;
  action: "auto-reload" | "manual-prompt" | "auto-reload-succeeded" | "auto-reload-failed";
  userAgent?: string;
};

let installed = false;
let prompted = false;
let reloading = false;

function safeSession<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

function readLog(): StaleEvent[] {
  return safeSession(() => {
    const raw = sessionStorage.getItem(LOG_KEY);
    return raw ? (JSON.parse(raw) as StaleEvent[]) : [];
  }, []);
}

function appendLog(event: StaleEvent) {
  safeSession(() => {
    const log = readLog();
    log.push(event);
    while (log.length > LOG_MAX) log.shift();
    sessionStorage.setItem(LOG_KEY, JSON.stringify(log));
  }, undefined);
}

function logEvent(event: StaleEvent) {
  appendLog(event);
  // eslint-disable-next-line no-console
  console.warn("[stale-serverfn]", event);
  reportLovableError(new Error(`Stale server function ID (${event.action})`), {
    source: "stale_serverfn_guard",
    ...event,
  });
}

/** Inspect the URL we just POSTed to — the hashed serverFn ID is the basename. */
function extractServerFnId(url: string): string {
  const m = url.match(/\/_serverFn\/([^/?#]+)/);
  return m?.[1] ?? "";
}

function autoReloadOnce(context: Omit<StaleEvent, "ts" | "action">): boolean {
  if (reloading) return true;
  const alreadyTried = safeSession(() => sessionStorage.getItem(RETRY_FLAG), null);
  if (alreadyTried) {
    logEvent({ ...context, ts: Date.now(), action: "auto-reload-failed" });
    return false;
  }
  const ok = safeSession(() => {
    sessionStorage.setItem(RETRY_FLAG, String(Date.now()));
    // Record what we're about to attempt so the post-reload tick can resolve
    // its outcome (success once a serverFn returns 2xx, failure if we hit
    // another stale-ID response right away).
    sessionStorage.setItem(PENDING_OUTCOME_KEY, JSON.stringify({ ...context, ts: Date.now() }));
    return true;
  }, false);
  if (!ok) return false;
  reloading = true;
  logEvent({ ...context, ts: Date.now(), action: "auto-reload" });
  toast.message("Updating to the latest version…", { duration: 2000 });
  setTimeout(() => window.location.reload(), 250);
  return true;
}

function promptReload(context: Omit<StaleEvent, "ts" | "action">) {
  if (prompted) return;
  prompted = true;
  logEvent({ ...context, ts: Date.now(), action: "manual-prompt" });
  toast.error("App was updated — please refresh", {
    description: "Your tab is running an older build. Reload to pick up the latest version.",
    duration: Infinity,
    action: {
      label: "Reload",
      onClick: () => window.location.reload(),
    },
  });
}

function looksLikeStaleServerFn(url: string, status: number, body: string) {
  if (!url.includes("/_serverFn/")) return false;
  if (status !== 500 && status !== 404) return false;
  return /Invalid server function ID/i.test(body);
}

function resolvePendingOutcome(success: boolean) {
  const pendingRaw = safeSession(() => sessionStorage.getItem(PENDING_OUTCOME_KEY), null);
  if (!pendingRaw) return;
  safeSession(() => sessionStorage.removeItem(PENDING_OUTCOME_KEY), undefined);
  try {
    const pending = JSON.parse(pendingRaw) as Omit<StaleEvent, "action">;
    logEvent({
      ...pending,
      ts: Date.now(),
      action: success ? "auto-reload-succeeded" : "auto-reload-failed",
    });
  } catch {
    // ignore malformed pending record
  }
}

/** Exposed for manual debugging from the devtools console. */
function exposeDebugHelper() {
  if (typeof window === "undefined") return;
  (window as unknown as { __staleServerFnLog?: () => StaleEvent[] }).__staleServerFnLog = readLog;
}

export function useStaleServerFnGuard() {
  useEffect(() => {
    if (installed || typeof window === "undefined") return;
    installed = true;
    exposeDebugHelper();

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const res = await originalFetch(input, init);
      try {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("/_serverFn/")) {
          if (res.ok) {
            // The new bundle is in sync. If the previous tab attempted an
            // auto-reload, this is proof it succeeded — log it once.
            resolvePendingOutcome(true);
            safeSession(() => sessionStorage.removeItem(RETRY_FLAG), undefined);
          } else if (res.status === 500 || res.status === 404) {
            const text = await res.clone().text();
            if (looksLikeStaleServerFn(url, res.status, text)) {
              const context = {
                url,
                status: res.status,
                bodySnippet: text.slice(0, 200),
                buildHint: extractBuildHint(url),
                userAgent: navigator.userAgent,
              };
              // If a previous reload attempt is still pending, it didn't help.
              resolvePendingOutcome(false);
              if (!autoReloadOnce(context)) promptReload(context);
            }
          }
        }
      } catch {
        // best-effort detection — never break the original response
      }
      return res;
    };

    return () => {
      // Keep the patch installed for the lifetime of the tab; nothing to clean up.
    };
  }, []);
}
