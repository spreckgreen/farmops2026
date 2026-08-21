// Pure heuristics for judging whether a local/self-hosted model can handle
// the app's two heaviest AI jobs:
//   - "reports"  (weekly/monthly rollups: long task lists in, JSON out)
//   - "manuals"  (procedure/manual generation: long-form prose out)
//
// Why heuristics: Ollama exposes a model's trained context length and
// parameter size, but nothing about instruction-following quality. Parameter
// count is the best available proxy, and the context window is a hard limit —
// a 2048-token window silently truncates a week of tasks, which is exactly
// how "there was nothing for the week" happens.
//
// Kept dependency-free and pure so it can be unit tested and used on both
// the server (enrichment) and the client (badges/warnings).

export type SuitabilityLevel = "good" | "marginal" | "unsuitable" | "unknown";

export interface ModelCapability {
  /** Model id, e.g. "llama3.2:3b". */
  id: string;
  /**
   * Effective context a request actually gets, in tokens. For Ollama this is
   * the baked-in num_ctx, or the runtime default (4096) when the model has
   * none — NOT the trained window.
   */
  contextLength?: number | null;
  /** Trained context of the weights, e.g. 131072 for llama3.2. */
  trainedContextLength?: number | null;
  /** Baked-in num_ctx, when the Modelfile pins one. */
  numCtx?: number | null;
  /** Provenance of contextLength, used to explain the verdict. */
  contextSource?: "num_ctx" | "runtime-default" | "trained" | null;
  /** Parameter count in billions, when known or inferable from the id/tag. */
  paramsB?: number | null;
}


export interface TaskRequirement {
  key: "reports" | "manuals";
  label: string;
  /** Below this context length the job is expected to fail outright. */
  minContext: number;
  /** At or above this context length the job has comfortable headroom. */
  goodContext: number;
  /** Below this parameter count output quality is expected to be unusable. */
  minParamsB: number;
  /** At or above this parameter count quality is expected to be reliable. */
  goodParamsB: number;
  why: string;
}

export const TASK_REQUIREMENTS: TaskRequirement[] = [
  {
    key: "reports",
    label: "Reports",
    minContext: 8192,
    goodContext: 16384,
    minParamsB: 3,
    goodParamsB: 7,
    why: "A week or month of tasks plus notes is 4k–12k tokens of input. A short context window truncates the list and the model reports nothing happened.",
  },
  {
    key: "manuals",
    label: "Manuals & procedures",
    minContext: 16384,
    goodContext: 32768,
    minParamsB: 7,
    goodParamsB: 12,
    why: "Long-form structured writing needs both room for the source material and enough parameters to hold a multi-section outline together.",
  },
];

/**
 * Best-effort parameter count (in billions) from a model id.
 * Handles "llama3.2:3b", "qwen2.5:14b-instruct-q4_K_M", "phi3:mini",
 * "mixtral:8x7b", "gpt-oss:20b", "gemma:latest" (unknown).
 */
export function inferParamsB(id: string): number | null {
  const lower = id.toLowerCase();

  // Mixture-of-experts: 8x7b ≈ 47B total. Treat total params as the capacity
  // signal since that's what has to fit in RAM.
  const moe = lower.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*b(?![a-z0-9])/);
  if (moe) return Number(moe[1]) * Number(moe[2]);

  // Plain "<n>b" token, e.g. 3b, 7b, 8b, 1.5b, 70b.
  const plain = lower.match(/(?:^|[^a-z0-9.])(\d+(?:\.\d+)?)\s*b(?![a-z0-9])/);
  if (plain) {
    const v = Number(plain[1]);
    if (v > 0 && v <= 2000) return v;
  }

  // Named size tags used by a few families.
  if (/(^|[:-])mini($|[-.])/.test(lower)) return 3.8; // phi3:mini
  if (/(^|[:-])small($|[-.])/.test(lower)) return 7;
  if (/(^|[:-])medium($|[-.])/.test(lower)) return 14;
  if (/(^|[:-])large($|[-.])/.test(lower)) return 32;

  return null;
}

export interface SuitabilityVerdict {
  task: TaskRequirement;
  level: SuitabilityLevel;
  /** Short, user-facing reasons this model was downgraded. Empty when good. */
  reasons: string[];
  /** Concrete next step, e.g. raise num_ctx or use a larger model. */
  fix: string | null;
}

function fmtTokens(n: number): string {
  return n >= 1024 ? `${Math.round(n / 1024)}k` : String(n);
}

