import { describe, expect, it } from "vitest";
import {
  logicalPanelSummary,
  validateLogicalPanelModel,
} from "@/lib/electrical-logical-panel";

const physical = { id: "u-ne", panel_id: "PNL-FS-NE", panel_kind: "physical", spaces: 42 };
const logical = {
  id: "u-crit",
  panel_id: "PNL-FS-CRIT",
  panel_kind: "logical",
  physical_panel_uuid: "u-ne",
};

describe("logical panel model", () => {
  it("summarises a logical panel against its physical host", () => {
    const out = logicalPanelSummary(logical, [physical, logical], {
      loads: [{ id: "l1", load_id: "FS-002", logical_panel_uuid: "u-crit" }],
      circuitGroups: [],
    });
    expect(out.panelId).toBe("PNL-FS-CRIT");
    expect(out.hostPanelId).toBe("PNL-FS-NE");
    expect(out.loadStableIds).toEqual(["FS-002"]);
  });

  it("rejects a logical panel hosted on itself or on another logical panel", () => {
    expect(
      validateLogicalPanelModel([{ ...logical, physical_panel_uuid: "u-crit" }]).length,
    ).toBeGreaterThan(0);
    expect(
      validateLogicalPanelModel([
        logical,
        { id: "u-b", panel_id: "PNL-X", panel_kind: "logical", physical_panel_uuid: "u-crit" },
      ]).length,
    ).toBeGreaterThan(0);
  });

  it("rejects physical capacity recorded on a logical panel", () => {
    expect(
      validateLogicalPanelModel([physical, { ...logical, spaces: 12 }]).length,
    ).toBeGreaterThan(0);
  });
});
