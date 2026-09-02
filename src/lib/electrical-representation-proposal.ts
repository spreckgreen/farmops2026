// Phase 4.4b — voltage / VA semantic representation proposal (READ-ONLY).
//
// FS-034 and FS-092 hold two *different but simultaneously correct* statements
// of the same installation: a canonical nominal/design supply voltage and an
// equipment nameplate rated voltage, each with its own VA arithmetic. This
// module models that as a representation difference — never as a numeric
// correction — and never writes anything:
//   * the canonical ODS is never modified;
//   * the FarmOps scalar columns (volts, connected_va) are not overwritten;
//   * nothing here has an apply path.
//
// Invariants encoded below:
//   * 6600 VA is NOT a correction to 7200 VA (and 1012 VA is not a correction to
//     1056 VA): they are the nameplate-voltage calculation basis of the same
//     current, preserved alongside the canonical nominal-basis value.
//   * connected_va is meaningless without connected_va_basis, so every proposed
//     VA value carries the basis that produced it.
import {
  equipmentFor,
  type EquipmentProvenance,
} from "@/lib/electrical-equipment-provenance";

export const REPRESENTATION_PROPOSAL_VERSION =
  "4.4b-voltage-va-representation-proposal-1";

/** The concepts the proposal keeps distinct. */
export const REPRESENTATION_CONCEPTS = [
  "nominal_supply_voltage",
  "rated_nameplate_voltage",
  "connected_va",
  "connected_va_basis",
  "equipment_fla",
] as const;

export type RepresentationConcept = (typeof REPRESENTATION_CONCEPTS)[number];

export const REPRESENTATION_CONCEPT_LABELS: Record<RepresentationConcept, string> = {
  nominal_supply_voltage:
    "Nominal supply voltage — canonical engineering/design designation for the circuit.",
  rated_nameplate_voltage:
    "Rated nameplate voltage — the equipment manufacturer's designation, never a correction to the nominal supply.",
  connected_va:
    "Connected VA — a calculated apparent power value that is only interpretable together with its basis.",
  connected_va_basis:
    "Connected VA basis — which voltage (or supplied manufacturer figure) produced the stored VA.",
  equipment_fla:
    "Equipment full-load amps — manufacturer-stated running current of the equipment.",
};

/** How a stored VA number was produced. Explicit, never inferred silently. */
export type ConnectedVaBasis =
  | "nominal_design_supply_voltage"
  | "equipment_nameplate_voltage"
  | "manufacturer_supplied_va"
  | "other_documented_basis"
  | "basis_not_established";

export const VA_BASIS_LABELS: Record<ConnectedVaBasis, string> = {
  nominal_design_supply_voltage:
    "Calculated from the nominal / design supply voltage × current.",
  equipment_nameplate_voltage:
    "Calculated from the equipment nameplate rated voltage × current.",
  manufacturer_supplied_va:
    "Supplied directly by the manufacturer as a VA figure — not calculated here.",
  other_documented_basis: "Another documented basis, stated by the cited source.",
  basis_not_established:
    "Basis not established — the stored VA cannot be interpreted until a basis is cited.",
};

export type RepresentationDisposition =
  /** Both statements are preserved and describe the same installation. */
  | "SEMANTIC_REPRESENTATION_AGREEMENT"
  /** Both preserved, and they are different concepts / calculation bases. */
  | "SEMANTIC_REPRESENTATION_DIFFERENCE"
  /** Still a real engineering disagreement — not reclassified. */
  | "ENGINEERING_DISAGREEMENT_RETAINED";

export const REPRESENTATION_DISPOSITION_LABELS: Record<RepresentationDisposition, string> = {
  SEMANTIC_REPRESENTATION_AGREEMENT:
    "Semantic representation agreement — one installation, two correct statements; both source values preserved.",
  SEMANTIC_REPRESENTATION_DIFFERENCE:
    "Semantic representation difference — different concepts or calculation bases, not a numeric conflict; both source values preserved.",
  ENGINEERING_DISAGREEMENT_RETAINED:
    "Engineering disagreement retained — no representation model explains this difference.",
};

