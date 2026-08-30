import { describe, it, expect } from "vitest";
import {
  expectedBreakerNumber,
  freeBreakerSlots,
  nextExitOrder,
  panelBreakerSlots,
  resolvePanelLayout,
  validatePanelLayout,
} from "@/lib/electrical-panel-layout";
import { FIELD_MAP, MAPPING_CLASSES, fieldMapCsv, fieldMapSummary } from "@/lib/electrical-field-map";
import { SOR_AUTHORITY, SOR_PHASE } from "@/lib/electrical-sor";

const panel = { id: "p1", panel_id: "PNL-FS-CRIT", spaces: 30 };

describe("panel layout capacity", () => {
  it("derives capacity from the panel, never an assumed 48 spaces", () => {
    const layout = resolvePanelLayout(panel);
    expect(layout).toEqual({
      columns: 2,
      positionsPerColumn: 15,
      totalSpaces: 30,
      sides: ["Left", "Right"],
    });
    expect(panelBreakerSlots(layout)).toHaveLength(30);
  });

  it("honours an explicit per-panel configuration", () => {
    const layout = resolvePanelLayout({ spaces: 12, breaker_columns: 1, positions_per_column: 12 });
    expect(layout.columns).toBe(1);
    expect(layout.totalSpaces).toBe(12);
    expect(expectedBreakerNumber(layout, "Left", 4)).toBe(4);
  });

  it("numbers odd left / even right in a two-column panel", () => {
    const layout = resolvePanelLayout(panel);
    expect(expectedBreakerNumber(layout, "Left", 3)).toBe(5);
    expect(expectedBreakerNumber(layout, "Right", 3)).toBe(6);
  });

  it("reports the free slots and the next exit order", () => {
    const layout = resolvePanelLayout(panel);
    const free = freeBreakerSlots(layout, [{ side: "Left", position: 1 }]);
    expect(free).toHaveLength(29);
    expect(free[0]).toMatchObject({ side: "Right", position: 1 });
    expect(nextExitOrder([{ exit_order: 1 }, { exit_order: 4 }])).toBe(5);
  });
});

describe("panel layout QA", () => {
  it("flags duplicate slots and duplicate breaker numbers as errors", () => {
    const findings = validatePanelLayout({
      panels: [panel],
      positions: [
        { id: "a", panel_uuid: "p1", side: "Left", position: 1, breaker_number: 1, circuit_group_uuid: "g1" },
        { id: "b", panel_uuid: "p1", side: "Left", position: 1, breaker_number: 1, circuit_group_uuid: "g2" },
      ],
      exits: [],
    });
    expect(findings.filter((f) => f.code === "breaker_slot_duplicate")).toHaveLength(1);
    expect(findings.filter((f) => f.code === "breaker_number_duplicate")).toHaveLength(1);
    expect(findings.every((f) => f.panelId === "PNL-FS-CRIT")).toBe(true);
  });

  it("treats an unassigned space and an unlinked exit as incomplete, not invalid", () => {
    const findings = validatePanelLayout({
      panels: [panel],
      positions: [{ id: "a", panel_uuid: "p1", side: "Left", position: 2, breaker_number: 3 }],
      exits: [{ id: "x", panel_uuid: "p1", exit_order: 1, exit_side: "Lower Right", raceway_ref: "CON-030" }],
    });
    const codes = findings.map((f) => f.code);
    expect(codes).toContain("breaker_slot_unassigned");
    expect(codes).toContain("panel_exit_unlinked");
    expect(findings.filter((f) => f.severity === "error")).toHaveLength(0);
  });

  it("errors when a slot is beyond the panel or an exit's raceway misses the panel", () => {
    const findings = validatePanelLayout({
      panels: [panel],
      positions: [
        { id: "a", panel_uuid: "p1", side: "Left", position: 40, circuit_group_uuid: "g1" },
      ],
      exits: [
        { id: "x", panel_uuid: "p1", exit_order: 1, raceway_uuid: "r1" },
        { id: "y", panel_uuid: "p1", exit_order: 1, raceway_uuid: "r1" },
      ],
      raceways: [
        { id: "r1", conduit_id: "CON-031", source_panel_uuid: "other", dest_panel_uuid: null },
      ],
    });
    const codes = findings.map((f) => f.code);
    expect(codes).toContain("breaker_slot_out_of_range");
    expect(codes).toContain("panel_exit_raceway_mismatch");
    expect(codes).toContain("panel_exit_order_duplicate");
  });

  it("warns when a recorded breaker number contradicts the panel numbering", () => {
    const findings = validatePanelLayout({
      panels: [panel],
      positions: [
        { id: "a", panel_uuid: "p1", side: "Right", position: 3, breaker_number: 5, load_uuid: "l1" },
      ],
      exits: [],
    });
    const mismatch = findings.find((f) => f.code === "breaker_number_mismatch");
    expect(mismatch?.severity).toBe("warning");
    expect(mismatch?.message).toContain("breaker 6");
  });
});

describe("Phase 4.3 field mapping matrix", () => {
  it("classifies every row and covers the engineering worksheets", () => {
    for (const row of FIELD_MAP) {
      expect(MAPPING_CLASSES).toContain(row.classification);
      expect(row.farmops.trim()).not.toBe("");
      expect(row.transformation.trim()).not.toBe("");
    }
    const summary = fieldMapSummary();
    for (const sheet of [
      "Load_Master",
      "Circuit_Groups",
      "Panels",
      "Feeders",
      "Conduit_Runs",
      "Junction_Boxes",
      "Branch_Runs",
    ]) {
      expect(summary.worksheets).toContain(sheet);
    }
    expect(summary.byClass.directly_mapped).toBeGreaterThan(20);
  });

  it("documents the normalized breaker positions and panel exits", () => {
    const targets = FIELD_MAP.map((r) => r.farmops).join(" ");
    expect(targets).toContain("electrical_breaker_positions");
    expect(targets).toContain("electrical_panel_exits");
  });

  it("exports a CSV with one header and one line per field", () => {
    const lines = fieldMapCsv().split("\n");
    expect(lines[0]).toContain("Worksheet,Field,Classification");
    expect(lines).toHaveLength(FIELD_MAP.length + 1);
  });

  it("advances the displayed phase without moving authority", () => {
    expect(SOR_PHASE).toBe("4.3");
    expect(SOR_AUTHORITY).toBe("canonical_ods");
  });
});
