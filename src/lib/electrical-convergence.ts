/**
 * Phase 4.4b — Parallel Validation convergence / disposition layer.
 *
 * This module deliberately does NOT compare anything. The raw comparison
 * produced by `electrical-parallel-validation.ts` is immutable and remains
 * reproducible from the canonical ODS SHA plus the FarmOps snapshot. Here we
 * only lay the *already established* adjudications over that raw result as a
 * second, separate measure:
 *
 *   raw classification  →  adjudication (if any)  →  current disposition
 *
 * Invariants:
 *  - An adjudicated scalar inequality never becomes a raw MATCH. The raw
 *    classification of every finding is preserved verbatim.
 *  - An adjudication may only affect convergence counts when it references the
 *    same canonical ODS SHA as the current run *and* the applicable stable ID
 *    and field. Anything else is reported as stale and reduces nothing.
 *  - No writes, no migrations, no ODS edits, no FarmOps corrections.
 */
import {
  CLASSIFICATION_LABELS,
  type Classification,
  type ComparisonRecord,
  type ValidationReport,
} from "@/lib/electrical-parallel-validation";
import { PHASE_44A_BASELINE_SHA256 } from "@/lib/electrical-adjudication-baseline";

export const CONVERGENCE_VERSION = "4.4b-parallel-validation-convergence-1";

/* ------------------------------------------------------------ dispositions */

export const CONVERGENCE_DISPOSITIONS = [
  "UNADJUDICATED",
  "CANONICAL_ODS_CORRECTION_REQUIRED",
  "FARMOPS_CORRECTION_REQUIRED",
  "SEMANTIC_REPRESENTATION_DIFFERENCE",
  "CURRENT_SEMANTICS_UNRESOLVED",
  "PROVENANCE_VERIFICATION_REQUIRED",
  "FIELD_VERIFICATION_REQUIRED",
  "EXPECTED_TRANSFORMATION",
  "FARMOPS_AS_BUILT_ADDITION",
  "FARMOPS_AS_BUILT_VALUE_VERIFIED",
  "PLACEHOLDER_PRESERVED_AS_NULL",
  "RESOLVED_NO_WRITE_REQUIRED",
] as const;
export type ConvergenceDisposition = (typeof CONVERGENCE_DISPOSITIONS)[number];

export const CONVERGENCE_DISPOSITION_LABELS: Record<ConvergenceDisposition, string> = {
  UNADJUDICATED: "Unadjudicated",
  CANONICAL_ODS_CORRECTION_REQUIRED: "Canonical ODS correction required",
  FARMOPS_CORRECTION_REQUIRED: "FarmOps correction required",
  SEMANTIC_REPRESENTATION_DIFFERENCE: "Semantic representation difference (Category F)",
  CURRENT_SEMANTICS_UNRESOLVED: "Current semantics unresolved",
  PROVENANCE_VERIFICATION_REQUIRED: "Provenance verification required",
  FIELD_VERIFICATION_REQUIRED: "Field verification required",
  EXPECTED_TRANSFORMATION: "Expected transformation",
  FARMOPS_AS_BUILT_ADDITION: "FarmOps as-built addition",
  FARMOPS_AS_BUILT_VALUE_VERIFIED:
    "FarmOps as-built value verified (field/manufacturer provenance — value confirmed, not corrected, ODS untouched)",
  PLACEHOLDER_PRESERVED_AS_NULL:
    "Placeholder preserved as NULL (Category C — source token retained as provenance, no number written)",
  RESOLVED_NO_WRITE_REQUIRED: "Resolved — no write required",
};

/** Dispositions that still leave a finding open for Phase 4.5. */
export const UNRESOLVED_DISPOSITIONS = new Set<ConvergenceDisposition>([
  "UNADJUDICATED",
  "CURRENT_SEMANTICS_UNRESOLVED",
  "PROVENANCE_VERIFICATION_REQUIRED",
  "FIELD_VERIFICATION_REQUIRED",
]);

