/**
 * Admin health check for the Lovable Hosted AI connection.
 *
 * Answers the question "can this deploy actually call Lovable AI right now?"
 * with a reason an operator can act on, instead of a bare ok/false.
 *
 * Three ordered checks, each returning a status + reason:
 *   1. credentials — is there a usable key/base URL/model at all
 *      (server LOVABLE_API_KEY, or a key pasted into the Lovable engine card)
 *   2. endpoint    — GET {baseUrl}/models reaches the gateway and the key is accepted
 *   3. completion  — a tiny chat completion actually returns tokens for the model
 *
 * Never returns key material: only presence booleans and a short fingerprint.
 */
import { getAiEngineDef, LOVABLE_DEFAULT_MODEL } from "./ai-engines";
import { describeError, truncateForLog } from "./error-message";

export type HealthStatus = "pass" | "fail" | "skip";

export type LovableHealthCheck = {
  name: "credentials" | "endpoint" | "completion";
  status: HealthStatus;
  durationMs: number;
  /** Human-readable outcome — safe to show in the UI verbatim. */
  reason: string;
  /** What to change to fix it, when we can tell. */
  hint?: string;
  httpStatus?: number;
  /** Whether retrying the same request could succeed (429 / 5xx only). */
  retryable?: boolean;
};

export type LovableHealthReport = {
  ok: boolean;
  service: "bostead";
  target: "lovable_hosted";
  status: "healthy" | "degraded" | "unhealthy";
  checkedAt: string;
  durationMs: number;
  baseUrl: string | null;
  model: string | null;
  /** Where the key came from — never the key itself. */
  keySource: "pasted" | "environment" | "none";
  keyFingerprint: string | null;
  isCloudDefault: boolean;
  checks: LovableHealthCheck[];
};

const PROBE_TIMEOUT_MS = 10_000;

/** Last 4 chars only — enough to tell two keys apart, useless to an attacker. */
function fingerprint(key: string): string {
  return `…${key.slice(-4)} (${key.length} chars)`;
}

function gatewayHint(status: number, apiMessage: string | null): { hint: string; retryable: boolean } {
  if (status === 400)
    return {
      hint: `The gateway rejected the request itself — usually an unknown model id. Set the Lovable engine model to a supported id such as ${LOVABLE_DEFAULT_MODEL}.`,
      retryable: false,
    };
  if (status === 401)
    return {
      hint: "The Lovable AI key is missing or invalid. On a self-hosted deploy set LOVABLE_API_KEY in the server .env, or paste a key into Admin → AI engines → Lovable.",
      retryable: false,
    };
  if (status === 402)
    return {
      hint: apiMessage
        ? `Out of AI credits: ${apiMessage}`
        : "The workspace has no AI credits left. Add credits in Lovable, then re-run this check.",
      retryable: false,
    };
  if (status === 403)
    return {
      hint: "Blocked by workspace policy: Lovable AI is disabled, an admin credit limit was reached, or the key is no longer registered. Rotating the key fixes only the last case.",
      retryable: false,
    };
  if (status === 404)
    return {
      hint: "The base URL is reachable but has no gateway API there. It must end in /v1, e.g. https://ai.gateway.lovable.dev/v1.",
      retryable: false,
    };
  if (status === 429)
    return { hint: "Rate limited — the key works. Wait a few seconds and re-run.", retryable: true };
  if (status >= 500)
    return { hint: "Transient gateway/upstream error. Re-run in a moment.", retryable: true };
  return {
    hint: apiMessage ?? "The gateway rejected the request; see the reason above.",
    retryable: false,
  };
}

function apiMessageOf(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    const m =
      (typeof parsed.error === "string" ? parsed.error : parsed.error?.message) ?? parsed.message;
    return m ? String(m).slice(0, 300) : null;
  } catch {
    return truncateForLog(body.replace(/\s+/g, " "), 200) || null;
  }
}

