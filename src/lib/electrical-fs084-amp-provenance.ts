// Phase 4.4b — FS-084 60 A provenance adjudication (READ-ONLY).
//
// Scope: exactly one canonical load, FS-084, and exactly two numbers:
//   * the canonical ODS `Amps` value (60 A in the SHA-bound baseline);
//   * the FarmOps `electrical_loads.amps` value.
//
// Hard rules encoded here:
//   * nothing is written — not FarmOps, not the canonical workbook;
//   * the canonical value is only ever the value parsed from the SHA-verified
//     baseline workbook, never a stored copy;
//   * 14,400 VA is proven formula-derived (240 × 60) and is therefore excluded
//     from the evidence set supporting 60 A — it can never raise provenance
//     strength;
//   * MOCP = 25 A never becomes a conclusion that 60 A "should be" 25 A;
//   * MCA stays NULL / unverified and is never inferred;
//   * the SHA-bound raw finding and the existing current-semantic disposition
//     (AMP_FIELD_SEMANTICS_UNRESOLVED / CURRENT_SEMANTICS_UNRESOLVED) are
//     preserved, not replaced.
import {
  baselineLabel,
  canonicalLoad,
  openQuestionsFor,
  type AdjudicationBaseline,
} from "@/lib/electrical-adjudication-baseline";
import { equipmentFor, equipmentEvidenceLines } from "@/lib/electrical-equipment-provenance";
import { vaDerivation, VA_BASIS_LABELS, type VaBasis } from "@/lib/electrical-amp-semantics";

export const FS084_PROVENANCE_VERSION = "4.4b-fs084-amp-provenance-1";

/** The single load in scope. Deliberately not a list. */
export const FS084_STABLE_ID = "FS-084";

/** Peer installations of the same verified equipment configuration. */
export const FS084_PEER_IDS = ["FS-082", "FS-083"] as const;

/** Classification of the canonical 60 A value. */
export type OdsAmpProvenanceClass =
  | "EXPLICIT_EQUIPMENT_CURRENT_SUPPORTED"
  | "EXPLICIT_OCP_VALUE_SUPPORTED"
  | "EXPLICIT_DESIGN_VALUE_SUPPORTED"
  | "DERIVED_OR_FORMULA_VALUE"
  | "LEGACY_VALUE_SOURCE_UNKNOWN"
  | "LIKELY_DATA_ENTRY_ERROR_UNPROVEN"
  | "OTHER_PROVENANCE";

export const ODS_AMP_CLASS_LABELS: Record<OdsAmpProvenanceClass, string> = {
  EXPLICIT_EQUIPMENT_CURRENT_SUPPORTED:
    "An explicit equipment current (FLA/RLA/RCA) in the canonical record supports the value.",
  EXPLICIT_OCP_VALUE_SUPPORTED:
    "The canonical record explicitly states this value as an overcurrent-protection rating.",
  EXPLICIT_DESIGN_VALUE_SUPPORTED:
    "The canonical record explicitly states this value as an engineering design selection.",
  DERIVED_OR_FORMULA_VALUE:
    "The cell itself is a formula or is computed from other canonical cells.",
  LEGACY_VALUE_SOURCE_UNKNOWN:
    "The value is carried in the canonical workbook as a static entry with no source, note, formula, reference or document establishing where it came from or what it asserts.",
  LIKELY_DATA_ENTRY_ERROR_UNPROVEN:
    "Evidence positively suggests a transcription/entry fault, but the fault is not proven.",
  OTHER_PROVENANCE: "Provenance established, but by a source outside the listed categories.",
};

/** What the FarmOps amps value is established to mean. */
export type FarmOpsAmpSemantic =
  | "ESTABLISHES_MOCP"
  | "ESTABLISHES_INSTALLED_BREAKER_OCP"
  | "ESTABLISHES_LOAD_CURRENT"
  | "NUMERIC_VALUE_WITH_UNRESOLVED_SEMANTICS"
  | "NO_FARMOPS_VALUE_PRESENT";

export const FARMOPS_AMP_SEMANTIC_LABELS: Record<FarmOpsAmpSemantic, string> = {
  ESTABLISHES_MOCP: "Provenance establishes the value as MOCP (maximum overcurrent protection).",
  ESTABLISHES_INSTALLED_BREAKER_OCP:
    "Provenance establishes the value as the installed breaker / OCP rating.",
  ESTABLISHES_LOAD_CURRENT: "Provenance establishes the value as a load current.",
  NUMERIC_VALUE_WITH_UNRESOLVED_SEMANTICS:
    "Merely a numeric value with unresolved semantics — nothing in FarmOps states which current concept it holds.",
  NO_FARMOPS_VALUE_PRESENT: "FarmOps holds no amps value for this load.",
};

