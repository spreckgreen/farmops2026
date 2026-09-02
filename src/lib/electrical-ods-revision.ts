// Phase 4.4d — controlled canonical ODS revision generation (pure logic).
//
// This module generates a CANDIDATE workbook revision from the authorized
// Phase 4.4a baseline plus the Phase 4.4c approved correction manifest. The
// rules it enforces are absolute:
//
//   * the owner-supplied baseline workbook is never overwritten — generation
//     always produces a new artifact;
//   * exactly two source cells may differ (FS-082 Volts, FS-083 Volts);
//   * no other cell, formula, style, sheet, metadata structure, stable ID,
//     row ordering or ods_extras content is intentionally altered;
//   * the four withheld values (FS-082 Amps, FS-083 Amps, FS-084 Amps,
//     FS-084 Connected VA) must remain semantically identical;
//   * the candidate is never automatically promoted: it starts life as
//     PROPOSED_CANONICAL_REVISION and only owner approval retires the previous
//     baseline (retired/superseded, never deleted).
//
// Everything here operates on values parsed from the SHA-verified workbook.
// No canonical value is ever stored in code.
import {
  odsNumber,
  PHASE_44A_BASELINE_SHA256,
  type AdjudicationBaseline,
} from "@/lib/electrical-adjudication-baseline";
import {
  buildCanonicalCorrectionSet,
  type CanonicalCorrectionRow,
  type CanonicalCorrectionSet,
} from "@/lib/electrical-canonical-correction-set";
import { ENTITIES, importColumns } from "@/lib/electrical-entities";
import {
  classifySheet,
  findOdsTableBody,
  locateOdsLogicalCell,
  mapSheet,
  type Sheet,
} from "@/lib/electrical-ods";


export const CANONICAL_REVISION_VERSION = "4.4d-canonical-ods-revision-1";

export const REVISION_STATUS_PROPOSED = "PROPOSED_CANONICAL_REVISION";
export const REVISION_STATUS_PROMOTED = "CURRENT_CANONICAL_BASELINE";
export const REVISION_STATUS_SUPERSEDED = "RETIRED_SUPERSEDED_BASELINE";

/** The only cells this workflow may ever change. */
export const AUTHORIZED_REVISION_FIELDS = [
  { stable_id: "FS-082", field: "volts" as const, from: 120, to: 240 },
  { stable_id: "FS-083", field: "volts" as const, from: 120, to: 240 },
];

/** Values that must remain byte/semantic-equivalent to the baseline. */
export const WITHHELD_REVISION_FIELDS = [
  { stable_id: "FS-082", field: "amps" as const },
  { stable_id: "FS-083", field: "amps" as const },
  { stable_id: "FS-084", field: "amps" as const },
  { stable_id: "FS-084", field: "connected_va" as const },
];

export interface RevisionCellTarget {
  stable_id: string;
  worksheet: string;
  /** 1-based worksheet row, as the parser numbers rows. */
  row: number;
  /** 1-based worksheet column. */
  column: number;
  field: "volts";
  baseline_value: number;
  candidate_value: number;
}

export interface RevisionCellDiff {
  stable_id: string | null;
  worksheet: string;
  row: number;
  column: number;
  field: string;
  baseline_value: string;
  candidate_value: string;
  authorized: boolean;
}

export interface CandidateRevisionReport {
  version: string;
  generated_at: string;
  status: typeof REVISION_STATUS_PROPOSED;
  baseline_file_name: string;
  baseline_sha256: string;
  candidate_file_name: string;
  candidate_sha256: string;
  manifest_version: string;
  manifest_sha256: string;
  changes: RevisionCellDiff[];
  counts: {
    authorized_changed_cells: number;
    unauthorized_changed_cells: number;
    withheld_values_changed: number;
    non_content_archive_entries_changed: number;
  };
  withheld: Array<{
    stable_id: string;
    field: string;
    baseline_value: number | null;
    candidate_value: number | null;
    unchanged: boolean;
  }>;
  /** Pre-mutation trace of both authorized targets, for debugging. */
  target_traces: RevisionTargetTrace[];
  acceptance: { status: "PASS" | "FAIL"; reasons: string[] };

  lineage: { superseded_sha256: string; candidate_sha256: string };
  promotion_required: true;
  baseline_overwritten: false;
  farmops_written: false;
}

export type RevisionGuard = { ok: true } | { ok: false; reason: string };

/* ------------------------------------------------------- manifest guards */

