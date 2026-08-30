import { describe, expect, it } from "vitest";
import {
  ODS_EXTRAS_FIELD,
  ODS_EXTRAS_SOURCE_KEY,
  mergeOdsExtras,
  parseOdsExtras,
  preservedOdsValues,
} from "@/lib/electrical";
import { buildPlanSheet, mapSheet } from "@/lib/electrical-ods";
import { importColumns } from "@/lib/electrical-entities";

const captureOf = (values: Record<string, string>) =>
  parseOdsExtras(values[ODS_EXTRAS_FIELD]) as Record<string, unknown>;

describe("Phase 4.4a — capture is additive across canonical worksheets", () => {
  it("keeps keys preserved by an earlier worksheet when a later one is imported", () => {
    const first = JSON.stringify({
      "Calculated Complete %": "62",
      "Installation Notes": "Pulled 2025-04",
      [ODS_EXTRAS_SOURCE_KEY]: {
        "Calculated Complete %": { sheet: "Load_Master", header: "Calculated Complete %", column: 8 },
        "Installation Notes": { sheet: "Load_Master", header: "Installation Notes", column: 9 },
      },
    });
    const second = JSON.stringify({
      "Circuit Group ID#32": "CG-12",
      [ODS_EXTRAS_SOURCE_KEY]: {
        "Circuit Group ID#32": { sheet: "Circuit_Groups", header: "Circuit Group ID", column: 32 },
      },
    });
    const merged = parseOdsExtras(mergeOdsExtras(first, second))!;
    expect(merged["Calculated Complete %"]).toBe("62");
    expect(merged["Installation Notes"]).toBe("Pulled 2025-04");
    expect(merged["Circuit Group ID#32"]).toBe("CG-12");
    const src = merged[ODS_EXTRAS_SOURCE_KEY] as Record<string, { sheet: string }>;
    expect(src["Installation Notes"]!.sheet).toBe("Load_Master");
    expect(src["Circuit Group ID#32"]!.sheet).toBe("Circuit_Groups");
  });

  it("never collapses collision-safe duplicate keys onto their bare header", () => {
    const merged = parseOdsExtras(
      mergeOdsExtras(
        JSON.stringify({ "Circuit Group Description#10": "Shop lighting" }),
        JSON.stringify({ "Circuit Group Description#33": "Shop receptacles" }),
      ),
    )!;
    expect(Object.keys(merged).sort()).toEqual([
      "Circuit Group Description#10",
      "Circuit Group Description#33",
    ]);
    expect(merged["Circuit Group Description"]).toBeUndefined();
  });

  it("proposes the merged capture in the import plan instead of an overwrite", () => {
    const mapped = mapSheet(
      {
        name: "Circuit_Groups",
        rows: [
          ["Load ID", "Circuit Group Description", "Circuit Group Description"],
          ["FS-042", "Shop lighting", "Shop receptacles"],
        ],
      },
      "load",
      importColumns("load"),
      "load_id",
    );
    const plan = buildPlanSheet(
      mapped,
      {
        "FS-042": {
          id: "11111111-1111-1111-1111-111111111111",
          load_id: "FS-042",
          [ODS_EXTRAS_FIELD]: JSON.stringify({ "Installation Notes": "Pulled 2025-04" }),
        },
      },
      "load_id",
    );
    const change = plan.rows[0]!.changes.find((c) => c.column === ODS_EXTRAS_FIELD)!;
    const to = parseOdsExtras(change.to)!;
    expect(to["Installation Notes"]).toBe("Pulled 2025-04");
    expect(Object.keys(to).filter((k) => k.startsWith("Circuit Group Description"))).toHaveLength(2);
  });
});

describe("Phase 4.4a — every populated cell reaches a preservation destination", () => {
  it("preserves the verbatim canonical text of a transformed (kVA -> VA) column", () => {
    const mapped = mapSheet(
      { name: "Load_Master", rows: [["Load ID", "Connected kVA"], ["FS-042", "3.6"]] },
      "load",
      importColumns("load"),
      "load_id",
    );
    expect(mapped.rows[0]!.values["connected_va"]).toBe("3600");
    expect(preservedOdsValues(captureOf(mapped.rows[0]!.values), "Load_Master", "Connected kVA")).toEqual([
      "3.6",
    ]);
  });

  it("preserves a cell that column validation refused instead of dropping it", () => {
    const mapped = mapSheet(
      { name: "Load_Master", rows: [["Load ID", "Grid"], ["FS-042", "not a grid ref"]] },
      "load",
      importColumns("load"),
      "load_id",
    );
    expect(mapped.rejected[0]!.column).toBe("grid");
    expect(mapped.rows[0]!.values["grid"]).toBeUndefined();
    expect(preservedOdsValues(captureOf(mapped.rows[0]!.values), "Load_Master", "Grid")).toEqual([
      "not a grid ref",
    ]);
  });

  it("keys a collided non-duplicate header by its worksheet column", () => {
    const mapped = mapSheet(
      { name: "Load_Master", rows: [["Load ID", "Notes", "Comments"], ["FS-042", "a", "b"]] },
      "load",
      importColumns("load"),
      "load_id",
    );
    const extras = captureOf(mapped.rows[0]!.values);
    expect(Object.keys(extras)).toContain("Comments#3");
    expect(extras["Comments"]).toBeUndefined();
    expect(preservedOdsValues(extras, "Load_Master", "Comments")).toEqual(["b"]);
  });
});
