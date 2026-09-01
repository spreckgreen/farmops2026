// Phase 4.4b — Final load semantic adjudication (READ-ONLY).
//
// The nine former Category-B numeric findings across FS-034, FS-082, FS-083,
// FS-084 and FS-092 are adjudicated here into four production buckets. This
// module is the *evidence gate*: a numeric relationship (a value happening to
// equal a standard breaker size, or two voltages happening to be a classic
// utilization pair) is supporting evidence only. Without affirmative semantic
// provenance a finding falls to INSUFFICIENT_PROVENANCE.
//
// Nothing here writes anything: no FarmOps load values, no canonical ODS, no
// panel system-voltage migration, no Boolean reconciliation, no Category C/D
// findings, no House breaker/field-observation rows, no services/interties, no
// feeder or raceway topology, no IDs or relationships. There is deliberately no
// apply path.
import {
  NAMEPLATE_FOR_NOMINAL,
  NOMINAL_SUPPLY_VOLTAGES,
  isStandardOcpRating,
  BUCKET_LABELS as BASE_BUCKET_LABELS,
  type LoadSemanticBucket,
} from "@/lib/electrical-load-semantics";
import {
  evidenceCitations,
  hasOcpProvenance,
  hasVoltageConceptProvenance,
  type SemanticEvidence,
} from "@/lib/electrical-semantic-evidence";
import {
  equipmentEvidenceLines,
  type EquipmentDiscrepancy,
  type EquipmentGroup,
  type EquipmentProvenance,
} from "@/lib/electrical-equipment-provenance";

export const LOAD_ADJUDICATION_VERSION = "4.4b-load-semantic-adjudication-2-equipment-provenance";

/** The five loads under adjudication. */
export const ADJUDICATED_LOAD_IDS = ["FS-034", "FS-082", "FS-083", "FS-084", "FS-092"] as const;

/**
 * Adjudication buckets. The original four are kept verbatim; equipment
 * provenance adds three outcomes so a finding never has to be flattened into
 * "insufficient provenance" once its equipment identity is known.
 */
export type AdjudicationBucket =
  | LoadSemanticBucket
  | "calculation_basis_difference"
  | "engineering_value_supported_by_equipment_identity"
  | "equipment_identified_rating_verification_pending";

export const ADJUDICATION_BUCKET_ORDER: AdjudicationBucket[] = [
  "nominal_vs_nameplate_representation",
  "calculation_basis_difference",
  "engineering_value_supported_by_equipment_identity",
  "equipment_identified_rating_verification_pending",
  "current_ocp_semantic_mismatch",
  "true_engineering_disagreement",
  "insufficient_provenance",
];

export const ADJUDICATION_BUCKET_LABELS: Record<AdjudicationBucket, string> = {
  ...BASE_BUCKET_LABELS,
  calculation_basis_difference: "Calculation-basis difference",
  engineering_value_supported_by_equipment_identity:
    "Engineering value supported by equipment identity",
  equipment_identified_rating_verification_pending:
    "Equipment identified — electrical rating verification pending",
};

export const ADJUDICATION_BUCKET_CODES: Record<AdjudicationBucket, string> = {
  true_engineering_disagreement: "TRUE_ENGINEERING_DISAGREEMENT",
  nominal_vs_nameplate_representation: "NOMINAL_VS_NAMEPLATE_REPRESENTATION",
  current_ocp_semantic_mismatch: "CURRENT_OCP_SEMANTIC_MISMATCH",
  insufficient_provenance: "INSUFFICIENT_PROVENANCE",
  calculation_basis_difference: "CALCULATION_BASIS_DIFFERENCE",
  engineering_value_supported_by_equipment_identity:
    "ENGINEERING_VALUE_SUPPORTED_BY_EQUIPMENT_IDENTITY",
  equipment_identified_rating_verification_pending:
    "EQUIPMENT_IDENTIFIED_ELECTRICAL_RATING_VERIFICATION_PENDING",
};

