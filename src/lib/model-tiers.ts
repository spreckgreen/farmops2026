// Turn the model list an OpenAI-compatible endpoint advertises (GET /v1/models)
// into a Good / Better / Best recommendation for Bostead's cloud-enabled AI
// features (maintenance schedule planning, SOP/manual parsing, consultant chat,
// summaries). Those tasks need instruction following + structured JSON output,
// so tiny chat models and non-chat models are filtered out.
//
// Pure and dependency-free so it can be unit tested and reused on client or
// server. Scoring is heuristic: model ids carry a surprising amount of signal
// (parameter counts like "llama3.1:70b", size words like "mini"/"pro",
// version numbers like "gpt-5.6" or "deepseek-v3.1").

export type ModelTier = "good" | "better" | "best";

export interface RankedModel {
  id: string;
  /** 0-100ish capability estimate; only meaningful relative to its siblings. */
  score: number;
  /** Short plain-language reason shown in the admin UI. */
  reason: string;
}

export interface ModelTiers {
  good: RankedModel | null;
  better: RankedModel | null;
  best: RankedModel | null;
  /** Everything scored, best first — useful for a manual pick. */
  ranked: RankedModel[];
  /** Ids skipped because they can't do chat/structured-output work. */
  excluded: string[];
}

/** Model families that can't run a chat/structured-output task at all. */
const NON_CHAT = [
  "embed",
  "embedding",
  "rerank",
  "whisper",
  "tts",
  "audio",
  "speech",
  "transcribe",
  "dall-e",
  "image",
  "moderation",
  "guard",
  "clip",
  "bge",
  "nomic",
  "minilm",
  "stable-diffusion",
  "sd3",
  "flux",
  "veo",
  "sora",
  "codestral-embed",
];

/** Parse "…:70b", "…-8x7b", "…_13B" into a billions-of-parameters number. */
function parseParams(id: string): number | null {
  const moe = id.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*b\b/i);
  if (moe) return Number(moe[1]) * Number(moe[2]);
  const plain = id.match(/(\d+(?:\.\d+)?)\s*b\b/i);
  if (plain) {
    const n = Number(plain[1]);
    // Guard against version numbers like "llama3.1b"-style false hits.
    if (n >= 0.5 && n <= 2000) return n;
  }
  return null;
}

/** Highest version-ish number in the id, e.g. gpt-5.6 → 5.6, v3.1 → 3.1. */
function parseVersion(id: string): number {
  let max = 0;
  for (const m of id.matchAll(/(?:^|[^\d])(\d{1,2}(?:\.\d{1,2})?)(?![\d.]*\s*b\b)/gi)) {
    const n = Number(m[1]);
    if (n > max && n <= 20) max = n;
  }
  return max;
}

function familyScore(id: string): { score: number; label: string } {
  const s = id.toLowerCase();
  if (/(gpt-5|o3|o4|chat-latest)/.test(s)) return { score: 88, label: "frontier OpenAI model" };
  if (/gpt-4\.1|gpt-4o|gpt-4/.test(s)) return { score: 72, label: "GPT-4 class model" };
  if (/claude.*opus/.test(s)) return { score: 90, label: "Claude Opus class" };
  if (/claude.*sonnet/.test(s)) return { score: 80, label: "Claude Sonnet class" };
  if (/claude.*haiku/.test(s)) return { score: 62, label: "Claude Haiku class" };
  if (/gemini.*pro/.test(s)) return { score: 84, label: "Gemini Pro class" };
  if (/gemini.*flash-lite|gemini.*lite/.test(s)) return { score: 58, label: "Gemini Flash-Lite class" };
  if (/gemini.*flash/.test(s)) return { score: 70, label: "Gemini Flash class" };
  if (/deepseek/.test(s)) return { score: 78, label: "DeepSeek reasoning family" };
  if (/gpt-oss/.test(s)) return { score: 76, label: "GPT-OSS open-weight family" };
  if (/qwen.*(coder|max|plus)/.test(s)) return { score: 74, label: "Qwen high-end family" };
  if (/qwen/.test(s)) return { score: 66, label: "Qwen family" };
  if (/llama\s*-?\s*4/.test(s)) return { score: 74, label: "Llama 4 family" };
  if (/llama/.test(s)) return { score: 64, label: "Llama family" };
  if (/mistral-large|mixtral/.test(s)) return { score: 70, label: "Mistral large/MoE family" };
  if (/mistral|magistral|ministral/.test(s)) return { score: 60, label: "Mistral family" };
  if (/command-r|cohere/.test(s)) return { score: 66, label: "Cohere Command family" };
  if (/grok/.test(s)) return { score: 76, label: "Grok family" };
  if (/kimi|glm|yi-|minimax/.test(s)) return { score: 70, label: "large open-weight family" };
  if (/phi|gemma|tinyllama|smollm|granite/.test(s)) return { score: 50, label: "small open-weight family" };
  return { score: 55, label: "general chat model" };
}

