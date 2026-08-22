import { describe, it, expect } from "vitest";
import { validateInventoryCsv } from "@/lib/inventory-csv-validate";

const headers = [
  "id",
  "name",
  "quantity",
  "min_quantity",
  "status",
  "barcode",
  "tags",
];

const row = (o: Record<string, string>) => ({
  id: "",
  name: "",
  quantity: "",
  min_quantity: "",
  status: "",
  barcode: "",
  tags: "",
  ...o,
});

describe("validateInventoryCsv", () => {
  it("accepts a clean file", () => {
    const r = validateInventoryCsv(
      [row({ name: "Boiler manifold", quantity: "3", status: "available", tags: "shop;steel" })],
      { headers },
    );
    expect(r.ok).toBe(true);
    expect(r.totalRows).toBe(1);
    expect(r.issues).toHaveLength(0);
  });

  it("flags missing name, bad number and bad status with line numbers", () => {
    const r = validateInventoryCsv(
      [row({ name: "", quantity: "abc", status: "broken" })],
      { headers },
    );
    expect(r.ok).toBe(false);
    expect(r.badRows).toEqual([1]);
    expect(r.errors.map((e) => e.field).sort()).toEqual(["name", "quantity", "status"]);
    expect(r.errors[0].line).toBe(2);
  });

  it("rejects non-UUID ids and duplicate barcodes", () => {
    const r = validateInventoryCsv(
      [
        row({ name: "A", id: "42", barcode: "X1" }),
        row({ name: "B", barcode: "x1" }),
      ],
      { headers },
    );
    expect(r.errors.some((e) => e.field === "id")).toBe(true);
    expect(r.errors.some((e) => e.field === "barcode" && e.row === 2)).toBe(true);
  });

  it("warns on comma tags and unknown ids, skips blank rows", () => {
    const r = validateInventoryCsv(
      [
        row({ name: "A", tags: "a,b", id: "11111111-1111-1111-1111-111111111111" }),
        row({}),
      ],
      { headers, knownIds: ["22222222-2222-2222-2222-222222222222"] },
    );
    expect(r.ok).toBe(true);
    expect(r.blankRows).toBe(1);
    expect(r.warnings.map((w) => w.field).sort()).toEqual(["id", "tags"]);
  });

  it("errors when the name column is absent", () => {
    const r = validateInventoryCsv([{ quantity: "1" }], { headers: ["quantity"] });
    expect(r.ok).toBe(false);
    expect(r.missingColumns).toEqual(["name"]);
  });
});
