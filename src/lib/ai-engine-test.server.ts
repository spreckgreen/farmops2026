// Connection test for one AI engine slot: verifies the base URL is reachable,
// the key is accepted, and the configured model exists — then turns whatever
// went wrong into a sentence an operator can act on.
import {
  getAiEngineDef,
  type AiEngineId,
  type AiEnginesConfig,
  type AiEngineTarget,
} from "./ai-engines";
import { resolveEngine } from "./ai-engines.server";
import { rankModelTiers, recommendedModel, type ModelTiers } from "./model-tiers";

export interface EngineTestResult {
  ok: boolean;
  /** Short headline, e.g. "Connected" or "API key rejected". */
  title: string;
  /** One or two sentences aimed at whoever configured the engine. */
  message: string;
  /** What to change to fix it, when we can tell. */
  hint: string | null;
  baseUrl: string | null;
  model: string | null;
  /** Model ids the endpoint advertises (capped), when it lists any. */
  modelsSeen: string[];
  modelFound: boolean | null;
  /**
   * Good / Better / Best picks for Bostead's cloud AI features, derived from
   * the model list the endpoint advertises. Null when it lists nothing.
   */
  tiers?: ModelTiers | null;
  /** The tier Bostead pre-selects (Better). Null when no models were listed. */
  recommendedModel?: string | null;
  latencyMs: number | null;
  httpStatus: number | null;
}

/** Requests are bounded here (unlike generation calls) — this is a reachability probe. */
const PROBE_TIMEOUT_MS = 12_000;
const MAX_MODELS_SHOWN = 8;

function authHeaders(_auth: "bearer", apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}` };
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/** Pull the most useful sentence out of an OpenAI-style error body. */
function extractApiMessage(body: string): string | null {
  const text = body.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string } | string;
      message?: string;
      detail?: string;
    };
    const candidate =
      (typeof parsed.error === "string" ? parsed.error : parsed.error?.message) ??
      parsed.message ??
      parsed.detail;
    if (candidate) return String(candidate).slice(0, 400);
  } catch {
    // Not JSON — fall through to the raw text.
  }
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300) || null;
}

/** Network-level failures never reach an HTTP status; name the likely cause. */
function describeNetworkError(err: unknown, baseUrl: string, label: string): EngineTestResult {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  let title = "Could not reach the endpoint";
  let hint = `Check that ${baseUrl} is correct and reachable from the Bostead server.`;

  if (lower.includes("aborted") || lower.includes("timeout") || lower.includes("timed out")) {
    title = "Connection timed out";
    hint = `${baseUrl} accepted no response within ${PROBE_TIMEOUT_MS / 1000}s. If this is a local engine, confirm the container is running and on the same Docker network.`;
  } else if (
    lower.includes("enotfound") ||
    lower.includes("getaddrinfo") ||
    lower.includes("dns")
  ) {
    title = "Hostname could not be resolved";
    hint = `Nothing answers to the host in ${baseUrl}. In Docker use the service name (e.g. http://ollama:11434/v1), not localhost.`;
  } else if (lower.includes("econnrefused") || lower.includes("connection refused")) {
    title = "Connection refused";
    hint = `Something is listening on that host but not on that port. Verify the port in ${baseUrl}.`;
  } else if (lower.includes("certificate") || lower.includes("ssl") || lower.includes("tls")) {
    title = "TLS handshake failed";
    hint = "The endpoint's certificate was rejected. Use a valid https URL or a plain http URL for a local engine.";
  } else if (lower.includes("invalid url") || lower.includes("failed to parse url")) {
    title = "Base URL is not a valid URL";
    hint = "Include the scheme and the /v1 suffix, e.g. https://api.openai.com/v1.";
  }

  return {
    ok: false,
    title,
    message: `${label}: ${raw}`,
    hint,
    baseUrl,
    model: null,
    modelsSeen: [],
    modelFound: null,
    latencyMs: null,
    httpStatus: null,
  };
}

