// Phase 4.4b — panel system-voltage semantic model.
//
// A panel/feeder/branch "voltage" is a SYSTEM DESIGNATION (120/240 V, 1φ,
// 3-wire): two nominal voltages plus phase and wire configuration. A load
// "volts" is a UTILIZATION SCALAR (a 240 V appliance). These are different
// semantics and this module keeps them apart.
//
// Nothing here parses 120/240 into a float and nothing here writes production
// data. It is a representation + resolver + preview module only.
//
// Reuse note: the existing electrical service *configuration revision*
// abstraction (`electrical_service_configurations.voltage` / `.phase`) already
// describes the supplied system per revision. This module supplies the shared
// designation vocabulary for that abstraction instead of inventing a second,
// competing voltage model, and it never binds a designation to a service
// IDENTITY (SVC-HOUSE / SVC-FARMSHOP stay revision-agnostic).
import { parseSystemVoltage, type SystemVoltage } from "@/lib/electrical-numeric-semantics";

export const SYSTEM_VOLTAGE_MODEL_VERSION = "4.4b-system-voltage-model-1";

/* --------------------------------------------------------- representation */

/**
 * The explicit representation a panel/feeder/branch system voltage requires.
 * Every component is preserved separately; `designation` is the canonical
 * display string and is never the source of truth for arithmetic.
 */
export interface SystemVoltageRepresentation {
  /** Stable catalog code, e.g. "SYSV-120/240-1P3W". */
  code: string;
  /** Canonical display designation, e.g. "120/240 V, 1φ, 3-wire". */
  designation: string;
  /** Nominal line-to-neutral voltage, e.g. 120. */
  line_neutral_volts: number;
  /** Nominal line-to-line voltage, e.g. 240. */
  line_line_volts: number;
  /** Phase count: 1 or 3. Null when the source never stated it. */
  phases: number | null;
  /** Conductor/system configuration where modeled, e.g. 3 for 3-wire. */
  wires: number | null;
  /** Short engineering note. */
  note: string;
}

export interface SystemVoltageCatalogEntry extends SystemVoltageRepresentation {
  /** Canonical shorthand that appears in the workbook ("120/240"). */
  ods_notation: string;
  /** Common alternate spellings accepted on input. */
  aliases: string[];
}

/**
 * Catalog of system designations FarmOps recognises. Additive: an unlisted
 * L-N/L-L pair still resolves structurally (see `resolveSystemVoltage`) rather
 * than being rejected or collapsed to a scalar.
 */
export const SYSTEM_VOLTAGE_CATALOG: SystemVoltageCatalogEntry[] = [
  {
    code: "SYSV-120/240-1P3W",
    designation: "120/240 V, 1φ, 3-wire",
    ods_notation: "120/240",
    aliases: ["120/240v", "120/240 vac", "120/240 1ph", "240/120"],
    line_neutral_volts: 120,
    line_line_volts: 240,
    phases: 1,
    wires: 3,
    note: "Split-phase service: 120 V line-to-neutral, 240 V line-to-line.",
  },
  {
    code: "SYSV-120/208-3P4W",
    designation: "120/208 V, 3φ, 4-wire",
    ods_notation: "120/208",
    aliases: ["120/208v", "208/120"],
    line_neutral_volts: 120,
    line_line_volts: 208,
    phases: 3,
    wires: 4,
    note: "Three-phase wye: 120 V line-to-neutral, 208 V line-to-line.",
  },
  {
    code: "SYSV-277/480-3P4W",
    designation: "277/480 V, 3φ, 4-wire",
    ods_notation: "277/480",
    aliases: ["277/480v", "480/277"],
    line_neutral_volts: 277,
    line_line_volts: 480,
    phases: 3,
    wires: 4,
    note: "Three-phase wye: 277 V line-to-neutral, 480 V line-to-line.",
  },
];

const BY_NOTATION = new Map(SYSTEM_VOLTAGE_CATALOG.map((e) => [e.ods_notation, e]));
const BY_CODE = new Map(SYSTEM_VOLTAGE_CATALOG.map((e) => [e.code.toUpperCase(), e]));

/* ------------------------------------------------------- field semantics */

export type VoltageSemantics =
  /** A supplied system designation: two nominal voltages + phase/wires. */
  | "system_designation"
  /** One utilization voltage for a single piece of equipment. */
  | "utilization_scalar"
  /** FarmOps-native nameplate value, outside canonical reconciliation. */
  | "nameplate_scalar";

/**
 * Voltage semantics per entity field. Determined by entity, never globally:
 * a load requiring 240 V is not a panel supplied by a 120/240 V system.
 */
export const VOLTAGE_FIELD_SEMANTICS: Record<string, VoltageSemantics> = {
  "electrical_panels.voltage": "system_designation",
  "electrical_feeders.voltage": "system_designation",
  "electrical_circuit_groups.voltage": "system_designation",
  "electrical_branch_runs.voltage": "system_designation",
  "electrical_service_configurations.voltage": "system_designation",
  "electrical_loads.volts": "utilization_scalar",
  "electrical_power_assets.input_voltage": "nameplate_scalar",
  "electrical_power_assets.output_voltage": "nameplate_scalar",
  "electrical_devices.input_voltage": "nameplate_scalar",
};