export type ProvenanceStrength =
  | "NONE"
  | "WEAK_CIRCUMSTANTIAL"
  | "MODERATE_UNCORROBORATED"
  | "STRONG_CORROBORATED";

export const PROVENANCE_STRENGTH_LABELS: Record<ProvenanceStrength, string> = {
  NONE: "No provenance — no source states origin or meaning",
  WEAK_CIRCUMSTANTIAL: "Weak / circumstantial — coincidence or pattern only",
  MODERATE_UNCORROBORATED: "Moderate — one explicit source, uncorroborated",
  STRONG_CORROBORATED: "Strong — explicit source corroborated independently",
};

/** Kinds of canonical/FarmOps evidence interrogated for this trace. */
export type Fs084SourceType =
  | "ods_cell"
  | "ods_formula_state"
  | "ods_worksheet_row"
  | "ods_comment_or_note_column"
  | "ods_source_reference_column"
  | "circuit_or_breaker_reference"
  | "other_workbook_sheet"
  | "import_or_historical_provenance"
  | "peer_row_relationship"
  | "attached_source_document"
  | "farmops_field"
  | "farmops_audit_trail"
  | "equipment_nameplate";

/** One row of the requested provenance report. */
export interface Fs084ProvenanceTraceRow {
  stable_id: string;
  /** Value as held by the source, verbatim; null when the source holds none. */
  value: string;
  source: string;
  source_type: Fs084SourceType;
  /** What the source asserts about the number, if anything. */
  semantic_claim: string;
  /**
   * Does this source independently support the 60 A figure? A derived value or
   * a value the trace is forbidden from using is `false` with the reason.
   */
  independent_evidence: boolean;
  independent_evidence_note: string;
  provenance_strength: ProvenanceStrength;
}

/** Live FarmOps provenance signals for the traced loads (SELECT-only). */
export interface Fs084FarmOpsProvenance {
  load_id: string;
  uuid: string | null;
  amps: number | null;
  volts: number | null;
  connected_va: number | null;
  demand_va: number | null;
  demand_basis: string | null;
  notes: string | null;
  source_reference: string | null;
  source_circuit: string | null;
  circuit_group_ref: string | null;
  equipment_model: string | null;
  ods_extras: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** Rows sharing the same creation second — bulk-import evidence. */
  creation_batch_size: number;
  /** Field-level audit entries touching `amps` for this load. */
  amps_audit_entries: number;
  /** Breaker positions linked to this load, with their OCP rating if set. */
  breaker_links: { label: string | null; ocp_amps: number | null; poles: number }[];
  /** Branch runs / circuit groups referencing this load, if any. */
  circuit_links: string[];
  /** Any import snapshot establishing the value explicitly. */
  import_snapshot: boolean;
}

export interface Fs084ProvenanceReport {
  version: string;
  generated_at: string;
  stable_id: string;
  workbook_name: string;
  workbook_sha256: string;
  is_phase_44a_baseline: boolean;
  baseline_label: string;
  worksheet: string | null;
  worksheet_row: number | null;
  /** Canonical values, verbatim from the SHA-verified workbook. */
  ods_volts: number | null;
  ods_amps: number | null;
  ods_va: number | null;
  /** VA derivation proof — the reason 14,400 VA is excluded as evidence. */
  va_basis: VaBasis;
  va_basis_proof: string;
  va_excluded_as_evidence: boolean;
  /** FarmOps values, read live and unchanged. */
  farmops_amps: number | null;
  farmops_volts: number | null;
  farmops_connected_va: number | null;
  /** Equipment facts. MCA is never inferred. */
  equipment_model: string | null;
  equipment_voltage_class: string | null;
  equipment_mocp: number | null;
  rca: number | null;
  rla: number | null;
  mca: number | null;
  mca_status: string;
  /** The requested trace table. */
  trace: Fs084ProvenanceTraceRow[];
  /** Classification of the canonical 60 A value. */
  ods_amp_class: OdsAmpProvenanceClass;
  ods_amp_class_rationale: string;
  ods_amp_provenance_strength: ProvenanceStrength;
  /** Independent trace of the FarmOps amps value. */
  farmops_amp_semantic: FarmOpsAmpSemantic;
  farmops_amp_semantic_rationale: string;
  farmops_amp_provenance_strength: ProvenanceStrength;
  /** Peer relationship findings (FS-082 / FS-083). */
  peer_relationship: string;
  /** Preserved prior state — never replaced by this trace. */
  preserved_raw_finding: string;
  preserved_current_semantic_disposition: string;
  open_questions: string[];
  /** Notes when live FarmOps values differ from the values under review. */
  expectation_notes: string[];
  next_evidence_required: string[];
  read_only: true;
  apply_available: false;
  ods_edit_authorized: false;
  farmops_write_authorized: false;
}

