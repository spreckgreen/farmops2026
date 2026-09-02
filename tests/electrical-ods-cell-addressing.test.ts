import { describe, expect, it } from "vitest";
import {
  locateOdsLogicalCell,
  parseOdsContentXml,
  classifySheet,
} from "@/lib/electrical-ods";
import {
  diffSheetCells,
  inspectRevisionTarget,
  loadFieldColumn,
  rewriteOdsNumericCell,
} from "@/lib/electrical-ods-revision";

// A Load_Master worksheet reproducing the structural constructs that made the
// 4.4d writer disagree with the canonical parser: a repeated filler row group
// ahead of the targets, repeated empty column groups, a covered cell, a cell
// annotation containing <text:p>, and a Volts cell stored as text on one row
// and as a float on the next. FS-082 must land on logical row 120 column 15 and
// FS-083 on logical row 121 column 15 for both the parser and the writer.
const cellText = (v: string) => `<table:table-cell office:value-type="string"><text:p>${v}</text:p></table:table-cell>`;
const empties = (n: number) =>
  `<table:table-cell table:number-columns-repeated="${n}"/>`;
const row = (inner: string, attrs = "") =>
  `<table:table-row table:style-name="ro1"${attrs}>${inner}</table:table-row>`;

const HEADERS = [
  "Load ID",
  "Load Description",
  "", "", "", "", "", "", "", "", "", "", "", "",
  "Volts",
  "Amps",
];

function contentXml(): string {
  const header = row(
    [
      cellText(HEADERS[0]),
      cellText(HEADERS[1]),
      empties(12),
      cellText("Volts"),
      cellText("Amps"),
    ].join(""),
  );

  const filler = row(
    [cellText("FS-000"), cellText("filler"), empties(12), cellText("0"), cellText("0")].join(""),
    ' table:number-rows-repeated="117"',
  );

  // FS-082: Volts stored as a text cell, preceded by a repeated empty group, a
  // covered (merged) cell and a cell carrying an annotation.
  const fs082 = row(
    [
      cellText("FS-082"),
      `<table:table-cell office:value-type="string"><office:annotation><text:p>ignore me</text:p></office:annotation><text:p>Mini Split SE</text:p></table:table-cell>`,
      empties(6),
      `<table:covered-table-cell/>`,
      empties(5),
      `<table:table-cell table:style-name="ce7" office:value-type="string"><text:p>120</text:p></table:table-cell>`,
      `<table:table-cell office:value-type="float" office:value="0"><text:p>0</text:p></table:table-cell>`,
    ].join(""),
  );

  // FS-083: Volts stored as a float cell with a style, same logical column.
  const fs083 = row(
    [
      cellText("FS-083"),
      cellText("Mini Split E"),
      empties(11),
      `<table:covered-table-cell/>`,
      `<table:table-cell table:style-name="ce7" office:value-type="float" office:value="120"><text:p>120</text:p></table:table-cell>`,
      `<table:table-cell office:value-type="float" office:value="0"><text:p>0</text:p></table:table-cell>`,
    ].join(""),
  );

  return `<?xml version="1.0" encoding="UTF-8"?><office:document-content><office:body><office:spreadsheet><table:table table:name="Load_Master"><table:table-column table:number-columns-repeated="16"/>${header}${filler}${fs082}${fs083}</table:table></office:spreadsheet></office:body></office:document-content>`;
}

describe("Phase 4.4d — parser and writer share one ODS addressing model", () => {
  const xml = contentXml();
  const sheets = parseOdsContentXml(xml);
  const sheet = sheets.find((s) => s.name === "Load_Master")!;

  it("parses FS-082 to row 120 and FS-083 to row 121 with Volts in column 15", () => {
    expect(classifySheet(sheet)).toBe("load");
    expect(loadFieldColumn(sheet, "volts")).toBe(15);
    expect(sheet.rows[119][0]).toBe("FS-082");
    expect(sheet.rows[120][0]).toBe("FS-083");
    expect(sheet.rows[119][14]).toBe("120");
    expect(sheet.rows[120][14]).toBe("120");
    // The annotation text is never a cell value.
    expect(sheet.rows[119][1]).toBe("Mini Split SE");
  });

  it("resolves the same logical cell in the writer, with physical index ≠ logical column", () => {
    const a = locateOdsLogicalCell(xml, "Load_Master", 120, 15)!;
    const b = locateOdsLogicalCell(xml, "Load_Master", 121, 15)!;
    expect(a.parsedValue).toBe("120");
    expect(b.parsedValue).toBe("120");
    // Repeated column groups collapse many logical columns into few XML cells.
    expect(a.physicalCellIndex).toBeLessThan(14);
    expect(b.physicalCellIndex).toBeLessThan(14);
    expect(a.valueType).toBe("string");
    expect(b.valueType).toBe("float");
    expect(b.officeValue).toBe("120");
    expect(a.rowRepeat).toBe(1);
    expect(a.columnRepeat).toBe(1);
  });

  it("asserts both authorized targets before mutating", () => {
    const t1 = inspectRevisionTarget(xml, {
      stable_id: "FS-082",
      field: "volts",
      worksheet: "Load_Master",
      row: 120,
      column: 15,
      expected: 120,
      next: 240,
    });
    const t2 = inspectRevisionTarget(xml, {
      stable_id: "FS-083",
      field: "volts",
      worksheet: "Load_Master",
      row: 121,
      column: 15,
      expected: 120,
      next: 240,
    });
    expect(t1.assertion).toBe("PASS");
    expect(t1.rewrite_mode).toBe("string_value_and_text");
    expect(t1.display_text).toBe("120");
    expect(t2.assertion).toBe("PASS");
    expect(t2.rewrite_mode).toBe("office_value_and_text");
    expect(t2.office_value).toBe("120");
  });

  it("rewrites exactly the two authorized cells and nothing else", () => {
    let next = xml;
    for (const r of [120, 121]) {
      next = rewriteOdsNumericCell(next, {
        stable_id: r === 120 ? "FS-082" : "FS-083",
        field: "volts",
        worksheet: "Load_Master",
        row: r,
        column: 15,
        expected: 120,
        next: 240,
      });
    }
    const after = parseOdsContentXml(next);
    const diff = diffSheetCells(sheets, after);
    expect(diff).toEqual([
      { worksheet: "Load_Master", row: 120, column: 15, before: "120", after: "240" },
      { worksheet: "Load_Master", row: 121, column: 15, before: "120", after: "240" },
    ]);
    // Typing is preserved per cell: the text cell stays text, the float cell
    // keeps its office:value.
    const a = locateOdsLogicalCell(next, "Load_Master", 120, 15)!;
    const b = locateOdsLogicalCell(next, "Load_Master", 121, 15)!;
    expect(a.valueType).toBe("string");
    expect(b.officeValue).toBe("240");
    expect(a.attrs).toContain('table:style-name="ce7"');
    expect(b.attrs).toContain('table:style-name="ce7"');
  });

  it("still fails closed when the located cell does not hold the authorized value", () => {
    const t = inspectRevisionTarget(xml, {
      stable_id: "FS-082",
      field: "volts",
      worksheet: "Load_Master",
      row: 120,
      column: 16,
      expected: 120,
      next: 240,
    });
    expect(t.assertion).toBe("FAIL");
    expect(t.reason).toContain("not the authorized 120");
    expect(() =>
      rewriteOdsNumericCell(xml, {
        worksheet: "Load_Master",
        row: 3,
        column: 15,
        expected: 120,
        next: 240,
      }),
    ).toThrow(/repeated row group|not the authorized/);
  });
});