/** Dispositions that record a decided outcome requiring no further evidence. */
export const CLOSED_DISPOSITIONS = new Set<ConvergenceDisposition>([
  "SEMANTIC_REPRESENTATION_DIFFERENCE",
  "EXPECTED_TRANSFORMATION",
  "FARMOPS_AS_BUILT_ADDITION",
  "FARMOPS_AS_BUILT_VALUE_VERIFIED",
  "PLACEHOLDER_PRESERVED_AS_NULL",
  "RESOLVED_NO_WRITE_REQUIRED",
]);



/* ------------------------------------------- established adjudication registry */

/**
 * An adjudication already established elsewhere in Phase 4.4b (Electrical →
 * Adjudication). Each entry is bound to the canonical workbook SHA it was
 * adjudicated against and to the specific stable ID / FarmOps field.
 */
export interface EstablishedAdjudication {
  id: string;
  /** Where the adjudication was established, for traceability. */
  source: string;
  stable_id: string;
  /** FarmOps field keys this adjudication applies to. */
  fields: string[];
  /** Canonical ODS SHA-256 the adjudication was made against. */
  ods_sha256: string;
  /** Classification recorded by the adjudicating engine. */
  classification: string;
  disposition: ConvergenceDisposition;
  /** Numeric semantics category, when the adjudication assigned one. */
  category?: "A" | "B" | "C" | "D" | "E" | "F";
  rationale: string;
  /** Facts that must survive convergence — both source values, never merged. */
  preserved: string[];
  /** Structural guarantee: consuming this never authorizes a write. */
  write_authorized: false;
}

