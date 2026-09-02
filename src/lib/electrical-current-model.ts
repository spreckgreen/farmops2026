// Phase 4.4b — Additive electrical-current semantic model.
//
// The canonical `loads.Amps` closure analysis concluded
// SEMANTICALLY_OVERLOADED_LEGACY_FIELD. This module defines the additive
// FarmOps current model that preserves each distinct engineering quantity in
// its own field while leaving `electrical_loads.amps` byte-for-byte unchanged.
//
// Hard rules encoded here (enforced by tests):
//  - No semantic field is ever backfilled from legacy `amps`.
//  - Numeric equality with a manufacturer value is NOT provenance.
//  - MCA is never derived; MOCP is never inferred from breaker size;
//    load current is never inferred from VA arithmetic.
//  - Legacy values never move out of `amps`.

/** The eight established current concepts. Nothing else is admissible. */
export const AMPS_SEMANTICS = [
  "CONNECTED_LOAD_CURRENT",
  "EQUIPMENT_FLA",
  "RATED_CURRENT",
  "RLA",
  "MCA",
  "MOCP",
  "INSTALLED_OCP_RATING",
  "DESIGN_CIRCUIT_AMPACITY",
] as const;

export type AmpsSemantic = (typeof AMPS_SEMANTICS)[number];

export const AMPS_SEMANTIC_LABELS: Record<AmpsSemantic, string> = {
  CONNECTED_LOAD_CURRENT: "Connected load current",
  EQUIPMENT_FLA: "Equipment FLA",
  RATED_CURRENT: "Rated current (RCA)",
  RLA: "Rated load amps (RLA)",
  MCA: "Minimum circuit ampacity (MCA)",
  MOCP: "Maximum overcurrent protection (MOCP)",
  INSTALLED_OCP_RATING: "Installed OCP rating",
  DESIGN_CIRCUIT_AMPACITY: "Design circuit ampacity",
};

/** Semantic field → the column that holds that quantity. */
export const SEMANTIC_COLUMN: Record<AmpsSemantic, string> = {
  CONNECTED_LOAD_CURRENT: "connected_load_current",
  EQUIPMENT_FLA: "equipment_fla",
  RATED_CURRENT: "rated_current_amps",
  RLA: "rated_load_amps",
  MCA: "minimum_circuit_ampacity",
  MOCP: "maximum_overcurrent_protection",
  INSTALLED_OCP_RATING: "installed_ocp_rating",
  DESIGN_CIRCUIT_AMPACITY: "design_circuit_ampacity",
};

export const SEMANTIC_COLUMNS = Object.values(SEMANTIC_COLUMN);

export const LEGACY_AMPS_COLUMN = "amps";

/** Row shape used by the per-load UI section. */
export interface CurrentSemanticRow {
  semantic: AmpsSemantic;
  label: string;
  column: string;
  value: number | null;
  provenance: string | null;
}

export interface LoadCurrentSemanticsView {
  /** Legacy scalar, exactly as stored. Never rewritten. */
  legacyAmps: number | null;
  /** Proven meaning of the legacy scalar, or null when unresolved. */
  legacySemantic: AmpsSemantic | null;
  legacyProvenance: string | null;
  /** True when a legacy value exists but its meaning is not established. */
  legacyUnresolved: boolean;
  rows: CurrentSemanticRow[];
}

const num = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;

const str = (v: unknown): string | null =>
  v === null || v === undefined || String(v).trim() === "" ? null : String(v);

const isSemantic = (v: unknown): v is AmpsSemantic =>
  typeof v === "string" && (AMPS_SEMANTICS as readonly string[]).includes(v);

/**
 * A legacy amps value only counts as semantically resolved when BOTH the
 * semantic enum and a provenance statement are present. A bare enum without
 * provenance stays "semantic unresolved".
 */
export function legacySemanticResolved(record: Record<string, unknown>): boolean {
  return isSemantic(record["amps_semantic"]) && str(record["amps_semantic_provenance"]) !== null;
}