export type Recommendation =
  | "KEEP_ODS_AND_CORRECT_FARMOPS"
  | "KEEP_FARMOPS_AND_UPDATE_ODS"
  | "PRESERVE_BOTH_AS_DISTINCT_SEMANTICS"
  | "CORRECT_FARMOPS_WITH_SEMANTIC_REPRESENTATION"
  | "FIELD_OR_DOCUMENT_VERIFICATION_REQUIRED"
  | "NO_CHANGE";

export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  KEEP_ODS_AND_CORRECT_FARMOPS: "Keep canonical ODS, correct FarmOps",
  KEEP_FARMOPS_AND_UPDATE_ODS: "Keep FarmOps, update canonical ODS",
  PRESERVE_BOTH_AS_DISTINCT_SEMANTICS: "Preserve both as distinct semantics",
  CORRECT_FARMOPS_WITH_SEMANTIC_REPRESENTATION:
    "Correct FarmOps using the additive semantic representation (no scalar collapse)",
  FIELD_OR_DOCUMENT_VERIFICATION_REQUIRED: "Field or document verification required",
  NO_CHANGE: "No change",
};


/* ------------------------------------------------------------- provenance */

// The evidence gate itself lives in `electrical-semantic-evidence` so the ODS
// upload review and this adjudication apply exactly the same rule.
export {
  evidenceCitations,
  hasOcpProvenance,
  hasVoltageConceptProvenance,
  type EvidenceCitation,
  type SemanticEvidence,
} from "@/lib/electrical-semantic-evidence";

/* ----------------------------------------------------------------- inputs */

export interface AdjudicationValuePair {
  /** Canonical ODS value, or null when the workbook states nothing. */
  ods: number | null;
  /** FarmOps stored value, or null when the column is empty. */
  farmops: number | null;
  /** Where the canonical value was read (worksheet + row/column). */
  ods_provenance: string;
  /** Where the FarmOps value lives (entity.field). */
  farmops_provenance: string;
}

export interface AdjudicationLoadInput {
  stable_id: string;
  description: string;
  equipment_model: string | null;
  /** One entry per differing field; agreeing fields belong in `agreed`. */
  fields: Partial<Record<"volts" | "amps" | "connected_va" | "demand_va", AdjudicationValuePair>>;
  /** Values both sides agree on, used to prove/refute a VA basis. */
  agreed?: Partial<Record<"volts" | "amps" | "connected_va", number>>;
  evidence?: SemanticEvidence;
  /** Free-text open questions carried from prior phases. */
  open_questions?: string[];
}

/* ---------------------------------------------------------------- outputs */

export interface AdjudicatedFinding {
  stable_id: string;
  description: string;
  field: "volts" | "amps" | "connected_va" | "demand_va";
  unit: string;
  ods_value: number | null;
  farmops_value: number | null;
  ods_provenance: string;
  farmops_provenance: string;
  bucket: LoadSemanticBucket;
  /** Provenance that would justify a semantic reclassification, when present. */
  evidence: string[];
  /** Numeric facts that support but never establish a classification. */
  supporting_only: string[];
  reason: string;
  recommendation: Recommendation;
  /** What is missing before the finding can leave insufficient provenance. */
  missing_evidence: string[];
}

export type ObservationKind = "observed" | "inferred_candidate" | "not_established";

export interface AdjudicatedConcept {
  concept: string;
  value: string;
  kind: ObservationKind;
  source: string;
}

export interface AdjudicatedLoad {
  stable_id: string;
  description: string;
  equipment: string;
  concepts: AdjudicatedConcept[];
  unresolved_questions: string[];
  buckets: LoadSemanticBucket[];
}

export interface LoadAdjudicationReport {
  version: string;
  generated_at: string;
  findings: AdjudicatedFinding[];
  counts: Record<LoadSemanticBucket, number>;
  loads: AdjudicatedLoad[];
  total_findings: number;
  read_only: true;
  apply_available: false;
}

