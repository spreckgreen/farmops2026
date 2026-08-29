import { describe, expect, it } from "vitest";
import { buildGridAudit, classifyGrid, gridAuditCsv, isValidGrid } from "@/lib/electrical-grid";
import { classifySheet, mapSheet, parseOdsContentXml } from "@/lib/electrical-ods";
import { coerceValue } from "@/lib/electrical-entities";
import { farmShopWalkOrder, parseGrid } from "@/lib/electrical";

const TARGETS = ["load_id", "description", "area", "grid", "completion_percent", "notes"];

describe("grid validation", () => {
  it("accepts legitimate grid coordinates including half bays and via annotations", () => {
    expect(classifyGrid("A6")).toMatchObject({ status: "grid", value: "A6" });
    expect(classifyGrid(" a6 ")).toMatchObject({ status: "grid", value: "A6" });
    expect(classifyGrid("G5.5")).toMatchObject({ status: "grid", value: "G5.5" });
    expect(classifyGrid("E1 (via FS46)")).toMatchObject({
      status: "grid",
      value: "E1 (VIA FS46)",
    });
  });

  it("keeps area tokens and explicit unknown markers", () => {
    expect(classifyGrid("PH")).toMatchObject({ status: "area", value: "PH" });
    expect(classifyGrid("MOBILE")).toMatchObject({ status: "area", value: "MOBILE" });
    expect(classifyGrid("TBD")).toMatchObject({ status: "unknown", value: "TBD" });
    expect(classifyGrid("NA")).toMatchObject({ status: "unknown", value: "NA" });
    expect(classifyGrid("?")).toMatchObject({ status: "unknown", value: "?" });
  });

  it("blank stays blank rather than borrowing a neighbouring value", () => {
    expect(classifyGrid("")).toEqual({ status: "blank", value: null });
    expect(classifyGrid(null)).toEqual({ status: "blank", value: null });
  });

  it("rejects percents, ratings, bare numbers and descriptive text", () => {
    for (const bad of [
      "0.00%",
      "75%",
      "20A",
      "240V",
      "1200 VA",
      "12",
      "Lower Shop (Stainless Food)",
      "Source Circuit: D1",
    ]) {
      const c = classifyGrid(bad);
      expect(c.status, bad).toBe("invalid");
      expect(c.value).toBeNull();
      expect(c.reason, bad).toBeTruthy();
      expect(isValidGrid(bad)).toBe(false);
    }
  });

  it("entity coercion stores only valid grid values", () => {
    const field = { key: "grid", label: "Grid", kind: "text" } as const;
    expect(coerceValue(field, "a6")).toBe("A6");
    expect(coerceValue(field, "0.00%")).toBeNull();
    expect(coerceValue(field, "")).toBeNull();
  });
});

// Repeated + empty cells are exactly what made columns drift: an ODS row uses
// `number-columns-repeated` for runs of blanks, so the parser must expand them.
const CONTENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
<office:body><office:spreadsheet>
<table:table table:name="Load_Master">
  <table:table-row>
    <table:table-cell><text:p>Bostead Farms — electrical release 2026-03</text:p></table:table-cell>
  </table:table-row>
  <table:table-row>
    <table:table-cell><text:p>Load ID</text:p></table:table-cell>
    <table:table-cell><text:p>Load Description</text:p></table:table-cell>
    <table:table-cell><text:p>Area</text:p></table:table-cell>
    <table:table-cell><text:p>Grid</text:p></table:table-cell>
    <table:table-cell><text:p>Complete %</text:p></table:table-cell>
    <table:table-cell><text:p>Notes</text:p></table:table-cell>
  </table:table-row>
  <table:table-row>
    <table:table-cell><text:p>FS-002</text:p></table:table-cell>
    <table:table-cell><text:p>Outside corner receptacle</text:p></table:table-cell>
    <table:table-cell><text:p>Farm Shop</text:p></table:table-cell>
    <table:table-cell><text:p>A6</text:p></table:table-cell>
    <table:table-cell><text:p>75%</text:p></table:table-cell>
    <table:table-cell><text:p>NE corner</text:p></table:table-cell>
  </table:table-row>
  <table:table-row>
    <table:table-cell><text:p>FS-018</text:p></table:table-cell>
    <table:table-cell><text:p>Lower shop bench</text:p></table:table-cell>
    <table:table-cell table:number-columns-repeated="2"/>
    <table:table-cell><text:p>0.00%</text:p></table:table-cell>
    <table:table-cell><text:p>TBD</text:p></table:table-cell>
  </table:table-row>
  <table:table-row>
    <table:table-cell><text:p>BL-003</text:p></table:table-cell>
    <table:table-cell><text:p>Boiler east</text:p></table:table-cell>
    <table:table-cell><text:p>Boiler</text:p></table:table-cell>
    <table:table-cell><text:p>BL</text:p></table:table-cell>
    <table:table-cell/>
    <table:table-cell>
      <office:annotation><text:p>check with Rich</text:p></office:annotation>
      <text:p>Source Circuit: S3</text:p>
    </table:table-cell>
  </table:table-row>
  <table:table-row>
    <table:table-cell><text:p>PH-028</text:p></table:table-cell>
    <table:table-cell><text:p>Pump house control</text:p></table:table-cell>
    <table:table-cell table:number-columns-repeated="3"/>
    <table:table-cell><text:p>waiting on trench</text:p></table:table-cell>
  </table:table-row>