export const ESTABLISHED_ADJUDICATIONS: EstablishedAdjudication[] = [
  {
    id: "bryant-fs-082-volts",
    source: "Bryant nominal supply voltage adjudication → canonical ODS correction queue",
    stable_id: "FS-082",
    fields: ["volts"],
    ods_sha256: PHASE_44A_BASELINE_SHA256,
    classification: "CANONICAL_ODS_VALUE_INCOMPATIBLE_WITH_VERIFIED_EQUIPMENT",
    disposition: "CANONICAL_ODS_CORRECTION_REQUIRED",
    rationale:
      "Canonical ODS states 120 V for equipment whose verified nameplate cannot be supplied at 120 V. The correction belongs to the controlled ODS workflow, not to FarmOps.",
    preserved: [
      "ODS observed: 120 V",
      "FarmOps as-built: 240 V",
      "Verified equipment: 208/230 VAC, 1Ø, 60 Hz",
    ],
    write_authorized: false,
  },
  {
    id: "bryant-fs-083-volts",
    source: "Bryant nominal supply voltage adjudication → canonical ODS correction queue",
    stable_id: "FS-083",
    fields: ["volts"],
    ods_sha256: PHASE_44A_BASELINE_SHA256,
    classification: "CANONICAL_ODS_VALUE_INCOMPATIBLE_WITH_VERIFIED_EQUIPMENT",
    disposition: "CANONICAL_ODS_CORRECTION_REQUIRED",
    rationale:
      "Canonical ODS states 120 V for equipment whose verified nameplate cannot be supplied at 120 V. The correction belongs to the controlled ODS workflow, not to FarmOps.",
    preserved: [
      "ODS observed: 120 V",
      "FarmOps as-built: 240 V",
      "Verified equipment: 208/230 VAC, 1Ø, 60 Hz",
    ],
    write_authorized: false,
  },
  {
    id: "representation-fs-034",
    source: "FS-034 / FS-092 voltage & VA semantic representation proposal (Category F)",
    stable_id: "FS-034",
    fields: ["volts", "connected_va"],
    ods_sha256: PHASE_44A_BASELINE_SHA256,
    classification: "SEMANTIC_REPRESENTATION_DIFFERENCE",
    disposition: "SEMANTIC_REPRESENTATION_DIFFERENCE",
    category: "F",
    rationale:
      "Nominal supply voltage and rated nameplate voltage are different concepts, and the two VA values differ only by calculation basis. Both representations are correct and both are preserved.",
    preserved: [
      "nominal_supply_voltage: 240 V",
      "rated_nameplate_voltage: 220 V",
      "connected_va 7200 (basis: nominal/design supply voltage)",
      "connected_va 6600 (basis: nameplate voltage)",
    ],
    write_authorized: false,
  },
  {
    id: "representation-fs-092",
    source: "FS-034 / FS-092 voltage & VA semantic representation proposal (Category F)",
    stable_id: "FS-092",
    fields: ["volts", "connected_va"],
    ods_sha256: PHASE_44A_BASELINE_SHA256,
    classification: "SEMANTIC_REPRESENTATION_DIFFERENCE",
    disposition: "SEMANTIC_REPRESENTATION_DIFFERENCE",
    category: "F",
    rationale:
      "Nominal supply voltage and rated nameplate voltage are different concepts, and the two VA values differ only by calculation basis. Both representations are correct and both are preserved.",
    preserved: [
      "nominal_supply_voltage: 120 V",
      "rated_nameplate_voltage: 115 V",
      "connected_va 1056 (basis: nominal/design supply voltage)",
      "connected_va 1012 (basis: nameplate voltage, 115 × 8.8)",
      "equipment_fla: 8.8 A",
    ],
    write_authorized: false,
  },
  {
    id: "amp-semantics-fs-082",
    source: "Bryant amperage semantic adjudication",
    stable_id: "FS-082",
    fields: ["amps"],
    ods_sha256: PHASE_44A_BASELINE_SHA256,
    classification: "ZERO_AMPS_NOT_ESTABLISHED_AS_ZERO_LOAD",
    disposition: "CURRENT_SEMANTICS_UNRESOLVED",
    rationale:
      "The canonical Amps field holds 0 with no provenance establishing a real zero-current condition, and the field's electrical concept is not proven. MOCP is not load current and MCA is not derived.",
    preserved: [
      "ODS Amps: 0 — not established as a verified zero-load condition",
      "Verified equipment: MOCP 25 A, RCA 1.69 A, RLA 4.15 A",
    ],
    write_authorized: false,
  },
  {
    id: "amp-semantics-fs-083",
    source: "Bryant amperage semantic adjudication",
    stable_id: "FS-083",
    fields: ["amps"],
    ods_sha256: PHASE_44A_BASELINE_SHA256,
    classification: "ZERO_AMPS_NOT_ESTABLISHED_AS_ZERO_LOAD",
    disposition: "CURRENT_SEMANTICS_UNRESOLVED",
    rationale:
      "The canonical Amps field holds 0 with no provenance establishing a real zero-current condition, and the field's electrical concept is not proven. MOCP is not load current and MCA is not derived.",
    preserved: [
      "ODS Amps: 0 — not established as a verified zero-load condition",
      "Verified equipment: MOCP 25 A, RCA 1.69 A, RLA 4.15 A",
    ],
    write_authorized: false,
  },
  {
    id: "amp-semantics-fs-084",
    source: "Bryant amperage semantic adjudication → current semantic migration plan",
    stable_id: "FS-084",
    fields: ["amps", "connected_va"],
    ods_sha256: PHASE_44A_BASELINE_SHA256,
    classification: "AMP_FIELD_SEMANTICS_UNRESOLVED",
    disposition: "CURRENT_SEMANTICS_UNRESOLVED",
    rationale:
      "The 60 A value cannot be proven to be connected load current, FLA, MCA or installed OCP rating. The dependent VA inherits that ambiguity.",
    preserved: [
      "ODS Amps: 60 — electrical concept unresolved",
      "ODS Connected VA: 14400 — formula-derived from the unresolved 240 × 60",
    ],
    write_authorized: false,
  },
  ...PNL_H1_VERIFIED_FIELDS.map((f) => ({
    id: `pnl-h1-label-verified-${f.field}`,
    source: "PNL-H1 Category-D field provenance adjudication (owner-supplied manufacturer label photograph)",
    stable_id: f.stable_id,
    fields: [f.field],
    ods_sha256: PHASE_44A_BASELINE_SHA256,
    classification: "FARMOPS_AS_BUILT_VALUE_VERIFIED",
    disposition: "FARMOPS_AS_BUILT_VALUE_VERIFIED" as const,
    category: "D" as const,
    rationale: `The canonical workbook states nothing for ${f.label}; the installed ${PNL_H1_LABEL_OBSERVATION.manufacturer} ${PNL_H1_LABEL_OBSERVATION.catalog_model} manufacturer label establishes it. This is a FarmOps as-built addition verified by field/manufacturer provenance — not a canonical ODS correction and not an engineering disagreement. The existing FarmOps value ${f.farmops_value} is verified, not corrected, and the ODS is not modified.`,
    preserved: pnlH1PreservedFacts(f.field),
    write_authorized: false as const,
  })),
];


