/**
 * Load_Master Import Contract v2 — READ ONLY.
 *
 * A declarative contract that defines every one of the 41 physical Load_Master
 * columns by physical column number + exact header text. Nothing in this module
 * writes, and no field identity is ever decided from header text alone or from
 * what FarmOps currently contains.
 *
 * Binding rule: a contract column is only honoured when the workbook's physical
 * column at that position carries the declared exact header (or a declared
 * accepted spelling). Any other header text makes the column UNRESOLVED at
 * runtime — the contract never slides onto a neighbouring column.
 *
 * Tri-state rule: Y / N / TBD engineering concepts are represented losslessly
 * as a boolean-or-null destination value *plus* the verbatim canonical token
 * preserved under its source identity. TBD and blank are distinct states and
 * neither becomes true or false.
 */
import type { Sheet } from "@/lib/electrical-ods";
import {
  logicalCircuits,
  physicalLoad,
  type LoadRow,
  type GeneratorTier,
} from "@/lib/electrical-load-business-rules";

export const IMPORT_CONTRACT_VERSION = "load_master.contract.v2";

export type ImportAction =
  | "IMPORT_DIRECT"
  | "IMPORT_NORMALIZED"
  | "DERIVED_REPRESENTATION_DO_NOT_IMPORT"
  | "SCHEMA_EXTENSION_REQUIRED"
  | "LEGACY_PRESERVE"
  | "AS_BUILT_FIELD"
  | "IGNORE_WITH_REASON"
  | "UNRESOLVED";

export type ContractDataType =
  | "text"
  | "stable_id"
  | "integer"
  | "numeric"
  | "tri_state"
  | "enum"
  | "percent"
  | "date"
  | "derived_numeric";

export type ContractAuthority =
  | "engineering_design"
  | "field_observation"
  | "generated"
  | "shared";

export interface ContractColumn {
  /** 1-based physical column position on the canonical Load_Master sheet. */
  physical_column: number;
  /** Exact declared header text for that physical position. */
  exact_header: string;
  /** Additional exact spellings accepted at that same physical position. */
  accepted_headers?: string[];
  canonical_semantic: string;
  data_type: ContractDataType;
  /** Closed token vocabulary, or [] when the field is free text/numeric. */
  allowed_tokens: string[];
  /** FarmOps destination column, or null when there is no destination. */
  farmops_destination: string | null;
  transformation: string;
  authority: ContractAuthority;
  import_action: ImportAction;
  /**
   * Verbatim canonical text is preserved under this collision-safe capture key
   * so nothing is lost when the typed destination cannot hold every state.
   */
  preservation_key: string | null;
  reason?: string;
}

const TRI = ["Y", "N", "TBD", "(blank)"];

