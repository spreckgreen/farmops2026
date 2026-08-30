// Phase 4.3 — ODS -> FarmOps field mapping matrix.
//
// This is the coverage contract between the canonical engineering workbook
// (BosteadFarmsBuildDocs/documents/VOL-01_Electrical/source/data/PremoFarmElectrical.ods)
// and the normalized FarmOps electrical model. Every meaningful workbook field
// is classified exactly once; nothing is left unexplained.
//
// The workbook remains the engineering system of record: `authority` records who
// owns each value, not who may display it.

export const MAPPING_CLASSES = [
  "directly_mapped",
  "derived",
  "display_only",
  "obsolete",
  "intentionally_excluded",
] as const;
export type MappingClass = (typeof MAPPING_CLASSES)[number];

export const MAPPING_CLASS_LABELS: Record<MappingClass, string> = {
  directly_mapped: "Directly mapped",
  derived: "Derived",
  display_only: "Display only",
  obsolete: "Obsolete",
  intentionally_excluded: "Intentionally excluded",
};

export type MappingAuthority =
  | "engineering_design"
  | "farmops_as_built"
  | "shared"
  | "generated";

export type MappingCoverage = "complete" | "partial" | "not_modelled";

export interface FieldMapRow {
  /** Workbook worksheet name. */
  worksheet: string;
  /** Column / field as it appears in the workbook. */
  field: string;
  classification: MappingClass;
  /** `table.column`, or a plain description for non-column destinations. */
  farmops: string;
  authority: MappingAuthority;
  /** How the value is transformed on the way in (or why it is not). */
  transformation: string;
  coverage: MappingCoverage;
  notes?: string;
}

const eng: MappingAuthority = "engineering_design";
const field: MappingAuthority = "farmops_as_built";