export interface RepresentationRow {
  stable_id: string;
  description: string;
  concept: RepresentationConcept;
  /** Canonical / design value from the workbook. Verbatim, never rewritten. */
  canonical_value: string;
  /** Equipment / nameplate value from manufacturer evidence. */
  nameplate_value: string;
  /** What the FarmOps scalar column holds today. Not overwritten. */
  farmops_legacy_value: string;
  calculation_basis: string;
  va_basis: ConnectedVaBasis | null;
  proposed_representation: string;
  disposition: RepresentationDisposition;
  provenance: string[];
  /** Structural guarantees: this row authorizes nothing. */
  farmops_write_authorized: false;
  ods_edit_authorized: false;
}

/**
 * One reclassified numeric pair: an ODS↔FarmOps difference that stops being a
 * Category-B engineering disagreement once both representations exist.
 */
export interface RepresentationPair {
  stable_id: string;
  farmops_entity: string;
  farmops_field: string;
  ods_value: number;
  farmops_value: number;
  concept: RepresentationConcept;
  canonical_concept: RepresentationConcept;
  farmops_concept: RepresentationConcept;
  basis: ConnectedVaBasis;
  disposition: RepresentationDisposition;
  explanation: string;
  proposed_representation: string;
}

interface Fixture {
  stable_id: string;
  description: string;
  ods_volts: number;
  ods_amps: number;
  ods_va: number;
  nameplate_volts: number;
  nameplate_va: number;
  /** Current basis both sides state independently. */
  basis_amps: number;
  /** True when the manufacturer states the current as equipment FLA. */
  fla_established: boolean;
  legacy_volts: number;
  legacy_va: number;
}

export const REPRESENTATION_FIXTURES: Fixture[] = [
  {
    stable_id: "FS-034",
    description: "Shop Lift — Halo Lifts HL2C-10K-1",
    ods_volts: 240,
    ods_amps: 30,
    ods_va: 7200,
    nameplate_volts: 220,
    nameplate_va: 6600,
    basis_amps: 30,
    fla_established: false,
    legacy_volts: 220,
    legacy_va: 6600,
  },
  {
    stable_id: "FS-092",
    description: "Emergency shop purge fan — Greenheck AER-24-03-0315-VG",
    ods_volts: 120,
    ods_amps: 8.8,
    ods_va: 1056,
    nameplate_volts: 115,
    nameplate_va: 1012,
    basis_amps: 8.8,
    fla_established: true,
    legacy_volts: 115,
    legacy_va: 1012,
  },
];

export const REPRESENTATION_FIXTURE_IDS = REPRESENTATION_FIXTURES.map((f) => f.stable_id);

const num = (v: number) => (Number.isInteger(v) ? String(v) : String(v));

function provenanceLines(eq: EquipmentProvenance | undefined, extra: string[]): string[] {
  const cited = (eq?.records ?? []).map(
    (r) => `${r.source_reference}: ${r.observed_or_published_value}`,
  );
  return [...extra, ...cited];
}

/** Rounded VA product, so 115 × 8.8 = 1012 rather than 1011.9999999999999. */
export function vaProduct(volts: number, amps: number): number {
  return Number((volts * amps).toFixed(2));
}

/**
 * The read-only representation proposal for FS-034 and FS-092. Pure: no I/O, no
 * mutation, no apply path.
 */
