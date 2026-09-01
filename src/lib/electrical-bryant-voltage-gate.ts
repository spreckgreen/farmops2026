// Phase 4.4b — Bryant nominal supply voltage apply gate (pure module).
//
// Scope: exactly two load records, FS-082 and FS-083. Both are verified Bryant
// mini-split systems (outdoor 37MARAQ24AA3, rated 208/230 V AC, 1Ø, 60 Hz) on
// the site's canonical nominal supply of 240 V. Their stored FarmOps scalar
// voltage of 120 V is incompatible with that configuration.
//
// The gate writes ONE field on ONE row per approved entry:
//   electrical_loads.volts  120 -> 240
//
// Nothing else is ever written: amps, connected VA, demand VA, notes, source
// references, equipment provenance, ODS capture, stable IDs, relationships,
// breaker data, services/topology, Boolean reconciliation, MCA/MOCP values,
// FS-034, FS-092, FS-084 and every other load are out of scope. The rated
// equipment voltage class "208/230" is preserved verbatim as provenance and is
// never collapsed to a scalar 230.
import type { EquipmentProvenance } from "@/lib/electrical-equipment-provenance";

export const BRYANT_VOLTAGE_GATE_VERSION = "4.4b-bryant-nominal-supply-voltage-gate-1";

/** The only two loads this gate may ever touch. */
export const BRYANT_VOLTAGE_LOAD_IDS = ["FS-082", "FS-083"] as const;
export const BRYANT_VOLTAGE_LOAD_SET = new Set<string>(BRYANT_VOLTAGE_LOAD_IDS);

/** The single column written, and the only permitted from/to values. */
export const BRYANT_VOLTAGE_COLUMN = "volts";
export const BRYANT_CURRENT_VOLTAGE = 120;
export const BRYANT_NOMINAL_SUPPLY_VOLTAGE = 240;

/** Verified equipment facts the gate requires and preserves separately. */
export const BRYANT_OUTDOOR_MODEL = "37MARAQ24AA3";
export const BRYANT_RATED_EQUIPMENT_VOLTAGE_CLASS = "208/230";
export const BRYANT_PHASE = "1";
export const BRYANT_FREQUENCY_HZ = 60;

/**
 * Evidence discrepancies that are known, documented and unrelated to supply
 * voltage. Anything outside this list counts as conflicting newer evidence and
 * blocks the write.
 */
export const NON_BLOCKING_DISCREPANCY_CODES = new Set<string>([
  "INDOOR_MODEL_SUFFIX_VERIFICATION_REQUIRED",
]);

export type BryantVoltageGateStatus =
  | "would_change"
  | "already_correct"
  | "drifted"
  | "conflict"
  | "not_found"
  | "not_approved"
  | "failed"
  | "applied";

export interface BryantVoltageGateRow {
  table: string;
  stable_id: string;
  row_uuid: string | null;
  column: string;
  /** Live scalar voltage read back during this run. */
  live_volts: number | null;
  /** Value proposed / written. Always the canonical nominal supply voltage. */
  proposed_volts: number;
  /** Preserved separately — never written into the scalar column. */
  rated_equipment_voltage: string;
  phase: string;
  frequency_hz: number;
  status: BryantVoltageGateStatus;
  applied_at: string | null;
  detail?: string;
}

export interface BryantVoltageGateSummary {
  gate_version: string;
  authorized_loads: number;
  would_change: number;
  already_correct: number;
  drifted: number;
  conflict: number;
  not_found: number;
  not_approved: number;
  failed: number;
  applied: number;
  accounted: number;
  reconciles: boolean;
}

export function bryantVoltageGateKey(r: { table: string; stable_id: string }): string {
  return `${r.table}|${r.stable_id}|${BRYANT_VOLTAGE_COLUMN}`;
}

/**
 * Does the equipment configuration still resolve to the verified Bryant system,
 * and does its provenance still support nominal 240 V?
 */
