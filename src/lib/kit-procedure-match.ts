// Pure matching helpers: score procedure documents against a kit name so the
// kit panel can suggest "this manual probably belongs to this kit".
import { parseProcedureMeta } from "@/lib/procedure-meta";

export interface KitProcedureCandidate {
  name: string;
  content: string;
}

export interface KitProcedureSuggestion {
  name: string;
  /** 0-1 confidence. */
  score: number;
  /** Human readable why, e.g. `Asset: Ham Radio Field Deployment Kit`. */
  reason: string;
  asset: string | null;
  type: string | null;
}

export function normalizeName(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[_\-–—]/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return normalizeName(s).split(" ").filter((t) => t.length > 2);
}

/** Token overlap ratio relative to the kit name (0-1). */
function overlap(kit: string, other: string): number {
  const a = tokens(kit);
  const b = new Set(tokens(other));
  if (a.length === 0) return 0;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit += 1;
  return hit / a.length;
}

/**
 * Rank procedures for a kit. Strongest signal is an explicit `Asset:` line that
 * names the kit; next is a title that starts with the kit name (the prefix
 * convention used by generated manuals, e.g.
 * "Ham Radio Field Deployment Kit — Operator manual"); last is fuzzy token
 * overlap for renamed/abbreviated titles.
 */
export function suggestKitProcedures(
  kitName: string,
  candidates: KitProcedureCandidate[],
  opts: { minScore?: number; limit?: number } = {},
): KitProcedureSuggestion[] {
  const minScore = opts.minScore ?? 0.6;
  const limit = opts.limit ?? 12;
  const kitNorm = normalizeName(kitName);
  if (!kitNorm) return [];

  const out: KitProcedureSuggestion[] = [];
  for (const c of candidates) {
    const meta = parseProcedureMeta(c.content ?? "");
    const assetNorm = normalizeName(meta.asset ?? "");
    const titleNorm = normalizeName(c.name);

    let score = 0;
    let reason = "";

    if (assetNorm && assetNorm === kitNorm) {
      score = 1;
      reason = `Asset: ${meta.asset}`;
    } else if (assetNorm && (assetNorm.includes(kitNorm) || kitNorm.includes(assetNorm))) {
      score = 0.9;
      reason = `Asset: ${meta.asset}`;
    } else if (titleNorm === kitNorm || titleNorm.startsWith(`${kitNorm} `)) {
      score = 0.85;
      reason = "Title starts with the kit name";
    } else if (titleNorm.includes(kitNorm)) {
      score = 0.75;
      reason = "Kit name appears in the title";
    } else {
      const ratio = Math.max(overlap(kitNorm, titleNorm), assetNorm ? overlap(kitNorm, assetNorm) : 0);
      if (ratio >= 0.7) {
        score = 0.5 + ratio * 0.2;
        reason = `Similar wording (${Math.round(ratio * 100)}% of kit words)`;
      }
    }

    if (score >= minScore) {
      out.push({ name: c.name, score, reason, asset: meta.asset, type: meta.type });
    }
  }

  out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return out.slice(0, limit);
}