/** The manifest must be the authorized 2-approved / 4-withheld correction set. */
export function manifestAuthorizesRevision(set: CanonicalCorrectionSet): RevisionGuard {
  if (set.baseline_sha256 !== PHASE_44A_BASELINE_SHA256 || !set.is_phase_44a_baseline) {
    return {
      ok: false,
      reason: `The attached manifest was produced against workbook SHA-256 ${set.baseline_sha256}, not the authorized baseline ${PHASE_44A_BASELINE_SHA256}. A foreign or stale manifest is rejected.`,
    };
  }
  if (set.approved.length !== AUTHORIZED_REVISION_FIELDS.length) {
    return {
      ok: false,
      reason: `The manifest carries ${set.approved.length} approved corrections; exactly ${AUTHORIZED_REVISION_FIELDS.length} are authorized for generation.`,
    };
  }
  if (set.withheld.length !== WITHHELD_REVISION_FIELDS.length) {
    return {
      ok: false,
      reason: `The manifest carries ${set.withheld.length} withheld values; exactly ${WITHHELD_REVISION_FIELDS.length} are expected. Generation is refused rather than guessing which values are still unresolved.`,
    };
  }
  for (const expected of AUTHORIZED_REVISION_FIELDS) {
    const row = set.approved.find(
      (r) => r.stable_id === expected.stable_id && r.field === expected.field,
    );
    if (!row) {
      return {
        ok: false,
        reason: `The manifest does not contain the approved ${expected.stable_id} ${expected.field} correction.`,
      };
    }
    if (row.old_raw_value !== expected.from || row.proposed_value !== expected.to) {
      return {
        ok: false,
        reason: `${expected.stable_id} ${expected.field}: the manifest proposes ${row.old_raw_value} → ${row.proposed_value}, but only ${expected.from} → ${expected.to} is authorized.`,
      };
    }
  }
  for (const w of WITHHELD_REVISION_FIELDS) {
    if (!set.withheld.some((r) => r.stable_id === w.stable_id && r.field === w.field)) {
      return {
        ok: false,
        reason: `The manifest does not withhold ${w.stable_id} ${w.field}; generation is refused because an unresolved value could otherwise be written.`,
      };
    }
  }
  return { ok: true };
}

/** Stable serialization of the manifest, so its hash is reproducible. */
export function manifestFingerprintSource(set: CanonicalCorrectionSet): string {
  const line = (r: CanonicalCorrectionRow) =>
    [r.stable_id, r.worksheet, r.row, r.field, r.old_raw_value, r.proposed_value, r.adjudication].join(
      "|",
    );
  return [
    set.version,
    set.baseline_sha256,
    ...set.approved.map((r) => `approved:${line(r)}`),
    ...set.withheld.map((r) => `withheld:${line(r)}`),
  ].join("\n");
}

/* ------------------------------------------------- cell location + rewrite */

/** Worksheet column (1-based) holding a mapped load field, or null. */
export function loadFieldColumn(sheet: Sheet, field: string): number | null {
  if (classifySheet(sheet) !== "load") return null;
  const mapped = mapSheet(sheet, "load", importColumns("load"), ENTITIES["load"].stableIdField);
  const idx = mapped.columns.findIndex((c) => c.target === field);
  return idx < 0 ? null : idx + 1;
}

/**
 * Resolve the exact source cells the authorized corrections touch, refusing
 * anything the SHA-verified workbook does not currently confirm.
 */
export function resolveRevisionTargets(
  baseline: AdjudicationBaseline,
  sheets: Sheet[],
): { targets: RevisionCellTarget[]; errors: string[] } {
  const targets: RevisionCellTarget[] = [];
  const errors: string[] = [];
  for (const a of AUTHORIZED_REVISION_FIELDS) {
    const canonical = baseline.loads.find((l) => l.stable_id === a.stable_id);
    if (!canonical) {
      errors.push(`${a.stable_id}: the attached workbook contains no canonical row.`);
      continue;
    }
    if (canonical.volts !== a.from) {
      errors.push(
        `${a.stable_id} ${a.field}: the workbook currently records ${canonical.volts ?? "no value"}, not the authorized ${a.from}. Generation is refused — the manifest is stale relative to this workbook.`,
      );
      continue;
    }
    const sheet = sheets.find((s) => s.name === canonical.worksheet);
    const column = sheet ? loadFieldColumn(sheet, a.field) : null;
    if (!sheet || !column) {
      errors.push(`${a.stable_id} ${a.field}: the ${canonical.worksheet} worksheet column was not located.`);
      continue;
    }
    targets.push({
      stable_id: a.stable_id,
      worksheet: canonical.worksheet,
      row: canonical.row,
      column,
      field: a.field,
      baseline_value: a.from,
      candidate_value: a.to,
    });
  }
  return { targets, errors };
}

