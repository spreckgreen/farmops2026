// Resolve the effective context window of the model that will actually serve
// a request, so truncation warnings can name the limit that was hit.
//
// Only self-hosted Ollama exposes this (POST /api/show). Hosted providers
// (Lovable AI Gateway) don't, so we fall back to a conservative catalog of
// known windows and otherwise return null — the UI then shows token counts
// without a limit instead of inventing one.

import { parseOllamaShow, OLLAMA_DEFAULT_NUM_CTX, type OllamaShowResponse } from "./ollama-capability";

/** Known windows for hosted models we call by default. Conservative. */
const HOSTED_CONTEXT: { match: RegExp; contextLength: number }[] = [
  { match: /^google\/gemini-3/, contextLength: 1_000_000 },
  { match: /^google\/gemini/, contextLength: 1_000_000 },
  { match: /^openai\/gpt-5/, contextLength: 400_000 },
];

export interface ActiveContextLimit {
  model: string;
  contextLength: number | null;
  trainedContextLength: number | null;
  source: "ollama" | "catalog" | null;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: ActiveContextLimit }>();

function nativeRoot(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
}

function runtimeDefaultNumCtx(): number {
  const n = Number(process.env["OLLAMA_CONTEXT_LENGTH"]);
  return Number.isFinite(n) && n > 0 ? n : OLLAMA_DEFAULT_NUM_CTX;
}

/**
 * Best-effort; never throws. `model` is the id actually passed to the provider
 * (e.g. "llama3.2:3b" or "google/gemini-3.6-flash").
 */
export async function getActiveContextLimit(model: string): Promise<ActiveContextLimit> {
  const cached = cache.get(model);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  let value: ActiveContextLimit = {
    model,
    contextLength: null,
    trainedContextLength: null,
    source: null,
  };

  const base = process.env["CUSTOM_AI_BASE_URL"] || "";
  if (base && !model.includes("/")) {
    try {
      const res = await fetch(`${nativeRoot(base)}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name: model, model, verbose: false }),
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const cap = parseOllamaShow((await res.json()) as OllamaShowResponse, runtimeDefaultNumCtx());
        if (cap.contextLength != null) {
          value = {
            model,
            contextLength: cap.contextLength,
            trainedContextLength: cap.trainedContextLength,
            source: "ollama",
          };
        }
      }
    } catch {
      /* leave null — the banner degrades to token counts only */
    }
  }

  if (value.contextLength == null) {
    const hit = HOSTED_CONTEXT.find((h) => h.match.test(model));
    if (hit) {
      value = {
        model,
        contextLength: hit.contextLength,
        trainedContextLength: hit.contextLength,
        source: "catalog",
      };
    }
  }

  cache.set(model, { at: Date.now(), value });
  return value;
}