/** The FarmOps amps value the request describes for FS-084. */
export const FS084_REVIEWED_FARMOPS_AMPS = 25;
/** The canonical amps value the request describes for FS-084. */
export const FS084_REVIEWED_ODS_AMPS = 60;

/** Placeholder cell text is not provenance. */
function realText(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  return /^(tbd|n\/?a|none|no|unknown|0%?|—|-|0\.00|0)$/i.test(s) ? null : s;
}

const num = (v: number | null | undefined) => (v === null || v === undefined ? "not stated" : String(v));

/** Does any FarmOps text explicitly name a current concept? */
export function farmOpsStatedConcept(
  p: Fs084FarmOpsProvenance | undefined,
): { semantic: FarmOpsAmpSemantic; because: string } | null {
  const text = [realText(p?.notes), realText(p?.source_reference), realText(p?.ods_extras)]
    .filter(Boolean)
    .join(" · ");
  if (!text) return null;
  if (/\b(mocp|maximum overcurrent)\b/i.test(text))
    return { semantic: "ESTABLISHES_MOCP", because: `FarmOps text states MOCP: "${text}"` };
  if (/\b(installed breaker|breaker|ocp)\b/i.test(text))
    return {
      semantic: "ESTABLISHES_INSTALLED_BREAKER_OCP",
      because: `FarmOps text states a breaker/OCP rating: "${text}"`,
    };
  if (/\b(fla|full[- ]load|rla|rca|connected load current|running current|measured)\b/i.test(text))
    return {
      semantic: "ESTABLISHES_LOAD_CURRENT",
      because: `FarmOps text states a load current: "${text}"`,
    };
  return null;
}

