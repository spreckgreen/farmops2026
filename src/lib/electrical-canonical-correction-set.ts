// Phase 4.4c — canonical ODS correction-set manifest (read-only).
//
// This module prepares the set of canonical workbook changes that are
// sufficiently proven to be made in the NEXT revision of
// PremoFarmElectrical.ods. It is a manifest only:
//
//   * the current canonical baseline stays immutable (SHA 89da43c7…7388);
//   * nothing here edits or regenerates the ODS;
//   * nothing here writes FarmOps;
//   * nothing here authorizes a Phase 4.5 cutover.
//
// Every "old raw value" is the value parsed from the SHA-verified workbook —
// never a stored constant. A candidate whose canonical row is absent from the
// attached workbook is reported as not established rather than assumed.
import {
  canonicalLoad,
  PHASE_44A_BASELINE_SHA256,
  type AdjudicationBaseline,
} from "@/lib/electrical-adjudication-baseline";
import { equipmentFor } from "@/lib/electrical-equipment-provenance";

export const CANONICAL_CORRECTION_SET_VERSION = "4.4c-canonical-correction-set-1";

export type CorrectionConfidence = "high" | "medium" | "low" | "not_established";

export interface CanonicalCorrectionRow {
  stable_id: string;
  description: string;
  worksheet: string | null;
  row: number | null;
  field: "volts" | "amps" | "connected_va";
  unit: string;
  /** Value the attached SHA-verified workbook actually contains. */
  old_raw_value: number | null;
  /** Value proposed for the next ODS revision. Null when not established. */
  proposed_value: number | null;
  evidence: string[];
  adjudication: string;
  confidence: CorrectionConfidence;
  baseline_sha256: string;
  /** True only when every precondition for the proposal is satisfied. */
  approved: boolean;
  /** Populated for withheld rows: what is still missing. */
  withheld_reason: string | null;
}

export interface CanonicalCorrectionSet {
  version: string;
  generated_at: string;
  workbook_name: string;
  baseline_sha256: string;
  is_phase_44a_baseline: boolean;
  approved: CanonicalCorrectionRow[];
  withheld: CanonicalCorrectionRow[];
  headline: {
    approved_canonical_correction_candidates: number;
    withheld_unresolved_candidates: number;
    current_baseline_modified: "NO";
  };
  read_only: true;
  ods_edited: false;
  farmops_written: false;
  phase_45_authorized: false;
}

const BRYANT_ADJUDICATION = "CANONICAL_ODS_VALUE_INCOMPATIBLE_WITH_VERIFIED_EQUIPMENT";

function bryantEvidence(stable_id: string): string[] {
  const eq = equipmentFor(stable_id);
  const cls = eq?.semantics.rated_equipment_voltage_class ?? "208/230";
  const phase = eq?.semantics.phase ?? "1";
  const hz = eq?.semantics.frequency_hz ?? 60;
  const models = eq?.components.map((c) => `${c.manufacturer} ${c.model}`).join(" + ");
  return [
    `Installed system: ${models ?? "Bryant 37MARAQ24AA3 + D5MAHAQ24XA* mini-split"}.`,
    `Verified outdoor-unit electrical rating: ${cls} VAC, ${phase}Ø, ${hz} Hz.`,
    "FarmOps already records nominal supply 240 V for this load (unchanged by this manifest).",
    `Prior adjudication: ${BRYANT_ADJUDICATION}.`,
    `Correction represents the canonical nominal supply as 240 V; the manufacturer ${cls} VAC figure remains separately preserved as the equipment rating and is not overwritten.`,
  ];
}

/** Approved candidates: canonical nominal supply voltage for the two Bryants. */
const APPROVED_VOLTS_IDS = ["FS-082", "FS-083"] as const;
const APPROVED_VOLTS_PROPOSED = 240;
const APPROVED_VOLTS_EXPECTED_OLD = 120;

/**
 * Explicitly withheld: legacy current semantics are unresolved, so no
 * replacement value and no blanking is proposed for these fields yet.
 */
