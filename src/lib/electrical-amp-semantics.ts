// Phase 4.4b — Bryant amperage semantic adjudication (READ-ONLY).
//
// Scope: FS-082, FS-083, FS-084 — the canonical ODS `Amps` value and the
// `Connected VA` value that may be formula-derived from it.
//
// Hard rules encoded here:
//   * nothing is written: not FarmOps, not the canonical workbook;
//   * the canonical values are only ever the values parsed from the
//     SHA-verified baseline workbook — no stored copy is substituted;
//   * MOCP is never treated as a load current, and the ODS amps value is
//     never automatically replaced with 25 A;
//   * MCA is never derived — it stays NULL / unverified;
//   * 0 A is never read as a verified zero-load condition unless provenance
//     explicitly establishes that meaning;
//   * when the meaning of the ODS amps column cannot be proven, the row is
//     classified AMP_FIELD_SEMANTICS_UNRESOLVED.
import {
  baselineLabel,
  canonicalLoad,
  type AdjudicationBaseline,
} from "@/lib/electrical-adjudication-baseline";
import { equipmentFor } from "@/lib/electrical-equipment-provenance";
import type { FarmOpsLoadRow } from "@/lib/electrical-load-adjudication-production";

export const AMP_SEMANTICS_VERSION = "4.4b-bryant-amp-semantics-1";

/** Loads in scope for this adjudication. Deliberately narrow. */
export const AMP_SEMANTIC_LOAD_IDS = ["FS-082", "FS-083", "FS-084"] as const;

/** The candidate meanings the scalar ODS amps column could carry. */
export const AMP_SEMANTIC_CANDIDATES = [
  {
    concept: "connected_load_current",
    label: "Connected load current",
    definition:
      "Current the connected load actually draws in service; the operand a connected-VA calculation would use.",
  },
  {
    concept: "equipment_rated_current",
    label: "Equipment rated current",
    definition: "Manufacturer-stated rated current of the equipment as a whole.",
  },
  {
    concept: "rated_load_amps",
    label: "Rated load amps (RLA)",
    definition: "Manufacturer-stated rated load amps of the compressor/motor.",
  },
  {
    concept: "rated_current_amps",
    label: "Rated current amps (RCA)",
    definition: "Manufacturer-stated rated current amps from the electrical table.",
  },
  {
    concept: "minimum_circuit_ampacity",
    label: "Minimum circuit ampacity (MCA)",
    definition: "Conductor-sizing minimum. Never derived here.",
  },
  {
    concept: "maximum_overcurrent_protection",
    label: "Maximum overcurrent protection (MOCP)",
    definition: "Largest permitted protective device. Not a load current.",
  },
  {
    concept: "installed_breaker_ocp",
    label: "Installed breaker OCP",
    definition: "Rating of the breaker actually installed, as observed in the field.",
  },
  {
    concept: "design_circuit_ampacity",
    label: "Design circuit ampacity",
    definition: "Engineering design current chosen for the branch circuit.",
  },
] as const;

export type AmpSemanticConcept = (typeof AMP_SEMANTIC_CANDIDATES)[number]["concept"];

/**
 * The evidence sources that were interrogated to determine what the canonical
 * amps column means. Each carries what the source actually states — none of
 * them states a semantic concept, which is the finding.
 */
export interface AmpSemanticProbe {
  source:
    | "workbook_column_semantics"
    | "workbook_formula"
    | "field_mapping"
    | "comparable_load_rows"
    | "documentation"
    | "normalization_rules"
    | "farmops_provenance"
    | "equipment_provenance";
  states: string;
  /** Does this source prove which of the candidate concepts the column is? */
  proves_semantic: boolean;
}

export type VaBasis =
  | "derived_volts_times_amps"
  | "not_derived_from_volts_times_amps"
  | "zero_product_indeterminate"
  | "not_computable";

