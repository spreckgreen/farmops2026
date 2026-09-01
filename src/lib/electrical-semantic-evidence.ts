// Phase 4.4b — affirmative semantic provenance (READ-ONLY helpers).
//
// A numeric coincidence is never provenance. These helpers answer one question:
// does a traceable citation actually *state* the semantic concept a
// classification would rely on (overcurrent protection, or the nominal-supply /
// equipment-nameplate distinction)? Shared by the load semantic review and the
// final adjudication report so both apply the same gate.

/**
 * Affirmative semantic provenance available for one load. Every field is a
 * citation the reviewer can follow; an absent field means "not established" and
 * is never substituted with an inference.
 */
export interface SemanticEvidence {
  /** A mapped OCP / breaker rating field on the load or its circuit. */
  ocp_field?: string | null;
  /** Equipment specification / nameplate documentation. */
  equipment_spec?: string | null;
  /** Canonical workbook notes or design documentation. */
  canonical_notes?: string | null;
  /** An explicit FarmOps OCP relationship (breaker position, circuit group OCP). */
  farmops_ocp_relationship?: string | null;
  /** Any other traceable source evidence (field observation, photo, RFI). */
  other_source_evidence?: string | null;
}

export interface EvidenceCitation {
  source: string;
  detail: string;
}

const CITATION_SOURCES: { key: keyof SemanticEvidence; source: string }[] = [
  { key: "ocp_field", source: "Mapped OCP / breaker field" },
  { key: "equipment_spec", source: "Equipment specification" },
  { key: "canonical_notes", source: "Canonical notes / design documentation" },
  { key: "farmops_ocp_relationship", source: "FarmOps OCP relationship" },
  { key: "other_source_evidence", source: "Other traceable source evidence" },
];

export function evidenceCitations(e: SemanticEvidence | undefined): EvidenceCitation[] {
  if (!e) return [];
  return CITATION_SOURCES.flatMap(({ key, source }) => {
    const detail = (e[key] ?? "").toString().trim();
    return detail ? [{ source, detail }] : [];
  });
}

const OCP_WORDS =
  /\b(ocp|over[- ]?current|breaker|circuit protection|circuit sizing|feeder sizing|fuse|max(?:imum)? overcurrent|mocp)\b/i;

const CONCEPT_WORDS =
  /\b(nameplate|rated voltage|rating plate|utilization voltage|nominal (?:system|supply))\b/i;

/**
 * True only when a citation affirmatively states that a value represents
 * overcurrent protection / circuit sizing. A number equal to a standard breaker
 * size never satisfies this.
 */
export function hasOcpProvenance(e: SemanticEvidence | undefined): boolean {
  // A mapped OCP/breaker field is by definition an OCP statement; any other
  // citation must actually name overcurrent protection or circuit sizing. A bare
  // circuit-group reference is a relationship, not an OCP semantic.
  return evidenceCitations(e).some(
    (c) => c.source === "Mapped OCP / breaker field" || OCP_WORDS.test(c.detail),
  );
}

/**
 * True only when a citation affirmatively establishes the nominal-supply vs
 * equipment-nameplate distinction. Arithmetic compatibility is not enough.
 */
export function hasVoltageConceptProvenance(e: SemanticEvidence | undefined): boolean {
  return evidenceCitations(e).some((c) => CONCEPT_WORDS.test(c.detail));
}

/** Placeholder text ("TBD", "No", "0%") is not provenance. */
export function meaningfulCitation(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  return /^(tbd|n\/?a|none|no|unknown|0%?|—|-)$/i.test(s) ? null : s;
}
