// Phase 4.4b — numeric field registry, tri-state numeric parsing and
// unit-aware normalization.
//
// Read-only by construction: nothing here writes to the database or to the
// canonical workbook. It answers two questions before any value is compared:
//
//   1. Who owns this numeric field? Only ODS_ENGINEERING_OWNED fields may take
//      part in canonical-vs-FarmOps numeric reconciliation.
//   2. What does this cell actually say? An explicit number, an explicit zero,
//      or nothing at all — three states that are never interchangeable.
//
// A numeric database column is NOT evidence of an engineering value: breaker
// numbers, panel positions, pole counts, junction/raceway sequence and rack
// units are structural ordinals and are excluded by name.
import { ENTITIES, type EntityField } from "@/lib/electrical-entities";
import { COLLECTION_FOR_KIND } from "@/lib/electrical-snapshot";
import { FARMOPS_NATIVE_KINDS, type ElectricalEntityKind } from "@/lib/electrical";

export const NUMERIC_REGISTRY_VERSION = "4.4b-numeric-1";

/* ------------------------------------------------------------- ownership */

export const NUMERIC_OWNERSHIPS = [
  "ODS_ENGINEERING_OWNED",
  "FARMOPS_OPERATIONAL",
  "DERIVED",
  "FIELD_OBSERVATION",
  "IDENTIFIER_OR_ORDINAL",
  "UNKNOWN_OWNERSHIP",
] as const;
export type NumericOwnership = (typeof NUMERIC_OWNERSHIPS)[number];

export type NumericUnit =
  | "volt"
  | "amp"
  | "volt_ampere"
  | "foot"
  | "percent"
  | "count"
  | "rack_unit"
  | "ordinal"
  | "unitless";

interface FieldRule {
  ownership: NumericOwnership;
  unit: NumericUnit;
  /** Why this field is (or is not) eligible for numeric reconciliation. */
  reason: string;
}

/**
 * Explicit ownership decision for every numeric field key in the electrical
 * model. Nothing is inferred from the database type: an unlisted key is
 * UNKNOWN_OWNERSHIP and therefore never automatically reconciled.
 */
