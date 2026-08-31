// Whole-system topology must consume the current service revision, not a
// synthetic global "Utility service" root.
import { describe, it, expect } from "vitest";
import { buildDiagram, type ElectricalGraphData } from "@/lib/electrical-mermaid";
import {
  resolveServiceTopology,
  servicePanelDomainFindings,
} from "@/lib/electrical-service-topology";

const panel = (panel_id: string, feeder_source?: string) => ({
  id: `u-${panel_id}`,
  panel_id,
  description: panel_id,
  install_status: "complete",
  ...(feeder_source ? { feeder_source } : {}),
});

const link = (
  config: string,
  panel_ref: string,
  fed_from_kind: string,
  parent?: string,
  amps?: string,
) => ({
  id: `l-${config}-${panel_ref}`,
  service_config_uuid: config,
  panel_ref,
  fed_from_kind,
  ...(parent ? { fed_from_panel_ref: parent } : {}),
  ...(amps ? { panel_ampacity_amps: amps } : {}),
});

function fixture(): ElectricalGraphData {
  return {
    panel: [
      panel("PNL-H1"),
      panel("PNL-H2", "PNL-H1"),
      panel("PNL-FS-NW"),
      panel("PNL-FS-NE"),
      panel("PNL-FS-CRIT", "PNL-FS-NW"),
      panel("PNL-FS-EQ", "PNL-FS-NE"),
      panel("PNL-BLR"), // no upstream anywhere -> unresolved
    ],
    circuit_group: [],
    load: [],
    raceway: [],
    jbox: [],
    branch: [],
    service: [
      { id: "svc-h", service_id: "SVC-HOUSE" },
      { id: "svc-fs", service_id: "SVC-FARMSHOP" },
    ],
    service_config: [
      { id: "cfg-h", service_uuid: "svc-h", lifecycle_state: "existing", is_current: true, ampacity_amps: "200" },
      // Proposed 400 A House redesign must not affect current topology.
      { id: "cfg-h-400", service_uuid: "svc-h", lifecycle_state: "proposed", is_current: false, ampacity_amps: "400" },
      { id: "cfg-fs", service_uuid: "svc-fs", lifecycle_state: "existing", is_current: true, ampacity_amps: "400" },
    ],
    service_panel: [
      link("cfg-h", "PNL-H1", "service_equipment", undefined, "200"),
      link("cfg-h", "PNL-H2", "panel", "PNL-H1"),
      link("cfg-h-400", "PNL-H1", "service_equipment", undefined, "200"),
      link("cfg-h-400", "PNL-H2", "service_equipment", undefined, "200"),
      link("cfg-fs", "PNL-FS-NW", "service_equipment", undefined, "200"),
      link("cfg-fs", "PNL-FS-NE", "service_equipment", undefined, "200"),
    ],
  };
}

const svcEdges = (out: ReturnType<typeof buildDiagram>) =>
  out.edges
    .filter((e) => out.nodes.find((n) => n.key === e.from)?.kind === "utility")
    .map((e) => [
      out.nodes.find((n) => n.key === e.from)!.stableId,
      out.nodes.find((n) => n.key === e.to)!.stableId,
    ]);

