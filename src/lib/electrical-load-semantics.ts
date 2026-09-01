// Phase 4.4b — Load voltage / current semantic review (READ-ONLY).
//
// Numeric reconciliation reports Category-B findings on load volts, amps and
// connected VA. Some of those are not engineering disagreements at all: they are
// two *different documented quantities* stored in one column. This module proves
// which is which before anyone calls a value wrong.
//
// Nothing here writes:
//   * no FarmOps load values are changed;
//   * the canonical ODS is never written;
//   * Category C/D findings, the completed Boolean work, the system-voltage
//     panel migration, House breaker data and topology are all untouched;
//   * there is deliberately NO apply path in this phase.
//
// Semantic model (proposed, not applied)
// -------------------------------------
// A load carries at least two distinct voltage concepts, which must never
// overwrite one another:
//   nominal_supply_voltage      — the nominal system the load is connected to
//                                 (120, 208, 240, 277, 480 …)
//   rated_nameplate_voltage     — the equipment nameplate/rating (115, 220 …)
// and connected VA must state its basis, because 240×30 = 7200 and 220×30 =
// 6600 are both correct for the same equipment under different bases.
// Current has at least five legitimate meanings (running/nameplate current,
// calculated load current, circuit design current, OCP rating, maximum input
// current) which cannot share one numeric field when they can differ.
import type { NumericDiagnosticsReport, NumericFinding } from "@/lib/electrical-numeric-diagnostics";
import type { ComparisonRecord, ValidationReport } from "@/lib/electrical-parallel-validation";
import {
  hasOcpProvenance,
  hasVoltageConceptProvenance,
  meaningfulCitation,
  type SemanticEvidence,
} from "@/lib/electrical-semantic-evidence";

export const LOAD_SEMANTICS_VERSION = "4.4b-load-voltage-current-semantics-1";

/* ------------------------------------------------------- proposed concepts */

export type LoadVoltageConcept = "nominal_supply_voltage" | "rated_nameplate_voltage";

export type VoltageBasis =
  | "nominal_supply"
  | "equipment_rated_nameplate"
  | "undocumented";

export type VaBasis =
  | "calculated_from_nominal_supply"
  | "calculated_from_nameplate"
  | "manufacturer_stated"
  | "other_documented"
  | "undocumented";

export type CurrentMeaning =
  | "equipment_running_nameplate_current"
  | "calculated_load_current"
  | "circuit_design_current"
  | "ocp_rating"
  | "maximum_input_current"
  | "undocumented";

export const VOLTAGE_BASIS_LABELS: Record<VoltageBasis, string> = {
  nominal_supply: "Nominal supply voltage (system the load is connected to)",
  equipment_rated_nameplate: "Equipment rated / nameplate voltage",
  undocumented: "Basis not documented",
};

export const VA_BASIS_LABELS: Record<VaBasis, string> = {
  calculated_from_nominal_supply: "Calculated from nominal supply voltage × current",
  calculated_from_nameplate: "Calculated from nameplate/rated voltage × current",
  manufacturer_stated: "Directly stated by the manufacturer",
  other_documented: "Another documented basis",
  undocumented: "Basis not documented",
};

export const CURRENT_MEANING_LABELS: Record<CurrentMeaning, string> = {
  equipment_running_nameplate_current: "Equipment running / nameplate current",
  calculated_load_current: "Calculated load current",
  circuit_design_current: "Circuit design current",
  ocp_rating: "Breaker / OCP rating",
  maximum_input_current: "Maximum input current",
  undocumented: "Meaning not documented",
};

/**
 * The distinct fields this review says the model needs. Documentation only —
 * this phase proposes no migration and writes nothing.
 */
