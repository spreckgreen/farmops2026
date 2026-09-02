// Phase 4.4b — Category-D resolution-source refinement: FarmOps zero-origin
// provenance for loads.connected_va (ODS blank / FarmOps 0).
//
// The first question for these rows is NOT the engineering connected VA. It is
// whether the FarmOps zero was ever asserted by evidence at all. Only once the
// zero-origin question is answered does an equipment nameplate become the
// relevant resolution source.
//
// Invariants:
//  - Read-only. No FarmOps write, no ODS write, no schema or normalization change.
//  - A blank ODS cell is never turned into a zero, and a nonzero connected VA is
//    never inferred.
//  - Exact source values, worksheet/row, stable IDs and the canonical ODS SHA
//    are preserved verbatim.
//  - FS-084 stays separate (CURRENT_SEMANTICS_UNRESOLVED — its 14,400 VA depends
//    on the unresolved 60 A ODS value).
//  - PNL-H1 bus rating and spaces stay separate source-document provenance cases.
import type { NumericFinding } from "@/lib/electrical-numeric-diagnostics";

export const ZERO_ORIGIN_VERSION = "4.4b-connected-va-zero-origin-provenance-1";

export const CONNECTED_VA_FIELD = "connected_va";

/** Loads whose connected VA is already accounted for elsewhere. */
export const CURRENT_SEMANTICS_UNRESOLVED_LOADS = ["FS-084"] as const;

/** Panel findings that remain source-document (panel label / model) cases. */
export const PANEL_SOURCE_DOCUMENT_CASES = [
  { stable_id: "PNL-H1", field: "bus_rating_amps", label: "Bus rating (A)" },
  { stable_id: "PNL-H1", field: "spaces", label: "Spaces" },
] as const;

export type ZeroOrigin =
  | "EXPLICITLY_ENTERED_FROM_SOURCE_EVIDENCE"
  | "CALCULATED_FROM_EXPLICIT_SOURCE_VALUES"
  | "IMPORTED_FROM_EXPLICIT_NUMERIC_ODS_ZERO"
  | "DEFAULTED_OR_COERCED_FROM_BLANK_NULL_OR_TEXT"
  | "GENERATED_BY_APPLICATION_INITIALIZATION"
  | "PROVENANCE_UNAVAILABLE";

export const ZERO_ORIGIN_LABELS: Record<ZeroOrigin, string> = {
  EXPLICITLY_ENTERED_FROM_SOURCE_EVIDENCE:
    "A person entered 0 with a cited source for the zero.",
  CALCULATED_FROM_EXPLICIT_SOURCE_VALUES:
    "0 follows arithmetically from explicit, supported source values (e.g. stated volts x stated amps).",
  IMPORTED_FROM_EXPLICIT_NUMERIC_ODS_ZERO:
    "The canonical workbook cell held a literal numeric 0 that was imported unchanged.",
  DEFAULTED_OR_COERCED_FROM_BLANK_NULL_OR_TEXT:
    "The workbook cell was blank/text and the value became 0 through import defaulting or numeric coercion.",
  GENERATED_BY_APPLICATION_INITIALIZATION:
    "The row was initialized by the application with a 0 column default; no source asserted it.",
  PROVENANCE_UNAVAILABLE:
    "No creation, import or audit provenance survives for this value; the origin of the zero cannot be established.",
};

export type ZeroDisposition =
  | "EXPLICIT_ZERO_SUPPORTED"
  | "ZERO_DEFAULT_OR_COERCION_ARTIFACT"
  | "ZERO_CALCULATED_FROM_SUPPORTED_VALUES"
  | "ZERO_PROVENANCE_UNKNOWN";

export const ZERO_DISPOSITION_LABELS: Record<ZeroDisposition, string> = {
  EXPLICIT_ZERO_SUPPORTED:
    "The zero is an asserted value backed by source evidence; it stands as recorded.",
  ZERO_DEFAULT_OR_COERCION_ARTIFACT:
    "The zero is an import/initialization artifact, not an engineering statement; it carries no load assertion.",
  ZERO_CALCULATED_FROM_SUPPORTED_VALUES:
    "The zero is derived from supported source values; it is only as good as those inputs.",
  ZERO_PROVENANCE_UNKNOWN:
    "The origin of the zero cannot be established from surviving provenance.",
};

