// Phase 4.4b — verified equipment provenance for the load semantic adjudication.
//
// READ-ONLY reference data plus the additive semantic vocabulary the adjudication
// recommends. Nothing here writes: no ODS values, no electrical_loads numeric
// columns, no breaker data, no topology, no service records, no stable IDs.
//
// Design rules encoded here:
//  * multiple evidence records may describe the same load (product page, field
//    photograph, nameplate, canonical workbook) and none overwrites another;
//  * a semantic value is only "established" when an evidence record states it;
//  * the generic scalar amps concept is never used to resolve a disagreement —
//    the ampacity concepts below stay distinct.

export type EquipmentSourceType =
  | "manufacturer_product_page"
  | "manufacturer_specification"
  | "manufacturer_screenshot"
  | "field_photograph"
  | "installed_nameplate"
  | "invoice"
  | "submittal"
  | "canonical_workbook"
  | "farmops_record";

export type EquipmentEvidenceType =
  | "published_specification"
  | "published_rating_class"
  | "field_identity_photograph"
  | "nameplate_reading"
  | "engineering_designation"
  | "stored_value";

export type VerificationStatus =
  | "verified_published"
  | "field_identified"
  | "pending_verification"
  | "conflicting_evidence";

export const VERIFICATION_STATUS_LABELS: Record<VerificationStatus, string> = {
  verified_published: "Verified — published manufacturer data",
  field_identified: "Field identified",
  pending_verification: "Pending verification",
  conflicting_evidence: "Conflicting evidence",
};

/** One traceable source statement about one load's equipment. */
export interface EquipmentEvidenceRecord {
  source_type: EquipmentSourceType;
  manufacturer: string | null;
  model: string | null;
  source_reference: string;
  evidence_type: EquipmentEvidenceType;
  observed_or_published_value: string;
  verified_at: string | null;
  verification_status: VerificationStatus;
}

/** The additive ampacity vocabulary. Documentation only — nothing is migrated. */
export const AMPACITY_SEMANTIC_FIELDS = [
  {
    field: "equipment_fla",
    label: "Equipment full-load amps",
    why: "Manufacturer-stated running current of the equipment itself.",
  },
  {
    field: "minimum_circuit_ampacity",
    label: "Minimum circuit ampacity (MCA)",
    why: "Conductor sizing minimum from the manufacturer's electrical table.",
  },
  {
    field: "maximum_overcurrent_protection",
    label: "Maximum overcurrent protection (MOCP)",
    why: "Largest permitted protective device for the equipment.",
  },
  {
    field: "installed_ocp_rating",
    label: "Installed OCP rating",
    why: "The breaker actually installed, observed in the field.",
  },
  {
    field: "design_circuit_ampacity",
    label: "Design circuit ampacity",
    why: "The engineering design current for the branch circuit.",
  },
] as const;

/** Voltage / provenance vocabulary proposed alongside the ampacity concepts. */
export const PROPOSED_SEMANTIC_FIELDS = [
  {
    field: "nominal_supply_voltage",
    label: "Nominal supply voltage",
    why: "Canonical engineering / site circuit designation (e.g. 240 V).",
  },
  {
    field: "rated_nameplate_voltage",
    label: "Rated nameplate voltage",
    why: "Equipment / manufacturer designation (e.g. 220 V, 115 V).",
  },
  {
    field: "rated_equipment_voltage_class",
    label: "Rated equipment voltage class",
    why: "Published rating class kept verbatim (e.g. 208/230 V) — never reduced to a scalar.",
  },
  {
    field: "phase",
    label: "Phase",
    why: "Single- or three-phase supply designation.",
  },
  ...AMPACITY_SEMANTIC_FIELDS,
  {
    field: "equipment_evidence[]",
    label: "Equipment evidence records",
    why: "source_type, manufacturer, model, source_reference, evidence_type, observed_or_published_value, verified_at, verification_status — many per load.",
  },
] as const;

export interface EquipmentDiscrepancy {
  code: string;
  detail: string;
  status: VerificationStatus;
  resolves_with: string[];
}

export interface EquipmentSemantics {
  nominal_supply_voltage: number | null;
  rated_nameplate_voltage: number | null;
  /** Published class string, kept verbatim (e.g. "208/230"). Never a scalar. */
  rated_equipment_voltage_class: string | null;
  phase: string | null;
  frequency_hz: number | null;
  equipment_fla: number | null;
  minimum_circuit_ampacity: number | null;
  maximum_overcurrent_protection: number | null;
  installed_ocp_rating: number | null;
  design_circuit_ampacity: number | null;
  extras: { label: string; value: string }[];
}