export const NUMERIC_FIELD_RULES: Record<string, FieldRule> = {
  /* --- canonical engineering quantities ---------------------------------- */
  voltage: { ownership: "ODS_ENGINEERING_OWNED", unit: "volt", reason: "Nominal system voltage released in the canonical panel/feeder/branch schedules." },
  volts: { ownership: "ODS_ENGINEERING_OWNED", unit: "volt", reason: "Load operating voltage from the canonical load schedule." },
  amps: { ownership: "ODS_ENGINEERING_OWNED", unit: "amp", reason: "Load current from the canonical load schedule." },
  ampacity_amps: { ownership: "ODS_ENGINEERING_OWNED", unit: "amp", reason: "Conductor ampacity is an engineering design value." },
  ocp_rating_amps: { ownership: "ODS_ENGINEERING_OWNED", unit: "amp", reason: "Overcurrent protection rating is an engineering design value." },
  circuit_rating_amps: { ownership: "ODS_ENGINEERING_OWNED", unit: "amp", reason: "Circuit/branch rating is an engineering design value." },
  bus_rating_amps: { ownership: "ODS_ENGINEERING_OWNED", unit: "amp", reason: "Panel bus / main ampacity is an engineering design value." },
  connected_va: { ownership: "ODS_ENGINEERING_OWNED", unit: "volt_ampere", reason: "Connected load in volt-amperes from the canonical load calculation." },
  demand_va: { ownership: "ODS_ENGINEERING_OWNED", unit: "volt_ampere", reason: "Demand load in volt-amperes from the canonical load calculation." },
  conductor_count: { ownership: "ODS_ENGINEERING_OWNED", unit: "count", reason: "Number of conductors is part of the released design." },
  planned_length_ft: { ownership: "ODS_ENGINEERING_OWNED", unit: "foot", reason: "Design (planned) length in feet." },
  spaces: { ownership: "ODS_ENGINEERING_OWNED", unit: "count", reason: "Panel physical space count is released panel-schedule data." },
  circuits: { ownership: "ODS_ENGINEERING_OWNED", unit: "count", reason: "Panel circuit count is released panel-schedule data." },
  count: { ownership: "ODS_ENGINEERING_OWNED", unit: "count", reason: "Quantity of identical loads in the canonical load schedule." },

  /* --- field observation: never overwritten from the workbook ------------ */
  measured_length_ft: { ownership: "FIELD_OBSERVATION", unit: "foot", reason: "As-built measurement taken in the field; the workbook holds design length, not this." },

  /* --- derived: recomputed, not a released design value ------------------ */
  completion_percent: { ownership: "DERIVED", unit: "percent", reason: "Recomputed from install status; historically NOT NULL DEFAULT 0. Never reconciled against the workbook." },

  /* --- structural ordinals / identity: out of scope by rule -------------- */
  breaker_number: { ownership: "IDENTIFIER_OR_ORDINAL", unit: "ordinal", reason: "Breaker number is panel identity, not an engineering magnitude." },
  exit_order: { ownership: "IDENTIFIER_OR_ORDINAL", unit: "ordinal", reason: "Physical exit ordering around the panel; structural sequence." },
  raceway_sequence: { ownership: "IDENTIFIER_OR_ORDINAL", unit: "ordinal", reason: "Position of a junction box along its continuous parent raceway; topology, not a quantity." },
  rack_position_u: { ownership: "IDENTIFIER_OR_ORDINAL", unit: "rack_unit", reason: "Mounting position inside a rack; structural ordinal." },

  /* --- FarmOps-operational infrastructure -------------------------------- */
  rack_size_u: { ownership: "FARMOPS_OPERATIONAL", unit: "rack_unit", reason: "FarmOps-native equipment rack; no canonical workbook counterpart." },
  input_voltage: { ownership: "FARMOPS_OPERATIONAL", unit: "volt", reason: "FarmOps-native power asset / device nameplate value." },
  output_voltage: { ownership: "FARMOPS_OPERATIONAL", unit: "volt", reason: "FarmOps-native power asset nameplate value." },
  input_current_amps: { ownership: "FARMOPS_OPERATIONAL", unit: "amp", reason: "FarmOps-native power asset / device nameplate value." },
  output_current_amps: { ownership: "FARMOPS_OPERATIONAL", unit: "amp", reason: "FarmOps-native power asset nameplate value." },

  /* --- explicitly undecided --------------------------------------------- */
  generator_start_amps: { ownership: "UNKNOWN_OWNERSHIP", unit: "amp", reason: "No authoritative canonical column mapping established; ownership undetermined." },
};

/**
 * Numeric columns that live outside the compared entities entirely. They are
 * listed so the report can prove they were excluded deliberately rather than
 * forgotten. The House-panel work created most of these.
 */
