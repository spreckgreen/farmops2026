// Phase 4.4b — production inputs for the final load semantic adjudication.
//
// The canonical side is the unchanged PremoFarmElectrical.ods values as recorded
// in the Phase 4.4b numeric reconciliation for the nine Category-B load
// findings. The FarmOps side is read live from the database at view time, so the
// report always adjudicates the current stored values and never a stale copy.
// The ODS is not written, re-parsed or normalized here.
import type {
  AdjudicationLoadInput,
  AdjudicationValuePair,
  SemanticEvidence,
} from "@/lib/electrical-load-adjudication";
import { equipmentFor } from "@/lib/electrical-equipment-provenance";

export interface CanonicalOdsLoadValues {
  stable_id: string;
  description: string;
  worksheet: string;
  row: number;
  volts: number | null;
  amps: number | null;
  connected_va: number | null;
  open_questions: string[];
}

/**
 * Canonical ODS values for the five adjudicated loads, exactly as the
 * reconciliation recorded them. Read-only reference data.
 */
export const CANONICAL_ODS_LOADS: CanonicalOdsLoadValues[] = [
  {
    stable_id: "FS-034",
    description: "Shop Lift",
    worksheet: "Loads",
    row: 34,
    volts: 240,
    amps: 30,
    connected_va: 7200,
    open_questions: [
      "Resolved by equipment provenance: 220 V is the Halo Lifts HL2C-10K rated nameplate voltage; 240 V remains the canonical nominal supply designation.",
    ],
  },
  {
    stable_id: "FS-082",
    description: "Mini Split SE",
    worksheet: "Loads",
    row: 82,
    volts: 240,
    amps: 24,
    connected_va: 0,
    open_questions: [
      "Did the canonical 24 A / 240 V come from newer equipment selection, a design assumption or a field observation? Source and date are not recorded.",
      "Does the FarmOps 0 A / 120 V pair mean 'not yet installed' or an actual 120 V circuit?",
    ],
  },
  {
    stable_id: "FS-083",
    description: "Mini Split E",
    worksheet: "Loads",
    row: 83,
    volts: 240,
    amps: 25,
    connected_va: 0,
    open_questions: [
      "Did the canonical 25 A / 240 V come from newer equipment selection, a design assumption or a field observation? Source and date are not recorded.",
      "Does the FarmOps 0 A / 120 V pair mean 'not yet installed' or an actual 120 V circuit?",
    ],
  },
  {
    stable_id: "FS-084",
    description: "Mini Split W",
    worksheet: "Loads",
    row: 84,
    volts: 240,
    amps: 25,
    connected_va: 14400,
    open_questions: [
      "Is the 60 A figure a breaker / OCP rating or a stated load current? No OCP field, breaker relationship or specification distinguishes them.",
    ],
  },
  {
    stable_id: "FS-092",
    description: "Emergency shop purge (Fan/Louvers)",
    worksheet: "Loads",
    row: 92,
    volts: 120,
    amps: 8.8,
    connected_va: 1056,
    open_questions: [
      "Resolved by equipment provenance: 115 V is the Greenheck AER-24-03-0315-VG rated nameplate voltage at 8.8 A FLA; 120 V remains the canonical nominal supply designation.",
    ],
  },
];

/** The live FarmOps row shape the read-only server function returns. */
export interface FarmOpsLoadRow {
  id: string;
  load_id: string;
  description: string | null;
  equipment_model: string | null;
  volts: number | null;
  amps: number | null;
  connected_va: number | null;
  demand_va: number | null;
  source_circuit: string | null;
  circuit_group_ref: string | null;
  source_reference: string | null;
  notes: string | null;
}

/**
 * Affirmative semantic provenance actually available in FarmOps for a load.
 * Placeholder notes ("TBD", "No", "0%") are not provenance and are dropped.
 */
export function evidenceFromFarmOps(row: FarmOpsLoadRow | undefined): SemanticEvidence {
  const real = (v: string | null | undefined) => {
    const s = (v ?? "").trim();
    if (!s) return null;
    return /^(tbd|n\/?a|none|no|unknown|0%?|—|-)$/i.test(s) ? null : s;
  };
  return {
    // No mapped OCP rating column exists on electrical_loads today.
    ocp_field: null,
    equipment_spec: real(row?.equipment_model),
    canonical_notes: real(row?.notes),
    farmops_ocp_relationship: real(row?.circuit_group_ref),
    other_source_evidence: real(row?.source_reference) ?? real(row?.source_circuit),
  };
}

const pair = (
  ods: number | null,
  farmops: number | null,
  odsProv: string,
  farmopsProv: string,
): AdjudicationValuePair => ({
  ods,
  farmops,
  ods_provenance: odsProv,
  farmops_provenance: farmopsProv,
});

const same = (a: number | null, b: number | null) =>
  a !== null && b !== null && Math.abs(a - b) < 1e-9;

/**
 * Build the adjudication input from the unchanged canonical values and the live
 * FarmOps rows. Only differing fields become findings; agreeing values are
 * carried as observed context so a VA basis can be tested.
 */
export function buildProductionAdjudicationInput(rows: FarmOpsLoadRow[]): AdjudicationLoadInput[] {
  const byId = new Map(rows.map((r) => [r.load_id.trim(), r]));
  return CANONICAL_ODS_LOADS.map((ods) => {
    const row = byId.get(ods.stable_id);
    const odsProv = `${ods.worksheet} worksheet, row ${ods.row} (canonical PremoFarmElectrical.ods, unchanged)`;
    const fpProv = (field: string) =>
      `electrical_loads.${field}${row ? ` (load_id ${row.load_id})` : " (row not found)"}`;

    const fields: AdjudicationLoadInput["fields"] = {};
    const agreed: NonNullable<AdjudicationLoadInput["agreed"]> = {};

    const consider = (
      field: "volts" | "amps" | "connected_va",
      odsValue: number | null,
      fpValue: number | null,
    ) => {
      if (same(odsValue, fpValue)) {
        agreed[field] = odsValue!;
        return;
      }
      if (odsValue === null && fpValue === null) return;
      fields[field] = pair(odsValue, fpValue, odsProv, fpProv(field));
    };

    consider("volts", ods.volts, row?.volts ?? null);
    consider("amps", ods.amps, row?.amps ?? null);
    consider("connected_va", ods.connected_va, row?.connected_va ?? null);

    return {
      stable_id: ods.stable_id,
      description: row?.description?.trim() || ods.description,
      equipment_model: row?.equipment_model ?? null,
      fields,
      agreed,
      evidence: evidenceFromFarmOps(row),
      equipment: equipmentFor(ods.stable_id),
      open_questions: ods.open_questions,
    };
  });
}
