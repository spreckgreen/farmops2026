// Server-side resolution of per-feature AI routing.
//
// Each AI feature area (see ai-feature-areas.ts) chooses whether it runs on the
// LOCAL self-hosted endpoint or a configured cloud engine.
// Heavy jobs (weekly/monthly/quarterly/yearly rollups, manuals, consultant
// chat, KB ingest) default to hosted; light jobs stay local.
//
// Server-only: reads process.env + the shared vault. Never import from client
// code — call sites are server functions that dynamic-import this module.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  getAiArea,
  resolveRoutingConfig,
  routeForArea,
  serializeRoutingConfig,
  type AiAreaId,
  type AiBackend,
  type AiEscalation,
  type AiRoutingConfig,
} from "./ai-feature-areas";
import type { AiEngineId } from "./ai-engines";

export const ROUTING_ENV_KEY = "CUSTOM_AI_FEATURE_ROUTING";

type Provider = ReturnType<typeof createOpenAICompatible>;

export async function loadRoutingConfig(
  client?: SupabaseClient<Database>,
): Promise<AiRoutingConfig> {
  const { getServerEnv } = await import("./server-env.server");
  return resolveRoutingConfig(await getServerEnv(ROUTING_ENV_KEY, client));
}

export async function saveRoutingConfig(
  config: AiRoutingConfig,
  userId: string,
  client: SupabaseClient<Database>,
) {
  const { persistSharedRouting } = await import("./ai-routing-store.server");
  await persistSharedRouting(serializeRoutingConfig(config), userId, client);
  return config;
}

export interface AreaAi {
  area: AiAreaId;
  areaLabel: string;
  backend: AiBackend;
  /** Which configured engine actually ran this call. */
  engineId: AiEngineId;
  engineLabel: string;
  provider: Provider;
  modelId: string;
  /** Retry once on hosted AI when a local call fails or truncates. */
  autoFallback: boolean;
  /** A configured cloud engine is reachable. */
  hostedAvailable: boolean;
  /** Model that a hosted escalation would use. */
  hostedModelId: string;
  /** Prebuilt hosted provider, so escalation doesn't re-read config. */
  hostedProvider: Provider | null;
}

/**
 * Resolve provider + model for one feature area.
 *
 * `hostedDefaultModel` is the call site's existing hosted model id — kept per
 * call site so routing never silently changes which hosted model a feature has
 * always used.
 */
