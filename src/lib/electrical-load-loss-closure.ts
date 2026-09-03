// Load_Master Contract v2 — semantic-loss closure report (READ ONLY).
//
// Contract v2 counts a populated canonical cell as semantic loss only when its
// physical column does not bind, so every loss cell today belongs to one of the
// currently unbound physical columns. This module classifies each unbound
// column by the preservation method that would make its cells lossless, and
// reports which proposals need a first-class queryable FarmOps column versus
// which are already losslessly holdable in structured ODS extras.
//
// Losslessness definition used here: a populated canonical cell is lossless only
// if its exact value plus source worksheet, physical column, observed header and
// row remain recoverable from FarmOps after import. Structured extras satisfy
// that, so a dedicated database column is proposed only when the field drives
// engineering/business logic and therefore must be queryable.
//
// Nothing here writes a FarmOps record or emits a schema migration.
import type {
  BoundColumn,
  ContractBinding,
  FieldSimulation,
  UnresolvedCell,
} from "./electrical-load-import-contract";

export const LOSS_CLOSURE_VERSION = "load_master.contract.v2.loss-closure.v1";

/** Structured preservation container: sheet + physical column + header + row. */
export const ODS_EXTRAS_CONTAINER = "electrical_loads.ods_extras (jsonb)";

export type PreservationMethod =
  | "FIRST_CLASS_FIELD"
  | "STRUCTURED_ODS_EXTRA"
  | "LEGACY_FIELD"
  | "DERIVED_REPRESENTATION"
  | "AS_BUILT_FIRST_CLASS_FIELD"
  | "INTENTIONALLY_IGNORED_WITH_ZERO_SEMANTIC_CONTENT"
  | "UNRESOLVED";

export interface SchemaProposal {
  /** Proposed FarmOps column name. */
  column: string;
  data_type: string;
  allowed_states: string[];
  tri_state: boolean;
  rationale: string;
}

export interface ClosureRow {
  physical_column: number;
  /** Header the contract expects at that physical position. */
  exact_header: string;
  /** Header actually observed at that physical position in the workbook. */
  observed_header: string;
  populated_cells: number;
  canonical_semantic: string;
  authority: string;
  current_import_action: string;
  preservation_method: PreservationMethod;
  schema_required: boolean;
  schema_proposal: SchemaProposal | null;
  /** Cells that stay lost if nothing is done (today's loss for this column). */
  semantic_loss_cells: number;
  /** Where the exact value would live once the proposal is adopted. */
  preserved_at: string;
  note: string;
}

export interface ClosureReport {
  version: string;
  row_count: number;
  unbound_column_count: number;
  rows: ClosureRow[];
  schema_proposals: SchemaProposal[];
  totals: {
    semantic_loss_before: number;
    removed_by_first_class: number;
    removed_by_structured_preservation: number;
    removed_with_zero_semantic_content: number;
    remaining_unresolved: number;
    /** Loss cells removed, split by the exact preservation method. */
    by_method: Record<PreservationMethod, number>;
  };
  closes: boolean;
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/\s*\/\s*/g, " / ");

const triStates = ["Y", "N", "TBD", "(blank)"];

interface Knowledge {
  canonical_semantic: string;
  authority: string;
  method: PreservationMethod;
  proposal?: SchemaProposal;
  note: string;
}

const triProposal = (column: string, concept: string): SchemaProposal => ({
  column,
  data_type: "boolean NULL + text token column (tri-state pair)",
  allowed_states: triStates,
  tri_state: true,
  rationale: `${concept} drives installation-completion and readiness logic, so it must be queryable. Y -> true, N -> false, TBD/blank -> NULL, with the verbatim token retained so TBD stays distinguishable from blank.`,
});

/**
 * Observed-header knowledge for the columns that do not bind today. Keyed by the
 * header text actually present at the physical position — identity is still
 * resolved by physical column plus that exact observed header, never by header
 * text alone across positions.
 */
