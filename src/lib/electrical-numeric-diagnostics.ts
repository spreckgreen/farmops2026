// Phase 4.4b — numeric semantics diagnostics and reconciliation *preview*.
//
// Read-only by construction. This module classifies numeric differences between
// the canonical workbook and FarmOps; it performs no database writes and never
// writes the canonical .ods. There is no apply path in this phase.
//
// Categories (same shape as the completed Boolean work):
//   A — proven implementation artifact (a column default our own code supplied)
//   B — genuine engineering disagreement (both sides hold explicit numbers)
//   C — ODS state not representable as a number (TBD, range, approximate, text,
//       or a unit we refuse to guess at)
//   D — provenance insufficient (one side is silent and we cannot prove why)
//   F — semantic representation difference: both sides state a correct value of
//       *different* concepts (nominal supply voltage vs equipment nameplate
//       voltage) or the same value on a different calculation basis (VA computed
//       from nominal supply vs nameplate voltage). Both source values are
//       preserved; neither is a correction to the other. Never written.
//   E — representation / schema-semantic gap: the canonical workbook states a
//       fully resolved engineering value that the FarmOps column cannot hold
//       (today: split-phase system voltage such as 120/240). Not a bad cell and
//       not a Category-C unresolved state — the data model must be decided
//       first. Never corrected, never normalized to a scalar.
//
// Only Category A is ever a candidate for automatic correction, and even then a
// NOT NULL column blocks the correction rather than substituting a number.
import type { ComparisonRecord, ValidationReport } from "@/lib/electrical-parallel-validation";
import {
  EXCLUDED_NON_ENTITY_NUMERICS,
  NUMERIC_REGISTRY_VERSION,
  isExplicitNumber,
  numericRegistry,
  numericRegistryEntry,
  parseNumericCell,
  sameNumeric,
  type NumericOwnership,
  type NumericRegistryEntry,
  type ParsedNumeric,
} from "@/lib/electrical-numeric-semantics";
import {
  representationPairFor,
  REPRESENTATION_CONCEPT_LABELS,
  type RepresentationPair,
} from "@/lib/electrical-representation-proposal";
import {
  SYSTEM_VOLTAGE_COLUMN,
  isSystemVoltageField,
  resolveSystemVoltage,
  sameSystemVoltage,
  systemVoltageMigrationPreview,
  type SystemVoltageMigrationPreview,
  type SystemVoltageRepresentation,
} from "@/lib/electrical-system-voltage";
import {
  CONVERGENCE_DISPOSITION_LABELS,
  UNRESOLVED_DISPOSITIONS,
  adjudicationsFor,
  type ConvergenceDisposition,
  type EstablishedAdjudication,
} from "@/lib/electrical-convergence";

export const NUMERIC_DIAGNOSTICS_VERSION =
  "4.4b-numeric-diagnostics-5-adjudication-disposition-overlay";

/**
 * Verified Bryant quantities, preserved as independent concepts. These are
 * displayed alongside the amperage findings so that no reader collapses them:
 * MOCP is not load current, numeric equality with an ODS cell does not prove
 * semantic identity, and MCA stays unverified (never derived).
 */
export const VERIFIED_BRYANT_QUANTITIES = [
  { quantity: "rated_equipment_voltage", value: "208/230 VAC", status: "verified" },
  { quantity: "phase", value: "1", status: "verified" },
  { quantity: "frequency", value: "60 Hz", status: "verified" },
  { quantity: "maximum_overcurrent_protection (MOCP)", value: "25 A", status: "verified" },
  { quantity: "rated_current_amps (RCA)", value: "1.69 A", status: "verified" },
  { quantity: "rated_load_amps (RLA)", value: "4.15 A", status: "verified" },
  {
    quantity: "minimum_circuit_ampacity (MCA)",
    value: "NULL",
    status: "unverified — never derived",
  },
] as const;

export type NumericCategory = "A" | "B" | "C" | "D" | "E" | "F";

export type NumericArtifactType =
  /** Blank workbook cell + a NOT NULL DEFAULT 0 column: the 0 is code-created. */
  | "N1_BLANK_DEFAULTED_ZERO"
  /** Blank workbook cell + a NOT NULL DEFAULT <non-zero> column (e.g. count = 1). */
  | "N2_BLANK_DEFAULTED_NONZERO";