const UNITS: Record<string, string> = {
  volts: "V",
  amps: "A",
  connected_va: "VA",
  demand_va: "VA",
};

const n = (v: number | null) => (v === null ? "not stated" : String(v));

const isNominal = (v: number | null) =>
  v !== null && (NOMINAL_SUPPLY_VOLTAGES as readonly number[]).includes(v);

const utilizationPair = (a: number | null, b: number | null) => {
  if (a === null || b === null || a === b) return null;
  for (const [nom, name] of [
    [a, b],
    [b, a],
  ] as [number, number][]) {
    if (isNominal(nom) && isNominal(name)) return null;
    if (isNominal(nom) && (NAMEPLATE_FOR_NOMINAL[nom] ?? []).includes(name)) {
      return { nominal: nom, nameplate: name };
    }
  }
  return null;
};

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005);

/* ----------------------------------------------------------- classifiers */

function classifyVolts(load: AdjudicationLoadInput, p: AdjudicationValuePair): Omit<AdjudicatedFinding, "stable_id" | "description" | "field" | "unit" | "ods_value" | "farmops_value" | "ods_provenance" | "farmops_provenance"> {
  const pair = utilizationPair(p.ods, p.farmops);
  const evidence = evidenceCitations(load.evidence).map((c) => `${c.source}: ${c.detail}`);
  const conceptProven = hasVoltageConceptProvenance(load.evidence);

  if (isNominal(p.ods) && isNominal(p.farmops)) {
    return {
      bucket: "true_engineering_disagreement",
      evidence,
      supporting_only: [
        `${n(p.ods)} V and ${n(p.farmops)} V are both nominal system voltages of this installation.`,
      ],
      reason:
        "Both sides state a nominal system voltage. Two different nominal systems cannot describe one connection, so this is a real engineering disagreement — not a representation difference.",
      recommendation: "FIELD_OR_DOCUMENT_VERIFICATION_REQUIRED",
      missing_evidence: [
        "Field verification of the actual supply serving this load (circuit, breaker poles, panel).",
      ],
    };
  }

  if (pair && conceptProven) {
    return {
      bucket: "nominal_vs_nameplate_representation",
      evidence,
      supporting_only: [
        `${pair.nominal} V nominal / ${pair.nameplate} V is a recognised utilization designation pair.`,
      ],
      reason:
        "Provenance establishes that one value is the nominal supply voltage and the other the equipment rated/nameplate voltage. Both are correct on their own basis.",
      recommendation: "PRESERVE_BOTH_AS_DISTINCT_SEMANTICS",
      missing_evidence: [],
    };
  }

  return {
    bucket: "insufficient_provenance",
    evidence,
    supporting_only: pair
      ? [
          `${pair.nominal} V / ${pair.nameplate} V is mathematically a classic nominal-vs-nameplate pair — supporting evidence only.`,
        ]
      : [`${n(p.ods)} V vs ${n(p.farmops)} V is not a recognised utilization pair.`],
    reason: pair
      ? "The pair is compatible with a nominal-vs-nameplate reading, but no citation states that either value is a nominal supply or an equipment nameplate voltage. Compatibility alone is not provenance."
      : "Neither side documents what its voltage represents, and the values are not a recognised nominal/nameplate pair.",
    recommendation: "FIELD_OR_DOCUMENT_VERIFICATION_REQUIRED",
    missing_evidence: [
      "Equipment nameplate photo or specification sheet stating the rated voltage.",
      "A canonical note or design document stating the nominal supply voltage for this load.",
    ],
  };
}