const KNOWN: Record<string, Knowledge> = {
  "circuit rating amps": {
    canonical_semantic: "circuit_rating_amps",
    authority: "engineering_design",
    method: "FIRST_CLASS_FIELD",
    proposal: {
      column: "electrical_loads.circuit_rating_amps",
      data_type: "numeric NULL + text token column",
      allowed_states: ["numeric amps", "TBD", "(blank)"],
      tri_state: false,
      rationale:
        "BR-002 branch-circuit planning value. Drives circuit sizing queries, so it must be first-class. Never written into amps, installed_ocp_rating or design_circuit_ampacity, and never converted into generator VA.",
    },
    note: "Documented branch-circuit rating; a planning value, not a measured current.",
  },
  "generator start class": {
    canonical_semantic: "generator_start_class",
    authority: "engineering_design",
    method: "FIRST_CLASS_FIELD",
    proposal: {
      column: "electrical_loads.generator_start_class",
      data_type: "text NULL (verbatim token)",
      allowed_states: ["stated class token", "TBD", "(blank)"],
      tri_state: false,
      rationale:
        "Generator starting behaviour is business logic for generator sizing tiers, so it must be queryable. Preserved exactly as stated, including TBD; never inferred.",
    },
    note: "Generator starting classification; preserved exactly as stated.",
  },
  "generator start amps": {
    canonical_semantic: "generator_start_amps",
    authority: "engineering_design",
    method: "FIRST_CLASS_FIELD",
    proposal: {
      column: "electrical_loads.generator_start_amps",
      data_type: "numeric NULL + text token column",
      allowed_states: ["numeric amps", "TBD", "(blank)"],
      tri_state: false,
      rationale:
        "Starting current feeds generator sizing, so it must be queryable. Never coerced into amps or MCA; TBD/blank stay NULL with the token retained.",
    },
    note: "Generator starting current; TBD retained verbatim.",
  },
  "existing panel": {
    canonical_semantic: "existing_panel",
    authority: "field_observation",
    method: "AS_BUILT_FIRST_CLASS_FIELD",
    proposal: {
      column: "electrical_loads.existing_panel_text",
      data_type: "text NULL (as-built observation)",
      allowed_states: ["panel text as observed", "(blank)"],
      tri_state: false,
      rationale:
        "As-built panel observation is queried during install reconciliation. Stored as observation text only — it never creates a panel relationship; installed assignment stays relational through breaker positions and circuit groups.",
    },
    note: "As-built observation; never promoted into an installed panel link.",
  },
  "existing circuit": {
    canonical_semantic: "existing_circuit",
    authority: "field_observation",
    method: "STRUCTURED_ODS_EXTRA",
    note: "As-built circuit text. Breaker/circuit links stay relational and FarmOps-owned, so extras preservation is lossless and sufficient.",
  },
  "installation status": {
    canonical_semantic: "install_status",
    authority: "field_observation",
    method: "AS_BUILT_FIRST_CLASS_FIELD",
    proposal: {
      column: "electrical_loads.install_status",
      data_type: "text NULL (verbatim status token)",
      allowed_states: ["stated status token", "TBD", "(blank)"],
      tri_state: false,
      rationale:
        "Install status drives install-progress and wiring views, so it must be queryable. Informational for sizing: STATUS-1 means it never removes a critical design load. Newer FarmOps field records supersede it.",
    },
    note: "Informational for sizing; queryable for install progress.",
  },
  "conduit / flex run complete": {
    canonical_semantic: "conduit_flex_run_complete",
    authority: "field_observation",
    method: "AS_BUILT_FIRST_CLASS_FIELD",
    proposal: triProposal("electrical_loads.conduit_flex_run_complete", "Conduit / flex run completion"),
    note: "As-built completion state; tri-state preserved losslessly.",
  },
  "device side connected": {
    canonical_semantic: "device_side_connected",
    authority: "field_observation",
    method: "AS_BUILT_FIRST_CLASS_FIELD",
    proposal: triProposal("electrical_loads.device_side_connected", "Device-side termination"),
    note: "As-built termination state; tri-state preserved losslessly.",
  },
  "panel side connected": {
    canonical_semantic: "panel_side_connected",
    authority: "field_observation",
    method: "AS_BUILT_FIRST_CLASS_FIELD",
    proposal: triProposal("electrical_loads.panel_side_connected", "Panel-side termination"),
    note: "As-built termination state; tri-state preserved losslessly.",
  },
  "fixture / device installed": {
    canonical_semantic: "fixture_device_installed",
    authority: "field_observation",
    method: "AS_BUILT_FIRST_CLASS_FIELD",
    proposal: triProposal("electrical_loads.fixture_device_installed", "Fixture / device installation"),
    note: "As-built installation state; tri-state preserved losslessly.",
  },
  "installation notes": {
    canonical_semantic: "installation_notes",
    authority: "field_observation",
    method: "AS_BUILT_FIRST_CLASS_FIELD",
    proposal: {
      column: "electrical_loads.installation_notes",
      data_type: "text NULL (as-built prose)",
      allowed_states: ["free text", "(blank)"],
      tri_state: false,
      rationale:
        "Field prose is read during install review and must be queryable separately from engineering Notes (column 22), which it must never overwrite.",
    },
    note: "As-built prose kept separate from engineering Notes.",
  },
  "install date": {
    canonical_semantic: "install_date",
    authority: "field_observation",
    method: "STRUCTURED_ODS_EXTRA",
    note: "FarmOps install progress owns installation dates; the workbook text is preserved verbatim.",
  },
  "installed by": {
    canonical_semantic: "installed_by",
    authority: "field_observation",
    method: "STRUCTURED_ODS_EXTRA",
    note: "As-built attribution; no engineering logic depends on it.",
  },
  "label status": {
    canonical_semantic: "label_status",
    authority: "field_observation",
    method: "STRUCTURED_ODS_EXTRA",
    note: "FarmOps label workflow already owns label state and may supersede this text.",
  },
  "connected kva": {
    canonical_semantic: "connected_kva_display",
    authority: "generated",
    method: "DERIVED_REPRESENTATION",
    note: "Derived representation of Connected VA (VA / 1000). Preserved verbatim for audit, recomputed for display, and never imported as a second connected-load authority.",
  },
  "calculated complete %": {
    canonical_semantic: "completion_percent",
    authority: "generated",
    method: "DERIVED_REPRESENTATION",
    note: "Spreadsheet-calculated percentage, recomputable from the as-built completion fields. Preserved verbatim; not an independent authority.",
  },
  "circuit group id": {
    canonical_semantic: "circuit_group_id_legacy",
    authority: "engineering_design",
    method: "LEGACY_FIELD",
    note: "Duplicate/legacy occurrence of the Circuit Group ID header. Column 9 stays the authority; this column is preserved verbatim under its collision-safe key and never written to circuit_group_ref.",
  },
  "circuit group description": {
    canonical_semantic: "circuit_group_description_legacy",
    authority: "engineering_design",
    method: "LEGACY_FIELD",
    note: "Duplicate/legacy occurrence. Preserved verbatim under its collision-safe key; the circuit-group entity owns the description.",
  },
};

