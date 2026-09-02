// Nameplate → equipment row write path: the field mapping and the pure helpers.
//
// A nameplate draft never lands on the as-installed semantic columns
// (`equipment_fla`, `minimum_circuit_ampacity`, `volts`, …). It lands on the
// parallel `nameplate_*` columns of `electrical_loads`, so the plate reading and
// the adjudicated as-installed value stay independently auditable.
//
// Example approved write for load LD-014:
//   { nameplate_manufacturer: "Mitsubishi", nameplate_model: "SUZ-KA18NAHZ",
//     nameplate_volts: "208-230", nameplate_fla_rla: "12.4",
//     nameplate_mca: "15", nameplate_mocp: "20" }

/** One nameplate draft field that may be written to the equipment row. */
export interface NameplateWriteFieldDef {
  /** Draft field id produced by the photo extraction (see electrical-nameplate). */
  id: string;
  /** Column on public.electrical_loads that receives it. */
  column: string;
  label: string;
}

export const NAMEPLATE_WRITE_FIELDS: readonly NameplateWriteFieldDef[] = [
  { id: "manufacturer", column: "nameplate_manufacturer", label: "Manufacturer" },
  { id: "model", column: "nameplate_model", label: "Model" },
  { id: "serial", column: "nameplate_serial", label: "Serial" },
  { id: "voltage", column: "nameplate_volts", label: "Voltage" },
  { id: "phase", column: "nameplate_phase", label: "Phase" },
  { id: "fla", column: "nameplate_fla_rla", label: "FLA / RLA" },
  { id: "mca", column: "nameplate_mca", label: "MCA" },
  { id: "mocp", column: "nameplate_mocp", label: "MOCP" },
] as const;

export const NAMEPLATE_WRITE_IDS = NAMEPLATE_WRITE_FIELDS.map((f) => f.id);

export type NameplateWriteStatus = "pending" | "approved" | "rejected";

export interface NameplateWriteRequestRow {
  id: string;
  requested_by: string;
  load_uuid: string;
  load_ref: string | null;
  load_label: string | null;
  proposed: Record<string, string>;
  request_note: string | null;
  status: NameplateWriteStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  applied_at: string | null;
  applied_fields: Record<string, string> | null;
  created_at: string;
}

/**
 * Keep only writable fields with a real value. Blank, "unknown"-style and
 * over-long values are dropped so an unreadable plate can never be submitted
 * as recorded data.
 */
export function sanitizeNameplateProposal(
  input: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input) return out;
  for (const def of NAMEPLATE_WRITE_FIELDS) {
    const raw = input[def.id];
    if (raw == null) continue;
    const text = String(raw).trim().replace(/\s+/g, " ").slice(0, 120);
    if (!text) continue;
    if (/^(unknown|unreadable|illegible|n\/?a|none|null|not visible|-{1,3})$/i.test(text)) {
      continue;
    }
    out[def.id] = text;
  }
  return out;
}

/** Map a sanitized proposal onto electrical_loads column names. */
export function nameplateColumnPatch(
  proposal: Record<string, string>,
): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const def of NAMEPLATE_WRITE_FIELDS) {
    const value = proposal[def.id];
    if (value != null) patch[def.column] = value;
  }
  return patch;
}

export interface NameplateFieldChange {
  id: string;
  label: string;
  column: string;
  current: string | null;
  proposed: string;
  /** True when the row already holds a different nameplate value. */
  overwrite: boolean;
}

/**
 * What approval would actually change on the equipment row. Used by the admin
 * queue so an approver sees "12.4 → 12.6" rather than a bare value list.
 */
export function nameplateChanges(
  proposal: Record<string, string>,
  loadRow: Record<string, unknown> | null,
): NameplateFieldChange[] {
  const changes: NameplateFieldChange[] = [];
  for (const def of NAMEPLATE_WRITE_FIELDS) {
    const proposed = proposal[def.id];
    if (proposed == null) continue;
    const raw = loadRow ? loadRow[def.column] : null;
    const current = raw == null || raw === "" ? null : String(raw);
    if (current === proposed) continue;
    changes.push({
      id: def.id,
      label: def.label,
      column: def.column,
      current,
      proposed,
      overwrite: current != null,
    });
  }
  return changes;
}

export const NAMEPLATE_WRITE_GATE_NOTE =
  "Nameplate readings are written only after an administrator approves the request. " +
  "Approved values land on the nameplate columns of the equipment row — the as-installed " +
  "semantic current, voltage and OCP values are never overwritten.";