/**
 * When the nameplate becomes the resolution source. Nameplate verification is
 * only owed after the zero-origin question is settled AND the zero turns out not
 * to be an asserted value.
 */
export type NextResolutionSource =
  | "FARMOPS_ZERO_ORIGIN_PROVENANCE_REQUIRED"
  | "EQUIPMENT_NAMEPLATE_REQUIRED"
  | "NO_FURTHER_EVIDENCE_REQUIRED";

export const NEXT_SOURCE_LABELS: Record<NextResolutionSource, string> = {
  FARMOPS_ZERO_ORIGIN_PROVENANCE_REQUIRED:
    "Establish the FarmOps import/entry provenance of the zero before requesting field or nameplate verification.",
  EQUIPMENT_NAMEPLATE_REQUIRED:
    "Zero origin settled as non-assertive — the actual engineering connected VA now requires the equipment nameplate or datasheet.",
  NO_FURTHER_EVIDENCE_REQUIRED:
    "The recorded zero is supported; no additional evidence is owed for this row.",
};

/** Read-only FarmOps provenance for one load row. */
export interface LoadProvenanceRow {
  load_id: string;
  connected_va: number | null;
  volts: number | null;
  amps: number | null;
  source_reference: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** Number of surviving field-level audit entries touching connected_va. */
  audit_entries: number;
  /** True when an import snapshot records this row's creation. */
  import_snapshot: boolean;
  /** How many rows share this row's creation timestamp (bulk-insert evidence). */
  creation_batch_size: number;
}

export interface ZeroOriginRow {
  stable_id: string;
  farmops_entity: string | null;
  field: string;
  unit: string;
  /** Parser state of the canonical cell — never converted to zero. */
  ods_state: string;
  ods_raw: string;
  ods_worksheet: string;
  ods_row: number | null;
  farmops_raw: string;
  farmops_connected_va: number | null;
  /** Plain-language account of how the FarmOps row came to exist. */
  farmops_provenance: string;
  zero_origin: ZeroOrigin;
  disposition: ZeroDisposition;
  next_resolution_source: NextResolutionSource;
  /** Evidence lines behind the classification. */
  evidence: string[];
  raw_category: string;
  current_disposition: string;
}

export interface SeparateCase {
  stable_id: string;
  field: string;
  reason: string;
  resolution_source: string;
}

export interface ZeroOriginReport {
  version: string;
  ods_file_name: string;
  ods_sha256: string;
  compared_at: string;
  scope: string;
  rows: ZeroOriginRow[];
  counts_by_origin: Record<ZeroOrigin, number>;
  counts_by_disposition: Record<ZeroDisposition, number>;
  counts_by_next_source: Record<NextResolutionSource, number>;
  /** Rows kept out of this refinement on purpose. */
  separate_cases: SeparateCase[];
  read_only: true;
  write_authorized: false;
}

const EMPTY_ORIGINS = (): Record<ZeroOrigin, number> => ({
  EXPLICITLY_ENTERED_FROM_SOURCE_EVIDENCE: 0,
  CALCULATED_FROM_EXPLICIT_SOURCE_VALUES: 0,
  IMPORTED_FROM_EXPLICIT_NUMERIC_ODS_ZERO: 0,
  DEFAULTED_OR_COERCED_FROM_BLANK_NULL_OR_TEXT: 0,
  GENERATED_BY_APPLICATION_INITIALIZATION: 0,
  PROVENANCE_UNAVAILABLE: 0,
});

const EMPTY_DISPOSITIONS = (): Record<ZeroDisposition, number> => ({
  EXPLICIT_ZERO_SUPPORTED: 0,
  ZERO_DEFAULT_OR_COERCION_ARTIFACT: 0,
  ZERO_CALCULATED_FROM_SUPPORTED_VALUES: 0,
  ZERO_PROVENANCE_UNKNOWN: 0,
});

const EMPTY_NEXT = (): Record<NextResolutionSource, number> => ({
  FARMOPS_ZERO_ORIGIN_PROVENANCE_REQUIRED: 0,
  EQUIPMENT_NAMEPLATE_REQUIRED: 0,
  NO_FURTHER_EVIDENCE_REQUIRED: 0,
});

