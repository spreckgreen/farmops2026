// Per-run cost estimates for each AI feature area.
//
// Two very different cost models are in play:
//   hosted → provider-billed token usage (approximate list prices)
//   local  → you pay for electricity while your GPU/CPU chews on the prompt
//
// Everything here is pure math over published list prices + a token profile
// per feature area, so it can be unit tested and rendered client-side.
//
// Example: a weekly report on google/gemini-3.6-flash is roughly
// 9,000 input + 1,800 output tokens → 9,000/1e6 * $0.30 + 1,800/1e6 * $2.50
// = $0.0027 + $0.0045 ≈ $0.0072 per run ≈ 0.07 credits.

import type { AiAreaDef, AiAreaId } from "@/lib/ai-feature-areas";

/** USD per 1M tokens for configured cloud models (approximate). */
export interface ModelRate {
  inputPerMTok: number;
  outputPerMTok: number;
}

/** Longest prefix match wins, so unknown "…-flash" variants still price. */
const MODEL_RATES: Array<{ prefix: string; rate: ModelRate }> = [
  { prefix: "openai/gpt-5.6-sol", rate: { inputPerMTok: 1.25, outputPerMTok: 10 } },
  { prefix: "openai/gpt-5.6-terra", rate: { inputPerMTok: 0.5, outputPerMTok: 4 } },
  { prefix: "openai/gpt-5.6-luna", rate: { inputPerMTok: 0.1, outputPerMTok: 0.8 } },
  { prefix: "openai/gpt-5.5-pro", rate: { inputPerMTok: 15, outputPerMTok: 120 } },
  { prefix: "openai/gpt-5.5", rate: { inputPerMTok: 1.25, outputPerMTok: 10 } },
  { prefix: "openai/gpt-5.4-pro", rate: { inputPerMTok: 15, outputPerMTok: 120 } },
  { prefix: "openai/gpt-5.4-nano", rate: { inputPerMTok: 0.05, outputPerMTok: 0.4 } },
  { prefix: "openai/gpt-5.4-mini", rate: { inputPerMTok: 0.25, outputPerMTok: 2 } },
  { prefix: "openai/gpt-5.4", rate: { inputPerMTok: 1.25, outputPerMTok: 10 } },
  { prefix: "openai/gpt-5.2", rate: { inputPerMTok: 1.25, outputPerMTok: 10 } },
  { prefix: "openai/gpt-5-nano", rate: { inputPerMTok: 0.05, outputPerMTok: 0.4 } },
  { prefix: "openai/gpt-5-mini", rate: { inputPerMTok: 0.25, outputPerMTok: 2 } },
  { prefix: "openai/gpt-5", rate: { inputPerMTok: 1.25, outputPerMTok: 10 } },
  { prefix: "google/gemini-3.1-pro", rate: { inputPerMTok: 2, outputPerMTok: 12 } },
  { prefix: "google/gemini-2.5-pro", rate: { inputPerMTok: 1.25, outputPerMTok: 10 } },
  { prefix: "google/gemini-3.7-flash", rate: { inputPerMTok: 0.3, outputPerMTok: 2.5 } },
  { prefix: "google/gemini-3.6-flash", rate: { inputPerMTok: 0.3, outputPerMTok: 2.5 } },
  { prefix: "google/gemini-3.5-flash", rate: { inputPerMTok: 0.3, outputPerMTok: 2.5 } },
  { prefix: "google/gemini-3.1-flash-lite", rate: { inputPerMTok: 0.1, outputPerMTok: 0.4 } },
  { prefix: "google/gemini-3-flash", rate: { inputPerMTok: 0.3, outputPerMTok: 2.5 } },
  { prefix: "google/gemini-2.5-flash-lite", rate: { inputPerMTok: 0.1, outputPerMTok: 0.4 } },
  { prefix: "google/gemini-2.5-flash", rate: { inputPerMTok: 0.3, outputPerMTok: 2.5 } },
];

/** Rough display conversion for hosted usage units. */
export const USD_PER_CREDIT = 0.01;

export function rateForModel(modelId: string): ModelRate | null {
  const id = modelId.trim().toLowerCase();
  let best: { prefix: string; rate: ModelRate } | null = null;
  for (const entry of MODEL_RATES) {
    if (id.startsWith(entry.prefix) && (!best || entry.prefix.length > best.prefix.length)) {
      best = entry;
    }
  }
  return best?.rate ?? null;
}

