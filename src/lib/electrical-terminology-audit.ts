// Terminology checker + reconciliation report for the Electrical module.
//
// Pure functions only: the scanner takes text, the CLI (scripts/terminology-check.ts)
// and the vitest suite feed it real files, and the reconciliation page renders the
// report. Nothing here writes records or renames stable IDs.

import {
  NEC_PROFILE,
  TERMINOLOGY_REGISTRY_VERSION,
  TERMS,
  prohibitedUsages,
  type TermEntry,
} from "./electrical-terminology";

/** Surfaces the checker scans, so a finding can be routed to the right owner. */
export type TerminologySurface =
  | "ui_string"
  | "tooltip"
  | "db_comment_or_enum"
  | "api_description"
  | "audit_manifest"
  | "csv_export"
  | "diagram_legend"
  | "standards_doc"
  | "ai_prompt"
  | "ai_answer";

export const SURFACE_LABEL: Record<TerminologySurface, string> = {
  ui_string: "UI strings",
  tooltip: "Tooltips and help text",
  db_comment_or_enum: "Database comments and enums",
  api_description: "API / OpenAPI descriptions",
  audit_manifest: "Audit manifests and reports",
  csv_export: "CSV headers and exports",
  diagram_legend: "Diagram legends",
  standards_doc: "Standards documentation",
  ai_prompt: "AI prompt context",
  ai_answer: "AI generated answers",
};

/** Inline escape hatch for a line that legitimately quotes a deprecated word. */
export const ALLOW_MARKER = "terminology-ok";

export interface TerminologyFinding {
  surface: TerminologySurface;
  /** File path or logical location (e.g. "assistant answer"). */
  location: string;
  line: number;
  /** The matched text as written. */
  matched: string;
  termId: string;
  canonical: string;
  instead: string;
  reason: string;
  /** aliasOnly usages are allowed in alias/search context, never in display text. */
  aliasOnly: boolean;
  severity: "error" | "warn";
}

const PROHIBITED = prohibitedUsages();

/**
 * Phrases that are themselves correct, so a deprecated word is not flagged when
 * it is the first word of one: "branch" is ambiguous, "branch circuit" is not.
 */
const ALLOWED_PHRASES: string[] = (() => {
  const deprecated = new Set(TERMS.flatMap((t) => t.deprecated.map((d) => d.usage.toLowerCase())));
  const out = new Set<string>();
  for (const t of TERMS) {
    const canonical = t.canonical.replace(/\s*\([^)]*\)/g, "").trim().toLowerCase();
    for (const phrase of [canonical, ...t.aliases.map((a) => a.toLowerCase())]) {
      if (phrase.includes(" ") && !deprecated.has(phrase)) out.add(phrase);
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
})();

/** True when the match at `index` is the start of an accepted longer phrase. */
function insideAllowedPhrase(line: string, index: number, matched: string): boolean {
  const rest = line.slice(index).toLowerCase().replace(/-/g, " ");
  return ALLOWED_PHRASES.some(
    (p) => p.length > matched.length && rest.startsWith(p.replace(/-/g, " ")),
  );
}

/** Lines that only declare aliases are not display text. */
function isAliasContext(line: string): boolean {
  return /alias|aliases|synonym|search|observed label|import header|deprecated|prohibited/i.test(
    line,
  );
}

export interface ScanOptions {
  surface: TerminologySurface;
  location: string;
  /** Treat aliasOnly hits as warnings instead of errors (used for field data). */
  aliasesAllowed?: boolean;
}

/** Scan a block of text for prohibited terminology. */
export function scanText(text: string, opts: ScanOptions): TerminologyFinding[] {
  const findings: TerminologyFinding[] = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return;
    if (isAliasContext(line)) return;
    for (const p of PROHIBITED) {
      const m = p.pattern.exec(line);
      if (!m) continue;
      if (insideAllowedPhrase(line, m.index, m[0])) continue;
      findings.push({
        surface: opts.surface,
        location: opts.location,
        line: i + 1,
        matched: m[0],
        termId: p.termId,
        canonical: p.canonical,
        instead: p.instead,
        reason: p.reason,
        aliasOnly: Boolean(p.aliasOnly),
        severity: p.aliasOnly && opts.aliasesAllowed ? "warn" : "error",
      });
    }
  });
  return findings;
}

/** Scan an AI answer before it is shown, so generated text obeys the registry. */
export function scanAiAnswer(answer: string): TerminologyFinding[] {
  return scanText(answer, { surface: "ai_answer", location: "assistant answer" });
}

