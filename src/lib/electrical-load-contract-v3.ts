/**
 * Load_Master Import Contract v3 — READ ONLY.
 *
 * Contract v2 declared a *fixed* physical-column registry. The SHA-authorized
 * Load_Master workbook does not use that column order (e.g. physical 2 carries
 * "Area", physical 3 carries "Load Description", physical 14 carries
 * "Demand Basis"), so v2's positional expectations produced UNRESOLVED columns
 * and a semantic-loss figure contaminated by a registry/version mismatch.
 *
 * v3 fixes the *basis*, not the semantics:
 *
 *   physical column  +  exact observed header  +  canonical semantic identity
 *
 * The canonical semantic identity of each field is declared position-free in
 * SEMANTIC_REGISTRY. v3 is then materialised from the authorized workbook's own
 * 41-column header row, so a known canonical field binds at whatever physical
 * position it actually occupies. Only a populated column whose observed header
 * matches no registered canonical semantic stays UNRESOLVED and becomes a
 * candidate for structured-extras preservation.
 *
 * v2 is retained verbatim for audit history and is never mutated.
 * Nothing in this module writes a FarmOps record or emits a schema migration.
 */
import type { Sheet } from "@/lib/electrical-ods";
import {
  LOAD_MASTER_CONTRACT_V2,
  type ContractAuthority,
  type ContractColumn,
  type ContractDataType,
  type ImportAction,
} from "@/lib/electrical-load-import-contract";

export const IMPORT_CONTRACT_V3_VERSION = "load_master.contract.v3";

/** A canonical field identity, declared without any physical position. */
export interface SemanticDefinition {
  canonical_semantic: string;
  /** Exact accepted header spellings. The first is the canonical spelling. */
  headers: string[];
  data_type: ContractDataType;
  allowed_tokens: string[];
  farmops_destination: string | null;
  transformation: string;
  authority: ContractAuthority;
  import_action: ImportAction;
  reason?: string;
}

const TRI = ["Y", "N", "TBD", "(blank)"];

/** v2 semantics that only existed to describe duplicate physical positions. */
const V2_POSITIONAL_DUPLICATES = new Set([
  "circuit_group_id_legacy",
  "circuit_group_description_legacy",
]);

/**
 * Canonical identities inherited unchanged from Contract v2 — same semantics,
 * same transformations, same authority, same import action. Only the positional
 * assumption is dropped.
 */
const FROM_V2: SemanticDefinition[] = LOAD_MASTER_CONTRACT_V2.filter(
  (c) => !V2_POSITIONAL_DUPLICATES.has(c.canonical_semantic),
).map((c) => ({
  canonical_semantic: c.canonical_semantic,
  headers: [c.exact_header, ...(c.accepted_headers ?? [])],
  data_type: c.data_type,
  allowed_tokens: c.allowed_tokens,
  farmops_destination: c.farmops_destination,
  transformation: c.transformation,
  authority: c.authority,
  import_action: c.import_action,
  reason: c.reason,
}));

const asBuiltTri = (
  canonical_semantic: string,
  header: string,
  concept: string,
): SemanticDefinition => ({
  canonical_semantic,
  headers: [header],
  data_type: "tri_state",
  allowed_tokens: TRI,
  farmops_destination: null,
  transformation: `${concept} as observed in the field. Y / N / TBD / blank preserved losslessly; no completion state is inferred from any other column.`,
  authority: "field_observation",
  import_action: "AS_BUILT_FIELD",
  reason: `electrical_loads has no ${canonical_semantic} column; the value is preserved verbatim pending the as-built schema decision.`,
});

/**
 * Canonical identities present in the authorized workbook that Contract v2 never
 * declared. They are as-built/installation columns, so they carry field
 * observation authority and never become an engineering-value authority.
 */
const ADDITIONAL: SemanticDefinition[] = [
  asBuiltTri("conduit_flex_run_complete", "Conduit / Flex Run Complete", "Conduit / flex run completion"),
  asBuiltTri("device_side_connected", "Device Side Connected", "Device-side termination"),
  asBuiltTri("panel_side_connected", "Panel Side Connected", "Panel-side termination"),
  asBuiltTri("fixture_device_installed", "Fixture / Device Installed", "Fixture / device installation"),
];

