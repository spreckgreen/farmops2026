import { describe, expect, it } from "vitest";
import {
  buildCandidateReport,
  candidateDiffCsv,
  diffSheetCells,
  loadFieldColumn,
  manifestAuthorizesRevision,
  resolveRevisionTargets,
  revisionManifest,
  rewriteOdsNumericCell,
  REVISION_STATUS_PROPOSED,
} from "@/lib/electrical-ods-revision";
import {
  makeAdjudicationBaseline,
  openQuestionsFor,
  PHASE_44A_BASELINE_SHA256,
} from "@/lib/electrical-adjudication-baseline";
import { parseOdsContentXml, type Sheet } from "@/lib/electrical-ods";
import { testBaseline } from "./helpers/adjudication-baseline";

const cell = (value: string, numeric = false) =>
  numeric
    ? `<table:table-cell table:style-name="ce7" office:value-type="float" office:value="${value}" calcext:value-type="float"><text:p>${value}</text:p></table:table-cell>`
    : `<table:table-cell table:style-name="ce1" office:value-type="string"><text:p>${value}</text:p></table:table-cell>`;

const row = (cells: string) => `<table:table-row table:style-name="ro1">${cells}</table:table-row>`;

const CONTENT = `<?xml version="1.0" encoding="UTF-8"?><office:document-content><office:body><office:spreadsheet><table:table table:name="Loads" table:style-name="ta1">${row(
  [
    cell("Load ID"),
    cell("Description"),
    cell("Volts"),
    cell("Amps"),
    cell("Connected VA"),
    cell("Source Circuit"),
  ].join(""),
)}${row(
  [
    cell("FS-082"),
    cell("Mini Split SE"),
    cell("120", true),
    cell("0", true),
    `<table:table-cell/>`,
    cell("PNL-H1-12"),
  ].join(""),
)}${row(
  [
    cell("FS-083"),
    cell("Mini Split E"),
    cell("120", true),
    cell("0", true),
    `<table:table-cell/>`,
    cell("PNL-H1-14"),
  ].join(""),
)}${row(
  [
    cell("FS-084"),
    cell("Mini Split W"),
    cell("240", true),
    cell("60", true),
    cell("14400", true),
    cell("PNL-H1-16"),
  ].join(""),
)}</table:table></office:spreadsheet></office:body></office:document-content>`;

const sheets = (): Sheet[] => parseOdsContentXml(CONTENT);

const baselineFrom = (xml: string, sha = PHASE_44A_BASELINE_SHA256) =>
  makeAdjudicationBaseline({
    ods_file_name: "PremoFarmElectrical.ods",
    ods_sha256: sha,
    sheets: parseOdsContentXml(xml),
  });

const manifestBaseline = () =>
  testBaseline({
    loads: [
      ["FS-082", "Mini Split SE", 82, 120, 0, null],
      ["FS-083", "Mini Split E", 83, 120, 0, null],
      ["FS-084", "Mini Split W", 84, 240, 60, 14400],
    ].map(([stable_id, description, row_, volts, amps, connected_va]) => ({
      stable_id: stable_id as string,
      description: description as string,
      worksheet: "Loads",
      row: row_ as number,
      volts: volts as number | null,
      amps: amps as number | null,
      connected_va: connected_va as number | null,
      open_questions: openQuestionsFor(stable_id as string),
    })),
  });