export const VA_BASIS_LABELS: Record<VaBasis, string> = {
  derived_volts_times_amps: "Volts × Amps (formula-driven)",
  not_derived_from_volts_times_amps: "Not equal to Volts × Amps",
  zero_product_indeterminate: "0 = 0 × V — indeterminate, proves nothing",
  not_computable: "Not computable (a required value is absent)",
};

export type AmpDisposition =
  | "AMP_FIELD_SEMANTICS_UNRESOLVED"
  | "ZERO_AMPS_NOT_ESTABLISHED_AS_ZERO_LOAD"
  | "VA_DERIVED_FROM_UNRESOLVED_AMP_SEMANTIC"
  | "AMP_SEMANTIC_ESTABLISHED_BY_PROVENANCE";

export const AMP_DISPOSITION_LABELS: Record<AmpDisposition, string> = {
  AMP_FIELD_SEMANTICS_UNRESOLVED:
    "Amp field semantics unresolved — no source proves which current concept the column holds",
  ZERO_AMPS_NOT_ESTABLISHED_AS_ZERO_LOAD:
    "0 A is not established as a verified zero-load condition",
  VA_DERIVED_FROM_UNRESOLVED_AMP_SEMANTIC:
    "Connected VA is formula-driven from the same unresolved amp value",
  AMP_SEMANTIC_ESTABLISHED_BY_PROVENANCE:
    "Amp semantic established by explicit provenance",
};

export interface AmpSemanticRow {
  stable_id: string;
  description: string;
  /** Canonical workbook identity — preserved verbatim. */
  workbook_name: string;
  workbook_sha256: string;
  worksheet: string | null;
  worksheet_row: number | null;
  ods_volts: number | null;
  ods_amps: number | null;
  ods_va: number | null;
  farmops_amps: number | null;
  equipment_model: string | null;
  equipment_mocp: number | null;
  rca: number | null;
  rla: number | null;
  /** Always null unless a source states it. Never derived. */
  mca: number | null;
  mca_status: string;
  inferred_ods_amp_semantic: string;
  /** Concepts the evidence positively rules out (with the reason). */
  excluded_concepts: { concept: AmpSemanticConcept; because: string }[];
  /** Concepts still possible because nothing distinguishes them. */
  candidate_concepts: AmpSemanticConcept[];
  va_basis: VaBasis;
  va_basis_proof: string;
  disposition: AmpDisposition;
  additional_dispositions: AmpDisposition[];
  recommended_action: string;
  probes: AmpSemanticProbe[];
  ods_provenance: string;
  farmops_provenance: string;
  /** Invariants, restated per row so an export can be audited standalone. */
  farmops_write_required: false;
  ods_edit_authorized: false;
}

export interface AmpSemanticsReport {
  version: string;
  generated_at: string;
  workbook_name: string;
  workbook_sha256: string;
  is_phase_44a_baseline: boolean;
  baseline_label: string;
  rows: AmpSemanticRow[];
  missing_load_ids: string[];
  unresolved_count: number;
  read_only: true;
  apply_available: false;
}

const near = (a: number | null, b: number | null) =>
  a !== null && b !== null && Math.abs(a - b) < 0.5;

/**
 * Is the connected VA value directly derived from Volts × Amps?
 * A 0 = V × 0 product proves nothing and is reported as indeterminate.
 */
export function vaDerivation(
  volts: number | null,
  amps: number | null,
  va: number | null,
): { basis: VaBasis; proof: string } {
  if (volts === null || amps === null || va === null) {
    return {
      basis: "not_computable",
      proof: "A required canonical value is absent, so no derivation can be tested.",
    };
  }
  const product = volts * amps;
  if (product === 0 && va === 0) {
    return {
      basis: "zero_product_indeterminate",
      proof: `${volts} × ${amps} = 0 and the workbook holds 0 VA. A zero product is satisfied by any voltage, so this neither proves nor disproves a formula.`,
    };
  }
  if (near(product, va)) {
    return {
      basis: "derived_volts_times_amps",
      proof: `${volts} V × ${amps} A = ${product} VA equals the canonical ${va} VA, so the VA value is formula-driven from the same amps value.`,
    };
  }
  return {
    basis: "not_derived_from_volts_times_amps",
    proof: `${volts} V × ${amps} A = ${product} VA, which does not equal the canonical ${va} VA. Another basis is in play and is not stated.`,
  };
}

