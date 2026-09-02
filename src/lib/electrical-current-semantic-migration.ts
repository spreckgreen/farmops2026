// Phase 4.4b — canonical electrical-current semantic migration planning
// (READ-ONLY).
//
// The Bryant amperage adjudication established that the canonical ODS `Amps`
// column is semantically ambiguous: a single scalar column is being asked to
// carry several distinct electrical-current concepts. This module plans the
// target semantic schema *before* any canonical value is edited.
//
// Hard rules encoded here:
//   * nothing is written — not FarmOps, not the canonical workbook, and no
//     service / topology / panel / breaker data is touched;
//   * MOCP is never treated as a connected current;
//   * MCA is never derived — it stays NULL / unverified;
//   * 0 A is never read as a verified zero-load condition without provenance;
//   * a numeric coincidence with a published rating is never provenance: it is
//     recorded as a coincidence and confidence stays low.
import {
  baselineLabel,
  type AdjudicationBaseline,
  type CanonicalOdsLoadValues,
} from "@/lib/electrical-adjudication-baseline";
import { equipmentFor } from "@/lib/electrical-equipment-provenance";
import {
  VA_BASIS_LABELS,
  statedAmpSemantic,
  vaDerivation,
  zeroLoadEstablished,
  type VaBasis,
} from "@/lib/electrical-amp-semantics";
import type { FarmOpsLoadRow } from "@/lib/electrical-load-adjudication-production";

export const CURRENT_MIGRATION_VERSION = "4.4b-current-semantic-migration-1";

/** Loads that must always appear in the plan as fixtures. */
export const CURRENT_MIGRATION_FIXTURE_IDS = ["FS-082", "FS-083", "FS-084"] as const;

/* ------------------------------------------------------------------ *
 * Target semantic schema — the destination fields, not a migration.
 * ------------------------------------------------------------------ */

export type CurrentSemanticField =
  | "connected_load_current"
  | "rated_current_amps"
  | "rated_load_amps"
  | "equipment_fla"
  | "minimum_circuit_ampacity"
  | "maximum_overcurrent_protection"
  | "installed_ocp_rating"
  | "design_circuit_ampacity";

export interface CurrentSemanticFieldSpec {
  field: CurrentSemanticField;
  label: string;
  definition: string;
  /** Who is authoritative for the value. */
  authority: "engineering_design" | "manufacturer" | "field_observation";
  /** May a connected-VA calculation use this field as its operand? */
  va_operand_eligible: boolean;
  /** Rules that must never be violated when the field is eventually populated. */
  invariants: string[];
}

export const CURRENT_SEMANTIC_SCHEMA: CurrentSemanticFieldSpec[] = [
  {
    field: "connected_load_current",
    label: "Connected load current",
    definition:
      "Current the connected load actually draws in service. The only concept a connected-VA product may legitimately use.",
    authority: "engineering_design",
    va_operand_eligible: true,
    invariants: [
      "Never populated from MOCP, MCA or a breaker rating.",
      "A 0 value requires explicit provenance stating a verified zero-load condition.",
    ],
  },
  {
    field: "rated_current_amps",
    label: "Rated current amps (RCA)",
    definition: "Manufacturer-published rated current amps from the equipment electrical table.",
    authority: "manufacturer",
    va_operand_eligible: false,
    invariants: ["Only populated from published manufacturer data."],
  },
  {
    field: "rated_load_amps",
    label: "Rated load amps (RLA)",
    definition: "Manufacturer-published rated load amps of the compressor / motor.",
    authority: "manufacturer",
    va_operand_eligible: false,
    invariants: ["Kept distinct from RCA and from FLA; never averaged or merged."],
  },
  {
    field: "equipment_fla",
    label: "Equipment full-load amps (FLA)",
    definition: "Manufacturer-stated full-load / running current of the equipment as a whole.",
    authority: "manufacturer",
    va_operand_eligible: false,
    invariants: ["Never inferred from RLA or RCA."],
  },
  {
    field: "minimum_circuit_ampacity",
    label: "Minimum circuit ampacity (MCA)",
    definition: "Conductor-sizing minimum from the manufacturer's electrical table.",
    authority: "manufacturer",
    va_operand_eligible: false,
    invariants: [
      "Never derived or computed — populated only when a source states it, otherwise NULL.",
      "Never used as a load current.",
    ],
  },
  {
    field: "maximum_overcurrent_protection",
    label: "Maximum overcurrent protection (MOCP)",
    definition: "Largest permitted protective device for the equipment.",
    authority: "manufacturer",
    va_operand_eligible: false,
    invariants: [
      "Never treated as a connected or load current.",
      "Never substituted for a missing amps value.",
    ],
  },
  {
    field: "installed_ocp_rating",
    label: "Installed OCP rating",
    definition: "Rating of the protective device actually installed, as observed in the field.",
    authority: "field_observation",
    va_operand_eligible: false,
    invariants: ["Sourced from a field observation or breaker record, never from MOCP."],
  },
  {
    field: "design_circuit_ampacity",
    label: "Design circuit ampacity",
    definition: "Engineering design current selected for the branch circuit.",
    authority: "engineering_design",
    va_operand_eligible: false,
    invariants: ["Never conflated with connected load current."],
  },
];

