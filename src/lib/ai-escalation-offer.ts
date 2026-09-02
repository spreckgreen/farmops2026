// Pre-flight "this looks too big for the local model — pay for cloud?" offer.
//
// A self-hosted 3B/gemma-latest model given a 9k-token as-installed record does
// not answer "what panel are the mini splits on"; it summarises the shape of the
// text instead. Rather than burn two minutes of local GPU time and hand back a
// non-answer, the app estimates the job up front and lets the user decide
// whether to spend cloud money on it.
//
// Pure math — unit tested, no I/O.
import { inferParamsB } from "@/lib/ai-model-suitability";
import {
  estimateHostedCost,
  formatUsd,
  tokenProfileFor,
  type HostedCostEstimate,
} from "@/lib/ai-pricing";
import type { AiAreaId } from "@/lib/ai-feature-areas";

export interface CloudOfferInput {
  area: AiAreaId;
  /** Where the feature is routed right now. */
  backend: string;
  localModel: string | null;
  hostedModel: string | null;
  /** A cloud engine is configured and reachable. */
  hostedAvailable: boolean;
  /** Prompt size we actually measured for this question. */
  contextTokens: number;
  /** Context window of the local model, when Ollama reported one. */
  localContextLength?: number | null;
}

export interface CloudOffer {
  /** True when the UI should ask before running locally. */
  recommended: boolean;
  /** Plain-language why, shown in the confirmation. */
  reason: string;
  backend: string;
  localModel: string | null;
  hostedModel: string | null;
  contextTokens: number;
  cost: HostedCostEstimate | null;
  /** "≈ $0.0043 for this question" — ready to render. */
  costLabel: string;
}

/** Prompts above this are more record than a small local model can hold on to. */
export const LOCAL_CONTEXT_SOFT_LIMIT = 4_000;

export function buildCloudOffer(input: CloudOfferInput): CloudOffer {
  const profile = tokenProfileFor(input.area);
  const inputTokens = Math.max(profile.inputTokens, input.contextTokens);
  const cost =
    input.hostedModel && input.hostedAvailable
      ? estimateHostedCost(input.area, input.hostedModel, {
          inputTokens,
          outputTokens: profile.outputTokens,
        })
      : null;

  const params = input.localModel ? inferParamsB(input.localModel) : null;
  const window = input.localContextLength ?? null;

  let recommended = false;
  let reason = "";

  if (input.backend !== "local") {
    reason = "This feature already runs on a cloud engine.";
  } else if (!input.hostedAvailable || !cost) {
    reason =
      "No cloud engine is configured, so this runs on the self-hosted model whatever its size.";
  } else if (window != null && input.contextTokens > window * 0.75) {
    recommended = true;
    reason = `This question sends ≈${input.contextTokens.toLocaleString()} tokens of records, but ${
      input.localModel ?? "the local model"
    } only holds ${window.toLocaleString()}. The local run will drop records and answer from a fragment.`;
  } else if (input.contextTokens > LOCAL_CONTEXT_SOFT_LIMIT && (params == null || params < 8)) {
    recommended = true;
    reason = `This question sends ≈${input.contextTokens.toLocaleString()} tokens of records. ${
      input.localModel ?? "The local model"
    }${
      params == null ? " is an unverified size" : ` is only ~${params}B`
    }, which usually summarises a record this large instead of answering it.`;
  } else if (input.contextTokens > 12_000) {
    recommended = true;
    reason = `This question sends ≈${input.contextTokens.toLocaleString()} tokens of records — large enough that a self-hosted run is slow and often incomplete.`;
  } else {
    reason = "The self-hosted model should handle a question this size.";
  }

  return {
    recommended,
    reason,
    backend: input.backend,
    localModel: input.localModel,
    hostedModel: input.hostedModel,
    contextTokens: input.contextTokens,
    cost,
    costLabel:
      cost == null
        ? "cost unknown"
        : cost.usd == null
          ? `${cost.modelId} has no published price`
          : `≈ ${formatUsd(cost.usd)} for this question`,
  };
}
