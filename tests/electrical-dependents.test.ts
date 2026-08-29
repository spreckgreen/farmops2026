import { describe, expect, it } from "vitest";
import { dependencySummary, dependentSpecs, diffFieldChanges } from "@/lib/electrical-dependents";

describe("dependentSpecs", () => {
  it("finds every FK pointing at a panel", () => {
    const cols = dependentSpecs("panel").map((s) => `${s.kind}.${s.fkColumn}`);
    expect(cols).toEqual([
      "raceway.source_panel_uuid",
      "raceway.dest_panel_uuid",
      "branch.source_panel_uuid",
      "circuit_group.panel_uuid",
    ]);
    expect(dependentSpecs("panel")[0]!.fieldLabel).toBe("Source panel");
  });

  it("finds loads referenced by branch runs", () => {
    expect(dependentSpecs("load").map((s) => s.fkColumn)).toEqual(["load_uuid"]);
  });

  it("returns nothing for kinds nothing points at", () => {
    expect(dependentSpecs("branch")).toEqual([]);
  });

  it("summarises a report for toasts", () => {
    const summary = dependencySummary({
      kind: "panel",
      total: 3,
      groups: [
        {
          kind: "raceway",
          title: "Raceways",
          fkColumn: "source_panel_uuid",
          fieldLabel: "Source panel",
          rows: [
            { id: "a", stableId: "CON-001", description: null },
            { id: "b", stableId: "CON-002", description: null },
          ],
        },
      ],
      children: [{ title: "Waypoints", count: 1, hint: "" }],
    });
    expect(summary).toBe("2 raceways (Source panel), 1 waypoints");
  });
});

describe("diffFieldChanges", () => {
  it("reports only columns whose value actually changes", () => {
    const before = { source_panel_uuid: "abc", source_endpoint_ref: "PNL-H1", notes: "keep" };
    const { changes, unchanged } = diffFieldChanges(before, {
      source_panel_uuid: null,
      source_endpoint_ref: "PNL-H1",
    });
    expect(unchanged).toEqual(["source_endpoint_ref"]);
    expect(changes).toEqual([
      { column: "source_panel_uuid", before: "abc", after: null },
    ]);
  });

  it("orders changes deterministically and normalizes empty values", () => {
    const { changes } = diffFieldChanges(
      { b: "", a: 1 },
      { b: "x", a: 2 },
    );
    expect(changes.map((c) => c.column)).toEqual(["a", "b"]);
    expect(changes[1]).toEqual({ column: "b", before: null, after: "x" });
    expect(changes[0]).toEqual({ column: "a", before: "1", after: "2" });
  });
});