export const EXCLUDED_NON_ENTITY_NUMERICS: {
  table: string;
  field: string;
  ownership: NumericOwnership;
  reason: string;
}[] = [
  { table: "electrical_breaker_positions", field: "ocp_amps", ownership: "FIELD_OBSERVATION", reason: "Field-verified breaker amperage from House panel photographs/transcription. Never inferred from label text and never overwritten by the workbook." },
  { table: "electrical_breaker_positions", field: "position", ownership: "IDENTIFIER_OR_ORDINAL", reason: "Physical breaker space; structural position." },
  { table: "electrical_breaker_positions", field: "breaker_number", ownership: "IDENTIFIER_OR_ORDINAL", reason: "Panel breaker identity." },
  { table: "electrical_breaker_positions", field: "poles", ownership: "IDENTIFIER_OR_ORDINAL", reason: "Pole count defines slot consumption/topology, not an engineering magnitude in this phase." },
  { table: "electrical_field_observations", field: "position", ownership: "FIELD_OBSERVATION", reason: "Observed panel position recorded with photo provenance." },
  { table: "electrical_field_observations", field: "poles", ownership: "FIELD_OBSERVATION", reason: "Observed pole count recorded with photo provenance." },
  { table: "electrical_panel_exits", field: "exit_order", ownership: "IDENTIFIER_OR_ORDINAL", reason: "Physical penetration ordering; structural sequence." },
  { table: "electrical_raceway_waypoints", field: "sequence", ownership: "IDENTIFIER_OR_ORDINAL", reason: "Continuous-raceway waypoint order; topology (NOT NULL DEFAULT 0)." },
  { table: "electrical_service_panels", field: "sequence", ownership: "IDENTIFIER_OR_ORDINAL", reason: "Service panel ordering within a service configuration." },
  { table: "electrical_service_configurations", field: "ampacity_amps", ownership: "UNKNOWN_OWNERSHIP", reason: "Service configuration revisions are versioned separately; service identity never encodes ampacity. Out of scope here." },
  { table: "electrical_service_panels", field: "panel_ampacity_amps", ownership: "UNKNOWN_OWNERSHIP", reason: "Belongs to a service configuration revision, not to the compared entity set." },
  { table: "electrical_intertie_configurations", field: "capacity_amps", ownership: "UNKNOWN_OWNERSHIP", reason: "Intertie configuration revision value; out of scope for numeric reconciliation." },
];

/* -------------------------------------------------- database facts (proven) */

export interface DbNumericFacts {
  db_type: string;
  nullable: boolean;
  db_default: string | null;
  /** Proven historical coercion/default behaviour for this exact column. */
  historical_behavior: string;
  /** True only when a blank workbook cell provably became this default. */
  blank_becomes_default: boolean;
}

const NULLABLE_NO_DEFAULT = (type: string): DbNumericFacts => ({
  db_type: type,
  nullable: true,
  db_default: null,
  historical_behavior:
    "Nullable with no column default; the importer's coerceValue() returns null for a blank cell, so a stored value was written, not defaulted.",
  blank_becomes_default: false,
});

const NOT_NULL_DEFAULT = (type: string, def: string): DbNumericFacts => ({
  db_type: type,
  nullable: false,
  db_default: def,
  historical_behavior: `Created as ${type} NOT NULL DEFAULT ${def}: a blank workbook cell inserted nothing and the column default supplied ${def}. That stored value is implementation-created, not engineering intent.`,
  blank_becomes_default: true,
});

