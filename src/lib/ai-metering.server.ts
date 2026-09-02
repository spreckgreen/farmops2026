// AI usage metering.
//
// Every AI run is recorded in `ai_usage_events`. Runs that stayed on the
// self-hosted engine are recorded with `metered: false` and cost 0 (you paid in
// electricity, not invoices). Runs that went to a cloud engine are priced from
// the published per-million-token rates in ai-pricing.ts, e.g. a
// google/gemini-3.6-flash panel Q&A at 3,500 in / 900 out tokens
// = 3500/1e6 * $0.30 + 900/1e6 * $2.50 ≈ $0.00330.
import { rateForModel, tokenProfileFor } from "./ai-pricing";
import { getAiArea, type AiAreaId, type AiBackend } from "./ai-feature-areas";

type LooseDb = { from: (table: string) => any };

export const AI_USAGE_TABLE = "ai_usage_events";

export interface RecordUsageInput {
  area: AiAreaId;
  backend: AiBackend;
  modelId: string;
  engineId?: string | null;
  /** Actual token counts when the SDK reported them; estimated otherwise. */
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  note?: string | null;
}

export interface RecordedUsage {
  metered: boolean;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
}

export function priceRun(input: RecordUsageInput): RecordedUsage {
  const profile = tokenProfileFor(input.area);
  const estimated =
    input.inputTokens == null || input.outputTokens == null;
  const inputTokens = Math.max(0, Math.round(input.inputTokens ?? profile.inputTokens));
  const outputTokens = Math.max(0, Math.round(input.outputTokens ?? profile.outputTokens));
  const metered = input.backend !== "local";
  if (!metered) {
    return { metered: false, costUsd: 0, inputTokens, outputTokens, estimated };
  }
  const rate = rateForModel(input.modelId);
  const costUsd = rate
    ? (inputTokens / 1_000_000) * rate.inputPerMTok +
      (outputTokens / 1_000_000) * rate.outputPerMTok
    : 0;
  return { metered: true, costUsd, inputTokens, outputTokens, estimated };
}

/**
 * Write one usage row. Never throws — metering must not break a working AI call.
 */
export async function recordAiUsage(
  client: unknown,
  userId: string | null | undefined,
  input: RecordUsageInput,
): Promise<RecordedUsage | null> {
  const priced = priceRun(input);
  if (!client || !userId) return priced;
  try {
    const label = (() => {
      try {
        return getAiArea(input.area).label;
      } catch {
        return input.area;
      }
    })();
    const { error } = await (client as LooseDb).from(AI_USAGE_TABLE).insert({
      user_id: userId,
      area: input.area,
      area_label: label,
      engine_id: input.engineId ?? null,
      backend: input.backend,
      model: input.modelId,
      input_tokens: priced.inputTokens,
      output_tokens: priced.outputTokens,
      cost_usd: Number(priced.costUsd.toFixed(6)),
      metered: priced.metered,
      estimated: priced.estimated,
      latency_ms: input.latencyMs ?? null,
      note: input.note ?? null,
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.warn("[ai-metering] could not record AI usage:", err);
  }
  return priced;
}
