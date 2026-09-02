// Phase 4.4b — Current-semantics closure plan (READ-ONLY).
//
// Question answered here: is the canonical workbook's unqualified `Amps` column
// intended to carry ONE consistent electrical concept, or has it historically
// been overloaded across several concepts?
//
// Method: every canonical load row in the SHA-bound workbook is given a *usage
// signature* derived only from evidence that already exists (the row's own
// arithmetic, FarmOps text, linked equipment provenance). Each of the eight
// candidate meanings is then scored across the whole population as supporting
// rows vs contradictory rows.
//
// Hard rules encoded here:
//   * no writes, no ODS edits, no numeric corrections — planning output only;
//   * numeric coincidence is never provenance and never raises confidence;
//   * MOCP is never read as a load current, MCA is never derived;
//   * no Bryant value is assigned into a target semantic field unless
//     provenance actually supports that meaning — the Bryant rows therefore
//     carry no proposed assignment;
//   * the closure plan states, explicitly, what must become true before
//     FS-082 / FS-083 / FS-084 may leave CURRENT_SEMANTICS_UNRESOLVED.
import {
  baselineLabel,
  type AdjudicationBaseline,
  type CanonicalOdsLoadValues,
} from "@/lib/electrical-adjudication-baseline";
import { equipmentFor } from "@/lib/electrical-equipment-provenance";
import { vaDerivation, type VaBasis } from "@/lib/electrical-amp-semantics";
import {
  CURRENT_SEMANTIC_SCHEMA,
  CURRENT_SEMANTIC_LABELS,
  CONFIDENCE_LABELS,
  type CurrentSemanticField,
  type SemanticConfidence,
} from "@/lib/electrical-current-semantic-migration";
import type { FarmOpsLoadRow } from "@/lib/electrical-load-adjudication-production";

export const CURRENT_CLOSURE_VERSION = "4.4b-current-semantics-closure-1";

/** Loads whose current semantics are under adjudication and must always appear. */
export const CLOSURE_FIXTURE_IDS = ["FS-082", "FS-083", "FS-084"] as const;

/* ------------------------------------------------------------------ *
 * Per-row usage signature
 * ------------------------------------------------------------------ */

export type AmpUsageSignature =
  /** Amps is consumed as the operand of the row's Connected VA product. */
  | "USED_AS_VA_OPERAND"
  /** Amps is present but the row's VA does not follow from it. */
  | "PRESENT_NOT_USED_IN_VA"
  /** Amps is 0 while the row describes operating equipment. */
  | "ZERO_WITH_NO_ZERO_LOAD_PROVENANCE"
  /** Amps exceeds every published equipment current for the linked equipment. */
  | "EXCEEDS_PUBLISHED_EQUIPMENT_CURRENTS"
  /** Amps equals a published protective-device rating (MOCP) and nothing else. */
  | "EQUALS_PUBLISHED_PROTECTION_RATING"
  /** Amps equals a published equipment current (RCA / RLA / FLA). */
  | "EQUALS_PUBLISHED_EQUIPMENT_CURRENT"
  /** FarmOps text explicitly states which concept the value is. */
  | "CONCEPT_STATED_BY_PROVENANCE"
  /** No amps value at all. */
  | "NO_VALUE";

export const USAGE_SIGNATURE_LABELS: Record<AmpUsageSignature, string> = {
  USED_AS_VA_OPERAND:
    "Consumed as the operand of the row's Connected VA product — the workbook uses it as a load current here",
  PRESENT_NOT_USED_IN_VA:
    "Present, but the row's Connected VA does not follow from it — the workbook is not using it as the VA current",
  ZERO_WITH_NO_ZERO_LOAD_PROVENANCE:
    "Zero, with no provenance establishing a verified zero-load condition — no concept legitimately holds 0 for operating equipment",
  EXCEEDS_PUBLISHED_EQUIPMENT_CURRENTS:
    "Larger than every published equipment current for the linked equipment — inconsistent with an equipment-current concept",
  EQUALS_PUBLISHED_PROTECTION_RATING:
    "Numerically equal to the published MOCP and to no equipment current — recorded as a coincidence, not as provenance",
  EQUALS_PUBLISHED_EQUIPMENT_CURRENT:
    "Numerically equal to a published equipment current — recorded as a coincidence, not as provenance",
  CONCEPT_STATED_BY_PROVENANCE: "A source explicitly states which current concept this value is",
  NO_VALUE: "No canonical amps value is present",
};