/** The contract. 41 physical columns, resolved by position + exact header. */
export const LOAD_MASTER_CONTRACT_V2: ContractColumn[] = [
  { physical_column: 1, exact_header: "Load ID", canonical_semantic: "load_id", data_type: "stable_id", allowed_tokens: [], farmops_destination: "load_id", transformation: "Trimmed. Never renamed or renumbered.", authority: "engineering_design", import_action: "IMPORT_DIRECT", preservation_key: "Load ID#1" },
  { physical_column: 2, exact_header: "Load Description", accepted_headers: ["Description"], canonical_semantic: "description", data_type: "text", allowed_tokens: [], farmops_destination: "description", transformation: "Verbatim text.", authority: "engineering_design", import_action: "IMPORT_DIRECT", preservation_key: "Load Description#2" },
  { physical_column: 3, exact_header: "Area", canonical_semantic: "area", data_type: "text", allowed_tokens: [], farmops_destination: "area", transformation: "Verbatim text.", authority: "engineering_design", import_action: "IMPORT_DIRECT", preservation_key: "Area#3" },
  { physical_column: 4, exact_header: "Grid", canonical_semantic: "grid", data_type: "text", allowed_tokens: [], farmops_destination: "grid", transformation: "Verbatim; non-grid artifacts (?, ??, NA) are preserved, never coerced.", authority: "engineering_design", import_action: "IMPORT_DIRECT", preservation_key: "Grid#4" },
  { physical_column: 5, exact_header: "D/S", accepted_headers: ["D / S", "Dedicated / Shared"], canonical_semantic: "dedicated_shared", data_type: "tri_state", allowed_tokens: ["D", "S", "Dedicated", "Shared", "TBD", "(blank)"], farmops_destination: "dedicated_shared", transformation: "Verbatim token to dedicated_shared; the dedicated boolean is set only for an explicit D or S. TBD/blank stay unresolved (BR-003).", authority: "engineering_design", import_action: "IMPORT_DIRECT", preservation_key: "D/S#5" },
  { physical_column: 6, exact_header: "Count", accepted_headers: ["Qty"], canonical_semantic: "count", data_type: "integer", allowed_tokens: [], farmops_destination: "count", transformation: "Integer coercion; verbatim text preserved.", authority: "engineering_design", import_action: "IMPORT_NORMALIZED", preservation_key: "Count#6" },
  { physical_column: 7, exact_header: "Equipment / Model", canonical_semantic: "equipment_model", data_type: "text", allowed_tokens: [], farmops_destination: "equipment_model", transformation: "Verbatim text.", authority: "engineering_design", import_action: "IMPORT_DIRECT", preservation_key: "Equipment / Model#7" },
  { physical_column: 8, exact_header: "Location", canonical_semantic: "location", data_type: "text", allowed_tokens: [], farmops_destination: "location", transformation: "Verbatim text.", authority: "engineering_design", import_action: "IMPORT_DIRECT", preservation_key: "Location#8" },
  { physical_column: 9, exact_header: "Circuit Group ID", canonical_semantic: "circuit_group_id", data_type: "text", allowed_tokens: [], farmops_destination: "circuit_group_ref", transformation: "Authoritative Circuit Group ID. Text preserved; circuit_group_uuid is set only on an exact single stable-ID match, otherwise left null and reported.", authority: "engineering_design", import_action: "IMPORT_DIRECT", preservation_key: "Circuit Group ID#9" },
  { physical_column: 10, exact_header: "Circuit Group Description", canonical_semantic: "circuit_group_description", data_type: "text", allowed_tokens: [], farmops_destination: null, transformation: "Belongs to the circuit-group record, not the load row. Preserved verbatim on the load under its collision-safe source identity.", authority: "engineering_design", import_action: "LEGACY_PRESERVE", preservation_key: "Circuit Group Description#10", reason: "The load record has no description column for its circuit group; the group entity owns it." },
  { physical_column: 11, exact_header: "Suggested Panel", canonical_semantic: "suggested_panel", data_type: "text", allowed_tokens: [], farmops_destination: "suggested_panel", transformation: "Verbatim text. Design intent only — never promoted to an installed panel assignment or to PNL-FS-CRIT.", authority: "engineering_design", import_action: "IMPORT_DIRECT", preservation_key: "Suggested Panel#11" },
  { physical_column: 12, exact_header: "Source Circuit", canonical_semantic: "source_circuit", data_type: "text", allowed_tokens: [], farmops_destination: "source_circuit", transformation: "Legacy text preserved read-only.", authority: "engineering_design", import_action: "IMPORT_DIRECT", preservation_key: "Source Circuit#12" },
  { physical_column: 13, exact_header: "Circuit Rating Amps", accepted_headers: ["Circuit Rating (A)"], canonical_semantic: "circuit_rating_amps", data_type: "numeric", allowed_tokens: [], farmops_destination: null, transformation: "Documented branch-circuit rating. FarmOps has no circuit_rating_amps column on the load record; value preserved verbatim pending a schema extension. Never written into amps, installed_ocp_rating or design_circuit_ampacity.", authority: "engineering_design", import_action: "SCHEMA_EXTENSION_REQUIRED", preservation_key: "Circuit Rating Amps#13", reason: "No load-level circuit-rating destination exists. BR-002 planning value, not a measured current." },
  { physical_column: 14, exact_header: "Volts", canonical_semantic: "volts", data_type: "numeric", allowed_tokens: [], farmops_destination: "volts", transformation: 'Numeric coercion; "120/240V" keeps the higher nominal. Verbatim text preserved.', authority: "engineering_design", import_action: "IMPORT_NORMALIZED", preservation_key: "Volts#14" },
  { physical_column: 15, exact_header: "Amps", canonical_semantic: "amps", data_type: "numeric", allowed_tokens: [], farmops_destination: "amps", transformation: 'Numeric coercion with unit stripping ("20 A" -> 20). Amp semantics stay in amps_semantic and are not inferred here.', authority: "engineering_design", import_action: "IMPORT_NORMALIZED", preservation_key: "Amps#15" },
  { physical_column: 16, exact_header: "Connected VA", canonical_semantic: "connected_va", data_type: "numeric", allowed_tokens: [], farmops_destination: "connected_va", transformation: "Sole authority for connected_va. Numeric coercion only.", authority: "engineering_design", import_action: "IMPORT_DIRECT", preservation_key: "Connected VA#16" },
  { physical_column: 17, exact_header: "Connected kVA", canonical_semantic: "connected_kva_display", data_type: "derived_numeric", allowed_tokens: [], farmops_destination: null, transformation: "Derived representation of column 16 (VA / 1000). Never imported and never a second connected_va authority; recomputed for display. Verbatim text preserved for audit.", authority: "generated", import_action: "DERIVED_REPRESENTATION_DO_NOT_IMPORT", preservation_key: "Connected kVA#17", reason: "Importing it would create a competing connected-load authority." },
  { physical_column: 18, exact_header: "Demand Basis", canonical_semantic: "demand_basis", data_type: "text", allowed_tokens: [], farmops_destination: "demand_basis", transformation: 'Verbatim text. "Circuit Capacity Only" is never converted from breaker amps into VA.', authority: "engineering_design", import_action: "IMPORT_DIRECT", preservation_key: "Demand Basis#18" },
  { physical_column: 19, exact_header: "Critical", canonical_semantic: "critical", data_type: "tri_state", allowed_tokens: TRI, farmops_destination: "critical", transformation: "Y -> true, N -> false, TBD/blank -> null. Verbatim token preserved so TBD stays distinguishable from blank. Sole source of criticality (CRIT-1).", authority: "engineering_design", import_action: "IMPORT_NORMALIZED", preservation_key: "Critical#19" },
  { physical_column: 20, exact_header: "Future", canonical_semantic: "future", data_type: "tri_state", allowed_tokens: TRI, farmops_destination: "future", transformation: "Y -> true, N -> false, TBD/blank -> null with the verbatim token preserved. Informational only (STATUS-1).", authority: "engineering_design", import_action: "IMPORT_NORMALIZED", preservation_key: "Future#20" },
  { physical_column: 21, exact_header: "Source / Reference", canonical_semantic: "source_reference", data_type: "text", allowed_tokens: [], farmops_destination: "source_reference", transformation: "Verbatim text (drawing / catalogue citation).", authority: "engineering_design", import_action: "IMPORT_DIRECT", preservation_key: "Source / Reference#21" },
  { physical_column: 22, exact_header: "Notes", canonical_semantic: "notes", data_type: "text", allowed_tokens: [], farmops_destination: "notes", transformation: "Verbatim engineering prose; FarmOps appends dated field notes instead of replacing it.", authority: "shared", import_action: "IMPORT_DIRECT", preservation_key: "Notes#22" },
  { physical_column: 23, exact_header: "Backup Eligible", canonical_semantic: "backup_eligible", data_type: "tri_state", allowed_tokens: TRI, farmops_destination: "backup_eligible", transformation: "Y -> true, N -> false, TBD/blank -> null with the verbatim token preserved. Eligibility is never derived from Backup Priority or from a panel name.", authority: "engineering_design", import_action: "IMPORT_NORMALIZED", preservation_key: "Backup Eligible#23" },
  { physical_column: 24, exact_header: "Backup Priority", canonical_semantic: "backup_priority", data_type: "enum", allowed_tokens: ["Critical", "Nice to Have", "Stretch", "Never", "TBD", "(blank)"], farmops_destination: "backup_priority", transformation: "Verbatim token. Generator tier is derived at read time (GEN-1); an out-of-vocabulary token is preserved and reported as REVIEW, never remapped.", authority: "engineering_design", import_action: "IMPORT_DIRECT", preservation_key: "Backup Priority#24" },
  { physical_column: 25, exact_header: "Backup Panel", canonical_semantic: "backup_panel", data_type: "text", allowed_tokens: [], farmops_destination: "backup_panel", transformation: "Verbatim text. A separate concept from Suggested Panel and never auto-mapped to PNL-FS-CRIT (PANEL-1).", authority: "engineering_design", import_action: "IMPORT_DIRECT", preservation_key: "Backup Panel#25" },
  { physical_column: 26, exact_header: "Generator Start Class", canonical_semantic: "generator_start_class", data_type: "text", allowed_tokens: [], farmops_destination: null, transformation: "No FarmOps load column exists. Preserved verbatim; reported as a schema gap, never forced into a neighbouring field.", authority: "engineering_design", import_action: "SCHEMA_EXTENSION_REQUIRED", preservation_key: "Generator Start Class#26", reason: "electrical_loads has no generator_start_class column." },
  { physical_column: 27, exact_header: "Generator Start Amps", canonical_semantic: "generator_start_amps", data_type: "numeric", allowed_tokens: [], farmops_destination: null, transformation: "No FarmOps load column exists. Preserved verbatim including TBD; never coerced into amps or MCA.", authority: "engineering_design", import_action: "SCHEMA_EXTENSION_REQUIRED", preservation_key: "Generator Start Amps#27", reason: "electrical_loads has no generator_start_amps column." },
  { physical_column: 28, exact_header: "Continuous Load", canonical_semantic: "continuous_load", data_type: "tri_state", allowed_tokens: TRI, farmops_destination: "continuous_load", transformation: "Y -> true, N -> false, TBD/blank -> null with the verbatim token preserved (PRESERVE-1).", authority: "engineering_design", import_action: "IMPORT_NORMALIZED", preservation_key: "Continuous Load#28" },
  { physical_column: 29, exact_header: "Demand VA", canonical_semantic: "demand_va", data_type: "numeric", allowed_tokens: [], farmops_destination: "demand_va", transformation: "Numeric coercion when a number is stated; TBD/blank stay null with the verbatim token preserved. Never computed from amps (VA-2).", authority: "engineering_design", import_action: "IMPORT_NORMALIZED", preservation_key: "Demand VA#29" },
  { physical_column: 30, exact_header: "Phase", canonical_semantic: "phase", data_type: "text", allowed_tokens: [], farmops_destination: "phase", transformation: "Verbatim text including TBD. Never inferred from volts.", authority: "engineering_design", import_action: "IMPORT_DIRECT", preservation_key: "Phase#30" },
  { physical_column: 31, exact_header: "Load Shed Group", canonical_semantic: "load_shed_group", data_type: "text", allowed_tokens: [], farmops_destination: "load_shed_group", transformation: "Verbatim text.", authority: "engineering_design", import_action: "IMPORT_DIRECT", preservation_key: "Load Shed Group#31" },
  { physical_column: 32, exact_header: "Circuit Group ID", canonical_semantic: "circuit_group_id_legacy", data_type: "text", allowed_tokens: [], farmops_destination: null, transformation: "Second/legacy occurrence of the Circuit Group ID header. Column 9 remains the authority; this column is preserved verbatim under its collision-safe key and is never written to circuit_group_ref.", authority: "engineering_design", import_action: "LEGACY_PRESERVE", preservation_key: "Circuit Group ID#32", reason: "Duplicate header — identity resolved by physical position, not header text." },
  { physical_column: 33, exact_header: "Circuit Group Description", canonical_semantic: "circuit_group_description_legacy", data_type: "text", allowed_tokens: [], farmops_destination: null, transformation: "Second/legacy occurrence. Preserved verbatim under its collision-safe key.", authority: "engineering_design", import_action: "LEGACY_PRESERVE", preservation_key: "Circuit Group Description#33", reason: "Duplicate header — identity resolved by physical position." },
  { physical_column: 34, exact_header: "Existing Panel", canonical_semantic: "existing_panel", data_type: "text", allowed_tokens: [], farmops_destination: null, transformation: "As-built observation. FarmOps owns installed panel assignment relationally (breaker positions / circuit groups); the workbook text is preserved, never used to create a link.", authority: "field_observation", import_action: "AS_BUILT_FIELD", preservation_key: "Existing Panel#34" },
  { physical_column: 35, exact_header: "Existing Circuit", canonical_semantic: "existing_circuit", data_type: "text", allowed_tokens: [], farmops_destination: null, transformation: "As-built observation preserved verbatim; breaker/circuit links stay relational and FarmOps-owned.", authority: "field_observation", import_action: "AS_BUILT_FIELD", preservation_key: "Existing Circuit#35" },
  { physical_column: 36, exact_header: "Installation Status", accepted_headers: ["Status", "Install Status"], canonical_semantic: "install_status", data_type: "text", allowed_tokens: [], farmops_destination: "install_status", transformation: "Verbatim text. Informational; never removes a critical design load from sizing (STATUS-1). FarmOps field records supersede it when newer.", authority: "field_observation", import_action: "AS_BUILT_FIELD", preservation_key: "Installation Status#36" },
  { physical_column: 37, exact_header: "Install Date", canonical_semantic: "install_date", data_type: "date", allowed_tokens: [], farmops_destination: null, transformation: "As-built date preserved verbatim; FarmOps install progress owns installation dates.", authority: "field_observation", import_action: "AS_BUILT_FIELD", preservation_key: "Install Date#37" },
  { physical_column: 38, exact_header: "Installed By", canonical_semantic: "installed_by", data_type: "text", allowed_tokens: [], farmops_destination: null, transformation: "As-built attribution preserved verbatim.", authority: "field_observation", import_action: "AS_BUILT_FIELD", preservation_key: "Installed By#38" },
  { physical_column: 39, exact_header: "Calculated Complete %", accepted_headers: ["Complete %", "% Complete", "Complete"], canonical_semantic: "completion_percent", data_type: "percent", allowed_tokens: [], farmops_destination: "completion_percent", transformation: "Spreadsheet-calculated percentage. Stored as a number (0.25 / 25% -> 25) and recomputable from installation state; verbatim text preserved.", authority: "generated", import_action: "IMPORT_NORMALIZED", preservation_key: "Calculated Complete %#39" },
  { physical_column: 40, exact_header: "Label Status", canonical_semantic: "label_status", data_type: "text", allowed_tokens: [], farmops_destination: "label_status", transformation: "Verbatim text; FarmOps label workflow may supersede it.", authority: "field_observation", import_action: "AS_BUILT_FIELD", preservation_key: "Label Status#40" },
  { physical_column: 41, exact_header: "Installation Notes", canonical_semantic: "installation_notes", data_type: "text", allowed_tokens: [], farmops_destination: null, transformation: "As-built prose preserved verbatim under its own source identity so it never overwrites engineering Notes (column 22).", authority: "field_observation", import_action: "AS_BUILT_FIELD", preservation_key: "Installation Notes#41" },
];

