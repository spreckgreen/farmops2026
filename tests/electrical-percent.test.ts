import { describe, expect, it } from "vitest";
import { parsePercent } from "@/lib/electrical";
import { coerceValue } from "@/lib/electrical-entities";
import { classifySheet, mapSheet, parseOdsContentXml } from "@/lib/electrical-ods";

const pctField = { key: "completion_percent", label: "Complete %", kind: "number" } as const;

describe("parsePercent", () => {
  it("treats blanks and non-numeric text as unknown, never 0", () => {
    for (const raw of ["", "   ", null, undefined, "n/a", "N/A", "TBD", "-", "done", "1e3%"]) {
      expect(parsePercent(raw)).toBeNull();
    }
  });

  it("parses 0-100 values, with or without a percent sign", () => {
    expect(parsePercent("65")).toBe(65);
    expect(parsePercent("65%")).toBe(65);
    expect(parsePercent(" 65 % ")).toBe(65);
    expect(parsePercent(65)).toBe(65);
    expect(parsePercent("100")).toBe(100);
    expect(parsePercent("100%")).toBe(100);
    expect(parsePercent("0")).toBe(0);
    expect(parsePercent("0%")).toBe(0);
  });

  it("expands stored 0-1 fractions to whole percents", () => {
    expect(parsePercent("0.65")).toBe(65);
    expect(parsePercent(".65")).toBe(65);
    expect(parsePercent(0.075)).toBe(8);
    expect(parsePercent("1")).toBe(100);
    expect(parsePercent("1.0")).toBe(100);
  });

  it("lets an explicit percent sign win over the fraction rule", () => {
    expect(parsePercent("0.5%")).toBe(1); // half a percent, rounded
    expect(parsePercent("1%")).toBe(1);
  });

  it("strips separators, rounds, and clamps out-of-range values", () => {
    expect(parsePercent("1,00")).toBe(100);
    expect(parsePercent("65.4%")).toBe(65);
    expect(parsePercent("65.6%")).toBe(66);
    expect(parsePercent("250")).toBe(100);
    expect(parsePercent("-10")).toBe(0);
  });

  it("is the same parser the entity forms use", () => {
    expect(coerceValue(pctField, "0.65")).toBe(65);
    expect(coerceValue(pctField, "65%")).toBe(65);
    expect(coerceValue(pctField, "")).toBeNull();
    expect(coerceValue(pctField, "n/a")).toBeNull();
  });
});

/**
 * Regression fixture shaped like the canonical PremoFarmElectrical.ods
 * Load_Master sheet: a "Complete %" column whose cells arrive as display text
 * in every format the workbook actually produces.
 */
const CONTENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
<office:body><office:spreadsheet>
<table:table table:name="Load_Master">
  <table:table-row>
    <table:table-cell><text:p>Load ID</text:p></table:table-cell>
    <table:table-cell><text:p>Description</text:p></table:table-cell>
    <table:table-cell><text:p>Complete %</text:p></table:table-cell>
  </table:table-row>
  <table:table-row>
    <table:table-cell><text:p>FS-097</text:p></table:table-cell>
    <table:table-cell><text:p>Shop NE receptacle</text:p></table:table-cell>
    <table:table-cell><text:p>65%</text:p></table:table-cell>
  </table:table-row>
  <table:table-row>
    <table:table-cell><text:p>FS-098</text:p></table:table-cell>
    <table:table-cell><text:p>Shop NW lighting</text:p></table:table-cell>
    <table:table-cell><text:p>0.65</text:p></table:table-cell>
  </table:table-row>
  <table:table-row>
    <table:table-cell><text:p>PH-028</text:p></table:table-cell>
    <table:table-cell><text:p>Pump house control</text:p></table:table-cell>
    <table:table-cell><text:p>100</text:p></table:table-cell>
  </table:table-row>
  <table:table-row>
    <table:table-cell><text:p>BL-003</text:p></table:table-cell>
    <table:table-cell><text:p>Boiler feed</text:p></table:table-cell>
    <table:table-cell><text:p> 12 % </text:p></table:table-cell>
  </table:table-row>
  <table:table-row>
    <table:table-cell><text:p>FS-099</text:p></table:table-cell>
    <table:table-cell><text:p>Future welder outlet</text:p></table:table-cell>
    <table:table-cell><text:p></text:p></table:table-cell>
  </table:table-row>
</table:table>
</office:spreadsheet></office:body></office:document-content>`;

describe("Complete % import regression (Load_Master fixture)", () => {
  const sheets = parseOdsContentXml(CONTENT_XML);
  const sheet = sheets[0];

  it("classifies the sheet and binds the Complete % header", () => {
    expect(sheet.name).toBe("Load_Master");
    const kind = classifySheet(sheet);
    expect(kind).toBe("load");
    const mapped = mapSheet(sheet, kind, ["load_id", "description", "completion_percent"], "load_id");
    expect(mapped.columns.map((c) => c.target)).toContain("completion_percent");
  });

  it("coerces every workbook percent format to whole percents", () => {
    const mapped = mapSheet(
      sheet,
      classifySheet(sheet),
      ["load_id", "description", "completion_percent"],
      "load_id",
    );
    const got = Object.fromEntries(
      mapped.rows.map((r) => [r.stableId, coerceValue(pctField, r.values["completion_percent"])]),
    );
    expect(got).toEqual({
      "FS-097": 65,
      "FS-098": 65,
      "PH-028": 100,
      "BL-003": 12,
      "FS-099": null, // blank cell stays unknown so status defaults can apply
    });
  });
});