/* ------------------------------ pre-mutation target assertion (Phase 4.4d) */

/** One authorized target, traced through the parser's own addressing. */
export interface RevisionTargetTrace {
  stable_id: string;
  field: string;
  worksheet: string;
  logical_row: number;
  logical_column: number;
  physical_xml_row: number | null;
  physical_xml_cell_index: number | null;
  row_repeat: number | null;
  repeated_row_offset: number | null;
  column_repeat: number | null;
  repeated_column_offset: number | null;
  value_type: string;
  office_value: string;
  display_text: string;
  parsed_value: string;
  expected_value: number;
  next_value: number;
  /** How the cell will be rewritten once the assertion passes. */
  rewrite_mode: "office_value_and_text" | "string_value_and_text" | "none";
  assertion: "PASS" | "FAIL";
  reason: string | null;
}

const NUMERIC_VALUE_TYPES = new Set(["float", "currency", "percentage"]);

/**
 * Trace an authorized target through `locateOdsLogicalCell` — the exact same
 * addressing the SHA-bound canonical parser used — and decide whether the XML
 * cell is provably the parser-resolved canonical cell. Nothing is mutated here.
 */
export function inspectRevisionTarget(
  xml: string,
  target: { stable_id?: string; worksheet: string; row: number; column: number; expected: number; next: number; field?: string },
): RevisionTargetTrace {
  const base: RevisionTargetTrace = {
    stable_id: target.stable_id ?? "(unnamed)",
    field: target.field ?? "volts",
    worksheet: target.worksheet,
    logical_row: target.row,
    logical_column: target.column,
    physical_xml_row: null,
    physical_xml_cell_index: null,
    row_repeat: null,
    repeated_row_offset: null,
    column_repeat: null,
    repeated_column_offset: null,
    value_type: "(none)",
    office_value: "(none)",
    display_text: "",
    parsed_value: "",
    expected_value: target.expected,
    next_value: target.next,
    rewrite_mode: "none",
    assertion: "FAIL",
    reason: null,
  };

  if (!findOdsTableBody(xml, target.worksheet)) {
    return { ...base, reason: `Worksheet "${target.worksheet}" was not found in the workbook content.` };
  }
  const cell = locateOdsLogicalCell(xml, target.worksheet, target.row, target.column);
  if (!cell) {
    return {
      ...base,
      reason: `${target.worksheet} logical row ${target.row} column ${target.column} does not exist in content.xml under the canonical parser's addressing.`,
    };
  }

  const trace: RevisionTargetTrace = {
    ...base,
    physical_xml_row: cell.physicalRowIndex,
    physical_xml_cell_index: cell.physicalCellIndex,
    row_repeat: cell.rowRepeat,
    repeated_row_offset: cell.rowRepeatOffset,
    column_repeat: cell.columnRepeat,
    repeated_column_offset: cell.columnRepeatOffset,
    value_type: cell.valueType ?? "(none)",
    office_value: cell.officeValue ?? "(none)",
    display_text: cell.displayText,
    parsed_value: cell.parsedValue,
  };

  const fail = (reason: string) => ({ ...trace, assertion: "FAIL" as const, reason });

  if (/table:formula="/.test(cell.attrs)) {
    return fail(
      `${target.worksheet} row ${target.row} column ${target.column} carries a formula; formulas are never rewritten.`,
    );
  }
  if (cell.rowRepeat > 1) {
    return fail(
      `Row ${target.row} of ${target.worksheet} is part of a repeated row group (table:number-rows-repeated=${cell.rowRepeat}); the cell is not rewritten.`,
    );
  }
  const paragraphs = cell.inner.match(/<text:p\b[^>]*(?:\/>|>[\s\S]*?<\/text:p>)/g) ?? [];
  if (paragraphs.length > 1) {
    return fail(
      `${target.worksheet} row ${target.row} column ${target.column} holds multiple paragraphs; it is left untouched.`,
    );
  }
  // The assertion that matters: the value the canonical parser read at this
  // logical address must be exactly the authorized baseline value.
  if (odsNumber(cell.parsedValue) !== target.expected) {
    return fail(
      `${target.worksheet} row ${target.row} column ${target.column} parses as ${cell.parsedValue || "(blank)"}, not the authorized ${target.expected}. Generation is refused.`,
    );
  }

  const type = cell.valueType ?? "";
  if (NUMERIC_VALUE_TYPES.has(type)) {
    if (cell.officeValue === null) {
      return fail(
        `${target.worksheet} row ${target.row} column ${target.column} is typed ${type} but stores no office:value; it is left untouched.`,
      );
    }
    if (odsNumber(cell.officeValue) !== target.expected) {
      return fail(
        `${target.worksheet} row ${target.row} column ${target.column} stores office:value ${cell.officeValue}, not the authorized ${target.expected}. Generation is refused.`,
      );
    }
    return { ...trace, rewrite_mode: "office_value_and_text", assertion: "PASS", reason: null };
  }
  if (type === "" || type === "string") {
    // The workbook stores this Volts cell as text. The canonical value is still
    // proven equal to the authorized baseline, so the cell's own typing is
    // preserved rather than normalised into a float.
    return { ...trace, rewrite_mode: "string_value_and_text", assertion: "PASS", reason: null };
  }
  return fail(
    `${target.worksheet} row ${target.row} column ${target.column} has office:value-type="${type}", which this workflow never rewrites.`,
  );
}

