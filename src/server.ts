import "./lib/env-startup-check.server";
import "./lib/error-capture";

import { installLogBuffer } from "./lib/diag-log-buffer.server";

// Keep the last ~500 console lines in memory so /settings/troubleshooting can
// tail app logs in the browser without shell access. Must run before the banner.
installLogBuffer();

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

// ---------------------------------------------------------------------------
// Startup banner — printed exactly once at module load, before Nitro starts
// listening. Surfaces the resolved bind address, runtime env, and launch
// command so "container is active but nothing renders" issues are debuggable
// from `docker compose logs` alone.
// ---------------------------------------------------------------------------
(() => {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  const argv = (globalThis as { process?: { argv?: string[] } }).process?.argv ?? [];
  const execPath = (globalThis as { process?: { execPath?: string } }).process?.execPath;
  const pid = (globalThis as { process?: { pid?: number } }).process?.pid;
  const host = env.HOST ?? env.NITRO_HOST ?? "(default 0.0.0.0)";
  const port = env.PORT ?? env.NITRO_PORT ?? "(default 3000)";
  const cmd = [execPath, ...argv.slice(1)].filter(Boolean).join(" ");

  // eslint-disable-next-line no-console
  console.log(
    [
      "=== [server] Startup banner ===",
      `  pid:           ${pid ?? "<unknown>"}`,
      `  HOST:          ${host}`,
      `  PORT:          ${port}`,
      `  NODE_ENV:      ${env.NODE_ENV ?? "<unset>"}`,
      `  BUN_ENV:       ${env.BUN_ENV ?? "<unset>"}`,
      `  NITRO_PRESET:  ${env.NITRO_PRESET ?? "<unset>"}`,
      `  argv:          ${argv.join(" ") || "<unknown>"}`,
      `  launch cmd:    ${cmd || "<unknown>"}`,
      `  cwd:           ${(globalThis as { process?: { cwd?: () => string } }).process?.cwd?.() ?? "<unknown>"}`,
      "=== [server] Initializing handler — about to start listening ===",
    ].join("\n"),
  );
})();



type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// A client that navigates away / cancels mid-render aborts the request signal.
// srvx then rejects the in-flight SSR with AbortError, which h3 turns into a
// generic 500. That is not an app fault and must not surface as a runtime error
// or a rendered error page (the browser is already gone).
function isClientAbort(request: Request, error?: unknown): boolean {
  if (request.signal?.aborted) return true;
  const name = (error as { name?: string; cause?: { name?: string } } | undefined)?.name;
  const causeName = (error as { cause?: { name?: string } } | undefined)?.cause?.name;
  return name === "AbortError" || causeName === "AbortError";
}

const abortedResponse = () => new Response(null, { status: 499, statusText: "Client Closed Request" });

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(request: Request, response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  const captured = consumeLastCapturedError();
  if (isClientAbort(request, captured)) return abortedResponse();

  console.error(captured ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(request, response);
    } catch (error) {
      if (isClientAbort(request, error)) return abortedResponse();
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};