export const NUMERIC_ARTIFACT_LABELS: Record<NumericArtifactType, string> = {
  N1_BLANK_DEFAULTED_ZERO:
    "N1 — blank workbook cell against a NOT NULL DEFAULT 0 column: the stored 0 was supplied by the schema, not by engineering",
  N2_BLANK_DEFAULTED_NONZERO:
    "N2 — blank workbook cell against a NOT NULL DEFAULT <non-zero> column: the stored value was supplied by the schema, not by engineering",
};

export type NumericDisposition =
  | "eligible_for_correction"
  | "blocked_column_not_nullable"
  | "requires_engineering_disposition"
  | "resolve_in_canonical_ods_first"
  | "requires_human_review"
  | "requires_data_model_decision"
  | "represent_both_concepts";

export interface NumericFinding {
  domain: string;
  stable_id: string;
  field: string;
  label: string;
  farmops_entity: string | null;
  farmops_field: string;
  farmops_uuid: string | null;
  ods_worksheet: string;
  ods_column: string;
  ods_row: number | null;
  unit: string;
  ownership: NumericOwnership;
  ods_raw: string;
  ods_state: ParsedNumeric["state"];
  ods_value: number | null;
  farmops_raw: string;
  farmops_state: ParsedNumeric["state"];
  farmops_value: number | null;
  /** Numeric delta when both sides hold explicit numbers. */
  delta: number | null;
  category: NumericCategory;
  artifact_type: NumericArtifactType | null;
  implementation_created: boolean;
  provenance: string;
  historical_behavior: string;
  disposition: NumericDisposition;
  proposed_action: string;
  /** What a future apply step would write. `undefined` = nothing proposed. */
  proposed_value?: number | null;
  normalization_rules: string[];
  /**
   * Immutable historical/raw classification. Identical to `category` — kept as
   * an explicit field so the overlay below can never be mistaken for a
   * re-classification of the raw comparison.
   */
  raw_category: NumericCategory;
  /** True when an adjudication bound to this run's workbook SHA applied. */
  adjudicated: boolean;
  adjudication_id: string | null;
  adjudication_source: string | null;
  adjudication_classification: string | null;
  adjudication_rationale: string | null;
  /** Adjudication naming this finding but bound to a different workbook SHA. */
  stale_adjudication: boolean;
  /** Current disposition after the (read-only) adjudication overlay. */
  convergence_disposition: ConvergenceDisposition;
  /** True while the disposition leaves the finding open for Phase 4.5. */
  unresolved: boolean;
  /** Both source values / verified quantities, preserved and never merged. */
  preserved: string[];
}

export interface NumericFieldSummary {
  table: string;
  field: string;
  label: string;
  unit: string;
  ownership: NumericOwnership;
  comparable: boolean;
  compared: number;
  agreements: number;
  findings: number;
  counts_by_category: Record<NumericCategory, number>;
}

export interface NumericDiagnosticsReport {
  registry_version: string;
  diagnostics_version: string;
  generated_from_ods: string;
  ods_sha256: string;
  compared_at: string;
  /** Every numeric field in the model with its ownership decision. */
  registry: NumericRegistryEntry[];
  excluded_non_entity: typeof EXCLUDED_NON_ENTITY_NUMERICS;
  /** Numeric fields excluded from comparison, with the reason. */
  not_compared: { table: string; field: string; ownership: NumericOwnership; reason: string }[];
  compared_cells: number;
  agreements: number;
  total_findings: number;
  /** Raw / historical category counts — never reduced by adjudication. */
  counts_by_category: Record<NumericCategory, number>;
  /** Per category: findings carrying a SHA-bound adjudication. */
  adjudicated_counts_by_category: Record<NumericCategory, number>;
  /** Per category: findings still open after the disposition overlay. */
  unresolved_counts_by_category: Record<NumericCategory, number>;
  /** Disposition roll-up used by the dashboard and Phase 4.5 convergence. */
  disposition_counts: {
    adjudicated: number;
    unresolved: number;
    canonical_corrections_pending: number;
    farmops_corrections_pending: number;
    semantic_representation_differences: number;
    current_semantics_unresolved: number;
    provenance_or_field_verification_pending: number;
  };
  by_disposition: Partial<Record<ConvergenceDisposition, number>>;
  /** Adjudications naming a finding but bound to a different workbook SHA. */
  stale_adjudications: EstablishedAdjudication[];
  verified_bryant_quantities: typeof VERIFIED_BRYANT_QUANTITIES;
  counts_by_ods_state: Record<string, number>;
  by_field: NumericFieldSummary[];
  findings: NumericFinding[];
  /** Preview-only correction plan; Category A and nullable columns only. */
  plan: NumericFinding[];
  /** Category A findings a NOT NULL column prevents correcting. */
  blocked: NumericFinding[];
  /**
   * Read-only Category-E migration preview: current scalar representation vs
   * the proposed system-voltage representation, per affected record. Never
   * applied by this phase.
   */
  system_voltage_preview: SystemVoltageMigrationPreview;
  /** True while no production write path exists for numeric fields. */
  read_only: true;

}