export const PROPOSED_LOAD_SEMANTIC_FIELDS: {
  field: string;
  concept: string;
  why: string;
}[] = [
  {
    field: "nominal_supply_voltage",
    concept: "Nominal system voltage the load is connected to (120, 208, 240 …)",
    why: "A circuit-side quantity. Must not be overwritten by an equipment nameplate value.",
  },
  {
    field: "rated_nameplate_voltage",
    concept: "Equipment rated / nameplate voltage (115, 220, 230 …)",
    why: "An equipment-side quantity. 220 V nameplate on a 240 V nominal system is not a conflict.",
  },
  {
    field: "connected_va_basis",
    concept: "Which voltage (or manufacturer statement) the connected VA was computed from",
    why: "240×30=7200 and 220×30=6600 are both correct under different bases; VA is meaningless without its basis.",
  },
  {
    field: "current_meaning",
    concept: "Which current quantity `amps` holds",
    why: "Running current, calculated load current, design current and OCP rating can legitimately differ; one field cannot carry all five.",
  },
  {
    field: "ocp_rating_amps (load-side reference)",
    concept: "Breaker / OCP rating protecting the load",
    why: "60 A OCP against 25 A equipment current is a semantic mismatch, not a wrong number.",
  },
];

/* --------------------------------------------------------------- reference */

/** Nominal system voltages used in this installation's canonical schedules. */
export const NOMINAL_SUPPLY_VOLTAGES = [120, 208, 240, 277, 480] as const;

/**
 * Accepted equipment nameplate/rated voltages for each nominal system. These
 * are the classic utilization-voltage designations; a pair drawn from this
 * table is a representation difference, never an engineering disagreement.
 */
export const NAMEPLATE_FOR_NOMINAL: Record<number, number[]> = {
  120: [110, 115, 125],
  208: [200, 220],
  240: [220, 230, 250],
  277: [265],
  480: [440, 460, 500],
};

/** Standard inverse-time OCP ratings (NEC 240.6(A)), amps. */
export const STANDARD_OCP_AMPS = [
  15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 225, 250, 300,
  350, 400, 450, 500, 600,
] as const;

export const isStandardOcpRating = (a: number | null): boolean =>
  a !== null && STANDARD_OCP_AMPS.some((v) => Math.abs(v - a) < 1e-9);

const near = (a: number, b: number, tolerance = 0.01) =>
  b === 0 ? Math.abs(a) < 1e-9 : Math.abs(a - b) / Math.abs(b) <= tolerance;

export interface NominalNameplatePair {
  nominal: number;
  nameplate: number;
  /** Which side of the comparison held the nominal value. */
  nominal_side: "ods" | "farmops";
}

/**
 * Prove that two differing load voltages are the same electrical reality
 * expressed on two documented bases (nominal supply vs equipment nameplate).
 * Returns null when both values are nominal systems (a real disagreement) or
 * when the pair is not a recognised utilization designation.
 */
export function nominalNameplatePair(
  odsVolts: number | null,
  farmopsVolts: number | null,
): NominalNameplatePair | null {
  if (odsVolts === null || farmopsVolts === null || odsVolts === farmopsVolts) return null;
  const isNominal = (v: number) => (NOMINAL_SUPPLY_VOLTAGES as readonly number[]).includes(v);
  const pairs: { nominal: number; nameplate: number; nominal_side: "ods" | "farmops" }[] = [
    { nominal: odsVolts, nameplate: farmopsVolts, nominal_side: "ods" },
    { nominal: farmopsVolts, nameplate: odsVolts, nominal_side: "farmops" },
  ];
  for (const p of pairs) {
    // Two nominal systems disagreeing (120 vs 240) is an engineering matter.
    if (isNominal(p.nominal) && isNominal(p.nameplate)) return null;
    if (isNominal(p.nominal) && (NAMEPLATE_FOR_NOMINAL[p.nominal] ?? []).includes(p.nameplate)) {
      return p;
    }
  }
  return null;
}

/** Which basis, if any, explains a stated VA given a voltage and a current. */
export function vaBasisFor(
  va: number | null,
  volts: number | null,
  amps: number | null,
): VaBasis | null {
  if (va === null || volts === null || amps === null) return null;
  return near(va, volts * amps) ? "calculated_from_nominal_supply" : null;
}

/* ----------------------------------------------------------- review output */