export interface AdjudicationMatch {
  adjudication: EstablishedAdjudication;
  /** True when the adjudication's SHA equals the SHA of the current run. */
  sha_matches: boolean;
}

/** Every registry entry that names this stable ID and field, SHA aside. */
export function adjudicationsFor(stable_id: string, field: string): EstablishedAdjudication[] {
  return ESTABLISHED_ADJUDICATIONS.filter(
    (a) => a.stable_id === stable_id && a.fields.includes(field),
  );
}

/**
 * Default disposition for a raw non-match with no established adjudication.
 * Never optimistic: anything that has not been decided stays UNADJUDICATED.
 */
export function defaultDisposition(record: ComparisonRecord): ConvergenceDisposition {
  if (record.classification === "EXPECTED_TRANSFORMATION") return "EXPECTED_TRANSFORMATION";
  if (record.classification === "FARMOPS_AS_BUILT_ADDITION") return "FARMOPS_AS_BUILT_ADDITION";
  if (record.classification === "FARMOPS_ONLY") {
    switch (record.farmops_only_category) {
      case "A":
        return "FARMOPS_AS_BUILT_ADDITION";
      case "B":
        return "RESOLVED_NO_WRITE_REQUIRED";
      case "C":
      case "D":
        return "FARMOPS_CORRECTION_REQUIRED";
      default:
        return "UNADJUDICATED";
    }
  }
  if (record.classification === "INCOMPLETE" || record.tbd) return "FIELD_VERIFICATION_REQUIRED";
  return "UNADJUDICATED";
}

export interface ConvergenceFinding {
  domain: string;
  stable_id: string;
  field: string;
  label: string;
  /** Immutable raw comparison outcome — never rewritten by adjudication. */
  raw_classification: Classification;
  raw_ods_value: string;
  raw_farmops_value: string;
  raw_disposition: string;
  raw_authority_class: string;
  /** The adjudication that applied, when one did and its SHA matched. */
  adjudication: EstablishedAdjudication | null;
  /** Adjudications naming this finding from a different workbook SHA. */
  stale_adjudications: EstablishedAdjudication[];
  adjudication_classification: string | null;
  disposition: ConvergenceDisposition;
  /** True when the disposition came from the default ladder, not a registry entry. */
  derived: boolean;
  unresolved: boolean;
  preserved: string[];
  rationale: string;
}

export interface StaleAdjudicationNotice {
  adjudication: EstablishedAdjudication;
  expected_sha256: string;
  run_sha256: string;
  /** Findings it would have dispositioned had the SHA matched. */
  affected: { stable_id: string; field: string }[];
}