export const FIELD_MAP: FieldMapRow[] = [
  // ------------------------------------------------------------- Load_Master
  { worksheet: "Load_Master", field: "Load ID", classification: "directly_mapped", farmops: "electrical_loads.load_id", authority: eng, transformation: "Trimmed; validated against the building prefix convention (FS/PH/BL-### , HSE-##). Never renamed.", coverage: "complete" },
  { worksheet: "Load_Master", field: "Load Description", classification: "directly_mapped", farmops: "electrical_loads.description", authority: eng, transformation: "Verbatim text.", coverage: "complete" },
  { worksheet: "Load_Master", field: "Area", classification: "directly_mapped", farmops: "electrical_loads.area", authority: eng, transformation: "Verbatim text.", coverage: "complete" },
  { worksheet: "Load_Master", field: "Grid", classification: "directly_mapped", farmops: "electrical_loads.grid", authority: eng, transformation: "Validated as a grid cell (A6, B12). A non-grid value is refused on import and reported, never coerced.", coverage: "complete" },
  { worksheet: "Load_Master", field: "Location", classification: "directly_mapped", farmops: "electrical_loads.location", authority: eng, transformation: "Verbatim text.", coverage: "complete" },
  { worksheet: "Load_Master", field: "Source Circuit", classification: "directly_mapped", farmops: "electrical_loads.source_circuit (legacy text) + circuit_group_uuid (relational)", authority: eng, transformation: "Text preserved read-only; the FK is set only on an exact single stable-ID match, otherwise left null and reported in QA.", coverage: "complete" },
  { worksheet: "Load_Master", field: "Circuit Group ID", classification: "directly_mapped", farmops: "electrical_loads.circuit_group_ref + circuit_group_uuid", authority: eng, transformation: "Exact-match FK resolution only.", coverage: "complete" },
  { worksheet: "Load_Master", field: "Amps", classification: "directly_mapped", farmops: "electrical_loads.amps", authority: eng, transformation: "Numeric coercion with unit stripping (\"20 A\" -> 20).", coverage: "complete" },
  { worksheet: "Load_Master", field: "Volts", classification: "directly_mapped", farmops: "electrical_loads.volts", authority: eng, transformation: "Numeric coercion; \"120/240V\" keeps the higher nominal (240).", coverage: "complete" },
  { worksheet: "Load_Master", field: "Connected VA", classification: "directly_mapped", farmops: "electrical_loads.connected_va", authority: eng, transformation: "Numeric coercion.", coverage: "complete" },
  { worksheet: "Load_Master", field: "Demand VA", classification: "directly_mapped", farmops: "electrical_loads.demand_va", authority: eng, transformation: "Numeric coercion.", coverage: "complete" },
  { worksheet: "Load_Master", field: "Demand Basis", classification: "directly_mapped", farmops: "electrical_loads.demand_basis", authority: eng, transformation: "Verbatim text (NEC article / assumption note).", coverage: "complete" },
  { worksheet: "Load_Master", field: "Count", classification: "directly_mapped", farmops: "electrical_loads.count", authority: eng, transformation: "Integer coercion.", coverage: "complete" },
  { worksheet: "Load_Master", field: "Notes", classification: "directly_mapped", farmops: "electrical_loads.notes", authority: "shared", transformation: "Verbatim; FarmOps appends dated field notes rather than replacing engineering prose.", coverage: "complete" },
  { worksheet: "Load_Master", field: "Row totals / subtotal rows", classification: "derived", farmops: "Recomputed in /electrical (overview + reports)", authority: "generated", transformation: "Recomputed from the load rows; spreadsheet subtotal rows are not stored.", coverage: "complete", notes: "Load_Master is deliberately not reproduced as one flat table: loads, circuit groups, panels and branch runs are separate normalized entities." },
  { worksheet: "Load_Master", field: "Row colour / conditional formatting", classification: "display_only", farmops: "Status badges derived from install_status", authority: "generated", transformation: "Presentation only; colour carries no data FarmOps stores.", coverage: "complete" },

  // ----------------------------------------------------------- Circuit_Groups
  { worksheet: "Circuit_Groups", field: "Circuit Group ID", classification: "directly_mapped", farmops: "electrical_circuit_groups.circuit_group_id", authority: eng, transformation: "Trimmed; never renamed.", coverage: "complete" },
  { worksheet: "Circuit_Groups", field: "Description", classification: "directly_mapped", farmops: "electrical_circuit_groups.description", authority: eng, transformation: "Verbatim text.", coverage: "complete" },
  { worksheet: "Circuit_Groups", field: "Suggested Panel", classification: "directly_mapped", farmops: "electrical_circuit_groups.suggested_panel (legacy) + panel_uuid", authority: eng, transformation: "Text kept read-only; FK on exact match only.", coverage: "complete" },
  { worksheet: "Circuit_Groups", field: "Breaker / Circuit Number", classification: "directly_mapped", farmops: "electrical_circuit_groups.breaker_number, electrical_breaker_positions.breaker_number", authority: eng, transformation: "Integer coercion; the physical slot is normalized into electrical_breaker_positions (side + position).", coverage: "complete" },
  { worksheet: "Circuit_Groups", field: "Breaker Position (left/right, space)", classification: "directly_mapped", farmops: "electrical_breaker_positions.side + position + poles", authority: eng, transformation: "Split into a normalized per-panel slot record; capacity comes from the panel's own spaces / breaker_columns / positions_per_column.", coverage: "complete" },
  { worksheet: "Circuit_Groups", field: "OCP / Breaker Size", classification: "directly_mapped", farmops: "electrical_circuit_groups.ocp_amps, electrical_breaker_positions.ocp_amps", authority: eng, transformation: "Numeric coercion with unit stripping.", coverage: "complete" },
  { worksheet: "Circuit_Groups", field: "Conductor / Wire Size", classification: "directly_mapped", farmops: "electrical_circuit_groups.conductor_size", authority: eng, transformation: "Verbatim text (\"#12 CU\").", coverage: "complete" },
  { worksheet: "Circuit_Groups", field: "Load count / group VA", classification: "derived", farmops: "Rolled up from linked loads", authority: "generated", transformation: "Computed from electrical_loads.circuit_group_uuid; not stored.", coverage: "complete" },

  // ------------------------------------------------------------------ Panels
  { worksheet: "Panels", field: "Panel ID", classification: "directly_mapped", farmops: "electrical_panels.panel_id", authority: eng, transformation: "Trimmed; validated against PNL-*; never renamed.", coverage: "complete" },
  { worksheet: "Panels", field: "Panel Description / Serves", classification: "directly_mapped", farmops: "electrical_panels.description", authority: eng, transformation: "Verbatim text.", coverage: "complete" },
  { worksheet: "Panels", field: "Building / Bldg / Location", classification: "directly_mapped", farmops: "electrical_panels.building", authority: eng, transformation: "Verbatim text.", coverage: "complete" },
  { worksheet: "Panels", field: "Grid Ref", classification: "directly_mapped", farmops: "electrical_panels.grid", authority: eng, transformation: "Grid-validated; read-only in FarmOps.", coverage: "complete" },
  { worksheet: "Panels", field: "Bus / Main Breaker Rating (A)", classification: "directly_mapped", farmops: "electrical_panels.bus_rating_amps", authority: eng, transformation: "Numeric coercion (\"200 A\" -> 200).", coverage: "complete" },
  { worksheet: "Panels", field: "Voltage (V)", classification: "directly_mapped", farmops: "electrical_panels.voltage", authority: eng, transformation: "Numeric coercion (\"120/240V\" -> 240).", coverage: "complete" },
  { worksheet: "Panels", field: "Phase / Wires", classification: "directly_mapped", farmops: "electrical_panels.phase", authority: eng, transformation: "Verbatim text (\"1Ph 3W\").", coverage: "complete" },
  { worksheet: "Panels", field: "Spaces", classification: "directly_mapped", farmops: "electrical_panels.spaces", authority: eng, transformation: "Integer coercion; drives breaker-position capacity.", coverage: "complete" },
  { worksheet: "Panels", field: "Circuits", classification: "directly_mapped", farmops: "electrical_panels.circuits", authority: eng, transformation: "Integer coercion (\"24 ckts\" -> 24).", coverage: "complete" },
  { worksheet: "Panels", field: "Breaker columns / layout", classification: "directly_mapped", farmops: "electrical_panels.breaker_columns, positions_per_column", authority: eng, transformation: "Optional per-panel configuration; when absent, two columns are derived from the space count instead of assumed to be 48 spaces.", coverage: "complete" },
  { worksheet: "Panels", field: "Fed From / Feeder Source", classification: "directly_mapped", farmops: "electrical_panels.feeder_source (legacy) + electrical_feeders.source_panel_uuid/dest_panel_uuid", authority: eng, transformation: "Text preserved; the relational feeder record carries the authoritative link.", coverage: "complete" },
  { worksheet: "Panels", field: "Backup / Generator Class", classification: "directly_mapped", farmops: "electrical_panels.backup_class", authority: eng, transformation: "Verbatim text; drives the critical-power diagram view.", coverage: "complete" },
  { worksheet: "Panels", field: "Panel schedule grid (breaker rows)", classification: "directly_mapped", farmops: "electrical_breaker_positions (one row per physical space)", authority: "shared", transformation: "Normalized: side, position, breaker number, poles, circuit group or load, OCP. Duplicate slots and duplicate breaker numbers are rejected by a unique index and reported in QA.", coverage: "complete" },
  { worksheet: "Panels", field: "Raceway exits from panel", classification: "directly_mapped", farmops: "electrical_panel_exits (panel_uuid, raceway_uuid, exit_order, exit_side)", authority: "shared", transformation: "Physical exit order is stored separately from the CON-### raceway identity; order is unique per panel and starts lower-right, counterclockwise.", coverage: "complete" },
  { worksheet: "Panels", field: "Spare / available space count", classification: "derived", farmops: "Computed from panel layout minus recorded breaker positions", authority: "generated", transformation: "Recomputed on the panel detail page; not stored.", coverage: "complete" },

  // ----------------------------------------------------------------- Feeders
  { worksheet: "Feeders", field: "Feeder ID", classification: "directly_mapped", farmops: "electrical_feeders.feeder_id", authority: eng, transformation: "FDR-### convention; workbook-released IDs kept with a warning.", coverage: "complete" },
  { worksheet: "Feeders", field: "From / To panel", classification: "directly_mapped", farmops: "electrical_feeders.source_panel_uuid / dest_panel_uuid + *_endpoint_ref", authority: eng, transformation: "Legacy text retained; FK on exact match only.", coverage: "complete" },
  { worksheet: "Feeders", field: "OCP / Ampacity", classification: "directly_mapped", farmops: "electrical_feeders.ocp_amps / ampacity_amps", authority: eng, transformation: "Numeric coercion.", coverage: "complete" },
  { worksheet: "Feeders", field: "Conductor / Neutral / EGC size", classification: "directly_mapped", farmops: "electrical_feeders.conductor_size, neutral_size, egc_size", authority: eng, transformation: "Verbatim text.", coverage: "complete" },
  { worksheet: "Feeders", field: "Length / Voltage drop", classification: "directly_mapped", farmops: "electrical_feeders.planned_length_ft, measured_length_ft, voltage_drop_percent", authority: "shared", transformation: "Planned length and calculated drop are engineering; measured length is FarmOps field data and is never overwritten silently.", coverage: "complete" },

  // ------------------------------------------------------------ Conduit_Runs
  { worksheet: "Conduit_Runs", field: "Conduit ID", classification: "directly_mapped", farmops: "electrical_raceways.conduit_id", authority: eng, transformation: "CON-### for every raceway type; the construction lives in raceway_type and is never encoded into the ID. Existing IDs are never renamed.", coverage: "complete" },
  { worksheet: "Conduit_Runs", field: "From / To", classification: "directly_mapped", farmops: "electrical_raceways.from_label / to_label (read-only design text) + source_*_uuid / dest_*_uuid", authority: "shared", transformation: "Design text preserved read-only beside the FarmOps as-built FKs; a missing FK is incomplete, not invalid.", coverage: "complete" },
  { worksheet: "Conduit_Runs", field: "Route Group", classification: "directly_mapped", farmops: "electrical_raceways.route_group", authority: eng, transformation: "Verbatim text.", coverage: "complete" },
  { worksheet: "Conduit_Runs", field: "Purpose / Service Type", classification: "directly_mapped", farmops: "electrical_raceways.purpose / service_type", authority: eng, transformation: "Verbatim text.", coverage: "complete" },
  { worksheet: "Conduit_Runs", field: "Conduit Type / Material / Trade Size", classification: "directly_mapped", farmops: "electrical_raceways.raceway_type, material, trade_size", authority: eng, transformation: "Verbatim text; trade size keeps its inch notation.", coverage: "complete" },
  { worksheet: "Conduit_Runs", field: "Length (ft)", classification: "directly_mapped", farmops: "electrical_raceways.planned_length_ft", authority: eng, transformation: "Numeric coercion.", coverage: "complete" },
  { worksheet: "Conduit_Runs", field: "Measured / As-Built Length", classification: "directly_mapped", farmops: "electrical_raceways.measured_length_ft", authority: field, transformation: "FarmOps-owned; an import that would overwrite a measured value warns first.", coverage: "complete" },
  { worksheet: "Conduit_Runs", field: "Environment", classification: "directly_mapped", farmops: "electrical_raceways.environment", authority: eng, transformation: "Controlled value (INTERIOR, SITE_UNDERGROUND, SITE_EXTERIOR, BUILDING_TRANSITION).", coverage: "complete" },
  { worksheet: "Conduit_Runs", field: "Status / Complete %", classification: "directly_mapped", farmops: "electrical_raceways.install_status, completion_percent", authority: field, transformation: "Percent parsed from \"45%\", \"0.45\" or \"45\"; engineering design words (\"Design Basis\") are normalized to a controlled status with the original text preserved in notes, preview-first.", coverage: "complete" },
  { worksheet: "Conduit_Runs", field: "Exit Order / Exit Side", classification: "directly_mapped", farmops: "electrical_panel_exits.exit_order / exit_side (normalized), electrical_raceways.exit_order / exit_side (legacy)", authority: "shared", transformation: "Phase 4.3 moves panel penetration order into electrical_panel_exits; the raceway columns remain readable for records imported before the split.", coverage: "complete" },
  { worksheet: "Conduit_Runs", field: "Circuit Refs", classification: "directly_mapped", farmops: "electrical_raceways.circuit_refs", authority: eng, transformation: "Verbatim text; relational circuit assignment lives on branch runs.", coverage: "complete" },
  { worksheet: "Conduit_Runs", field: "Waypoints / route description", classification: "directly_mapped", farmops: "electrical_raceway_waypoints (sequence, grid, direction)", authority: field, transformation: "A direction change along one run is a waypoint — never a second junction box.", coverage: "complete" },
  { worksheet: "Conduit_Runs", field: "Fill / conductor count calculations", classification: "derived", farmops: "Not stored; recomputed by engineering", authority: eng, transformation: "Conduit fill remains an engineering calculation in the workbook.", coverage: "not_modelled", notes: "Deliberate: FarmOps does not perform NEC fill calculations." },

  // ----------------------------------------------- Junction boxes / branches
  { worksheet: "Junction_Boxes", field: "JBox ID", classification: "directly_mapped", farmops: "electrical_junction_boxes.jbox_id", authority: eng, transformation: "JB-###-## hierarchical convention; legacy shapes kept with a warning and never renamed.", coverage: "complete" },
  { worksheet: "Junction_Boxes", field: "Raceway path / parent conduit", classification: "directly_mapped", farmops: "Encoded in the JB ID and validated against linked raceways", authority: eng, transformation: "QA reports encoded_parent_mismatch when the encoded path disagrees with the linked raceway.", coverage: "complete" },
  { worksheet: "Junction_Boxes", field: "Size / type / grid / notes", classification: "directly_mapped", farmops: "electrical_junction_boxes.box_size, box_type, grid, notes", authority: eng, transformation: "Verbatim text; grid validated.", coverage: "complete" },
  { worksheet: "Branch_Runs", field: "Branch ID", classification: "directly_mapped", farmops: "electrical_branch_runs.branch_id", authority: eng, transformation: "BR-###-##-## convention inheriting the originating J-box; legacy IDs preserved.", coverage: "complete" },
  { worksheet: "Branch_Runs", field: "Origin (panel / J-box)", classification: "directly_mapped", farmops: "electrical_branch_runs.source_panel_uuid / source_jbox_uuid", authority: "shared", transformation: "FK is authoritative; the encoded origin is cross-checked in QA.", coverage: "complete" },
  { worksheet: "Branch_Runs", field: "Served load / circuit group", classification: "directly_mapped", farmops: "electrical_branch_runs.load_uuid / circuit_group_uuid", authority: eng, transformation: "Exact-match FK resolution only.", coverage: "complete" },
  { worksheet: "Branch_Runs", field: "Wiring method / conductor size / length", classification: "directly_mapped", farmops: "electrical_branch_runs.wiring_method, conductor_size, planned_length_ft, measured_length_ft", authority: "shared", transformation: "Measured length is FarmOps-owned.", coverage: "complete" },

  // -------------------------------------------------------------- Labels / QA
  { worksheet: "Labels", field: "Label text / class / status", classification: "directly_mapped", farmops: "electrical_labels (label_class, label_status, text)", authority: field, transformation: "Label production status is FarmOps field data.", coverage: "complete" },
  { worksheet: "Standards / Legend", field: "Naming conventions, colour codes, abbreviations", classification: "display_only", farmops: "/electrical/standards (built-in reference catalog)", authority: eng, transformation: "Presented as reference text; the validation rules are implemented in code.", coverage: "complete" },
  { worksheet: "Summary / Rollup", field: "Counts, totals, completion roll-ups", classification: "derived", farmops: "/electrical overview, /electrical/sor, snapshot counts", authority: "generated", transformation: "Recomputed deterministically from records; never stored.", coverage: "complete" },
  { worksheet: "Revision_History", field: "Workbook revision log", classification: "intentionally_excluded", farmops: "Not imported", authority: eng, transformation: "The workbook keeps its own engineering release history; FarmOps records field changes in its own audit columns.", coverage: "not_modelled" },
  { worksheet: "Any worksheet", field: "Formulas, pivot ranges, named ranges, chart data", classification: "intentionally_excluded", farmops: "Not imported", authority: eng, transformation: "Spreadsheet mechanics are not engineering data; values are imported, formulas are not.", coverage: "not_modelled" },
  { worksheet: "Any worksheet", field: "Legacy \"Design Basis\" / \"Planning Assumption\" status words", classification: "obsolete", farmops: "install_status normalized; original text kept verbatim in notes", authority: "shared", transformation: "Superseded by the controlled install-status list. Normalization is preview-first and never silent.", coverage: "complete" },
  { worksheet: "Any worksheet", field: "Manual per-row \"% complete\" typed as free text", classification: "obsolete", farmops: "completion_percent (numeric)", authority: field, transformation: "Parsed into a number; unparseable text is refused and reported instead of guessed.", coverage: "complete" },
  { worksheet: "Any worksheet", field: "Cell comments / annotations", classification: "intentionally_excluded", farmops: "Not imported as values", authority: eng, transformation: "Annotations are stripped by the parser so a comment can never become a cell value.", coverage: "not_modelled" },
];