const EMPTY_COUNTS = (): Record<NumericCategory, number> => ({
  A: 0,
  B: 0,
  C: 0,
  D: 0,
  E: 0,
  F: 0,
});

function defaultNumber(entry: NumericRegistryEntry): number | null {
  if (entry.db_default === null) return null;
  const n = Number(entry.db_default);
  return Number.isFinite(n) ? n : null;
}

interface Classified {
  category: NumericCategory;
  artifact?: NumericArtifactType;
  provenance: string;
  disposition: NumericDisposition;
  action: string;
  proposed?: number | null;
}

function classify(
  entry: NumericRegistryEntry,
  ods: ParsedNumeric,
  fp: ParsedNumeric,
  representedSystemVoltage: SystemVoltageRepresentation | null = null,
  representationPair: RepresentationPair | null = null,
): Classified {
  const column = `${entry.table}.${entry.field}`;
  const dbDefault = defaultNumber(entry);

  // E — canonical system-voltage notation (120/240). Checked before C: this is
  // resolved engineering data, not an unresolved workbook state, and the gap is
  // in the FarmOps scalar column. Nothing is normalized and nothing is written.
  if (ods.state === "system_voltage" || fp.state === "system_voltage") {
    const sys = ods.system_voltage ?? fp.system_voltage ?? null;
    const decomposition = sys
      ? `${sys.line_neutral} V line-to-neutral / ${sys.line_line} V line-to-line${sys.phases ? `, ${sys.phases}-phase` : ""}`
      : "two nominal voltages";
    const odsRep = resolveSystemVoltage((ods.state === "system_voltage" ? ods : fp).raw);
    // The model can now represent this. If FarmOps holds a system-voltage
    // designation that disagrees with the canonical one, that is an engineering
    // disagreement — not a representation gap.
    if (representedSystemVoltage) {
      return {
        category: "B",
        provenance: `Canonical workbook states system voltage "${(ods.state === "system_voltage" ? ods : fp).raw}" (${decomposition}); FarmOps represents ${representedSystemVoltage.designation}. Both sides state a full system designation and they differ.`,
        disposition: "requires_engineering_disposition",
        action:
          "Genuine system-voltage disagreement between two fully represented designations. Record an explicit engineering disposition; nothing is normalized and nothing is written.",
      };
    }
    return {
      category: "E",
      provenance: `${ods.state === "system_voltage" ? "Canonical workbook" : "FarmOps"} states system voltage "${(ods.state === "system_voltage" ? ods : fp).raw}" (${decomposition}). ${column} is a single ${entry.db_type} scalar and cannot represent a split-phase/wye system voltage.${
        isSystemVoltageField(entry.table, entry.field)
          ? ` ${entry.table}.${entry.field} carries system-designation semantics${odsRep ? `; the canonical designation is ${odsRep.designation}` : ""}, so the value belongs in a ${SYSTEM_VOLTAGE_COLUMN} representation rather than the scalar column.`
          : ""
      }`,
      disposition: "requires_data_model_decision",
      action:
        `Representation gap, not a numeric disagreement. The FarmOps system-voltage model represents this designation; populate the ${SYSTEM_VOLTAGE_COLUMN} system-voltage representation (line-to-neutral + line-to-line volts, phase, wires, canonical designation) for this record; see the system-voltage migration preview. Do not normalize to the line-to-line scalar and do not change the canonical ODS to satisfy a numeric column.`,
    };
  }


  // C — the workbook does not hold a number at all. This is checked before any
  // artifact rule so a TBD is never collapsed into 0 or NULL.
  if (ods.state === "non_numeric" || ods.state === "ambiguous_unit") {
    return {
      category: "C",
      provenance: ods.note,
      disposition: "resolve_in_canonical_ods_first",
      action:
        "Not representable as a number. Preserve the workbook text verbatim and resolve the engineering state in the canonical ODS before any FarmOps value is derived.",
    };
  }

  // A — a blank workbook cell against a column whose NOT NULL default provably
  // supplied the stored value.
  if (
    ods.state === "absent" &&
    isExplicitNumber(fp) &&
    entry.blank_becomes_default &&
    dbDefault !== null &&
    sameNumeric(fp.value, dbDefault)
  ) {
    const artifact: NumericArtifactType =
      dbDefault === 0 ? "N1_BLANK_DEFAULTED_ZERO" : "N2_BLANK_DEFAULTED_NONZERO";
    if (!entry.nullable) {
      return {
        category: "A",
        artifact,
        provenance: `Schema default: ${column} is ${entry.db_type} NOT NULL DEFAULT ${entry.db_default}; the workbook stated nothing.`,
        disposition: "blocked_column_not_nullable",
        action: `Provably implementation-created, but ${column} is NOT NULL: "not stated" cannot be stored today. A nullability migration is required before this can be corrected. No value is substituted.`,
      };
    }
    return {
      category: "A",
      artifact,
      provenance: `Schema default: ${column} defaulted to ${entry.db_default} while the workbook stated nothing.`,
      disposition: "eligible_for_correction",
      action: `Clear the default-created ${entry.db_default} so the field reads "not stated" (NULL).`,
      proposed: null,
    };
  }

  // F — a known semantic representation difference: two different concepts, or
  // the same current on two different calculation bases. Checked before B so it
  // stops being reported as an engineering disagreement. Both source values are
  // preserved and nothing is written.
  if (representationPair && isExplicitNumber(ods) && isExplicitNumber(fp)) {
    return {
      category: "F",
      provenance: `${representationPair.explanation} Canonical concept: ${representationPair.canonical_concept} (${REPRESENTATION_CONCEPT_LABELS[representationPair.canonical_concept]}); FarmOps value expresses ${representationPair.farmops_concept}.`,
      disposition: "represent_both_concepts",
      action: `Semantic representation difference, not a numeric correction. ${representationPair.proposed_representation} Both source values are preserved; ${column} is not overwritten and the canonical ODS is not modified.`,
    };
  }

  // B — both sides hold explicit numbers and they differ.
  if (isExplicitNumber(ods) && isExplicitNumber(fp)) {
    const zeroPair = ods.state === "zero" || fp.state === "zero";
    return {
      category: "B",
      provenance: zeroPair
        ? `Explicit zero on one side and an explicit value on the other (${ods.normalized || "0"} vs ${fp.normalized || "0"}). Zero is a stated engineering value, not "unknown".`
        : `Both the canonical workbook (${ods.normalized}) and FarmOps (${fp.normalized}) hold explicit ${entry.unit} values.`,
      disposition: "requires_engineering_disposition",
      action:
        "Genuine engineering disagreement. The canonical ODS remains the system of record; record an explicit disposition. No automatic change.",
    };
  }

  // D — one side is silent and the cause cannot be proven.
  if (ods.state === "absent" && isExplicitNumber(fp)) {
    return {
      category: "D",
      provenance: `Workbook states nothing; FarmOps holds ${fp.normalized}. ${entry.historical_behavior}`,
      disposition: "requires_human_review",
      action:
        "Provenance insufficient: the FarmOps value may be a legitimate as-built capture. Leave untouched pending review.",
    };
  }
  if (isExplicitNumber(ods) && fp.state === "absent") {
    return {
      category: "D",
      provenance: `Canonical workbook states ${ods.normalized} ${entry.unit}; FarmOps holds nothing.`,
      disposition: "requires_human_review",
      action:
        "Canonical value not captured in FarmOps. Import requires explicit engineering approval; nothing is written by this phase.",
    };
  }

  return {
    category: "D",
    provenance: `Neither side holds an interpretable ${entry.unit} value (ODS: ${ods.state}, FarmOps: ${fp.state}).`,
    disposition: "requires_human_review",
    action: "Insufficient provenance — leave untouched and review manually.",
  };
}