/** Row for the debug table the phase requires. */
export function revisionTraceRow(t: RevisionTargetTrace): string[] {
  return [
    t.stable_id,
    String(t.logical_row),
    `${t.logical_column} (${t.field})`,
    t.physical_xml_row === null ? "—" : String(t.physical_xml_row),
    t.physical_xml_cell_index === null ? "—" : String(t.physical_xml_cell_index),
    t.repeated_column_offset === null
      ? "—"
      : `${t.repeated_column_offset}/${t.column_repeat ?? 1}`,
    t.value_type,
    t.office_value,
    t.display_text || "(blank)",
  ];
}

/**
 * Replace exactly one cell in `content.xml` at the address the canonical parser
 * resolved, preserving the cell's style, typing, attributes and every other
 * byte of the document. Anything this cannot prove or change surgically is
 * refused instead of rewritten.
 */
export function rewriteOdsNumericCell(
  xml: string,
  target: { worksheet: string; row: number; column: number; expected: number; next: number; stable_id?: string; field?: string },
): string {
  const trace = inspectRevisionTarget(xml, target);
  if (trace.assertion !== "PASS") throw new Error(trace.reason ?? "The revision target could not be proven.");
  const cell = locateOdsLogicalCell(xml, target.worksheet, target.row, target.column)!;

  const displayed = String(target.next);
  let nextAttrs = cell.attrs;
  if (trace.rewrite_mode === "office_value_and_text") {
    nextAttrs = nextAttrs.replace(/office:value="[^"]*"/, `office:value="${target.next}"`);
  } else if (/office:string-value="/.test(nextAttrs)) {
    nextAttrs = nextAttrs.replace(/office:string-value="[^"]*"/, `office:string-value="${displayed}"`);
  }
  // A repeated-column group is split so only the one logical column changes;
  // its siblings keep their original bytes and their original position.
  const repeat = cell.columnRepeat;
  const offset = cell.columnRepeatOffset;
  const withRepeat = (attrs: string, count: number) => {
    const stripped = attrs.replace(/\s*table:number-columns-repeated="[^"]*"/, "");
    return count > 1 ? `${stripped} table:number-columns-repeated="${count}"` : stripped;
  };
  const original = (count: number) =>
    cell.selfClosing
      ? `<${cell.tag}${withRepeat(cell.attrs, count)}/>`
      : `<${cell.tag}${withRepeat(cell.attrs, count)}>${cell.inner}</${cell.tag}>`;

  const paragraphs = cell.inner.match(/<text:p\b[^>]*(?:\/>|>[\s\S]*?<\/text:p>)/g) ?? [];
  const nextInner = paragraphs.length
    ? cell.inner.replace(paragraphs[0]!, `<text:p>${displayed}</text:p>`)
    : `<text:p>${displayed}</text:p>`;
  const rebuilt = `<${cell.tag}${withRepeat(nextAttrs, 1)}>${nextInner}</${cell.tag}>`;

  const pieces = [
    offset > 0 ? original(offset) : "",
    rebuilt,
    repeat - offset - 1 > 0 ? original(repeat - offset - 1) : "",
  ].join("");

  return xml.slice(0, cell.cellStart) + pieces + xml.slice(cell.cellEnd);
}


/* --------------------------------------------------------------- cell diff */