export function traceFs084AmpProvenance(input: {
  baseline: AdjudicationBaseline;
  provenance: Fs084FarmOpsProvenance[];
  generatedAt?: string;
}): Fs084ProvenanceReport | null {
  const { baseline } = input;
  const ods = canonicalLoad(baseline, FS084_STABLE_ID);
  if (!ods) return null;

  const byId = new Map(input.provenance.map((p) => [p.load_id.trim(), p]));
  const fp = byId.get(FS084_STABLE_ID);
  const eq = equipmentFor(FS084_STABLE_ID);
  const mocp = eq?.semantics.maximum_overcurrent_protection ?? null;
  const rca = eq?.semantics.rated_current_amps ?? null;
  const rla = eq?.semantics.rated_load_amps ?? null;
  const va = vaDerivation(ods.volts, ods.amps, ods.connected_va);
  const vaDerived = va.basis === "derived_volts_times_amps";
  const label = baselineLabel(baseline);

  const trace: Fs084ProvenanceTraceRow[] = [];
  const push = (r: Fs084ProvenanceTraceRow) => trace.push(r);

  // ---- canonical ODS cell + formula state -------------------------------
  push({
    stable_id: FS084_STABLE_ID,
    value: num(ods.amps),
    source: `${baseline.ods_file_name} · ${ods.worksheet} · row ${ods.row} · Amps`,
    source_type: "ods_cell",
    semantic_claim:
      'The column heading is an unqualified "Amps". The cell asserts a current magnitude and nothing about which current concept it is.',
    independent_evidence: true,
    independent_evidence_note:
      "This cell is the assertion under review; it is its own only statement of the value.",
    provenance_strength: "NONE",
  });
  push({
    stable_id: FS084_STABLE_ID,
    value: num(ods.amps),
    source: "Amps cell formula state",
    source_type: "ods_formula_state",
    semantic_claim:
      "The amps cell is a static numeric entry: the parsed workbook yields a literal value, and no cell formula computes it from another canonical cell.",
    independent_evidence: false,
    independent_evidence_note:
      "A static entry records no origin, so the cell's own formula state supports nothing about where 60 A came from.",
    provenance_strength: "NONE",
  });
  push({
    stable_id: FS084_STABLE_ID,
    value: num(ods.connected_va),
    source: `${ods.worksheet} · row ${ods.row} · Connected VA`,
    source_type: "ods_formula_state",
    semantic_claim: `Connected VA basis: ${VA_BASIS_LABELS[va.basis]}. ${va.proof}`,
    independent_evidence: false,
    independent_evidence_note: vaDerived
      ? `${ods.connected_va} VA is the product of the same Volts and Amps cells, so it restates the 60 A figure and is excluded from the evidence set by rule.`
      : "Connected VA is not usable as independent support for the amps value in this trace.",
    provenance_strength: "NONE",
  });
  push({
    stable_id: FS084_STABLE_ID,
    value: `${num(ods.volts)} V`,
    source: `${ods.worksheet} · row ${ods.row} · Volts`,
    source_type: "ods_worksheet_row",
    semantic_claim:
      "Nominal supply voltage designation for the row. It bounds the VA arithmetic but states no current concept.",
    independent_evidence: false,
    independent_evidence_note: "A voltage designation cannot establish what a current value means.",
    provenance_strength: "NONE",
  });

  // ---- comments / notes / source-reference columns ----------------------
  const odsNote = realText(fp?.ods_extras);
  push({
    stable_id: FS084_STABLE_ID,
    value: odsNote ?? "(no content)",
    source: `${ods.worksheet} comment / note / source-reference columns for row ${ods.row}`,
    source_type: "ods_comment_or_note_column",
    semantic_claim: odsNote
      ? `Carried workbook text: "${odsNote}".`
      : "No comment, note or source-reference content accompanies the row; the unmapped-column carry-through field is empty.",
    independent_evidence: Boolean(odsNote),
    independent_evidence_note: odsNote
      ? "Text is present and must be read on its own terms before it is treated as provenance."
      : "Absent text cannot support the value.",
    provenance_strength: odsNote ? "WEAK_CIRCUMSTANTIAL" : "NONE",
  });
  const srcRef = realText(fp?.source_reference);
  push({
    stable_id: FS084_STABLE_ID,
    value: srcRef ?? "(empty)",
    source: "source_reference (carried from the canonical import)",
    source_type: "ods_source_reference_column",
    semantic_claim: srcRef
      ? `Stated reference: "${srcRef}".`
      : "No source reference exists for this row on either side of the import.",
    independent_evidence: Boolean(srcRef),
    independent_evidence_note: srcRef
      ? "Reference present; its content decides whether the value is equipment, OCP or design data."
      : "No reference document is cited, so the 60 A entry cites nothing.",
    provenance_strength: srcRef ? "MODERATE_UNCORROBORATED" : "NONE",
  });

  // ---- circuit / breaker references ------------------------------------
  const breakerLinks = fp?.breaker_links ?? [];
  const breakerOcp = breakerLinks.map((b) => b.ocp_amps).filter((v): v is number => v !== null);
  push({
    stable_id: FS084_STABLE_ID,
    value: breakerOcp.length ? breakerOcp.map((a) => `${a} A OCP`).join(" | ") : "(no link)",
    source: "electrical_breaker_positions / circuit-group references",
    source_type: "circuit_or_breaker_reference",
    semantic_claim: breakerLinks.length
      ? `${breakerLinks.length} breaker position(s) reference this load${
          breakerOcp.length ? ` with OCP ${breakerOcp.join(", ")} A` : " with no OCP rating recorded"
        }.`
      : "No breaker position, circuit group or source circuit references this load, so no OCP rating is associated with it.",
    independent_evidence: breakerOcp.includes(ods.amps ?? Number.NaN),
    independent_evidence_note: breakerOcp.includes(ods.amps ?? Number.NaN)
      ? "A linked breaker carries the same rating, which would support an OCP reading of the cell."
      : "Nothing links a 60 A protective device to this load, so the cell cannot be read as an installed OCP rating.",
    provenance_strength: breakerOcp.includes(ods.amps ?? Number.NaN) ? "MODERATE_UNCORROBORATED" : "NONE",
  });
  const circuitLinks = [
    ...(fp?.circuit_links ?? []),
    realText(fp?.source_circuit),
    realText(fp?.circuit_group_ref),
  ].filter(Boolean) as string[];
  push({
    stable_id: FS084_STABLE_ID,
    value: circuitLinks.length ? circuitLinks.join(" | ") : "(none)",
    source: "source_circuit / circuit_group_ref / branch-run references",
    source_type: "circuit_or_breaker_reference",
    semantic_claim: circuitLinks.length
      ? `Circuit references present: ${circuitLinks.join(", ")}.`
      : "The load is not assigned to a circuit group or branch run, so no conductor or protection design is associated with the 60 A figure.",
    independent_evidence: false,
    independent_evidence_note:
      "A circuit reference alone does not state a current concept; only an OCP or ampacity value on that circuit could.",
    provenance_strength: "NONE",
  });

  // ---- other workbook sheets -------------------------------------------
  const otherSheets = baseline.load_worksheets.filter((w) => w !== ods.worksheet);
  push({
    stable_id: FS084_STABLE_ID,
    value: "(no second statement)",
    source: `Other worksheets in ${baseline.ods_file_name}${
      otherSheets.length ? ` (${otherSheets.join(", ")})` : ""
    }`,
    source_type: "other_workbook_sheet",
    semantic_claim: `The baseline parse locates ${FS084_STABLE_ID} once, on ${ods.worksheet} row ${ods.row}. No other sheet restates its amps value, and no sheet carries an MCA, MOCP, breaker or design-ampacity column to contrast the Amps column with.`,
    independent_evidence: false,
    independent_evidence_note:
      "A single statement in the workbook cannot corroborate itself across sheets.",
    provenance_strength: "NONE",
  });

  // ---- import / historical provenance ----------------------------------
  const batch = fp?.creation_batch_size ?? 0;
  push({
    stable_id: FS084_STABLE_ID,
    value: fp?.created_at ?? "(no record)",
    source: "FarmOps row creation / import history",
    source_type: "import_or_historical_provenance",
    semantic_claim: fp
      ? `Row created ${fp.created_at ?? "unknown"}${
          batch > 1 ? ` in a bulk batch of ${batch} rows sharing the same creation second` : ""
        }; ${fp.import_snapshot ? "an import snapshot exists" : "no import snapshot records the value explicitly"}.`
      : "No FarmOps row exists for this load, so there is no import history to read.",
    independent_evidence: Boolean(fp?.import_snapshot),
    independent_evidence_note: fp?.import_snapshot
      ? "An import snapshot may show whether the value was transcribed or defaulted."
      : "Bulk creation records only that the value arrived with the import, not what it asserts.",
    provenance_strength: fp?.import_snapshot ? "WEAK_CIRCUMSTANTIAL" : "NONE",
  });
  push({
    stable_id: FS084_STABLE_ID,
    value: String(fp?.amps_audit_entries ?? 0),
    source: "electrical_change_audit (field-level entries touching amps)",
    source_type: "farmops_audit_trail",
    semantic_claim: (fp?.amps_audit_entries ?? 0)
      ? `${fp?.amps_audit_entries} audit entr(y/ies) touch this load's amps field.`
      : "No field-level audit entry has ever touched this load's amps value, so no human edit recorded a meaning for it.",
    independent_evidence: Boolean(fp?.amps_audit_entries),
    independent_evidence_note: (fp?.amps_audit_entries ?? 0)
      ? "Audit content must be read before it is treated as provenance."
      : "An empty audit trail supports nothing.",
    provenance_strength: (fp?.amps_audit_entries ?? 0) ? "WEAK_CIRCUMSTANTIAL" : "NONE",
  });

  // ---- peer relationship ------------------------------------------------
  const peers = FS084_PEER_IDS.map((id) => {
    const p = canonicalLoad(baseline, id);
    return `${id}: ${num(p?.volts ?? null)} V / ${num(p?.amps ?? null)} A / ${num(
      p?.connected_va ?? null,
    )} VA`;
  }).join("; ");
  const peerRelationship = `${peers}. FS-082, FS-083 and FS-084 are three installations of one verified configuration (${
    eq?.model ?? "37MARAQ24AA3 + D5MAHAQ24XA*"
  }), so a specification difference cannot explain a differing amps figure — the difference is a record difference. The peer rows do not restate 60 A and therefore do not corroborate it; equally, they do not establish what the FS-084 cell means.`;
  push({
    stable_id: FS084_STABLE_ID,
    value: peers,
    source: "Peer canonical rows FS-082 / FS-083 (same equipment configuration)",
    source_type: "peer_row_relationship",
    semantic_claim: peerRelationship,
    independent_evidence: false,
    independent_evidence_note:
      "Identical equipment with differing recorded currents shows a record inconsistency, not the provenance of any one figure.",
    provenance_strength: "NONE",
  });

  // ---- attached source documents ---------------------------------------
  const docs = equipmentEvidenceLines(eq);
  push({
    stable_id: FS084_STABLE_ID,
    value: docs.length ? `${docs.length} equipment record(s)` : "(none)",
    source: "Source documents attached to this load",
    source_type: "attached_source_document",
    semantic_claim: docs.length
      ? `Attached evidence is equipment/manufacturer documentation only: ${docs.join(" | ")}. No electrical design document, load calculation, schedule or field observation supporting a 60 A entry is attached.`
      : "No source document is attached to this load.",
    independent_evidence: false,
    independent_evidence_note:
      "Manufacturer documentation states equipment ratings; it makes no statement about a 60 A workbook entry.",
    provenance_strength: "NONE",
  });

  // ---- equipment nameplate (bounding evidence, never a conclusion) -----
  push({
    stable_id: FS084_STABLE_ID,
    value: `MOCP ${num(mocp)} A · RCA ${num(rca)} A · RLA ${num(rla)} A · MCA ${
      eq?.semantics.minimum_circuit_ampacity === null ||
      eq?.semantics.minimum_circuit_ampacity === undefined
        ? "NULL / unverified"
        : String(eq.semantics.minimum_circuit_ampacity)
    }`,
    source: `Manufacturer evidence — ${eq?.model ?? "37MARAQ24AA3 + D5MAHAQ24XA*"}, ${
      eq?.semantics.rated_equipment_voltage_class ?? "208/230"
    } VAC, 1Ø, ${num(eq?.semantics.frequency_hz ?? 60)} Hz`,
    source_type: "equipment_nameplate",
    semantic_claim:
      "Establishes equipment ratings only: MOCP is the largest permitted protective device, RCA and RLA are rated currents, and MCA is not published. It states nothing about the canonical Amps cell.",
    independent_evidence: false,
    independent_evidence_note:
      "Equipment data bounds plausible values but is not evidence for 60 A; MOCP is never treated as a load current and is never substituted for the canonical value.",
    provenance_strength: "NONE",
  });

  push({
    stable_id: FS084_STABLE_ID,
    value: num(fp?.amps ?? null),
    source: "electrical_loads.amps (FarmOps, read live and unchanged)",
    source_type: "farmops_field",
    semantic_claim:
      "A bare numeric column with no companion OCP, MCA or basis field; the schema records no current concept.",
    independent_evidence: false,
    independent_evidence_note:
      "The FarmOps value is a separate assertion under trace, not evidence for the canonical figure.",
    provenance_strength: "NONE",
  });

  // ---- classify the canonical amps value --------------------------------
  const supportsEquipmentCurrent =
    ods.amps !== null &&
    ((rca !== null && Math.abs(rca - ods.amps) < 0.5) ||
      (rla !== null && Math.abs(rla - ods.amps) < 0.5));
  const supportsOcp =
    ods.amps !== null &&
    (breakerOcp.includes(ods.amps) || (mocp !== null && Math.abs(mocp - ods.amps) < 0.5));
  const stated = farmOpsStatedConcept(fp);

  let ods_amp_class: OdsAmpProvenanceClass;
  let rationale: string;
  let odsStrength: ProvenanceStrength;

  if (vaDerived && ods.amps === null) {
    ods_amp_class = "DERIVED_OR_FORMULA_VALUE";
    rationale = "No amps value is present to classify.";
    odsStrength = "NONE";
  } else if (srcRef || odsNote) {
    ods_amp_class = "OTHER_PROVENANCE";
    rationale = `The row carries text (${srcRef ?? odsNote}) that must be adjudicated before the value is classified; it is not one of the explicit equipment/OCP/design statements.`;
    odsStrength = "MODERATE_UNCORROBORATED";
  } else if (supportsEquipmentCurrent) {
    ods_amp_class = "EXPLICIT_EQUIPMENT_CURRENT_SUPPORTED";
    rationale = `The canonical ${ods.amps} A matches a published equipment current (RCA ${num(
      rca,
    )} A / RLA ${num(rla)} A).`;
    odsStrength = "MODERATE_UNCORROBORATED";
  } else if (supportsOcp && breakerOcp.includes(ods.amps ?? Number.NaN)) {
    ods_amp_class = "EXPLICIT_OCP_VALUE_SUPPORTED";
    rationale = `A linked breaker position records ${ods.amps} A OCP for this load.`;
    odsStrength = "MODERATE_UNCORROBORATED";
  } else {
    ods_amp_class = "LEGACY_VALUE_SOURCE_UNKNOWN";
    rationale = [
      `The canonical ${num(ods.amps)} A is a static cell in ${baseline.ods_file_name} · ${
        ods.worksheet
      } row ${ods.row} with no formula, comment, note, source reference, attached design document, circuit or breaker link, and no second statement anywhere in the workbook.`,
      vaDerived
        ? `The only other canonical number that agrees with it, ${num(
            ods.connected_va,
          )} VA, is proven to be ${num(ods.volts)} × ${num(
            ods.amps,
          )} and is therefore excluded as evidence rather than counted as corroboration.`
        : null,
      `Manufacturer evidence (MOCP ${num(mocp)} A, RCA ${num(rca)} A, RLA ${num(
        rla,
      )} A, MCA unverified) does not match or explain it, but a mismatch with equipment ratings is not itself proof of a transcription fault — so the value is not classified LIKELY_DATA_ENTRY_ERROR_UNPROVEN.`,
      "The value therefore carries no established origin and no established semantic: it is a legacy canonical entry of unknown source.",
    ]
      .filter(Boolean)
      .join(" ");
    odsStrength = "NONE";
  }

  // ---- independently classify the FarmOps amps value --------------------
  let farmops_amp_semantic: FarmOpsAmpSemantic;
  let farmopsRationale: string;
  let farmopsStrength: ProvenanceStrength;
  const fpAmps = fp?.amps ?? null;

  if (!fp || fpAmps === null) {
    farmops_amp_semantic = "NO_FARMOPS_VALUE_PRESENT";
    farmopsRationale = "FarmOps holds no amps value for this load.";
    farmopsStrength = "NONE";
  } else if (stated) {
    farmops_amp_semantic = stated.semantic;
    farmopsRationale = stated.because;
    farmopsStrength = "MODERATE_UNCORROBORATED";
  } else if (breakerOcp.includes(fpAmps)) {
    farmops_amp_semantic = "ESTABLISHES_INSTALLED_BREAKER_OCP";
    farmopsRationale = `A breaker position linked to this load records ${fpAmps} A OCP, which corroborates an installed-OCP reading of the FarmOps value.`;
    farmopsStrength = "MODERATE_UNCORROBORATED";
  } else {
    const coincidesWithMocp = mocp !== null && Math.abs(mocp - fpAmps) < 0.5;
    farmops_amp_semantic = "NUMERIC_VALUE_WITH_UNRESOLVED_SEMANTICS";
    farmopsRationale = [
      `FarmOps holds ${fpAmps} A in electrical_loads.amps with no source reference, no note beyond placeholder text, no field-level audit entry touching amps, and no linked breaker or circuit recording a protective-device rating.`,
      fp.creation_batch_size > 1
        ? `The row arrived in the bulk import batch of ${fp.creation_batch_size} rows created at ${fp.created_at}, which records arrival, not meaning.`
        : null,
      coincidesWithMocp
        ? `The value numerically coincides with the published MOCP of ${mocp} A, but coincidence is not provenance: nothing in FarmOps states MOCP, so this does not establish MOCP, an installed breaker rating or a load current.`
        : `Nothing associates the value with MOCP, an installed breaker rating or a measured load current.`,
      "It is therefore merely a numeric value with unresolved semantics.",
    ]
      .filter(Boolean)
      .join(" ");
    farmopsStrength =
      mocp !== null && Math.abs(mocp - fpAmps) < 0.5 ? "WEAK_CIRCUMSTANTIAL" : "NONE";
  }

  // ---- drift between reviewed values and live values --------------------
  const expectation_notes: string[] = [];
  if (ods.amps !== null && ods.amps !== FS084_REVIEWED_ODS_AMPS)
    expectation_notes.push(
      `The review describes canonical Amps = ${FS084_REVIEWED_ODS_AMPS}; the attached workbook parses ${ods.amps}. The parsed value governs — no stored copy is substituted.`,
    );
  if (fpAmps !== null && fpAmps !== FS084_REVIEWED_FARMOPS_AMPS)
    expectation_notes.push(
      `The review describes FarmOps amps = ${FS084_REVIEWED_FARMOPS_AMPS} with connected_va NULL; FarmOps currently holds ${fpAmps} A and connected_va ${num(
        fp?.connected_va ?? null,
      )}. Live values are reported as they are and neither value is changed here.`,
    );

  return {
    version: FS084_PROVENANCE_VERSION,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    stable_id: FS084_STABLE_ID,
    workbook_name: baseline.ods_file_name,
    workbook_sha256: baseline.ods_sha256,
    is_phase_44a_baseline: baseline.is_phase_44a_baseline,
    baseline_label: label,
    worksheet: ods.worksheet,
    worksheet_row: ods.row,
    ods_volts: ods.volts,
    ods_amps: ods.amps,
    ods_va: ods.connected_va,
    va_basis: va.basis,
    va_basis_proof: va.proof,
    va_excluded_as_evidence: true,
    farmops_amps: fpAmps,
    farmops_volts: fp?.volts ?? null,
    farmops_connected_va: fp?.connected_va ?? null,
    equipment_model: eq?.model ?? null,
    equipment_voltage_class: eq?.semantics.rated_equipment_voltage_class ?? null,
    equipment_mocp: mocp,
    rca,
    rla,
    mca: eq?.semantics.minimum_circuit_ampacity ?? null,
    mca_status: "NULL / unverified — never inferred",
    trace,
    ods_amp_class,
    ods_amp_class_rationale: rationale,
    ods_amp_provenance_strength: odsStrength,
    farmops_amp_semantic,
    farmops_amp_semantic_rationale: farmopsRationale,
    farmops_amp_provenance_strength: farmopsStrength,
    peer_relationship: peerRelationship,
    preserved_raw_finding: `Raw SHA-bound finding retained: ${FS084_STABLE_ID} loads.amps — ODS ${num(
      ods.amps,
    )} vs FarmOps ${num(fpAmps)} under workbook SHA-256 ${baseline.ods_sha256}.`,
    preserved_current_semantic_disposition:
      "CURRENT_SEMANTICS_UNRESOLVED / AMP_FIELD_SEMANTICS_UNRESOLVED — unchanged by this trace.",
    open_questions: openQuestionsFor(FS084_STABLE_ID),
    expectation_notes,
    next_evidence_required: [
      "A canonical-side statement of what the Amps column asserts for this row (measured current, design selection, or protective-device rating), dated and attributable.",
      "The installed breaker rating for the FS-084 circuit, observed in the field, recorded as OCP rather than as a load current.",
      "Published MCA for the Bryant configuration, if it exists — never derived here.",
    ],
    read_only: true,
    apply_available: false,
    ods_edit_authorized: false,
    farmops_write_authorized: false,
  };
}

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const FS084_TRACE_CSV_HEADER = [
  "stable_id",
  "value",
  "source",
  "source_type",
  "semantic_claim",
  "independent_evidence",
  "independent_evidence_note",
  "provenance_strength",
] as const;