export const CURRENT_SEMANTIC_FIELDS = CURRENT_SEMANTIC_SCHEMA.map((s) => s.field);

export const CURRENT_SEMANTIC_LABELS = Object.fromEntries(
  CURRENT_SEMANTIC_SCHEMA.map((s) => [s.field, s.label]),
) as Record<CurrentSemanticField, string>;

/* ------------------------------------------------------------------ *
 * Confidence, blockers, rows
 * ------------------------------------------------------------------ */

export type SemanticConfidence = "established" | "probable" | "possible" | "unresolved";

export const CONFIDENCE_LABELS: Record<SemanticConfidence, string> = {
  established: "Established — a source states the concept",
  probable: "Probable — corroborated, still requires confirmation",
  possible: "Possible — a single weak indicator only",
  unresolved: "Unresolved — no source states the concept",
};

export type MigrationBlocker =
  | "NONE"
  | "SEMANTIC_NOT_ESTABLISHED"
  | "ZERO_VALUE_MEANING_NOT_ESTABLISHED"
  | "DEPENDENT_VA_ARITHMETIC_UNRESOLVED"
  | "MCA_NOT_VERIFIED_NEVER_DERIVED"
  | "NO_CANONICAL_CURRENT_VALUE";

export const BLOCKER_LABELS: Record<MigrationBlocker, string> = {
  NONE: "No blocker — the target field is determined",
  SEMANTIC_NOT_ESTABLISHED:
    "No source states which current concept the canonical Amps value holds",
  ZERO_VALUE_MEANING_NOT_ESTABLISHED:
    "0 A is not established as a verified zero-load condition",
  DEPENDENT_VA_ARITHMETIC_UNRESOLVED:
    "Connected VA is computed from the same unresolved current value",
  MCA_NOT_VERIFIED_NEVER_DERIVED:
    "MCA is unverified for this equipment and is never derived",
  NO_CANONICAL_CURRENT_VALUE: "The canonical workbook states no current value for this load",
};

export interface MigrationEvidenceLine {
  source: string;
  states: string;
  /** Does this line state a current concept? A coincidence never does. */
  states_semantic: boolean;
}

export interface DependentFormula {
  field: string;
  value: number | null;
  basis: VaBasis;
  proof: string;
  /** True when this arithmetic rests on an unresolved current semantic. */
  depends_on_unresolved_current: boolean;
}

export interface CurrentMigrationRow {
  stable_id: string;
  description: string;
  workbook_name: string;
  workbook_sha256: string;
  worksheet: string | null;
  worksheet_row: number | null;
  ods_volts: number | null;
  /** Current ODS Amps — verbatim, never rewritten. */
  ods_amps: number | null;
  ods_va: number | null;
  farmops_amps: number | null;
  equipment_model: string | null;
  /** Manufacturer values kept strictly distinct. */
  manufacturer: {
    maximum_overcurrent_protection: number | null;
    rated_current_amps: number | null;
    rated_load_amps: number | null;
    equipment_fla: number | null;
    minimum_circuit_ampacity: number | null;
    mca_status: string;
  };
  semantic: string;
  confidence: SemanticConfidence;
  evidence: MigrationEvidenceLine[];
  /** Numeric coincidences, recorded and explicitly not used as provenance. */
  coincidences: string[];
  excluded_fields: { field: CurrentSemanticField; because: string }[];
  recommended_target_fields: CurrentSemanticField[];
  dependent_formulas: DependentFormula[];
  blockers: MigrationBlocker[];
  planned_action: string;
  is_fixture: boolean;
  /** Restated per row so an export audits standalone. */
  farmops_write_required: false;
  ods_edit_authorized: false;
}