/** Every cell that differs between two parsed workbooks. */
export function diffSheetCells(
  before: Sheet[],
  after: Sheet[],
): Array<{ worksheet: string; row: number; column: number; before: string; after: string }> {
  const out: Array<{ worksheet: string; row: number; column: number; before: string; after: string }> =
    [];
  const names = [...new Set([...before.map((s) => s.name), ...after.map((s) => s.name)])];
  for (const name of names) {
    const a = before.find((s) => s.name === name);
    const b = after.find((s) => s.name === name);
    const rowCount = Math.max(a?.rows.length ?? 0, b?.rows.length ?? 0);
    for (let r = 0; r < rowCount; r++) {
      const ra = a?.rows[r] ?? [];
      const rb = b?.rows[r] ?? [];
      const colCount = Math.max(ra.length, rb.length);
      for (let c = 0; c < colCount; c++) {
        const va = (ra[c] ?? "").trim();
        const vb = (rb[c] ?? "").trim();
        if (va !== vb) {
          out.push({ worksheet: name, row: r + 1, column: c + 1, before: va, after: vb });
        }
      }
    }
  }
  return out;
}

/* ----------------------------------------------------- candidate reporting */

export function candidateFileName(baselineName: string, candidateSha: string): string {
  const stem = baselineName.replace(/\.ods$/i, "");
  return `${stem}.candidate-${candidateSha.slice(0, 12)}.ods`;
}

export function buildCandidateReport(input: {
  baseline: AdjudicationBaseline;
  candidate: AdjudicationBaseline;
  manifest: CanonicalCorrectionSet;
  manifest_sha256: string;
  candidate_sha256: string;
  candidate_file_name: string;
  targets: RevisionCellTarget[];
  target_traces?: RevisionTargetTrace[];

  cell_diff: Array<{ worksheet: string; row: number; column: number; before: string; after: string }>;
  non_content_archive_entries_changed: number;
  generated_at?: string;
}): CandidateRevisionReport {
  const authorizedAt = new Set(
    input.targets.map((t) => `${t.worksheet}|${t.row}|${t.column}`),
  );
  const changes: RevisionCellDiff[] = input.cell_diff.map((d) => {
    const key = `${d.worksheet}|${d.row}|${d.column}`;
    const target = input.targets.find((t) => `${t.worksheet}|${t.row}|${t.column}` === key);
    const authorized =
      Boolean(target) &&
      odsNumber(d.before) === target!.baseline_value &&
      odsNumber(d.after) === target!.candidate_value;
    return {
      stable_id: target?.stable_id ?? null,
      worksheet: d.worksheet,
      row: d.row,
      column: d.column,
      field: target?.field ?? "(unmapped cell)",
      baseline_value: d.before || "(blank)",
      candidate_value: d.after || "(blank)",
      authorized,
    };
  });
  void authorizedAt;

  const withheld = WITHHELD_REVISION_FIELDS.map((w) => {
    const b = input.baseline.loads.find((l) => l.stable_id === w.stable_id);
    const c = input.candidate.loads.find((l) => l.stable_id === w.stable_id);
    const baseline_value = (b?.[w.field] ?? null) as number | null;
    const candidate_value = (c?.[w.field] ?? null) as number | null;
    return {
      stable_id: w.stable_id,
      field: w.field,
      baseline_value,
      candidate_value,
      unchanged: baseline_value === candidate_value,
    };
  });

  const authorized_changed_cells = changes.filter((c) => c.authorized).length;
  const unauthorized_changed_cells = changes.length - authorized_changed_cells;
  const withheld_values_changed = withheld.filter((w) => !w.unchanged).length;

  const reasons: string[] = [];
  if (authorized_changed_cells !== AUTHORIZED_REVISION_FIELDS.length) {
    reasons.push(
      `Authorized changed cells = ${authorized_changed_cells}; acceptance requires ${AUTHORIZED_REVISION_FIELDS.length}.`,
    );
  }
  if (unauthorized_changed_cells !== 0) {
    reasons.push(`Unauthorized changed cells = ${unauthorized_changed_cells}; acceptance requires 0.`);
  }
  if (withheld_values_changed !== 0) {
    reasons.push(`Withheld values changed = ${withheld_values_changed}; acceptance requires 0.`);
  }
  if (input.non_content_archive_entries_changed !== 0) {
    reasons.push(
      `Archive entries other than content.xml changed = ${input.non_content_archive_entries_changed}; acceptance requires 0.`,
    );
  }
  if (input.candidate.missing_load_ids.length !== input.baseline.missing_load_ids.length) {
    reasons.push("The candidate workbook no longer contains the same canonical load rows.");
  }

  return {
    version: CANONICAL_REVISION_VERSION,
    generated_at: input.generated_at ?? new Date().toISOString(),
    status: REVISION_STATUS_PROPOSED,
    baseline_file_name: input.baseline.ods_file_name,
    baseline_sha256: input.baseline.ods_sha256,
    candidate_file_name: input.candidate_file_name,
    candidate_sha256: input.candidate_sha256,
    manifest_version: input.manifest.version,
    manifest_sha256: input.manifest_sha256,
    changes: changes.sort(
      (a, b) => a.worksheet.localeCompare(b.worksheet) || a.row - b.row || a.column - b.column,
    ),
    counts: {
      authorized_changed_cells,
      unauthorized_changed_cells,
      withheld_values_changed,
      non_content_archive_entries_changed: input.non_content_archive_entries_changed,
    },
    withheld,
    target_traces: input.target_traces ?? [],
    acceptance: { status: reasons.length ? "FAIL" : "PASS", reasons },

    lineage: {
      superseded_sha256: input.baseline.ods_sha256,
      candidate_sha256: input.candidate_sha256,
    },
    promotion_required: true,
    baseline_overwritten: false,
    farmops_written: false,
  };
}