/**
 * Classify every numeric comparison in a validation report. Pure: the input
 * report is never mutated and no I/O happens here.
 */
/**
 * Read-only disposition overlay. The raw category is preserved verbatim; an
 * adjudication may only apply when it is bound to the same canonical ODS SHA as
 * the current run. Nothing here authorizes a write.
 */
function adjudicationOverlay(
  stableId: string,
  field: string,
  runSha: string,
  category: NumericCategory,
): Pick<
  NumericFinding,
  | "adjudicated"
  | "adjudication_id"
  | "adjudication_source"
  | "adjudication_classification"
  | "adjudication_rationale"
  | "stale_adjudication"
  | "convergence_disposition"
  | "unresolved"
  | "preserved"
> {
  const candidates = adjudicationsFor(stableId, field);
  const hit = candidates.find((a) => a.ods_sha256 === runSha) ?? null;
  const stale = candidates.some((a) => a.ods_sha256 !== runSha);
  const disposition: ConvergenceDisposition = hit
    ? hit.disposition
    : category === "A"
      ? "FARMOPS_CORRECTION_REQUIRED"
      : category === "F"
        ? "SEMANTIC_REPRESENTATION_DIFFERENCE"
        : category === "D"
          ? "PROVENANCE_VERIFICATION_REQUIRED"
          : "UNADJUDICATED";
  return {
    adjudicated: Boolean(hit),
    adjudication_id: hit?.id ?? null,
    adjudication_source: hit?.source ?? null,
    adjudication_classification: hit?.classification ?? null,
    adjudication_rationale: hit
      ? hit.rationale
      : stale
        ? "An adjudication exists for this finding but references a different canonical workbook SHA — it is stale and reduces nothing."
        : null,
    stale_adjudication: !hit && stale,
    convergence_disposition: disposition,
    unresolved: UNRESOLVED_DISPOSITIONS.has(disposition),
    preserved: hit ? hit.preserved : [],
  };
}