function classifyAmps(load: AdjudicationLoadInput, p: AdjudicationValuePair) {
  const evidence = evidenceCitations(load.evidence).map((c) => `${c.source}: ${c.detail}`);
  const ocpProven = hasOcpProvenance(load.evidence);
  const hi = Math.max(p.ods ?? 0, p.farmops ?? 0);
  const lo = Math.min(p.ods ?? 0, p.farmops ?? 0);
  const zeroSide = p.ods === 0 || p.farmops === 0;
  const ladder = !zeroSide && lo > 0 && isStandardOcpRating(hi) && hi >= lo * 1.25;

  if (zeroSide) {
    return {
      bucket: "insufficient_provenance" as LoadSemanticBucket,
      evidence,
      supporting_only: [
        `One side states an explicit 0 A (${n(p.ods)} A vs ${n(p.farmops)} A).`,
      ],
      reason:
        "An explicit zero is neither an equipment current nor a design current until its meaning is documented; it may be a placeholder for equipment not yet selected or not yet installed.",
      recommendation: "FIELD_OR_DOCUMENT_VERIFICATION_REQUIRED" as Recommendation,
      missing_evidence: [
        "Statement of whether 0 A means 'not installed', 'not yet sized' or 'no load'.",
        "Equipment identity / nameplate for the non-zero side, with the date and source of that value.",
      ],
    };
  }

  if (ladder && ocpProven) {
    return {
      bucket: "current_ocp_semantic_mismatch" as LoadSemanticBucket,
      evidence,
      supporting_only: [
        `${hi} A is a standard NEC 240.6(A) rating and is ≥ 125 % of ${lo} A.`,
      ],
      reason:
        "Provenance affirmatively identifies the larger value as overcurrent protection / circuit sizing and the smaller as equipment current. Two distinct quantities are sharing one column.",
      recommendation: "PRESERVE_BOTH_AS_DISTINCT_SEMANTICS" as Recommendation,
      missing_evidence: [],
    };
  }

  if (ladder) {
    return {
      bucket: "insufficient_provenance" as LoadSemanticBucket,
      evidence,
      supporting_only: [
        `${hi} A is a standard NEC 240.6(A) rating — supporting evidence only.`,
        `${hi} A is ≥ 125 % of ${lo} A — supporting evidence only.`,
      ],
      reason:
        "No mapped OCP field, equipment specification, canonical note or FarmOps OCP relationship states that the larger value is circuit protection. A number equalling a standard breaker size does not establish OCP semantics.",
      recommendation: "FIELD_OR_DOCUMENT_VERIFICATION_REQUIRED" as Recommendation,
      missing_evidence: [
        `Documentation that ${hi} A is the breaker / OCP rating rather than a stated load current.`,
        `Equipment nameplate or specification confirming ${lo} A running current.`,
      ],
    };
  }

  return {
    bucket: "true_engineering_disagreement" as LoadSemanticBucket,
    evidence,
    supporting_only: [`${n(p.ods)} A vs ${n(p.farmops)} A: neither an OCP-ladder relationship nor an explicit zero.`],
    reason: "Both sides state an explicit current for the same quantity and they differ.",
    recommendation: "FIELD_OR_DOCUMENT_VERIFICATION_REQUIRED" as Recommendation,
    missing_evidence: ["An engineering disposition selecting the governing current value."],
  };
}