export interface CurrentMigrationPlan {
  version: string;
  generated_at: string;
  workbook_name: string;
  workbook_sha256: string;
  baseline_label: string;
  is_phase_44a_baseline: boolean;
  schema: CurrentSemanticFieldSpec[];
  rows: CurrentMigrationRow[];
  counts: {
    affected: number;
    unresolved: number;
    established: number;
    zero_amps: number;
    va_dependent: number;
    blocked: number;
  };
  missing_fixture_ids: string[];
  read_only: true;
  apply_available: false;
}

const near = (a: number | null, b: number | null) =>
  a !== null && b !== null && Math.abs(a - b) < 0.5;

const isZero = (v: number | null) => v !== null && Math.abs(v) < 1e-9;

/** Concept → target field mapping for an affirmatively stated semantic. */
const STATED_TO_FIELD: [RegExp, CurrentSemanticField][] = [
  [/maximum_overcurrent_protection/, "maximum_overcurrent_protection"],
  [/minimum_circuit_ampacity/, "minimum_circuit_ampacity"],
  [/rated_load_amps/, "rated_load_amps"],
  [/rated_current_amps/, "rated_current_amps"],
  [/installed_breaker_ocp|installed_ocp_rating/, "installed_ocp_rating"],
  [/design_circuit_ampacity/, "design_circuit_ampacity"],
  [/equipment_fla/, "equipment_fla"],
  [/connected_load_current/, "connected_load_current"],
];

function statedField(stated: string): CurrentSemanticField | null {
  for (const [re, field] of STATED_TO_FIELD) if (re.test(stated)) return field;
  return null;
}

function exclusionsFor(
  amps: number | null,
  m: { mocp: number | null; rca: number | null; rla: number | null; fla: number | null },
): { field: CurrentSemanticField; because: string }[] {
  const out: { field: CurrentSemanticField; because: string }[] = [];
  out.push({
    field: "minimum_circuit_ampacity",
    because:
      "MCA is unverified for this equipment and is never derived, so the canonical value cannot be migrated into it.",
  });
  if (amps === null) return out;
  const differs = (v: number | null) => v !== null && !near(v, amps);
  if (differs(m.rca))
    out.push({
      field: "rated_current_amps",
      because: `${amps} A does not equal the published RCA of ${m.rca} A.`,
    });
  if (differs(m.rla))
    out.push({
      field: "rated_load_amps",
      because: `${amps} A does not equal the published RLA of ${m.rla} A.`,
    });
  if (differs(m.fla))
    out.push({
      field: "equipment_fla",
      because: `${amps} A does not equal the published FLA of ${m.fla} A.`,
    });
  if (differs(m.mocp))
    out.push({
      field: "maximum_overcurrent_protection",
      because: `${amps} A does not equal the published MOCP of ${m.mocp} A, and MOCP is never populated from a load-current column.`,
    });
  return out;
}

function coincidencesFor(
  amps: number | null,
  m: { mocp: number | null; rca: number | null; rla: number | null; fla: number | null },
): string[] {
  if (amps === null || isZero(amps)) return [];
  const out: string[] = [];
  const hit = (v: number | null, name: string) => {
    if (near(v, amps))
      out.push(
        `${amps} A coincides numerically with the published ${name} (${v} A). A coincidence is recorded, never used as provenance, and does not raise confidence.`,
      );
  };
  hit(m.mocp, "MOCP");
  hit(m.rca, "RCA");
  hit(m.rla, "RLA");
  hit(m.fla, "FLA");
  return out;
}

function evidenceFor(input: {
  ods: CanonicalOdsLoadValues;
  fp: FarmOpsLoadRow | undefined;
  label: string;
  stated: string | null;
  vaProof: string;
  equipmentLine: string;
}): MigrationEvidenceLine[] {
  const { ods, fp, label, stated, vaProof, equipmentLine } = input;
  return [
    {
      source: "canonical workbook column",
      states: `${ods.worksheet ?? "load worksheet"} row ${
        ods.row ?? "—"
      } of ${label} carries a single unqualified "Amps" column with no MCA / MOCP / breaker / design-ampacity column beside it.`,
      states_semantic: false,
    },
    {
      source: "canonical workbook arithmetic",
      states: vaProof,
      states_semantic: false,
    },
    {
      source: "FarmOps provenance",
      states:
        stated ??
        `No FarmOps text states a current concept (notes ${
          fp?.notes ? `"${fp.notes}"` : "empty"
        }; electrical_loads has no mapped OCP column).`,
      states_semantic: Boolean(stated),
    },
    {
      source: "equipment provenance",
      states: equipmentLine,
      states_semantic: false,
    },
    {
      source: "open questions",
      states: ods.open_questions?.length
        ? ods.open_questions.join(" · ")
        : "No open question is recorded against this row.",
      states_semantic: false,
    },
  ];
}

