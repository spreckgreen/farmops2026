import { describe, expect, it } from "vitest";
import {
  LABEL_KINDS,
  PRINT_GROUPS,
  filterLabelRecords,
  itemQrUrl,
  labelColumns,
  labelLines,
  labelWalkGroups,
  locationKeyOf,
  panelKeyOf,
  panelOptions,
  shortLabelText,
  sortLabelRecords,
  type LabelRecord,
} from "@/lib/electrical-labels";
import { LABEL_FORMATS } from "@/components/electrical/panel-qr-label";
import { ENTITIES } from "@/lib/electrical-entities";

function load(id: string, values: Record<string, string>): LabelRecord {
  return { id: `uuid-${id}`, kind: "load", stable_id: id, values };
}

describe("label field selection", () => {
  it("only ever asks for columns the entity actually defines", () => {
    for (const kind of LABEL_KINDS) {
      const def = ENTITIES[kind];
      const known = new Set([
        "id",
        def.stableIdField,
        ...def.fields.map((f) => f.key),
        "circuit_group_uuid",
      ]);
      for (const col of labelColumns(kind)) {
        expect(known.has(col), `${kind}.${col}`).toBe(true);
      }
    }
  });
});

describe("load label ordering", () => {
  it("orders by panel, then Farm Shop walk order, then stable ID", () => {
    const records = [
      load("FS-090", { suggested_panel: "PNL-FS-EQ", grid: "B6" }),
      load("FS-010", { suggested_panel: "PNL-FS-EQ", grid: "A6" }),
      load("FS-005", { suggested_panel: "PNL-BLR", grid: "G6" }),
      load("FS-200", { grid: "A6" }), // no panel — prints last
      load("FS-011", { suggested_panel: "PNL-FS-EQ", grid: "A6" }),
    ];
    const order = sortLabelRecords(records).map((r) => r.stable_id);
    // PNL-BLR before PNL-FS-EQ; A6 (walk start) before B6; ties alphabetical.
    expect(order).toEqual(["FS-005", "FS-010", "FS-011", "FS-090", "FS-200"]);
  });

  it("uses the linked circuit group's panel when no panel is suggested", () => {
    const record = load("FS-034", { circuit_group_panel: "PNL-H1" });
    expect(panelKeyOf(record)).toBe("PNL-H1");
  });

  it("never invents a panel from a non-panel reference", () => {
    expect(panelKeyOf(load("FS-050", { circuit_group_ref: "CKT-12" }))).toBe("");
  });
});

describe("print scope", () => {
  const records = [
    load("FS-001", { suggested_panel: "PNL-H1", area: "House" }),
    load("FS-002", { suggested_panel: "PNL-FS-EQ", area: "Farm Shop" }),
  ];

  it("scopes to one panel", () => {
    const out = filterLabelRecords(records, { mode: "panel", value: "PNL-H1" });
    expect(out.map((r) => r.stable_id)).toEqual(["FS-001"]);
  });

  it("scopes to one location", () => {
    const out = filterLabelRecords(records, { mode: "location", value: "Farm Shop" });
    expect(out.map((r) => r.stable_id)).toEqual(["FS-002"]);
    expect(locationKeyOf(records[1]!)).toBe("Farm Shop");
  });

  it("keeps everything under all records and offers each panel", () => {
    expect(filterLabelRecords(records, { mode: "all" })).toHaveLength(2);
    expect(panelOptions(records)).toEqual(["PNL-FS-EQ", "PNL-H1"]);
  });
});

describe("label content", () => {
  it("skips blank fields and appends units", () => {
    const lines = labelLines(load("FS-001", { description: "Well pump", amps: "12" }));
    expect(lines).toEqual([
      { label: "Load", value: "Well pump" },
      { label: "Amps", value: "12 A" },
    ]);
  });

  it("shortens to something an Avery 8593 cell can hold", () => {
    const text = shortLabelText(
      load("FS-001", {
        description: "Well pump controller with a very long descriptive name",
        area: "Farm Shop",
        grid: "A6",
      }),
    );
    expect(text.length).toBeLessThanOrEqual(44);
    expect(text).toContain("Well pump");
  });

  it("encodes the record detail URL", () => {
    expect(itemQrUrl("https://bostead.lovable.app/", "raceway", "abc")).toBe(
      "https://bostead.lovable.app/electrical/item/raceway/abc",
    );
  });
});

describe("print formats and groups", () => {
  it("Avery 8593 is a 30-per-sheet shortened, QR-free format", () => {
    const spec = LABEL_FORMATS["avery-8593"];
    expect(spec.perPage).toBe(30);
    expect(spec.cols * spec.rows).toBe(30);
    expect(spec.short).toBe(true);
  });

  it("the rough-in group covers conduit, J-box, branch and load", () => {
    const group = PRINT_GROUPS.find((g) => g.id === "rough-in")!;
    expect(group.kinds).toEqual(["raceway", "jbox", "branch", "load"]);
  });

  it("every print group only names printable kinds", () => {
    for (const g of PRINT_GROUPS) for (const k of g.kinds) expect(LABEL_KINDS).toContain(k);
  });
});

describe("Avery 8593 walk order", () => {
  it("groups by location then panel, and walks grid then load name", () => {
    const records = [
      load("FS-002", { area: "Farm Shop", suggested_panel: "PNL-FS-EQ", grid: "B6", description: "Zebra" }),
      load("FS-001", { area: "Farm Shop", suggested_panel: "PNL-FS-EQ", grid: "A6", description: "Anvil" }),
      load("FS-003", { area: "Farm Shop", suggested_panel: "PNL-FS-EQ", grid: "A6", description: "Bench" }),
      load("FS-004", { area: "Farm Shop", suggested_panel: "PNL-BLR", grid: "G6", description: "Boiler" }),
      load("H-001", { area: "House", suggested_panel: "PNL-H1", grid: "", description: "Fridge" }),
    ];
    const groups = labelWalkGroups(records);
    expect(groups.map((g) => [g.location, g.panel])).toEqual([
      ["Farm Shop", "PNL-BLR"],
      ["Farm Shop", "PNL-FS-EQ"],
      ["House", "PNL-H1"],
    ]);
    expect(groups[1]!.records.map((r) => r.stable_id)).toEqual(["FS-001", "FS-003", "FS-002"]);
  });
});