function classifyVa(load: AdjudicationLoadInput, field: string, p: AdjudicationValuePair) {
  const evidence = evidenceCitations(load.evidence).map((c) => `${c.source}: ${c.detail}`);
  const volts = load.fields.volts;
  const ampsPair = load.fields.amps;
  const sharedAmps =
    ampsPair === undefined
      ? (load.agreed?.amps ?? null)
      : ampsPair.ods !== null && ampsPair.ods === ampsPair.farmops
        ? ampsPair.ods
        : null;
  const pair = volts ? utilizationPair(volts.ods, volts.farmops) : null;
  const conceptProven = hasVoltageConceptProvenance(load.evidence);
  const arithmetic =
    volts &&
    sharedAmps !== null &&
    volts.ods !== null &&
    volts.farmops !== null &&
    p.ods !== null &&
    p.farmops !== null &&
    close(volts.ods * sharedAmps, p.ods) &&
    close(volts.farmops * sharedAmps, p.farmops);

  const supporting: string[] = [];
  if (arithmetic && volts && sharedAmps !== null) {
    supporting.push(
      `Canonical ${volts.ods} V × ${sharedAmps} A = ${n(p.ods)} ${UNITS[field]}; FarmOps ${volts.farmops} V × ${sharedAmps} A = ${n(p.farmops)} ${UNITS[field]}.`,
      `Current is identical on both sides (${sharedAmps} A), so the whole difference follows from the voltage basis.`,
    );
  }

  if (arithmetic && pair && conceptProven) {
    return {
      bucket: "nominal_vs_nameplate_representation" as LoadSemanticBucket,
      evidence,
      supporting_only: supporting,
      reason:
        "Voltage concepts are established by provenance, current is identical on both sides, and the arithmetic reproduces both VA figures. The difference is the documented VA basis, not a disagreement.",
      recommendation: "PRESERVE_BOTH_AS_DISTINCT_SEMANTICS" as Recommendation,
      missing_evidence: [],
    };
  }

  const missing: string[] = [];
  if (!conceptProven)
    missing.push("Provenance establishing nominal-supply vs equipment-nameplate voltage for this load.");
  if (sharedAmps === null) missing.push("A single agreed current, so the VA basis can be isolated.");
  if (!arithmetic) missing.push("A stated VA basis (nominal, nameplate or manufacturer-stated) for each figure.");

  return {
    bucket: "insufficient_provenance" as LoadSemanticBucket,
    evidence,
    supporting_only: supporting.length
      ? supporting.map((s) => `${s} Supporting evidence only.`)
      : [`Canonical ${n(p.ods)} ${UNITS[field]} vs FarmOps ${n(p.farmops)} ${UNITS[field]}.`],
    reason: arithmetic
      ? "The arithmetic is consistent with a voltage-basis difference, but the prerequisite voltage semantics are not established, so the VA difference cannot be reclassified as representation."
      : "No documented VA basis on at least one side, so the difference cannot be attributed to a basis rather than to an engineering disagreement.",
    recommendation: "FIELD_OR_DOCUMENT_VERIFICATION_REQUIRED" as Recommendation,
    missing_evidence: missing,
  };
}

/* ----------------------------------------------------------- adjudication */

