# Electrical Field Mapping Matrix (Requirement / Phase 4.3)

Canonical engineering system of record:
`BosteadFarmsBuildDocs/documents/VOL-01_Electrical/source/data/PremoFarmElectrical.ods`

FarmOps remains the field / as-installed authority. `SOR_AUTHORITY` is still
`canonical_ods`; nothing in Phase 4.3 changes that, and no Phase 4.4 or 4.5 work
is authorised by this document.

The live, filterable version of this matrix is at **/electrical/mapping**, with
CSV and Markdown download. It is generated from `src/lib/electrical-field-map.ts`,
so the page, the export and this file cannot drift.

## Coverage

- Fields classified: **72** across 12 worksheets
- Directly mapped: **60**
- Derived: **5**
- Display only: **2**
- Obsolete: **2**
- Intentionally excluded: **3**
- Coverage: complete **68**, partial **0**, not modelled **4**

## Phase 4.3 structural additions

- `electrical_breaker_positions` — one record per physical breaker space:
  panel, side (Left/Right), position, breaker number, poles, OCP, and a link to a
  circuit group *or* a load. A unique index on (panel, side, position) makes a
  duplicate slot impossible; duplicate breaker numbers within one panel are
  reported as QA errors. Capacity comes from the panel's own `spaces`,
  `breaker_columns` and `positions_per_column` — for example `PNL-FS-CRIT`
  with 30 spaces yields Left 1-15 / Right 1-15, and Left 3 is breaker 5.
- `electrical_panel_exits` — one record per physical raceway penetration:
  panel, optional raceway link, physical `exit_order`, `exit_side`, trade size and
  field status. Exit order is unique per panel and is deliberately independent of
  the raceway's `CON-###` identity.
- Both collections ship in the reconciliation snapshot
  (`panel_breaker_positions`, `panel_exits`; schema version 1.1) with per-field
  ownership metadata, so BosteadFarmsBuildDocs sees them without any ODS write.

## Naming and hierarchy review (item 3)

- Raceways: `CON-###` for every raceway type. Construction (EMT, FLEX/FMC/LFMC,
  PVC, underground, sleeve) is the typed `raceway_type` attribute and is never
  encoded into the identity, so a run installed as flex keeps its `CON-###` ID.
  `EMT-###` is not a raceway identity convention; any record created under that
  short-lived rule is reported, never renamed.
