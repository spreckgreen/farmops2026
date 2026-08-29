import { describe, it, expect } from "vitest";
import {
  buildDiagram,
  matchesState,
  type ElectricalGraphData,
} from "@/lib/electrical-mermaid";

const data: ElectricalGraphData = {
  panel: [
    {
      id: "p1",
      panel_id: "PNL-FS-CRIT",
      description: "Farm Shop critical",
      building: "Farm Shop",
      bus_rating_amps: 100,
      spaces: 24,
      backup_class: "generator",
      install_status: "complete",
    },
    {
      id: "p2",
      panel_id: "PNL-FS-NE",
      description: "Farm Shop NE",
      building: "Farm Shop",
      feeder_source: "PNL-FS-CRIT",
      install_status: "planned",
    },
  ],
  circuit_group: [
    {
      id: "g1",
      circuit_group_id: "CG-01",
      description: "Shop lighting",
      suggested_panel: "PNL-FS-CRIT",
      breaker_number: 5,
      breaker_position: "Left 3",
      critical: true,
      backup_eligible: true,
      install_status: "complete",
    },
    {
      id: "g2",
      circuit_group_id: "CG-02",
      description: "Ghost circuit",
      suggested_panel: "PNL-MISSING",
      install_status: "planned",
    },
  ],
  load: [
    {
      id: "l1",
      load_id: "FS-097",
      description: "High bay lights",
      circuit_group_ref: "CG-01",
      grid: "A6",
      critical: true,
      install_status: "as_built_verified",
    },
  ],
  raceway: [
    {
      id: "r1",
      conduit_id: "CON-030",
      environment: "INTERIOR",
      trade_size: '3/4"',
      source_endpoint_ref: "PNL-FS-CRIT",
      dest_endpoint_ref: "JB-014",
      exit_order: 1,
      exit_side: "Lower Right",
      measured_length_ft: 22,
      install_status: "raceway_installed",
    },
    {
      id: "r2",
      conduit_id: "CON-031",
      environment: "SITE_UNDERGROUND",
      source_endpoint_ref: "PNL-FS-CRIT",
      dest_endpoint_ref: "",
      install_status: "planned",
    },
  ],
  jbox: [{ id: "j1", jbox_id: "JB-014", box_type: "4-11/16 square", install_status: "complete" }],
  branch: [
    {
      id: "b1",
      branch_id: "BR-057",
      source_endpoint_ref: "JB-014",
      dest_endpoint_ref: "FS-097",
      conductor_size: "#12",
      install_status: "complete",
    },
    {
      id: "b2",
      branch_id: "BR-058",
      source_endpoint_ref: "JB-999",
      dest_endpoint_ref: "FS-999",
      install_status: "planned",
    },
  ],
  waypoint: [{ id: "w1", raceway_id: "r2", sequence: 1, grid: "C4", direction: "90 left" }],
};

