// Phase 4.4d — candidate revision validation confirmations (pure).
//
// After a candidate workbook is generated, the full Phase 4.4 parallel
// validation is run against the CANDIDATE ODS and the current FarmOps snapshot.
// This module turns those two reports (baseline run and candidate run) plus the
// candidate's own parsed values into the explicit confirmations the phase
// requires. Nothing here promotes anything.
import type { AdjudicationBaseline } from "@/lib/electrical-adjudication-baseline";
import { canonicalLoad } from "@/lib/electrical-adjudication-baseline";
import { buildCanonicalCorrectionSet } from "@/lib/electrical-canonical-correction-set";
import { equipmentFor } from "@/lib/electrical-equipment-provenance";
import { equipmentRatingLabel } from "@/lib/electrical-canonical-ods-correction-queue";
import {
  CLASSIFICATIONS,
  type Classification,
  type ValidationReport,
} from "@/lib/electrical-parallel-validation";
import { WITHHELD_REVISION_FIELDS } from "@/lib/electrical-ods-revision";

export type CheckStatus = "pass" | "fail" | "pending";

export interface RevisionCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface RevisionValidationInput {
  baseline: AdjudicationBaseline;
  candidate: AdjudicationBaseline;
  /** FarmOps nominal supply voltage per stable ID, from the live snapshot. */
  farmopsVolts: Record<string, number | null>;
  /** Full Phase 4.4 validation of the previous baseline workbook. */
  baselineValidation: ValidationReport | null;
  /** Full Phase 4.4 validation of the candidate workbook. */
  candidateValidation: ValidationReport | null;
}

const NOMINAL = 240;

function voltageAgreementCheck(
  stableId: string,
  input: RevisionValidationInput,
): RevisionCheck {
  const candidate = canonicalLoad(input.candidate, stableId)?.volts ?? null;
  const farmops = input.farmopsVolts[stableId] ?? null;
  const agrees = candidate === NOMINAL && farmops === NOMINAL;
  return {
    id: `${stableId}-volts-agrees`,
    label: `${stableId} Volts agrees at nominal ${NOMINAL} V`,
    status: agrees ? "pass" : "fail",
    detail: `Candidate ODS ${candidate ?? "not stated"} V · FarmOps ${farmops ?? "not stated"} V`,
  };
}

export function candidateRevisionChecks(input: RevisionValidationInput): RevisionCheck[] {
  const checks: RevisionCheck[] = [
    voltageAgreementCheck("FS-082", input),
    voltageAgreementCheck("FS-083", input),
  ];

  // Bryant rated equipment voltage stays a separate axis of evidence.
  const bryantRating = equipmentRatingLabel("FS-082");
  const bryantOk =
    /208\/230 VAC/.test(bryantRating) && /1Ø/.test(bryantRating) && /60 Hz/.test(bryantRating);
  checks.push({
    id: "bryant-rating-preserved",
    label: "Bryant rated equipment voltage remains separately 208/230 VAC, 1Ø, 60 Hz",
    status: bryantOk ? "pass" : "fail",
    detail: `Equipment provenance still reports: ${bryantRating}. It is never collapsed into the nominal supply value.`,
  });

  // Current semantics must remain unresolved/open for FS-082/083/084.
  const candidateManifest = buildCanonicalCorrectionSet(input.candidate);
  const stillWithheld = WITHHELD_REVISION_FIELDS.filter((w) =>
    candidateManifest.withheld.some((r) => r.stable_id === w.stable_id && r.field === w.field),
  );
  checks.push({
    id: "current-semantics-open",
    label: "FS-082 / FS-083 / FS-084 current-semantic findings remain open",
    status: stillWithheld.length === WITHHELD_REVISION_FIELDS.length ? "pass" : "fail",
    detail: `${stillWithheld.length} of ${WITHHELD_REVISION_FIELDS.length} withheld values remain unresolved in the candidate: ${stillWithheld
      .map((w) => `${w.stable_id} ${w.field}`)
      .join(", ")}. No MCA was inferred and no legacy Amp value was changed.`,
  });

  // FS-084 connected VA untouched.
  const baseVa = canonicalLoad(input.baseline, "FS-084")?.connected_va ?? null;
  const candVa = canonicalLoad(input.candidate, "FS-084")?.connected_va ?? null;
  checks.push({
    id: "fs084-va-untouched",
    label: "FS-084 Connected VA remains untouched",
    status: baseVa === candVa ? "pass" : "fail",
    detail: `Baseline ${baseVa ?? "not stated"} VA · candidate ${candVa ?? "not stated"} VA`,
  });

  // Semantic loss and regression comparison need the candidate validation run.
  const cv = input.candidateValidation;
  checks.push({
    id: "semantic-loss-zero",
    label: "Semantic loss remains 0",
    status: !cv ? "pending" : cv.gate.loss === 0 ? "pass" : "fail",
    detail: cv
      ? `Candidate validation gate: loss ${cv.gate.loss}, status ${cv.gate.status}.`
      : "Run the full Phase 4.4 validation against the candidate workbook.",
  });

  const bv = input.baselineValidation;
  if (!cv || !bv) {
    checks.push({
      id: "no-new-regressions",
      label: "No new A/B/C/D/E/F or topology/service regressions introduced by generation",
      status: "pending",
      detail: "Both the baseline run and the candidate run are needed to compare.",
    });
  } else {
    const worse: string[] = [];
    for (const c of CLASSIFICATIONS as readonly Classification[]) {
      const before = bv.summary[c] ?? 0;
      const after = cv.summary[c] ?? 0;
      if (c === "MATCH" || c === "SEMANTIC_MATCH") continue;
      if (after > before) worse.push(`${c} ${before} → ${after}`);
    }
    for (const [cat, before] of Object.entries(bv.farmops_only_by_category)) {
      const after = cv.farmops_only_by_category[cat as keyof typeof cv.farmops_only_by_category] ?? 0;
      if (after > (before ?? 0)) worse.push(`FarmOps-only ${cat} ${before} → ${after}`);
    }
    checks.push({
      id: "no-new-regressions",
      label: "No new A/B/C/D/E/F or topology/service regressions introduced by generation",
      status: worse.length ? "fail" : "pass",
      detail: worse.length
        ? `New or increased findings: ${worse.join("; ")}.`
        : "Every classification and FarmOps-only category is unchanged or improved against the baseline run.",
    });
  }

  return checks;
}

export function checksPassed(checks: RevisionCheck[]): boolean {
  return checks.length > 0 && checks.every((c) => c.status === "pass");
}

/** Present the equipment evidence separately, never merged with the correction. */
export function bryantIndependentRating(stableId = "FS-082"): string {
  const eq = equipmentFor(stableId);
  return eq
    ? `${eq.components.map((c) => `${c.manufacturer} ${c.model}`).join(" + ")} — ${equipmentRatingLabel(stableId)}`
    : equipmentRatingLabel(stableId);
}