export function representationProposal(input: { generatedAt?: string } = {}): {
  version: string;
  generated_at: string;
  concepts: typeof REPRESENTATION_CONCEPTS;
  rows: RepresentationRow[];
  pairs: RepresentationPair[];
  counts: {
    fixtures: number;
    rows: number;
    reclassified_pairs: number;
    retained_disagreements: number;
  };
  read_only: true;
  apply_available: false;
} {
  const rows: RepresentationRow[] = [];

  for (const f of REPRESENTATION_FIXTURES) {
    const eq = equipmentFor(f.stable_id);
    const nominalCalc = `${num(f.ods_volts)} × ${num(f.basis_amps)} = ${num(vaProduct(f.ods_volts, f.basis_amps))} VA`;
    const nameplateCalc = `${num(f.nameplate_volts)} × ${num(f.basis_amps)} = ${num(vaProduct(f.nameplate_volts, f.basis_amps))} VA`;
    const shared = provenanceLines(eq, [
      `Canonical workbook states ${num(f.ods_volts)} V, ${num(f.basis_amps)} A, ${num(f.ods_va)} VA and is not modified.`,
    ]);

    rows.push({
      stable_id: f.stable_id,
      description: f.description,
      concept: "nominal_supply_voltage",
      canonical_value: `${num(f.ods_volts)} V`,
      nameplate_value: "not applicable — the nameplate does not state the site supply designation",
      farmops_legacy_value: `${num(f.legacy_volts)} V stored in electrical_loads.volts`,
      calculation_basis: "Canonical engineering / design supply designation for the circuit.",
      va_basis: null,
      proposed_representation: `nominal_supply_voltage = ${num(f.ods_volts)} V (canonical, unchanged)`,
      disposition: "SEMANTIC_REPRESENTATION_DIFFERENCE",
      provenance: shared,
      farmops_write_authorized: false,
      ods_edit_authorized: false,
    });

    rows.push({
      stable_id: f.stable_id,
      description: f.description,
      concept: "rated_nameplate_voltage",
      canonical_value: "not stated — the workbook states the supply designation, not the nameplate",
      nameplate_value: `${num(f.nameplate_volts)} V`,
      farmops_legacy_value: `${num(f.legacy_volts)} V stored in electrical_loads.volts`,
      calculation_basis: "Manufacturer nameplate / published rated voltage.",
      va_basis: null,
      proposed_representation: `rated_nameplate_voltage = ${num(f.nameplate_volts)} V, preserved alongside nominal_supply_voltage = ${num(f.ods_volts)} V`,
      disposition: "SEMANTIC_REPRESENTATION_AGREEMENT",
      provenance: shared,
      farmops_write_authorized: false,
      ods_edit_authorized: false,
    });

    rows.push({
      stable_id: f.stable_id,
      concept: "connected_va",
      description: f.description,
      canonical_value: `${num(f.ods_va)} VA (${nominalCalc})`,
      nameplate_value: `${num(f.nameplate_va)} VA (${nameplateCalc})`,
      farmops_legacy_value: `${num(f.legacy_va)} VA stored in electrical_loads.connected_va`,
      calculation_basis: nominalCalc,
      va_basis: "nominal_design_supply_voltage",
      proposed_representation: `connected_va = ${num(f.ods_va)} VA with connected_va_basis = nominal_design_supply_voltage; ${num(f.nameplate_va)} VA retained as the nameplate-basis calculation, not as a correction`,
      disposition: "SEMANTIC_REPRESENTATION_DIFFERENCE",
      provenance: shared,
      farmops_write_authorized: false,
      ods_edit_authorized: false,
    });

    rows.push({
      stable_id: f.stable_id,
      concept: "connected_va_basis",
      description: f.description,
      canonical_value: `nominal_design_supply_voltage (${nominalCalc})`,
      nameplate_value: `equipment_nameplate_voltage (${nameplateCalc})`,
      farmops_legacy_value: "not represented — the legacy column stores a bare VA scalar",
      calculation_basis:
        "The basis is recorded explicitly so a VA value is never compared across different bases.",
      va_basis: "nominal_design_supply_voltage",
      proposed_representation:
        "connected_va_basis is required whenever connected_va is stored; permitted values: nominal_design_supply_voltage, equipment_nameplate_voltage, manufacturer_supplied_va, other_documented_basis.",
      disposition: "SEMANTIC_REPRESENTATION_DIFFERENCE",
      provenance: shared,
      farmops_write_authorized: false,
      ods_edit_authorized: false,
    });

    rows.push({
      stable_id: f.stable_id,
      concept: "equipment_fla",
      description: f.description,
      canonical_value: `${num(f.basis_amps)} A stated as the workbook current`,
      nameplate_value: f.fla_established
        ? `${num(f.basis_amps)} A published FLA`
        : "FLA not stated by the supplied evidence",
      farmops_legacy_value: `${num(f.basis_amps)} A stored in electrical_loads.amps`,
      calculation_basis: eq?.va_basis_source ?? "Current basis stated identically by both records.",
      va_basis: null,
      proposed_representation: f.fla_established
        ? `equipment_fla = ${num(f.basis_amps)} A (manufacturer-stated); it is the basis current for both VA calculations`
        : `Current basis ${num(f.basis_amps)} A preserved; equipment_fla stays unset because no manufacturer FLA is cited — see the current-semantic migration plan for the remaining current concepts`,
      disposition: "SEMANTIC_REPRESENTATION_AGREEMENT",
      provenance: shared,
      farmops_write_authorized: false,
      ods_edit_authorized: false,
    });
  }

  const pairs = REPRESENTATION_FIXTURES.flatMap<RepresentationPair>((f) => [
    {
      stable_id: f.stable_id,
      farmops_entity: "electrical_loads",
      farmops_field: "volts",
      ods_value: f.ods_volts,
      farmops_value: f.legacy_volts,
      concept: "nominal_supply_voltage",
      canonical_concept: "nominal_supply_voltage",
      farmops_concept: "rated_nameplate_voltage",
      basis: "basis_not_established",
      disposition: "SEMANTIC_REPRESENTATION_DIFFERENCE",
      explanation: `${num(f.ods_volts)} V is the canonical nominal supply designation and ${num(f.nameplate_volts)} V is the equipment nameplate rating. Both are correct for this installation; the single scalar column can only hold one of them.`,
      proposed_representation: `nominal_supply_voltage = ${num(f.ods_volts)} V and rated_nameplate_voltage = ${num(f.nameplate_volts)} V, both preserved.`,
    },
    {
      stable_id: f.stable_id,
      farmops_entity: "electrical_loads",
      farmops_field: "connected_va",
      ods_value: f.ods_va,
      farmops_value: f.legacy_va,
      concept: "connected_va",
      canonical_concept: "connected_va",
      farmops_concept: "connected_va",
      basis: "nominal_design_supply_voltage",
      disposition: "SEMANTIC_REPRESENTATION_DIFFERENCE",
      explanation: `${num(f.ods_va)} VA is ${num(f.ods_volts)} × ${num(f.basis_amps)} on the nominal design supply; ${num(f.legacy_va)} VA is ${num(f.nameplate_volts)} × ${num(f.basis_amps)} on the nameplate voltage. Different calculation bases of the same current — the nameplate figure is not a correction to the canonical value.`,
      proposed_representation: `connected_va = ${num(f.ods_va)} VA with connected_va_basis = nominal_design_supply_voltage; the ${num(f.nameplate_va)} VA nameplate-basis figure is retained as an alternative basis.`,
    },
  ]);

  return {
    version: REPRESENTATION_PROPOSAL_VERSION,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    concepts: REPRESENTATION_CONCEPTS,
    rows,
    pairs,
    counts: {
      fixtures: REPRESENTATION_FIXTURES.length,
      rows: rows.length,
      reclassified_pairs: pairs.length,
      retained_disagreements: pairs.filter(
        (p) => p.disposition === "ENGINEERING_DISAGREEMENT_RETAINED",
      ).length,
    },
    read_only: true,
    apply_available: false,
  };
}