export interface ClosureRowSignature {
  stable_id: string;
  description: string;
  worksheet: string | null;
  worksheet_row: number | null;
  ods_volts: number | null;
  ods_amps: number | null;
  ods_va: number | null;
  farmops_amps: number | null;
  va_basis: VaBasis;
  signatures: AmpUsageSignature[];
  equipment_model: string | null;
  is_fixture: boolean;
  /** Populated only when provenance states a concept. Never a guess. */
  stated_concept: CurrentSemanticField | null;
  note: string;
}

/* ------------------------------------------------------------------ *
 * Candidate evaluation
 * ------------------------------------------------------------------ */

export interface CandidateEvaluation {
  candidate: CurrentSemanticField;
  label: string;
  /** Rows where evidence positively supports this reading of the column. */
  supporting_rows: string[];
  supporting_basis: string;
  /** Rows where evidence positively rules this reading out. */
  contradictory_rows: string[];
  contradictory_basis: string;
  /** Rows merely numerically consistent — never counted as support. */
  coincident_rows: string[];
  confidence: SemanticConfidence;
  migration_impact: string;
  /** True when the candidate could still be the column-wide meaning. */
  viable_as_column_meaning: boolean;
}

export type ColumnSemanticVerdict =
  | "SINGLE_CONCEPT_ESTABLISHED"
  | "SINGLE_CONCEPT_PROBABLE_UNCORROBORATED"
  | "SEMANTICALLY_OVERLOADED_LEGACY_FIELD"
  | "SEMANTICS_UNDETERMINED_INSUFFICIENT_EVIDENCE";

export const VERDICT_LABELS: Record<ColumnSemanticVerdict, string> = {
  SINGLE_CONCEPT_ESTABLISHED:
    "One concept is established for the whole column by explicit provenance",
  SINGLE_CONCEPT_PROBABLE_UNCORROBORATED:
    "One concept is probable for the whole column, but no source states it",
  SEMANTICALLY_OVERLOADED_LEGACY_FIELD:
    "Semantically overloaded legacy field — different rows use the column for mutually exclusive concepts",
  SEMANTICS_UNDETERMINED_INSUFFICIENT_EVIDENCE:
    "Undetermined — the available evidence neither establishes one concept nor demonstrates overloading",
};

/** One additive schema element recommended to preserve distinct concepts. */
export interface AdditiveSchemaRecommendation {
  element: string;
  purpose: string;
  /** Why existing consumers keep working when this is added. */
  consumer_safety: string;
  required_now: boolean;
  why_required_now: string;
}

/** Exit criteria for a load still held at CURRENT_SEMANTICS_UNRESOLVED. */
export interface ClosureExitCriteria {
  stable_id: string;
  current_disposition: string;
  /** Every statement that must become true. All of them, not any of them. */
  must_become_true: string[];
  /** Proposed target assignment — null while provenance does not support one. */
  proposed_target_field: CurrentSemanticField | null;
  why_no_assignment: string;
}