const DISPOSITION_BY_ORIGIN: Record<ZeroOrigin, ZeroDisposition> = {
  EXPLICITLY_ENTERED_FROM_SOURCE_EVIDENCE: "EXPLICIT_ZERO_SUPPORTED",
  IMPORTED_FROM_EXPLICIT_NUMERIC_ODS_ZERO: "EXPLICIT_ZERO_SUPPORTED",
  CALCULATED_FROM_EXPLICIT_SOURCE_VALUES: "ZERO_CALCULATED_FROM_SUPPORTED_VALUES",
  DEFAULTED_OR_COERCED_FROM_BLANK_NULL_OR_TEXT: "ZERO_DEFAULT_OR_COERCION_ARTIFACT",
  GENERATED_BY_APPLICATION_INITIALIZATION: "ZERO_DEFAULT_OR_COERCION_ARTIFACT",
  PROVENANCE_UNAVAILABLE: "ZERO_PROVENANCE_UNKNOWN",
};

const NEXT_BY_DISPOSITION: Record<ZeroDisposition, NextResolutionSource> = {
  EXPLICIT_ZERO_SUPPORTED: "NO_FURTHER_EVIDENCE_REQUIRED",
  ZERO_CALCULATED_FROM_SUPPORTED_VALUES: "NO_FURTHER_EVIDENCE_REQUIRED",
  // The zero says nothing about the equipment, so the real VA is now a
  // nameplate question — but only because the origin question is settled.
  ZERO_DEFAULT_OR_COERCION_ARTIFACT: "EQUIPMENT_NAMEPLATE_REQUIRED",
  ZERO_PROVENANCE_UNKNOWN: "FARMOPS_ZERO_ORIGIN_PROVENANCE_REQUIRED",
};

const cited = (v: string | null | undefined) => {
  const s = (v ?? "").trim();
  if (!s) return false;
  // Percentage/"Yes"/"No"/"TBD" style column carry-overs are not source citations.
  return !/^(tbd|unknown|n\/?a|none|yes|no|\d+(\.\d+)?\s*%)$/i.test(s);
};

/**
 * Classify the origin of a FarmOps connected_va zero. Nothing about the actual
 * equipment VA is asserted or inferred here.
 */
export function classifyZeroOrigin(
  f: NumericFinding,
  p: LoadProvenanceRow | undefined,
): { origin: ZeroOrigin; evidence: string[] } {
  const evidence: string[] = [];
  const odsAbsent = f.ods_state === "absent";
  evidence.push(
    odsAbsent
      ? `Canonical ODS cell is blank (state \`${f.ods_state}\`) — it is left blank, never read as zero.`
      : `Canonical ODS cell reads \`${f.ods_raw || "(blank)"}\` (state \`${f.ods_state}\`).`,
  );

  if (!p) {
    evidence.push("No FarmOps row provenance could be read for this stable ID.");
    return { origin: "PROVENANCE_UNAVAILABLE", evidence };
  }

  evidence.push(
    `FarmOps row created ${p.created_at ?? "(unknown)"}${
      p.creation_batch_size > 1
        ? ` in a bulk creation batch of ${p.creation_batch_size} rows sharing that timestamp`
        : " as a single-row creation"
    }.`,
  );
  evidence.push(
    p.source_reference
      ? `source_reference = \`${p.source_reference}\`.`
      : "source_reference is empty — no citation accompanies the value.",
  );
  evidence.push(
    p.audit_entries > 0
      ? `${p.audit_entries} field-level audit entr${p.audit_entries === 1 ? "y" : "ies"} touch this column.`
      : "No field-level audit entry records anyone entering this value.",
  );
  evidence.push(
    p.import_snapshot
      ? "An import snapshot records this row's creation."
      : "No import snapshot survives for this row's creation.",
  );

  if (f.ods_state === "zero") {
    evidence.push("The canonical cell holds a literal numeric zero.");
    return { origin: "IMPORTED_FROM_EXPLICIT_NUMERIC_ODS_ZERO", evidence };
  }

  if (cited(p.source_reference) && p.audit_entries > 0) {
    return { origin: "EXPLICITLY_ENTERED_FROM_SOURCE_EVIDENCE", evidence };
  }

  const volts = p.volts ?? null;
  const amps = p.amps ?? null;
  if (cited(p.source_reference) && volts !== null && amps === 0) {
    evidence.push(
      `Stated volts ${volts} x stated amps 0 arithmetically yields 0 VA, with a cited source behind the inputs.`,
    );
    return { origin: "CALCULATED_FROM_EXPLICIT_SOURCE_VALUES", evidence };
  }

  if (odsAbsent && p.creation_batch_size > 1 && p.audit_entries === 0) {
    evidence.push(
      "Blank canonical cell + bulk creation + no audit entry: the zero entered FarmOps through import defaulting/coercion rather than as an assertion.",
    );
    return { origin: "DEFAULTED_OR_COERCED_FROM_BLANK_NULL_OR_TEXT", evidence };
  }

  if (odsAbsent && p.audit_entries === 0 && !p.import_snapshot) {
    evidence.push(
      "No surviving import or entry provenance behind a zero whose canonical cell is blank.",
    );
    return { origin: "PROVENANCE_UNAVAILABLE", evidence };
  }

  return { origin: "PROVENANCE_UNAVAILABLE", evidence };
}