export function evaluateTask(
  model: ModelCapability,
  task: TaskRequirement,
): SuitabilityVerdict {
  const ctx = model.contextLength ?? null;
  const params = model.paramsB ?? inferParamsB(model.id);
  const reasons: string[] = [];
  let level: SuitabilityLevel = "good";
  let fix: string | null = null;

  const downgrade = (next: SuitabilityLevel) => {
    const rank: Record<SuitabilityLevel, number> = {
      good: 0,
      unknown: 1,
      marginal: 2,
      unsuitable: 3,
    };
    if (rank[next] > rank[level]) level = next;
  };

  // Explain *why* the effective window is what it is: a model trained at 128k
  // still only sees 4k per request until num_ctx is baked in, which is the
  // single most confusing failure mode here.
  const clamped =
    model.contextSource === "runtime-default" &&
    model.trainedContextLength != null &&
    ctx != null &&
    model.trainedContextLength > ctx;

  if (ctx == null) {
    downgrade("unknown");
    reasons.push("Context window unknown — the provider didn't report it.");
  } else if (ctx < task.minContext) {
    downgrade("unsuitable");
    reasons.push(
      clamped
        ? `Effective context is only ${fmtTokens(ctx)} tokens (runtime default) even though the weights support ${fmtTokens(model.trainedContextLength!)} — below the ${fmtTokens(task.minContext)} needed, so input is silently truncated.`
        : `Context window ${fmtTokens(ctx)} tokens is below the ${fmtTokens(task.minContext)} needed; input will be silently truncated.`,
    );
    fix = `Raise the context window (Ollama: \`/set parameter num_ctx ${task.goodContext}\`, or set OLLAMA_CONTEXT_LENGTH=${task.goodContext}) or pick a model with a larger window.`;
  } else if (ctx < task.goodContext) {
    downgrade("marginal");
    reasons.push(
      `Context window ${fmtTokens(ctx)} tokens leaves little headroom (${fmtTokens(task.goodContext)} recommended)${clamped ? ` — the weights support ${fmtTokens(model.trainedContextLength!)}, so raising num_ctx is free capability` : ""}.`,
    );
    fix ??= `Increase num_ctx toward ${fmtTokens(task.goodContext)} tokens if RAM allows.`;
  }


  if (params == null) {
    downgrade("unknown");
    reasons.push("Parameter count unknown — the tag doesn't include a size.");
  } else if (params < task.minParamsB) {
    downgrade("unsuitable");
    reasons.push(
      `${params}B parameters is too small for this job (${task.minParamsB}B minimum, ${task.goodParamsB}B recommended).`,
    );
    fix ??= `Pull a larger model (e.g. qwen2.5:${task.goodParamsB >= 12 ? "14b" : "7b"}) or point CUSTOM_AI_BASE_URL at a hosted provider.`;
  } else if (params < task.goodParamsB) {
    downgrade("marginal");
    reasons.push(
      `${params}B parameters will work but output quality is inconsistent (${task.goodParamsB}B recommended).`,
    );
    fix ??= `For reliable results use a ${task.goodParamsB}B+ model.`;
  }

  return { task, level, reasons, fix };
}

export function evaluateModel(model: ModelCapability): SuitabilityVerdict[] {
  return TASK_REQUIREMENTS.map((t) => evaluateTask(model, t));
}

/** Worst level across all tasks — drives the compact badge in the picker. */
export function overallLevel(verdicts: SuitabilityVerdict[]): SuitabilityLevel {
  const rank: Record<SuitabilityLevel, number> = {
    good: 0,
    unknown: 1,
    marginal: 2,
    unsuitable: 3,
  };
  return verdicts.reduce<SuitabilityLevel>(
    (worst, v) => (rank[v.level] > rank[worst] ? v.level : worst),
    "good",
  );
}

export const LEVEL_LABEL: Record<SuitabilityLevel, string> = {
  good: "Good",
  marginal: "Marginal",
  unsuitable: "Unsuitable",
  unknown: "Unverified",
};

// ---------------------------------------------------------------------------
// One-click remediation helpers
// ---------------------------------------------------------------------------

/**
 * Context window (in tokens) worth applying for this model: the largest
 * "good" target across the tasks it currently can't satisfy. Returns null
 * when the reported context already covers every task.
 * e.g. { id: "llama3.2:3b", contextLength: 2048 } -> 32768
 */
export function recommendedContext(model: ModelCapability): number | null {
  const ctx = model.contextLength ?? 0;
  const target = TASK_REQUIREMENTS.filter((t) => ctx < t.goodContext).reduce(
    (max, t) => Math.max(max, t.goodContext),
    0,
  );
  return target > ctx ? target : null;
}

/** Ollama tag for a derived copy carrying a bigger num_ctx. */
export function derivedContextModelId(baseId: string, numCtx: number): string {
  const stem = baseId.replace(/:latest$/, "").replace(/[:/]/g, "-");
  return `${stem}-ctx${Math.round(numCtx / 1024)}k`;
}

/**
 * A larger model to suggest when parameter count (not context) is the
 * blocker. Null when the current model is already big enough.
 */
export function suggestedLargerModel(model: ModelCapability): string | null {
  const params = model.paramsB ?? inferParamsB(model.id);
  if (params != null && params >= 12) return null;
  if (params != null && params >= 7) return "qwen2.5:14b";
  return "qwen2.5:7b";
}