export interface ConvergenceReport {
  version: string;
  generated_at: string;
  ods: { file_name: string; sha256: string };
  /** The immutable raw measure, copied verbatim from the comparison. */
  raw_summary: Record<Classification, number>;
  findings: ConvergenceFinding[];
  counts: {
    raw_findings: number;
    adjudicated: number;
    unresolved: number;
    /** Raw CONFLICT findings, exactly as the immutable comparison counted them. */
    conflicts_total: number;
    /** Conflicts carrying an adjudication valid at this workbook SHA. */
    conflicts_adjudicated: number;
    /** Conflicts still open — the only conflict measure Phase 4.5 may use. */
    conflicts_unresolved: number;
    canonical_corrections_pending: number;
    farmops_corrections_pending: number;
    semantic_representation_differences: number;
    current_semantics_unresolved: number;
    provenance_or_field_verification_pending: number;
    expected_transformations: number;
    farmops_as_built_additions: number;
  };

  by_disposition: Record<ConvergenceDisposition, number>;
  /** Per raw classification: raw / adjudicated / unresolved, kept separate. */
  by_raw_classification: Record<
    Classification,
    { raw: number; adjudicated: number; unresolved: number }
  >;
  stale: StaleAdjudicationNotice[];
  /** Phase 4.5 readiness — independent of the Phase 4.4a acceptance gate. */
  phase_45: {
    status: "READY" | "BLOCKED";
    reasons: string[];
    /** Recorded so 4.5 is never read as implied by 4.4a. */
    phase_44a_status: "PASS" | "FAIL";
    depends_on_phase_44a: false;
  };
  read_only: true;
  apply_available: false;
}

const RAW_NON_MATCH: Classification[] = [
  "EXPECTED_TRANSFORMATION",
  "FARMOPS_AS_BUILT_ADDITION",
  "ODS_ONLY",
  "FARMOPS_ONLY",
  "CONFLICT",
  "LOSS",
  "INCOMPLETE",
];

function emptyDispositionCounts(): Record<ConvergenceDisposition, number> {
  return Object.fromEntries(CONVERGENCE_DISPOSITIONS.map((d) => [d, 0])) as Record<
    ConvergenceDisposition,
    number
  >;
}

/**
 * Lay established adjudications over an existing validation report. Pure: the
 * input report is not mutated and no comparison is recomputed.
 */