export function numericDiagnostics(report: ValidationReport): NumericDiagnosticsReport {
  const registry = numericRegistry();
  const findings: NumericFinding[] = [];
  const stale: EstablishedAdjudication[] = [];
  const byField = new Map<string, NumericFieldSummary>();
  const odsStates: Record<string, number> = {};
  let compared = 0;
  let agreements = 0;

  const summaryFor = (entry: NumericRegistryEntry): NumericFieldSummary => {
    const key = `${entry.table}.${entry.field}`;
    let s = byField.get(key);
    if (!s) {
      s = {
        table: entry.table,
        field: entry.field,
        label: entry.label,
        unit: entry.unit,
        ownership: entry.ownership,
        comparable: entry.comparable,
        compared: 0,
        agreements: 0,
        findings: 0,
        counts_by_category: EMPTY_COUNTS(),
      };
      byField.set(key, s);
    }
    return s;
  };

  // System-voltage representations FarmOps actually stores today. Sourced from
  // the comparison records themselves, so once a `system_voltage` column exists
  // and is populated, ODS 120/240 <-> FarmOps 120/240 becomes an agreement with
  // no further code change — and nothing is ever normalized to a scalar.
  const representedSystemVoltages = new Map<string, SystemVoltageRepresentation>();
  for (const rec of report.records as ComparisonRecord[]) {
    if (rec.farmops_field !== SYSTEM_VOLTAGE_COLUMN || !rec.farmops_entity) continue;
    const rep = resolveSystemVoltage(rec.farmops_value);
    if (rep) representedSystemVoltages.set(`${rec.farmops_entity}|${rec.stable_id}`, rep);
  }

  for (const rec of report.records as ComparisonRecord[]) {
    const entry = numericRegistryEntry(rec.farmops_entity, rec.farmops_field);
    // Field-level record only: skip record-level and column-level findings.
    if (!entry || !entry.comparable || rec.field === "__record") continue;

    const ods = parseNumericCell(rec.ods_value, entry.unit);
    const fp = parseNumericCell(rec.farmops_value, entry.unit);
    odsStates[ods.state] = (odsStates[ods.state] ?? 0) + 1;

    const summary = summaryFor(entry);
    compared += 1;
    summary.compared += 1;

    const represented = isSystemVoltageField(entry.table, entry.field)
      ? representedSystemVoltages.get(`${entry.table}|${rec.stable_id}`) ?? null
      : null;

    // Agreement: identical numbers, matching explicit zeros, both silent, or —
    // for a system-designation field — the same represented system voltage on
    // both sides (120/240 == 120/240, never 120/240 == 240).
    const agreed =
      (isExplicitNumber(ods) && isExplicitNumber(fp) && sameNumeric(ods.value, fp.value)) ||
      (ods.state === "absent" && fp.state === "absent") ||
      (ods.state === "system_voltage" &&
        sameSystemVoltage(resolveSystemVoltage(ods.raw), represented));
    if (agreed) {
      agreements += 1;
      summary.agreements += 1;
      continue;
    }

    const representationPair = representationPairFor({
      stable_id: rec.stable_id,
      farmops_entity: rec.farmops_entity,
      farmops_field: entry.field,
      ods_value: ods.value,
      farmops_value: fp.value,
    });

    const c = classify(entry, ods, fp, represented, representationPair);

    const finding: NumericFinding = {
      domain: rec.domain,
      stable_id: rec.stable_id,
      field: rec.field,
      label: entry.label,
      farmops_entity: rec.farmops_entity,
      farmops_field: entry.field,
      farmops_uuid: rec.farmops_uuid ?? null,
      ods_worksheet: rec.ods_worksheet ?? "",
      ods_column: rec.ods_column ?? "",
      ods_row: rec.ods_row ?? null,
      unit: entry.unit,
      ownership: entry.ownership,
      ods_raw: ods.raw,
      ods_state: ods.state,
      ods_value: ods.value,
      farmops_raw: fp.raw,
      farmops_state: fp.state,
      farmops_value: fp.value,
      delta:
        isExplicitNumber(ods) && isExplicitNumber(fp)
          ? Number(((fp.value ?? 0) - (ods.value ?? 0)).toFixed(4))
          : null,
      category: c.category,
      artifact_type: c.artifact ?? null,
      implementation_created: c.category === "A",
      provenance: c.provenance,
      historical_behavior: entry.historical_behavior,
      disposition: c.disposition,
      proposed_action: c.action,
      proposed_value: c.proposed,
      normalization_rules: [...ods.rules, ...fp.rules].filter((v, i, a) => a.indexOf(v) === i).sort(),
      raw_category: c.category,
      ...adjudicationOverlay(rec.stable_id, entry.field, report.ods.sha256, c.category),
    };
    if (finding.stale_adjudication) {
      for (const a of adjudicationsFor(rec.stable_id, entry.field)) {
        if (a.ods_sha256 !== report.ods.sha256 && !stale.some((s) => s.id === a.id)) stale.push(a);
      }
    }
    findings.push(finding);
    summary.findings += 1;
    summary.counts_by_category[c.category] += 1;
  }

  findings.sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      a.domain.localeCompare(b.domain) ||
      a.farmops_field.localeCompare(b.farmops_field) ||
      a.stable_id.localeCompare(b.stable_id),
  );

  const counts = EMPTY_COUNTS();
  for (const f of findings) counts[f.category] += 1;
  const adjudicatedCounts = EMPTY_COUNTS();
  const unresolvedCounts = EMPTY_COUNTS();
  const byDisposition: Partial<Record<ConvergenceDisposition, number>> = {};
  for (const f of findings) {
    if (f.adjudicated) adjudicatedCounts[f.category] += 1;
    if (f.unresolved) unresolvedCounts[f.category] += 1;
    byDisposition[f.convergence_disposition] =
      (byDisposition[f.convergence_disposition] ?? 0) + 1;
  }
  const dispositionCounts = {
    adjudicated: findings.filter((f) => f.adjudicated).length,
    unresolved: findings.filter((f) => f.unresolved).length,
    canonical_corrections_pending: byDisposition.CANONICAL_ODS_CORRECTION_REQUIRED ?? 0,
    farmops_corrections_pending: byDisposition.FARMOPS_CORRECTION_REQUIRED ?? 0,
    semantic_representation_differences: byDisposition.SEMANTIC_REPRESENTATION_DIFFERENCE ?? 0,
    current_semantics_unresolved: byDisposition.CURRENT_SEMANTICS_UNRESOLVED ?? 0,
    provenance_or_field_verification_pending:
      (byDisposition.PROVENANCE_VERIFICATION_REQUIRED ?? 0) +
      (byDisposition.FIELD_VERIFICATION_REQUIRED ?? 0),
  };

  const notCompared = registry
    .filter((e) => !e.comparable)
    .map((e) => ({ table: e.table, field: e.field, ownership: e.ownership, reason: e.reason }));

  return {
    registry_version: NUMERIC_REGISTRY_VERSION,
    diagnostics_version: NUMERIC_DIAGNOSTICS_VERSION,
    generated_from_ods: report.ods.file_name,
    ods_sha256: report.ods.sha256,
    compared_at: report.compared_at,
    registry,
    excluded_non_entity: EXCLUDED_NON_ENTITY_NUMERICS,
    not_compared: notCompared,
    compared_cells: compared,
    agreements,
    total_findings: findings.length,
    counts_by_category: counts,
    adjudicated_counts_by_category: adjudicatedCounts,
    unresolved_counts_by_category: unresolvedCounts,
    disposition_counts: dispositionCounts,
    by_disposition: byDisposition,
    stale_adjudications: stale,
    verified_bryant_quantities: VERIFIED_BRYANT_QUANTITIES,
    counts_by_ods_state: Object.fromEntries(
      Object.keys(odsStates)
        .sort()
        .map((k) => [k, odsStates[k]!]),
    ),
    by_field: [...byField.values()].sort(
      (a, b) => a.table.localeCompare(b.table) || a.field.localeCompare(b.field),
    ),
    findings,
    plan: findings.filter((f) => f.disposition === "eligible_for_correction"),
    blocked: findings.filter((f) => f.disposition === "blocked_column_not_nullable"),
    system_voltage_preview: systemVoltageMigrationPreview(
      findings.filter((f) => f.category === "E"),
    ),
    read_only: true,

  };
}

