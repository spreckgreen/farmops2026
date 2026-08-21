// Pure parser for Ollama's POST /api/show response.
//
// Why this exists: suitability badges used to fall back to guessing size from
// the tag ("llama3.2:3b" -> 3B) and treated the *trained* context length as
// what the model actually gets at runtime. Both are wrong in practice:
//
//   * `model_info["general.parameter_count"]` gives the exact parameter count
//     (e.g. 3212749888 -> 3.2B), so "gemma:latest" no longer reads as unknown.
//   * `parameters` is the baked-in Modelfile parameter block, e.g.
//         stop           "<|eot_id|>"
//         num_ctx        16384
//     A `num_ctx` there is what every request gets. Without it Ollama caps the
//     request at its own default (4096 in current builds, overridable with
//     OLLAMA_CONTEXT_LENGTH) — NOT the trained 131072 the model advertises.
//
// So the number the badges must judge is the *effective* context:
//   num_ctx (if baked in) else min(trained, runtime default).
//
// Kept dependency-free and pure so it is unit-testable without a live Ollama.

/** Ollama's own default request context length when num_ctx isn't set. */
export const OLLAMA_DEFAULT_NUM_CTX = 4096;

export interface OllamaShowResponse {
  parameters?: string;
  modelfile?: string;
  template?: string;
  capabilities?: string[];
  details?: { parameter_size?: string; quantization_level?: string };
  model_info?: Record<string, unknown>;
}

export interface OllamaCapability {
  /** Context length the weights were trained with (from model_info). */
  trainedContextLength: number | null;
  /** Explicit num_ctx baked into the model's parameters / Modelfile. */
  numCtx: number | null;
  /** What a request actually gets: numCtx ?? min(trained, runtime default). */
  contextLength: number | null;
  /** Parameter count in billions, exact when the provider reports a count. */
  paramsB: number | null;
  /** Where paramsB came from — "provider" beats "tag" inference. */
  paramsSource: "count" | "label" | null;
  /** Where the effective context came from. */
  contextSource: "num_ctx" | "runtime-default" | "trained" | null;
  /** Max output tokens baked in, if the model pins num_predict. */
  numPredict: number | null;
  /** Provider-declared capabilities, e.g. ["completion","tools","vision"]. */
  capabilities: string[];
  /** Quantization label, e.g. "Q4_K_M". */
  quantization: string | null;
}

export const EMPTY_CAPABILITY: OllamaCapability = {
  trainedContextLength: null,
  numCtx: null,
  contextLength: null,
  paramsB: null,
  paramsSource: null,
  contextSource: null,
  numPredict: null,
  capabilities: [],
  quantization: null,
};

/**
 * Read a numeric Modelfile parameter out of an Ollama `parameters` /
 * `modelfile` text block. Tolerates tabs, multiple spaces and `PARAMETER`
 * prefixes: "num_ctx 16384", "PARAMETER num_ctx   16384".
 */
export function readModelfileNumber(text: string | undefined, key: string): number | null {
  if (!text) return null;
  const re = new RegExp(`(?:^|\\n)\\s*(?:PARAMETER\\s+)?${key}\\s+(\\d+)`, "i");
  const m = text.match(re);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Parse "3.2B" / "8x7B" / "780M" into billions. */
export function parseParameterSizeLabel(label: string | undefined): number | null {
  if (!label) return null;
  const moe = label.match(/(\d+)\s*x\s*([\d.]+)\s*([BM])/i);
  if (moe) {
    const each = Number(moe[2]);
    if (!Number.isFinite(each)) return null;
    const b = moe[3].toUpperCase() === "M" ? each / 1000 : each;
    return Math.round(Number(moe[1]) * b * 100) / 100;
  }
  const m = label.match(/([\d.]+)\s*([BM])/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2].toUpperCase() === "M" ? Math.round((n / 1000) * 100) / 100 : n;
}

/** Pull `<arch>.context_length` out of model_info without knowing the arch. */
export function readTrainedContext(modelInfo: Record<string, unknown> | undefined): number | null {
  if (!modelInfo) return null;
  // Prefer the architecture's own key when the arch is declared.
  const arch = modelInfo["general.architecture"];
  if (typeof arch === "string") {
    const v = modelInfo[`${arch}.context_length`];
    if (typeof v === "number" && v > 0) return v;
  }
  for (const [k, v] of Object.entries(modelInfo)) {
    if (/\.context_length$/.test(k) && typeof v === "number" && v > 0) return v;
  }
  return null;
}

export function parseOllamaShow(
  body: OllamaShowResponse,
  runtimeDefaultNumCtx: number = OLLAMA_DEFAULT_NUM_CTX,
): OllamaCapability {
  const trainedContextLength = readTrainedContext(body.model_info);

  const paramText = [body.parameters, body.modelfile].filter(Boolean).join("\n");
  const numCtx = readModelfileNumber(paramText, "num_ctx");
  const numPredict = readModelfileNumber(paramText, "num_predict");

  let contextLength: number | null = null;
  let contextSource: OllamaCapability["contextSource"] = null;
  if (numCtx) {
    contextLength = numCtx;
    contextSource = "num_ctx";
  } else if (trainedContextLength) {
    // No baked-in num_ctx: Ollama clamps the request to its own default.
    if (trainedContextLength > runtimeDefaultNumCtx) {
      contextLength = runtimeDefaultNumCtx;
      contextSource = "runtime-default";
    } else {
      contextLength = trainedContextLength;
      contextSource = "trained";
    }
  }

  // Exact count wins over the rounded label.
  let paramsB: number | null = null;
  let paramsSource: OllamaCapability["paramsSource"] = null;
  const count = body.model_info?.["general.parameter_count"];
  if (typeof count === "number" && count > 0) {
    paramsB = Math.round((count / 1e9) * 100) / 100;
    paramsSource = "count";
  } else {
    const fromLabel = parseParameterSizeLabel(body.details?.parameter_size);
    if (fromLabel != null) {
      paramsB = fromLabel;
      paramsSource = "label";
    }
  }

  return {
    trainedContextLength,
    numCtx,
    contextLength,
    paramsB,
    paramsSource,
    contextSource,
    numPredict,
    capabilities: Array.isArray(body.capabilities)
      ? body.capabilities.filter((c): c is string => typeof c === "string")
      : [],
    quantization: body.details?.quantization_level ?? null,
  };
}