/** Placeholder cell text is not provenance. */
function realNote(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  return /^(tbd|n\/?a|none|no|unknown|0%?|—|-)$/i.test(s) ? null : s;
}

/** Does any FarmOps text explicitly state which current concept is stored? */
export function statedAmpSemantic(row: FarmOpsLoadRow | undefined): string | null {
  const text = [realNote(row?.notes), realNote(row?.source_reference), realNote(row?.equipment_model)]
    .filter(Boolean)
    .join(" · ");
  if (!text) return null;
  const patterns: [RegExp, string][] = [
    [/\b(mocp|maximum overcurrent)\b/i, "maximum_overcurrent_protection"],
    [/\b(mca|minimum circuit ampacity)\b/i, "minimum_circuit_ampacity"],
    [/\brla\b/i, "rated_load_amps"],
    [/\brca\b/i, "rated_current_amps"],
    [/\b(breaker|ocp)\b/i, "installed_breaker_ocp"],
    [/\b(fla|full[- ]load|connected load current|running current)\b/i, "connected_load_current"],
    [/\bdesign (circuit )?ampacity\b/i, "design_circuit_ampacity"],
  ];
  for (const [re, concept] of patterns) {
    if (re.test(text)) return `${concept} — stated by FarmOps text: "${text}"`;
  }
  return null;
}

/** Does provenance explicitly establish that 0 A means a verified zero load? */
export function zeroLoadEstablished(row: FarmOpsLoadRow | undefined): boolean {
  const text = [realNote(row?.notes), realNote(row?.source_reference)].filter(Boolean).join(" · ");
  return /\b(not installed|no load connected|de-?energized|verified zero load|spare)\b/i.test(text);
}

function probesFor(
  row: FarmOpsLoadRow | undefined,
  comparable: string,
  vaProof: string,
  stated: string | null,
): AmpSemanticProbe[] {
  const eq = equipmentFor("FS-082");
  return [
    {
      source: "workbook_column_semantics",
      states:
        'The load worksheet carries a single unqualified "Amps" column. There is no MCA, MOCP, breaker or design-ampacity column beside it to contrast it with.',
      proves_semantic: false,
    },
    {
      source: "workbook_formula",
      states: vaProof,
      proves_semantic: false,
    },
    {
      source: "field_mapping",
      states:
        "Field mapping matrix: Load_Master.Amps is directly mapped to electrical_loads.amps with authority engineering_design. The mapping records no current concept.",
      proves_semantic: false,
    },
    {
      source: "comparable_load_rows",
      states: comparable,
      proves_semantic: false,
    },
    {
      source: "documentation",
      states:
        "ELECTRICAL_NUMERIC_RECONCILIATION lists amps under ODS_ENGINEERING_OWNED. Ownership is documented; meaning is not.",
      proves_semantic: false,
    },
    {
      source: "normalization_rules",
      states:
        'Normalization is numeric coercion with unit stripping only ("20 A" → 20). No rule classifies the value as load current, ampacity or OCP.',
      proves_semantic: false,
    },
    {
      source: "farmops_provenance",
      states:
        stated ??
        `No affirmative FarmOps provenance states the concept (notes ${
          row?.notes ? `"${row.notes}"` : "empty"
        } are placeholder text, and electrical_loads has no mapped OCP column).`,
      proves_semantic: Boolean(stated),
    },
    {
      source: "equipment_provenance",
      states: `Verified Bryant ${eq?.model ?? "37MARAQ24AA3 + D5MAHAQ24XA*"}: MOCP ${
        eq?.semantics.maximum_overcurrent_protection ?? 25
      } A, RCA ${eq?.semantics.rated_current_amps ?? 1.69} A, RLA ${
        eq?.semantics.rated_load_amps ?? 4.15
      } A, MCA not established. Equipment data bounds plausible values but does not state which concept the workbook column holds.`,
      proves_semantic: false,
    },
  ];
}

