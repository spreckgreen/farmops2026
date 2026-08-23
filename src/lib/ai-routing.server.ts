// Server-side resolution of per-feature AI routing.
//
// Each AI feature area (see ai-feature-areas.ts) chooses whether it runs on the
// LOCAL self-hosted endpoint (Ollama / CUSTOM_AI_*) or on HOSTED Lovable AI.
// Heavy jobs (weekly/monthly/quarterly/yearly rollups, manuals, consultant
// chat, KB ingest) default to hosted; light jobs stay local.
//
// Server-only: reads process.env + the shared vault. Never import from client
// code — call sites are server functions that dynamic-import this module.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
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

export const ROUTING_ENV_KEY = "CUSTOM_AI_FEATURE_ROUTING";

const BUNDLED_OLLAMA_BASE_URL = "http://ollama:11434/v1";
const BUNDLED_OLLAMA_API_KEY = "ollama";
const BUNDLED_OLLAMA_MODEL = "llama3.2:3b";

type Provider = ReturnType<typeof createOpenAICompatible>;

export async function loadRoutingConfig(): Promise<AiRoutingConfig> {
  const { getServerEnv } = await import("./server-env.server");
  return resolveRoutingConfig(await getServerEnv(ROUTING_ENV_KEY));
}

export async function saveRoutingConfig(config: AiRoutingConfig, userId: string) {
  const { persistSharedRouting } = await import("./ai-routing-store.server");
  await persistSharedRouting(serializeRoutingConfig(config), userId);
  return config;
}

function localProvider(): Provider {
  const baseURL = process.env.CUSTOM_AI_BASE_URL || BUNDLED_OLLAMA_BASE_URL;
  const key = process.env.CUSTOM_AI_API_KEY || BUNDLED_OLLAMA_API_KEY;
  return createOpenAICompatible({
    name: "custom-ai",
    baseURL,
    headers: { Authorization: `Bearer ${key}` },
  });
}

function hostedProvider(apiKey: string): Provider {
  return createOpenAICompatible({
    name: "lovable-ai-gateway",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: { "Lovable-API-Key": apiKey },
  });
}

export interface AreaAi {
  area: AiAreaId;
  areaLabel: string;
  backend: AiBackend;
  provider: Provider;
  modelId: string;
  /** Retry once on hosted AI when a local call fails or truncates. */
  autoFallback: boolean;
  /** Hosted AI reachable (LOVABLE_API_KEY present). */
  hostedAvailable: boolean;
  /** Model that a hosted escalation would use. */
  hostedModelId: string;
}

/**
 * Resolve provider + model for one feature area.
 *
 * `hostedDefaultModel` is the call site's existing Lovable AI model id — kept
 * per call site so routing never silently changes which hosted model a feature
 * has always used.
 */
export async function resolveAreaAi(
  area: AiAreaId,
  opts: { hostedDefaultModel: string },
): Promise<AreaAi> {
  const def = getAiArea(area);
  const config = await loadRoutingConfig();
  const route = routeForArea(config, area);

  const { getServerEnv } = await import("./server-env.server");
  // A per-area model override is only valid for the backend it belongs to.
  // Hosted (Lovable AI) ids are namespaced ("google/gemini-3.6-flash"); local
  // Ollama tags are not ("llama3.2:3b"). Sending an Ollama tag to the hosted
  // gateway 400s, which used to surface as "the model returned no schedule".
  const routeModel = route.model?.trim() || null;
  const routeModelIsHosted = Boolean(routeModel && routeModel.includes("/"));
  const localOverride = routeModel && !routeModelIsHosted ? routeModel : null;
  const activeLocalModel =
    localOverride || (await getServerEnv("CUSTOM_AI_MODEL")) || BUNDLED_OLLAMA_MODEL;
  const hostedKey = process.env.LOVABLE_API_KEY;
  const hostedModelId = routeModelIsHosted ? routeModel! : opts.hostedDefaultModel;

  // "default": follow the legacy global resolution — custom endpoint wins,
  // else hosted, else bundled Ollama.
  let backend: AiBackend;
  if (route.backend === "default") {
    backend =
      process.env.CUSTOM_AI_BASE_URL && process.env.CUSTOM_AI_API_KEY
        ? "local"
        : hostedKey
          ? "hosted"
          : "local";
  } else {
    backend = route.backend;
  }
  // Hosted requested but no key: degrade to local rather than throwing.
  if (backend === "hosted" && !hostedKey) backend = "local";

  return {
    area,
    areaLabel: def.label,
    backend,
    provider: backend === "hosted" ? hostedProvider(hostedKey!) : localProvider(),
    modelId: backend === "hosted" ? hostedModelId : activeLocalModel,
    autoFallback: config.autoFallback,
    hostedAvailable: Boolean(hostedKey),
    hostedModelId,
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
export async function runAreaAi<T>(
  ai: AreaAi,
  run: (handle: AreaRunHandle) => Promise<T>,
  opts?: { isTruncated?: (value: T) => boolean },
): Promise<{ value: T; escalation: AiEscalation | null; backend: AiBackend; modelId: string }> {
  const canEscalate = ai.backend === "local" && ai.autoFallback && ai.hostedAvailable;
  const handle: AreaRunHandle = {
    provider: ai.provider,
    modelId: ai.modelId,
    backend: ai.backend,
  };

  const escalate = async (
    reason: AiEscalation["reason"],
    detail: string,
  ): Promise<{ value: T; escalation: AiEscalation; backend: AiBackend; modelId: string }> => {
    const hosted: AreaRunHandle = {
      provider: hostedProvider(process.env.LOVABLE_API_KEY!),
      modelId: ai.hostedModelId,
      backend: "hosted",
    };
    const value = await run(hosted);
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
        return { value, escalation: null, backend: ai.backend, modelId: ai.modelId };
      }
    }
    return { value, escalation: null, backend: ai.backend, modelId: ai.modelId };
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
  if (ai.backend !== "local" || !ai.autoFallback || !ai.hostedAvailable) return null;
  return {
    provider: hostedProvider(process.env.LOVABLE_API_KEY!),
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