export const CONTRACT_COLUMN_COUNT = LOAD_MASTER_CONTRACT_V2.length;

/* ------------------------------------------------------------- tri-state */

export type TriStateName = "Y" | "N" | "TBD" | "BLANK" | "OUT_OF_VOCABULARY";

export interface TriStateValue {
  /** Verbatim canonical token, never rewritten. */
  token: string;
  state: TriStateName;
  /** Typed destination value; TBD and blank are both null but distinguishable. */
  bool: boolean | null;
  /** True when token + state together restore the canonical meaning exactly. */
  lossless: boolean;
}

const Y_TOKENS = new Set(["y", "yes", "true", "t", "1", "x", "d", "dedicated"]);
const N_TOKENS = new Set(["n", "no", "false", "f", "0", "s", "shared"]);

/** Lossless tri-state representation: boolean-or-null plus the verbatim token. */
export function triState(raw: unknown): TriStateValue {
  const token = raw == null ? "" : String(raw).trim();
  const low = token.toLowerCase();
  if (!token) return { token: "", state: "BLANK", bool: null, lossless: true };
  if (low === "tbd") return { token, state: "TBD", bool: null, lossless: true };
  if (Y_TOKENS.has(low)) return { token, state: "Y", bool: true, lossless: true };
  if (N_TOKENS.has(low)) return { token, state: "N", bool: false, lossless: true };
  return { token, state: "OUT_OF_VOCABULARY", bool: null, lossless: true };
}