/** Live schema facts, read from the database and pinned here for the report. */
export const NUMERIC_DB_FACTS: Record<string, DbNumericFacts> = {
  "electrical_panels.bus_rating_amps": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_panels.voltage": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_panels.spaces": NULLABLE_NO_DEFAULT("integer"),
  "electrical_panels.circuits": NULLABLE_NO_DEFAULT("integer"),
  "electrical_panels.completion_percent": NOT_NULL_DEFAULT("numeric", "0"),
  "electrical_loads.volts": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_loads.amps": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_loads.connected_va": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_loads.demand_va": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_loads.count": NOT_NULL_DEFAULT("integer", "1"),
  "electrical_loads.completion_percent": NOT_NULL_DEFAULT("numeric", "0"),
  "electrical_circuit_groups.voltage": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_circuit_groups.circuit_rating_amps": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_circuit_groups.demand_va": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_circuit_groups.generator_start_amps": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_circuit_groups.completion_percent": NOT_NULL_DEFAULT("numeric", "0"),
  "electrical_feeders.voltage": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_feeders.ampacity_amps": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_feeders.ocp_rating_amps": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_feeders.conductor_count": NULLABLE_NO_DEFAULT("integer"),
  "electrical_feeders.demand_va": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_feeders.planned_length_ft": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_feeders.measured_length_ft": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_feeders.completion_percent": NOT_NULL_DEFAULT("numeric", "0"),
  "electrical_raceways.planned_length_ft": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_raceways.measured_length_ft": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_raceways.exit_order": NULLABLE_NO_DEFAULT("integer"),
  "electrical_raceways.completion_percent": NOT_NULL_DEFAULT("numeric", "0"),
  "electrical_junction_boxes.raceway_sequence": NULLABLE_NO_DEFAULT("integer"),
  "electrical_junction_boxes.completion_percent": NOT_NULL_DEFAULT("numeric", "0"),
  "electrical_branch_runs.voltage": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_branch_runs.circuit_rating_amps": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_branch_runs.conductor_count": NULLABLE_NO_DEFAULT("integer"),
  "electrical_branch_runs.planned_length_ft": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_branch_runs.measured_length_ft": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_branch_runs.completion_percent": NOT_NULL_DEFAULT("numeric", "0"),
  "electrical_racks.rack_size_u": NULLABLE_NO_DEFAULT("integer"),
  "electrical_racks.completion_percent": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_power_assets.input_voltage": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_power_assets.output_voltage": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_power_assets.input_current_amps": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_power_assets.output_current_amps": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_power_assets.completion_percent": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_devices.input_voltage": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_devices.input_current_amps": NULLABLE_NO_DEFAULT("numeric"),
  "electrical_devices.rack_position_u": NULLABLE_NO_DEFAULT("integer"),
  "electrical_devices.completion_percent": NULLABLE_NO_DEFAULT("numeric"),
};

const UNKNOWN_FACTS: DbNumericFacts = {
  db_type: "unknown",
  nullable: true,
  db_default: null,
  historical_behavior: "Column not present in the pinned schema inventory; historical behaviour unproven.",
  blank_becomes_default: false,
};

/* ------------------------------------------------------------- the registry */

export interface NumericRegistryEntry {
  entity: ElectricalEntityKind;
  collection: string;
  table: string;
  field: string;
  label: string;
  db_type: string;
  nullable: boolean;
  db_default: string | null;
  ods_sheet: string | null;
  ods_column: string;
  ownership: NumericOwnership;
  unit: NumericUnit;
  importer_behavior: string;
  historical_behavior: string;
  blank_becomes_default: boolean;
  /** Only ODS_ENGINEERING_OWNED fields are compared. */
  comparable: boolean;
  reason: string;
}

const IMPORTER_BEHAVIOR =
  'coerceValue(number): blank -> null (never 0); commas/whitespace stripped; "%" via parsePercent; unit-bearing text falls back to its numeric tokens (voltage takes the highest).';

/** Full numeric field registry for the compared electrical entities. */
export function numericRegistry(): NumericRegistryEntry[] {
  const out: NumericRegistryEntry[] = [];
  for (const kind of Object.keys(ENTITIES) as ElectricalEntityKind[]) {
    const def = ENTITIES[kind];
    const native = FARMOPS_NATIVE_KINDS.has(kind);
    for (const field of def.fields) {
      if (field.kind !== "number") continue;
      const rule = NUMERIC_FIELD_RULES[field.key];
      const facts = NUMERIC_DB_FACTS[`${def.table}.${field.key}`] ?? UNKNOWN_FACTS;
      let ownership: NumericOwnership = rule?.ownership ?? "UNKNOWN_OWNERSHIP";
      let reason =
        rule?.reason ?? "No explicit ownership decision recorded for this numeric field.";
      // A FarmOps-native entity has no canonical workbook counterpart at all,
      // so none of its numbers can be ODS-owned regardless of the key name.
      if (native && ownership === "ODS_ENGINEERING_OWNED") {
        ownership = "FARMOPS_OPERATIONAL";
        reason = `${def.title} is a FarmOps-native entity with no canonical workbook counterpart.`;
      }
      if (facts === UNKNOWN_FACTS && ownership === "ODS_ENGINEERING_OWNED") {
        ownership = "UNKNOWN_OWNERSHIP";
        reason = "Schema facts for this column are not pinned, so provenance cannot be proven.";
      }
      out.push({
        entity: kind,
        collection: COLLECTION_FOR_KIND[kind],
        table: def.table,
        field: field.key,
        label: field.label,
        db_type: facts.db_type,
        nullable: facts.nullable,
        db_default: facts.db_default,
        ods_sheet: null,
        ods_column: field.label,
        ownership,
        unit: rule?.unit ?? "unitless",
        importer_behavior: IMPORTER_BEHAVIOR,
        historical_behavior: facts.historical_behavior,
        blank_becomes_default: facts.blank_becomes_default,
        comparable: ownership === "ODS_ENGINEERING_OWNED",
        reason,
      });
    }
  }
  return out.sort(
    (a, b) => a.table.localeCompare(b.table) || a.field.localeCompare(b.field),
  );
}