export function planCurrentSemanticMigration(input: {
  baseline: AdjudicationBaseline;
  rows: FarmOpsLoadRow[];
  generatedAt?: string;
}): CurrentMigrationPlan {
  const { baseline } = input;
  const label = baselineLabel(baseline);
  const byId = new Map(input.rows.map((r) => [r.load_id.trim(), r]));

  const rows: CurrentMigrationRow[] = [];

  for (const ods of baseline.loads) {
    const stableId = ods.stable_id;
    const fp = byId.get(stableId);
    const eq = equipmentFor(stableId);
    const m = {
      mocp: eq?.semantics.maximum_overcurrent_protection ?? null,
      rca: eq?.semantics.rated_current_amps ?? null,
      rla: eq?.semantics.rated_load_amps ?? null,
      fla: eq?.semantics.equipment_fla ?? null,
    };
    const va = vaDerivation(ods.volts, ods.amps, ods.connected_va);
    const stated = statedAmpSemantic(fp);
    const zero = isZero(ods.amps);
    const zeroVerified = zero && zeroLoadEstablished(fp);
    const isFixture = (CURRENT_MIGRATION_FIXTURE_IDS as readonly string[]).includes(stableId);

    const excluded = exclusionsFor(ods.amps, m);
    const coincidences = coincidencesFor(ods.amps, m);

    let confidence: SemanticConfidence;
    let semantic: string;
    let targets: CurrentSemanticField[];
    const blockers: MigrationBlocker[] = [];

    const mapped = stated ? statedField(stated) : null;

    if (ods.amps === null) {
      confidence = "unresolved";
      semantic = "No canonical current value is stated, so no concept can be assigned.";
      targets = [];
      blockers.push("NO_CANONICAL_CURRENT_VALUE");
    } else if (stated && mapped) {
      confidence = "established";
      semantic = stated;
      targets = [mapped];
    } else if (zero && zeroVerified) {
      confidence = "probable";
      semantic =
        "0 A with explicit provenance for a verified zero-load condition — a connected-load-current reading of zero.";
      targets = ["connected_load_current"];
    } else if (zero) {
      confidence = "unresolved";
      semantic =
        "Unresolved. 0 A may mean not-yet-installed, an unpopulated cell or a real zero draw; no provenance states which, so it is not read as a verified zero-load condition.";
      targets = CURRENT_SEMANTIC_FIELDS.filter(
        (f) => !excluded.some((e) => e.field === f),
      );
      blockers.push("ZERO_VALUE_MEANING_NOT_ESTABLISHED", "SEMANTIC_NOT_ESTABLISHED");
    } else {
      confidence = "unresolved";
      semantic =
        "Unresolved. The value participates as the operand of the connected-VA product, but no source distinguishes which current concept it holds.";
      targets = CURRENT_SEMANTIC_FIELDS.filter((f) => !excluded.some((e) => e.field === f));
      blockers.push("SEMANTIC_NOT_ESTABLISHED");
    }

    const vaDependent =
      va.basis === "derived_volts_times_amps" && confidence !== "established";
    if (vaDependent) blockers.push("DEPENDENT_VA_ARITHMETIC_UNRESOLVED");
    if (eq?.ampacity_verification_pending || m.mocp !== null)
      blockers.push("MCA_NOT_VERIFIED_NEVER_DERIVED");
    if (!blockers.length) blockers.push("NONE");

    const dependent: DependentFormula[] = [
      {
        field: "connected_va",
        value: ods.connected_va,
        basis: va.basis,
        proof: va.proof,
        depends_on_unresolved_current: vaDependent,
      },
    ];

    const planned = [
      confidence === "established"
        ? `Plan a migration of the canonical Amps value into ${CURRENT_SEMANTIC_LABELS[targets[0]!]} once the target schema exists. No value is edited by this plan.`
        : `Record affirmative provenance for ${stableId}'s ${
            zero ? "0 A cell" : `${ods.amps ?? "—"} A figure`
          } (measurement, design selection, observed breaker, or nameplate) before assigning it to any target field.`,
      vaDependent
        ? `Connected VA (${ods.connected_va}) is ${ods.volts} × ${ods.amps} and therefore inherits the unresolved semantic — it must not be treated as an independently verified connected load.`
        : null,
      `Keep MOCP${m.mocp !== null ? ` (${m.mocp} A)` : ""} out of any load-current field and leave MCA NULL / unverified.`,
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
      manufacturer: {
        maximum_overcurrent_protection: m.mocp,
        rated_current_amps: m.rca,
        rated_load_amps: m.rla,
        equipment_fla: m.fla,
        minimum_circuit_ampacity: eq?.semantics.minimum_circuit_ampacity ?? null,
        mca_status:
          eq?.semantics.minimum_circuit_ampacity === null || eq === undefined
            ? "NULL / unverified — never derived"
            : "stated by manufacturer data",
      },
      semantic,
      confidence,
      evidence: evidenceFor({
        ods,
        fp,
        label,
        stated,
        vaProof: va.proof,
        equipmentLine: eq
          ? `Verified ${eq.manufacturer} ${eq.model}: MOCP ${m.mocp ?? "not stated"} A, RCA ${
              m.rca ?? "not stated"
            } A, RLA ${m.rla ?? "not stated"} A, MCA ${
              eq.semantics.minimum_circuit_ampacity ?? "NULL / unverified"
            }. Equipment data bounds plausible values but does not state which concept the workbook column holds.`
          : "No verified equipment provenance is on file for this load.",
      }),
      coincidences,
      excluded_fields: excluded,
      recommended_target_fields: targets,
      dependent_formulas: dependent,
      blockers,
      planned_action: planned,
      is_fixture: isFixture,
      farmops_write_required: false,
      ods_edit_authorized: false,
    });
  }

  const missingFixtures = CURRENT_MIGRATION_FIXTURE_IDS.filter(
    (id) => !rows.some((r) => r.stable_id === id),
  );

  return {
    version: CURRENT_MIGRATION_VERSION,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    workbook_name: baseline.ods_file_name,
    workbook_sha256: baseline.ods_sha256,
    baseline_label: label,
    is_phase_44a_baseline: baseline.is_phase_44a_baseline,
    schema: CURRENT_SEMANTIC_SCHEMA,
    rows,
    counts: {
      affected: rows.length,
      unresolved: rows.filter((r) => r.confidence === "unresolved").length,
      established: rows.filter((r) => r.confidence === "established").length,
      zero_amps: rows.filter((r) => isZero(r.ods_amps)).length,
      va_dependent: rows.filter((r) =>
        r.dependent_formulas.some((d) => d.depends_on_unresolved_current),
      ).length,
      blocked: rows.filter((r) => !r.blockers.includes("NONE")).length,
    },
    missing_fixture_ids: [...missingFixtures],
    read_only: true,
    apply_available: false,
  };
}