export interface EquipmentProvenance {
  stable_id: string;
  manufacturer: string;
  model: string;
  equipment_class: string;
  semantics: EquipmentSemantics;
  records: EquipmentEvidenceRecord[];
  /**
   * A VA calculation basis current that is established *independently* of any
   * inferred value (e.g. stated identically by the canonical workbook and
   * FarmOps, or published by the manufacturer). Null means the basis is not
   * established and no calculation-basis reclassification is permitted.
   */
  va_basis_amps: number | null;
  va_basis_source: string | null;
  /** True while the manufacturer's model-specific MCA/MOCP table is unproven. */
  ampacity_verification_pending: boolean;
  /** What is already known about the amperage semantics, in plain terms. */
  ampacity_known: string[];
  /** Exactly what must be established before amperage may be adjudicated. */
  ampacity_required: string[];
  discrepancies: EquipmentDiscrepancy[];
  /** Same-equipment comparison group, when the load shares a configuration. */
  group_id?: string;
}

const semantics = (s: Partial<EquipmentSemantics>): EquipmentSemantics => ({
  nominal_supply_voltage: null,
  rated_nameplate_voltage: null,
  rated_equipment_voltage_class: null,
  phase: null,
  frequency_hz: null,
  equipment_fla: null,
  minimum_circuit_ampacity: null,
  maximum_overcurrent_protection: null,
  installed_ocp_rating: null,
  design_circuit_ampacity: null,
  extras: [],
  ...s,
});

const BRYANT_RECORDS = (indoorNote: string): EquipmentEvidenceRecord[] => [
  {
    source_type: "manufacturer_product_page",
    manufacturer: "Bryant",
    model: "37MARAQ24AA3",
    source_reference: "Bryant product page — 37MARAQ ductless outdoor heat pump, 24,000 BTUh",
    evidence_type: "published_rating_class",
    observed_or_published_value:
      "Rated electrical supply 208/230 V AC, 1Ø, 60 Hz; 24,000 BTUh / 2 ton, R-454B",
    verified_at: "2026-09-01",
    verification_status: "verified_published",
  },
  {
    source_type: "manufacturer_screenshot",
    manufacturer: "Bryant",
    model: "D5MAHAQ24XA3",
    source_reference: `Supplied product screenshot — indoor high-wall unit (${indoorNote})`,
    evidence_type: "published_specification",
    observed_or_published_value: "D5MAHAQ24XA3 indoor high-wall unit, 24,000 BTUh single zone",
    verified_at: "2026-09-01",
    verification_status: "conflicting_evidence",
  },
  {
    source_type: "farmops_record",
    manufacturer: "Bryant",
    model: "D5MAHAQ24XA4",
    source_reference: "Earlier Phase 4.4b evidence — indoor model recorded as XA4",
    evidence_type: "published_specification",
    observed_or_published_value: "D5MAHAQ24XA4 indoor high-wall unit",
    verified_at: null,
    verification_status: "conflicting_evidence",
  },
  {
    source_type: "canonical_workbook",
    manufacturer: null,
    model: null,
    source_reference: "PremoFarmElectrical.ods — Loads worksheet (unchanged)",
    evidence_type: "engineering_designation",
    observed_or_published_value: "Site nominal supply 240 V",
    verified_at: null,
    verification_status: "verified_published",
  },
];

const BRYANT_DISCREPANCY: EquipmentDiscrepancy = {
  code: "INDOOR_MODEL_SUFFIX_VERIFICATION_REQUIRED",
  detail:
    "Earlier evidence identifies the indoor unit as D5MAHAQ24XA4 while the supplied product screenshot explicitly identifies D5MAHAQ24XA3. Both are retained; neither is silently selected. This does not affect the established 2-ton Bryant system identity or the 208/230 V, 1Ø outdoor supply class.",
  status: "conflicting_evidence",
  resolves_with: [
    "Installed-unit nameplate photograph of the indoor high-wall unit.",
    "Purchase invoice or submittal listing the indoor model suffix.",
  ],
};