/**
 * Arithmetic proof that no finding was dropped:
 * compared = agreements + A + B + C + D, and A = plan + blocked.
 */
export function numericReconciliation(r: NumericDiagnosticsReport) {
  const c = r.counts_by_category;
  const categorized = c.A + c.B + c.C + c.D + c.E + c.F;
  return {
    compared_cells: r.compared_cells,
    agreements: r.agreements,
    categorized,
    balanced: r.agreements + categorized === r.compared_cells,
    category_a: c.A,
    category_e: c.E,
    category_f: c.F,
    plan: r.plan.length,
    blocked: r.blocked.length,
    category_a_balanced: r.plan.length + r.blocked.length === c.A,
  };
}

/* ------------------------------------------------------------------ exports */

function csv(rows: string[][]): string {
  return rows
    .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\n");
}

export function numericRegistryCsv(r: NumericDiagnosticsReport): string {
  const head = [
    "table",
    "field",
    "label",
    "db_type",
    "nullable",
    "db_default",
    "ods_column",
    "unit",
    "ownership",
    "comparable",
    "blank_becomes_default",
    "importer_behavior",
    "historical_behavior",
    "reason",
  ];
  return csv([
    head,
    ...r.registry.map((e) => [
      e.table,
      e.field,
      e.label,
      e.db_type,
      String(e.nullable),
      e.db_default ?? "",
      e.ods_column,
      e.unit,
      e.ownership,
      String(e.comparable),
      String(e.blank_becomes_default),
      e.importer_behavior,
      e.historical_behavior,
      e.reason,
    ]),
  ]);
}