export function convergeValidation(
  report: ValidationReport,
  generatedAt = new Date().toISOString(),
): ConvergenceReport {
  const runSha = report.ods.sha256;
  const staleIndex = new Map<string, StaleAdjudicationNotice>();

  const findings: ConvergenceFinding[] = report.records
    .filter((r) => RAW_NON_MATCH.includes(r.classification))
    .map((r) => {
      const candidates = adjudicationsFor(r.stable_id, r.field);
      const applicable = candidates.filter((a) => a.ods_sha256 === runSha);
      const stale = candidates.filter((a) => a.ods_sha256 !== runSha);

      for (const a of stale) {
        const notice =
          staleIndex.get(a.id) ??
          ({
            adjudication: a,
            expected_sha256: a.ods_sha256,
            run_sha256: runSha,
            affected: [],
          } satisfies StaleAdjudicationNotice);
        notice.affected.push({ stable_id: r.stable_id, field: r.field });
        staleIndex.set(a.id, notice);
      }

      const hit = applicable[0] ?? null;
      const disposition = hit ? hit.disposition : defaultDisposition(r);

      return {
        domain: r.domain,
        stable_id: r.stable_id,
        field: r.field,
        label: r.label,
        // Raw comparison is copied, never replaced.
        raw_classification: r.classification,
        raw_ods_value: r.ods_value,
        raw_farmops_value: r.farmops_value,
        raw_disposition: r.disposition,
        raw_authority_class: r.authority_class,
        adjudication: hit,
        stale_adjudications: stale,
        adjudication_classification: hit ? hit.classification : null,
        disposition,
        derived: !hit,
        unresolved: UNRESOLVED_DISPOSITIONS.has(disposition),
        preserved: hit ? hit.preserved : [],
        rationale: hit
          ? hit.rationale
          : stale.length
            ? "An adjudication exists for this finding but references a different canonical workbook SHA — it is stale and reduces nothing."
            : r.note,
      } satisfies ConvergenceFinding;
    });

  const by_disposition = emptyDispositionCounts();
  for (const f of findings) by_disposition[f.disposition] += 1;

  const by_raw_classification = Object.fromEntries(
    (Object.keys(CLASSIFICATION_LABELS) as Classification[]).map((c) => [
      c,
      { raw: 0, adjudicated: 0, unresolved: 0 },
    ]),
  ) as ConvergenceReport["by_raw_classification"];
  for (const f of findings) {
    const bucket = by_raw_classification[f.raw_classification];
    bucket.raw += 1;
    if (f.disposition !== "UNADJUDICATED") bucket.adjudicated += 1;
    if (f.unresolved) bucket.unresolved += 1;
  }

  const conflictBucket = by_raw_classification["CONFLICT"] ?? {
    raw: 0,
    adjudicated: 0,
    unresolved: 0,
  };

  const counts = {
    raw_findings: findings.length,
    adjudicated: findings.filter((f) => f.disposition !== "UNADJUDICATED").length,
    unresolved: findings.filter((f) => f.unresolved).length,
    conflicts_total: conflictBucket.raw,
    conflicts_adjudicated: conflictBucket.adjudicated,
    conflicts_unresolved: conflictBucket.unresolved,
    canonical_corrections_pending: by_disposition.CANONICAL_ODS_CORRECTION_REQUIRED,
    farmops_corrections_pending: by_disposition.FARMOPS_CORRECTION_REQUIRED,
    semantic_representation_differences: by_disposition.SEMANTIC_REPRESENTATION_DIFFERENCE,
    current_semantics_unresolved: by_disposition.CURRENT_SEMANTICS_UNRESOLVED,
    provenance_or_field_verification_pending:
      by_disposition.PROVENANCE_VERIFICATION_REQUIRED + by_disposition.FIELD_VERIFICATION_REQUIRED,
    expected_transformations: by_disposition.EXPECTED_TRANSFORMATION,
    farmops_as_built_additions: by_disposition.FARMOPS_AS_BUILT_ADDITION,
  };


  const reasons: string[] = [];
  if (by_disposition.UNADJUDICATED > 0)
    reasons.push(
      `${by_disposition.UNADJUDICATED} raw finding(s) carry no adjudication at this workbook SHA.`,
    );
  if (counts.current_semantics_unresolved > 0)
    reasons.push(
      `${counts.current_semantics_unresolved} finding(s) remain CURRENT_SEMANTICS_UNRESOLVED — the electrical concept of the value is not proven.`,
    );
  if (counts.provenance_or_field_verification_pending > 0)
    reasons.push(
      `${counts.provenance_or_field_verification_pending} finding(s) await provenance or field verification.`,
    );
  if (counts.canonical_corrections_pending > 0)
    reasons.push(
      `${counts.canonical_corrections_pending} canonical ODS correction(s) are pending in the controlled workbook workflow.`,
    );
  if (counts.farmops_corrections_pending > 0)
    reasons.push(`${counts.farmops_corrections_pending} FarmOps correction(s) are pending.`);
  if (staleIndex.size > 0)
    reasons.push(
      `${staleIndex.size} adjudication(s) are stale for this workbook SHA and reduce nothing.`,
    );

  return {
    version: CONVERGENCE_VERSION,
    generated_at: generatedAt,
    ods: { file_name: report.ods.file_name, sha256: runSha },
    raw_summary: { ...report.summary },
    findings,
    counts,
    by_disposition,
    by_raw_classification,
    stale: [...staleIndex.values()],
    phase_45: {
      status: reasons.length === 0 ? "READY" : "BLOCKED",
      reasons,
      phase_44a_status: report.gate.status,
      depends_on_phase_44a: false,
    },
    read_only: true,
    apply_available: false,
  };
}

/* ------------------------------------------------------------------ exports */

