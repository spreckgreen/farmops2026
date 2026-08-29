import { describe, expect, it } from "vitest";
import {
  completionCorrectionsFromReport,
  compareLoads,
  loadCompareCsv,
  loadCompareMarkdown,
  odsOwnedLoadFields,
} from "@/lib/electrical-load-compare";

const db = [
  {
    load_id: "FS-097",
    area: "Farm Shop",
    description: "Welder receptacle",
    grid: "A6",
    amps: 50,
    volts: 240,
    demand_va: 12000,
    critical: false,
    completion_percent: 65,
    install_status: "installed",
    notes: "field note",
  },
  {
    load_id: "PH-028",
    area: "Pump House",
    description: "Well pump",
    grid: "PH",
    amps: 12,
    volts: 240,
    demand_va: null,
    critical: true,
    completion_percent: 0,
    install_status: "design",
    notes: null,
  },
  { load_id: "BL-003", area: "Boiler", description: "Boiler control", grid: "BL", critical: false },
];

describe("Load_Master field comparison", () => {
  it("compares ODS-owned fields only and never status/label/notes", () => {
    const keys = odsOwnedLoadFields().map((f) => f.key);
    expect(keys).toContain("amps");
    expect(keys).toContain("grid");
    expect(keys).not.toContain("install_status");
    expect(keys).not.toContain("label_status");
    expect(keys).not.toContain("notes");
  });

  it("reports conflicting engineering values without proposing a write", () => {
    const report = compareLoads(
      [
        {
          stableId: "FS-097",
          values: { area: "Farm Shop", description: "Welder receptacle", grid: "A6", amps: "60", volts: "240" },
        },
      ],
      db,
    );
    const amps = report.cells.find((c) => c.loadId === "FS-097" && c.field === "amps")!;
    expect(amps.verdict).toBe("mismatch");
    expect(amps.engineering).toBe(true);
    expect(amps.ods).toBe("60");
    expect(amps.farmops).toBe("50");
    // matching fields are not listed
    expect(report.cells.some((c) => c.field === "volts")).toBe(false);
  });

  it("separates blank-in-FarmOps from blank-in-workbook", () => {
    const report = compareLoads(
      [{ stableId: "PH-028", values: { area: "Pump House", description: "Well pump", grid: "PH", demand_va: "1500" } }],
      db,
    );
    const demand = report.cells.find((c) => c.field === "demand_va")!;
    expect(demand.verdict).toBe("farmops_blank");
    // FarmOps has amps 12, workbook column blank
    const amps = report.cells.find((c) => c.field === "amps")!;
    expect(amps.verdict).toBe("ods_blank");
  });

  it("flags an invalid workbook Grid instead of treating it as a mismatch", () => {
    const report = compareLoads([{ stableId: "FS-097", values: { grid: "0.00%" } }], db);
    const grid = report.cells.find((c) => c.field === "grid")!;
    expect(grid.verdict).toBe("invalid_ods_value");
    expect(grid.reason).toMatch(/percent/i);
  });

  it("treats numeric formatting differences as matches", () => {
    const report = compareLoads(
      [{ stableId: "FS-097", values: { amps: "50.00", demand_va: "12,000", completion_percent: "65%" } }],
      db,
    );
    expect(report.cells.some((c) => ["amps", "demand_va", "completion_percent"].includes(c.field))).toBe(
      false,
    );
  });

  it("builds a Complete %-only correction list and excludes workbook blanks", () => {
    const report = compareLoads(
      [
        { stableId: "FS-097", values: { completion_percent: "0.75" } },
        { stableId: "PH-028", values: { completion_percent: "" } },
        { stableId: "BL-003", values: { completion_percent: "12%" } },
      ],
      db,
    );
    expect(completionCorrectionsFromReport(report)).toEqual([
      { load_id: "FS-097", completion_percent: 75 },
      { load_id: "BL-003", completion_percent: 12 },
    ]);
  });

  it("lists set differences and duplicates", () => {
    const report = compareLoads(
      [
        { stableId: "FS-097", values: {} },
        { stableId: "FS-097", values: {} },
        { stableId: "FS-500", values: { area: "Farm Shop" } },
      ],
      db,
    );
    expect(report.duplicateOdsIds).toEqual(["FS-097"]);
    expect(report.missingInFarmOps).toEqual(["FS-500"]);
    expect(report.missingInOds).toEqual(["BL-003", "PH-028"]);
  });

  it("exports CSV and Markdown including set differences", () => {
    const report = compareLoads([{ stableId: "FS-097", values: { amps: "60" } }], db);
    const csv = loadCompareCsv(report);
    expect(csv.split("\n")[0]).toContain("load_id,field,label");
    expect(csv).toMatch(/FS-097,amps,Amps,engineering,60,50,mismatch/);
    expect(csv).toMatch(/PH-028,,,,,,missing_in_ods/);
    const md = loadCompareMarkdown(report);
    expect(md).toContain("# Load_Master field-by-field comparison");
    expect(md).toContain("Nothing in this report is written back automatically.");
  });
});