/** The v3 registry: canonical semantic identities, position-free. */
export const SEMANTIC_REGISTRY: SemanticDefinition[] = [...FROM_V2, ...ADDITIONAL];

export const normalizeHeader = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, " / ");

const BY_HEADER = new Map<string, SemanticDefinition>();
for (const def of SEMANTIC_REGISTRY) {
  for (const h of def.headers) {
    const key = normalizeHeader(h);
    if (!BY_HEADER.has(key)) BY_HEADER.set(key, def);
  }
}

/** Registered canonical semantic for an exact observed header, if any. */
export function semanticForHeader(observed: string): SemanticDefinition | undefined {
  const key = normalizeHeader(observed);
  return key ? BY_HEADER.get(key) : undefined;
}

const sheetWidth = (sheet: Sheet, headerRow: number): number =>
  Math.max((sheet.rows[headerRow] ?? []).length, ...sheet.rows.map((r) => r.length), 0);

const columnPopulated = (sheet: Sheet, headerRow: number, index0: number): boolean =>
  sheet.rows.some((r, idx) => idx !== headerRow && String(r[index0] ?? "").trim() !== "");

/**
 * Materialise Contract v3 from the authorized workbook's own header row.
 *
 * Binding is by physical position plus the exact observed header at that
 * position, with the canonical semantic identity taken from the registry. A
 * repeated canonical semantic keeps its first physical occurrence as the
 * authority and every later occurrence becomes an explicit legacy preserve —
 * duplicates are resolved by position, never by header text.
 */
export function buildContractV3(sheet: Sheet, headerRow: number): ContractColumn[] {
  const header = sheet.rows[headerRow] ?? [];
  const width = sheetWidth(sheet, headerRow);
  const claimed = new Set<string>();
  const columns: ContractColumn[] = [];

  for (let pc = 1; pc <= width; pc++) {
    const observed = String(header[pc - 1] ?? "").trim();
    const def = semanticForHeader(observed);
    const key = observed ? `${observed}#${pc}` : `(unnamed)#${pc}`;

    if (def && !claimed.has(def.canonical_semantic)) {
      claimed.add(def.canonical_semantic);
      columns.push({
        physical_column: pc,
        exact_header: observed,
        canonical_semantic: def.canonical_semantic,
        data_type: def.data_type,
        allowed_tokens: def.allowed_tokens,
        farmops_destination: def.farmops_destination,
        transformation: def.transformation,
        authority: def.authority,
        import_action: def.import_action,
        preservation_key: key,
        reason: def.reason,
      });
      continue;
    }

    if (def) {
      columns.push({
        physical_column: pc,
        exact_header: observed,
        canonical_semantic: `${def.canonical_semantic}_legacy`,
        data_type: "text",
        allowed_tokens: [],
        farmops_destination: null,
        transformation: `Later physical occurrence of the "${observed}" header. The first occurrence stays the authority; this column is preserved verbatim under its collision-safe key and is never written to ${def.farmops_destination ?? "any destination"}.`,
        authority: def.authority,
        import_action: "LEGACY_PRESERVE",
        preservation_key: key,
        reason: "Duplicate header — identity resolved by physical position, not header text.",
      });
      continue;
    }

    columns.push({
      physical_column: pc,
      exact_header: observed,
      canonical_semantic: observed
        ? `unknown_column_${normalizeHeader(observed).replace(/[^a-z0-9]+/g, "_")}`
        : `unnamed_column_${pc}`,
      data_type: "text",
      allowed_tokens: [],
      farmops_destination: null,
      transformation:
        "No registered canonical semantic matches this observed header. Left UNRESOLVED so the closure report can decide a preservation route; never bound to a neighbouring field.",
      authority: "shared",
      import_action: "UNRESOLVED",
      preservation_key: null,
      reason: observed
        ? `Header "${observed}" is not a registered canonical Load_Master semantic.`
        : "No header text at this physical position.",
    });
  }

  return columns;
}

/* ------------------------------------------- contract registry alignment audit */

