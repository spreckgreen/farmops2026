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

// Production defect regression (Phase 4.4b): PNL-FS-NW → CON-104 →
// JB-104-01 → JB-104-02 → JB-104-03, with four branches leaving JB-104-02 and
// one leaving JB-104-03. The rendered run must continue *through* the
// intermediate branches to the last box.
describe("CON-104 exact production topology", () => {
  const branches = [
    ...[1, 2, 3, 4].map((n) => ({
      id: `b2${n}`,
      branch_id: `BR-104-02-0${n}`,
      source_jbox_uuid: "j2",
      source_endpoint_ref: "JB-104-02",
    })),
    {
      id: "b31",
      branch_id: "BR-104-03-01",
      source_jbox_uuid: "j3",
      source_endpoint_ref: "JB-104-03",
    },
  ];

  it("chains all three boxes in order and keeps the run going past the branches", () => {
    const out = buildDiagram(graph({ branch: branches } as never), { type: "whole_system" });
    const key = (stableId: string) => out.nodes.find((n) => n.stableId === stableId)?.id;
    const con = key("CON-104")!;
    const j1 = key("JB-104-01")!;
    const j2 = key("JB-104-02")!;
    const j3 = key("JB-104-03")!;
    expect([con, j1, j2, j3].every(Boolean)).toBe(true);
    const has = (from: string, to: string) =>
      out.edges.some((e) => e.from === from && e.to === to);
    expect(has(con, j1)).toBe(true);
    expect(has(j1, j2)).toBe(true);
    expect(has(j2, j3)).toBe(true);
    // One physical run: no extra raceway invented between the boxes.
    expect(out.nodes.filter((n) => n.klass === "raceway")).toHaveLength(1);
    for (const br of branches) {
      expect(out.nodes.some((n) => n.stableId === br.branch_id)).toBe(true);
    }
    expect(out.edges.map((e) => e.label)).toEqual(
      expect.arrayContaining(["junction 01", "junction 02", "junction 03"]),
    );
  });

  it("proposes positions 1/2/3 when the same boxes are still unlinked", () => {
    const plan = planJboxRacewayPopulation(
      graph({
        jbox: [
          { id: "j1", jbox_id: "JB-104-01" },
          { id: "j2", jbox_id: "JB-104-02" },
          { id: "j3", jbox_id: "JB-104-03" },
        ],
        branch: branches,
      } as never),
    );
    expect(plan.map((p) => [p.jbox_id, p.status, p.proposed_raceway, p.proposed_sequence])).toEqual([
      ["JB-104-01", "proposed", "CON-104", 1],
      ["JB-104-02", "proposed", "CON-104", 2],
      ["JB-104-03", "proposed", "CON-104", 3],
    ]);
  });

  it("never proposes across an ambiguous path (CON-104 plus legacy EMT-104)", () => {
    const plan = planJboxRacewayPopulation(
      graph({
        raceway: [
          { id: "r104", conduit_id: "CON-104" },
          { id: "r104b", conduit_id: "EMT-104" },
        ],
        jbox: [{ id: "j1", jbox_id: "JB-104-01" }],
      } as never),
    );
    expect(plan[0]!.status).toBe("no_evidence");
    expect(plan[0]!.evidence).toContain("matches 2 raceways");
  });
});