export function numericFindingsCsv(r: NumericDiagnosticsReport): string {
  const head = [
    "raw_category",
    "adjudication_id",
    "adjudication_classification",
    "current_disposition",
    "unresolved",
    "stale_adjudication",
    "preserved",
    "category",
    "artifact_type",
    "entity_type",
    "stable_id",
    "farmops_entity",
    "farmops_field",
    "farmops_uuid",
    "ods_worksheet",
    "ods_column",
    "ods_row",
    "unit",
    "ods_raw",
    "ods_state",
    "farmops_raw",
    "farmops_state",
    "delta",
    "provenance",
    "historical_behavior",
    "disposition",
    "proposed_action",
    "proposed_value",
  ];
  return csv([
    head,
    ...r.findings.map((f) => [
      f.category,
      f.artifact_type ?? "",
      f.domain,
      f.stable_id,
      f.farmops_entity ?? "",
      f.farmops_field,
      f.farmops_uuid ?? "",
      f.ods_worksheet,
      f.ods_column,
      f.ods_row === null ? "" : String(f.ods_row),
      f.unit,
      f.ods_raw,
      f.ods_state,
      f.farmops_raw,
      f.farmops_state,
      f.delta === null ? "" : String(f.delta),
      f.provenance,
      f.historical_behavior,
      f.disposition,
      f.proposed_action,
      f.proposed_value === undefined ? "" : f.proposed_value === null ? "NULL" : String(f.proposed_value),
    ]),
  ]);
}