export type AlignmentDisposition =
  | "ALIGNED"
  | "V2_HEADER_VARIANT_ACCEPTED"
  | "REBOUND_BY_OBSERVED_HEADER"
  | "V2_SEMANTIC_RELOCATED_ELSEWHERE"
  | "NEW_SEMANTIC_NOT_DECLARED_IN_V2"
  | "DUPLICATE_HEADER_LEGACY_PRESERVE"
  | "UNKNOWN_HEADER_OWNER_REVIEW"
  | "NO_COLUMN_IN_AUTHORIZED_WORKBOOK";

export interface AlignmentRow {
  physical_column: number;
  /** Header Contract v2 expected at this physical position. */
  v2_expected_header: string;
  /** Header actually present at this physical position in the authorized workbook. */
  observed_header: string;
  /** Semantic identity v2 (and the prior mapping audit) assigned to this position. */
  prior_semantic_identity: string;
  /** Semantic identity v3 binds here, from the observed header. */
  v3_semantic_identity: string;
  populated_cells: number;
  disposition: AlignmentDisposition;
  note: string;
}

export interface AlignmentAudit {
  from_version: string;
  to_version: string;
  sheet: string;
  header_row: number;
  observed_column_count: number;
  rows: AlignmentRow[];
  totals: Record<AlignmentDisposition, number>;
  /** Positions where v2's expected header disagrees with the workbook. */
  mismatched_positions: number;
  /** Populated columns that stay genuinely unknown after v3 alignment. */
  unknown_populated_columns: number;
}

/**
 * Contract Registry Alignment Audit — physical column by physical column, what
 * v2 expected, what the authorized workbook actually carries, what identity the
 * prior positional registry assigned, and the disposition v3 applies.
 */