function conceptsFor(load: AdjudicationLoadInput): AdjudicatedConcept[] {
  const volts = load.fields.volts;
  const amps = load.fields.amps;
  const va = load.fields.connected_va;
  const pair = volts ? utilizationPair(volts.ods, volts.farmops) : null;
  const conceptProven = hasVoltageConceptProvenance(load.evidence);
  const ocpProven = hasOcpProvenance(load.evidence);
  const out: AdjudicatedConcept[] = [];

  const agreedVolts = load.agreed?.volts ?? null;
  if (agreedVolts !== null) {
    out.push({
      concept: "Nominal supply voltage",
      value: `${agreedVolts} V`,
      kind: "observed",
      source: "Canonical ODS and FarmOps agree",
    });
    out.push({
      concept: "Rated / nameplate voltage",
      value: "not established",
      kind: "not_established",
      source: "No nameplate documentation on file",
    });
  } else if (volts) {
    const nominal = pair ? pair.nominal : null;
    out.push({
      concept: "Nominal supply voltage",
      value: nominal !== null ? `${nominal} V` : `${n(volts.ods)} V / ${n(volts.farmops)} V disputed`,
      kind: nominal !== null ? (conceptProven ? "observed" : "inferred_candidate") : "not_established",
      source:
        nominal !== null
          ? conceptProven
            ? "Established by cited provenance"
            : "Candidate only — inferred from the utilization-voltage table"
          : "Both sides state a nominal system voltage and they disagree",
    });
    out.push({
      concept: "Rated / nameplate voltage",
      value: pair ? `${pair.nameplate} V` : "not established",
      kind: pair ? (conceptProven ? "observed" : "inferred_candidate") : "not_established",
      source: pair
        ? conceptProven
          ? "Established by cited provenance"
          : "Candidate only — no nameplate or specification evidence"
        : "No nameplate documentation on file",
    });
  } else {
    out.push({
      concept: "Nominal supply voltage",
      value: "not established",
      kind: "not_established",
      source: "No voltage comparison on this load",
    });
  }

  const agreedAmps = load.agreed?.amps ?? null;
  out.push({
    concept: "Equipment current",
    value:
      agreedAmps !== null
        ? `${agreedAmps} A`
        : amps
          ? `${n(amps.ods)} A (ODS) / ${n(amps.farmops)} A (FarmOps)`
          : "not established",
    kind: agreedAmps !== null ? "observed" : amps ? "inferred_candidate" : "not_established",
    source:
      agreedAmps !== null
        ? "Canonical ODS and FarmOps agree"
        : amps
          ? "Disputed; which quantity each column holds is undocumented"
          : "No current comparison on this load",
  });

  out.push({
    concept: "Circuit / OCP rating",
    value: ocpProven && amps ? `${Math.max(amps.ods ?? 0, amps.farmops ?? 0)} A` : "not established",
    kind: ocpProven ? "observed" : "not_established",
    source: ocpProven
      ? "Cited OCP provenance"
      : "No mapped OCP field, breaker relationship or specification for this load",
  });

  const agreedVa = load.agreed?.connected_va ?? null;
  out.push({
    concept: "Connected VA",
    value:
      agreedVa !== null
        ? `${agreedVa} VA`
        : va
          ? `${n(va.ods)} VA (ODS) / ${n(va.farmops)} VA (FarmOps)`
          : "not established",
    kind: agreedVa !== null ? "observed" : va ? "inferred_candidate" : "not_established",
    source:
      agreedVa !== null
        ? "Canonical ODS and FarmOps agree"
        : va
          ? "Disputed figures"
          : "No connected VA comparison on this load",
  });

  out.push({
    concept: "Connected VA basis",
    value: "not established",
    kind: "not_established",
    source: "FarmOps has no connected_va_basis field; no canonical note states the basis",
  });

  return out;
}

/**
 * Adjudicate the supplied load findings. Pure: no reads, no writes, no
 * side effects, and no apply path.
 */
export function adjudicateLoads(
  loads: AdjudicationLoadInput[],
  generatedAt = new Date().toISOString(),
): LoadAdjudicationReport {
  const findings: AdjudicatedFinding[] = [];

  for (const load of [...loads].sort((a, b) => a.stable_id.localeCompare(b.stable_id))) {
    for (const field of ["volts", "amps", "connected_va", "demand_va"] as const) {
      const p = load.fields[field];
      if (!p) continue;
      const verdict =
        field === "volts"
          ? classifyVolts(load, p)
          : field === "amps"
            ? classifyAmps(load, p)
            : classifyVa(load, field, p);
      findings.push({
        stable_id: load.stable_id,
        description: load.description,
        field,
        unit: UNITS[field] ?? "",
        ods_value: p.ods,
        farmops_value: p.farmops,
        ods_provenance: p.ods_provenance,
        farmops_provenance: p.farmops_provenance,
        ...verdict,
      });
    }
  }

  const counts: Record<LoadSemanticBucket, number> = {
    true_engineering_disagreement: 0,
    nominal_vs_nameplate_representation: 0,
    current_ocp_semantic_mismatch: 0,
    insufficient_provenance: 0,
  };
  for (const f of findings) counts[f.bucket] += 1;

  const summary = [...loads]
    .sort((a, b) => a.stable_id.localeCompare(b.stable_id))
    .map<AdjudicatedLoad>((load) => ({
      stable_id: load.stable_id,
      description: load.description,
      equipment: load.equipment_model?.trim() || "not established",
      concepts: conceptsFor(load),
      unresolved_questions: [
        ...(load.open_questions ?? []),
        ...findings
          .filter((f) => f.stable_id === load.stable_id)
          .flatMap((f) => f.missing_evidence.map((m) => `${f.field}: ${m}`)),
      ],
      buckets: [
        ...new Set(findings.filter((f) => f.stable_id === load.stable_id).map((f) => f.bucket)),
      ],
    }));

  return {
    version: LOAD_ADJUDICATION_VERSION,
    generated_at: generatedAt,
    findings,
    counts,
    loads: summary,
    total_findings: findings.length,
    read_only: true,
    apply_available: false,
  };
}