export function loadCurrentSemantics(
  record: Record<string, unknown>,
  provenanceByColumn: Record<string, string | null> = {},
): LoadCurrentSemanticsView {
  const legacyAmps = num(record[LEGACY_AMPS_COLUMN]);
  const resolved = legacySemanticResolved(record);
  const legacySemantic = resolved ? (record["amps_semantic"] as AmpsSemantic) : null;

  return {
    legacyAmps,
    legacySemantic,
    legacyProvenance: resolved ? str(record["amps_semantic_provenance"]) : null,
    legacyUnresolved: legacyAmps !== null && !resolved,
    rows: AMPS_SEMANTICS.map((semantic) => {
      const column = SEMANTIC_COLUMN[semantic];
      return {
        semantic,
        label: AMPS_SEMANTIC_LABELS[semantic],
        column,
        value: num(record[column]),
        provenance:
          provenanceByColumn[column] ??
          (legacySemantic === semantic ? str(record["amps_semantic_provenance"]) : null),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Bryant manufacturer provenance (FS-082 / FS-083 / FS-084)
// ---------------------------------------------------------------------------

/**
 * Manufacturer-supported quantities only. MCA is deliberately NULL: it is not
 * printed on the supplied documentation and must never be derived. These values
 * are never written into legacy `amps`.
 */
export const BRYANT_MANUFACTURER_CURRENTS = {
  maximum_overcurrent_protection: 25,
  rated_current_amps: 1.69,
  rated_load_amps: 4.15,
  minimum_circuit_ampacity: null,
} as const;

export const BRYANT_PROVENANCE =
  "Bryant 37MARAQ24AA3 / D5MAHAQ24XA manufacturer documentation (nameplate/specification screenshot). Manufacturer-supported quantities only; MCA not printed and not derived.";

export const BRYANT_STABLE_IDS = ["FS-082", "FS-083", "FS-084"] as const;

/**
 * The exact additive patch permitted for a Bryant load. Returns only the
 * manufacturer semantic fields — never `amps`, `amps_semantic` or any derived
 * quantity, because the manufacturer document does not establish what the
 * legacy scalar was meant to hold.
 */
export function bryantSemanticPatch(stableId: string): Record<string, number> | null {
  if (!(BRYANT_STABLE_IDS as readonly string[]).includes(stableId)) return null;
  return {
    maximum_overcurrent_protection: BRYANT_MANUFACTURER_CURRENTS.maximum_overcurrent_protection,
    rated_current_amps: BRYANT_MANUFACTURER_CURRENTS.rated_current_amps,
    rated_load_amps: BRYANT_MANUFACTURER_CURRENTS.rated_load_amps,
  };
}

// ---------------------------------------------------------------------------
// Still-open current-semantics findings
// ---------------------------------------------------------------------------

export interface OpenCurrentSemanticsFinding {
  id: string;
  stableId: string;
  system: "canonical_ods" | "farmops";
  value: number;
  classification: string;
  requires: string;
}

/** These four remain OPEN; the additive model does not close them. */
export const OPEN_CURRENT_SEMANTICS_FINDINGS: OpenCurrentSemanticsFinding[] = [
  {
    id: "CSU-01",
    stableId: "FS-082",
    system: "canonical_ods",
    value: 0,
    classification: "CURRENT_SEMANTICS_UNRESOLVED",
    requires:
      "Source definition of what canonical Amps = 0 asserts for this Bryant installation. Bryant RCA/RLA/MOCP do not explain a zero and must not be substituted.",
  },
  {
    id: "CSU-02",
    stableId: "FS-083",
    system: "canonical_ods",
    value: 0,
    classification: "CURRENT_SEMANTICS_UNRESOLVED",
    requires:
      "Same as FS-082 — canonical zero origin must be established from the workbook or design source before any semantic is assigned.",
  },
  {
    id: "CSU-03",
    stableId: "FS-084",
    system: "canonical_ods",
    value: 60,
    classification: "LEGACY_VALUE_SOURCE_UNKNOWN",
    requires:
      "Canonical evidence for 60 A (design ampacity vs installed OCP vs legacy carry-over). Derived 14,400 VA and Bryant MOCP 25 A are excluded as evidence.",
  },
  {
    id: "CSU-04",
    stableId: "FS-084",
    system: "farmops",
    value: 25,
    classification: "NUMERIC_VALUE_WITH_UNRESOLVED_SEMANTICS",
    requires:
      "Field/record evidence for the FarmOps 25 A entry. Equality with Bryant MOCP 25 A is numeric coincidence, not provenance.",
  },
];

// ---------------------------------------------------------------------------
// Comparison guard — like concepts only
// ---------------------------------------------------------------------------

export type CurrentComparability =
  | { comparable: true; concept: AmpsSemantic | "legacy_amps" }
  | { comparable: false; reason: string };

/**
 * Numeric Semantics and Phase 4.5 convergence may only compare like concepts.
 * A legacy scalar is comparable to a manufacturer semantic field only when its
 * own semantic has been proven to be that same concept.
 */
export function currentComparability(
  left: { column: string; semantic?: AmpsSemantic | null; provenance?: string | null },
  right: { column: string; semantic?: AmpsSemantic | null; provenance?: string | null },
): CurrentComparability {
  const conceptOf = (side: typeof left): AmpsSemantic | "legacy_amps" | null => {
    if (side.column === LEGACY_AMPS_COLUMN) {
      return side.semantic && str(side.provenance) ? side.semantic : "legacy_amps";
    }
    const entry = AMPS_SEMANTICS.find((s) => SEMANTIC_COLUMN[s] === side.column);
    return entry ?? null;
  };

  const a = conceptOf(left);
  const b = conceptOf(right);
  if (a === null || b === null)
    return { comparable: false, reason: "Field is not part of the current model." };
  if (a === "legacy_amps" && b === "legacy_amps") return { comparable: true, concept: "legacy_amps" };
  if (a === "legacy_amps" || b === "legacy_amps")
    return {
      comparable: false,
      reason:
        "Legacy amps has no proven semantic — it may not be compared to a manufacturer MOCP/RLA/RCA field (semantic unresolved).",
    };
  if (a !== b)
    return { comparable: false, reason: `Different concepts: ${a} vs ${b}. Comparison suppressed.` };
  return { comparable: true, concept: a };
}