describe("electrical mermaid diagrams", () => {
  it("is deterministic for identical data", () => {
    const a = buildDiagram(data, { type: "whole_system" });
    const b = buildDiagram(data, { type: "whole_system" });
    expect(a.mermaid).toBe(b.mermaid);
    expect(a.mermaid).toContain("flowchart LR");
  });

  it("shows stable IDs and links nodes back to detail pages", () => {
    const out = buildDiagram(data, { type: "whole_system" });
    expect(out.mermaid).toContain("PNL-FS-CRIT");
    expect(out.mermaid).toContain("CON-030");
    expect(out.mermaid).toContain("JB-014");
    expect(out.mermaid).toContain("BR-057");
    expect(out.mermaid).toContain("FS-097");
    expect(out.mermaid).toContain('href "/electrical/item/panel/p1"');
  });

  it("wires panel -> raceway -> j-box -> branch -> load", () => {
    const out = buildDiagram(data, { type: "whole_system" });
    const has = (from: string, to: string) =>
      out.edges.some(
        (e) =>
          out.nodes.find((n) => n.key === e.from)?.stableId === from &&
          out.nodes.find((n) => n.key === e.to)?.stableId === to,
      );
    expect(has("PNL-FS-CRIT", "CON-030")).toBe(true);
    expect(has("CON-030", "JB-014")).toBe(true);
    expect(has("JB-014", "BR-057")).toBe(true);
    expect(has("BR-057", "FS-097")).toBe(true);
  });

  it("surfaces invalid references instead of omitting them", () => {
    const out = buildDiagram(data, { type: "whole_system" });
    const codes = out.issues.map((i) => i.code);
    expect(codes).toContain("unknown_panel");
    expect(codes).toContain("missing_endpoint");
    expect(codes).toContain("orphan_branch");
  });

  it("reports duplicate stable IDs", () => {
    const dup: ElectricalGraphData = {
      ...data,
      jbox: [...data.jbox, { id: "j2", jbox_id: "JB-014" }],
    };
    const out = buildDiagram(dup, { type: "whole_system" });
    expect(out.issues.some((i) => i.code === "duplicate_id")).toBe(true);
  });

  it("reports circular topology", () => {
    const loop: ElectricalGraphData = {
      ...data,
      panel: [
        { id: "p1", panel_id: "PNL-A", feeder_source: "PNL-B" },
        { id: "p2", panel_id: "PNL-B", feeder_source: "PNL-A" },
      ],
      circuit_group: [],
      load: [],
      raceway: [],
      jbox: [],
      branch: [],
    };
    const out = buildDiagram(loop, { type: "whole_system" });
    expect(out.issues.some((i) => i.code === "circular_reference")).toBe(true);
  });

  it("filters by installation state (as-designed vs as-built)", () => {
    expect(matchesState({ install_status: "planned" }, "design")).toBe(true);
    expect(matchesState({ install_status: "planned" }, "installed")).toBe(false);
    expect(matchesState({ install_status: "as_built_verified" }, "as_built")).toBe(true);
    const built = buildDiagram(data, { type: "whole_system", state: "as_built" });
    expect(built.nodes.some((n) => n.stableId === "FS-097")).toBe(true);
    expect(built.nodes.some((n) => n.stableId === "CON-031")).toBe(false);
  });

  it("limits the site view to underground/exterior raceways and shows waypoints", () => {
    const out = buildDiagram(data, { type: "site" });
    expect(out.nodes.some((n) => n.stableId === "CON-031")).toBe(true);
    expect(out.nodes.some((n) => n.stableId === "CON-030")).toBe(false);
    expect(out.nodes.some((n) => n.klass === "waypoint")).toBe(true);
  });

  it("scopes the single-panel view to the selected panel", () => {
    const out = buildDiagram(data, { type: "single_panel", focus: "PNL-FS-CRIT" });
    expect(out.nodes.some((n) => n.stableId === "PNL-FS-CRIT")).toBe(true);
    expect(out.nodes.some((n) => n.stableId === "CG-02")).toBe(false);
    expect(out.edges.some((e) => e.label?.includes("breaker 5"))).toBe(true);
  });

  it("keeps only critical / backup-eligible records in the critical-power view", () => {
    const out = buildDiagram(data, { type: "critical_power" });
    expect(out.nodes.some((n) => n.stableId === "PNL-FS-CRIT")).toBe(true);
    expect(out.nodes.some((n) => n.stableId === "CG-01")).toBe(true);
    expect(out.mermaid).toContain("Transfer / generator");
  });

  it("builds the raceway and junction-box focused views", () => {
    const rw = buildDiagram(data, { type: "raceway", focus: "CON-030" });
    expect(rw.nodes.map((n) => n.stableId)).toContain("JB-014");
    expect(rw.nodes.some((n) => n.stableId === "CON-031")).toBe(false);

    const jb = buildDiagram(data, { type: "jbox", focus: "JB-014" });
    expect(jb.nodes.map((n) => n.stableId)).toEqual(
      expect.arrayContaining(["JB-014", "BR-057", "FS-097", "CON-030"]),
    );
  });

  it("renders an empty-state diagram rather than invalid Mermaid", () => {
    const out = buildDiagram(
      { panel: [], circuit_group: [], load: [], raceway: [], jbox: [], branch: [] },
      { type: "whole_system", panel: "PNL-NONE" },
    );
    expect(out.mermaid).toContain("No records match these filters");
  });
});

describe("source availability without a renderer", () => {
  it("generates deterministic Mermaid source with no browser or CDN present", () => {
    // Node test environment: no window, no mermaid module, no network.
    const graph = {
      panel: [{ id: "p1", panel_id: "PNL-FS-CRIT", install_status: "planned" }],
      circuit_group: [],
      load: [],
      raceway: [],
      jbox: [],
      branch: [],
      waypoint: [],
    } as never;
    const a = buildDiagram(graph, { type: "system" });
    const b = buildDiagram(graph, { type: "system" });
    expect(a.source).toContain("PNL-FS-CRIT");
    expect(a.source).toBe(b.source);
  });
});