export function voltageSemantics(
  table: string | null | undefined,
  field: string | null | undefined,
): VoltageSemantics | null {
  if (!table || !field) return null;
  return VOLTAGE_FIELD_SEMANTICS[`${table}.${field}`] ?? null;
}

/** Is this field allowed to hold a system designation such as 120/240? */
export function isSystemVoltageField(
  table: string | null | undefined,
  field: string | null | undefined,
): boolean {
  return voltageSemantics(table, field) === "system_designation";
}

/**
 * The column a migration would add to carry the designation. Declared here so
 * the resolver, the preview and the docs cannot drift apart. No migration is
 * applied by this phase.
 */
export const SYSTEM_VOLTAGE_COLUMN = "system_voltage";

/* ------------------------------------------------------------- resolution */

function fromSystemVoltage(sys: SystemVoltage): SystemVoltageRepresentation {
  const known = BY_NOTATION.get(`${sys.line_neutral}/${sys.line_line}`);
  if (known) {
    return {
      ...known,
      // A stated phase count in the source always wins over the catalog.
      phases: sys.phases ?? known.phases,
    };
  }
  return {
    code: `SYSV-${sys.line_neutral}/${sys.line_line}${sys.phases ? `-${sys.phases}P` : ""}`,
    designation: `${sys.line_neutral}/${sys.line_line} V${sys.phases ? `, ${sys.phases}φ` : ""}`,
    line_neutral_volts: sys.line_neutral,
    line_line_volts: sys.line_line,
    phases: sys.phases,
    wires: null,
    note: "System designation not in the FarmOps catalog; both nominal voltages are preserved verbatim.",
  };
}

/**
 * Resolve any stored/authored system-voltage representation. Accepts a catalog
 * code ("SYSV-120/240-1P3W"), canonical notation ("120/240", "120/240 V 1ph")
 * or a structured object. Returns null for a bare scalar such as "240" — a
 * scalar is NOT a system designation and is never promoted into one.
 */
export function resolveSystemVoltage(raw: unknown): SystemVoltageRepresentation | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const ln = Number(o["line_neutral_volts"] ?? o["line_neutral"]);
    const ll = Number(o["line_line_volts"] ?? o["line_line"]);
    if (Number.isFinite(ln) && Number.isFinite(ll) && ln !== ll) {
      const rep = fromSystemVoltage({
        line_neutral: Math.min(ln, ll),
        line_line: Math.max(ln, ll),
        phases: Number.isFinite(Number(o["phases"])) ? Number(o["phases"]) : null,
        canonical: `${Math.min(ln, ll)}/${Math.max(ln, ll)}`,
      });
      const wires = Number(o["wires"]);
      return { ...rep, wires: Number.isFinite(wires) ? wires : rep.wires };
    }
    return null;
  }
  const text = String(raw).replace(/\s+/g, " ").trim();
  if (!text) return null;
  // A stored jsonb designation arrives as JSON text through the snapshot export.
  if (text.startsWith("{")) {
    try {
      return resolveSystemVoltage(JSON.parse(text) as unknown);
    } catch {
      return null;
    }
  }
  const byCode = BY_CODE.get(text.toUpperCase());

  if (byCode) return { ...byCode };
  const alias = SYSTEM_VOLTAGE_CATALOG.find((e) => e.aliases.includes(text.toLowerCase()));
  if (alias) return { ...alias };
  const sys = parseSystemVoltage(text);
  return sys ? fromSystemVoltage(sys) : null;
}

/**
 * Two system designations agree when both nominal voltages match. Phase/wire
 * counts are compared only when both sides state them, so an unstated phase is
 * never treated as a disagreement.
 */
export function sameSystemVoltage(
  a: SystemVoltageRepresentation | null,
  b: SystemVoltageRepresentation | null,
): boolean {
  if (!a || !b) return false;
  if (a.line_neutral_volts !== b.line_neutral_volts) return false;
  if (a.line_line_volts !== b.line_line_volts) return false;
  if (a.phases !== null && b.phases !== null && a.phases !== b.phases) return false;
  if (a.wires !== null && b.wires !== null && a.wires !== b.wires) return false;
  return true;
}

/** Canonical display for a representation, e.g. "120/240 V, 1φ, 3-wire". */
export function systemVoltageLabel(rep: SystemVoltageRepresentation): string {
  return rep.designation;
}

/* ---------------------------------------------------- migration preview */

export type SystemVoltagePreviewStatus =
  /** Scalar column holds the line-to-line value only; both components survive in the proposal. */
  | "scalar_loses_line_neutral"
  /** Scalar column is empty; the designation would be the first stored value. */
  | "scalar_not_stated"
  /** Scalar disagrees with both nominal voltages — needs engineering review, not a migration. */
  | "scalar_unrelated_value";