/* --------------------------------------------------------------- exports */

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function adjudicationCsv(report: LoadAdjudicationReport): string {
  const head = [
    "stable_id",
    "description",
    "field",
    "unit",
    "ods_value",
    "farmops_value",
    "semantic_bucket",
    "ods_provenance",
    "farmops_provenance",
    "evidence",
    "supporting_only",
    "reason",
    "missing_evidence",
    "recommendation",
  ];
  return [
    head.join(","),
    ...report.findings.map((f) =>
      [
        f.stable_id,
        f.description,
        f.field,
        f.unit,
        f.ods_value,
        f.farmops_value,
        f.bucket,
        f.ods_provenance,
        f.farmops_provenance,
        f.evidence.join(" | ") || "none",
        f.supporting_only.join(" | "),
        f.reason,
        f.missing_evidence.join(" | "),
        f.recommendation,
      ]
        .map(cell)
        .join(","),
    ),
  ].join("\n");
}

export function adjudicationMarkdown(report: LoadAdjudicationReport): string {
  const lines: string[] = [
    "# Phase 4.4b — Final load semantic adjudication report",
    "",
    `- Version: ${report.version}`,
    `- Generated: ${report.generated_at}`,
    `- Findings adjudicated: ${report.total_findings}`,
    "- Read-only: no FarmOps load values, canonical ODS, panel system-voltage migration, Boolean reconciliation, Category C/D findings, House breaker/field-observation data, services/interties, topology, IDs or relationships were changed. There is no apply path.",
    "",
    "## Bucket totals",
    "",
    `- TRUE_ENGINEERING_DISAGREEMENT: ${report.counts.true_engineering_disagreement}`,
    `- NOMINAL_VS_NAMEPLATE_REPRESENTATION: ${report.counts.nominal_vs_nameplate_representation}`,
    `- CURRENT_OCP_SEMANTIC_MISMATCH: ${report.counts.current_ocp_semantic_mismatch}`,
    `- INSUFFICIENT_PROVENANCE: ${report.counts.insufficient_provenance}`,
    `- Total: ${report.total_findings}`,
    "",
    "## Findings",
    "",
  ];
  for (const f of report.findings) {
    lines.push(
      `### ${f.stable_id} · ${f.field} (${f.unit}) — ${f.bucket}`,
      "",
      `- Load: ${f.description}`,
      `- Canonical ODS: ${n(f.ods_value)} (${f.ods_provenance})`,
      `- FarmOps: ${n(f.farmops_value)} (${f.farmops_provenance})`,
      `- Affirmative evidence: ${f.evidence.length ? f.evidence.join("; ") : "none on file"}`,
      `- Supporting only: ${f.supporting_only.join(" ") || "—"}`,
      `- Reason: ${f.reason}`,
      `- Missing evidence: ${f.missing_evidence.join("; ") || "—"}`,
      `- Recommendation: ${f.recommendation}`,
      "",
    );
  }
  lines.push("## Load semantic summary", "");
  for (const l of report.loads) {
    lines.push(`### ${l.stable_id} — ${l.description}`, "", `- Equipment: ${l.equipment}`);
    for (const c of l.concepts) {
      lines.push(`- ${c.concept}: ${c.value} [${c.kind}] — ${c.source}`);
    }
    lines.push(
      `- Unresolved: ${l.unresolved_questions.length ? l.unresolved_questions.join("; ") : "none"}`,
      "",
    );
  }
  return lines.join("\n");
}
