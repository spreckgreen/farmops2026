import { describe, expect, it } from "vitest";
import {
  checkControlledValue,
  checkStableId,
  farmShopWalkOrder,
  nextPanelExitOrder,
  sortByPanelExit,
} from "@/lib/electrical";
import { applyRelations, relationsFor } from "@/lib/electrical-relations";
import { integritySummary, runIntegrityChecks } from "@/lib/electrical-integrity";
import type { ElectricalGraphData, Row } from "@/lib/electrical-mermaid";

const PANEL_ID = "11111111-1111-1111-1111-111111111111";
const JBOX_ID = "22222222-2222-2222-2222-222222222222";
const LOAD_ID = "33333333-3333-3333-3333-333333333333";

function graph(over: Partial<ElectricalGraphData> = {}): ElectricalGraphData {
  return {
    panel: [],
    circuit_group: [],
    load: [],
    raceway: [],
    jbox: [],
    branch: [],
    waypoint: [],
    ...over,
  } as ElectricalGraphData;
}

describe("load ID conventions", () => {
  it("accepts the modelled building prefixes and legacy suffixes", () => {
    expect(checkStableId("load", "FS-097").ok).toBe(true);
    expect(checkStableId("load", "PH-019a").ok).toBe(true);
    expect(checkStableId("load", "BL-004").ok).toBe(true);
    expect(checkStableId("load", "HSE-12").ok).toBe(true);
  });
  it("rejects malformed known prefixes instead of calling them House IDs", () => {
    expect(checkStableId("load", "FS-9").ok).toBe(false);
    expect(checkStableId("load", "PH_019").ok).toBe(false);
    expect(checkStableId("load", "WIDGET-1").ok).toBe(false);
  });
});

describe("controlled values", () => {
  it("rejects values outside the vocabulary and ignores blanks", () => {
    expect(checkControlledValue("install_status", "planned")).toBeNull();
    expect(checkControlledValue("install_status", "")).toBeNull();
    expect(checkControlledValue("install_status", "Design Basis")).toMatch(/install_status/);
    expect(checkControlledValue("environment", "INTERIOR")).toBeNull();
    expect(checkControlledValue("exit_side", "Sideways")).toBeTruthy();
    expect(checkControlledValue("description", "anything")).toBeNull();
  });
});

describe("panel physical exit convention", () => {
  it("keeps the exit order independent of the conduit ID", () => {
    const sorted = sortByPanelExit([
      { conduit_id: "CON-001", exit_order: 3, exit_side: "Top" },
      { conduit_id: "CON-030", exit_order: 1, exit_side: "Lower Right" },
      { conduit_id: "CON-002", exit_order: 2, exit_side: "Right" },
    ] as never) as { conduit_id: string }[];
    expect(sorted.map((r) => r.conduit_id)).toEqual(["CON-030", "CON-002", "CON-001"]);
  });
  it("suggests the next free exit order", () => {
    expect(nextPanelExitOrder([1, 2, null, 4])).toBe(5);
    expect(nextPanelExitOrder([])).toBe(1);
  });
});

describe("Farm Shop walk convention", () => {
  it("starts at A6 (NE) and proceeds clockwise", () => {
    expect(farmShopWalkOrder(["C1", "A1", "A6", "C6", "B6", "B1"])[0]).toBe("A6");
    expect(farmShopWalkOrder(["A1", "A6"])).toEqual(["A6", "A1"]);
  });
});

