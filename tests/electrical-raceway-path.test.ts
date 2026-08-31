import { describe, it, expect } from "vitest";
import {
  orderedJunctionPoints,
  planJboxRacewayPopulation,
  racewayPathFindings,
  resolveJboxRacewayCandidates,
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
    const key = (stableId: string) => out.nodes.find((n) => n.stableId === stableId)?.key;
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

describe("production CON-104 ordered path", () => {
  const graph = (p: Record<string, unknown[]>) =>
    ({ panel: [], circuit_group: [], load: [], raceway: [], jbox: [], branch: [], ...p }) as never;

  it("proposes all three unlinked boxes even though CON-104 already ends at JB-104-01", () => {
    const plan = planJboxRacewayPopulation(
      graph({
        raceway: [
          {
            id: "r104",
            conduit_id: "CON-104",
            source_panel_uuid: "p-nw",
            dest_jbox_uuid: "j1",
            dest_endpoint_ref: "JB-104-01",
          },
        ],
        jbox: [
          { id: "j1", jbox_id: "JB-104-01", raceway_uuid: null, raceway_sequence: null },
          { id: "j2", jbox_id: "JB-104-02", raceway_uuid: null, raceway_sequence: null },
          { id: "j3", jbox_id: "JB-104-03", raceway_uuid: null, raceway_sequence: null },
        ],
      }),
    );
    const proposed = plan.filter((p) => p.status === "proposed");
    expect(proposed).toHaveLength(3);
    expect(
      proposed.map((p) => [p.jbox_id, p.proposed_raceway, p.proposed_sequence]),
    ).toEqual([
      ["JB-104-01", "CON-104", 1],
      ["JB-104-02", "CON-104", 2],
      ["JB-104-03", "CON-104", 3],
    ]);
  });

  it("uses the endpoint relationship when the box ID encodes no path", () => {
    const plan = planJboxRacewayPopulation(
      graph({
        raceway: [{ id: "r104", conduit_id: "CON-104", dest_jbox_uuid: "jx" }],
        jbox: [{ id: "jx", jbox_id: "JB-NW-MAIN" }],
      }),
    );
    expect(plan[0]?.status).toBe("proposed");
    expect(plan[0]?.proposed_raceway).toBe("CON-104");
    expect(plan[0]?.proposed_sequence).toBe(1);
  });
});

// Phase 4.4b defect: QA reported JB-104-01/02/03 as actionable orphans while the
// correction preview showed nothing. QA fired on "any raceway encodes this path"
// while the planner independently required exactly one candidate and then folded
// every non-proposal into an undifferentiated bucket. Both now project the same
// resolver, and every box carries a terminal status plus a reason.
describe("shared raceway candidate resolution", () => {
  const g = (p: Record<string, unknown[]>) =>
    ({ panel: [], circuit_group: [], load: [], raceway: [], jbox: [], branch: [], ...p }) as never;

  const production = () =>
    g({
      panel: [{ id: "p-nw", panel_id: "PNL-FS-NW" }],
      raceway: [
        {
          id: "r104",
          conduit_id: "CON-104",
          source_panel_uuid: "p-nw",
          source_endpoint_ref: "PNL-FS-NW",
          dest_jbox_uuid: "j1",
          dest_endpoint_ref: "JB-104-01",
        },
      ],
      jbox: [
        { id: "j1", jbox_id: "JB-104-01", raceway_uuid: null, raceway_sequence: null },
        { id: "j2", jbox_id: "JB-104-02", raceway_uuid: null, raceway_sequence: null },
        { id: "j3", jbox_id: "JB-104-03", raceway_uuid: null, raceway_sequence: null },
      ],
      branch: [
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
      ],
    });

  it("resolves the exact production fixture to positions 1/2/3 on CON-104", () => {
    const res = resolveJboxRacewayCandidates(production());
    expect(
      res.map((r) => [r.jbox_id, r.extracted_path, r.proposed_sequence, r.target_raceway, r.status]),
    ).toEqual([
      ["JB-104-01", "104", 1, "CON-104", "proposed"],
      ["JB-104-02", "104", 2, "CON-104", "proposed"],
      ["JB-104-03", "104", 3, "CON-104", "proposed"],
    ]);
    // Endpoint evidence strengthens JB-104-01 without disqualifying it.
    expect(res[0]!.endpoint_raceways).toEqual(["CON-104"]);
    expect(res.every((r) => r.reason.length > 0)).toBe(true);
  });

  it("shows the same three proposals in the correction preview", () => {
    const plan = planJboxRacewayPopulation(production());
    expect(
      plan.map((p) => [p.jbox_id, p.status, p.proposed_raceway, p.proposed_sequence]),
    ).toEqual([
      ["JB-104-01", "proposed", "CON-104", 1],
      ["JB-104-02", "proposed", "CON-104", 2],
      ["JB-104-03", "proposed", "CON-104", 3],
    ]);
    expect(plan.every((p) => p.resolution === "proposed")).toBe(true);
    expect(plan.every((p) => p.matching_raceways.includes("CON-104"))).toBe(true);
  });

  it("reports the same three records as actionable orphans in QA", () => {
    const orphans = racewayPathFindings(production()).filter(
      (f) => f.code === "orphan_path_topology",
    );
    expect(orphans.map((f) => f.stableId)).toEqual([
      "JB-104-01",
      "JB-104-02",
      "JB-104-03",
    ]);
    for (const f of orphans) expect(f.message).toContain("CON-104");
  });

  it("renders the physical backbone with every branch on its own box", () => {
    const linked = production() as unknown as { jbox: Record<string, unknown>[] };
    linked.jbox.forEach((j, i) => {
      j["raceway_uuid"] = "r104";
      j["raceway_sequence"] = i + 1;
    });
    const out = buildDiagram(linked as never, { type: "whole_system" });
    const key = (s: string) => out.nodes.find((n) => n.stableId === s)?.key ?? "";
    const has = (from: string, to: string) =>
      out.edges.some((e) => e.from === from && e.to === to);
    expect(has(key("PNL-FS-NW"), key("CON-104"))).toBe(true);
    expect(has(key("CON-104"), key("JB-104-01"))).toBe(true);
    expect(has(key("JB-104-01"), key("JB-104-02"))).toBe(true);
    expect(has(key("JB-104-02"), key("JB-104-03"))).toBe(true);
    for (const n of [1, 2, 3, 4]) {
      expect(has(key("JB-104-02"), key(`BR-104-02-0${n}`))).toBe(true);
    }
    expect(has(key("JB-104-03"), key("BR-104-03-01"))).toBe(true);
    expect(out.nodes.filter((n) => n.klass === "raceway")).toHaveLength(1);
  });

  it("gives every other case its own terminal status and reason", () => {
    const byId = (rs: ReturnType<typeof resolveJboxRacewayCandidates>, id: string) =>
      rs.find((r) => r.jbox_id === id)!;
    const res = resolveJboxRacewayCandidates(
      g({
        raceway: [
          { id: "r104", conduit_id: "CON-104" },
          { id: "r105", conduit_id: "CON-105" },
          { id: "r105b", conduit_id: "EMT-105" },
        ],
        jbox: [
          // ambiguous: two raceways encode path 105
          { id: "ja", jbox_id: "JB-105-01" },
          // no visible raceway encodes path 999
          { id: "jb", jbox_id: "JB-999-01" },
          // already linked to a different raceway
          { id: "jc", jbox_id: "JB-104-04", raceway_uuid: "r105", raceway_sequence: 4 },
          // position 2 on CON-104 is held by JB-104-90
          { id: "jd", jbox_id: "JB-104-90", raceway_uuid: "r104", raceway_sequence: 2 },
          { id: "je", jbox_id: "JB-104-02" },
          // already correct
          { id: "jf", jbox_id: "JB-104-01", raceway_uuid: "r104", raceway_sequence: 1 },
          // non-continuous / malformed ID with no endpoint evidence
          { id: "jg", jbox_id: "JBOX-NW-MAIN" },
        ],
      }),
    );
    expect(byId(res, "JB-105-01").status).toBe("ambiguous_raceway");
    expect(byId(res, "JB-999-01").status).toBe("no_matching_raceway");
    expect(byId(res, "JB-104-04").status).toBe("parent_conflict");
    expect(byId(res, "JB-104-02").status).toBe("sequence_conflict");
    expect(byId(res, "JB-104-01").status).toBe("already_linked");
    expect(byId(res, "JBOX-NW-MAIN").status).toBe("unparseable_id");
    // Nothing is dropped and nothing is reasonless.
    expect(res).toHaveLength(7);
    expect(res.every((r) => r.reason.trim().length > 0)).toBe(true);
    // QA does not call an un-correctable box an actionable orphan silently.
    const ambiguous = racewayPathFindings(
      g({
        raceway: [
          { id: "r105", conduit_id: "CON-105" },
          { id: "r105b", conduit_id: "EMT-105" },
        ],
        jbox: [{ id: "ja", jbox_id: "JB-105-01" }],
      }),
    ).find((f) => f.code === "orphan_path_topology")!;
    expect(ambiguous.message).toContain("ambiguous_raceway");
  });
});