const WITHHELD: Array<{
  stable_id: string;
  field: CanonicalCorrectionRow["field"];
  unit: string;
  adjudication: string;
  withheld_reason: string;
  evidence: string[];
}> = [
  {
    stable_id: "FS-082",
    field: "amps",
    unit: "A",
    adjudication: "ZERO_AMPS_NOT_ESTABLISHED_AS_ZERO_LOAD",
    withheld_reason:
      "Canonical 0 A has no established semantic: it is not proven to be a verified zero load, and the legacy Amps column is a semantically overloaded field. No replacement value and no blanking is proposed.",
    evidence: [
      "Bryant manufacturer quantities preserved independently: MOCP 25 A, RCA 1.69 A, RLA 4.15 A, MCA null/unverified.",
      "MOCP is never read as a load current and MCA is never inferred, so no substitute figure is available.",
    ],
  },
  {
    stable_id: "FS-083",
    field: "amps",
    unit: "A",
    adjudication: "ZERO_AMPS_NOT_ESTABLISHED_AS_ZERO_LOAD",
    withheld_reason:
      "Canonical 0 A has no established semantic: it is not proven to be a verified zero load, and the legacy Amps column is a semantically overloaded field. No replacement value and no blanking is proposed.",
    evidence: [
      "Bryant manufacturer quantities preserved independently: MOCP 25 A, RCA 1.69 A, RLA 4.15 A, MCA null/unverified.",
      "MOCP is never read as a load current and MCA is never inferred, so no substitute figure is available.",
    ],
  },
  {
    stable_id: "FS-084",
    field: "amps",
    unit: "A",
    adjudication: "LEGACY_VALUE_SOURCE_UNKNOWN",
    withheld_reason:
      "Canonical 60 A traces to no identified source, and the FarmOps 25 A figure is NUMERIC_VALUE_WITH_UNRESOLVED_SEMANTICS. Neither is established as the correct canonical value.",
    evidence: [
      "FS-084 canonical Amps = 60 A → LEGACY_VALUE_SOURCE_UNKNOWN.",
      "FS-084 FarmOps Amps = 25 A → NUMERIC_VALUE_WITH_UNRESOLVED_SEMANTICS.",
      "Equality with the Bryant MOCP of 25 A is not treated as proof of meaning.",
    ],
  },
  {
    stable_id: "FS-084",
    field: "connected_va",
    unit: "VA",
    adjudication: "DEPENDENT_ON_UNRESOLVED_LEGACY_CURRENT_SEMANTICS",
    withheld_reason:
      "Connected VA is arithmetically dependent on the unresolved legacy Amps figure, so the canonical value is left exactly as the workbook records it.",
    evidence: [
      "Value derives from the canonical Volts × Amps pair whose current semantic is unresolved.",
      "The derived VA figure is never used as evidence supporting the 60 A current.",
    ],
  },
];

export function buildCanonicalCorrectionSet(
  baseline: AdjudicationBaseline,
  generatedAt = new Date().toISOString(),
): CanonicalCorrectionSet {
  const sha = baseline.ods_sha256;
  const onBaseline = sha === PHASE_44A_BASELINE_SHA256;

  const approved: CanonicalCorrectionRow[] = APPROVED_VOLTS_IDS.map((id) => {
    const c = canonicalLoad(baseline, id);
    const old = c?.volts ?? null;
    // A candidate is approved only when the attached workbook really contains
    // the row, really contains the incompatible value, and is the confirmed
    // Phase 4.4a baseline.
    const ok = Boolean(c) && old === APPROVED_VOLTS_EXPECTED_OLD && onBaseline;
    return {
      stable_id: id,
      description: c?.description ?? "not parsed",
      worksheet: c?.worksheet ?? null,
      row: c?.row ?? null,
      field: "volts",
      unit: "V",
      old_raw_value: old,
      proposed_value: ok ? APPROVED_VOLTS_PROPOSED : null,
      evidence: bryantEvidence(id),
      adjudication: BRYANT_ADJUDICATION,
      confidence: ok ? "high" : "not_established",
      baseline_sha256: sha,
      approved: ok,
      withheld_reason: ok
        ? null
        : !onBaseline
          ? `Attached workbook SHA-256 ${sha} is not the authorized Phase 4.4a baseline ${PHASE_44A_BASELINE_SHA256}.`
          : !c
            ? `The attached workbook contains no canonical row for ${id}.`
            : `The attached workbook records ${old ?? "no value"} V, not the adjudicated ${APPROVED_VOLTS_EXPECTED_OLD} V; the correction is not re-derived.`,
    };
  });

  const withheld: CanonicalCorrectionRow[] = WITHHELD.map((w) => {
    const c = canonicalLoad(baseline, w.stable_id);
    const raw =
      w.field === "amps" ? (c?.amps ?? null) : w.field === "volts" ? (c?.volts ?? null) : (c?.connected_va ?? null);
    return {
      stable_id: w.stable_id,
      description: c?.description ?? "not parsed",
      worksheet: c?.worksheet ?? null,
      row: c?.row ?? null,
      field: w.field,
      unit: w.unit,
      old_raw_value: raw,
      proposed_value: null,
      evidence: w.evidence,
      adjudication: w.adjudication,
      confidence: "not_established",
      baseline_sha256: sha,
      approved: false,
      withheld_reason: w.withheld_reason,
    };
  });

  const notApproved = approved.filter((r) => !r.approved);

  return {
    version: CANONICAL_CORRECTION_SET_VERSION,
    generated_at: generatedAt,
    workbook_name: baseline.ods_file_name,
    baseline_sha256: sha,
    is_phase_44a_baseline: onBaseline,
    approved: approved.filter((r) => r.approved),
    withheld: [...notApproved, ...withheld],
    headline: {
      approved_canonical_correction_candidates: approved.filter((r) => r.approved).length,
      withheld_unresolved_candidates: notApproved.length + withheld.length,
      current_baseline_modified: "NO",
    },
    read_only: true,
    ods_edited: false,
    farmops_written: false,
    phase_45_authorized: false,
  };
}

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const CSV_HEAD = [
  "section",
  "stable_id",
  "worksheet",
  "row",
  "field",
  "unit",
  "old_raw_value",
  "proposed_value",
  "evidence",
  "adjudication",
  "confidence",
  "baseline_sha256",
  "withheld_reason",
];