const BRYANT_AMPACITY_KNOWN = [
  "Equipment identity established: Bryant 37MARAQ24AA3 outdoor heat pump with Bryant D5MAHAQ24XA* indoor high-wall unit, 24,000 BTUh / 2 ton single-zone ductless.",
  "Outdoor rated electrical supply established as 208/230 V AC, 1Ø, 60 Hz (R-454B).",
  "Voltage, phase and frequency are established by model decoding and product listings; those do not establish MCA, MOCP, installed breaker rating or operating current, and none of those may be inferred from the voltage code, capacity or sibling models in the series.",
  "Supplied material mentions approximately 19 A MCA and 25 A MOCP, but not from the model-specific manufacturer table or nameplate.",
];

const BRYANT_AMPACITY_REQUIRED = [
  "Model-specific manufacturer electrical table or installed nameplate stating MCA and MOCP.",
  "Field observation of the installed OCP rating (breaker) serving this unit.",
  "Distinction of each stored current as equipment_operating_current, equipment_fla, minimum_circuit_ampacity, maximum_overcurrent_protection, installed_ocp_rating or design_circuit_ampacity before any migration.",
];

const bryant = (stable_id: string, indoorNote: string): EquipmentProvenance => ({
  stable_id,
  manufacturer: "Bryant",
  model: "37MARAQ24AA3 + D5MAHAQ24XA* (suffix unverified)",
  equipment_class: "24,000 BTUh / 2 ton single-zone ductless heat pump",
  semantics: semantics({
    nominal_supply_voltage: 240,
    rated_equipment_voltage_class: "208/230",
    phase: "1",
    frequency_hz: 60,
    extras: [
      { label: "Capacity", value: "24,000 BTUh / 2 ton" },
      { label: "Refrigerant", value: "R-454B" },
      { label: "System type", value: "Single-zone ductless heat pump" },
    ],
  }),
  records: BRYANT_RECORDS(indoorNote),
  va_basis_amps: null,
  va_basis_source: null,
  ampacity_verification_pending: true,
  ampacity_known: BRYANT_AMPACITY_KNOWN,
  ampacity_required: BRYANT_AMPACITY_REQUIRED,
  discrepancies: [BRYANT_DISCREPANCY],
  group_id: "bryant-24k-ductless",
});

export interface EquipmentGroup {
  id: string;
  label: string;
  description: string;
  members: string[];
}

export const EQUIPMENT_GROUPS: EquipmentGroup[] = [
  {
    id: "bryant-24k-ductless",
    label: "Bryant 24,000 BTUh ductless heat pump (three installations)",
    description:
      "FS-082, FS-083 and FS-084 are three installations of one equipment configuration — Bryant 37MARAQ24AA3 outdoor unit with a Bryant D5MAHAQ24XA* indoor high-wall unit — not three different equipment specifications. Differences between them are installation/record differences, not specification differences.",
    members: ["FS-082", "FS-083", "FS-084"],
  },
];

/**
 * Verified equipment provenance per adjudicated load. Absent entries mean no
 * equipment identity is established and the generic evidence gate still applies.
 */