function classify(col: BoundColumn, populated: number): Knowledge {
  const observed = norm(col.observed_header);
  if (!populated) {
    return {
      canonical_semantic: observed ? col.canonical_semantic : "(no semantic content)",
      authority: col.authority,
      method: "INTENTIONALLY_IGNORED_WITH_ZERO_SEMANTIC_CONTENT",
      note: observed
        ? `Header "${col.observed_header}" is present but no canonical row populates this column, so there is nothing to preserve.`
        : "No header and no populated cell at this physical position.",
    };
  }
  const known = observed ? KNOWN[observed] : undefined;
  if (known) return known;
  if (!observed) {
    return {
      canonical_semantic: "(unnamed populated column)",
      authority: col.authority,
      method: "UNRESOLVED",
      note: "Populated cells at a physical position with no header text. Field identity cannot be established from the workbook alone; owner review is required before any preservation claim.",
    };
  }
  return {
    canonical_semantic: observed.replace(/[^a-z0-9]+/g, "_"),
    authority: col.authority,
    method: "STRUCTURED_ODS_EXTRA",
    note: `Header "${col.observed_header}" is outside the declared contract semantics. Preserved verbatim in structured extras keyed by sheet, physical column, observed header and row — recoverable without a dedicated column, and no engineering rule reads it.`,
  };
}

