// Regression: an imported legacy panel with incomplete topology must still open.
//
// The seven panels imported from the canonical workbook carry only panel_id,
// notes and a free-text install status: no spaces, no grid, no raceway/J-box/
// branch relationships. Opening one used to fail as a unit when any of its
// relationship lookups errored (e.g. a relationship table missing in an older
// deployment). These tests lock in per-lookup tolerance.
import { describe, expect, it } from "vitest";
import {
  collectTopology,
  relatedFromRows,
  topologyLookups,
} from "@/lib/electrical-topology";
import { panelPositions } from "@/lib/electrical";

/** The seven imported panels, exactly as they exist in the records. */
const IMPORTED_PANELS = [
  { panel_id: "PNL-BLR", install_status: "Planning Assumption" },
  { panel_id: "PNL-FS-CRIT", install_status: "Reserve West-wall space/pathway." },
  { panel_id: "PNL-FS-EQ", install_status: "Reserve wall/pathway." },
  { panel_id: "PNL-FS-NE", install_status: "Design Basis" },
  { panel_id: "PNL-FS-NW", install_status: "Design Basis" },
  { panel_id: "PNL-H1", install_status: "Existing / Confirm" },
  { panel_id: "PNL-PH", install_status: "Planning Assumption" },
].map((p) => ({
  ...p,
  // Every topology / as-built field is still null on the imported rows.
  description: null,
  building: null,
  grid: null,
  spaces: null,
  circuits: null,
  voltage: null,
  feeder_source: null,
}));

describe("imported panel detail", () => {
  it("plans lookups for every imported panel without touching null fields", () => {
    for (const panel of IMPORTED_PANELS) {
      const plan = topologyLookups("panel", panel, panel.panel_id);
      expect(plan.length).toBe(3);
      expect(plan.every((l) => l.value === panel.panel_id)).toBe(true);
      expect(plan.map((l) => l.column)).toEqual([
        "suggested_panel",
        "source_endpoint_ref",
        "dest_endpoint_ref",
      ]);
    }
  });

  it("opens each imported panel when every relationship lookup fails", async () => {
    for (const panel of IMPORTED_PANELS) {
      const plan = topologyLookups("panel", panel, panel.panel_id);
      const result = await collectTopology(plan, async (lookup) => {
        throw new Error(`relation "${lookup.kind}" does not exist`);
      });
      expect(result.related).toEqual([]);
      expect(result.warnings).toHaveLength(3);
      for (const w of result.warnings) expect(w.message).toContain("does not exist");
    }
  });

  it("keeps the lookups that succeed when only one relationship fails", async () => {
    const panel = IMPORTED_PANELS[3]!; // PNL-FS-NE
    const plan = topologyLookups("panel", panel, panel.panel_id);
    const { related, warnings } = await collectTopology(plan, async (lookup) => {
      if (lookup.kind === "circuit_group") throw new Error("permission denied");
      if (lookup.column === "source_endpoint_ref")
        return [{ conduit_id: "CON-030", description: "NE feeder" }];
      return [];
    });
    expect(related).toEqual([
      {
        kind: "raceway",
        stable_id: "CON-030",
        label: "NE feeder",
        relation: "raceway leaving panel",
      },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.column).toBe("suggested_panel");
  });

  it("tolerates rows missing the expected columns", () => {
    const rows = relatedFromRows(
      { kind: "raceway", column: "source_endpoint_ref", value: "PNL-H1", relation: "endpoint" },
      [{}, { conduit_id: "CON-001" }],
    );
    expect(rows.map((r) => r.stable_id)).toEqual(["", "CON-001"]);
    expect(rows.every((r) => r.label === "")).toBe(true);
  });

  it("renders no breaker positions when the panel has no space count", () => {
    for (const panel of IMPORTED_PANELS) {
      expect(panelPositions(panel.spaces)).toEqual([]);
    }
  });
});
