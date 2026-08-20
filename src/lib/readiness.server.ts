/**
 * Readiness probe logic for GET /ready.
 *
 * Unlike /health (which only proves the HTTP server booted), readiness checks
 * that the things a first page load actually needs are reachable:
 *
 *   - env:      required server env vars are present (names only, never values)
 *   - database: the backend REST/auth endpoint answers over the network
 *
 * Rules:
 *   - never return secret values, only presence booleans and names
 *   - never throw: every failure becomes a degraded check with a short reason
 *   - keep it fast: a 4s network budget so orchestrators don't hang on it
 */

import { describeError, truncateForLog } from "./error-message";

export type CheckStatus = "pass" | "fail" | "skip";

export type ReadinessCheck = {
  name: string;
  status: CheckStatus;
  durationMs: number;
  detail?: string;
};

export type ReadinessReport = {
  ok: boolean;
  service: "bostead";
  status: "ready" | "not_ready";
  checkedAt: string;
  durationMs: number;
  checks: ReadinessCheck[];
};

const NETWORK_BUDGET_MS = 4000;

/** Env vars the app cannot serve a signed-in page without. */
const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"] as const;
/** Present in most deploys; missing only disables a feature, so it is informational. */
const OPTIONAL_ENV = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "VAULT_ENCRYPTION_KEY",
  "TEMPEST_API_TOKEN",
] as const;

function envCheck(): ReadinessCheck {
  const started = Date.now();
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  const missingOptional = OPTIONAL_ENV.filter((k) => !process.env[k]);

  const notes: string[] = [];
  if (missing.length) notes.push(`missing required: ${missing.join(", ")}`);
  if (missingOptional.length) notes.push(`unset optional: ${missingOptional.join(", ")}`);

  return {
    name: "env",
    status: missing.length ? "fail" : "pass",
    durationMs: Date.now() - started,
    ...(notes.length ? { detail: notes.join("; ") } : {}),
  };
}

async function databaseCheck(): Promise<ReadinessCheck> {
  const started = Date.now();
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];

  if (!url || !key) {
    return {
      name: "database",
      status: "skip",
      durationMs: Date.now() - started,
      detail: "SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not set",
    };
  }

  try {
    // /auth/v1/health is a cheap, unauthenticated liveness endpoint on the
    // backend stack; reaching it proves DNS + routing + the stack being up,
    // without reading any table or user data.
    const res = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/health`, {
      method: "GET",
      headers: { apikey: key, accept: "application/json" },
      signal: AbortSignal.timeout(NETWORK_BUDGET_MS),
    });

    return {
      name: "database",
      status: res.ok ? "pass" : "fail",
      durationMs: Date.now() - started,
      detail: `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      name: "database",
      status: "fail",
      durationMs: Date.now() - started,
      detail: truncateForLog(describeError(err), 160),
    };
  }
}

export async function runReadinessChecks(): Promise<ReadinessReport> {
  const started = Date.now();
  const checks = [envCheck(), await databaseCheck()];
  const ok = checks.every((c) => c.status !== "fail");

  return {
    ok,
    service: "bostead",
    status: ok ? "ready" : "not_ready",
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    checks,
  };
}