function provenanceSummary(p: LoadProvenanceRow | undefined): string {
  if (!p) return "No FarmOps provenance row available.";
  return [
    `created ${p.created_at ?? "?"}`,
    `updated ${p.updated_at ?? "?"}`,
    p.creation_batch_size > 1 ? `bulk batch of ${p.creation_batch_size}` : "single-row creation",
    p.source_reference ? `source_reference "${p.source_reference}"` : "no source_reference",
    `${p.audit_entries} audit entr${p.audit_entries === 1 ? "y" : "ies"}`,
    p.import_snapshot ? "import snapshot present" : "no import snapshot",
  ].join(" · ");
}

/** The refinement scope: Category-D loads.connected_va with ODS blank / FarmOps zero. */
export function zeroOriginScope(findings: NumericFinding[]): NumericFinding[] {
  return findings.filter(
    (f) =>
      f.raw_category === "D" &&
      f.farmops_field === CONNECTED_VA_FIELD &&
      f.ods_state === "absent" &&
      f.farmops_state === "zero" &&
      !CURRENT_SEMANTICS_UNRESOLVED_LOADS.includes(
        f.stable_id as (typeof CURRENT_SEMANTICS_UNRESOLVED_LOADS)[number],
      ),
  );
}

export function zeroOriginReport(input: {
  findings: NumericFinding[];
  provenance: LoadProvenanceRow[];
  odsFileName: string;
  odsSha256: string;
  comparedAt: string;
}): ZeroOriginReport {
  const byId = new Map(input.provenance.map((p) => [p.load_id, p]));
  const scoped = zeroOriginScope(input.findings).sort((a, b) =>
    a.stable_id.localeCompare(b.stable_id),
  );

  const rows: ZeroOriginRow[] = scoped.map((f) => {
    const p = byId.get(f.stable_id);
    const { origin, evidence } = classifyZeroOrigin(f, p);
    const disposition = DISPOSITION_BY_ORIGIN[origin];
    return {
      stable_id: f.stable_id,
      farmops_entity: f.farmops_entity,
      field: f.farmops_field,
      unit: f.unit,
      ods_state: f.ods_state,
      ods_raw: f.ods_raw,
      ods_worksheet: f.ods_worksheet,
      ods_row: f.ods_row,
      farmops_raw: f.farmops_raw,
      farmops_connected_va: p?.connected_va ?? null,
      farmops_provenance: provenanceSummary(p),
      zero_origin: origin,
      disposition,
      next_resolution_source: NEXT_BY_DISPOSITION[disposition],
      evidence,
      raw_category: f.raw_category,
      current_disposition: f.convergence_disposition,
    };
  });

  const counts_by_origin = EMPTY_ORIGINS();
  const counts_by_disposition = EMPTY_DISPOSITIONS();
  const counts_by_next_source = EMPTY_NEXT();
  for (const r of rows) {
    counts_by_origin[r.zero_origin] += 1;
    counts_by_disposition[r.disposition] += 1;
    counts_by_next_source[r.next_resolution_source] += 1;
  }

  const separate_cases: SeparateCase[] = [
    ...CURRENT_SEMANTICS_UNRESOLVED_LOADS.map((id) => ({
      stable_id: id,
      field: CONNECTED_VA_FIELD,
      reason:
        "Connected VA 14,400 is already proven dependent on the unresolved 60 A canonical current value; it stays CURRENT_SEMANTICS_UNRESOLVED and is not a zero-origin question.",
      resolution_source: "Canonical current-semantics resolution (Amps field meaning) first",
    })),
    ...PANEL_SOURCE_DOCUMENT_CASES.map((c) => ({
      stable_id: c.stable_id,
      field: c.field,
      reason: `FarmOps states ${c.label} where the canonical workbook is silent; the value must be verified from the physical panel manufacturer data label / model, not forced into the ODS because FarmOps holds it.`,
      resolution_source:
        "Photograph of the PNL-H1 manufacturer data label (settles bus rating and spaces together)",
    })),
  ];

  return {
    version: ZERO_ORIGIN_VERSION,
    ods_file_name: input.odsFileName,
    ods_sha256: input.odsSha256,
    compared_at: input.comparedAt,
    scope:
      "Category-D loads.connected_va findings where the canonical ODS cell is blank and FarmOps holds 0.",
    rows,
    counts_by_origin,
    counts_by_disposition,
    counts_by_next_source,
    separate_cases,
    read_only: true,
    write_authorized: false,
  };
}