/** Size words shift a family up or down. */
function sizeAdjust(id: string): { delta: number; label: string | null } {
  const s = id.toLowerCase();
  if (/(nano|tiny|0\.5b|1b\b|1\.5b)/.test(s)) return { delta: -22, label: "very small" };
  if (/(mini|lite|small|haiku|flash-lite)/.test(s)) return { delta: -10, label: "small/fast tier" };
  if (/(pro|max|opus|ultra|-405b|:405b|671b|large)/.test(s)) return { delta: 10, label: "top tier" };
  return { delta: 0, label: null };
}

function isNonChat(id: string): boolean {
  const s = id.toLowerCase();
  return NON_CHAT.some((needle) => s.includes(needle));
}

function scoreModel(id: string): RankedModel {
  const fam = familyScore(id);
  const size = sizeAdjust(id);
  const params = parseParams(id);
  const version = parseVersion(id);

  let score = fam.score + size.delta;
  const notes: string[] = [fam.label];
  if (size.label) notes.push(size.label);

  if (params !== null) {
    // 3B ≈ -14, 8B ≈ -6, 70B ≈ +6, 120B+ ≈ +10.
    const paramDelta =
      params < 4 ? -14 : params < 9 ? -6 : params < 30 ? 0 : params < 100 ? 6 : 10;
    score += paramDelta;
    notes.push(`${params}B parameters`);
  }
  if (version > 0) score += Math.min(6, version * 0.8);

  // Instruct/chat tuning matters for structured output; base models don't follow
  // schemas well.
  if (/(instruct|chat|-it\b|turbo|sol|terra)/i.test(id)) score += 3;
  if (/(base|completion|davinci|babbage)/i.test(id)) score -= 20;
  if (/(preview|experimental|exp-|alpha|beta)/i.test(id)) {
    score -= 4;
    notes.push("preview build");
  }

  return {
    id,
    score: Math.max(1, Math.min(100, Math.round(score))),
    reason: notes.join(", "),
  };
}

/** Below this a model is too weak for schedule/manual JSON generation. */
const CAPABILITY_FLOOR = 45;

/**
 * Rank the endpoint's models and pick Good (cheapest that can still do the
 * job), Better (recommended default — solid quality at sane cost) and Best
 * (highest capability available).
 */
export function rankModelTiers(modelIds: readonly string[]): ModelTiers {
  const seen = new Set<string>();
  const excluded: string[] = [];
  const scored: RankedModel[] = [];

  for (const raw of modelIds) {
    const id = String(raw ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (isNonChat(id)) {
      excluded.push(id);
      continue;
    }
    scored.push(scoreModel(id));
  }

  const ranked = [...scored].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  if (ranked.length === 0) {
    return { good: null, better: null, best: null, ranked, excluded };
  }

  const best = ranked[0];
  const capable = ranked.filter((m) => m.score >= CAPABILITY_FLOOR);
  const pool = capable.length > 0 ? capable : ranked;

  // Good = the cheapest/smallest model that still clears the capability floor.
  const good = pool[pool.length - 1];

  // Better = closest to the midpoint between good and best, preferring a model
  // distinct from both so the three tiers are actually three choices.
  const midpoint = (good.score + best.score) / 2;
  const middleCandidates = pool.filter((m) => m.id !== best.id && m.id !== good.id);
  const better =
    (middleCandidates.length > 0 ? middleCandidates : pool)
      .slice()
      .sort(
        (a, b) => Math.abs(a.score - midpoint) - Math.abs(b.score - midpoint) || b.score - a.score,
      )[0] ?? best;

  return { good, better, best, ranked, excluded };
}

/** The model Bostead pre-selects after a successful connection test. */
export function recommendedModel(tiers: ModelTiers): string | null {
  return tiers.better?.id ?? tiers.best?.id ?? tiers.good?.id ?? null;
}

/** Return which Good/Better/Best tier a model id belongs to, if any. */
export function tierForModel(modelId: string, tiers: ModelTiers): ModelTier | null {
  if (tiers.good?.id === modelId) return "good";
  if (tiers.better?.id === modelId) return "better";
  if (tiers.best?.id === modelId) return "best";
  return null;
}