const STRUCTURED: PreservationMethod[] = [
  "STRUCTURED_ODS_EXTRA",
  "LEGACY_FIELD",
  "DERIVED_REPRESENTATION",
];
const FIRST_CLASS: PreservationMethod[] = ["FIRST_CLASS_FIELD", "AS_BUILT_FIRST_CLASS_FIELD"];

/** Build the read-only closure report from a bound contract + field simulation. */
export function buildLossClosure(
  binding: ContractBinding,
  fields: FieldSimulation[],
  rowCount: number,
): ClosureReport {
  const byColumn = new Map(fields.map((f) => [f.physical_column, f]));
  const unbound = binding.columns.filter((c) => c.effective_action === "UNRESOLVED");

  const rows: ClosureRow[] = unbound.map((col) => {
    const stat = byColumn.get(col.physical_column);
    const populated = stat?.source_populated ?? 0;
    const loss = stat?.semantic_loss ?? populated;
    const k = classify(col, populated);
    const schema_required = FIRST_CLASS.includes(k.method);
    return {
      physical_column: col.physical_column,
      exact_header: col.exact_header,
      observed_header: col.observed_header,
      populated_cells: populated,
      canonical_semantic: k.canonical_semantic,
      authority: k.authority,
      current_import_action: col.effective_action,
      preservation_method: k.method,
      schema_required,
      schema_proposal: k.proposal ?? null,
      semantic_loss_cells: loss,
      preserved_at:
        k.method === "INTENTIONALLY_IGNORED_WITH_ZERO_SEMANTIC_CONTENT"
          ? "(nothing populated)"
          : k.method === "UNRESOLVED"
            ? "(not preservable yet)"
            : schema_required && k.proposal
              ? `${k.proposal.column} + ${ODS_EXTRAS_CONTAINER}`
              : ODS_EXTRAS_CONTAINER,
      note: k.note,
    };
  });

  const sumWhere = (pred: (r: ClosureRow) => boolean): number =>
    rows.filter(pred).reduce((a, r) => a + r.semantic_loss_cells, 0);

  const totals = {
    semantic_loss_before: rows.reduce((a, r) => a + r.semantic_loss_cells, 0),
    removed_by_first_class: sumWhere((r) => FIRST_CLASS.includes(r.preservation_method)),
    removed_by_structured_preservation: sumWhere((r) => STRUCTURED.includes(r.preservation_method)),
    removed_with_zero_semantic_content: sumWhere(
      (r) => r.preservation_method === "INTENTIONALLY_IGNORED_WITH_ZERO_SEMANTIC_CONTENT",
    ),
    remaining_unresolved: sumWhere((r) => r.preservation_method === "UNRESOLVED"),
    by_method: {
      FIRST_CLASS_FIELD: sumWhere((r) => r.preservation_method === "FIRST_CLASS_FIELD"),
      AS_BUILT_FIRST_CLASS_FIELD: sumWhere(
        (r) => r.preservation_method === "AS_BUILT_FIRST_CLASS_FIELD",
      ),
      STRUCTURED_ODS_EXTRA: sumWhere((r) => r.preservation_method === "STRUCTURED_ODS_EXTRA"),
      LEGACY_FIELD: sumWhere((r) => r.preservation_method === "LEGACY_FIELD"),
      DERIVED_REPRESENTATION: sumWhere((r) => r.preservation_method === "DERIVED_REPRESENTATION"),
      INTENTIONALLY_IGNORED_WITH_ZERO_SEMANTIC_CONTENT: sumWhere(
        (r) => r.preservation_method === "INTENTIONALLY_IGNORED_WITH_ZERO_SEMANTIC_CONTENT",
      ),
      UNRESOLVED: sumWhere((r) => r.preservation_method === "UNRESOLVED"),
    },
  };

  const seen = new Set<string>();
  const schema_proposals: SchemaProposal[] = [];
  for (const r of rows) {
    if (r.schema_proposal && !seen.has(r.schema_proposal.column)) {
      seen.add(r.schema_proposal.column);
      schema_proposals.push(r.schema_proposal);
    }
  }

  return {
    version: LOSS_CLOSURE_VERSION,
    row_count: rowCount,
    unbound_column_count: unbound.length,
    rows,
    schema_proposals,
    totals,
    closes: totals.remaining_unresolved === 0,
  };
}