export function bryantProvenanceHolds(
  equipment: EquipmentProvenance | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!equipment) {
    return { ok: false, reason: "No verified equipment provenance resolves for this load." };
  }
  const outdoor = equipment.components.find(
    (c) => c.role === "outdoor_unit" && c.model === BRYANT_OUTDOOR_MODEL,
  );
  if (!outdoor || !outdoor.model_verified) {
    return {
      ok: false,
      reason: `The equipment configuration no longer resolves to a verified ${BRYANT_OUTDOOR_MODEL} outdoor unit.`,
    };
  }
  const s = equipment.semantics;
  if (s.rated_equipment_voltage_class !== BRYANT_RATED_EQUIPMENT_VOLTAGE_CLASS) {
    return {
      ok: false,
      reason: `Rated equipment voltage class is "${s.rated_equipment_voltage_class ?? "not stated"}", expected "${BRYANT_RATED_EQUIPMENT_VOLTAGE_CLASS}".`,
    };
  }
  if (s.phase !== BRYANT_PHASE || s.frequency_hz !== BRYANT_FREQUENCY_HZ) {
    return {
      ok: false,
      reason: `Phase/frequency provenance changed (${s.phase ?? "?"}Ø, ${s.frequency_hz ?? "?"} Hz).`,
    };
  }
  if (s.nominal_supply_voltage !== BRYANT_NOMINAL_SUPPLY_VOLTAGE) {
    return {
      ok: false,
      reason: `Provenance no longer states a ${BRYANT_NOMINAL_SUPPLY_VOLTAGE} V nominal supply (states ${s.nominal_supply_voltage ?? "nothing"}).`,
    };
  }
  const blocking = equipment.discrepancies.filter(
    (d) => !NON_BLOCKING_DISCREPANCY_CODES.has(d.code),
  );
  if (blocking.length) {
    return {
      ok: false,
      reason: `Conflicting newer evidence recorded: ${blocking.map((d) => d.code).join(", ")}.`,
    };
  }
  return { ok: true };
}

/**
 * Is this row still safe to write? Called twice per write: during the preview
 * read and again immediately before the update, against the freshest row.
 */
export function stillSafeToApplyBryantVoltage(input: {
  stable_id: string;
  live_volts: number | null;
  equipment: EquipmentProvenance | undefined;
  /** Adjudication bucket for this load's `volts` finding, when available. */
  adjudication_bucket: string | null;
  /** Canonical ODS voltage the adjudication compared against. */
  ods_volts: number | null;
}):
  | { ok: true }
  | {
      ok: false;
      status: Exclude<BryantVoltageGateStatus, "would_change" | "applied">;
      reason: string;
    } {
  if (!BRYANT_VOLTAGE_LOAD_SET.has(input.stable_id)) {
    return {
      ok: false,
      status: "not_approved",
      reason: `${input.stable_id} is not one of the two loads authorized for this correction (${BRYANT_VOLTAGE_LOAD_IDS.join(", ")}).`,
    };
  }
  if (input.live_volts === BRYANT_NOMINAL_SUPPLY_VOLTAGE) {
    return { ok: false, status: "already_correct", reason: "Already at the nominal 240 V." };
  }
  if (input.live_volts !== BRYANT_CURRENT_VOLTAGE) {
    return {
      ok: false,
      status: "drifted",
      reason: `Live scalar voltage is ${input.live_volts ?? "not stated"}, the reviewed value was ${BRYANT_CURRENT_VOLTAGE}. Nothing was written.`,
    };
  }
  const prov = bryantProvenanceHolds(input.equipment);
  if (!prov.ok) return { ok: false, status: "conflict", reason: prov.reason };

  if (input.ods_volts !== BRYANT_NOMINAL_SUPPLY_VOLTAGE) {
    return {
      ok: false,
      status: "drifted",
      reason: `The canonical workbook no longer states ${BRYANT_NOMINAL_SUPPLY_VOLTAGE} V for this load (states ${input.ods_volts ?? "nothing"}).`,
    };
  }
  if (input.adjudication_bucket !== "farmops_value_incompatible_with_verified_equipment") {
    return {
      ok: false,
      status: "conflict",
      reason: `Live adjudication classifies this voltage finding as "${input.adjudication_bucket ?? "no finding"}", not an incompatibility with verified equipment. Re-run adjudication.`,
    };
  }
  return { ok: true };
}