- Junction boxes: `JB-###-##`, inheriting the raceway path.
- Branch runs: `BR-###-##-##`, inheriting the originating junction box.
- QA code `encoded_parent_mismatch` reports any record whose encoded ancestry
  disagrees with its relational parent — for example `BR-105-02-02` linked to a
  junction box other than `JB-105-02`. Resolution is done by relinking the
  record on **/electrical/qa** (or the record's own page); identifiers are never
  renumbered and records are never deleted or recreated.
- Legacy coarse endpoint text (a raceway whose text reference reads `JB-105`
  while its authoritative link is `JB-105-01`) is reported as
  `fk_ref_disagreement`: the FK is authoritative, the ODS design text stays
  read-only in `from_label`/`to_label`, and the stale reference is refreshed only
  through the preview-first QA controls.

## Why Load_Master is not one table (item 4)

Load_Master is a spreadsheet-flattened join. In FarmOps it decomposes into
`electrical_loads`, `electrical_circuit_groups`, `electrical_panels`,
`electrical_breaker_positions` and `electrical_branch_runs`, with relationships
carried by FKs and stable IDs. Roll-ups (counts, VA totals, completion) are
recomputed, never stored.

## Matrix

| Worksheet | Field | Classification | FarmOps location | Authority | Transformation | Coverage |
| --- | --- | --- | --- | --- | --- | --- |
| Load_Master | Load ID | Directly mapped | electrical_loads.load_id | engineering_design | Trimmed; validated against the building prefix convention (FS/PH/BL-### , HSE-##). Never renamed. | complete |
| Load_Master | Load Description | Directly mapped | electrical_loads.description | engineering_design | Verbatim text. | complete |
| Load_Master | Area | Directly mapped | electrical_loads.area | engineering_design | Verbatim text. | complete |
| Load_Master | Grid | Directly mapped | electrical_loads.grid | engineering_design | Validated as a grid cell (A6, B12). A non-grid value is refused on import and reported, never coerced. | complete |
| Load_Master | Location | Directly mapped | electrical_loads.location | engineering_design | Verbatim text. | complete |
| Load_Master | Source Circuit | Directly mapped | electrical_loads.source_circuit (legacy text) + circuit_group_uuid (relational) | engineering_design | Text preserved read-only; the FK is set only on an exact single stable-ID match, otherwise left null and reported in QA. | complete |
| Load_Master | Circuit Group ID | Directly mapped | electrical_loads.circuit_group_ref + circuit_group_uuid | engineering_design | Exact-match FK resolution only. | complete |
| Load_Master | Amps | Directly mapped | electrical_loads.amps | engineering_design | Numeric coercion with unit stripping ("20 A" -> 20). | complete |
| Load_Master | Volts | Directly mapped | electrical_loads.volts | engineering_design | Numeric coercion; "120/240V" keeps the higher nominal (240). | complete |
| Load_Master | Connected VA | Directly mapped | electrical_loads.connected_va | engineering_design | Numeric coercion. | complete |
| Load_Master | Demand VA | Directly mapped | electrical_loads.demand_va | engineering_design | Numeric coercion. | complete |
| Load_Master | Demand Basis | Directly mapped | electrical_loads.demand_basis | engineering_design | Verbatim text (NEC article / assumption note). | complete |
| Load_Master | Count | Directly mapped | electrical_loads.count | engineering_design | Integer coercion. | complete |
| Load_Master | Notes | Directly mapped | electrical_loads.notes | shared | Verbatim; FarmOps appends dated field notes rather than replacing engineering prose. | complete |
| Load_Master | Row totals / subtotal rows | Derived | Recomputed in /electrical (overview + reports) | generated | Recomputed from the load rows; spreadsheet subtotal rows are not stored. | complete |
| Load_Master | Row colour / conditional formatting | Display only | Status badges derived from install_status | generated | Presentation only; colour carries no data FarmOps stores. | complete |
| Circuit_Groups | Circuit Group ID | Directly mapped | electrical_circuit_groups.circuit_group_id | engineering_design | Trimmed; never renamed. | complete |
| Circuit_Groups | Description | Directly mapped | electrical_circuit_groups.description | engineering_design | Verbatim text. | complete |
| Circuit_Groups | Suggested Panel | Directly mapped | electrical_circuit_groups.suggested_panel (legacy) + panel_uuid | engineering_design | Text kept read-only; FK on exact match only. | complete |
| Circuit_Groups | Breaker / Circuit Number | Directly mapped | electrical_circuit_groups.breaker_number, electrical_breaker_positions.breaker_number | engineering_design | Integer coercion; the physical slot is normalized into electrical_breaker_positions (side + position). | complete |
| Circuit_Groups | Breaker Position (left/right, space) | Directly mapped | electrical_breaker_positions.side + position + poles | engineering_design | Split into a normalized per-panel slot record; capacity comes from the panel's own spaces / breaker_columns / positions_per_column. | complete |
| Circuit_Groups | OCP / Breaker Size | Directly mapped | electrical_circuit_groups.ocp_amps, electrical_breaker_positions.ocp_amps | engineering_design | Numeric coercion with unit stripping. | complete |
| Circuit_Groups | Conductor / Wire Size | Directly mapped | electrical_circuit_groups.conductor_size | engineering_design | Verbatim text ("#12 CU"). | complete |
| Circuit_Groups | Load count / group VA | Derived | Rolled up from linked loads | generated | Computed from electrical_loads.circuit_group_uuid; not stored. | complete |
| Panels | Panel ID | Directly mapped | electrical_panels.panel_id | engineering_design | Trimmed; validated against PNL-*; never renamed. | complete |
| Panels | Panel Description / Serves | Directly mapped | electrical_panels.description | engineering_design | Verbatim text. | complete |
| Panels | Building / Bldg / Location | Directly mapped | electrical_panels.building | engineering_design | Verbatim text. | complete |
| Panels | Grid Ref | Directly mapped | electrical_panels.grid | engineering_design | Grid-validated; read-only in FarmOps. | complete |
| Panels | Bus / Main Breaker Rating (A) | Directly mapped | electrical_panels.bus_rating_amps | engineering_design | Numeric coercion ("200 A" -> 200). | complete |
| Panels | Voltage (V) | Directly mapped | electrical_panels.voltage | engineering_design | Numeric coercion ("120/240V" -> 240). | complete |
| Panels | Phase / Wires | Directly mapped | electrical_panels.phase | engineering_design | Verbatim text ("1Ph 3W"). | complete |
| Panels | Spaces | Directly mapped | electrical_panels.spaces | engineering_design | Integer coercion; drives breaker-position capacity. | complete |
| Panels | Circuits | Directly mapped | electrical_panels.circuits | engineering_design | Integer coercion ("24 ckts" -> 24). | complete |
| Panels | Breaker columns / layout | Directly mapped | electrical_panels.breaker_columns, positions_per_column | engineering_design | Optional per-panel configuration; when absent, two columns are derived from the space count instead of assumed to be 48 spaces. | complete |
| Panels | Fed From / Feeder Source | Directly mapped | electrical_panels.feeder_source (legacy) + electrical_feeders.source_panel_uuid/dest_panel_uuid | engineering_design | Text preserved; the relational feeder record carries the authoritative link. | complete |
| Panels | Backup / Generator Class | Directly mapped | electrical_panels.backup_class | engineering_design | Verbatim text; drives the critical-power diagram view. | complete |
| Panels | Panel schedule grid (breaker rows) | Directly mapped | electrical_breaker_positions (one row per physical space) | shared | Normalized: side, position, breaker number, poles, circuit group or load, OCP. Duplicate slots and duplicate breaker numbers are rejected by a unique index and reported in QA. | complete |
| Panels | Raceway exits from panel | Directly mapped | electrical_panel_exits (panel_uuid, raceway_uuid, exit_order, exit_side) | shared | Physical exit order is stored separately from the CON-### raceway identity; order is unique per panel and starts lower-right, counterclockwise. | complete |
| Panels | Spare / available space count | Derived | Computed from panel layout minus recorded breaker positions | generated | Recomputed on the panel detail page; not stored. | complete |
| Feeders | Feeder ID | Directly mapped | electrical_feeders.feeder_id | engineering_design | FDR-### convention; workbook-released IDs kept with a warning. | complete |
| Feeders | From / To panel | Directly mapped | electrical_feeders.source_panel_uuid / dest_panel_uuid + *_endpoint_ref | engineering_design | Legacy text retained; FK on exact match only. | complete |
| Feeders | OCP / Ampacity | Directly mapped | electrical_feeders.ocp_amps / ampacity_amps | engineering_design | Numeric coercion. | complete |
| Feeders | Conductor / Neutral / EGC size | Directly mapped | electrical_feeders.conductor_size, neutral_size, egc_size | engineering_design | Verbatim text. | complete |
| Feeders | Length / Voltage drop | Directly mapped | electrical_feeders.planned_length_ft, measured_length_ft, voltage_drop_percent | shared | Planned length and calculated drop are engineering; measured length is FarmOps field data and is never overwritten silently. | complete |
| Conduit_Runs | Conduit ID | Directly mapped | electrical_raceways.conduit_id | engineering_design | CON-### for every raceway type; the construction lives in raceway_type and is never encoded into the ID. Existing IDs are never renamed. | complete |
| Conduit_Runs | From / To | Directly mapped | electrical_raceways.from_label / to_label (read-only design text) + source_*_uuid / dest_*_uuid | shared | Design text preserved read-only beside the FarmOps as-built FKs; a missing FK is incomplete, not invalid. | complete |
| Conduit_Runs | Route Group | Directly mapped | electrical_raceways.route_group | engineering_design | Verbatim text. | complete |
| Conduit_Runs | Purpose / Service Type | Directly mapped | electrical_raceways.purpose / service_type | engineering_design | Verbatim text. | complete |
| Conduit_Runs | Conduit Type / Material / Trade Size | Directly mapped | electrical_raceways.raceway_type, material, trade_size | engineering_design | Verbatim text; trade size keeps its inch notation. | complete |
| Conduit_Runs | Length (ft) | Directly mapped | electrical_raceways.planned_length_ft | engineering_design | Numeric coercion. | complete |
| Conduit_Runs | Measured / As-Built Length | Directly mapped | electrical_raceways.measured_length_ft | farmops_as_built | FarmOps-owned; an import that would overwrite a measured value warns first. | complete |
| Conduit_Runs | Environment | Directly mapped | electrical_raceways.environment | engineering_design | Controlled value (INTERIOR, SITE_UNDERGROUND, SITE_EXTERIOR, BUILDING_TRANSITION). | complete |
| Conduit_Runs | Status / Complete % | Directly mapped | electrical_raceways.install_status, completion_percent | farmops_as_built | Percent parsed from "45%", "0.45" or "45"; engineering design words ("Design Basis") are normalized to a controlled status with the original text preserved in notes, preview-first. | complete |
| Conduit_Runs | Exit Order / Exit Side | Directly mapped | electrical_panel_exits.exit_order / exit_side (normalized), electrical_raceways.exit_order / exit_side (legacy) | shared | Phase 4.3 moves panel penetration order into electrical_panel_exits; the raceway columns remain readable for records imported before the split. | complete |
| Conduit_Runs | Circuit Refs | Directly mapped | electrical_raceways.circuit_refs | engineering_design | Verbatim text; relational circuit assignment lives on branch runs. | complete |
| Conduit_Runs | Waypoints / route description | Directly mapped | electrical_raceway_waypoints (sequence, grid, direction) | farmops_as_built | A direction change along one run is a waypoint — never a second junction box. | complete |
| Conduit_Runs | Fill / conductor count calculations | Derived | Not stored; recomputed by engineering | engineering_design | Conduit fill remains an engineering calculation in the workbook. | not_modelled |
| Junction_Boxes | JBox ID | Directly mapped | electrical_junction_boxes.jbox_id | engineering_design | JB-###-## hierarchical convention; legacy shapes kept with a warning and never renamed. | complete |
| Junction_Boxes | Raceway path / parent conduit | Directly mapped | Encoded in the JB ID and validated against linked raceways | engineering_design | QA reports encoded_parent_mismatch when the encoded path disagrees with the linked raceway. | complete |
| Junction_Boxes | Size / type / grid / notes | Directly mapped | electrical_junction_boxes.box_size, box_type, grid, notes | engineering_design | Verbatim text; grid validated. | complete |
| Branch_Runs | Branch run ID | Directly mapped | electrical_branch_runs.branch_id | engineering_design | BR-###-##-## convention inheriting the originating J-box; legacy IDs preserved. | complete |
| Branch_Runs | Origin (panel / J-box) | Directly mapped | electrical_branch_runs.source_panel_uuid / source_jbox_uuid | shared | FK is authoritative; the encoded origin is cross-checked in QA. | complete |
| Branch_Runs | Served load / circuit group | Directly mapped | electrical_branch_runs.load_uuid / circuit_group_uuid | engineering_design | Exact-match FK resolution only. | complete |
| Branch_Runs | Wiring method / conductor size / length | Directly mapped | electrical_branch_runs.wiring_method, conductor_size, planned_length_ft, measured_length_ft | shared | Measured length is FarmOps-owned. | complete |
| Labels | Label text / class / status | Directly mapped | electrical_labels (label_class, label_status, text) | farmops_as_built | Label production status is FarmOps field data. | complete |
| Standards / Legend | Naming conventions, colour codes, abbreviations | Display only | /electrical/standards (built-in reference catalog) | engineering_design | Presented as reference text; the validation rules are implemented in code. | complete |
| Summary / Rollup | Counts, totals, completion roll-ups | Derived | /electrical overview, /electrical/sor, snapshot counts | generated | Recomputed deterministically from records; never stored. | complete |
| Revision_History | Workbook revision log | Intentionally excluded | Not imported | engineering_design | The workbook keeps its own engineering release history; FarmOps records field changes in its own audit columns. | not_modelled |
| Any worksheet | Formulas, pivot ranges, named ranges, chart data | Intentionally excluded | Not imported | engineering_design | Spreadsheet mechanics are not engineering data; values are imported, formulas are not. | not_modelled |
| Any worksheet | Legacy "Design Basis" / "Planning Assumption" status words | Obsolete | install_status normalized; original text kept verbatim in notes | shared | Superseded by the controlled install-status list. Normalization is preview-first and never silent. | complete |
| Any worksheet | Manual per-row "% complete" typed as free text | Obsolete | completion_percent (numeric) | farmops_as_built | Parsed into a number; unparseable text is refused and reported instead of guessed. | complete |
| Any worksheet | Cell comments / annotations | Intentionally excluded | Not imported as values | engineering_design | Annotations are stripped by the parser so a comment can never become a cell value. | not_modelled |