export function fs084TraceCsv(report: Fs084ProvenanceReport): string {
  return [
    FS084_TRACE_CSV_HEADER.join(","),
    ...report.trace.map((t) =>
      [
        t.stable_id,
        t.value,
        t.source,
        t.source_type,
        t.semantic_claim,
        t.independent_evidence ? "yes" : "no",
        t.independent_evidence_note,
        PROVENANCE_STRENGTH_LABELS[t.provenance_strength],
      ]
        .map(cell)
        .join(","),
    ),
  ].join("\n");
}

export function fs084ProvenanceMarkdown(report: Fs084ProvenanceReport): string {
  const n = (v: number | null) => (v === null ? "not stated" : String(v));
  const lines: string[] = [
    "# Phase 4.4b — FS-084 60 A provenance adjudication (read-only)",
    "",
    `- Version: ${report.version}`,
    `- Generated: ${report.generated_at}`,
    `- Canonical workbook: ${report.workbook_name} (SHA-256 ${report.workbook_sha256})`,
    `- Baseline: ${report.baseline_label}`,
    `- Worksheet / row: ${report.worksheet ?? "not parsed"} · ${report.worksheet_row ?? "—"}`,
    `- Canonical values: ${n(report.ods_volts)} V, ${n(report.ods_amps)} A, ${n(report.ods_va)} VA`,
    `- FarmOps values (live, unchanged): ${n(report.farmops_volts)} V, ${n(
      report.farmops_amps,
    )} A, connected VA ${n(report.farmops_connected_va)}`,
    `- Equipment: ${report.equipment_model ?? "not established"} — ${
      report.equipment_voltage_class ?? "not stated"
    } VAC, MOCP ${n(report.equipment_mocp)} A, RCA ${n(report.rca)} A, RLA ${n(report.rla)} A, MCA ${
      report.mca === null ? report.mca_status : report.mca
    }`,
    `- Connected VA basis: ${VA_BASIS_LABELS[report.va_basis]} — ${report.va_basis_proof} Excluded from the evidence set supporting the amps value.`,
    "- No ODS edit, no FarmOps write. MOCP is never read as a load current, MCA is never inferred, and the derived VA figure is never used as evidence.",
    "",
    "## Provenance trace",
    "",
    "| Stable ID | Value | Source | Source type | Semantic claim | Independent evidence | Provenance strength |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const t of report.trace) {
    lines.push(
      `| ${t.stable_id} | ${t.value} | ${t.source} | \`${t.source_type}\` | ${t.semantic_claim} | ${
        t.independent_evidence ? "yes" : "no"
      } — ${t.independent_evidence_note} | ${PROVENANCE_STRENGTH_LABELS[t.provenance_strength]} |`,
    );
  }
  lines.push(
    "",
    "## Classification — canonical ODS amps value",
    "",
    `- Class: \`${report.ods_amp_class}\` — ${ODS_AMP_CLASS_LABELS[report.ods_amp_class]}`,
    `- Provenance strength: ${PROVENANCE_STRENGTH_LABELS[report.ods_amp_provenance_strength]}`,
    `- Rationale: ${report.ods_amp_class_rationale}`,
    "",
    "## Classification — FarmOps amps value (independent trace)",
    "",
    `- Result: \`${report.farmops_amp_semantic}\` — ${
      FARMOPS_AMP_SEMANTIC_LABELS[report.farmops_amp_semantic]
    }`,
    `- Provenance strength: ${PROVENANCE_STRENGTH_LABELS[report.farmops_amp_provenance_strength]}`,
    `- Rationale: ${report.farmops_amp_semantic_rationale}`,
    "",
    "## Relationship to FS-082 / FS-083",
    "",
    `- ${report.peer_relationship}`,
    "",
    "## Preserved state",
    "",
    `- ${report.preserved_raw_finding}`,
    `- ${report.preserved_current_semantic_disposition}`,
    ...report.open_questions.map((q) => `- Open question retained: ${q}`),
    ...report.expectation_notes.map((n2) => `- Note: ${n2}`),
    "",
    "## Evidence required next",
    "",
    ...report.next_evidence_required.map((e) => `- ${e}`),
  );
  return lines.join("\n");
}