export const CONVERGENCE_CSV_HEADER = [
  "domain",
  "stable_id",
  "field",
  "raw_classification",
  "raw_ods_value",
  "raw_farmops_value",
  "adjudication_id",
  "adjudication_classification",
  "adjudication_sha256",
  "disposition",
  "unresolved",
  "stale_adjudications",
  "preserved",
  "rationale",
];

function cell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function convergenceCsv(report: ConvergenceReport): string {
  const lines = [CONVERGENCE_CSV_HEADER.join(",")];
  for (const f of report.findings) {
    lines.push(
      [
        f.domain,
        f.stable_id,
        f.field,
        f.raw_classification,
        f.raw_ods_value,
        f.raw_farmops_value,
        f.adjudication?.id ?? "",
        f.adjudication_classification ?? "",
        f.adjudication?.ods_sha256 ?? "",
        f.disposition,
        f.unresolved ? "yes" : "no",
        f.stale_adjudications.map((a) => a.id).join("; "),
        f.preserved.join(" | "),
        f.rationale,
      ]
        .map((v) => cell(String(v ?? "")))
        .join(","),
    );
  }
  return lines.join("\n");
}

export function convergenceMarkdown(report: ConvergenceReport): string {
  const c = report.counts;
  const out: string[] = [
    "# Phase 4.4b — Parallel Validation convergence",
    "",
    `- Version: ${report.version}`,
    `- Generated: ${report.generated_at}`,
    `- Canonical ODS: ${report.ods.file_name} (${report.ods.sha256})`,
    "",
    "## Raw comparison (immutable)",
    "",
    ...(Object.keys(report.raw_summary) as Classification[]).map(
      (k) => `- raw ${CLASSIFICATION_LABELS[k]}: ${report.raw_summary[k]}`,
    ),
    "",
    "## Convergence",
    "",
    `- Raw findings: ${c.raw_findings}`,
    `- Adjudicated: ${c.adjudicated}`,
    `- Unresolved: ${c.unresolved}`,
    `- Total conflicts (raw): ${c.conflicts_total}`,
    `- Adjudicated conflicts: ${c.conflicts_adjudicated}`,
    `- Unresolved conflicts: ${c.conflicts_unresolved}`,
    `- Canonical ODS corrections pending: ${c.canonical_corrections_pending}`,
    `- FarmOps corrections pending: ${c.farmops_corrections_pending}`,
    `- Semantic representation differences (F): ${c.semantic_representation_differences}`,
    `- Current semantics unresolved: ${c.current_semantics_unresolved}`,
    `- Provenance / field verification pending: ${c.provenance_or_field_verification_pending}`,
    `- Expected transformations: ${c.expected_transformations}`,
    `- FarmOps as-built additions: ${c.farmops_as_built_additions}`,

    "",
    "## By raw classification",
    "",
    "| Raw classification | raw | adjudicated | unresolved |",
    "| --- | --- | --- | --- |",
    ...(Object.keys(report.by_raw_classification) as Classification[])
      .filter((k) => report.by_raw_classification[k].raw > 0)
      .map((k) => {
        const b = report.by_raw_classification[k];
        return `| ${CLASSIFICATION_LABELS[k]} | ${b.raw} | ${b.adjudicated} | ${b.unresolved} |`;
      }),
    "",
    `## Phase 4.5 readiness: ${report.phase_45.status}`,
    "",
    `Phase 4.4a acceptance gate: ${report.phase_45.phase_44a_status} (does not imply Phase 4.5 readiness)`,
    "",
    ...report.phase_45.reasons.map((r) => `- ${r}`),
  ];
  if (report.stale.length) {
    out.push("", "## Stale adjudications (reduce nothing)", "");
    for (const s of report.stale) {
      out.push(
        `- ${s.adjudication.id} — adjudicated against ${s.expected_sha256}, run is ${s.run_sha256}`,
      );
    }
  }
  out.push("", "Read-only: no writes, migrations, ODS modifications or FarmOps corrections.");
  return out.join("\n");
}
