// 24-hour answer cache for the Electrical AI assistant.
//
// A local self-hosted panel Q&A can take 150s and a cloud run costs real money,
// so the same question asked twice inside a day replays the stored answer and
// offers a refresh instead of paying for the run again.
//
// Entries live in localStorage (per browser, per user profile) keyed by
// scenario + normalized question, e.g.
//   "panel_qa|what panel is the mini splits on"
// Photo scenarios are never cached — the image is the question.
import type { ElectricalAiAnswer } from "@/lib/electrical-ai.functions";

// Bump whenever record matching / grounding semantics change. This prevents an
// answer produced by an older matcher from surviving after the code is fixed.
const STORAGE_KEY = "farmops.electrical-ai-cache.v2";
export const ELECTRICAL_AI_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 25;

export interface CachedElectricalAnswer {
  key: string;
  scenario: string;
  question: string;
  cachedAt: number;
  answer: ElectricalAiAnswer;
}

export function cacheKey(scenario: string, question: string): string {
  return `${scenario}|${question.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

function readAll(): CachedElectricalAnswer[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CachedElectricalAnswer[];
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - ELECTRICAL_AI_CACHE_TTL_MS;
    return parsed.filter(
      (e) => e && typeof e.cachedAt === "number" && e.cachedAt > cutoff && e.answer,
    );
  } catch {
    return [];
  }
}

function writeAll(entries: CachedElectricalAnswer[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(entries.slice(0, MAX_ENTRIES)),
    );
  } catch {
    /* quota / private mode — cache is best-effort */
  }
}

/** Fresh cached answer for this question, or null when there is none. */
export function readCachedAnswer(
  scenario: string,
  question: string,
): CachedElectricalAnswer | null {
  const key = cacheKey(scenario, question);
  return readAll().find((e) => e.key === key) ?? null;
}

export function writeCachedAnswer(
  scenario: string,
  question: string,
  answer: ElectricalAiAnswer,
): CachedElectricalAnswer {
  const entry: CachedElectricalAnswer = {
    key: cacheKey(scenario, question),
    scenario,
    question: question.trim(),
    cachedAt: Date.now(),
    answer,
  };
  writeAll([entry, ...readAll().filter((e) => e.key !== entry.key)]);
  return entry;
}

export function dropCachedAnswer(scenario: string, question: string) {
  const key = cacheKey(scenario, question);
  writeAll(readAll().filter((e) => e.key !== key));
}

/** "4 minutes ago", "3 hours ago" — how stale the replayed answer is. */
export function cacheAgeLabel(cachedAt: number, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - cachedAt) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

/** Time left before the entry expires, as "expires in 21 hours". */
export function cacheExpiryLabel(cachedAt: number, now = Date.now()): string {
  const mins = Math.max(
    0,
    Math.round((cachedAt + ELECTRICAL_AI_CACHE_TTL_MS - now) / 60_000),
  );
  if (mins < 60) return `expires in ${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.round(mins / 60);
  return `expires in ${hours} hour${hours === 1 ? "" : "s"}`;
}

/** Cost label for a completed run: free on self-hosted, priced on cloud. */
export function runCostLabel(
  cost: ElectricalAiAnswer["cost"],
  backend: string,
): string {
  if (!cost || !cost.metered) return backend === "local" ? "$0.00 (self-hosted)" : "$0.00";
  const usd = cost.usd;
  const money = usd > 0 && usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
  return `${money}${cost.estimated ? " (estimated)" : ""}`;
}