const REGISTRY_INDEX = new Map<string, NumericRegistryEntry>(
  numericRegistry().map((e) => [`${e.table}.${e.field}`, e]),
);

export function numericRegistryEntry(
  table: string | null,
  field: string | null,
): NumericRegistryEntry | undefined {
  if (!table || !field) return undefined;
  return REGISTRY_INDEX.get(`${table}.${field}`);
}

/** Is this key a numeric field at all, in any entity? */
export function isNumericField(field: EntityField): boolean {
  return field.kind === "number";
}

/* --------------------------------------------- tri-state numeric parsing */

export type NumericState =
  /** An explicit non-zero numeric value. */
  | "value"
  /** An explicit zero — never the same as blank. */
  | "zero"
  /** Nothing stated: blank cell, NULL, or an explicit "not applicable". */
  | "absent"
  /** Engineering notation that is not a number (TBD, ?, range, approximate). */
  | "non_numeric"
  /** A number whose unit cannot be interpreted deterministically. */
  | "ambiguous_unit"
  /**
   * Canonical split-phase / wye system-voltage notation (120/240, 120/208,
   * 277/480). This is a valid, fully-resolved engineering statement of TWO
   * nominal voltages — it is NOT a failed parse and must never be collapsed to
   * a single scalar. A scalar numeric column simply cannot represent it.
   */
  | "system_voltage";

export interface ParsedNumeric {
  state: NumericState;
  /** Normalized comparison value in the field's declared unit; null unless numeric. */
  value: number | null;
  /** Exactly what the source held, untouched. */
  raw: string;
  /** Normalized display form ("80 ft" -> "80"), or the preserved raw text. */
  normalized: string;
  /** Safe normalizations applied to reach `value`. */
  rules: string[];
  /** Why the value is not numeric / not interpretable. */
  note: string;
}

const NULLISH = new Set(["", "n/a", "na", "n.a.", "none", "null", "-", "—", "–"]);
const NON_NUMERIC_TOKENS = new Set([
  "tbd",
  "t.b.d.",
  "tbd?",
  "?",
  "??",
  "verify",
  "verify field",
  "field verify",
  "unknown",
  "unk",
  "tba",
  "see note",
  "see notes",
]);

const UNIT_TOKENS: Record<string, { unit: NumericUnit; scale: number }> = {
  v: { unit: "volt", scale: 1 },
  volt: { unit: "volt", scale: 1 },
  volts: { unit: "volt", scale: 1 },
  vac: { unit: "volt", scale: 1 },
  vdc: { unit: "volt", scale: 1 },
  a: { unit: "amp", scale: 1 },
  amp: { unit: "amp", scale: 1 },
  amps: { unit: "amp", scale: 1 },
  ampere: { unit: "amp", scale: 1 },
  amperes: { unit: "amp", scale: 1 },
  va: { unit: "volt_ampere", scale: 1 },
  kva: { unit: "volt_ampere", scale: 1000 },
  ft: { unit: "foot", scale: 1 },
  "ft.": { unit: "foot", scale: 1 },
  feet: { unit: "foot", scale: 1 },
  foot: { unit: "foot", scale: 1 },
  "'": { unit: "foot", scale: 1 },
  "%": { unit: "percent", scale: 1 },
  u: { unit: "rack_unit", scale: 1 },
  ru: { unit: "rack_unit", scale: 1 },
  ea: { unit: "count", scale: 1 },
  pcs: { unit: "count", scale: 1 },
};