export async function resolveAreaAi(
  area: AiAreaId,
  opts: {
    hostedDefaultModel: string;
    client?: SupabaseClient<Database>;
    /** Skip the admin on/off switch (read-only routing previews). */
    skipEnabledCheck?: boolean;
  },
): Promise<AreaAi> {
  const def = getAiArea(area);
  if (!opts.skipEnabledCheck) {
    const { assertAreaEnabled } = await import("./ai-feature-toggles.server");
    await assertAreaEnabled(area, def.label, opts.client);
  }
  const config = await loadRoutingConfig(opts.client);
  const route = routeForArea(config, area);


  const { loadEnginesConfig, resolveEngine, buildEngineProvider } = await import(
    "./ai-engines.server"
  );
  const engines = await loadEnginesConfig(opts.client);

  // Which engine does this area's choice mean?
  const choice = route.backend;
  let engineId: AiEngineId;
  if (choice === "local") {
    engineId = "local";
  } else if (choice === "hosted") {
    engineId = engines.cloudDefault;
  } else if (choice === "default") {
    // Legacy behavior: an explicitly configured local endpoint wins, else cloud.
    const hasExplicitLocal = Boolean(
      engines.engines.local.baseUrl ||
        (process.env.CUSTOM_AI_BASE_URL && process.env.CUSTOM_AI_API_KEY),
    );
    engineId = hasExplicitLocal ? "local" : engines.cloudDefault;
  } else {
    engineId = choice;
  }

  let cloudDefaultId = engines.cloudDefault;
  let hosted = await resolveEngine(cloudDefaultId, engines, {
    defaultModel: opts.hostedDefaultModel,
  });
  // A missing cloud default must not take down another configured cloud engine.
  if (!hosted) {
    for (const candidate of ["ollama_cloud", "other_cloud"] as AiEngineId[]) {
      if (candidate === cloudDefaultId) continue;
      const alt = await resolveEngine(candidate, engines, {
        defaultModel: opts.hostedDefaultModel,
      });
      if (alt) {
        hosted = alt;
        cloudDefaultId = candidate;
        break;
      }
    }
  }
  const local = await resolveEngine("local", engines);

  // A per-area model override is only valid for the backend it belongs to.
  // Cloud ids are namespaced ("google/gemini-3.6-flash"); local Ollama tags are
  // not ("llama3.2:3b"). Sending an Ollama tag to a cloud gateway 400s, which
  // used to surface as "the model returned no schedule".
  const routeModel = route.model?.trim() || null;
  const routeModelIsHosted = Boolean(routeModel && routeModel.includes("/"));

  let selected = await resolveEngine(engineId, engines, {
    defaultModel: opts.hostedDefaultModel,
  });

  // "Cloud" (generic) may use any usable cloud engine, but never local.
  if (!selected && choice === "hosted" && hosted) selected = hosted;


  // The area explicitly asked for a CLOUD engine. Never silently downgrade that
  // to the local endpoint: a small local model then produces a broken result
  // and the failure looks like "the model returned no schedule" instead of
  // "your cloud engine isn't usable". Fail loudly with the actual reason.
  if (!selected && choice !== "default" && engineId !== "local") {
    const target = engines.engines[engineId];
    const { getAiEngineDef } = await import("./ai-engines");
    const engineDef = getAiEngineDef(engineId);
    const reason =
      target.enabled === false
        ? "it is switched off in Admin → AI Engines"
        : !(target.apiKey ?? "").trim()
          ? "no API key is saved for it"
          : !(target.model ?? engineDef.defaultModel)
            ? "no model name is saved for it"
            : "its base URL, key or model is incomplete";
    throw new Error(
      `${def.label} is routed to ${engineDef.label}, but ${reason}. Fix that engine (or change this feature's routing) — Bostead will not fall back to the self-hosted engine for a cloud-routed feature.`,
    );
  }

  // Legacy "default" routing may still fall back: cloud default, then local.
  if (!selected) selected = hosted ?? local;
  if (!selected) {
    throw new Error(
      `No usable AI engine for ${def.label}: "${engineId}" is not configured, and neither is the cloud default or the local engine.`,
    );
  }


  const isLocalEngine = selected.placement === "local";
  const backend: AiBackend = isLocalEngine ? "local" : "hosted";
  const modelOverride =
    routeModel && (isLocalEngine ? !routeModelIsHosted : true) ? routeModel : null;
  const modelId = modelOverride ?? selected.model;
  const hostedModelId = routeModelIsHosted
    ? routeModel ?? opts.hostedDefaultModel
    : (hosted?.model ?? opts.hostedDefaultModel);

  const hostedProvider = hosted ? buildEngineProvider(hosted) : null;

  return {
    area,
    areaLabel: def.label,
    backend,
    engineId: selected.id,
    engineLabel: selected.label,
    provider: buildEngineProvider(selected),
    modelId,
    autoFallback: config.autoFallback,
    hostedAvailable: Boolean(hosted) && cloudDefaultId !== selected.id,
    hostedModelId,
    hostedProvider,
  };
}

export interface AreaRunHandle {
  provider: Provider;
  modelId: string;
  backend: AiBackend;
}

/**
 * Run one AI call for an area, escalating a failed or truncated LOCAL call to
 * hosted AI once (when auto-fallback is on and hosted is available).
 *
 * `isTruncated` lets a call site escalate on a soft failure — a truncated
 * answer, or a summary that came back empty — not just a thrown error.
 */
export interface AreaMeterOpts<T> {
  /** Supabase client the usage row is written with (RLS: own rows only). */
  client?: unknown;
  userId?: string | null;
  /** Actual token counts, when the call site can read them from the SDK. */
  tokens?: (value: T) => { input: number; output: number } | null | undefined;
  note?: string | null;
}

