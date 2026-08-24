// Fuzzy part-name matching for the service-manual import flow.
//
// Pure and browser-safe: the server ranks inventory candidates for each part
// named by a manual, and the review UI uses the same scores to decide which
// matches need the user to confirm and which alternates to offer.

export interface PartMatchTarget {
  id: string;
  /** Display name (inventory name, or sku when unnamed). */
  label: string;
  sku?: string | null;
}

export interface PartMatchCandidate {
  id: string;
  label: string;
  /** 0-1; 1 means the names are identical after normalization. */
  score: number;
  /** Short human reason, e.g. "exact name" or "shares: oil, filter". */
  reason: string;
}

export type PartMatchConfidence = "exact" | "strong" | "weak" | "none";

export interface PartMatchOutcome {
  /** Best candidate, or null when nothing scored above the floor. */
  best: PartMatchCandidate | null;
  /** Ranked alternates including `best`, capped. */
  candidates: PartMatchCandidate[];
  confidence: PartMatchConfidence;
  /**
   * True when the user should confirm before the part is linked: a weak score,
   * or two candidates close enough that the pick is ambiguous.
   */
  needsConfirmation: boolean;
}

/** Words that carry no matching signal for farm parts. */
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "the",
  "of",
  "for",
  "with",
  "or",
  "new",
  "oem",
  "genuine",
  "part",
  "parts",
  "assembly",
  "assy",
  "kit",
  "each",
  "set",
]);

export function normalizePartName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[®™]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function partTokens(raw: string): string[] {
  return normalizePartName(raw)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/** Dice coefficient over character bigrams — cheap and typo-tolerant. */
function bigramSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const out = new Map<string, number>();
    const t = s.replace(/\s+/g, "");
    for (let i = 0; i < t.length - 1; i++) {
      const g = t.slice(i, i + 2);
      out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  let total = 0;
  let shared = 0;
  for (const [, n] of ga) total += n;
  for (const [g, n] of gb) {
    total += n;
    const have = ga.get(g);
    if (have) shared += Math.min(have, n);
  }
  if (total === 0) return 0;
  return (2 * shared) / total;
}

function scorePair(
  queryNorm: string,
  queryTokens: string[],
  target: PartMatchTarget,
): PartMatchCandidate | null {
  const label = target.label.trim();
  const norm = normalizePartName(label);
  if (!norm) return null;
  const tokens = partTokens(label);

  if (norm === queryNorm) {
    return { id: target.id, label, score: 1, reason: "exact name" };
  }

  const shared = queryTokens.filter((t) => tokens.includes(t));
  const tokenScore =
    queryTokens.length === 0 || tokens.length === 0
      ? 0
      : shared.length / Math.max(queryTokens.length, tokens.length);
  const substring =
    norm.includes(queryNorm) || queryNorm.includes(norm)
      ? Math.min(norm.length, queryNorm.length) / Math.max(norm.length, queryNorm.length)
      : 0;
  const chars = bigramSimilarity(norm, queryNorm);

  // Token overlap dominates: "engine oil filter" vs "oil filter" should beat a
  // coincidental character overlap like "air filter" vs "oil filter".
  const score = Math.min(
    0.99,
    tokenScore * 0.6 + substring * 0.25 + chars * 0.15,
  );
  if (score < 0.3) return null;

  const reason =
    shared.length > 0
      ? `shares: ${shared.slice(0, 3).join(", ")}`
      : substring > 0
        ? "name contains the other"
        : "similar spelling";
  return { id: target.id, label, score: Math.round(score * 100) / 100, reason };
}

export interface MatchPartOptions {
  /** Max alternates returned (default 5). */
  limit?: number;
  /** At or above this score a single clear winner is auto-accepted (default 0.82). */
  autoAcceptScore?: number;
  /** Two top candidates within this gap are treated as ambiguous (default 0.12). */
  ambiguityGap?: number;
}

/** Rank inventory items against one part name from a manual. */
export function matchPart(
  partName: string,
  targets: PartMatchTarget[],
  options: MatchPartOptions = {},
): PartMatchOutcome {
  const limit = options.limit ?? 5;
  const autoAccept = options.autoAcceptScore ?? 0.82;
  const gap = options.ambiguityGap ?? 0.12;

  const queryNorm = normalizePartName(partName);
  const queryTokens = partTokens(partName);
  if (queryNorm.length < 3) {
    return { best: null, candidates: [], confidence: "none", needsConfirmation: false };
  }

  const scored = targets
    .map((t) => scorePair(queryNorm, queryTokens, t))
    .filter((c): c is PartMatchCandidate => Boolean(c))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, limit);

  if (scored.length === 0) {
    return { best: null, candidates: [], confidence: "none", needsConfirmation: false };
  }

  const best = scored[0]!;
  const runnerUp = scored[1];
  const ambiguous = Boolean(runnerUp && best.score - runnerUp.score < gap);

  const confidence: PartMatchConfidence =
    best.score >= 1 ? "exact" : best.score >= autoAccept ? "strong" : "weak";

  return {
    best,
    candidates: scored,
    confidence,
    // Exact names are trusted even when a similar sibling exists; anything
    // weaker, or a near-tie, is surfaced for confirmation.
    needsConfirmation: confidence === "weak" || (confidence !== "exact" && ambiguous),
  };
}
