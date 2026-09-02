import { describe, expect, it } from "vitest";
import {
  buildPanelDiagram,
  plannedMermaid,
  plannedPanel,
  plannedReading,
} from "@/lib/electrical-panel-diagram";

const diagram = buildPanelDiagram({
  panels: [
    {
      id: "p1",
      panel_id: "PNL-FS",
      description: "Farm Shop",
      building: "Farm Shop",
    },
  ],
  feeders: [],
  circuitGroups: [],
  positions: [],
  loads: [
    {
      id: "l1",
      load_id: "FS-082",
      description: "Mini split 1",
      suggested_panel: "PNL-FS",
      building: "Farm Shop",
      amps: "15",
    },
    {
      id: "l2",
      load_id: "FS-083",
      description: "Mini split 2",
      building: "Farm Shop",
      grid: "Farm Shop",
    },
  ],
});

describe("planned panel view", () => {
  const panel = diagram.panels[0]!;

  it("aligns loads to the panel by suggested panel and building", () => {
    const plan = plannedPanel(panel);
    expect(plan.total).toBe(2);
    expect(plan.bySuggestedPanel).toBe(1);
    expect(plan.byBuildingArea).toBe(1);
    expect(plan.groups.map((g) => g.where)).toEqual(["Farm Shop"]);
  });

  it("states the alignment is intent, not install data", () => {
    const reading = plannedReading(panel);
    expect(reading.known.join(" ")).toContain("not installed fact");
    expect(reading.missing.join(" ")).toContain("planned only");
  });

  it("draws planned edges as dashed", () => {
    const mmd = plannedMermaid(panel);
    expect(mmd).toContain("flowchart LR");
    expect(mmd).toContain("suggested panel");
    expect(mmd).toContain("-.->");
    expect(mmd).not.toContain("already linked");
  });
});