</table:table>
</office:spreadsheet></office:document-content>`;

describe("ODS Grid column mapping (repeated / empty cells)", () => {
  const sheet = parseOdsContentXml(CONTENT_XML)[0];
  const mapped = mapSheet(sheet, classifySheet(sheet), TARGETS, "load_id");
  const byId = Object.fromEntries(mapped.rows.map((r) => [r.stableId, r.values]));

  it("skips the title row and binds columns by header name", () => {
    expect(mapped.headerRow).toBe(1);
    expect(mapped.columns.map((c) => c.target)).toEqual(TARGETS);
  });

  it("expands repeated empty cells so later columns cannot drift left", () => {
    expect(byId["FS-018"]?.["area"]).toBeUndefined();
    expect(byId["FS-018"]?.["completion_percent"]).toBe("0.00%");
    expect(byId["FS-018"]?.["notes"]).toBe("TBD");
    expect(byId["PH-028"]?.["notes"]).toBe("waiting on trench");
    expect(byId["PH-028"]?.["grid"]).toBeUndefined();
    expect(byId["PH-028"]?.["completion_percent"]).toBeUndefined();
  });

  it("never lets a percent or note land in Grid, and reports the rejection", () => {
    expect(byId["FS-002"]?.["grid"]).toBe("A6");
    expect(byId["BL-003"]?.["grid"]).toBe("BL");
    expect(byId["FS-018"]?.["grid"]).toBeUndefined();
    expect(mapped.rejected.filter((r) => r.column === "grid")).toEqual([]);
  });

  it("ignores cell annotations instead of treating them as values", () => {
    expect(byId["BL-003"]?.["notes"]).toBe("Source Circuit: S3");
  });

  it("rejects a drifted percent supplied in the Grid column itself", () => {
    const drifted = CONTENT_XML.replace("<text:p>A6</text:p>", "<text:p>0.00%</text:p>");
    const s2 = parseOdsContentXml(drifted)[0];
    const m2 = mapSheet(s2, classifySheet(s2), TARGETS, "load_id");
    const row = m2.rows.find((r) => r.stableId === "FS-002")!;
    expect(row.values["grid"]).toBeUndefined();
    expect(m2.rejected).toEqual([
      expect.objectContaining({ stableId: "FS-002", column: "grid", value: "0.00%" }),
    ]);
  });
});

describe("grid audit report", () => {
  const loads = [
    { load_id: "FS-002", grid: "A6" },
    { load_id: "FS-018", grid: "0.00%" },
    { load_id: "FS-019", grid: "e5" },
    { load_id: "BL-003", grid: "BL" },
    { load_id: "PH-028", grid: null },
  ];

  it("keeps valid values, clears junk, and never invents a coordinate", () => {
    const audit = buildGridAudit(loads);
    const byId = Object.fromEntries(audit.rows.map((r) => [r.load_id, r]));
    expect(byId["FS-002"].action).toBe("ok");
    expect(byId["FS-018"]).toMatchObject({ action: "clear", corrected_grid: null });
    expect(byId["FS-019"]).toMatchObject({ action: "correct", corrected_grid: "E5" });
    expect(byId["BL-003"].action).toBe("ok");
    expect(byId["PH-028"]).toMatchObject({ action: "ok", corrected_grid: null });
    expect(audit.summary.total).toBe(5);
  });

  it("prefers the canonical ODS value and flags invalid workbook values", () => {
    const audit = buildGridAudit(loads, { "FS-018": "C4", "FS-002": "50%" });
    const byId = Object.fromEntries(audit.rows.map((r) => [r.load_id, r]));
    expect(byId["FS-018"]).toMatchObject({ action: "correct", corrected_grid: "C4", ods_grid: "C4" });
    expect(byId["FS-002"].action).toBe("unresolved");
  });

  it("exports a CSV with the required columns", () => {
    const csv = gridAuditCsv(buildGridAudit(loads));
    expect(csv.split("\n")[0]).toBe(
      "Load ID,ODS Grid,Previous FarmOps Grid,Corrected FarmOps Grid,Action,Status,Reason",
    );
    expect(csv).toContain('"FS-018","","0.00%","","clear"');
  });
});

describe("A6 remains the NE corner after grid cleanup", () => {
  it("parses corner coordinates and keeps the clockwise outside-in walk", () => {
    expect(parseGrid("A6")).toMatchObject({ row: 1, col: 6 });
    const order = farmShopWalkOrder(["A1", "A6", "G6", "G1", "D3", "0.00%", "", "TBD"]);
    expect(order[0]).toBe("A6");
    expect(order.slice(0, 4)).toEqual(["A6", "G6", "G1", "A1"]);
    expect(order).toContain("D3");
    expect(order.some((g) => g.includes("%"))).toBe(false);
  });
});