/** Scan CSV headers (one row) — headers are display text for the reader. */
export function scanCsvHeaders(header: string, location: string): TerminologyFinding[] {
  return scanText(header, { surface: "csv_export", location, aliasesAllowed: true });
}

export function findingsBySurface(
  findings: TerminologyFinding[],
): Record<string, TerminologyFinding[]> {
  const out: Record<string, TerminologyFinding[]> = {};
  for (const f of findings) (out[f.surface] ??= []).push(f);
  return out;
}

export function errorCount(findings: TerminologyFinding[]): number {
  return findings.filter((f) => f.severity === "error").length;
}

// ------------------------------------------------------------ reconciliation

export type MigrationImpact =
  /** Wording already matches the registry. */
  | "none"
  /** Display text only — no records, IDs or columns change. */
  | "display_only"
  /** Display text plus tooltip/help additions. */
  | "display_and_help"
  /** Needs a human decision because meaning, not wording, is at stake. */
  | "needs_review";

export interface ReconciliationRow {
  termId: string;
  currentTerms: string[];
  proposedCanonical: string;
  necStatus: string;
  sourceReference: string;
  affectedScreens: string[];
  affectedFields: string[];
  migrationImpact: MigrationImpact;
  notes: string;
}

function necStatus(t: TermEntry): string {
  if (t.classification === "NEC_DEFINED") return "NEC-defined";
  if (t.classification === "NEC_USAGE") return "NEC usage (not a definition)";
  return "FarmOps operational — not NEC-defined";
}

function impactFor(t: TermEntry): MigrationImpact {
  if (t.id === "individual_branch_circuit") return "needs_review";
  if (t.deprecated.length === 0) return t.classification === "NEC_DEFINED" ? "none" : "display_and_help";
  return t.deprecated.some((d) => d.aliasOnly) ? "display_only" : "display_and_help";
}

function notesFor(t: TermEntry): string {
  const bits: string[] = [];
  if (t.classification === "FARMOPS_OPERATIONAL") {
    bits.push("Operational term may remain; tooltip must state the NEC relationship.");
  }
  if (t.deprecated.some((d) => d.aliasOnly)) {
    bits.push(
      `Retain as searchable alias only: ${t.deprecated
        .filter((d) => d.aliasOnly)
        .map((d) => d.usage)
        .join(", ")}.`,
    );
  }
  if (t.id === "individual_branch_circuit") {
    bits.push(
      "Display only when recorded topology shows a single item of utilization equipment; " +
        "'dedicated circuit' must not be auto-translated.",
    );
  }
  bits.push("Stable IDs are unchanged by any display term change.");
  return bits.join(" ");
}

/**
 * Every current Electrical-module term with its proposed canonical term, NEC
 * status, source reference, affected screens and migration impact.
 */
export function reconciliationReport(): ReconciliationRow[] {
  return TERMS.map((t) => ({
    termId: t.id,
    currentTerms: [t.canonical, ...t.aliases, ...t.deprecated.map((d) => d.usage)],
    proposedCanonical: t.canonical,
    necStatus: necStatus(t),
    sourceReference:
      t.necReference && t.necEdition
        ? `${t.necEdition} — ${t.necReference}`
        : "FarmOps registry " + TERMINOLOGY_REGISTRY_VERSION,
    affectedScreens: t.affects.ui ?? [],
    affectedFields: [
      ...(t.affects.db ?? []),
      ...(t.affects.api ?? []),
      ...(t.affects.export ?? []),
    ],
    migrationImpact: impactFor(t),
    notes: notesFor(t),
  }));
}

export const RECONCILIATION_CSV_COLUMNS = [
  { key: "termId", label: "FarmOps identifier" },
  { key: "proposedCanonical", label: "Proposed canonical term" },
  { key: "necStatus", label: "NEC status" },
  { key: "sourceReference", label: "Source reference" },
  { key: "currentTerms", label: "Current terms and aliases" },
  { key: "affectedScreens", label: "Affected screens" },
  { key: "affectedFields", label: "Affected fields" },
  { key: "migrationImpact", label: "Migration impact" },
  { key: "notes", label: "Notes" },
] as const;

/** Human review gate: terminology changes are never applied globally by a job. */
export const REVIEW_GATE = {
  requiresHumanReview: true,
  reviewer: "Owner or licensed electrician of record",
  statement:
    "This report is a proposal. Terminology changes are applied screen by screen after human " +
    "review; no automated process rewrites stored records, labels or stable IDs.",
  necNotice: NEC_PROFILE.notice,
} as const;