/** Typical tokens one run of an area consumes (input + generated output). */
export interface TokenProfile {
  inputTokens: number;
  outputTokens: number;
}

const TOKEN_PROFILES: Record<AiAreaId, TokenProfile> = {
  "summary.daily": { inputTokens: 1_500, outputTokens: 400 },
  "summary.task": { inputTokens: 1_200, outputTokens: 350 },
  "summary.weekly": { inputTokens: 9_000, outputTokens: 1_800 },
  "summary.monthly": { inputTokens: 26_000, outputTokens: 2_500 },
  "summary.quarterly": { inputTokens: 60_000, outputTokens: 3_000 },
  "summary.yearly": { inputTokens: 180_000, outputTokens: 4_000 },
  consultant: { inputTokens: 14_000, outputTokens: 900 },
  procedures: { inputTokens: 12_000, outputTokens: 2_500 },
  kb_ingest: { inputTokens: 20_000, outputTokens: 3_000 },
  "maintenance.schedule": { inputTokens: 6_000, outputTokens: 1_200 },
  "maintenance.symptom": { inputTokens: 2_500, outputTokens: 700 },
  "maintenance.forecast": { inputTokens: 1_800, outputTokens: 350 },
  "food.preservation": { inputTokens: 2_200, outputTokens: 700 },
  "food.prices": { inputTokens: 1_200, outputTokens: 500 },
  "electrical.panel_qa": { inputTokens: 9_000, outputTokens: 700 },
  "electrical.load_trace": { inputTokens: 9_000, outputTokens: 700 },
  "electrical.topology_explain": { inputTokens: 9_000, outputTokens: 900 },
  "electrical.qa_triage": { inputTokens: 16_000, outputTokens: 1_500 },
  "electrical.audit_summary": { inputTokens: 7_000, outputTokens: 1_000 },
  "electrical.field_note": { inputTokens: 600, outputTokens: 300 },
  // A 1024px nameplate photo bills as image tokens; ~1.2k covers one plate.
  "electrical.nameplate_extract": { inputTokens: 1_600, outputTokens: 500 },
  diagnostics: { inputTokens: 800, outputTokens: 250 },
};

export function tokenProfileFor(id: AiAreaId): TokenProfile {
  return TOKEN_PROFILES[id] ?? { inputTokens: 2_000, outputTokens: 500 };
}

/** Hosted model each call site sends when an area routes to hosted AI. */
const AREA_HOSTED_MODEL: Record<AiAreaId, string> = {
  "summary.daily": "google/gemini-3-flash-preview",
  "summary.task": "google/gemini-3-flash-preview",
  "summary.weekly": "google/gemini-3-flash-preview",
  "summary.monthly": "google/gemini-3-flash-preview",
  "summary.quarterly": "google/gemini-3-flash-preview",
  "summary.yearly": "google/gemini-3-flash-preview",
  consultant: "google/gemini-3.6-flash",
  procedures: "google/gemini-3-flash-preview",
  kb_ingest: "openai/gpt-5.6-sol",
  "electrical.panel_qa": "google/gemini-3.6-flash",
  "electrical.load_trace": "google/gemini-3.6-flash",
  "electrical.topology_explain": "google/gemini-3.6-flash",
  "electrical.qa_triage": "google/gemini-3.6-flash",
  "electrical.audit_summary": "google/gemini-3.6-flash",
  "electrical.field_note": "google/gemini-3.6-flash",
  "electrical.nameplate_extract": "google/gemini-3.6-flash",
  "maintenance.schedule": "google/gemini-3.6-flash",
  "maintenance.symptom": "google/gemini-3.6-flash",
  "maintenance.forecast": "google/gemini-3.6-flash",
  "food.preservation": "google/gemini-3.6-flash",
  "food.prices": "google/gemini-3-flash-preview",
  diagnostics: "google/gemini-3-flash-preview",
};

export function hostedModelForArea(id: AiAreaId, override?: string | null): string {
  return (override && override.trim()) || AREA_HOSTED_MODEL[id] || "google/gemini-3.6-flash";
}

