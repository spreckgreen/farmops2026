// Detect AI replies that were cut off, and explain it in tokens the user can
// act on. Pure + dependency-free so it runs on the server (attaching the
// signal to a response) and in tests.
//
// Two independent signals, because self-hosted Ollama is unreliable about both:
//   1. finishReason === "length" — the model hit an output cap. Authoritative.
//   2. Budget math — estimated input + output tokens sit at or above the
//      effective context window. Ollama does NOT report a truncation; it
//      silently drops the oldest tokens of the prompt, which is exactly how a
//      weekly report comes back saying "nothing happened this week".
//
// Token estimates use ~4 characters/token (English prose + markdown). That's
// an estimate, and the UI must say so — usage numbers from the provider are
// preferred whenever present.

export interface AiUsageLike {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  // AI SDK v4 spellings, still emitted by some providers.
  promptTokens?: number | null;
  completionTokens?: number | null;
}

export interface TruncationInput {
  /** AI SDK finishReason, e.g. "stop" | "length" | "tool-calls". */
  finishReason?: string | null;
  /** Provider-reported usage, when available. */
  usage?: AiUsageLike | null;
  /** Everything sent to the model (system + prompt + messages) for estimation. */
  promptChars?: number | null;
  /** The model's reply text, for estimation and mid-sentence detection. */
  outputText?: string | null;
  /** Effective context window in tokens (see ollama-capability). */
  contextLimit?: number | null;
  /** Model id, for the banner text. */
  model?: string | null;
}

export interface TruncationSignal {
  truncated: boolean;
  /** Why we think so — drives the banner wording. */
  reason: "output-cap" | "context-overflow" | "context-pressure" | null;
  inputTokens: number | null;
  outputTokens: number | null
  totalTokens: number | null;
  /** True when the token counts are 4-chars/token estimates, not provider data. */
  estimated: boolean;
  contextLimit: number | null;
  /** Share of the context window used, 0-1+, null without a limit. */
  usedFraction: number | null;
  model: string | null;
  finishReason: string | null;
}

/** ~4 chars per token for English prose and markdown. */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** Fraction of the window at which we warn even without a hard signal. */
export const CONTEXT_PRESSURE_THRESHOLD = 0.9;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

export function detectTruncation(input: TruncationInput): TruncationSignal {
  const u = input.usage ?? null;
  const reportedIn = num(u?.inputTokens) ?? num(u?.promptTokens);
  const reportedOut = num(u?.outputTokens) ?? num(u?.completionTokens);

  const estimated = reportedIn == null || reportedOut == null;
  const inputTokens =
    reportedIn ?? (input.promptChars != null ? Math.ceil(input.promptChars / 4) : null);
  const outputTokens = reportedOut ?? estimateTokens(input.outputText);

  const reportedTotal = num(u?.totalTokens);
  const totalTokens =
    reportedTotal ??
    (inputTokens != null && outputTokens != null ? inputTokens + outputTokens : null);

  const contextLimit = num(input.contextLimit);
  const usedFraction =
    contextLimit && contextLimit > 0 && totalTokens != null ? totalTokens / contextLimit : null;

  const finishReason = input.finishReason ?? null;

  let reason: TruncationSignal["reason"] = null;
  if (finishReason === "length") {
    reason = "output-cap";
  } else if (usedFraction != null && usedFraction >= 1) {
    reason = "context-overflow";
  } else if (usedFraction != null && usedFraction >= CONTEXT_PRESSURE_THRESHOLD) {
    reason = "context-pressure";
  }

  return {
    // "context-pressure" is a caution, not a claim that output was cut.
    truncated: reason === "output-cap" || reason === "context-overflow",
    reason,
    inputTokens,
    outputTokens,
    totalTokens,
    estimated,
    contextLimit,
    usedFraction,
    model: input.model ?? null,
    finishReason,
  };
}

/** Only worth sending to the client when there's something to say. */
export function truncationOrNull(input: TruncationInput): TruncationSignal | null {
  const s = detectTruncation(input);
  return s.reason ? s : null;
}

export function formatTokens(n: number | null | undefined): string {
  if (n == null) return "unknown";
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

/** One-line headline for the banner. */
export function truncationHeadline(s: TruncationSignal): string {
  switch (s.reason) {
    case "output-cap":
      return "This reply was cut off before the model finished";
    case "context-overflow":
      return "Input exceeded the model's context window — part of it was dropped";
    case "context-pressure":
      return "This request nearly filled the model's context window";
    default:
      return "";
  }
}

/** Concrete next step for the banner. */
export function truncationAdvice(s: TruncationSignal): string {
  const target = s.contextLimit && s.contextLimit < 16384 ? 32768 : null;
  if (s.reason === "output-cap") {
    return "Ask for a shorter answer, or split the request into parts. On self-hosted Ollama, raise num_predict / num_ctx in Settings → Self-host.";
  }
  return target
    ? `Raise the context window to ${target / 1024}k in Settings → Self-host (one-click fix on the model picker), or narrow the date range / filters so less input is sent.`
    : "Narrow the date range or filters so less input is sent, or switch to a model with a larger context window in Settings → Self-host.";
}