const RANGE_RE = /\d\s*(?:-|–|—|\.\.|\bto\b|\bthru\b)\s*\d/;
const APPROX_RE = /(^|\s)(~|≈|±|\+\/-|approx\.?|about|est\.?)/;

/**
 * `120/240`, `120/240V`, `120/208 VAC 3Ø`, `277/480 v 3 phase` — canonical
 * notation for a multi-voltage system. The lower number is the line-to-neutral
 * voltage and the higher the line-to-line voltage.
 */
const SYSTEM_VOLTAGE_RE =
  /^(\d{2,4})\s*\/\s*(\d{2,4})\s*(?:v|vac|vdc|volt|volts)?\s*(1|3)?\s*(?:ø|Ø|ph|phase|-phase|phases|w|wire|-wire)?\s*(?:ø|Ø|ph|phase|wire|w)?\.?$/i;

export interface SystemVoltage {
  /** Lower nominal voltage — line to neutral (e.g. 120). */
  line_neutral: number;
  /** Higher nominal voltage — line to line (e.g. 240). */
  line_line: number;
  /** Phase count when the cell states it; null when unstated. */
  phases: number | null;
  /** Canonical redisplay, always "L-N/L-L". */
  canonical: string;
}

/**
 * Recognise canonical system-voltage notation. Returns null for anything else.
 * Never converts, never picks one of the two voltages.
 */
export function parseSystemVoltage(raw: unknown): SystemVoltage | null {
  const text = raw === null || raw === undefined ? "" : String(raw).replace(/\s+/g, " ").trim();
  const m = text.match(SYSTEM_VOLTAGE_RE);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return null;
  const lineNeutral = Math.min(a, b);
  const lineLine = Math.max(a, b);
  return {
    line_neutral: lineNeutral,
    line_line: lineLine,
    phases: m[3] ? Number(m[3]) : null,
    canonical: `${lineNeutral}/${lineLine}`,
  };
}

/**
 * Parse one numeric cell for a field with a declared unit. Explicit zero,
 * explicit value and "not stated" stay distinguishable, and no unit is ever
 * guessed: an unrecognised or foreign unit yields `ambiguous_unit`, and
 * descriptive text yields `non_numeric` — never an inferred number.
 */