export function alignContractRegistry(sheet: Sheet, headerRow: number): AlignmentAudit {
  const header = sheet.rows[headerRow] ?? [];
  const width = sheetWidth(sheet, headerRow);
  const v3 = buildContractV3(sheet, headerRow);
  const v3ByColumn = new Map(v3.map((c) => [c.physical_column, c]));
  const v2ByColumn = new Map(LOAD_MASTER_CONTRACT_V2.map((c) => [c.physical_column, c]));
  const v3Semantics = new Set(v3.map((c) => c.canonical_semantic));

  const span = Math.max(width, LOAD_MASTER_CONTRACT_V2.length);
  const rows: AlignmentRow[] = [];

  for (let pc = 1; pc <= span; pc++) {
    const v2 = v2ByColumn.get(pc);
    const col = v3ByColumn.get(pc);
    const observed = String(header[pc - 1] ?? "").trim();
    const populated = pc <= width ? (columnPopulated(sheet, headerRow, pc - 1) ? 1 : 0) : 0;
    const populated_cells =
      pc <= width
        ? sheet.rows.filter((r, idx) => idx !== headerRow && String(r[pc - 1] ?? "").trim() !== "")
            .length
        : 0;

    if (!col) {
      rows.push({
        physical_column: pc,
        v2_expected_header: v2?.exact_header ?? "(not in v2)",
        observed_header: "(no column)",
        prior_semantic_identity: v2?.canonical_semantic ?? "(none)",
        v3_semantic_identity: "(none)",
        populated_cells: 0,
        disposition: "NO_COLUMN_IN_AUTHORIZED_WORKBOOK",
        note: "Contract v2 declared this physical position, but the authorized workbook has no such column.",
      });
      continue;
    }

    let disposition: AlignmentDisposition;
    let note: string;

    if (col.import_action === "UNRESOLVED") {
      disposition = "UNKNOWN_HEADER_OWNER_REVIEW";
      note = observed
        ? `Header "${observed}" matches no registered canonical semantic. Eligible for structured-extras preservation only after owner review — never bound to a neighbour.`
        : "No header text at this physical position.";
    } else if (col.canonical_semantic.endsWith("_legacy")) {
      disposition = "DUPLICATE_HEADER_LEGACY_PRESERVE";
      note = `Repeated "${observed}" header. The first physical occurrence stays the authority; this position is preserved verbatim.`;
    } else if (!v2) {
      disposition = "NEW_SEMANTIC_NOT_DECLARED_IN_V2";
      note = `Physical position beyond v2's registry. "${observed}" binds to ${col.canonical_semantic}.`;
    } else if (normalizeHeader(v2.exact_header) === normalizeHeader(observed)) {
      disposition = "ALIGNED";
      note = "v2's expected header and the authorized workbook agree at this physical position.";
    } else if ((v2.accepted_headers ?? []).some((h) => normalizeHeader(h) === normalizeHeader(observed))) {
      disposition = "V2_HEADER_VARIANT_ACCEPTED";
      note = `"${observed}" is a v2-accepted spelling of ${v2.canonical_semantic} at this position.`;
    } else if (!v3Semantics.has(v2.canonical_semantic)) {
      disposition = "NEW_SEMANTIC_NOT_DECLARED_IN_V2";
      note = `v2 expected "${v2.exact_header}" (${v2.canonical_semantic}) here; the workbook carries "${observed}" (${col.canonical_semantic}), and v2's semantic appears nowhere in this workbook.`;
    } else {
      disposition = "REBOUND_BY_OBSERVED_HEADER";
      note = `v2 expected "${v2.exact_header}" (${v2.canonical_semantic}); the workbook carries "${observed}", so v3 binds ${col.canonical_semantic} here. v2's semantic is rebound at its actual physical position.`;
    }

    rows.push({
      physical_column: pc,
      v2_expected_header: v2?.exact_header ?? "(not in v2)",
      observed_header: observed || "(blank)",
      prior_semantic_identity: v2?.canonical_semantic ?? "(none)",
      v3_semantic_identity: col.canonical_semantic,
      populated_cells,
      disposition,
      note,
    });
    void populated;
  }

  // A v2 semantic whose declared position no longer carries it, but which v3 did
  // rebind somewhere else, is reported once more against its old position.
  for (const row of rows) {
    if (
      row.disposition === "REBOUND_BY_OBSERVED_HEADER" &&
      row.prior_semantic_identity !== row.v3_semantic_identity &&
      v3Semantics.has(row.prior_semantic_identity)
    ) {
      const rebound = v3.find((c) => c.canonical_semantic === row.prior_semantic_identity);
      if (rebound) {
        row.note += ` (${row.prior_semantic_identity} now binds at physical column ${rebound.physical_column}.)`;
      }
    }
  }

  const totals = {
    ALIGNED: 0,
    V2_HEADER_VARIANT_ACCEPTED: 0,
    REBOUND_BY_OBSERVED_HEADER: 0,
    V2_SEMANTIC_RELOCATED_ELSEWHERE: 0,
    NEW_SEMANTIC_NOT_DECLARED_IN_V2: 0,
    DUPLICATE_HEADER_LEGACY_PRESERVE: 0,
    UNKNOWN_HEADER_OWNER_REVIEW: 0,
    NO_COLUMN_IN_AUTHORIZED_WORKBOOK: 0,
  } as Record<AlignmentDisposition, number>;
  for (const r of rows) totals[r.disposition] += 1;

  return {
    from_version: "load_master.contract.v2",
    to_version: IMPORT_CONTRACT_V3_VERSION,
    sheet: sheet.name,
    header_row: headerRow + 1,
    observed_column_count: width,
    rows,
    totals,
    mismatched_positions: rows.filter(
      (r) => r.disposition !== "ALIGNED" && r.disposition !== "V2_HEADER_VARIANT_ACCEPTED",
    ).length,
    unknown_populated_columns: rows.filter(
      (r) => r.disposition === "UNKNOWN_HEADER_OWNER_REVIEW" && r.populated_cells > 0,
    ).length,
  };
}

const csvCell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function alignmentCsv(audit: AlignmentAudit): string {
  const lines = [
    "physical_column,v2_expected_header,observed_header,prior_semantic_identity,v3_semantic_identity,populated_cells,disposition,note",
  ];
  for (const r of audit.rows) {
    lines.push(
      [
        String(r.physical_column),
        r.v2_expected_header,
        r.observed_header,
        r.prior_semantic_identity,
        r.v3_semantic_identity,
        String(r.populated_cells),
        r.disposition,
        r.note,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}