export function summarizeBryantVoltageGate(
  rows: BryantVoltageGateRow[],
): BryantVoltageGateSummary {
  const count = (s: BryantVoltageGateStatus) => rows.filter((r) => r.status === s).length;
  const summary: BryantVoltageGateSummary = {
    gate_version: BRYANT_VOLTAGE_GATE_VERSION,
    authorized_loads: BRYANT_VOLTAGE_LOAD_IDS.length,
    would_change: count("would_change"),
    already_correct: count("already_correct"),
    drifted: count("drifted"),
    conflict: count("conflict"),
    not_found: count("not_found"),
    not_approved: count("not_approved"),
    failed: count("failed"),
    applied: count("applied"),
    accounted: 0,
    reconciles: false,
  };
  summary.accounted =
    summary.would_change +
    summary.already_correct +
    summary.drifted +
    summary.conflict +
    summary.not_found +
    summary.not_approved +
    summary.failed +
    summary.applied;
  summary.reconciles = summary.accounted === rows.length;
  return summary;
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function bryantVoltageGateCsv(rows: BryantVoltageGateRow[]): string {
  const head = [
    "stable_id",
    "farmops_entity",
    "column",
    "row_uuid",
    "old_volts",
    "new_volts",
    "rated_equipment_voltage",
    "phase",
    "frequency_hz",
    "status",
    "applied_at",
    "detail",
  ];
  const body = rows.map((r) => [
    r.stable_id,
    r.table,
    r.column,
    r.row_uuid ?? "",
    r.live_volts === null ? "" : String(r.live_volts),
    String(r.proposed_volts),
    r.rated_equipment_voltage,
    r.phase,
    String(r.frequency_hz),
    r.status,
    r.applied_at ?? "",
    r.detail ?? "",
  ]);
  return [head, ...body].map((r) => r.map(csvCell).join(",")).join("\n");
}

export function bryantVoltageGateMarkdown(
  rows: BryantVoltageGateRow[],
  summary: BryantVoltageGateSummary,
  opts: { applied: boolean; generated_at: string },
): string {
  return [
    `# Phase 4.4b — Bryant nominal supply voltage ${opts.applied ? "apply report" : "preview"}`,
    "",
    `- Gate version: \`${summary.gate_version}\``,
    `- Generated: ${opts.generated_at}`,
    `- Authorized loads: ${BRYANT_VOLTAGE_LOAD_IDS.join(", ")}`,
    `- Rows: ${rows.length} (would change ${summary.would_change}, already correct ${summary.already_correct}, drifted ${summary.drifted}, conflict ${summary.conflict}, not found ${summary.not_found}, not approved ${summary.not_approved}, failed ${summary.failed}, applied ${summary.applied})`,
    `- Reconciles: ${summary.reconciles ? "yes" : "NO"}`,
    "",
    `Exactly one field is written: \`electrical_loads.${BRYANT_VOLTAGE_COLUMN}\` ${BRYANT_CURRENT_VOLTAGE} → ${BRYANT_NOMINAL_SUPPLY_VOLTAGE}. Rated equipment voltage ${BRYANT_RATED_EQUIPMENT_VOLTAGE_CLASS} VAC, ${BRYANT_PHASE}Ø, ${BRYANT_FREQUENCY_HZ} Hz is preserved separately as provenance and never collapsed to a scalar. Amps, connected/demand VA, notes, source references, equipment provenance, ODS capture, IDs and relationships are untouched, as are FS-084, FS-034, FS-092 and every other load.`,
    "",
    "| Stable ID | Old volts | New volts | Rated equipment voltage | Status | Applied at | Detail |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map(
      (r) =>
        `| ${r.stable_id} | ${r.live_volts ?? "not stated"} | ${r.proposed_volts} | ${r.rated_equipment_voltage} VAC, ${r.phase}Ø, ${r.frequency_hz} Hz | ${r.status} | ${r.applied_at ?? "—"} | ${r.detail ?? ""} |`,
    ),
  ].join("\n");
}