export function numericDiagnosticsMarkdown(r: NumericDiagnosticsReport): string {
  const recon = numericReconciliation(r);
  const lines: string[] = [
    "# Phase 4.4b — Numeric Semantics Diagnostics (preview only)",
    "",
    `- Canonical workbook: \`${r.generated_from_ods}\``,
    `- Workbook SHA-256: \`${r.ods_sha256}\``,
    `- Compared at: ${r.compared_at}`,
    `- Registry version: \`${r.registry_version}\` / diagnostics \`${r.diagnostics_version}\``,
    "- Writes performed: **none** (no database writes, no ODS writes, no apply path in this phase)",
    "",
    "## Reconciliation arithmetic",
    "",
    `- Compared numeric cells: ${recon.compared_cells}`,
    `- Agreements: ${recon.agreements}`,
    `- Category A ${r.counts_by_category.A} · B ${r.counts_by_category.B} · C ${r.counts_by_category.C} · D ${r.counts_by_category.D} · E ${r.counts_by_category.E} (representation / schema-semantic)`,
    `- Balanced: ${recon.balanced ? "yes" : "NO — investigate"} (agreements + categories = compared)`,
    `- Category A = plan ${recon.plan} + blocked ${recon.blocked}: ${recon.category_a_balanced ? "balanced" : "NO — investigate"}`,
    "",
    "## Numeric fields not compared",
    "",
    "| Table | Field | Ownership | Reason |",
    "| --- | --- | --- | --- |",
    ...r.not_compared.map((e) => `| ${e.table} | ${e.field} | ${e.ownership} | ${e.reason} |`),
    "",
    "## Numeric columns outside the compared entities",
    "",
    "| Table | Field | Ownership | Reason |",
    "| --- | --- | --- | --- |",
    ...r.excluded_non_entity.map((e) => `| ${e.table} | ${e.field} | ${e.ownership} | ${e.reason} |`),
    "",
    "## Findings",
    "",
    "| Cat | Entity | Stable ID | Field | ODS | FarmOps | Δ | Disposition |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...r.findings.map(
      (f) =>
        `| ${f.category} | ${f.domain} | ${f.stable_id} | ${f.farmops_field} | ${f.ods_raw || "(blank)"} | ${f.farmops_raw || "(blank)"} | ${f.delta === null ? "—" : f.delta} | ${f.disposition} |`,
    ),
    "",
    "## Category E — system-voltage migration preview (read-only, not applied)",
    "",
    `- Model version: \`${r.system_voltage_preview.model_version}\``,
    `- Proposed column: \`${r.system_voltage_preview.proposed_column}\``,
    `- Affected records: ${r.system_voltage_preview.affected_stable_ids.join(", ") || "none"}`,
    "- Applied: **no** — authorization required before any of these records change",
    "",
    "| Stable ID | Entity | ODS | Current FarmOps | Proposed designation | L-N | L-L | φ | Wires | Status |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...r.system_voltage_preview.rows.map(
      (p) =>
        `| ${p.stable_id} | ${p.farmops_entity} | ${p.ods_raw} | ${p.current_representation} | ${p.proposed.designation} | ${p.proposed.line_neutral_volts} | ${p.proposed.line_line_volts} | ${p.proposed.phases ?? "—"} | ${p.proposed.wires ?? "—"} | ${p.status} |`,
    ),
  ];

  return lines.join("\n");
}

/** Deterministic serialization for archival/diffing. */
export function serializeNumericDiagnostics(r: NumericDiagnosticsReport): string {
  return JSON.stringify(r, null, 2);
}