export async function runAreaAi<T>(
  ai: AreaAi,
  run: (handle: AreaRunHandle) => Promise<T>,
  opts?: { isTruncated?: (value: T) => boolean; meter?: AreaMeterOpts<T> },
): Promise<{
  value: T;
  escalation: AiEscalation | null;
  backend: AiBackend;
  modelId: string;
  /** What this run was priced at, when the call site asked for metering. */
  usage: import("./ai-metering.server").RecordedUsage | null;
}> {
  const canEscalate = ai.backend === "local" && ai.autoFallback && ai.hostedAvailable;
  const startedAt = Date.now();
  const handle: AreaRunHandle = {
    provider: ai.provider,
    modelId: ai.modelId,
    backend: ai.backend,
  };

  const meter = async (
    value: T,
    backend: AiBackend,
    modelId: string,
    note?: string | null,
  ): Promise<import("./ai-metering.server").RecordedUsage | null> => {
    const m = opts?.meter;
    if (!m) return null;
    try {
      const { recordAiUsage } = await import("./ai-metering.server");
      const usage = m.tokens?.(value) ?? null;
      return await recordAiUsage(m.client, m.userId, {
        area: ai.area,
        backend,
        modelId,
        engineId: backend === "hosted" ? null : ai.engineId,
        inputTokens: usage?.input ?? null,
        outputTokens: usage?.output ?? null,
        latencyMs: Date.now() - startedAt,
        note: note ?? m.note ?? null,
      });
    } catch (err) {
      console.warn("[ai-routing] metering failed:", err);
      return null;
    }
  };


  const escalate = async (
    reason: AiEscalation["reason"],
    detail: string,
  ): Promise<{
    value: T;
    escalation: AiEscalation;
    backend: AiBackend;
    modelId: string;
    usage: import("./ai-metering.server").RecordedUsage | null;
  }> => {
    const hostedProvider = ai.hostedProvider;
    if (!hostedProvider) throw new Error("No cloud AI engine is available for fallback.");
    const hosted: AreaRunHandle = {
      provider: hostedProvider,
      modelId: ai.hostedModelId,
      backend: "hosted",
    };
    const value = await run(hosted);
    const usage = await meter(
      value,
      "hosted",
      hosted.modelId,
      `escalated from ${ai.modelId} (${reason})`,
    );
    return {
      value,
      escalation: {
        area: ai.area,
        areaLabel: ai.areaLabel,
        fromModel: ai.modelId,
        toModel: hosted.modelId,
        reason,
        detail,
      },
      backend: "hosted",
      modelId: hosted.modelId,
      usage,
    };
  };

  try {
    const value = await run(handle);
    if (canEscalate && opts?.isTruncated?.(value)) {
      try {
        return await escalate(
          "truncated",
          `${ai.modelId} returned a truncated or incomplete result, so the job was rerun on hosted AI.`,
        );
      } catch (err) {
        // Hosted retry failed — keep the local result rather than erroring.
        console.warn("[ai-routing] hosted escalation failed:", err);
        const usage = await meter(value, ai.backend, ai.modelId);
        return { value, escalation: null, backend: ai.backend, modelId: ai.modelId, usage };
      }
    }
    const usage = await meter(value, ai.backend, ai.modelId);
    return { value, escalation: null, backend: ai.backend, modelId: ai.modelId, usage };

  } catch (err) {
    if (!canEscalate) throw err;
    const message = err instanceof Error ? err.message : String(err);
    return await escalate(
      "error",
      `${ai.modelId} failed (${message.slice(0, 200)}), so the job was rerun on hosted AI.`,
    );
  }
}


/**
 * Escalation handle for call sites that make several AI calls (structured
 * output + plain-JSON retry, multi-step ingest). Returns null when escalation
 * isn't possible: the area already runs hosted, auto-fallback is off, or no
 * hosted key is configured.
 */
export function hostedHandle(
  ai: AreaAi,
  reason: AiEscalation["reason"],
  detail: string,
): { provider: Provider; modelId: string; escalation: AiEscalation } | null {
  if (
    ai.backend !== "local" ||
    !ai.autoFallback ||
    !ai.hostedAvailable ||
    !ai.hostedProvider
  ) return null;
  return {
    provider: ai.hostedProvider,
    modelId: ai.hostedModelId,
    escalation: {
      area: ai.area,
      areaLabel: ai.areaLabel,
      fromModel: ai.modelId,
      toModel: ai.hostedModelId,
      reason,
      detail,
    },
  };
}

export interface AreaRoutingStatus {
  area: AiAreaId;
  areaLabel: string;
  /** null when routing can't resolve (misconfigured engine). */
  backend: AiBackend | null;
  engineId: AiEngineId | null;
  engineLabel: string | null;
  modelId: string | null;
  /** The saved choice for this area ("default" | "local" | "hosted" | engine id). */
  choice: string;
  autoFallback: boolean;
  hostedAvailable: boolean;
  hostedModelId: string | null;
  ok: boolean;
  error: string | null;
}

/**
 * Read-only preview of where an area's next AI call would run. Same resolver as
 * the real call path, so the badge can't disagree with the run.
 */
export async function describeAreaRouting(
  area: AiAreaId,
  opts: {
    hostedDefaultModel: string;
    client?: SupabaseClient<Database>;
  },
): Promise<AreaRoutingStatus> {
  const def = getAiArea(area);
  let choice = "default";
  let autoFallback = true;
  try {
    const config = await loadRoutingConfig(opts.client);
    autoFallback = config.autoFallback;
    choice = routeForArea(config, area).backend;
  } catch {
    // fall through with defaults
  }

  try {
    const ai = await resolveAreaAi(area, { ...opts, skipEnabledCheck: true });
    return {
      area,
      areaLabel: ai.areaLabel,
      backend: ai.backend,
      engineId: ai.engineId,
      engineLabel: ai.engineLabel,
      modelId: ai.modelId,
      choice,
      autoFallback: ai.autoFallback,
      hostedAvailable: ai.hostedAvailable,
      hostedModelId: ai.hostedModelId,
      ok: true,
      error: null,
    };
  } catch (error) {
    return {
      area,
      areaLabel: def.label,
      backend: null,
      engineId: null,
      engineLabel: null,
      modelId: null,
      choice,
      autoFallback,
      hostedAvailable: false,
      hostedModelId: null,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
