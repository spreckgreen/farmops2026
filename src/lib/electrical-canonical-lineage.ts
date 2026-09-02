// Phase 4.4d — canonical baseline lineage (append-only, client-side).
//
// A candidate revision starts as PROPOSED_CANONICAL_REVISION. Promotion to
// CURRENT_CANONICAL_BASELINE happens only through an explicit owner approval
// after reviewing the candidate SHA, the cell diff and the complete validation
// results. Promotion RETIRES the previous baseline as
// RETIRED_SUPERSEDED_BASELINE — it is never deleted, and every prior entry is
// preserved so the lineage chain stays readable end to end.
import {
  PHASE_44A_BASELINE_SHA256,
  PHASE_44A_BASELINE_ODS_FILE,
} from "@/lib/electrical-adjudication-baseline";
import {
  REVISION_STATUS_PROMOTED,
  REVISION_STATUS_PROPOSED,
  REVISION_STATUS_SUPERSEDED,
} from "@/lib/electrical-ods-revision";

export type LineageStatus =
  | typeof REVISION_STATUS_PROPOSED
  | typeof REVISION_STATUS_PROMOTED
  | typeof REVISION_STATUS_SUPERSEDED;

export interface LineageEntry {
  sha256: string;
  file_name: string;
  status: LineageStatus;
  /** SHA this revision descends from, or null for the original baseline. */
  parent_sha256: string | null;
  recorded_at: string;
  /** Owner approval note recorded at promotion time. */
  approved_by: string | null;
  approved_at: string | null;
  notes: string | null;
}

const STORAGE_KEY = "farmops:electrical:canonical-lineage";

export const ORIGINAL_BASELINE_ENTRY: LineageEntry = {
  sha256: PHASE_44A_BASELINE_SHA256,
  file_name: PHASE_44A_BASELINE_ODS_FILE,
  status: REVISION_STATUS_PROMOTED,
  parent_sha256: null,
  recorded_at: "2026-09-01T00:00:00.000Z",
  approved_by: "Phase 4.4a baseline confirmation",
  approved_at: "2026-09-01T00:00:00.000Z",
  notes: "Confirmed Phase 4.4a canonical baseline. Preserved permanently.",
};

function read(): LineageEntry[] {
  if (typeof localStorage === "undefined") return [ORIGINAL_BASELINE_ENTRY];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as LineageEntry[]) : [];
    const entries = Array.isArray(parsed) ? parsed.filter((e) => e?.sha256) : [];
    return entries.some((e) => e.sha256 === PHASE_44A_BASELINE_SHA256)
      ? entries
      : [ORIGINAL_BASELINE_ENTRY, ...entries];
  } catch {
    return [ORIGINAL_BASELINE_ENTRY];
  }
}

function write(entries: LineageEntry[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Lineage mirroring is best-effort; the report itself carries the chain.
  }
}

export function canonicalLineage(): LineageEntry[] {
  return read();
}

export function currentCanonicalBaselineSha(): string {
  const promoted = read().filter((e) => e.status === REVISION_STATUS_PROMOTED);
  return promoted[promoted.length - 1]?.sha256 ?? PHASE_44A_BASELINE_SHA256;
}

/** Record a generated candidate. Nothing is promoted or retired here. */
export function recordProposedRevision(input: {
  sha256: string;
  file_name: string;
  parent_sha256: string;
  notes?: string;
}): LineageEntry[] {
  const entries = read();
  if (entries.some((e) => e.sha256 === input.sha256)) return entries;
  const next: LineageEntry[] = [
    ...entries,
    {
      sha256: input.sha256,
      file_name: input.file_name,
      status: REVISION_STATUS_PROPOSED,
      parent_sha256: input.parent_sha256,
      recorded_at: new Date().toISOString(),
      approved_by: null,
      approved_at: null,
      notes: input.notes ?? null,
    },
  ];
  write(next);
  return next;
}

export type PromotionResult =
  | { ok: true; entries: LineageEntry[] }
  | { ok: false; reason: string };

/**
 * Explicit owner promotion. The candidate must already be recorded as
 * PROPOSED_CANONICAL_REVISION and must have passed acceptance and validation
 * review — the caller supplies that confirmation, which is why this is a
 * separate action and never a side effect of generation.
 */
export function promoteCandidate(input: {
  candidate_sha256: string;
  approved_by: string;
  acceptance_passed: boolean;
  validation_passed: boolean;
  notes?: string;
}): PromotionResult {
  if (!input.acceptance_passed) {
    return { ok: false, reason: "The candidate diff has not passed acceptance (2 / 0 / 0)." };
  }
  if (!input.validation_passed) {
    return {
      ok: false,
      reason: "The full Phase 4.4 validation of the candidate has not passed review.",
    };
  }
  if (!input.approved_by.trim()) {
    return { ok: false, reason: "An owner approval name is required." };
  }
  const entries = read();
  const candidate = entries.find((e) => e.sha256 === input.candidate_sha256);
  if (!candidate) {
    return { ok: false, reason: "That candidate revision is not recorded in the lineage." };
  }
  if (candidate.status === REVISION_STATUS_PROMOTED) {
    return { ok: false, reason: "That revision is already the current canonical baseline." };
  }
  const now = new Date().toISOString();
  const next = entries.map((e) => {
    if (e.sha256 === input.candidate_sha256) {
      return {
        ...e,
        status: REVISION_STATUS_PROMOTED as LineageStatus,
        approved_by: input.approved_by.trim(),
        approved_at: now,
        notes: input.notes ?? e.notes,
      };
    }
    if (e.status === REVISION_STATUS_PROMOTED) {
      return { ...e, status: REVISION_STATUS_SUPERSEDED as LineageStatus };
    }
    return e;
  });
  write(next);
  return { ok: true, entries: next };
}

/** Readable lineage chain, e.g. "89da43…7388 → 4f21…". */
export function lineageChain(entries: LineageEntry[] = read()): string {
  return entries.map((e) => `${e.sha256.slice(0, 6)}…${e.sha256.slice(-4)}`).join(" → ");
}