/* ------------------------------------------------------------------ *
 * Exports
 * ------------------------------------------------------------------ */

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const CURRENT_MIGRATION_CSV_HEADER = [
  "stable_id",
  "workbook_name",
  "worksheet",
  "worksheet_row",
  "workbook_sha256",
  "ods_volts",
  "current_ods_amps",
  "ods_connected_va",
  "farmops_amps",
  "likely_or_known_semantic",
  "confidence",
  "evidence",
  "numeric_coincidences",
  "mocp",
  "rca",
  "rla",
  "fla",
  "mca",
  "dependent_formulas",
  "recommended_target_fields",
  "migration_blockers",
  "planned_action",
] as const;

export function currentMigrationCsv(plan: CurrentMigrationPlan): string {
  return [
    CURRENT_MIGRATION_CSV_HEADER.join(","),
    ...plan.rows.map((r) =>
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
        r.semantic,
        r.confidence,
        r.evidence.map((e) => `${e.source}: ${e.states}`).join(" | "),
        r.coincidences.join(" | ") || "none",
        r.manufacturer.maximum_overcurrent_protection,
        r.manufacturer.rated_current_amps,
        r.manufacturer.rated_load_amps,
        r.manufacturer.equipment_fla,
        r.manufacturer.minimum_circuit_ampacity ?? r.manufacturer.mca_status,
        r.dependent_formulas
          .map(
            (d) =>
              `${d.field}=${d.value ?? "not stated"} (${VA_BASIS_LABELS[d.basis]}${
                d.depends_on_unresolved_current ? "; depends on unresolved current" : ""
              })`,
          )
          .join(" | "),
        r.recommended_target_fields.join(" | ") || "none",
        r.blockers.join(" + "),
        r.planned_action,
      ]
        .map(cell)
        .join(","),
    ),
  ].join("\n");
}