function describeHttpStatus(
  status: number,
  apiMessage: string | null,
  label: string,
): { title: string; hint: string } {
  if (status === 401 || status === 403) {
    return {
      title: status === 401 ? "API key rejected" : "Access denied",
      hint: `${label} rejected the credentials. Self-hosted Ollama needs no real key (any placeholder works). Ollama Cloud keys come from ollama.com → Settings → Keys and are not OpenAI "sk-" keys. Other providers want their own key.`,
    };
  }

  if (status === 402) {
    return {
      title: "Out of credits",
      hint: "The provider accepted the key but will not serve requests until credits are added.",
    };
  }
  if (status === 404) {
    return {
      title: "Endpoint not found",
      hint: "The base URL is reachable but has no OpenAI-compatible API there. It usually needs to end in /v1.",
    };
  }
  if (status === 429) {
    return {
      title: "Rate limited",
      hint: "The key works, but the provider is throttling right now. Try again in a moment.",
    };
  }
  if (status >= 500) {
    return {
      title: "Provider error",
      hint: "The endpoint answered with a server error. It may be starting up or overloaded — retry shortly.",
    };
  }
  return {
    title: `Request rejected (HTTP ${status})`,
    hint: apiMessage ? "The provider's message above explains what it rejected." : "Check the base URL, key and model.",
  };
}

async function probe(url: string, headers: HeadersInit, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, headers, signal: controller.signal });
    const body = await res.text();
    return { res, body };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Test one engine. `override` lets the admin page test unsaved form values;
 * a null `apiKey` there means "use the stored/env key".
 *
 * `client` MUST be the caller's authenticated Supabase client when available:
 * the stored engine config lives in the vault, and reading it with the service
 * role can fail on hosted deployments — which used to surface as "Ollama Cloud
 * is missing API key" even though a key was stored.
 */