describe("Phase 4.4d canonical ODS revision generation", () => {
  it("locates the Volts column and the two authorized source cells", () => {
    const parsed = sheets();
    expect(loadFieldColumn(parsed[0], "volts")).toBe(3);
    const { targets, errors } = resolveRevisionTargets(baselineFrom(CONTENT), parsed);
    expect(errors).toEqual([]);
    expect(targets.map((t) => `${t.stable_id}:${t.row}:${t.column}:${t.baseline_value}->${t.candidate_value}`)).toEqual([
      "FS-082:2:3:120->240",
      "FS-083:3:3:120->240",
    ]);
  });

  it("rewrites exactly two cells and leaves everything else byte-identical", () => {
    const { targets } = resolveRevisionTargets(baselineFrom(CONTENT), sheets());
    let xml = CONTENT;
    for (const t of targets) {
      xml = rewriteOdsNumericCell(xml, {
        worksheet: t.worksheet,
        row: t.row,
        column: t.column,
        expected: t.baseline_value,
        next: t.candidate_value,
      });
    }
    // Style preserved, only the value/display text changed.
    expect(xml).toContain('table:style-name="ce7" office:value-type="float" office:value="240"');
    expect((xml.match(/office:value="240"/g) ?? []).length).toBe(3); // two rewritten + FS-084
    expect(xml).toContain('office:value="14400"'); // withheld VA untouched
    expect((xml.match(/office:value="60"/g) ?? []).length).toBe(1); // withheld Amps untouched

    const diff = diffSheetCells(parseOdsContentXml(CONTENT), parseOdsContentXml(xml));
    expect(diff).toEqual([
      { worksheet: "Loads", row: 2, column: 3, before: "120", after: "240" },
      { worksheet: "Loads", row: 3, column: 3, before: "120", after: "240" },
    ]);
  });

  it("refuses to rewrite a cell whose current value is not the authorized one", () => {
    expect(() =>
      rewriteOdsNumericCell(CONTENT, {
        worksheet: "Loads",
        row: 4,
        column: 3,
        expected: 120,
        next: 240,
      }),
    ).toThrow(/parses as 240, not the authorized 120/);
  });

  it("accepts only the 2-approved / 4-withheld manifest bound to the baseline SHA", () => {
    const set = revisionManifest(manifestBaseline());
    expect(manifestAuthorizesRevision(set)).toEqual({ ok: true });
    const foreign = revisionManifest({ ...manifestBaseline(), ods_sha256: "b".repeat(64), is_phase_44a_baseline: false });
    const guard = manifestAuthorizesRevision(foreign);
    expect(guard.ok).toBe(false);
  });

  it("reports 2 authorized / 0 unauthorized / 0 withheld changes and PASSes acceptance", () => {
    const baseline = baselineFrom(CONTENT);
    const { targets } = resolveRevisionTargets(baseline, sheets());
    let xml = CONTENT;
    for (const t of targets) {
      xml = rewriteOdsNumericCell(xml, {
        worksheet: t.worksheet,
        row: t.row,
        column: t.column,
        expected: t.baseline_value,
        next: t.candidate_value,
      });
    }
    const candidate = baselineFrom(xml, "c".repeat(64));
    const report = buildCandidateReport({
      baseline,
      candidate,
      manifest: revisionManifest(manifestBaseline()),
      manifest_sha256: "d".repeat(64),
      candidate_sha256: "c".repeat(64),
      candidate_file_name: "PremoFarmElectrical.candidate-cccccccccccc.ods",
      targets,
      cell_diff: diffSheetCells(parseOdsContentXml(CONTENT), parseOdsContentXml(xml)),
      non_content_archive_entries_changed: 0,
      generated_at: "2026-09-02T07:00:00.000Z",
    });

    expect(report.status).toBe(REVISION_STATUS_PROPOSED);
    expect(report.counts).toMatchObject({
      authorized_changed_cells: 2,
      unauthorized_changed_cells: 0,
      withheld_values_changed: 0,
    });
    expect(report.acceptance).toEqual({ status: "PASS", reasons: [] });
    expect(report.withheld.every((w) => w.unchanged)).toBe(true);
    expect(report.lineage).toEqual({
      superseded_sha256: PHASE_44A_BASELINE_SHA256,
      candidate_sha256: "c".repeat(64),
    });
    expect(report.baseline_overwritten).toBe(false);
    expect(report.farmops_written).toBe(false);
    expect(report.promotion_required).toBe(true);
    expect(candidateDiffCsv(report).split("\n")).toHaveLength(3);
  });

  it("FAILs acceptance when an unauthorized cell differs", () => {
    const baseline = baselineFrom(CONTENT);
    const { targets } = resolveRevisionTargets(baseline, sheets());
    const report = buildCandidateReport({
      baseline,
      candidate: baseline,
      manifest: revisionManifest(manifestBaseline()),
      manifest_sha256: "d".repeat(64),
      candidate_sha256: "c".repeat(64),
      candidate_file_name: "x.ods",
      targets,
      cell_diff: [{ worksheet: "Loads", row: 4, column: 4, before: "60", after: "25" }],
      non_content_archive_entries_changed: 0,
    });
    expect(report.counts.unauthorized_changed_cells).toBe(1);
    expect(report.acceptance.status).toBe("FAIL");
  });
});