describe("relationship rules", () => {
  it("derives the legacy reference columns from the FK", () => {
    const result = applyRelations(
      "raceway",
      { source_panel_uuid: PANEL_ID, dest_jbox_uuid: JBOX_ID },
      {
        source_panel_uuid: { id: PANEL_ID, kind: "panel", stableId: "PNL-FS-CRIT" },
        dest_jbox_uuid: { id: JBOX_ID, kind: "jbox", stableId: "JB-014" },
      },
    );
    expect(result.errors).toEqual([]);
    expect(result.derived).toMatchObject({
      source_endpoint_ref: "PNL-FS-CRIT",
      source_endpoint_type: "panel",
      dest_endpoint_ref: "JB-014",
      dest_endpoint_type: "junction_box",
    });
  });

  it("rejects two endpoints in one slot", () => {
    const result = applyRelations(
      "raceway",
      { source_panel_uuid: PANEL_ID, source_jbox_uuid: JBOX_ID },
      {
        source_panel_uuid: { id: PANEL_ID, kind: "panel", stableId: "PNL-FS-CRIT" },
        source_jbox_uuid: { id: JBOX_ID, kind: "jbox", stableId: "JB-014" },
      },
    );
    expect(result.errors[0]).toMatch(/only one source/i);
  });

  it("rejects a missing target and self-referencing topology", () => {
    expect(
      applyRelations("raceway", { source_panel_uuid: PANEL_ID }, { source_panel_uuid: null }).errors[0],
    ).toMatch(/no longer exists/);
    expect(
      applyRelations(
        "raceway",
        { source_jbox_uuid: JBOX_ID, dest_jbox_uuid: JBOX_ID },
        {
          source_jbox_uuid: { id: JBOX_ID, kind: "jbox", stableId: "JB-014" },
          dest_jbox_uuid: { id: JBOX_ID, kind: "jbox", stableId: "JB-014" },
        },
      ).errors.join(" "),
    ).toMatch(/JB-014/);
  });

  it("maps a branch destination load and a load's circuit group", () => {
    expect(relationsFor("branch").map((r) => r.fkColumn)).toContain("load_uuid");
    const branch = applyRelations(
      "branch",
      { load_uuid: LOAD_ID },
      { load_uuid: { id: LOAD_ID, kind: "load", stableId: "FS-097" } },
    );
    expect(branch.derived).toMatchObject({ dest_endpoint_ref: "FS-097", dest_endpoint_type: "load" });
    const load = applyRelations(
      "load",
      { circuit_group_uuid: "44444444-4444-4444-4444-444444444444" },
      {
        circuit_group_uuid: {
          id: "44444444-4444-4444-4444-444444444444",
          kind: "circuit_group",
          stableId: "CG-12",
        },
      },
    );
    expect(load.derived["circuit_group_ref"]).toBe("CG-12");
  });
});

describe("integrity report", () => {
  it("is clean for consistent records", () => {
    const findings = runIntegrityChecks(
      graph({
        panel: [{ id: PANEL_ID, panel_id: "PNL-FS-CRIT", install_status: "installed" } as Row],
        jbox: [{ id: JBOX_ID, jbox_id: "JB-014", install_status: "installed" } as Row],
        raceway: [
          {
            id: "55555555-5555-5555-5555-555555555555",
            conduit_id: "CON-030",
            environment: "INTERIOR",
            install_status: "installed",
            source_panel_uuid: PANEL_ID,
            source_endpoint_type: "panel",
            source_endpoint_ref: "PNL-FS-CRIT",
            dest_jbox_uuid: JBOX_ID,
            dest_endpoint_type: "junction_box",
            dest_endpoint_ref: "JB-014",
          } as Row,
        ],
      }),
    );
    expect(findings.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("flags duplicate IDs, unknown endpoints and FK/reference disagreement", () => {
    const findings = runIntegrityChecks(
      graph({
        panel: [
          { id: PANEL_ID, panel_id: "PNL-FS-CRIT" } as Row,
          { id: "66666666-6666-6666-6666-666666666666", panel_id: "PNL-FS-CRIT" } as Row,
        ],
        raceway: [
          {
            id: "77777777-7777-7777-7777-777777777777",
            conduit_id: "CON030",
            source_panel_uuid: PANEL_ID,
            source_endpoint_type: "panel",
            source_endpoint_ref: "PNL-OTHER",
            dest_endpoint_type: "junction_box",
            dest_endpoint_ref: "JB-999",
          } as Row,
        ],
      }),
    );
    const codes = findings.map((f) => f.code);
    expect(codes).toContain("duplicate_stable_id");
    expect(codes).toContain("malformed_stable_id");
    expect(codes).toContain("fk_ref_disagreement");
    expect(codes).toContain("unknown_endpoint");
    expect(integritySummary(findings).errors).toBeGreaterThan(0);
  });

  it("flags waypoints that do not belong to a raceway", () => {
    const findings = runIntegrityChecks(
      graph({
        waypoint: [
          { id: "88888888-8888-8888-8888-888888888888", raceway_id: "99999999-9999-9999-9999-999999999999", sequence: 1 } as Row,
        ],
      }),
    );
    expect(findings.map((f) => f.code)).toContain("orphan_waypoint");
  });
});