export async function testAiEngine(
  id: AiEngineId,
  override?: Partial<AiEngineTarget>,
  config?: AiEnginesConfig,
  client?: SupabaseClient<Database>,
): Promise<EngineTestResult> {
  const def = getAiEngineDef(id);
  const { loadEnginesConfig } = await import("./ai-engines.server");
  const base = config ?? (await loadEnginesConfig(client));


  // Apply the draft values on a copy so nothing is persisted by a test.
  const merged: AiEnginesConfig = {
    ...base,
    engines: {
      ...base.engines,
      [id]: {
        baseUrl: override?.baseUrl ?? base.engines[id].baseUrl,
        apiKey: override?.apiKey ?? base.engines[id].apiKey,
        model: override?.model ?? base.engines[id].model,
        enabled: base.engines[id].enabled,
      },
    },
  };

  // A switched-off engine is still testable — that is the point of the switch.
  const engine = await resolveEngine(id, merged, { ignoreDisabled: true });
  if (!engine) {
    const missing = [
      !(merged.engines[id].baseUrl ?? def.defaultBaseUrl) ? "base URL" : null,
      def.placement === "cloud" && !merged.engines[id].apiKey ? "API key" : null,
      !(merged.engines[id].model ?? def.defaultModel) ? "model" : null,
    ].filter(Boolean);
    return {
      ok: false,
      title: "Not configured yet",
      message: `${def.label} is missing ${missing.join(", ") || "required settings"}, so there is nothing to test.`,
      hint: "Fill in the fields above and press Test connection again.",
      baseUrl: merged.engines[id].baseUrl ?? def.defaultBaseUrl,
      model: merged.engines[id].model ?? def.defaultModel,
      modelsSeen: [],
      modelFound: null,
      latencyMs: null,
      httpStatus: null,
    };
  }

  const keySource = override?.apiKey
    ? "the key typed in the form"
    : base.engines[id].apiKey
      ? "the key stored for this engine"
      : id === "local"
        ? "a placeholder token (self-hosted Ollama needs no key)"
        : "no key";
  const keyNote = `Sent Authorization: Bearer … using ${keySource} (…${engine.apiKey.slice(-4)}).`;

  const headers = authHeaders(def.auth, engine.apiKey);
  const started = Date.now();

  // Step 1 — GET /models: cheapest call that exercises both URL and key.
  let listStatus: number | null = null;
  let listMessage: string | null = null;
  let modelsSeen: string[] = [];
  let modelFound: boolean | null = null;
  let tiers: ModelTiers | null = null;
  try {
    const { res, body } = await probe(joinUrl(engine.baseUrl, "models"), headers);
    listStatus = res.status;
    if (res.ok) {
      try {
        const parsed = JSON.parse(body) as { data?: { id?: string }[] };
        const ids = (parsed.data ?? [])
          .map((m) => m.id)
          .filter((v): v is string => typeof v === "string");
        modelsSeen = ids;
        if (ids.length > 0) {
          modelFound = ids.includes(engine.model);
          // Rank the FULL list (modelsSeen is truncated for display).
          tiers = rankModelTiers(ids);
        }
      } catch {
        // Endpoint answered 200 with a non-standard body; treat as reachable.
      }
      if (modelFound === false) {
        return {
          ok: false,
          title: "Model not available",
          message: `${def.label} is reachable and the key works, but it does not serve "${engine.model}".`,
          hint:
            id === "local"
              ? `Pull it first: docker compose exec ollama ollama pull ${engine.model} — or pick one of the models it already has.`
              : "Change the model field to one the provider lists below.",
          baseUrl: engine.baseUrl,
          model: engine.model,
          modelsSeen: modelsSeen.slice(0, MAX_MODELS_SHOWN),
          modelFound,
          latencyMs: Date.now() - started,
          httpStatus: listStatus,
          tiers,
          recommendedModel: tiers ? recommendedModel(tiers) : null,
        };
      }
      return {
        ok: true,
        title: "Connected",
        message: `${def.label} answered at ${engine.baseUrl}${
          modelFound ? ` and serves "${engine.model}"` : ""
        }.`,
        hint:
          modelFound === null && modelsSeen.length === 0
            ? "The endpoint did not list its models, so the model name could not be verified."
            : null,
        baseUrl: engine.baseUrl,
        model: engine.model,
        modelsSeen: modelsSeen.slice(0, MAX_MODELS_SHOWN),
        modelFound,
        latencyMs: Date.now() - started,
        httpStatus: listStatus,
        tiers,
        recommendedModel: tiers ? recommendedModel(tiers) : null,
      };
    }
    listMessage = extractApiMessage(body);
    // 404/405 on /models is normal for some gateways — fall
    // through to a 1-token completion instead of reporting a failure.
    if (res.status !== 404 && res.status !== 405) {
      const { title, hint: baseHint } = describeHttpStatus(res.status, listMessage, def.label);
      const hint =
        res.status === 401 || res.status === 403 ? `${baseHint} ${keyNote}` : baseHint;
      return {
        ok: false,
        title,
        message: listMessage
          ? `${def.label} replied HTTP ${res.status}: ${listMessage}`
          : `${def.label} replied HTTP ${res.status} when listing models.`,
        hint,
        baseUrl: engine.baseUrl,
        model: engine.model,
        modelsSeen: [],
        modelFound: null,
        latencyMs: Date.now() - started,
        httpStatus: res.status,
      };
    }
  } catch (err) {
    return describeNetworkError(err, engine.baseUrl, def.label);
  }

  // Step 2 — minimal chat completion against the configured model.
  try {
    const { res, body } = await probe(
      joinUrl(engine.baseUrl, "chat/completions"),
      { ...headers, "Content-Type": "application/json" },
      {
        method: "POST",
        body: JSON.stringify({
          model: engine.model,
          messages: [{ role: "user", content: "ping" }],
          max_completion_tokens: 1,
        }),
      },
    );
    const apiMessage = extractApiMessage(body);
    if (res.ok) {
      return {
        ok: true,
        title: "Connected",
        message: `${def.label} accepted a test completion with "${engine.model}".`,
        hint: null,
        baseUrl: engine.baseUrl,
        model: engine.model,
        modelsSeen: [],
        modelFound: true,
        latencyMs: Date.now() - started,
        httpStatus: res.status,
      };
    }
    const lower = (apiMessage ?? "").toLowerCase();
    if (
      res.status === 400 &&
      (lower.includes("model") || lower.includes("not found") || lower.includes("unsupported"))
    ) {
      return {
        ok: false,
        title: "Model rejected",
        message: `${def.label} is reachable and the key works, but it rejected "${engine.model}": ${apiMessage}`,
        hint: "Use a model id this provider supports — cloud ids are usually namespaced, e.g. openai/gpt-5.6-sol.",
        baseUrl: engine.baseUrl,
        model: engine.model,
        modelsSeen: [],
        modelFound: false,
        latencyMs: Date.now() - started,
        httpStatus: res.status,
      };
    }
    const { title, hint: baseHint } = describeHttpStatus(res.status, apiMessage, def.label);
    const hint =
      res.status === 401 || res.status === 403 ? `${baseHint} ${keyNote}` : baseHint;
    return {
      ok: false,
      title,
      message: apiMessage
        ? `${def.label} replied HTTP ${res.status}: ${apiMessage}`
        : `${def.label} replied HTTP ${res.status} to a test completion.`,
      hint,
      baseUrl: engine.baseUrl,
      model: engine.model,
      modelsSeen: [],
      modelFound: null,
      latencyMs: Date.now() - started,
      httpStatus: res.status,
    };
  } catch (err) {
    return describeNetworkError(err, engine.baseUrl, def.label);
  }
}