function csvRow(section: string, r: CanonicalCorrectionRow): string {
  return [
    section,
    r.stable_id,
    r.worksheet,
    r.row,
    r.field,
    r.unit,
    r.old_raw_value,
    r.proposed_value,
    r.evidence.join(" | "),
    r.adjudication,
    r.confidence,
    r.baseline_sha256,
    r.withheld_reason,
  ]
    .map(cell)
    .join(",");
}

export function canonicalCorrectionSetCsv(set: CanonicalCorrectionSet): string {
  return [
    CSV_HEAD.join(","),
    ...set.approved.map((r) => csvRow("approved_candidate", r)),
    ...set.withheld.map((r) => csvRow("withheld_unresolved", r)),
  ].join("\n");
}

export function canonicalCorrectionSetMarkdown(set: CanonicalCorrectionSet): string {
  const lines: string[] = [
    "# Phase 4.4c — Canonical ODS correction-set manifest (read-only)",
    "",
    `- Approved canonical correction candidates = ${set.headline.approved_canonical_correction_candidates}`,
    `- Withheld unresolved candidates = ${set.headline.withheld_unresolved_candidates}`,
    `- Current baseline modified = ${set.headline.current_baseline_modified}`,
    "",
    `- Version: ${set.version}`,
    `- Generated: ${set.generated_at}`,
    `- Canonical workbook: ${set.workbook_name} (SHA-256 ${set.baseline_sha256}${set.is_phase_44a_baseline ? ", confirmed Phase 4.4a baseline" : ", NOT the Phase 4.4a baseline"})`,
    "- This is a manifest only: the ODS is not edited or regenerated, the baseline SHA is unchanged, FarmOps is not written, and no Phase 4.5 cutover is authorized.",
    "",
    "## Approved candidates",
    "",
  ];
  const block = (r: CanonicalCorrectionRow) => {
    lines.push(
      `### ${r.stable_id} · ${r.field} (${r.unit})`,
      "",
      `- Load: ${r.description}`,
      `- Worksheet / row: ${r.worksheet ?? "not parsed"} / ${r.row ?? "not parsed"}`,
      `- Old raw value: ${r.old_raw_value ?? "not stated"} ${r.unit}`,
      `- Proposed value: ${r.proposed_value ?? "none proposed"}${r.proposed_value === null ? "" : ` ${r.unit}`}`,
      `- Adjudication: ${r.adjudication}`,
      `- Confidence: ${r.confidence}`,
      `- Baseline SHA-256: ${r.baseline_sha256}`,
      ...(r.withheld_reason ? [`- Withheld because: ${r.withheld_reason}`] : []),
      "- Evidence:",
      ...r.evidence.map((e) => `  - ${e}`),
      "",
    );
  };
  if (set.approved.length) set.approved.forEach(block);
  else lines.push("None established for the attached workbook.", "");
  lines.push("## Withheld corrections (investigated, not sufficiently established)", "");
  if (set.withheld.length) set.withheld.forEach(block);
  else lines.push("None.", "");
  return lines.join("\n");
}