export type RepresentationProposal = ReturnType<typeof representationProposal>;

const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * Reclassification hook for the numeric diagnostics: returns the representation
 * pair when an ODS↔FarmOps numeric difference is a known nominal-vs-nameplate or
 * calculation-basis representation difference, otherwise null (so the difference
 * stays a genuine engineering disagreement).
 */
export function representationPairFor(input: {
  stable_id: string;
  farmops_entity: string | null;
  farmops_field: string;
  ods_value: number | null;
  farmops_value: number | null;
}): RepresentationPair | null {
  if (input.ods_value === null || input.farmops_value === null) return null;
  const { pairs } = representationProposal({ generatedAt: "1970-01-01T00:00:00.000Z" });
  return (
    pairs.find(
      (p) =>
        p.stable_id === input.stable_id &&
        p.farmops_entity === (input.farmops_entity ?? p.farmops_entity) &&
        p.farmops_field === input.farmops_field &&
        near(p.ods_value, input.ods_value as number) &&
        near(p.farmops_value, input.farmops_value as number),
    ) ?? null
  );
}

const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;

export function representationProposalCsv(p: RepresentationProposal): string {
  const header = [
    "stable_id",
    "concept",
    "canonical_design_value",
    "equipment_nameplate_value",
    "farmops_legacy_value",
    "calculation_basis",
    "proposed_representation",
    "disposition",
    "provenance",
  ];
  const lines = p.rows.map((r) =>
    [
      r.stable_id,
      r.concept,
      r.canonical_value,
      r.nameplate_value,
      r.farmops_legacy_value,
      r.va_basis ? `${r.calculation_basis} [${r.va_basis}]` : r.calculation_basis,
      r.proposed_representation,
      r.disposition,
      r.provenance.join(" | "),
    ]
      .map(cell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export function representationProposalMarkdown(p: RepresentationProposal): string {
  const out: string[] = [
    "# FS-034 / FS-092 voltage and VA semantic representation proposal",
    "",
    `Version ${p.version} — generated ${p.generated_at}.`,
    "",
    "Read-only. The canonical ODS is not modified, the FarmOps scalar columns are not overwritten, and there is no apply path. The nameplate-basis VA values (6600 VA, 1012 VA) are alternative calculation bases, never corrections to the canonical 7200 VA and 1056 VA.",
    "",
    "## Concepts",
    "",
    ...REPRESENTATION_CONCEPTS.map((c) => `- \`${c}\` — ${REPRESENTATION_CONCEPT_LABELS[c]}`),
    "",
    "## Representation proposal",
    "",
    "| stable_id | concept | canonical/design | equipment/nameplate | FarmOps legacy | calculation basis | proposed representation | disposition | provenance |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...p.rows.map((r) =>
      `| ${r.stable_id} | \`${r.concept}\` | ${r.canonical_value} | ${r.nameplate_value} | ${r.farmops_legacy_value} | ${r.calculation_basis}${r.va_basis ? ` [\`${r.va_basis}\`]` : ""} | ${r.proposed_representation} | ${r.disposition} | ${r.provenance.join("; ")} |`.replace(
        /\n/g,
        " ",
      ),
    ),
    "",
    "## Reclassified numeric findings",
    "",
    "These pairs cease to be Category-B engineering disagreements once both representations exist; both source values are preserved.",
    "",
    ...p.pairs.map(
      (pair) =>
        `- ${pair.stable_id} \`${pair.farmops_entity}.${pair.farmops_field}\`: ${pair.ods_value} (canonical) vs ${pair.farmops_value} (FarmOps) → ${pair.disposition}. ${pair.explanation} Proposed: ${pair.proposed_representation}`,
    ),
    "",
    "## VA basis vocabulary",
    "",
    ...(Object.keys(VA_BASIS_LABELS) as ConnectedVaBasis[]).map(
      (b) => `- \`${b}\` — ${VA_BASIS_LABELS[b]}`,
    ),
    "",
  ];
  return out.join("\n");
}