export type LoadSemanticBucket =
  | "true_engineering_disagreement"
  | "nominal_vs_nameplate_representation"
  | "current_ocp_semantic_mismatch"
  | "insufficient_provenance";

export const BUCKET_LABELS: Record<LoadSemanticBucket, string> = {
  true_engineering_disagreement: "True engineering disagreement",
  nominal_vs_nameplate_representation: "Nominal-vs-nameplate representation",
  current_ocp_semantic_mismatch: "Current / OCP semantic mismatch",
  insufficient_provenance: "Insufficient provenance",
};

export interface LoadSemanticFinding {
  stable_id: string;
  field: string;
  label: string;
  unit: string;
  ods_value: number | null;
  farmops_value: number | null;
  delta: number | null;
  original_category: "A" | "B" | "C" | "D" | "E";
  /** "E" = representation/semantic; "B" stays a real disagreement. */
  proposed_category: "B" | "D" | "E";
  bucket: LoadSemanticBucket;
  /** Documented basis each side is believed to carry, when provable. */
  ods_basis: VoltageBasis | VaBasis | CurrentMeaning | null;
  farmops_basis: VoltageBasis | VaBasis | CurrentMeaning | null;
  /** Arithmetic/reference evidence for the reclassification. */
  proof: string[];
  /** Proven, or still requires a documented basis before reclassification. */
  basis_proven: boolean;
  disposition: string;
  provenance: string;
}

export interface LoadSemanticDetailValue {
  field: string;
  label: string;
  ods_value: string;
  farmops_value: string;
  differs: boolean;
  ods_worksheet: string | null;
  ods_column: string | null;
  ods_row: number | null;
  farmops_entity: string | null;
  farmops_field: string | null;
  farmops_uuid: string | null;
}

export interface LoadSemanticDetail {
  stable_id: string;
  description: string;
  equipment_model: string;
  canonical_volts: number | null;
  farmops_volts: number | null;
  canonical_amps: number | null;
  farmops_amps: number | null;
  canonical_connected_va: number | null;
  farmops_connected_va: number | null;
  breaker_ocp: string;
  source_reference: string;
  notes: string;
  buckets: LoadSemanticBucket[];
  /** Provenance for every compared value on this load, differing or not. */
  values: LoadSemanticDetailValue[];
  /** Targeted engineering review: never semantically normalized. */
  targeted_review: boolean;
}

export interface LoadSemanticReview {
  version: string;
  generated_from_ods: string;
  compared_at: string;
  proposed_fields: typeof PROPOSED_LOAD_SEMANTIC_FIELDS;
  findings: LoadSemanticFinding[];
  counts: Record<LoadSemanticBucket, number>;
  loads: LoadSemanticDetail[];
  /** No apply path exists for this phase. */
  read_only: true;
  apply_available: false;
}

/** The comparison layer labels the load domain "loads"; older reports use "load". */
const isLoadDomain = (d: string) => d === "load" || d === "loads";

const LOAD_NUMERIC_FIELDS = new Set(["volts", "amps", "connected_va", "demand_va"]);

const isLoadNumeric = (f: NumericFinding) =>
  f.farmops_entity === "electrical_loads" || isLoadDomain(f.domain)
    ? LOAD_NUMERIC_FIELDS.has(f.field)
    : false;

interface LoadGroup {
  stable_id: string;
  byField: Map<string, NumericFinding>;
}

function groupLoadFindings(diag: NumericDiagnosticsReport): LoadGroup[] {
  const groups = new Map<string, LoadGroup>();
  for (const f of diag.findings) {
    if (!isLoadNumeric(f) || f.category !== "B") continue;
    const g = groups.get(f.stable_id) ?? { stable_id: f.stable_id, byField: new Map() };
    g.byField.set(f.field, f);
    groups.set(f.stable_id, g);
  }
  return [...groups.values()].sort((a, b) => a.stable_id.localeCompare(b.stable_id));
}

const num = (v: number | null) => (v === null ? "—" : String(v));

/**
 * Split the load Category-B findings into the four acceptance buckets. Pure and
 * read-only: neither the report nor any record is mutated.
 */