export const EQUIPMENT_PROVENANCE: Record<string, EquipmentProvenance> = {
  "FS-034": {
    stable_id: "FS-034",
    manufacturer: "Halo Lifts",
    model: "HL2C-10K",
    equipment_class: "10,000 lb two-post automotive lift",
    semantics: semantics({
      nominal_supply_voltage: 240,
      rated_nameplate_voltage: 220,
      phase: "1",
      extras: [{ label: "Capacity", value: "10,000 lb" }],
    }),
    records: [
      {
        source_type: "manufacturer_product_page",
        manufacturer: "Halo Lifts",
        model: "HL2C-10K",
        source_reference: "Supplied Halo Lifts product page for the HL2C-10K",
        evidence_type: "published_specification",
        observed_or_published_value:
          "HL2C-10K two-post lift, 10,000 lb, rated voltage 220 V, single phase",
        verified_at: "2026-09-01",
        verification_status: "verified_published",
      },
      {
        source_type: "field_photograph",
        manufacturer: "Halo Lifts",
        model: "HL2C-10K",
        source_reference: "Field equipment photograph (shop lift)",
        evidence_type: "field_identity_photograph",
        observed_or_published_value:
          "Installed lift identified as Halo Lifts HL2C-10K — identity evidence only; no electrical values read from the photograph",
        verified_at: "2026-09-01",
        verification_status: "field_identified",
      },
      {
        source_type: "canonical_workbook",
        manufacturer: null,
        model: null,
        source_reference: "PremoFarmElectrical.ods — Loads worksheet row 34 (unchanged)",
        evidence_type: "engineering_designation",
        observed_or_published_value: "Nominal supply 240 V, 30 A, 7200 VA",
        verified_at: null,
        verification_status: "verified_published",
      },
      {
        source_type: "farmops_record",
        manufacturer: null,
        model: null,
        source_reference: "electrical_loads (load_id FS-034)",
        evidence_type: "stored_value",
        observed_or_published_value: "220 V, 30 A, 6600 VA",
        verified_at: null,
        verification_status: "verified_published",
      },
    ],
    va_basis_amps: 30,
    va_basis_source:
      "30 A is stated independently by the canonical workbook (row 34) and by the FarmOps record; it is not read from the equipment photograph.",
    ampacity_verification_pending: false,
    ampacity_known: [
      "Nominal supply voltage 240 V (canonical engineering designation) and rated nameplate voltage 220 V (manufacturer designation) are both established.",
      "Both records state the same 30 A basis current independently of the equipment photograph.",
    ],
    ampacity_required: [],
    discrepancies: [],
  },
  "FS-092": {
    stable_id: "FS-092",
    manufacturer: "Greenheck",
    model: "AER-24-03-0315-VG",
    equipment_class: "Axial emergency purge fan with louvers",
    semantics: semantics({
      nominal_supply_voltage: 120,
      rated_nameplate_voltage: 115,
      phase: "1",
      frequency_hz: 60,
      equipment_fla: 8.8,
      extras: [
        { label: "Motor", value: "3/4 hp" },
        { label: "RPM", value: "1725" },
        { label: "Enclosure", value: "ODP" },
      ],
    }),
    records: [
      {
        source_type: "manufacturer_specification",
        manufacturer: "Greenheck",
        model: "AER-24-03-0315-VG",
        source_reference: "Greenheck published motor / fan data for AER-24-03-0315-VG",
        evidence_type: "published_specification",
        observed_or_published_value:
          "3/4 hp, rated voltage 115 V, 60 Hz, 1 phase, FLA 8.8 A, 1725 RPM, ODP enclosure",
        verified_at: "2026-09-01",
        verification_status: "verified_published",
      },
      {
        source_type: "canonical_workbook",
        manufacturer: null,
        model: null,
        source_reference: "PremoFarmElectrical.ods — Loads worksheet row 92 (unchanged)",
        evidence_type: "engineering_designation",
        observed_or_published_value: "Nominal supply 120 V, 8.8 A, 1056 VA",
        verified_at: null,
        verification_status: "verified_published",
      },
      {
        source_type: "farmops_record",
        manufacturer: null,
        model: null,
        source_reference: "electrical_loads (load_id FS-092)",
        evidence_type: "stored_value",
        observed_or_published_value: "115 V, 8.8 A, 1012 VA",
        verified_at: null,
        verification_status: "verified_published",
      },
    ],
    va_basis_amps: 8.8,
    va_basis_source:
      "8.8 A is the published Greenheck FLA and is stated identically by the canonical workbook and the FarmOps record.",
    ampacity_verification_pending: false,
    ampacity_known: [
      "Published FLA 8.8 A at 115 V rated / 60 Hz / 1Ø.",
      "120 × 8.8 = 1056 VA is the nominal-supply calculation basis; 115 × 8.8 = 1012 VA is the equipment-rated calculation basis.",
    ],
    ampacity_required: [],
    discrepancies: [],
  },
  "FS-082": bryant("FS-082", "screenshot states XA3"),
  "FS-083": bryant("FS-083", "screenshot states XA3"),
  "FS-084": bryant("FS-084", "screenshot states XA3"),
};

export function equipmentFor(stableId: string): EquipmentProvenance | undefined {
  return EQUIPMENT_PROVENANCE[stableId];
}

/** Human-readable evidence lines for a load, one per source record. */
export function equipmentEvidenceLines(eq: EquipmentProvenance | undefined): string[] {
  if (!eq) return [];
  return eq.records.map(
    (r) =>
      `${r.source_type}${r.model ? ` (${r.manufacturer ?? ""} ${r.model})`.replace("  ", " ") : ""}: ${r.observed_or_published_value} — ${r.source_reference} [${r.verification_status}${r.verified_at ? `, ${r.verified_at}` : ""}]`,
  );
}