/** Concepts positively excluded for a given canonical amps value. */
function exclusions(
  amps: number | null,
  mocp: number | null,
  rca: number | null,
  rla: number | null,
): { concept: AmpSemanticConcept; because: string }[] {
  const out: { concept: AmpSemanticConcept; because: string }[] = [];
  if (amps === null) return out;
  const differs = (v: number | null) => v !== null && !near(v, amps);
  if (differs(rca))
    out.push({
      concept: "rated_current_amps",
      because: `${amps} A does not equal the published RCA of ${rca} A.`,
    });
  if (differs(rla))
    out.push({
      concept: "rated_load_amps",
      because: `${amps} A does not equal the published RLA of ${rla} A.`,
    });
  if (differs(mocp))
    out.push({
      concept: "maximum_overcurrent_protection",
      because: `${amps} A does not equal the published MOCP of ${mocp} A. MOCP is also not a load current and is never used as one.`,
    });
  out.push({
    concept: "minimum_circuit_ampacity",
    because:
      "MCA is unverified for this equipment and is never derived, so the column cannot be read as MCA.",
  });
  return out;
}

export function adjudicateAmpSemantics(input: {
  baseline: AdjudicationBaseline;
  rows: FarmOpsLoadRow[];
  generatedAt?: string;
}): AmpSemanticsReport {
  const { baseline } = input;
  const byId = new Map(input.rows.map((r) => [r.load_id.trim(), r]));
  const label = baselineLabel(baseline);

  // Comparable rows: every load row the baseline parsed, tested against V × A.
  const comparableSummary = baseline.loads
    .map((l) => {
      const d = vaDerivation(l.volts, l.amps, l.connected_va);
      return `${l.stable_id}: ${l.volts ?? "—"} V × ${l.amps ?? "—"} A vs ${
        l.connected_va ?? "—"
      } VA (${VA_BASIS_LABELS[d.basis]})`;
    })
    .join("; ");
  const comparable = `Comparable canonical load rows — ${comparableSummary}. The rows are formula-consistent where computable, which shows the column is used as the VA operand but not which current concept that operand is.`;

  const rows: AmpSemanticRow[] = [];
  const missing: string[] = [];

  for (const stableId of AMP_SEMANTIC_LOAD_IDS) {
    const ods = canonicalLoad(baseline, stableId);
    if (!ods) {
      missing.push(stableId);
      continue;
    }
    const fp = byId.get(stableId);
    const eq = equipmentFor(stableId);
    const mocp = eq?.semantics.maximum_overcurrent_protection ?? null;
    const rca = eq?.semantics.rated_current_amps ?? null;
    const rla = eq?.semantics.rated_load_amps ?? null;
    const va = vaDerivation(ods.volts, ods.amps, ods.connected_va);
    const stated = statedAmpSemantic(fp);
    const isZero = ods.amps !== null && Math.abs(ods.amps) < 1e-9;
    const zeroVerified = isZero && zeroLoadEstablished(fp);

    const excluded = exclusions(ods.amps, mocp, rca, rla);
    const candidates = AMP_SEMANTIC_CANDIDATES.map((c) => c.concept).filter(
      (c) => !excluded.some((e) => e.concept === c),
    );

    const additional: AmpDisposition[] = [];
    let disposition: AmpDisposition;
    let semantic: string;

    if (stated) {
      disposition = "AMP_SEMANTIC_ESTABLISHED_BY_PROVENANCE";
      semantic = stated;
    } else if (isZero && !zeroVerified) {
      disposition = "ZERO_AMPS_NOT_ESTABLISHED_AS_ZERO_LOAD";
      additional.push("AMP_FIELD_SEMANTICS_UNRESOLVED");
      semantic =
        "Unresolved. 0 A may mean not-yet-installed, an unpopulated cell or a real zero draw; no provenance states which, so it is not read as a verified zero-load condition.";
    } else {
      disposition = "AMP_FIELD_SEMANTICS_UNRESOLVED";
      semantic = `Unresolved. The value participates as the operand of the connected-VA product, but nothing distinguishes ${candidates.join(
        ", ",
      )}.`;
    }

    if (va.basis === "derived_volts_times_amps" && disposition !== "AMP_SEMANTIC_ESTABLISHED_BY_PROVENANCE") {
      additional.push("VA_DERIVED_FROM_UNRESOLVED_AMP_SEMANTIC");
    }

    const action = [
      isZero && !zeroVerified
        ? `Record explicit provenance for ${stableId}'s 0 A cell (not installed / de-energized / observed zero draw) before any interpretation. No write is proposed here.`
        : `Record the source and concept behind the canonical ${ods.amps ?? "—"} A figure for ${stableId} (measured, design selection, breaker size, or nameplate) before any reclassification.`,
      va.basis === "derived_volts_times_amps"
        ? `Because ${ods.connected_va} VA = ${ods.volts} V × ${ods.amps} A, the VA figure inherits the same unresolved semantic and must not be treated as an independently verified connected load.`
        : null,
      `Do not substitute the ${mocp ?? 25} A MOCP for the amps value, and leave MCA NULL/unverified.`,
    ]
      .filter(Boolean)
      .join(" ");

    rows.push({
      stable_id: stableId,
      description: fp?.description?.trim() || ods.description || stableId,
      workbook_name: baseline.ods_file_name,
      workbook_sha256: baseline.ods_sha256,
      worksheet: ods.worksheet,
      worksheet_row: ods.row,
      ods_volts: ods.volts,
      ods_amps: ods.amps,
      ods_va: ods.connected_va,
      farmops_amps: fp?.amps ?? null,
      equipment_model: eq?.model ?? null,
      equipment_mocp: mocp,
      rca,
      rla,
      mca: eq?.semantics.minimum_circuit_ampacity ?? null,
      mca_status: "NULL / unverified — never derived",
      inferred_ods_amp_semantic: semantic,
      excluded_concepts: excluded,
      candidate_concepts: candidates,
      va_basis: va.basis,
      va_basis_proof: va.proof,
      disposition,
      additional_dispositions: additional,
      recommended_action: action,
      probes: probesFor(fp, comparable, va.proof, stated),
      ods_provenance: `${ods.worksheet} worksheet, row ${ods.row} — parsed from ${label}`,
      farmops_provenance: `electrical_loads.amps${fp ? ` (load_id ${fp.load_id})` : " (row not found)"}`,
      farmops_write_required: false,
      ods_edit_authorized: false,
    });
  }

  return {
    version: AMP_SEMANTICS_VERSION,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    workbook_name: baseline.ods_file_name,
    workbook_sha256: baseline.ods_sha256,
    is_phase_44a_baseline: baseline.is_phase_44a_baseline,
    baseline_label: label,
    rows,
    missing_load_ids: missing,
    unresolved_count: rows.filter(
      (r) =>
        r.disposition !== "AMP_SEMANTIC_ESTABLISHED_BY_PROVENANCE",
    ).length,
    read_only: true,
    apply_available: false,
  };
}

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const AMP_SEMANTICS_CSV_HEADER = [
  "stable_id",
  "workbook_name",
  "worksheet",
  "worksheet_row",
  "workbook_sha256",
  "ods_volts",
  "ods_amps",
  "ods_va",
  "farmops_amps",
  "equipment_mocp",
  "rca",
  "rla",
  "mca",
  "inferred_ods_amp_semantic",
  "va_basis",
  "disposition",
  "recommended_action",
] as const;