export interface CurrentSemanticsClosurePlan {
  version: string;
  generated_at: string;
  workbook_name: string;
  workbook_sha256: string;
  is_phase_44a_baseline: boolean;
  baseline_label: string;
  /** Population the conventions were read from. */
  rows_examined: number;
  rows_with_amps: number;
  rows_with_stated_concept: number;
  signatures: ClosureRowSignature[];
  candidates: CandidateEvaluation[];
  verdict: ColumnSemanticVerdict;
  verdict_rationale: string;
  /** Distinct, mutually exclusive usages observed in the same column. */
  conflicting_usages: string[];
  additive_schema: AdditiveSchemaRecommendation[];
  minimum_additive_schema_summary: string;
  exit_criteria: ClosureExitCriteria[];
  invariants: string[];
  read_only: true;
  apply_available: false;
  ods_edit_authorized: false;
  farmops_write_authorized: false;
  numeric_corrections_authorized: false;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const near = (a: number | null, b: number | null) =>
  a !== null && b !== null && Math.abs(a - b) < 0.5;

const isZero = (v: number | null) => v !== null && Math.abs(v) < 1e-9;

/** Placeholder text is not provenance. */
function realText(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  return /^(tbd|n\/?a|none|no|unknown|0%?|—|-|0\.00|0)$/i.test(s) ? null : s;
}

/** Does FarmOps text explicitly state one of the eight concepts? */
export function statedTargetField(fp: FarmOpsLoadRow | undefined): CurrentSemanticField | null {
  const text = [realText(fp?.notes), realText(fp?.source_reference)].filter(Boolean).join(" · ");
  if (!text) return null;
  if (/\b(mocp|maximum overcurrent)\b/i.test(text)) return "maximum_overcurrent_protection";
  if (/\b(installed breaker|breaker rating|installed ocp)\b/i.test(text)) return "installed_ocp_rating";
  if (/\bmca\b|minimum circuit ampacity/i.test(text)) return "minimum_circuit_ampacity";
  if (/\brla\b|rated load amps/i.test(text)) return "rated_load_amps";
  if (/\brca\b|rated current amps/i.test(text)) return "rated_current_amps";
  if (/\bfla\b|full[- ]load amps/i.test(text)) return "equipment_fla";
  if (/design (circuit )?ampacity/i.test(text)) return "design_circuit_ampacity";
  if (/\b(connected load current|measured current|running current in service)\b/i.test(text))
    return "connected_load_current";
  return null;
}

/** Does FarmOps text establish a verified zero-load condition? */
function zeroLoadEstablished(fp: FarmOpsLoadRow | undefined): boolean {
  const text = [realText(fp?.notes), realText(fp?.source_reference)].filter(Boolean).join(" · ");
  return Boolean(text) && /\b(zero load|not energized|de-?energized|spare|removed|abandoned)\b/i.test(text);
}

function signatureFor(input: {
  ods: CanonicalOdsLoadValues;
  fp: FarmOpsLoadRow | undefined;
}): ClosureRowSignature {
  const { ods, fp } = input;
  const eq = equipmentFor(ods.stable_id);
  const m = {
    mocp: eq?.semantics.maximum_overcurrent_protection ?? null,
    rca: eq?.semantics.rated_current_amps ?? null,
    rla: eq?.semantics.rated_load_amps ?? null,
    fla: eq?.semantics.equipment_fla ?? null,
  };
  const va = vaDerivation(ods.volts, ods.amps, ods.connected_va);
  const stated = statedTargetField(fp);
  const signatures: AmpUsageSignature[] = [];
  const notes: string[] = [];

  if (ods.amps === null) {
    signatures.push("NO_VALUE");
    notes.push("No canonical amps value, so this row contributes no convention evidence.");
  } else if (isZero(ods.amps) && !zeroLoadEstablished(fp)) {
    signatures.push("ZERO_WITH_NO_ZERO_LOAD_PROVENANCE");
    notes.push(
      "A zero here cannot be read as any of the eight concepts: it is neither a stated zero-load condition nor a possible protective-device or ampacity rating.",
    );
  } else {
    if (va.basis === "derived_volts_times_amps") {
      signatures.push("USED_AS_VA_OPERAND");
      notes.push(
        `Connected VA equals ${ods.volts} × ${ods.amps}, so within this row the workbook consumes the amps value as a current for a VA product.`,
      );
    } else if (va.basis === "not_derived_from_volts_times_amps") {
      signatures.push("PRESENT_NOT_USED_IN_VA");
      notes.push(
        `Connected VA (${ods.connected_va}) does not equal ${ods.volts} × ${ods.amps}, so this row does not use the amps value as its VA current.`,
      );
    }
    const currents = [m.rca, m.rla, m.fla].filter((v): v is number => v !== null);
    if (currents.length && ods.amps > Math.max(...currents) + 0.5) {
      signatures.push("EXCEEDS_PUBLISHED_EQUIPMENT_CURRENTS");
      notes.push(
        `${ods.amps} A exceeds every published equipment current for ${
          eq?.model ?? "the linked equipment"
        } (max ${Math.max(...currents)} A).`,
      );
    }
    if (near(m.rca, ods.amps) || near(m.rla, ods.amps) || near(m.fla, ods.amps)) {
      signatures.push("EQUALS_PUBLISHED_EQUIPMENT_CURRENT");
      notes.push("Numerically equal to a published equipment current — coincidence, not provenance.");
    } else if (near(m.mocp, ods.amps)) {
      signatures.push("EQUALS_PUBLISHED_PROTECTION_RATING");
      notes.push(
        `Numerically equal to the published MOCP (${m.mocp} A) and to no equipment current — coincidence, not provenance; MOCP is never read as a load current.`,
      );
    }
  }
  if (stated) {
    signatures.push("CONCEPT_STATED_BY_PROVENANCE");
    notes.push(`Provenance states the concept: ${CURRENT_SEMANTIC_LABELS[stated]}.`);
  }

  return {
    stable_id: ods.stable_id,
    description: ods.description,
    worksheet: ods.worksheet,
    worksheet_row: ods.row,
    ods_volts: ods.volts,
    ods_amps: ods.amps,
    ods_va: ods.connected_va,
    farmops_amps: fp?.amps ?? null,
    va_basis: va.basis,
    signatures,
    equipment_model: eq?.model ?? fp?.equipment_model ?? null,
    is_fixture: (CLOSURE_FIXTURE_IDS as readonly string[]).includes(ods.stable_id),
    stated_concept: stated,
    note: notes.join(" "),
  };
}

const has = (r: ClosureRowSignature, s: AmpUsageSignature) => r.signatures.includes(s);

/** Per-candidate support / contradiction rules over the observed population. */
function evaluateCandidate(
  candidate: CurrentSemanticField,
  rows: ClosureRowSignature[],
): CandidateEvaluation {
  const spec = CURRENT_SEMANTIC_SCHEMA.find((s) => s.field === candidate)!;
  const stated = rows.filter((r) => r.stated_concept === candidate);
  const supporting: string[] = stated.map((r) => r.stable_id);
  const contradictory: string[] = [];
  const coincident: string[] = [];
  const supportNotes: string[] = [];
  const contraNotes: string[] = [];

  if (stated.length)
    supportNotes.push(
      `${stated.length} row(s) carry provenance explicitly stating this concept for the value.`,
    );

  const otherStated = rows.filter((r) => r.stated_concept && r.stated_concept !== candidate);
  if (otherStated.length) {
    contradictory.push(...otherStated.map((r) => r.stable_id));
    contraNotes.push(
      `${otherStated.length} row(s) carry provenance stating a different concept for the same column.`,
    );
  }

  const zeros = rows.filter((r) => has(r, "ZERO_WITH_NO_ZERO_LOAD_PROVENANCE"));
  if (zeros.length) {
    contradictory.push(...zeros.map((r) => r.stable_id));
    contraNotes.push(
      `${zeros.length} row(s) hold 0 A with no verified zero-load provenance; no reading of the column supports a 0 for operating equipment${
        spec.authority === "manufacturer"
          ? ", and a published manufacturer rating of 0 A does not exist"
          : ""
      }.`,
    );
  }

  const vaOperands = rows.filter((r) => has(r, "USED_AS_VA_OPERAND"));
  if (candidate === "connected_load_current" || candidate === "design_circuit_ampacity") {
    if (vaOperands.length)
      supportNotes.push(
        `${vaOperands.length} row(s) consume the value as the operand of the Connected VA product, which is consistent with a current concept — but the arithmetic shows only how the value is used, not what it asserts, so it is not treated as provenance.`,
      );
  } else if (vaOperands.length) {
    contradictory.push(...vaOperands.map((r) => r.stable_id));
    contraNotes.push(
      `${vaOperands.length} row(s) feed the value into a Connected VA product, which this concept must never be used for${
        spec.va_operand_eligible ? "" : ` (${spec.label} is not VA-operand eligible)`
      }.`,
    );
  }

  const exceeds = rows.filter((r) => has(r, "EXCEEDS_PUBLISHED_EQUIPMENT_CURRENTS"));
  const equipmentConcepts: CurrentSemanticField[] = [
    "rated_current_amps",
    "rated_load_amps",
    "equipment_fla",
  ];
  if (equipmentConcepts.includes(candidate) && exceeds.length) {
    contradictory.push(...exceeds.map((r) => r.stable_id));
    contraNotes.push(
      `${exceeds.length} row(s) hold a value larger than every published equipment current for their linked equipment, which this concept cannot accommodate.`,
    );
  }

  for (const r of rows) {
    if (
      (has(r, "EQUALS_PUBLISHED_PROTECTION_RATING") &&
        candidate === "maximum_overcurrent_protection") ||
      (has(r, "EQUALS_PUBLISHED_EQUIPMENT_CURRENT") && equipmentConcepts.includes(candidate))
    )
      coincident.push(r.stable_id);
  }

  if (candidate === "minimum_circuit_ampacity")
    contraNotes.push(
      "MCA is unverified for every load in this population and is never derived, so no row can support this reading.",
    );
  if (candidate === "installed_ocp_rating")
    contraNotes.push(
      "No load in this population carries a field-observed breaker rating linked to the value, so no row can support this reading.",
    );

  const uniq = (a: string[]) => Array.from(new Set(a));
  const supporting_rows = uniq(supporting);
  const contradictory_rows = uniq(contradictory).filter((id) => !supporting_rows.includes(id));

  let confidence: SemanticConfidence;
  if (supporting_rows.length && !contradictory_rows.length) confidence = "established";
  else if (supporting_rows.length) confidence = "possible";
  else if (contradictory_rows.length) confidence = "unresolved";
  else confidence = "possible";

  const viable = supporting_rows.length > 0 && contradictory_rows.length === 0;

  const migration_impact = viable
    ? `Legacy Amps could be read into ${spec.label} for the supporting rows, keeping the invariants: ${spec.invariants.join(" ")}`
    : contradictory_rows.length
      ? `Cannot be adopted as the column-wide meaning: ${contradictory_rows.length} row(s) contradict it, so a blanket read into ${spec.label} would fabricate ${
          spec.authority === "manufacturer" ? "manufacturer" : spec.authority === "field_observation" ? "field-observed" : "engineering"
        } data. Any future population must be per-row and evidence-backed.`
      : `No row supports or contradicts this reading, so ${spec.label} stays an empty additive field: it may only be populated from its own authority (${spec.authority.replace(/_/g, " ")}), never from the legacy column.`;

  return {
    candidate,
    label: spec.label,
    supporting_rows,
    supporting_basis:
      supportNotes.join(" ") || "No source states this concept for any row in the population.",
    contradictory_rows,
    contradictory_basis: contraNotes.join(" ") || "No row positively rules this reading out.",
    coincident_rows: uniq(coincident),
    confidence,
    migration_impact,
    viable_as_column_meaning: viable,
  };
}

/* ------------------------------------------------------------------ *
 * Plan
 * ------------------------------------------------------------------ */

export function planCurrentSemanticsClosure(input: {
  baseline: AdjudicationBaseline;
  rows: FarmOpsLoadRow[];
  generatedAt?: string;
}): CurrentSemanticsClosurePlan {
  const { baseline } = input;
  const byId = new Map(input.rows.map((r) => [r.load_id.trim(), r]));
  const signatures = baseline.loads.map((ods) => signatureFor({ ods, fp: byId.get(ods.stable_id) }));

  const candidates = CURRENT_SEMANTIC_SCHEMA.map((s) => evaluateCandidate(s.field, signatures));

  // Mutually exclusive usages observed inside the same column.
  const conflicting_usages: string[] = [];
  const usageGroups: { signature: AmpUsageSignature; ids: string[] }[] = (
    [
      "USED_AS_VA_OPERAND",
      "PRESENT_NOT_USED_IN_VA",
      "ZERO_WITH_NO_ZERO_LOAD_PROVENANCE",
      "EXCEEDS_PUBLISHED_EQUIPMENT_CURRENTS",
      "EQUALS_PUBLISHED_PROTECTION_RATING",
      "EQUALS_PUBLISHED_EQUIPMENT_CURRENT",
    ] as AmpUsageSignature[]
  )
    .map((sig) => ({ signature: sig, ids: signatures.filter((r) => has(r, sig)).map((r) => r.stable_id) }))
    .filter((g) => g.ids.length > 0);

  for (const g of usageGroups)
    conflicting_usages.push(
      `${USAGE_SIGNATURE_LABELS[g.signature]} — ${g.ids.length} row(s): ${g.ids
        .slice(0, 8)
        .join(", ")}${g.ids.length > 8 ? ` … +${g.ids.length - 8}` : ""}`,
    );

  const statedConcepts = new Set(
    signatures.map((r) => r.stated_concept).filter((c): c is CurrentSemanticField => Boolean(c)),
  );
  const viable = candidates.filter((c) => c.viable_as_column_meaning);
  const distinctUsageClasses = usageGroups.filter((g) =>
    (
      [
        "USED_AS_VA_OPERAND",
        "ZERO_WITH_NO_ZERO_LOAD_PROVENANCE",
        "EXCEEDS_PUBLISHED_EQUIPMENT_CURRENTS",
        "PRESENT_NOT_USED_IN_VA",
      ] as AmpUsageSignature[]
    ).includes(g.signature),
  ).length;

  let verdict: ColumnSemanticVerdict;
  let verdict_rationale: string;

  if (statedConcepts.size > 1) {
    verdict = "SEMANTICALLY_OVERLOADED_LEGACY_FIELD";
    verdict_rationale = `Provenance states more than one concept for the same column (${Array.from(
      statedConcepts,
    )
      .map((c) => CURRENT_SEMANTIC_LABELS[c])
      .join(", ")}), so the field carries multiple meanings by construction.`;
  } else if (viable.length === 1 && statedConcepts.size === 1) {
    verdict = "SINGLE_CONCEPT_ESTABLISHED";
    verdict_rationale = `Exactly one candidate survives with explicit provenance and no contradictory row: ${viable[0].label}.`;
  } else if (distinctUsageClasses >= 2) {
    verdict = "SEMANTICALLY_OVERLOADED_LEGACY_FIELD";
    verdict_rationale = [
      `No candidate meaning survives the whole population: ${
        viable.length
      } of ${candidates.length} candidates are viable column-wide.`,
      `The column is used in ${distinctUsageClasses} mutually exclusive ways across rows — values consumed as a VA current, values that do not participate in their row's VA, zeros with no zero-load provenance, and values larger than every published equipment current for the same equipment.`,
      "A single unqualified column cannot hold all of those at once, so the field is historically overloaded rather than one consistent concept recorded inconsistently.",
      "No source anywhere in the workbook, its comment/note/source-reference columns, its other sheets or FarmOps states which concept the column asserts.",
    ].join(" ");
  } else {
    verdict = "SEMANTICS_UNDETERMINED_INSUFFICIENT_EVIDENCE";
    verdict_rationale =
      "The population is too small or too uniform to demonstrate overloading, and no source states a concept — so the meaning is undetermined rather than proven overloaded.";
  }

  const overloaded = verdict === "SEMANTICALLY_OVERLOADED_LEGACY_FIELD";

  const additive_schema: AdditiveSchemaRecommendation[] = [
    {
      element: "electrical_loads.amps — retained unchanged as the legacy unqualified column",
      purpose:
        "Keeps every existing reader, export, report and VA calculation working byte-for-byte while the semantic layer is added beside it.",
      consumer_safety:
        "No rename, no type change, no backfill, no deletion — current consumers are untouched.",
      required_now: true,
      why_required_now:
        "Preserving the legacy column is the precondition for an additive migration; nothing may be moved out of it.",
    },
    {
      element: "electrical_loads.amps_semantic (nullable enum over the eight concepts)",
      purpose:
        "Records which concept the legacy value asserts for a given row, once — and only once — a source states it.",
      consumer_safety:
        "Nullable and ignored by existing readers; NULL keeps today's behaviour of 'unqualified current'.",
      required_now: true,
      why_required_now:
        "This is the minimum needed to stop the field being overloaded: the meaning becomes per-row data instead of a guess.",
    },
    {
      element: "electrical_loads.amps_semantic_provenance (nullable text/reference)",
      purpose:
        "Cites the source that establishes the semantic — document, field observation, or manufacturer table.",
      consumer_safety: "Additive nullable metadata; no consumer reads it today.",
      required_now: true,
      why_required_now:
        "A semantic without a citation would reintroduce exactly the unsourced assertion this phase is closing.",
    },
    ...CURRENT_SEMANTIC_SCHEMA.filter((s) => s.field !== "connected_load_current").map((s) => ({
      element: `electrical_loads.${s.field} (nullable numeric)`,
      purpose: `${s.definition} Authority: ${s.authority.replace(/_/g, " ")}.`,
      consumer_safety:
        "Nullable and unread by current consumers; stays NULL until its own authority supplies a value.",
      required_now: false,
      why_required_now: `Only added when a real value from ${s.authority.replace(
        /_/g,
        " ",
      )} exists to store; never populated from the legacy column. ${s.invariants.join(" ")}`,
    })),
    {
      element: "electrical_loads.connected_load_current (nullable numeric)",
      purpose:
        "The only current concept a Connected VA product may use as its operand, so VA arithmetic stops depending on an unqualified column.",
      consumer_safety:
        "Nullable; VA consumers keep using the legacy column until a row has both a stated semantic and a value here.",
      required_now: true,
      why_required_now:
        "Without it there is no field the VA calculation can legitimately point at, and the overload cannot be unwound.",
    },
  ];

  const minimum_additive_schema_summary = overloaded
    ? "Minimum additive set: keep `amps` exactly as it is, add `amps_semantic`, `amps_semantic_provenance` and `connected_load_current` now, and add each remaining concept column only when its own authority supplies a value. All new columns are nullable, nothing is backfilled from the legacy column, and no existing consumer changes."
    : "No additive schema change is required yet; the semantic question is not closed and no column-wide meaning has been established.";

  const exit_criteria: ClosureExitCriteria[] = (CLOSURE_FIXTURE_IDS as readonly string[]).map((id) => {
    const sig = signatures.find((r) => r.stable_id === id);
    const zeroCase = sig ? has(sig, "ZERO_WITH_NO_ZERO_LOAD_PROVENANCE") : false;
    const shared = [
      "The canonical Amps column has a stated definition for this row's worksheet — a dated, attributable source saying which of the eight concepts the column asserts (column-wide, or specifically for this row).",
      "`amps_semantic` and `amps_semantic_provenance` exist and are populated for this row from that source, not inferred from arithmetic or from numeric coincidence with a manufacturer rating.",
      "Any value carried forward is placed in the field matching its own authority: manufacturer values (MOCP 25 A, RCA 1.69 A, RLA 4.15 A) only into manufacturer fields, an observed breaker only into installed_ocp_rating, and MCA left NULL until published.",
      "Connected VA for this row is either recomputed from a populated connected_load_current or explicitly marked as not established — it may no longer be derived from the unqualified column.",
    ];
    if (zeroCase)
      return {
        stable_id: id,
        current_disposition:
          "CURRENT_SEMANTICS_UNRESOLVED + ZERO_AMPS_NOT_ESTABLISHED_AS_ZERO_LOAD (canonical 0 A)",
        must_become_true: [
          "The canonical 0 A is resolved: either a source states a verified zero-load / de-energized / spare condition for this load, or the zero is adjudicated as an unsupported placeholder — the equipment being an installed operating mini-split means 0 A is not currently a credible load current.",
          ...shared,
        ],
        proposed_target_field: null,
        why_no_assignment:
          "Provenance supports no concept for a 0 A entry against operating equipment, so the value is assigned to no target field. MOCP 25 A is not substituted for the missing current.",
      };
    return {
      stable_id: id,
      current_disposition:
        "CURRENT_SEMANTICS_UNRESOLVED — canonical value LEGACY_VALUE_SOURCE_UNKNOWN, FarmOps value NUMERIC_VALUE_WITH_UNRESOLVED_SEMANTICS",
      must_become_true: [
        "The origin of the canonical value is established, or it is adjudicated as an unsupported legacy entry — the derived Connected VA remains excluded as evidence because it restates the same figure.",
        "The FarmOps value acquires provenance stating what it is: MOCP, the installed breaker rating, or a load current. Numerically coinciding with the published MOCP is not sufficient.",
        "If the value turns out to be a protective-device rating, the installed breaker for this circuit is observed in the field and recorded as installed_ocp_rating — not as a load current.",
        ...shared,
      ],
      proposed_target_field: null,
      why_no_assignment:
        "No provenance supports any of the eight meanings for either value, so neither is assigned to a target semantic field. MOCP is not read as a load current and MCA is not inferred.",
    };
  });

  return {
    version: CURRENT_CLOSURE_VERSION,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    workbook_name: baseline.ods_file_name,
    workbook_sha256: baseline.ods_sha256,
    is_phase_44a_baseline: baseline.is_phase_44a_baseline,
    baseline_label: baselineLabel(baseline),
    rows_examined: signatures.length,
    rows_with_amps: signatures.filter((r) => r.ods_amps !== null).length,
    rows_with_stated_concept: signatures.filter((r) => r.stated_concept).length,
    signatures,
    candidates,
    verdict,
    verdict_rationale,
    conflicting_usages,
    additive_schema,
    minimum_additive_schema_summary,
    exit_criteria,
    invariants: [
      "Read-only planning output — no FarmOps write, no ODS edit, no numeric correction.",
      "Numeric coincidence with a manufacturer rating is recorded as a coincidence and never as provenance.",
      "MOCP is never read as a load current; MCA is never derived and stays NULL until published.",
      "No Bryant value is assigned into a target semantic field, because provenance supports no such meaning yet.",
      "The legacy column is never renamed, retyped, backfilled or dropped — every recommendation is additive and nullable.",
    ],
    read_only: true,
    apply_available: false,
    ods_edit_authorized: false,
    farmops_write_authorized: false,
    numeric_corrections_authorized: false,
  };
}

/* ------------------------------------------------------------------ *
 * Exports
 * ------------------------------------------------------------------ */

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const CLOSURE_CSV_HEADER = [
  "semantic_candidate",
  "supporting_rows",
  "contradictory_rows",
  "coincident_rows_not_evidence",
  "confidence",
  "migration_impact",
] as const;

export function closureCsv(plan: CurrentSemanticsClosurePlan): string {
  return [
    CLOSURE_CSV_HEADER.join(","),
    ...plan.candidates.map((c) =>
      [
        c.candidate,
        c.supporting_rows.join(" "),
        c.contradictory_rows.join(" "),
        c.coincident_rows.join(" "),
        CONFIDENCE_LABELS[c.confidence],
        c.migration_impact,
      ]
        .map(cell)
        .join(","),
    ),
  ].join("\n");
}

export function closureMarkdown(plan: CurrentSemanticsClosurePlan): string {
  const lines: string[] = [
    "# Phase 4.4b — Current-semantics closure plan (read-only)",
    "",
    `- Version: ${plan.version}`,
    `- Generated: ${plan.generated_at}`,
    `- Canonical workbook: ${plan.workbook_name} (SHA-256 ${plan.workbook_sha256})`,
    `- Baseline: ${plan.baseline_label}`,
    `- Population: ${plan.rows_examined} canonical load rows, ${plan.rows_with_amps} with an amps value, ${plan.rows_with_stated_concept} with a stated concept`,
    "",
    `## Verdict: \`${plan.verdict}\``,
    "",
    `${VERDICT_LABELS[plan.verdict]}.`,
    "",
    plan.verdict_rationale,
    "",
    "### Mutually exclusive usages observed in the same column",
    "",
    ...plan.conflicting_usages.map((u) => `- ${u}`),
    "",
    "## Candidate meanings",
    "",
    "| Semantic candidate | Supporting rows | Contradictory rows | Confidence | Migration impact |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const c of plan.candidates) {
    lines.push(
      `| \`${c.candidate}\` (${c.label}) | ${
        c.supporting_rows.length ? c.supporting_rows.join(", ") : "none"
      } — ${c.supporting_basis} | ${
        c.contradictory_rows.length ? c.contradictory_rows.join(", ") : "none"
      } — ${c.contradictory_basis} | ${CONFIDENCE_LABELS[c.confidence]} | ${c.migration_impact} |`,
    );
  }
  lines.push(
    "",
    "## Minimum additive target schema",
    "",
    plan.minimum_additive_schema_summary,
    "",
  );
  for (const a of plan.additive_schema) {
    lines.push(
      `- ${a.required_now ? "**Required now**" : "Deferred"} — \`${a.element}\`: ${a.purpose} Consumer safety: ${a.consumer_safety} ${a.why_required_now}`,
    );
  }
  lines.push("", "## Leaving CURRENT_SEMANTICS_UNRESOLVED", "");
  for (const e of plan.exit_criteria) {
    lines.push(`### ${e.stable_id}`, "", `- Current disposition: ${e.current_disposition}`);
    for (const m of e.must_become_true) lines.push(`- Must become true: ${m}`);
    lines.push(
      `- Proposed target field: ${e.proposed_target_field ?? "none"} — ${e.why_no_assignment}`,
      "",
    );
  }
  lines.push("## Invariants", "", ...plan.invariants.map((i) => `- ${i}`));
  return lines.join("\n");
}