export function parseNumericCell(raw: unknown, unit: NumericUnit): ParsedNumeric {
  const text = raw === null || raw === undefined ? "" : String(raw).replace(/\s+/g, " ").trim();
  const base: Omit<ParsedNumeric, "state" | "value" | "normalized"> = {
    raw: text,
    rules: [],
    note: "",
  };
  const lower = text.toLowerCase();

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return {
      ...base,
      state: raw === 0 ? "zero" : "value",
      value: raw,
      normalized: String(raw),
      note: raw === 0 ? "Explicit zero." : "Stored numeric value.",
    };
  }

  if (NULLISH.has(lower)) {
    return {
      ...base,
      state: "absent",
      value: null,
      normalized: "",
      note: lower === "" ? "Not stated (blank / NULL)." : `Stated as "${text}" — not applicable, no value.`,
    };
  }
  if (NON_NUMERIC_TOKENS.has(lower)) {
    return {
      ...base,
      state: "non_numeric",
      value: null,
      normalized: text,
      note: `Engineering notation "${text}" is an unresolved state, not a number. It must never become 0 or NULL.`,
    };
  }
  if (RANGE_RE.test(lower) && !/^-?\d/.test(lower.replace(/^[-–]/, "0"))) {
    // fallthrough guard; handled below
  }
  if (RANGE_RE.test(lower)) {
    return {
      ...base,
      state: "non_numeric",
      value: null,
      normalized: text,
      note: `"${text}" states a range, not a single engineering value.`,
    };
  }
  if (APPROX_RE.test(lower)) {
    return {
      ...base,
      state: "non_numeric",
      value: null,
      normalized: text,
      note: `"${text}" is approximate/tolerance notation, not an exact engineering value.`,
    };
  }

  // Canonical split-phase / wye notation on a voltage field: a resolved
  // engineering statement of two nominal voltages, not a failed parse. It is
  // never normalized to a scalar (120/240 is NOT 240).
  if (unit === "volt") {
    const sys = parseSystemVoltage(text);
    if (sys) {
      return {
        ...base,
        state: "system_voltage",
        value: null,
        normalized: sys.canonical,
        system_voltage: sys,
        note: `"${text}" is canonical system-voltage notation: ${sys.line_neutral} V line-to-neutral / ${sys.line_line} V line-to-line${sys.phases ? `, ${sys.phases}-phase` : ""}. It is fully resolved engineering data that a single scalar voltage column cannot represent; it is never reduced to ${sys.line_line}.`,
      };
    }
  }

  const rules: string[] = [];
  let work = lower;
  if (work.includes(",")) {
    work = work.replace(/,/g, "");
    rules.push("thousands_separator");
  }
  // Split the numeric head from whatever trails it.
  const m = work.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(.*)$/);
  if (!m) {
    return {
      ...base,
      state: "non_numeric",
      value: null,
      normalized: text,
      note: `"${text}" carries no leading numeric value; a number embedded in descriptive text is never read as an engineering quantity.`,
    };
  }
  let value = Number(m[1]);
  const trailer = m[2].trim();

  if (trailer) {
    // More than one unit-ish token (e.g. "80 ft 6 in", "120/240 V") is mixed
    // notation: preserve it, do not pick one.
    if (/\d/.test(trailer)) {
      return {
        ...base,
        state: "non_numeric",
        value: null,
        normalized: text,
        note: `"${text}" holds more than one numeric quantity; it is not a single value in ${unit}.`,
      };
    }
    const tokens = trailer.split(/\s+/).filter(Boolean);
    if (tokens.length > 1) {
      return {
        ...base,
        state: "non_numeric",
        value: null,
        normalized: text,
        note: `"${text}" is descriptive engineering text, not a bare ${unit} value.`,
      };
    }
    const token = tokens[0].replace(/[.]$/, (c) => c);
    const known = UNIT_TOKENS[token];
    if (!known || known.unit !== unit) {
      return {
        ...base,
        state: "ambiguous_unit",
        value: null,
        normalized: text,
        note: known
          ? `"${text}" is expressed in ${known.unit} but the field is declared ${unit}; no conversion is assumed.`
          : `Unit "${token}" in "${text}" is not a recognised unit for a ${unit} field; no conversion is assumed.`,
        rules,
      };
    }
    if (known.scale !== 1) {
      value = value * known.scale;
      rules.push(unit === "volt_ampere" ? "kva_to_va" : "unit_scale");
    }
    rules.push("strip_declared_unit");
  }

  if (!Number.isFinite(value)) {
    return { ...base, state: "non_numeric", value: null, normalized: text, note: "Not a finite number." };
  }

  return {
    ...base,
    rules,
    state: value === 0 ? "zero" : "value",
    value,
    normalized: String(value),
    note: value === 0 ? "Explicit zero." : "Explicit numeric value.",
  };
}

/** Numeric equality within engineering tolerance. 80 == 80.0 == "80 ft". */
export function sameNumeric(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) < 0.005;
}

/** Does this parse hold a number (including an explicit zero)? */
export function isExplicitNumber(p: ParsedNumeric): boolean {
  return p.state === "value" || p.state === "zero";
}