const csvCell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function closureCsv(report: ClosureReport): string {
  const lines = [
    "physical_column,exact_header,observed_header,populated_cells,canonical_semantic,authority,current_import_action,preservation_method,schema_required,proposed_column,proposed_data_type,allowed_states,tri_state,semantic_loss_cells,preserved_at,note",
  ];
  for (const r of report.rows) {
    lines.push(
      [
        String(r.physical_column),
        r.exact_header,
        r.observed_header,
        String(r.populated_cells),
        r.canonical_semantic,
        r.authority,
        r.current_import_action,
        r.preservation_method,
        r.schema_required ? "YES" : "NO",
        r.schema_proposal?.column ?? "",
        r.schema_proposal?.data_type ?? "",
        r.schema_proposal?.allowed_states.join(" | ") ?? "",
        r.schema_proposal ? (r.schema_proposal.tri_state ? "YES" : "NO") : "",
        String(r.semantic_loss_cells),
        r.preserved_at,
        r.note,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

/* ------------------------------------------- remaining unresolved cell detail */

export interface UnresolvedCellDetail extends UnresolvedCell {
  /** What the owner must decide before this cell can be called lossless. */
  proposed_owner_disposition: string;
}

/**
 * Cell-level detail for the cells that are still UNRESOLVED after closure —
 * i.e. cells in unbound columns whose preservation method could not be
 * established from the workbook alone. Read-only; no disposition is applied.
 */
export function unresolvedCellDetail(
  report: ClosureReport,
  cells: UnresolvedCell[],
): UnresolvedCellDetail[] {
  const unresolvedColumns = new Set(
    report.rows.filter((r) => r.preservation_method === "UNRESOLVED").map((r) => r.physical_column),
  );
  return cells
    .filter((c) => unresolvedColumns.has(c.physical_column))
    .map((c) => ({
      ...c,
      proposed_owner_disposition: c.observed_header.trim()
        ? `Confirm the engineering meaning of header "${c.observed_header}" at physical column ${c.physical_column}, then bind it as a first-class field or accept STRUCTURED_ODS_EXTRA preservation.`
        : `Unnamed physical column ${c.physical_column}. Owner must state the field identity (or declare the column abandoned) before any preservation claim; until then the value stays semantic loss.`,
    }));
}

export function unresolvedCellCsv(details: UnresolvedCellDetail[]): string {
  const lines = [
    "physical_column,observed_header,expected_header,row,stable_id,raw_value,surrounding_headers,proposed_owner_disposition",
  ];
  for (const d of details) {
    lines.push(
      [
        String(d.physical_column),
        d.observed_header || "(blank)",
        d.expected_header,
        String(d.row),
        d.stable_id,
        d.raw_value,
        d.surrounding_headers,
        d.proposed_owner_disposition,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}