export interface FieldMapSummary {
  total: number;
  byClass: Record<MappingClass, number>;
  byCoverage: Record<MappingCoverage, number>;
  worksheets: string[];
}

export function fieldMapSummary(rows: FieldMapRow[] = FIELD_MAP): FieldMapSummary {
  const byClass = Object.fromEntries(
    MAPPING_CLASSES.map((c) => [c, rows.filter((r) => r.classification === c).length]),
  ) as Record<MappingClass, number>;
  const coverages: MappingCoverage[] = ["complete", "partial", "not_modelled"];
  const byCoverage = Object.fromEntries(
    coverages.map((c) => [c, rows.filter((r) => r.coverage === c).length]),
  ) as Record<MappingCoverage, number>;
  return {
    total: rows.length,
    byClass,
    byCoverage,
    worksheets: [...new Set(rows.map((r) => r.worksheet))],
  };
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function fieldMapCsv(rows: FieldMapRow[] = FIELD_MAP): string {
  const header = [
    "Worksheet",
    "Field",
    "Classification",
    "FarmOps location",
    "Authority",
    "Transformation",
    "Coverage",
    "Notes",
  ];
  const lines = rows.map((r) =>
    [
      r.worksheet,
      r.field,
      MAPPING_CLASS_LABELS[r.classification],
      r.farmops,
      r.authority,
      r.transformation,
      r.coverage,
      r.notes ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export function fieldMapMarkdown(rows: FieldMapRow[] = FIELD_MAP): string {
  const head =
    "| Worksheet | Field | Classification | FarmOps location | Authority | Transformation | Coverage |\n" +
    "| --- | --- | --- | --- | --- | --- | --- |";
  const body = rows.map(
    (r) =>
      `| ${r.worksheet} | ${r.field} | ${MAPPING_CLASS_LABELS[r.classification]} | ${r.farmops} | ${r.authority} | ${r.transformation.replace(/\|/g, "\\|")} | ${r.coverage} |`,
  );
  return [head, ...body].join("\n");
}