export function currentMigrationMarkdown(plan: CurrentMigrationPlan): string {
  const n = (v: number | null) => (v === null ? "not stated" : String(v));
  const lines: string[] = [
    "# Phase 4.4b — canonical electrical-current semantic migration plan (read-only)",
    "",
    `- Version: ${plan.version}`,
    `- Generated: ${plan.generated_at}`,
    `- Canonical workbook: ${plan.workbook_name} (SHA-256 ${plan.workbook_sha256})`,
    `- Baseline: ${plan.baseline_label}`,
    `- Loads examined: ${plan.counts.affected} · unresolved ${plan.counts.unresolved} · established ${plan.counts.established} · 0 A ${plan.counts.zero_amps} · VA dependent on an unresolved current ${plan.counts.va_dependent} · blocked ${plan.counts.blocked}`,
    "- No FarmOps write, no canonical ODS edit, and no change to service, topology, panel or breaker data is authorized by this plan. MOCP is never used as a connected current, MCA is never derived, and 0 A is not read as a verified zero-load condition.",
    "",
    "## Target semantic schema",
    "",
    "| Field | Label | Authority | VA operand | Definition | Invariants |",
    "| --- | --- | --- | --- | --- | --- |",
    ...plan.schema.map(
      (s) =>
        `| \`${s.field}\` | ${s.label} | ${s.authority} | ${
          s.va_operand_eligible ? "eligible" : "never"
        } | ${s.definition} | ${s.invariants.join(" ")} |`,
    ),
    "",
    "## Affected records",
    "",
    "| Stable ID | Current ODS Amps | Likely/known semantic | Evidence | Confidence | Dependent formulas / VA | Recommended target field(s) | Migration blocker |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const r of plan.rows) {
    lines.push(
      `| ${r.stable_id}${r.is_fixture ? " (fixture)" : ""} | ${n(r.ods_amps)} | ${r.semantic} | ${r.evidence
        .map((e) => `${e.source}: ${e.states}`)
        .join(" ")} | ${CONFIDENCE_LABELS[r.confidence]} | ${r.dependent_formulas
        .map(
          (d) =>
            `${d.field} = ${d.value ?? "not stated"} — ${VA_BASIS_LABELS[d.basis]}${
              d.depends_on_unresolved_current ? " — depends on an unresolved current semantic" : ""
            }`,
        )
        .join(" ")} | ${r.recommended_target_fields.join(", ") || "none"} | ${r.blockers
        .map((b) => BLOCKER_LABELS[b])
        .join(" ")} |`,
    );
  }
  for (const r of plan.rows) {
    lines.push(
      "",
      `## ${r.stable_id} · ${r.description}`,
      "",
      `- Workbook: ${r.workbook_name}, worksheet ${r.worksheet ?? "not parsed"}, row ${
        r.worksheet_row ?? "not parsed"
      }, SHA-256 ${r.workbook_sha256}`,
      `- Canonical: ${n(r.ods_volts)} V, ${n(r.ods_amps)} A, ${n(r.ods_va)} VA · FarmOps amps ${n(
        r.farmops_amps,
      )}`,
      `- Equipment: ${r.equipment_model ?? "not established"} — MOCP ${n(
        r.manufacturer.maximum_overcurrent_protection,
      )} A, RCA ${n(r.manufacturer.rated_current_amps)} A, RLA ${n(
        r.manufacturer.rated_load_amps,
      )} A, FLA ${n(r.manufacturer.equipment_fla)} A, MCA ${
        r.manufacturer.minimum_circuit_ampacity ?? r.manufacturer.mca_status
      }`,
      `- Excluded target fields: ${
        r.excluded_fields.length
          ? r.excluded_fields.map((e) => `${e.field} (${e.because})`).join(" ")
          : "none"
      }`,
      `- Numeric coincidences: ${r.coincidences.join(" ") || "none"}`,
      `- Planned action: ${r.planned_action}`,
    );
  }
  return lines.join("\n");
}