/* ------------------------------------------------------------------ exports */

function csv(rows: string[][]): string {
  return rows
    .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\n");
}

export function zeroOriginCsv(r: ZeroOriginReport): string {
  return csv([
    [
      "ods_sha256",
      "stable_id",
      "ods_raw_state",
      "ods_raw",
      "ods_worksheet",
      "ods_row",
      "farmops_connected_va",
      "farmops_provenance",
      "zero_origin",
      "disposition",
      "next_resolution_source",
      "evidence",
      "raw_category",
      "current_disposition",
    ],
    ...r.rows.map((x) => [
      r.ods_sha256,
      x.stable_id,
      x.ods_state,
      x.ods_raw,
      x.ods_worksheet,
      x.ods_row === null ? "" : String(x.ods_row),
      x.farmops_connected_va === null ? "" : String(x.farmops_connected_va),
      x.farmops_provenance,
      x.zero_origin,
      x.disposition,
      x.next_resolution_source,
      x.evidence.join(" | "),
      x.raw_category,
      x.current_disposition,
    ]),
  ]);
}

export function zeroOriginMarkdown(r: ZeroOriginReport): string {
  return [
    "# Phase 4.4b \u2014 Category D resolution-source refinement (read-only)",
    "",
    `- Canonical workbook: \`${r.ods_file_name}\``,
    `- Workbook SHA-256: \`${r.ods_sha256}\``,
    `- Compared at: ${r.compared_at}`,
    `- Analysis version: \`${r.version}\``,
    `- Scope: ${r.scope}`,
    "- Writes performed: **none** \u2014 no FarmOps write, no ODS write, no blank\u2192zero conversion, no inferred nonzero VA",
    "",
    "## Zero-origin roll-up",
    "",
    "| Disposition | Rows |",
    "| --- | --- |",
    ...(Object.keys(r.counts_by_disposition) as ZeroDisposition[])
      .filter((d) => r.counts_by_disposition[d] > 0)
      .map((d) => `| ${d} | ${r.counts_by_disposition[d]} |`),
    "",
    "| Next resolution source | Rows |",
    "| --- | --- |",
    ...(Object.keys(r.counts_by_next_source) as NextResolutionSource[])
      .filter((d) => r.counts_by_next_source[d] > 0)
      .map((d) => `| ${d} | ${r.counts_by_next_source[d]} |`),
    "",
    "## Rows",
    "",
    "| Stable ID | ODS raw state | FarmOps connected_va | FarmOps creation/source provenance | Zero origin | Disposition | Next resolution source |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...r.rows.map(
      (x) =>
        `| ${x.stable_id} | ${x.ods_state}${x.ods_raw ? ` (\`${x.ods_raw}\`)` : " (blank)"} | ${
          x.farmops_connected_va ?? "(null)"
        } | ${x.farmops_provenance} | ${x.zero_origin} | ${x.disposition} | ${x.next_resolution_source} |`,
    ),
    "",
    "## Kept separate",
    "",
    "| Stable ID | Field | Reason | Resolution source |",
    "| --- | --- | --- | --- |",
    ...r.separate_cases.map(
      (c) => `| ${c.stable_id} | ${c.field} | ${c.reason} | ${c.resolution_source} |`,
    ),
    "",
  ].join("\n");
}
