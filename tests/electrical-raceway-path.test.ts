import { describe, it, expect } from "vitest";
import {
  orderedJunctionPoints,
  planJboxRacewayPopulation,
  racewayPathFindings,
  positionLabel,
} from "@/lib/electrical-raceway-path";
import { buildDiagram, type ElectricalGraphData } from "@/lib/electrical-mermaid";
import { runIntegrityChecks } from "@/lib/electrical-integrity";

const graph = (over: Partial<ElectricalGraphData> = {}): ElectricalGraphData =>
  ({
    panel: [{ id: "p1", panel_id: "PNL-FS-NW" }],
    circuit_group: [],
    load: [],
    raceway: [
      {
        id: "r104",
        conduit_id: "CON-104",
        source_endpoint_ref: "PNL-FS-NW",
        dest_endpoint_ref: "JB-104-03",
        environment: "INTERIOR",
      },
    ],
    jbox: [
      { id: "j1", jbox_id: "JB-104-01", raceway_uuid: "r104", raceway_sequence: 1 },
      { id: "j2", jbox_id: "JB-104-02", raceway_uuid: "r104", raceway_sequence: 2 },
      { id: "j3", jbox_id: "JB-104-03", raceway_uuid: "r104", raceway_sequence: 3 },
    ],
    branch: [
      { id: "b1", branch_id: "BR-104-02-01", source_jbox_uuid: "j2", source_endpoint_ref: "JB-104-02" },
    ],
    waypoint: [],
    ...over,
  }) as never;

describe("continuous raceway / ordered junction boxes", () => {
  it("orders junction points by position and puts unsequenced boxes last", () => {
    const points = orderedJunctionPoints("r104", [
      { id: "jx", jbox_id: "JB-104-09", raceway_uuid: "r104", raceway_sequence: null },
      ...graph().jbox,
    ] as never);
    expect(points.map((p) => p.stableId)).toEqual([
      "JB-104-01",
      "JB-104-02",
      "JB-104-03",
      "JB-104-09",
    ]);
    expect(positionLabel(2)).toBe("02");
    expect(positionLabel(null)).toBe("—");
  });

  it("keeps three boxes on one raceway without inventing raceways between them", () => {
    const out = buildDiagram(graph(), { type: "whole_system" });
    expect(out.nodes.filter((n) => n.klass === "raceway")).toHaveLength(1);
    for (const id of ["JB-104-01", "JB-104-02", "JB-104-03"]) {
      expect(out.nodes.some((n) => n.stableId === id)).toBe(true);
    }
    expect(out.edges.some((e) => e.label === "junction 01")).toBe(true);
    // A branch leaving the middle box does not end the run.
    expect(out.nodes.some((n) => n.stableId === "BR-104-02-01")).toBe(true);
  });

  it("is deterministic", () => {
    expect(buildDiagram(graph(), { type: "whole_system" }).mermaid).toBe(
      buildDiagram(graph(), { type: "whole_system" }).mermaid,
    );
  });

  it("includes a mid-path box in its own focused view", () => {
    const out = buildDiagram(graph(), { type: "jbox", focus: "JB-104-02" });
    expect(out.nodes.some((n) => n.stableId === "CON-104")).toBe(true);
  });

  it("reports duplicate positions, missing positions and positions without a parent", () => {
    const codes = racewayPathFindings(
      graph({
        jbox: [
          { id: "j1", jbox_id: "JB-104-01", raceway_uuid: "r104", raceway_sequence: 1 },
          { id: "j2", jbox_id: "JB-104-02", raceway_uuid: "r104", raceway_sequence: 1 },
          { id: "j3", jbox_id: "JB-104-03", raceway_uuid: "r104", raceway_sequence: null },
          { id: "j4", jbox_id: "JB-104-04", raceway_sequence: 4 },
        ],
      } as never),
    ).map((f) => f.code);
    expect(codes).toContain("duplicate_raceway_sequence");
    expect(codes).toContain("missing_raceway_sequence");
    expect(codes).toContain("sequence_without_raceway");
  });

  it("flags identity disagreements without renaming anything", () => {
    const findings = racewayPathFindings(
      graph({
        jbox: [{ id: "j1", jbox_id: "JB-105-02", raceway_uuid: "r104", raceway_sequence: 1 }],
        branch: [
          { id: "b1", branch_id: "BR-104-03-01", source_jbox_uuid: "j1" },
        ],
      } as never),
    );
    const codes = findings.map((f) => f.code);
    expect(codes).toContain("encoded_path_disagreement");
    expect(codes).toContain("encoded_sequence_disagreement");
    expect(codes).toContain("branch_jbox_disagreement");
    expect(findings.every((f) => f.severity === "error")).toBe(true);
  });

  it("warns about an unlinked box whose ID names a known path", () => {
    const findings = racewayPathFindings(
      graph({ jbox: [{ id: "j1", jbox_id: "JB-104-01" }] } as never),
    );
    expect(findings.map((f) => f.code)).toContain("orphan_path_topology");
    expect(findings.find((f) => f.code === "orphan_path_topology")?.severity).toBe("warning");
  });

  it("surfaces the new findings through the QA report", () => {
    const codes = runIntegrityChecks(
      graph({ jbox: [{ id: "j4", jbox_id: "JB-104-04", raceway_sequence: 4 }] } as never),
    ).map((f) => f.code);
    expect(codes).toContain("sequence_without_raceway");
  });

  it("proposes links only where the evidence is unambiguous", () => {
    const plan = planJboxRacewayPopulation(
      graph({
        raceway: [
          { id: "r104", conduit_id: "CON-104" },
          { id: "r105", conduit_id: "CON-105" },
          { id: "r105b", conduit_id: "EMT-105" },
        ],
        jbox: [
          { id: "j1", jbox_id: "JB-104-01" },
          { id: "j2", jbox_id: "JB-105-01" },
          { id: "j3", jbox_id: "JB-999-01" },
          { id: "j4", jbox_id: "JB-104-02", raceway_uuid: "r105", raceway_sequence: 7 },
          { id: "j5", jbox_id: "JB-104-03", raceway_uuid: "r104", raceway_sequence: 3 },
        ],
      } as never),
    );
    const by = (id: string) => plan.find((p) => p.jbox_id === id)!;
    expect(by("JB-104-01").status).toBe("proposed");
    expect(by("JB-104-01").proposed_raceway).toBe("CON-104");
    expect(by("JB-104-01").proposed_sequence).toBe(1);
    // Ambiguous: two raceways record path 105.
    expect(by("JB-105-01").status).toBe("no_evidence");
    expect(by("JB-999-01").status).toBe("no_evidence");
    // Existing relationships are never overwritten.
    expect(by("JB-104-02").status).toBe("conflict");
    expect(by("JB-104-03").status).toBe("already_linked");
  });

  it("never proposes a position another box already holds", () => {
    const plan = planJboxRacewayPopulation(
      graph({
        raceway: [{ id: "r104", conduit_id: "CON-104" }],
        jbox: [
          { id: "j1", jbox_id: "JB-104-01", raceway_uuid: "r104", raceway_sequence: 2 },
          { id: "j2", jbox_id: "JB-104-02" },
        ],
      } as never),
    );
    expect(plan.find((p) => p.jbox_id === "JB-104-02")?.status).toBe("conflict");
  });
});