/** The Phase 4.4c manifest for a baseline, ready for generation. */
export function revisionManifest(baseline: AdjudicationBaseline, generatedAt?: string) {
  return buildCanonicalCorrectionSet(baseline, generatedAt);
}

/* -------------------------------------------------------------- exports */

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function candidateDiffCsv(report: CandidateRevisionReport): string {
  const head = [
    "stable_id",
    "worksheet",
    "row",
    "column",
    "field",
    "baseline_value",
    "candidate_value",
    "authorized",
    "baseline_sha256",
    "candidate_sha256",
    "manifest_version",
    "manifest_sha256",
    "generated_at",
  ];
  return [
    head.join(","),
    ...report.changes.map((c) =>
      [
        c.stable_id,
        c.worksheet,
        c.row,
        c.column,
        c.field,
        c.baseline_value,
        c.candidate_value,
        c.authorized ? "yes" : "no",
        report.baseline_sha256,
        report.candidate_sha256,
        report.manifest_version,
        report.manifest_sha256,
        report.generated_at,
      ]
        .map(cell)
        .join(","),
    ),
  ].join("\n");
}

export function candidateDiffMarkdown(report: CandidateRevisionReport): string {
  const lines = [
    "# Phase 4.4d — candidate canonical ODS revision",
    "",
    `- Status: ${report.status} (promotion requires separate explicit owner approval)`,
    `- Baseline: ${report.baseline_file_name} (SHA-256 ${report.baseline_sha256}) — preserved, not overwritten`,
    `- Candidate: ${report.candidate_file_name} (SHA-256 ${report.candidate_sha256})`,
    `- Source manifest: ${report.manifest_version} (SHA-256 ${report.manifest_sha256})`,
    `- Generated: ${report.generated_at}`,
    `- Lineage on promotion: ${report.lineage.superseded_sha256} → ${report.lineage.candidate_sha256}`,
    "",
    `- Authorized changed cells: ${report.counts.authorized_changed_cells}`,
    `- Unauthorized changed cells: ${report.counts.unauthorized_changed_cells}`,
    `- Withheld values changed: ${report.counts.withheld_values_changed}`,
    `- Acceptance: ${report.acceptance.status}`,
    ...report.acceptance.reasons.map((r) => `  - ${r}`),
    "",
    "## Cell diff",
    "",
    "| stable_id | worksheet | row | field | baseline | candidate | authorized |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...report.changes.map(
      (c) =>
        `| ${c.stable_id ?? "—"} | ${c.worksheet} | ${c.row} | ${c.field} | ${c.baseline_value} | ${c.candidate_value} | ${c.authorized ? "yes" : "NO"} |`,
    ),
    "",
    "## Withheld values (must remain unchanged)",
    "",
    ...report.withheld.map(
      (w) =>
        `- ${w.stable_id} ${w.field}: baseline ${w.baseline_value ?? "not stated"} → candidate ${w.candidate_value ?? "not stated"} (${w.unchanged ? "unchanged" : "CHANGED"})`,
    ),
    "",
    "No FarmOps write, no legacy Amp change, no Connected VA change, no service/panel/topology change and no Phase 4.5 cutover is authorized by this candidate.",
    "",
  ];
  return lines.join("\n");
}