describe("whole-system topology consumes service revisions", () => {
  const data = fixture();
  const out = buildDiagram(data, { type: "whole_system" });

  it("renders one root per utility service and no synthetic root", () => {
    const roots = out.nodes.filter((n) => n.kind === "utility").map((n) => n.stableId);
    expect(roots).toEqual(expect.arrayContaining(["SVC-HOUSE", "SVC-FARMSHOP"]));
    expect(roots).toHaveLength(2);
    expect(out.mermaid).not.toContain("Utility service]");
    expect(roots).not.toContain("UTILITY");
  });

  it("renders the current House chain SVC-HOUSE -> PNL-H1 -> PNL-H2", () => {
    expect(svcEdges(out)).toEqual(
      expect.arrayContaining([
        ["SVC-HOUSE", "PNL-H1"],
        ["SVC-FARMSHOP", "PNL-FS-NW"],
        ["SVC-FARMSHOP", "PNL-FS-NE"],
      ]),
    );
    const key = (id: string) => out.nodes.find((n) => n.stableId === id)!.key;
    expect(out.edges.some((e) => e.from === key("PNL-H1") && e.to === key("PNL-H2"))).toBe(true);
  });

  it("gives PNL-H2 and downstream panels no direct service edge", () => {
    const flat = svcEdges(out).map((e) => e.join("->"));
    for (const p of ["PNL-H2", "PNL-FS-CRIT", "PNL-FS-EQ", "PNL-BLR"]) {
      expect(flat.some((e) => e.endsWith(`->${p}`))).toBe(false);
    }
  });

  it("does not let the proposed 400 A revision change current topology", () => {
    expect(svcEdges(out)).not.toEqual(expect.arrayContaining([["SVC-HOUSE", "PNL-H2"]]));
  });

  it("reports unresolved upstream topology instead of attaching a service", () => {
    expect(
      out.issues.some((i) => i.code === "unresolved_upstream" && i.message.includes("PNL-BLR")),
    ).toBe(true);
  });

  it("inherits the service domain downstream without duplicate service edges", () => {
    const res = resolveServiceTopology({
      panels: data.panel,
      services: data.service,
      serviceConfigs: data.service_config,
      servicePanels: data.service_panel,
    });
    expect(res.domains.get("PNL-FS-CRIT")).toEqual(["SVC-FARMSHOP"]);
    expect(res.status.get("PNL-FS-CRIT")).toBe("downstream");
    expect(res.status.get("PNL-FS-NW")).toBe("service_rooted");
    expect(res.status.get("PNL-BLR")).toBe("unresolved");
    expect(res.edges.filter((e) => e.kind === "service")).toHaveLength(3);
  });

  it("keeps the intertie as a distinct normally-open element between two roots", () => {
    const withIntertie = buildDiagram(
      {
        ...data,
        intertie: [{ id: "it1", intertie_id: "ITIE-HOUSE-FS" }],
        intertie_config: [
          {
            id: "itc1",
            intertie_uuid: "it1",
            is_current: true,
            lifecycle_state: "commissioned",
            endpoint_a_service_uuid: "svc-h",
            endpoint_b_service_uuid: "svc-fs",
            normal_state: "normally open",
            transfer_method: "manual transfer switch",
          },
        ],
      },
      { type: "whole_system" },
    );
    expect(withIntertie.nodes.some((n) => n.stableId === "ITIE-HOUSE-FS")).toBe(true);
    expect(
      withIntertie.nodes.filter((n) => n.kind === "utility" && n.stableId.startsWith("SVC-")),
    ).toHaveLength(2);
  });

  it("flags ambiguous and cyclic panels rather than repairing them", () => {
    const ambiguous = resolveServiceTopology({
      panels: [panel("PNL-X", "PNL-H1"), panel("PNL-H1")],
      services: data.service,
      serviceConfigs: data.service_config,
      servicePanels: [
        ...data.service_panel!,
        link("cfg-fs", "PNL-X", "service_equipment"),
        link("cfg-h", "PNL-X", "panel", "PNL-H1"),
      ],
    });
    expect(ambiguous.status.get("PNL-X")).toBe("ambiguous");

    const cyclic = resolveServiceTopology({
      panels: [panel("PNL-A", "PNL-B"), panel("PNL-B", "PNL-A")],
      services: data.service,
      serviceConfigs: data.service_config,
      servicePanels: data.service_panel,
    });
    expect(cyclic.status.get("PNL-A")).toBe("cycle");
    expect(
      servicePanelDomainFindings(cyclic).some((f) => f.code === "panel_feeder_cycle"),
    ).toBe(true);
  });

  it("keeps the legacy single utility root when no service is modelled", () => {
    const legacy = buildDiagram({ ...data, service: [], service_config: [], service_panel: [] }, {
      type: "whole_system",
    });
    expect(legacy.nodes.some((n) => n.stableId === "UTILITY")).toBe(true);
  });
});