/* --------------------------------------------------------------- binding */

export type BindingStatus =
  | "HEADER_CONFIRMED"
  | "HEADER_ACCEPTED_VARIANT"
  | "HEADER_MISMATCH"
  | "COLUMN_ABSENT";

export interface BoundColumn extends ContractColumn {
  /** Header text actually present at that physical position. */
  observed_header: string;
  binding_status: BindingStatus;
  /** Effective action after binding: UNRESOLVED when the header does not bind. */
  effective_action: ImportAction;
}

export interface ContractBinding {
  sheet: string;
  header_row: number;
  observed_column_count: number;
  expected_column_count: number;
  columns: BoundColumn[];
  /** Populated physical columns beyond the contract's 41. */
  extra_populated_columns: { physical_column: number; observed_header: string }[];
  bound: number;
  unresolved: number;
}

const eqHeader = (a: string, b: string): boolean =>
  a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");

export function bindContract(sheet: Sheet, headerRow: number): ContractBinding {
  const header = sheet.rows[headerRow] ?? [];
  const width = Math.max(header.length, ...sheet.rows.map((r) => r.length), 0);

  const columns: BoundColumn[] = LOAD_MASTER_CONTRACT_V2.map((c) => {
    const observed = (header[c.physical_column - 1] ?? "").trim();
    let binding_status: BindingStatus;
    if (c.physical_column > width) binding_status = "COLUMN_ABSENT";
    else if (eqHeader(observed, c.exact_header)) binding_status = "HEADER_CONFIRMED";
    else if ((c.accepted_headers ?? []).some((h) => eqHeader(observed, h)))
      binding_status = "HEADER_ACCEPTED_VARIANT";
    else binding_status = "HEADER_MISMATCH";
    return {
      ...c,
      observed_header: observed,
      binding_status,
      effective_action:
        binding_status === "HEADER_CONFIRMED" || binding_status === "HEADER_ACCEPTED_VARIANT"
          ? c.import_action
          : "UNRESOLVED",
    };
  });

  const extra_populated_columns: { physical_column: number; observed_header: string }[] = [];
  for (let i = CONTRACT_COLUMN_COUNT; i < width; i++) {
    const populated = sheet.rows.some((r, idx) => idx !== headerRow && String(r[i] ?? "").trim());
    if (populated || (header[i] ?? "").trim()) {
      extra_populated_columns.push({
        physical_column: i + 1,
        observed_header: (header[i] ?? "").trim(),
      });
    }
  }

  return {
    sheet: sheet.name,
    header_row: headerRow + 1,
    observed_column_count: width,
    expected_column_count: CONTRACT_COLUMN_COUNT,
    columns,
    extra_populated_columns,
    bound: columns.filter((c) => c.effective_action !== "UNRESOLVED").length,
    unresolved: columns.filter((c) => c.effective_action === "UNRESOLVED").length,
  };
}

