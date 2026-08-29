import { describe, expect, it } from "vitest";
import { dependencySummary, dependentSpecs } from "@/lib/electrical-dependents";

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