export interface HostedCostEstimate {
  kind: "hosted";
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  /** Null when the model id isn't in the price table (custom / unknown). */
  usd: number | null;
  credits: number | null;
}

/** Cost of one hosted run of this area on `modelId`. */
export function estimateHostedCost(
  id: AiAreaId,
  modelId: string,
  profile: TokenProfile = tokenProfileFor(id),
): HostedCostEstimate {
  const rate = rateForModel(modelId);
  if (!rate) {
    return {
      kind: "hosted",
      modelId,
      inputTokens: profile.inputTokens,
      outputTokens: profile.outputTokens,
      usd: null,
      credits: null,
    };
  }
  const usd =
    (profile.inputTokens / 1_000_000) * rate.inputPerMTok +
    (profile.outputTokens / 1_000_000) * rate.outputPerMTok;
  return {
    kind: "hosted",
    modelId,
    inputTokens: profile.inputTokens,
    outputTokens: profile.outputTokens,
    usd,
    credits: usd / USD_PER_CREDIT,
  };
}

/** Assumptions for a self-hosted run: throughput, draw, and power price. */
export interface LocalCostAssumptions {
  /** Generated tokens per second on your box. 25 tok/s ≈ 8B model on a 3060. */
  tokensPerSecond: number;
  /** Whole-machine draw while generating, in watts. */
  watts: number;
  /** Electricity price, USD per kWh. US average ≈ $0.17. */
  usdPerKwh: number;
  /** Prompt processing is much faster than generation; multiplier on input. */
  promptSpeedFactor: number;
}

export const DEFAULT_LOCAL_ASSUMPTIONS: LocalCostAssumptions = {
  tokensPerSecond: 25,
  watts: 250,
  usdPerKwh: 0.17,
  promptSpeedFactor: 8,
};

export interface LocalCostEstimate {
  kind: "local";
  modelId: string;
  seconds: number;
  kwh: number;
  usd: number;
  inputTokens: number;
  outputTokens: number;
}

/** Electricity cost of one local run — no per-token billing involved. */
export function estimateLocalCost(
  id: AiAreaId,
  modelId: string,
  assumptions: LocalCostAssumptions = DEFAULT_LOCAL_ASSUMPTIONS,
  profile: TokenProfile = tokenProfileFor(id),
): LocalCostEstimate {
  const tps = Math.max(1, assumptions.tokensPerSecond);
  const promptSeconds = profile.inputTokens / (tps * Math.max(1, assumptions.promptSpeedFactor));
  const genSeconds = profile.outputTokens / tps;
  const seconds = promptSeconds + genSeconds;
  const kwh = (assumptions.watts * seconds) / 3_600_000;
  return {
    kind: "local",
    modelId,
    seconds,
    kwh,
    usd: kwh * assumptions.usdPerKwh,
    inputTokens: profile.inputTokens,
    outputTokens: profile.outputTokens,
  };
}

export type CostEstimate = HostedCostEstimate | LocalCostEstimate;

/** "$0.0072" / "<$0.0001" — small AI costs need more than 2 decimals. */
export function formatUsd(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.0001) return "<$0.0001";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatCredits(credits: number): string {
  if (credits < 0.01) return "<0.01 credits";
  if (credits < 1) return `${credits.toFixed(2)} credits`;
  return `${credits.toFixed(1)} credits`;
}

export function formatTokens(n: number): string {
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}

/** Short label rendered next to an AI option. */
export function summarizeEstimate(est: CostEstimate): string {
  if (est.kind === "local") return `≈ ${formatUsd(est.usd)} power / run`;
  if (est.usd == null) return "cost unknown";
  return `≈ ${formatUsd(est.usd)} / run`;
}

/** Both sides of the choice for one area, so the UI can compare them. */
export function estimateAreaOptions(
  area: AiAreaDef,
  localModelId: string | null,
  modelOverride: string | null,
  assumptions: LocalCostAssumptions = DEFAULT_LOCAL_ASSUMPTIONS,
): { hosted: HostedCostEstimate; local: LocalCostEstimate } {
  return {
    hosted: estimateHostedCost(area.id, hostedModelForArea(area.id, modelOverride)),
    local: estimateLocalCost(area.id, localModelId ?? "local model", assumptions),
  };
}
