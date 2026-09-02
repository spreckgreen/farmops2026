// Phase 4.4b — PNL-H1 Category-D field provenance (owner-supplied label photograph).
//
// The installed-equipment manufacturer label for PNL-H1 was photographed by the
// owner. That photograph is *field/manufacturer provenance*: it establishes what
// is physically installed. It is NOT a canonical ODS statement, so it never
// authorizes an ODS edit, and it does not change either FarmOps value — the
// existing 200 A and 40 spaces are verified, not corrected.
//
// This module holds only the observed facts. The adjudication entries that
// consume them live in `electrical-convergence.ts` (one-directional import).

export const PNL_H1_LABEL_PROVENANCE_VERSION = "4.4b-pnl-h1-label-provenance-1";

export type FieldProvenanceKind =
  "OWNER_SUPPLIED_INSTALLED_EQUIPMENT_MANUFACTURER_LABEL_PHOTOGRAPH";

export interface InstalledEquipmentLabelObservation {
  stable_id: string;
  provenance_kind: FieldProvenanceKind;
  provenance_label: string;
  manufacturer: string;
  equipment: string;
  catalog_model: string;
  /** Main / bus rating printed on the label, verbatim. */
  bus_rating_amps: number;
  /** Positions/spaces, supported by the printed panel diagram. */
  spaces: number;
  /** How the space count is corroborated on the same label. */
  spaces_corroboration: string;
}

export const PNL_H1_LABEL_OBSERVATION: InstalledEquipmentLabelObservation = {
  stable_id: "PNL-H1",
  provenance_kind: "OWNER_SUPPLIED_INSTALLED_EQUIPMENT_MANUFACTURER_LABEL_PHOTOGRAPH",
  provenance_label:
    "Owner-supplied photograph of the installed PNL-H1 manufacturer label (field/manufacturer provenance, not a canonical ODS source)",
  manufacturer: "Siemens",
  equipment: "Indoor Load Center",
  catalog_model: "PN4040B1200CU",
  bus_rating_amps: 200,
  spaces: 40,
  spaces_corroboration:
    "Manufacturer's printed panel diagram on the same label is numbered through position 40",
};

/** Human-readable provenance lines, reused verbatim in adjudication records. */
export const PNL_H1_LABEL_PROVENANCE_FACTS: string[] = [
  `Provenance: ${PNL_H1_LABEL_OBSERVATION.provenance_label}`,
  `Observed manufacturer: ${PNL_H1_LABEL_OBSERVATION.manufacturer}`,
  `Observed equipment: ${PNL_H1_LABEL_OBSERVATION.equipment}`,
  `Observed catalog/model: ${PNL_H1_LABEL_OBSERVATION.catalog_model}`,
  `Observed main/bus rating: ${PNL_H1_LABEL_OBSERVATION.bus_rating_amps} A`,
  `Observed positions/spaces: ${PNL_H1_LABEL_OBSERVATION.spaces} (${PNL_H1_LABEL_OBSERVATION.spaces_corroboration})`,
  "Canonical ODS cells remain blank and unmodified — the label is field/manufacturer provenance, not a canonical source",
];

/** The two Category-D findings this photograph settles. */
export interface PnlH1VerifiedField {
  stable_id: string;
  /** FarmOps column key as reported by the numeric comparison. */
  field: string;
  label: string;
  /** Existing FarmOps value being verified — never changed. */
  farmops_value: number;
  /** What on the label establishes it. */
  established_by: string;
}

export const PNL_H1_VERIFIED_FIELDS: PnlH1VerifiedField[] = [
  {
    stable_id: "PNL-H1",
    field: "bus_rating_amps",
    label: "Bus / main rating (A)",
    farmops_value: PNL_H1_LABEL_OBSERVATION.bus_rating_amps,
    established_by: `${PNL_H1_LABEL_OBSERVATION.manufacturer} ${PNL_H1_LABEL_OBSERVATION.catalog_model} label main/bus rating: 200 A`,
  },
  {
    stable_id: "PNL-H1",
    field: "spaces",
    label: "Spaces / positions",
    farmops_value: PNL_H1_LABEL_OBSERVATION.spaces,
    established_by: `${PNL_H1_LABEL_OBSERVATION.manufacturer} ${PNL_H1_LABEL_OBSERVATION.catalog_model} label: 40 positions, ${PNL_H1_LABEL_OBSERVATION.spaces_corroboration.toLowerCase()}`,
  },
];

/** True when a finding is one of the two label-verified PNL-H1 fields. */
export function isPnlH1LabelVerifiedField(stable_id: string, field: string): boolean {
  return PNL_H1_VERIFIED_FIELDS.some((f) => f.stable_id === stable_id && f.field === field);
}

export function pnlH1VerifiedField(field: string): PnlH1VerifiedField | null {
  return PNL_H1_VERIFIED_FIELDS.find((f) => f.field === field) ?? null;
}

/** Provenance lines preserved on a specific verified field. */
export function pnlH1PreservedFacts(field: string): string[] {
  const f = pnlH1VerifiedField(field);
  return [
    "ODS observed: blank (no canonical statement)",
    ...(f ? [`FarmOps as-built (verified, unchanged): ${f.farmops_value}`, f.established_by] : []),
    ...PNL_H1_LABEL_PROVENANCE_FACTS,
  ];
}