async function probe(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return { res, body: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkLovableHosted(): Promise<LovableHealthReport> {
  const startedAll = Date.now();
  const { loadEnginesConfig, resolveEngine } = await import("./ai-engines.server");
  const def = getAiEngineDef("lovable");
  const config = await loadEnginesConfig();
  const pasted = config.engines.lovable.apiKey;
  const envKey = process.env.LOVABLE_API_KEY ?? null;
  const keySource = pasted ? "pasted" : envKey ? "environment" : "none";
  const checks: LovableHealthCheck[] = [];

  // 1 — credentials
  const credStarted = Date.now();
  const engine = await resolveEngine("lovable", config);
  if (!engine) {
    const missing = [
      !(config.engines.lovable.baseUrl ?? def.defaultBaseUrl) ? "base URL" : null,
      keySource === "none" ? "API key" : null,
      !(config.engines.lovable.model ?? def.defaultModel) ? "model" : null,
    ].filter(Boolean);
    checks.push({
      name: "credentials",
      status: "fail",
      durationMs: Date.now() - credStarted,
      reason: `Lovable Hosted is missing ${missing.join(", ") || "required settings"}.`,
      hint: "Set LOVABLE_API_KEY on the server, or paste a key into Admin → AI engines → Lovable, then re-run.",
    });
    checks.push(
      { name: "endpoint", status: "skip", durationMs: 0, reason: "No credentials to test with." },
      { name: "completion", status: "skip", durationMs: 0, reason: "No credentials to test with." },
    );
    return {
      ok: false,
      service: "bostead",
      target: "lovable_hosted",
      status: "unhealthy",
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAll,
      baseUrl: config.engines.lovable.baseUrl ?? def.defaultBaseUrl ?? null,
      model: config.engines.lovable.model ?? def.defaultModel ?? null,
      keySource,
      keyFingerprint: null,
      isCloudDefault: config.cloudDefault === "lovable",
      checks,
    };
  }

  checks.push({
    name: "credentials",
    status: "pass",
    durationMs: Date.now() - credStarted,
    reason: `Using the ${keySource === "pasted" ? "key pasted in Admin → AI engines" : "server LOVABLE_API_KEY"} with model "${engine.model}".`,
  });

  const headers = {
    "Lovable-API-Key": engine.apiKey,
    "X-Lovable-AIG-SDK": "fetch",
    "content-type": "application/json",
  };
  const base = engine.baseUrl.replace(/\/+$/, "");

  // 2 — endpoint reachability + key acceptance
  const epStarted = Date.now();
  let endpointOk = false;
  try {
    const { res, body } = await probe(`${base}/models`, { method: "GET", headers });
    if (res.ok) {
      endpointOk = true;
      let modelListed: boolean | null = null;
      try {
        const ids = ((JSON.parse(body) as { data?: { id?: string }[] }).data ?? [])
          .map((m) => m.id)
          .filter((v): v is string => typeof v === "string");
        if (ids.length) modelListed = ids.includes(engine.model);
      } catch {
        /* non-standard body — reachability is enough */
      }
      checks.push({
        name: "endpoint",
        status: "pass",
        durationMs: Date.now() - epStarted,
        httpStatus: res.status,
        reason:
          modelListed === false
            ? `Gateway reachable and key accepted, but it does not list "${engine.model}".`
            : "Gateway reachable and the key was accepted.",
        ...(modelListed === false
          ? { hint: `Change the Lovable engine model to a supported id such as ${LOVABLE_DEFAULT_MODEL}.` }
          : {}),
      });
    } else {
      const msg = apiMessageOf(body);
      const { hint, retryable } = gatewayHint(res.status, msg);
      checks.push({
        name: "endpoint",
        status: "fail",
        durationMs: Date.now() - epStarted,
        httpStatus: res.status,
        retryable,
        reason: `Gateway returned HTTP ${res.status}${msg ? `: ${msg}` : ""}.`,
        hint,
      });
    }
  } catch (err) {
    checks.push({
      name: "endpoint",
      status: "fail",
      durationMs: Date.now() - epStarted,
      reason: `Could not reach ${base}: ${truncateForLog(describeError(err), 160)}`,
      hint: "Check outbound network access from this server and that the base URL ends in /v1.",
      retryable: true,
    });
  }

  // 3 — real completion (only worth trying once the endpoint answered)
  const cpStarted = Date.now();
  if (!endpointOk) {
    checks.push({
      name: "completion",
      status: "skip",
      durationMs: 0,
      reason: "Skipped because the gateway endpoint check failed.",
    });
  } else {
    try {
      const { res, body } = await probe(`${base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: engine.model,
          messages: [
            { role: "user", content: "Reply with the single word: ok. Answer in under 5 tokens." },
          ],
        }),
      });
      if (res.ok) {
        let text = "";
        try {
          text =
            (JSON.parse(body) as { choices?: { message?: { content?: string } }[] }).choices?.[0]
              ?.message?.content ?? "";
        } catch {
          /* ignore */
        }
        checks.push({
          name: "completion",
          status: text.trim() ? "pass" : "fail",
          durationMs: Date.now() - cpStarted,
          httpStatus: res.status,
          reason: text.trim()
            ? `Model "${engine.model}" replied (${truncateForLog(text.trim(), 40)}).`
            : `Model "${engine.model}" returned HTTP 200 but no content.`,
          ...(text.trim()
            ? {}
            : { hint: "The model accepted the call but produced nothing — try a different model id." }),
        });
      } else {
        const msg = apiMessageOf(body);
        const { hint, retryable } = gatewayHint(res.status, msg);
        checks.push({
          name: "completion",
          status: "fail",
          durationMs: Date.now() - cpStarted,
          httpStatus: res.status,
          retryable,
          reason: `Completion failed with HTTP ${res.status}${msg ? `: ${msg}` : ""}.`,
          hint,
        });
      }
    } catch (err) {
      checks.push({
        name: "completion",
        status: "fail",
        durationMs: Date.now() - cpStarted,
        reason: `Completion request failed: ${truncateForLog(describeError(err), 160)}`,
        hint: "The gateway answered /models but not /chat/completions — retry, then check credits and model id.",
        retryable: true,
      });
    }
  }

  const failed = checks.filter((c) => c.status === "fail");
  const ok = failed.length === 0;
  // "degraded" = the connection works but the completion path is only rate
  // limited / transiently failing, which is worth alerting on differently.
  const degraded = !ok && endpointOk && failed.every((c) => c.retryable);

  return {
    ok,
    service: "bostead",
    target: "lovable_hosted",
    status: ok ? "healthy" : degraded ? "degraded" : "unhealthy",
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAll,
    baseUrl: engine.baseUrl,
    model: engine.model,
    keySource,
    keyFingerprint: fingerprint(engine.apiKey),
    isCloudDefault: config.cloudDefault === "lovable",
    checks,
  };
}
