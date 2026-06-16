/**
 * Detects stale-build server-fn calls. When Vite rebuilds, the content-hashed
 * server-function IDs change; a tab holding an older bundle will POST to a
 * /_serverFn/<old-id> the server no longer knows about, and the response body
 * contains "Invalid server function ID". Instead of letting that bubble up as
 * an opaque 500, we show a sticky toast that offers a hard reload.
 */
import { useEffect } from "react";
import { toast } from "sonner";

const RETRY_FLAG = "lovable:stale-srvfn-auto-reloaded";

let installed = false;
let prompted = false;
let reloading = false;

function autoReloadOnce(): boolean {
  if (reloading) return true;
  try {
    if (sessionStorage.getItem(RETRY_FLAG)) return false; // already tried once
    sessionStorage.setItem(RETRY_FLAG, String(Date.now()));
  } catch {
    return false; // sessionStorage blocked → fall back to manual prompt
  }
  reloading = true;
  toast.message("Updating to the latest version…", { duration: 2000 });
  // small delay so the toast actually paints before the navigation
  setTimeout(() => window.location.reload(), 250);
  return true;
}

function promptReload() {
  if (prompted) return;
  prompted = true;
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

export function useStaleServerFnGuard() {
  useEffect(() => {
    if (installed || typeof window === "undefined") return;
    installed = true;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const res = await originalFetch(input, init);
      try {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("/_serverFn/")) {
          // Any successful server-fn response means the bundle is in sync —
          // clear the retry flag so a future stale build still gets one auto-reload.
          if (res.ok) {
            try { sessionStorage.removeItem(RETRY_FLAG); } catch { /* ignore */ }
          } else if (res.status === 500 || res.status === 404) {
            const text = await res.clone().text();
            if (looksLikeStaleServerFn(url, res.status, text)) {
              if (!autoReloadOnce()) promptReload();
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