export function loadVoltageCurrentReview(
  report: ValidationReport,
  diag: NumericDiagnosticsReport,
): LoadSemanticReview {
  const findings: LoadSemanticFinding[] = [];
  const bucketsByLoad = new Map<string, Set<LoadSemanticBucket>>();

  const noteBucket = (id: string, b: LoadSemanticBucket) => {
    const s = bucketsByLoad.get(id) ?? new Set<LoadSemanticBucket>();
    s.add(b);
    bucketsByLoad.set(id, s);
  };

  for (const group of groupLoadFindings(diag)) {
    const volts = group.byField.get("volts") ?? null;
    const amps = group.byField.get("amps") ?? null;

    // Affirmative provenance for this load. A classic utilization pair or a
    // standard breaker size is supporting evidence only: without a citation that
    // *states* the concept, the finding stays insufficient-provenance.
    const evidence = evidenceForLoad(report, group.stable_id);
    const conceptProven = hasVoltageConceptProvenance(evidence);
    const ocpProven = hasOcpProvenance(evidence);

    // Voltage basis: nominal supply vs equipment nameplate, only when documented.
    const pair =
      volts && conceptProven
        ? nominalNameplatePair(volts.ods_value, volts.farmops_value)
        : null;
    const mathPair = volts ? nominalNameplatePair(volts.ods_value, volts.farmops_value) : null;

    for (const [field, f] of group.byField) {
      const base = {
        stable_id: f.stable_id,
        field,
        label: f.label,
        unit: f.unit,
        ods_value: f.ods_value,
        farmops_value: f.farmops_value,
        delta: f.delta,
        original_category: f.category,
      } as const;

      if (field === "volts") {
        if (pair) {
          const odsIsNominal = pair.nominal_side === "ods";
          findings.push({
            ...base,
            proposed_category: "E",
            bucket: "nominal_vs_nameplate_representation",
            ods_basis: odsIsNominal ? "nominal_supply" : "equipment_rated_nameplate",
            farmops_basis: odsIsNominal ? "equipment_rated_nameplate" : "nominal_supply",
            proof: [
              `${pair.nominal} V is a nominal supply voltage of this installation.`,
              `${pair.nameplate} V is a recognised equipment rated/nameplate designation for a ${pair.nominal} V nominal system.`,
              "Two documented bases for the same connection — not two conflicting engineering values.",
            ],
            basis_proven: true,
            disposition:
              "Represent both concepts separately (nominal_supply_voltage and rated_nameplate_voltage). Neither value overwrites the other; nothing is written in this phase.",
            provenance: `Canonical ${num(f.ods_value)} V vs FarmOps ${num(f.farmops_value)} V, reclassified B → representation/semantic on the nominal-vs-nameplate table.`,
          });
        } else if (mathPair) {
          findings.push({
            ...base,
            proposed_category: "D",
            bucket: "insufficient_provenance",
            ods_basis: "undocumented",
            farmops_basis: "undocumented",
            proof: [
              `${mathPair.nominal} V / ${mathPair.nameplate} V is mathematically a nominal-vs-nameplate pair — supporting evidence only.`,
              "No citation states that either value is a nominal supply or an equipment nameplate voltage, so the representation reading is not established.",
            ],
            basis_proven: false,
            disposition:
              "Obtain a nameplate photo/specification or a design note stating the nominal supply before reclassifying. No writes.",
            provenance: `Canonical ${num(f.ods_value)} V vs FarmOps ${num(f.farmops_value)} V with no documented voltage concept on either side.`,
          });
        } else {
          findings.push({
            ...base,
            proposed_category: "B",
            bucket: "true_engineering_disagreement",
            ods_basis: "undocumented",
            farmops_basis: "undocumented",
            proof: [
              `${num(f.ods_value)} V and ${num(f.farmops_value)} V are not a nominal/nameplate pair for the same system.`,
              "Requires equipment identity / source data review before either value is called incorrect.",
            ],
            basis_proven: false,
            disposition:
              "Targeted engineering review of equipment identity and source data. Do not semantically normalize; no writes.",
            provenance: `Canonical ${num(f.ods_value)} V vs FarmOps ${num(f.farmops_value)} V; both sides state a voltage and neither is explained by a documented basis.`,
          });
        }
        noteBucket(
          f.stable_id,
          pair
            ? "nominal_vs_nameplate_representation"
            : mathPair
              ? "insufficient_provenance"
              : "true_engineering_disagreement",
        );
        continue;
      }

      if (field === "amps") {
        const hi = Math.max(f.ods_value ?? 0, f.farmops_value ?? 0);
        const lo = Math.min(f.ods_value ?? 0, f.farmops_value ?? 0);
        const zeroSide = f.ods_value === 0 || f.farmops_value === 0;
        const ladder = !zeroSide && isStandardOcpRating(hi) && hi >= lo * 1.25 && lo > 0;
        const ocpLike = ladder && ocpProven;
        if (ladder && !ocpProven) {
          findings.push({
            ...base,
            proposed_category: "D",
            bucket: "insufficient_provenance",
            ods_basis: "undocumented",
            farmops_basis: "undocumented",
            proof: [
              `${hi} A is a standard NEC 240.6(A) rating and is ≥ 125 % of ${lo} A — supporting evidence only.`,
              "No mapped OCP field, equipment specification, canonical note or FarmOps OCP relationship states that the larger value is circuit protection.",
            ],
            basis_proven: false,
            disposition:
              "Obtain documentation that the larger value is the breaker/OCP rating before treating this as a semantic mismatch. No writes.",
            provenance: `Canonical ${num(f.ods_value)} A vs FarmOps ${num(f.farmops_value)} A with no OCP provenance on either side.`,
          });
          noteBucket(f.stable_id, "insufficient_provenance");
          continue;
        }
        if (ocpLike) {
          const odsIsHi = (f.ods_value ?? 0) === hi;
          findings.push({
            ...base,
            proposed_category: "E",
            bucket: "current_ocp_semantic_mismatch",
            ods_basis: odsIsHi ? "ocp_rating" : "equipment_running_nameplate_current",
            farmops_basis: odsIsHi ? "equipment_running_nameplate_current" : "ocp_rating",
            proof: [
              `${hi} A is a standard overcurrent-protection rating (NEC 240.6(A)) and is ≥ 125 % of ${lo} A.`,
              `${lo} A is consistent with equipment running/nameplate current for the same load.`,
              "Two different quantities sharing one `amps` column — circuit sizing/OCP vs equipment current.",
            ],
            basis_proven: false,
            disposition:
              "Confirm from the source data that the higher value is OCP / circuit sizing and the lower is equipment current, then hold them in separate fields (current_meaning + ocp_rating_amps). Neither value is incorrect; nothing is written.",
            provenance: `Canonical ${num(f.ods_value)} A vs FarmOps ${num(f.farmops_value)} A. Reclassified B → current/OCP semantic mismatch pending documented meaning.`,
          });
          noteBucket(f.stable_id, "current_ocp_semantic_mismatch");
          continue;
        }
        if (zeroSide) {
          findings.push({
            ...base,
            proposed_category: "D",
            bucket: "insufficient_provenance",
            ods_basis: "undocumented",
            farmops_basis: "undocumented",
            proof: [
              `One side states an explicit 0 A (${num(f.ods_value)} vs ${num(f.farmops_value)}).`,
              "An explicit zero is neither a nameplate current nor a design current until its meaning is documented.",
            ],
            basis_proven: false,
            disposition:
              "Examine equipment identity and the source worksheet citation before any comparison is treated as an engineering disagreement. Do not normalize; no writes.",
            provenance: "Explicit zero against a stated current with no documented current meaning on either side.",
          });
          noteBucket(f.stable_id, "insufficient_provenance");
          continue;
        }
        findings.push({
          ...base,
          proposed_category: "B",
          bucket: "true_engineering_disagreement",
          ods_basis: "undocumented",
          farmops_basis: "undocumented",
          proof: [
            `${num(f.ods_value)} A vs ${num(f.farmops_value)} A: neither an OCP-ladder relationship nor an explicit zero.`,
          ],
          basis_proven: false,
          disposition:
            "Genuine current disagreement; record an explicit engineering disposition. No automatic change.",
          provenance: `Both sides hold explicit current values that differ by ${f.delta === null ? "—" : f.delta} A.`,
        });
        noteBucket(f.stable_id, "true_engineering_disagreement");
        continue;
      }

      // connected_va / demand_va — the difference is only meaningful with a basis.
      // A current finding only exists when the two sides disagree; when they
      // agree, read the shared current straight off the comparison records so a
      // VA basis can still be proven.
      const agreedAmps = amps === null ? sharedNumericValue(report, f.stable_id, "amps") : null;
      const sharedAmps =
        agreedAmps !== null
          ? agreedAmps
          : amps && amps.ods_value !== null && amps.farmops_value === amps.ods_value
            ? amps.ods_value
            : null;
      const odsAmps = amps ? amps.ods_value : agreedAmps;
      const fpAmps = amps ? amps.farmops_value : agreedAmps;
      const odsVolts = volts ? volts.ods_value : null;
      const fpVolts = volts ? volts.farmops_value : null;
      const currentForVa = sharedAmps;

      const odsFromOwnVolts =
        odsVolts !== null && currentForVa !== null
          ? vaBasisFor(f.ods_value, odsVolts, currentForVa)
          : null;
      const fpFromOwnVolts =
        fpVolts !== null && currentForVa !== null
          ? vaBasisFor(f.farmops_value, fpVolts, currentForVa)
          : null;

      if (pair && odsFromOwnVolts && fpFromOwnVolts && currentForVa !== null) {
        const odsIsNominal = pair.nominal_side === "ods";
        findings.push({
          ...base,
          proposed_category: "E",
          bucket: "nominal_vs_nameplate_representation",
          ods_basis: odsIsNominal
            ? "calculated_from_nominal_supply"
            : "calculated_from_nameplate",
          farmops_basis: odsIsNominal
            ? "calculated_from_nameplate"
            : "calculated_from_nominal_supply",
          proof: [
            `Canonical: ${num(odsVolts)} × ${currentForVa} = ${num(f.ods_value)} VA.`,
            `FarmOps: ${num(fpVolts)} × ${currentForVa} = ${num(f.farmops_value)} VA.`,
            `Identical current on both sides; the whole difference is the documented voltage basis (${pair.nominal} V nominal vs ${pair.nameplate} V nameplate).`,
          ],
          basis_proven: true,
          disposition:
            "Record connected_va_basis alongside the value. Both figures are arithmetically correct on their stated basis; do not treat this as an engineering disagreement and do not write either value.",
          provenance: `VA difference fully explained by the voltage basis, with current held constant at ${currentForVa} A.`,
        });
        noteBucket(f.stable_id, "nominal_vs_nameplate_representation");
        continue;
      }

      findings.push({
        ...base,
        proposed_category: "D",
        bucket: "insufficient_provenance",
        ods_basis: "undocumented",
        farmops_basis: "undocumented",
        proof: [
          `Canonical ${num(f.ods_value)} VA vs FarmOps ${num(f.farmops_value)} VA.`,
          odsAmps !== fpAmps
            ? `Current also differs (${num(odsAmps)} A vs ${num(fpAmps)} A), so the VA basis cannot be isolated.`
            : "No documented basis (nominal, nameplate, manufacturer-stated) is recorded for either figure.",
        ],
        basis_proven: false,
        disposition:
          "Document the VA basis for each side before classifying. Not a proven engineering disagreement; no writes.",
        provenance: "connected/demand VA lacks a documented basis on at least one side.",
      });
      noteBucket(f.stable_id, "insufficient_provenance");
    }
  }

  const counts: Record<LoadSemanticBucket, number> = {
    true_engineering_disagreement: 0,
    nominal_vs_nameplate_representation: 0,
    current_ocp_semantic_mismatch: 0,
    insufficient_provenance: 0,
  };
  for (const f of findings) counts[f.bucket] += 1;

  const loads = [...bucketsByLoad.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((id) => loadSemanticDetail(report, diag, id, [...(bucketsByLoad.get(id) ?? [])]));

  return {
    version: LOAD_SEMANTICS_VERSION,
    generated_from_ods: report.ods.file_name,
    compared_at: report.compared_at,
    proposed_fields: PROPOSED_LOAD_SEMANTIC_FIELDS,
    findings,
    counts,
    loads,
    read_only: true,
    apply_available: false,
  };
}

const DETAIL_FIELDS = [
  "description",
  "equipment_model",
  "source_circuit",
  "circuit_group_ref",
  "suggested_panel",
  "volts",
  "amps",
  "connected_va",
  "demand_va",
  "demand_basis",
  "phase",
  "source_reference",
  "dedicated_shared",
];

/**
 * Affirmative provenance available for a load in the compared records. Only
 * fields that actually carry a citation count; placeholders such as "TBD",
 * "No" or "0%" are dropped.
 */
export function evidenceForLoad(report: ValidationReport, stableId: string): SemanticEvidence {
  const records = report.records.filter(
    (r) => isLoadDomain(r.domain) && r.stable_id === stableId,
  );
  const pick = (field: string) => {
    const r = records.find((x) => x.field === field);
    return meaningfulCitation(r?.farmops_value) ?? meaningfulCitation(r?.ods_value);
  };
  return {
    // FarmOps loads have no mapped OCP rating column; a circuit reference is a
    // relationship, not a statement that a number is overcurrent protection.
    ocp_field: null,
    equipment_spec: pick("equipment_model"),
    canonical_notes: pick("notes"),
    farmops_ocp_relationship: pick("circuit_group_ref"),
    other_source_evidence: pick("source_reference") ?? pick("source_circuit"),
  };
}

function recordsForLoad(report: ValidationReport, stableId: string): ComparisonRecord[] {
  return report.records.filter((r) => isLoadDomain(r.domain) && r.stable_id === stableId);
}

/**
 * Read-only detail panel data for a single load: every compared value with its
 * worksheet/row and FarmOps provenance, so a difference can be examined rather
 * than assumed.
 */
export function loadSemanticDetail(
  report: ValidationReport,
  diag: NumericDiagnosticsReport,
  stableId: string,
  buckets: LoadSemanticBucket[] = [],
): LoadSemanticDetail {
  const records = recordsForLoad(report, stableId);
  const byField = new Map(records.map((r) => [r.field, r]));
  const text = (field: string, side: "ods" | "farmops") => {
    const r = byField.get(field);
    if (!r) return "";
    return (side === "ods" ? r.ods_value : r.farmops_value) ?? "";
  };
  const numeric = (field: string, side: "ods" | "farmops"): number | null => {
    const f = diag.findings.find((x) => x.stable_id === stableId && x.field === field);
    if (f) return side === "ods" ? f.ods_value : f.farmops_value;
    const raw = text(field, side).trim();
    if (!raw) return null;
    const n = Number(raw.replace(/[^0-9.+-]/g, ""));
    return Number.isFinite(n) ? n : null;
  };

  const values: LoadSemanticDetailValue[] = DETAIL_FIELDS.filter((f) => byField.has(f)).map((f) => {
    const r = byField.get(f)!;
    return {
      field: f,
      label: r.label,
      ods_value: r.ods_value ?? "",
      farmops_value: r.farmops_value ?? "",
      differs: (r.ods_value ?? "").trim() !== (r.farmops_value ?? "").trim(),
      ods_worksheet: r.ods_worksheet ?? null,
      ods_column: r.ods_column ?? null,
      ods_row: r.ods_row ?? null,
      farmops_entity: r.farmops_entity ?? null,
      farmops_field: r.farmops_field ?? null,
      farmops_uuid: r.farmops_uuid ?? null,
    };
  });

  return {
    stable_id: stableId,
    description: text("description", "ods") || text("description", "farmops"),
    equipment_model: text("equipment_model", "ods") || text("equipment_model", "farmops"),
    canonical_volts: numeric("volts", "ods"),
    farmops_volts: numeric("volts", "farmops"),
    canonical_amps: numeric("amps", "ods"),
    farmops_amps: numeric("amps", "farmops"),
    canonical_connected_va: numeric("connected_va", "ods"),
    farmops_connected_va: numeric("connected_va", "farmops"),
    breaker_ocp: text("source_circuit", "ods") || text("circuit_group_ref", "farmops"),
    source_reference: text("source_reference", "ods") || text("source_reference", "farmops"),
    notes: byField.get("volts")?.note ?? byField.get("amps")?.note ?? "",
    buckets,
    values,
    targeted_review: buckets.includes("true_engineering_disagreement"),
  };
}

/* ------------------------------------------------------------- exports/CSV */

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function loadSemanticsCsv(review: LoadSemanticReview): string {
  const head = [
    "stable_id",
    "field",
    "unit",
    "ods_value",
    "farmops_value",
    "delta",
    "original_category",
    "proposed_category",
    "bucket",
    "ods_basis",
    "farmops_basis",
    "basis_proven",
    "proof",
    "disposition",
    "provenance",
  ];
  return [
    head.join(","),
    ...review.findings.map((f) =>
      [
        f.stable_id,
        f.field,
        f.unit,
        f.ods_value,
        f.farmops_value,
        f.delta,
        f.original_category,
        f.proposed_category,
        BUCKET_LABELS[f.bucket],
        f.ods_basis,
        f.farmops_basis,
        f.basis_proven,
        f.proof.join(" "),
        f.disposition,
        f.provenance,
      ]
        .map(csvCell)
        .join(","),
    ),
  ].join("\n");
}

export function loadSemanticsMarkdown(review: LoadSemanticReview): string {
  const lines = [
    "# Phase 4.4b — Load voltage / current semantic review",
    "",
    `- Version: ${review.version}`,
    `- Canonical workbook: ${review.generated_from_ods}`,
    `- Compared at: ${review.compared_at}`,
    `- Findings reviewed: ${review.findings.length} (all Category B on load volts/amps/VA)`,
    "- Read-only: no FarmOps values, canonical ODS, Boolean work, system-voltage migration, House breaker data or topology changed. No apply path.",
    "",
    "## Acceptance split",
    "",
    ...(Object.keys(review.counts) as LoadSemanticBucket[]).map(
      (b) => `- ${BUCKET_LABELS[b]}: ${review.counts[b]}`,
    ),
    "",
    "## Findings",
    "",
    "| Load | Field | Canonical | FarmOps | B → | Bucket | Basis (canonical / FarmOps) | Proven |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...review.findings.map(
      (f) =>
        `| ${f.stable_id} | ${f.field} | ${num(f.ods_value)} | ${num(f.farmops_value)} | ${f.proposed_category} | ${BUCKET_LABELS[f.bucket]} | ${f.ods_basis ?? "—"} / ${f.farmops_basis ?? "—"} | ${f.basis_proven ? "yes" : "no"} |`,
    ),
    "",
    "## Proposed semantic fields (not applied)",
    "",
    ...review.proposed_fields.map((p) => `- \`${p.field}\` — ${p.concept}. ${p.why}`),
  ];
  return lines.join("\n");
}

/**
 * The single numeric value both sides hold for a field when they agree (so no
 * finding was raised). Returns null when the sides differ or nothing parses.
 */
export function sharedNumericValue(
  report: ValidationReport,
  stableId: string,
  field: string,
): number | null {
  const rec = report.records.find(
    (r) => isLoadDomain(r.domain) && r.stable_id === stableId && r.field === field,
  );
  const parse = (raw: string) => {
    const t = (raw ?? "").trim();
    if (!t) return null;
    const n = Number(t.replace(/[^0-9.+-]/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  if (!rec) return null;
  const a = parse(rec.ods_value);
  const b = parse(rec.farmops_value);
  if (a === null && b === null) return null;
  if (a !== null && b !== null && a !== b) return null;
  return a ?? b;
}
