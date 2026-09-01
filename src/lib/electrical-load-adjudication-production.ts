// Phase 4.4b — production inputs for the final load semantic adjudication.
//
// The canonical side is now derived exclusively from the SHA-verified workbook
// baseline (see electrical-adjudication-baseline.ts). This module no longer
// carries its own copy of the canonical values: if the workbook is not attached,
// adjudication reports that canonical evidence is unavailable rather than
// substituting a stored value. The FarmOps side is read live from the database
// at view time. The .ods file is never written.
import type {
  AdjudicationLoadInput,
  AdjudicationValuePair,
  SemanticEvidence,
} from "@/lib/electrical-load-adjudication";
import { equipmentFor } from "@/lib/electrical-equipment-provenance";
import {
  baselineLabel,
  canonicalLoad,
  openQuestionsFor,
  type AdjudicationBaseline,
  type CanonicalOdsLoadValues,
} from "@/lib/electrical-adjudication-baseline";
import { ADJUDICATED_LOAD_IDS } from "@/lib/electrical-load-adjudication";

export type { CanonicalOdsLoadValues };

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
 * Build the adjudication input from the SHA-bound canonical baseline and the
 * live FarmOps rows. Only differing fields become findings; agreeing values are
 * carried as observed context so a VA basis can be tested.
 *
 * Loads the baseline workbook does not contain produce no findings at all —
 * a missing canonical value is never replaced by a remembered one.
 */
export function buildProductionAdjudicationInput(
  rows: FarmOpsLoadRow[],
  baseline: AdjudicationBaseline | null | undefined,
): AdjudicationLoadInput[] {
  const byId = new Map(rows.map((r) => [r.load_id.trim(), r]));
  const label = baselineLabel(baseline);

  return ADJUDICATED_LOAD_IDS.map((stableId) => {
    const ods = canonicalLoad(baseline, stableId);
    const row = byId.get(stableId);
    const odsProv = ods
      ? `${ods.worksheet} worksheet, row ${ods.row} — parsed from ${label}`
      : `No canonical row parsed from ${label}`;
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

    if (ods) {
      consider("volts", ods.volts, row?.volts ?? null);
      consider("amps", ods.amps, row?.amps ?? null);
      consider("connected_va", ods.connected_va, row?.connected_va ?? null);
    }

    const openQuestions = ods
      ? ods.open_questions
      : [
          ...openQuestionsFor(stableId),
          `No canonical value is available for ${stableId}: ${label}. Nothing is adjudicated for this load until the SHA-verified workbook is attached.`,
        ];

    return {
      stable_id: stableId,
      description: row?.description?.trim() || ods?.description || stableId,
      equipment_model: row?.equipment_model ?? null,
      fields,
      agreed,
      evidence: evidenceFromFarmOps(row),
      equipment: equipmentFor(stableId),
      open_questions: openQuestions,
    };
  });
}