export function ampSemanticsCsv(report: AmpSemanticsReport): string {
  return [
    AMP_SEMANTICS_CSV_HEADER.join(","),
    ...report.rows.map((r) =>
      [
        r.stable_id,
        r.workbook_name,
        r.worksheet,
        r.worksheet_row,
        r.workbook_sha256,
        r.ods_volts,
        r.ods_amps,
        r.ods_va,
        r.farmops_amps,
        r.equipment_mocp,
        r.rca,
        r.rla,
        r.mca === null ? r.mca_status : r.mca,
        r.inferred_ods_amp_semantic,
        VA_BASIS_LABELS[r.va_basis],
        [r.disposition, ...r.additional_dispositions].join(" + "),
        r.recommended_action,
      ]
        .map(cell)
        .join(","),
    ),
  ].join("\n");
}

export function ampSemanticsMarkdown(report: AmpSemanticsReport): string {
  const lines: string[] = [
    "# Phase 4.4b — Bryant amperage semantic adjudication (read-only)",
    "",
    `- Version: ${report.version}`,
    `- Generated: ${report.generated_at}`,
    `- Canonical workbook: ${report.workbook_name} (SHA-256 ${report.workbook_sha256})`,
    `- Baseline: ${report.baseline_label}`,
    `- Loads in scope: ${AMP_SEMANTIC_LOAD_IDS.join(", ")}`,
    `- Unresolved amp semantics: ${report.unresolved_count} of ${report.rows.length}`,
    "- No FarmOps write and no canonical ODS edit is authorized by this adjudication. MOCP is never used as a load current, MCA is never derived, and 0 A is not read as a verified zero-load condition.",
    "",
    "| Stable ID | ODS volts | ODS amps | ODS VA | FarmOps amps | MOCP | RCA | RLA | MCA | Inferred ODS amp semantic | VA basis | Disposition | Recommended action |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const n = (v: number | null) => (v === null ? "not stated" : String(v));
  for (const r of report.rows) {
    lines.push(
      `| ${r.stable_id} | ${n(r.ods_volts)} | ${n(r.ods_amps)} | ${n(r.ods_va)} | ${n(
        r.farmops_amps,
      )} | ${n(r.equipment_mocp)} | ${n(r.rca)} | ${n(r.rla)} | ${
        r.mca === null ? r.mca_status : r.mca
      } | ${r.inferred_ods_amp_semantic} | ${VA_BASIS_LABELS[r.va_basis]} | ${[
        r.disposition,
        ...r.additional_dispositions,
      ].join(" + ")} | ${r.recommended_action} |`,
    );
  }
  for (const r of report.rows) {
    lines.push(
      "",
      `## ${r.stable_id} · ${r.description}`,
      "",
      `- Workbook: ${r.workbook_name}, worksheet ${r.worksheet ?? "not parsed"}, row ${
        r.worksheet_row ?? "not parsed"
      }, SHA-256 ${r.workbook_sha256}`,
      `- ODS provenance: ${r.ods_provenance}`,
      `- FarmOps provenance: ${r.farmops_provenance} (unchanged)`,
      `- Equipment: ${r.equipment_model ?? "not established"}`,
      `- VA basis: ${VA_BASIS_LABELS[r.va_basis]} — ${r.va_basis_proof}`,
      `- Excluded concepts: ${
        r.excluded_concepts.length
          ? r.excluded_concepts.map((e) => `${e.concept} (${e.because})`).join(" ")
          : "none"
      }`,
      `- Remaining candidates: ${r.candidate_concepts.join(", ") || "none"}`,
      "- Evidence interrogated:",
      ...r.probes.map((p) => `  - ${p.source}: ${p.states}`),
    );
  }
  return lines.join("\n");
}