/* ------------------------------------------------------------ coercion */

const numeric = (raw: string): number | null => {
  const s = raw.replace(/,/g, "").replace(/[^0-9.\-eE]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const percent = (raw: string): number | null => {
  const n = numeric(raw);
  if (n == null) return null;
  return raw.includes("%") || n > 1 ? n : Math.round(n * 1000) / 10;
};

export interface CoercedValue {
  /** Typed destination value, or null when no destination value is produced. */
  value: unknown;
  /** True when the typed value renders differently from the canonical token. */
  normalization_only: boolean;
  /** True when the canonical meaning survives (destination and/or capture). */
  representable: boolean;
}

/** Coerce one canonical cell under its bound contract column. */
export function coerceCell(column: BoundColumn, raw: string): CoercedValue {
  const token = raw.trim();
  const captured = Boolean(column.preservation_key);
  if (column.effective_action === "UNRESOLVED") {
    return { value: null, normalization_only: false, representable: false };
  }
  if (!token) return { value: null, normalization_only: false, representable: true };
  if (!column.farmops_destination) {
    return { value: null, normalization_only: false, representable: captured };
  }
  switch (column.data_type) {
    case "tri_state": {
      const t = triState(token);
      if (column.farmops_destination === "dedicated_shared") {
        return { value: token, normalization_only: false, representable: true };
      }
      return {
        value: t.bool,
        normalization_only: String(t.bool) !== token.toLowerCase(),
        representable: t.bool !== null || captured,
      };
    }
    case "integer":
    case "numeric": {
      const n = numeric(token);
      return {
        value: n,
        normalization_only: n != null && String(n) !== token,
        representable: n != null || captured,
      };
    }
    case "percent": {
      const n = percent(token);
      return {
        value: n,
        normalization_only: n != null && String(n) !== token,
        representable: n != null || captured,
      };
    }
    default:
      return { value: token, normalization_only: false, representable: true };
  }
}

/* --------------------------------------------------- re-import simulation */

export interface FieldSimulation {
  physical_column: number;
  exact_header: string;
  field: string;
  import_action: ImportAction;
  source_populated: number;
  representable: number;
  would_import: number;
  normalization_only: number;
  schema_blocked: number;
  unresolved: number;
  semantic_loss: number;
  note: string;
}

export interface SimulatedRow {
  stable_id: string;
  /** FarmOps-shaped record produced by Contract v2. */
  record: LoadRow;
  /** Verbatim canonical capture, keyed by collision-safe source identity. */
  captured: Record<string, string>;
}

export interface RuleSummary {
  physical_rows: number;
  critical_physical_rows: number;
  logical_circuits: number;
  critical_logical_circuits: number;
  unresolved_shared_circuits: number;
  tier_counts: Record<GeneratorTier, number>;
  planned_circuits_by_panel: { panel: string; circuits: number }[];
}

export interface ContractSimulation {
  contract_version: string;
  binding: ContractBinding;
  row_count: number;
  fields: FieldSimulation[];
  totals: {
    source_populated: number;
    representable: number;
    would_import: number;
    normalization_only: number;
    schema_blocked: number;
    unresolved: number;
    semantic_loss: number;
  };
  accepted: boolean;
  rows: SimulatedRow[];
  simulated_rules: RuleSummary;
  canonical_rules: RuleSummary;
  rule_deltas: { metric: string; simulated: string; canonical: string; matches: boolean }[];
  reproduces_canonical: boolean;
}

function emptyTiers(): Record<GeneratorTier, number> {
  return { REQUIRED: 0, "OPTIONAL-1": 0, "OPTIONAL-2": 0, EXCLUDE: 0, REVIEW: 0 };
}

/** Business-rule summary computed from load rows — no expected values baked in. */
export function summarizeRules(rows: LoadRow[]): RuleSummary {
  const physical = rows.map(physicalLoad);
  const circuits = logicalCircuits(rows);
  const tier_counts = emptyTiers();
  for (const p of physical) tier_counts[p.tier] += 1;
  const byPanel = new Map<string, number>();
  for (const c of circuits) {
    if (!c.countsAsCircuit) continue;
    const panel = c.loads[0]?.suggestedPanel ?? "NOT IN RECORD";
    byPanel.set(panel, (byPanel.get(panel) ?? 0) + 1);
  }
  return {
    physical_rows: physical.length,
    critical_physical_rows: physical.filter((p) => p.criticality === "CRITICAL").length,
    logical_circuits: circuits.filter((c) => c.countsAsCircuit).length,
    critical_logical_circuits: circuits.filter((c) => c.countsAsCircuit && c.includesCritical)
      .length,
    unresolved_shared_circuits: circuits.filter((c) => c.kind === "UNRESOLVED").length,
    tier_counts,
    planned_circuits_by_panel: [...byPanel.entries()]
      .map(([panel, circuits]) => ({ panel, circuits }))
      .sort((a, b) => a.panel.localeCompare(b.panel)),
  };
}

/**
 * Independent canonical-derived rows: built by locating each business-rule field
 * by its canonical semantic in the contract and reading that physical column
 * directly from the worksheet. It shares no projection code with the simulated
 * import path, so agreement between the two is evidence, not a tautology.
 */
export function canonicalRuleRows(
  sheet: Sheet,
  binding: ContractBinding,
  odsRows: { sourceRow: number; stableId: string }[],
): LoadRow[] {
  const colFor = (semantic: string): BoundColumn | undefined =>
    binding.columns.find((c) => c.canonical_semantic === semantic);
  const read = (rowIdx: number, semantic: string): string => {
    const col = colFor(semantic);
    if (!col || col.effective_action === "UNRESOLVED") return "";
    return String(sheet.rows[rowIdx]?.[col.physical_column - 1] ?? "").trim();
  };
  return odsRows.map((r) => {
    const critical = triState(read(r.sourceRow, "critical"));
    const continuous = triState(read(r.sourceRow, "continuous_load"));
    const future = triState(read(r.sourceRow, "future"));
    return {
      load_id: r.stableId,
      description: read(r.sourceRow, "description"),
      area: read(r.sourceRow, "area"),
      suggested_panel: read(r.sourceRow, "suggested_panel"),
      backup_panel: read(r.sourceRow, "backup_panel"),
      backup_priority: read(r.sourceRow, "backup_priority"),
      dedicated_shared: read(r.sourceRow, "dedicated_shared"),
      circuit_group_ref: read(r.sourceRow, "circuit_group_id"),
      critical: critical.bool ?? critical.token,
      continuous_load: continuous.bool ?? continuous.token,
      future: future.bool ?? future.token,
      phase: read(r.sourceRow, "phase"),
      demand_basis: read(r.sourceRow, "demand_basis"),
      demand_va: read(r.sourceRow, "demand_va"),
      connected_va: read(r.sourceRow, "connected_va"),
      circuit_rating_amps: read(r.sourceRow, "circuit_rating_amps"),
      install_status: read(r.sourceRow, "install_status"),
      generator_start_class: read(r.sourceRow, "generator_start_class"),
      generator_start_amps: read(r.sourceRow, "generator_start_amps"),
    } satisfies LoadRow;
  });
}

export interface SimulationInput {
  sheet: Sheet;
  headerRow: number;
  /** 0-based worksheet row index + stable ID for each canonical data row. */
  odsRows: { sourceRow: number; stableId: string }[];
}

/** Simulate a complete re-import of every canonical row under Contract v2. */
export function simulateContractReimport(input: SimulationInput): ContractSimulation {
  const { sheet, headerRow, odsRows } = input;
  const binding = bindContract(sheet, headerRow);

  const rows: SimulatedRow[] = odsRows.map((r) => ({
    stable_id: r.stableId,
    record: { load_id: r.stableId } as LoadRow,
    captured: {},
  }));

  const fields: FieldSimulation[] = binding.columns.map((col) => {
    const stat: FieldSimulation = {
      physical_column: col.physical_column,
      exact_header: col.exact_header,
      field: col.canonical_semantic,
      import_action: col.effective_action,
      source_populated: 0,
      representable: 0,
      would_import: 0,
      normalization_only: 0,
      schema_blocked: 0,
      unresolved: 0,
      semantic_loss: 0,
      note: "",
    };

    odsRows.forEach((r, idx) => {
      const raw = String(sheet.rows[r.sourceRow]?.[col.physical_column - 1] ?? "").trim();
      if (!raw) return;
      stat.source_populated += 1;
      const out = coerceCell(col, raw);
      if (col.preservation_key && col.effective_action !== "UNRESOLVED") {
        rows[idx].captured[col.preservation_key] = raw;
      }
      if (out.representable) stat.representable += 1;
      else stat.semantic_loss += 1;
      if (col.effective_action === "UNRESOLVED") stat.unresolved += 1;
      if (col.effective_action === "SCHEMA_EXTENSION_REQUIRED") stat.schema_blocked += 1;
      if (out.normalization_only) stat.normalization_only += 1;
      if (col.farmops_destination && out.value !== null && col.effective_action !== "UNRESOLVED") {
        stat.would_import += 1;
        (rows[idx].record as Record<string, unknown>)[col.farmops_destination] = out.value;
      }
      // Tri-state columns carry their verbatim token alongside the boolean so
      // TBD stays distinguishable from blank in the projected record.
      if (col.data_type === "tri_state" && col.farmops_destination) {
        (rows[idx].record as Record<string, unknown>)[`${col.farmops_destination}_token`] = raw;
      }
    });

    stat.note =
      col.effective_action === "UNRESOLVED"
        ? `Physical column ${col.physical_column} carries "${col.observed_header || "(blank)"}", not "${col.exact_header}". Nothing is imported and the values are counted as semantic loss until the binding is resolved.`
        : col.effective_action === "SCHEMA_EXTENSION_REQUIRED"
          ? `No FarmOps destination column. Values preserved verbatim under ${col.preservation_key}; a schema extension is required before repair.`
          : col.effective_action === "DERIVED_REPRESENTATION_DO_NOT_IMPORT"
            ? "Derived representation; recomputed rather than imported, verbatim text retained for audit."
            : col.effective_action === "LEGACY_PRESERVE" || col.effective_action === "AS_BUILT_FIELD"
              ? `Preserved verbatim under ${col.preservation_key}.`
              : `Bound to ${col.farmops_destination}.`;
    return stat;
  });

  const sum = (k: keyof FieldSimulation): number =>
    fields.reduce((a, f) => a + (typeof f[k] === "number" ? (f[k] as number) : 0), 0);

  const simulated_rules = summarizeRules(rows.map((r) => r.record));
  const canonical_rules = summarizeRules(canonicalRuleRows(sheet, binding, odsRows));

  const metric = (name: string, a: unknown, b: unknown) => ({
    metric: name,
    simulated: JSON.stringify(a),
    canonical: JSON.stringify(b),
    matches: JSON.stringify(a) === JSON.stringify(b),
  });
  const rule_deltas = [
    metric("physical_rows", simulated_rules.physical_rows, canonical_rules.physical_rows),
    metric(
      "critical_physical_rows",
      simulated_rules.critical_physical_rows,
      canonical_rules.critical_physical_rows,
    ),
    metric("logical_circuits", simulated_rules.logical_circuits, canonical_rules.logical_circuits),
    metric(
      "critical_logical_circuits",
      simulated_rules.critical_logical_circuits,
      canonical_rules.critical_logical_circuits,
    ),
    metric(
      "unresolved_shared_circuits",
      simulated_rules.unresolved_shared_circuits,
      canonical_rules.unresolved_shared_circuits,
    ),
    metric("tier_counts", simulated_rules.tier_counts, canonical_rules.tier_counts),
    metric(
      "planned_circuits_by_panel",
      simulated_rules.planned_circuits_by_panel,
      canonical_rules.planned_circuits_by_panel,
    ),
  ];

  const totals = {
    source_populated: sum("source_populated"),
    representable: sum("representable"),
    would_import: sum("would_import"),
    normalization_only: sum("normalization_only"),
    schema_blocked: sum("schema_blocked"),
    unresolved: sum("unresolved"),
    semantic_loss: sum("semantic_loss"),
  };

  return {
    contract_version: IMPORT_CONTRACT_VERSION,
    binding,
    row_count: odsRows.length,
    fields,
    totals,
    accepted: totals.semantic_loss === 0,
    rows,
    simulated_rules,
    canonical_rules,
    rule_deltas,
    reproduces_canonical: rule_deltas.every((d) => d.matches),
  };
}

/* ------------------------------------------------------------------ CSV */

const csvCell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function contractCsv(binding: ContractBinding): string {
  const lines = [
    "physical_column,exact_header,observed_header,canonical_semantic,data_type,allowed_tokens,farmops_destination,transformation,authority,import_action,binding_status,effective_action,preservation_key",
  ];
  for (const c of binding.columns) {
    lines.push(
      [
        String(c.physical_column),
        c.exact_header,
        c.observed_header,
        c.canonical_semantic,
        c.data_type,
        c.allowed_tokens.join(" | "),
        c.farmops_destination ?? "(none)",
        c.transformation,
        c.authority,
        c.import_action,
        c.binding_status,
        c.effective_action,
        c.preservation_key ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

export function simulationCsv(sim: ContractSimulation): string {
  const lines = [
    "field,physical_column,import_action,source_populated,representable,would_import,normalization_only,schema_blocked,unresolved,semantic_loss,note",
  ];
  for (const f of sim.fields) {
    lines.push(
      [
        f.field,
        String(f.physical_column),
        f.import_action,
        String(f.source_populated),
        String(f.representable),
        String(f.would_import),
        String(f.normalization_only),
        String(f.schema_blocked),
        String(f.unresolved),
        String(f.semantic_loss),
        f.note,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}