export interface SystemVoltagePreviewRow {
  domain: string;
  stable_id: string;
  farmops_entity: string;
  farmops_field: string;
  farmops_uuid: string | null;
  ods_worksheet: string;
  ods_column: string;
  ods_row: number | null;
  /** What the canonical workbook states, verbatim. */
  ods_raw: string;
  /** What FarmOps stores today, verbatim. */
  current_representation: string;
  current_scalar: number | null;
  /** Column a migration would populate. */
  proposed_column: string;
  proposed: SystemVoltageRepresentation;
  status: SystemVoltagePreviewStatus;
  explanation: string;
  /** Always true in this phase: nothing is written. */
  read_only: true;
}

export interface SystemVoltageMigrationPreview {
  model_version: string;
  proposed_column: string;
  /** Panels/feeders in the preview, one row per affected record+field. */
  rows: SystemVoltagePreviewRow[];
  affected_stable_ids: string[];
  /** Never true in this phase — there is no apply path. */
  applied: false;
}

interface PreviewInput {
  domain: string;
  stable_id: string;
  farmops_entity: string | null;
  farmops_field: string;
  farmops_uuid: string | null;
  ods_worksheet: string;
  ods_column: string;
  ods_row: number | null;
  ods_raw: string;
  farmops_raw: string;
  farmops_value: number | null;
}

/**
 * Build the read-only migration preview: current representation vs proposed
 * system-voltage representation for each affected record. Pure — no I/O, no
 * writes, no ODS edits.
 */
export function systemVoltageMigrationPreview(
  findings: PreviewInput[],
): SystemVoltageMigrationPreview {
  const rows: SystemVoltagePreviewRow[] = [];
  for (const f of findings) {
    if (!isSystemVoltageField(f.farmops_entity, f.farmops_field)) continue;
    const proposed = resolveSystemVoltage(f.ods_raw);
    if (!proposed) continue;
    const scalar = f.farmops_value;
    let status: SystemVoltagePreviewStatus;
    let explanation: string;
    if (scalar === null) {
      status = "scalar_not_stated";
      explanation = `FarmOps stores no voltage for ${f.stable_id}; the canonical designation ${proposed.designation} would be recorded in full.`;
    } else if (
      scalar === proposed.line_line_volts ||
      scalar === proposed.line_neutral_volts
    ) {
      status = "scalar_loses_line_neutral";
      explanation = `FarmOps stores the scalar ${scalar} V, which keeps only one component of ${proposed.designation}. The proposal preserves ${proposed.line_neutral_volts} V line-to-neutral and ${proposed.line_line_volts} V line-to-line, ${proposed.phases ?? "unstated"}φ${proposed.wires ? `, ${proposed.wires}-wire` : ""}.`;
    } else {
      status = "scalar_unrelated_value";
      explanation = `FarmOps stores ${scalar} V, which is neither component of ${proposed.designation}. This is an engineering question, not a representation migration — review before any change.`;
    }
    rows.push({
      domain: f.domain,
      stable_id: f.stable_id,
      farmops_entity: f.farmops_entity!,
      farmops_field: f.farmops_field,
      farmops_uuid: f.farmops_uuid,
      ods_worksheet: f.ods_worksheet,
      ods_column: f.ods_column,
      ods_row: f.ods_row,
      ods_raw: f.ods_raw,
      current_representation: f.farmops_raw || "(not stated)",
      current_scalar: scalar,
      proposed_column: SYSTEM_VOLTAGE_COLUMN,
      proposed,
      status,
      explanation,
      read_only: true,
    });
  }
  rows.sort((a, b) => a.stable_id.localeCompare(b.stable_id));
  return {
    model_version: SYSTEM_VOLTAGE_MODEL_VERSION,
    proposed_column: SYSTEM_VOLTAGE_COLUMN,
    rows,
    affected_stable_ids: [...new Set(rows.map((r) => r.stable_id))].sort(),
    applied: false,
  };
}

export function systemVoltagePreviewCsv(p: SystemVoltageMigrationPreview): string {
  const head = [
    "stable_id",
    "farmops_entity",
    "farmops_field",
    "farmops_uuid",
    "ods_worksheet",
    "ods_column",
    "ods_row",
    "ods_designation",
    "current_representation",
    "current_scalar",
    "proposed_column",
    "proposed_code",
    "proposed_designation",
    "proposed_line_neutral_volts",
    "proposed_line_line_volts",
    "proposed_phases",
    "proposed_wires",
    "status",
    "explanation",
    "applied",
  ];
  const rows = p.rows.map((r) => [
    r.stable_id,
    r.farmops_entity,
    r.farmops_field,
    r.farmops_uuid ?? "",
    r.ods_worksheet,
    r.ods_column,
    r.ods_row === null ? "" : String(r.ods_row),
    r.ods_raw,
    r.current_representation,
    r.current_scalar === null ? "" : String(r.current_scalar),
    r.proposed_column,
    r.proposed.code,
    r.proposed.designation,
    String(r.proposed.line_neutral_volts),
    String(r.proposed.line_line_volts),
    r.proposed.phases === null ? "" : String(r.proposed.phases),
    r.proposed.wires === null ? "" : String(r.proposed.wires),
    r.status,
    r.explanation,
    "false",
  ]);
  return [head, ...rows]
    .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\n");
}
