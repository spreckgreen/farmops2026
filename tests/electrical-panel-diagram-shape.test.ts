import { describe, expect, it } from "vitest";
import { buildPanelDiagram, NOT_IN_RECORD } from "@/lib/electrical-panel-diagram";

const snapshotPanel = {
  uuid: "p1",
  stable_id: "PNL-FS",
  description: "Farm Shop panel",
  building: "Farm Shop",
  system_voltage: JSON.stringify({
    code: "SYSV-120/240-1P3W",
    designation: "120/240 V, 1φ, 3-wire",
    line_line_volts: 240,
    line_neutral_volts: 120,
  }),
  bus_rating_amps: 200,
  install_status: "planned",
};

const snapshotCircuit = {
  uuid: "c1",
  stable_id: "CIR-01",
  panel_uuid: "p1",
  circuit_rating_amps: 20,
  description: "Mini-split",
};

const snapshotLoad = {
  uuid: "l1",
  stable_id: "FS-082",
  circuit_group_uuid: "c1",
  description: "Mini-split condenser",
  connected_va: 2400,
};

describe("buildPanelDiagram with snapshot-shaped rows", () => {
  const diagram = buildPanelDiagram({
    panels: [snapshotPanel],
    feeders: [],
    circuitGroups: [snapshotCircuit],
    loads: [snapshotLoad],
    positions: [],
  });

  it("resolves stable IDs instead of NOT IN RECORD", () => {
    const panel = diagram.panels[0]!;
    expect(panel.id).toBe("PNL-FS");
    expect(panel.circuits[0]!.id).toBe("CIR-01");
    expect(panel.circuits[0]!.loads[0]!.id).toBe("FS-082");
    expect(panel.id).not.toBe(NOT_IN_RECORD);
  });

  it("renders the system voltage designation, not raw JSON", () => {
    expect(diagram.panels[0]!.voltage).toBe("120/240 V, 1φ, 3-wire");
  });

  it("traces the load to the panel", () => {
    expect(diagram.totals.connectedLoads).toBe(1);
    expect(diagram.unassignedLoads).toHaveLength(0);
  });
});
