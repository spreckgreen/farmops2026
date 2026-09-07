import { describe, expect, it } from "vitest";
import {
  circuitGroupBreakerText,
  circuitGroupDisplayLabel,
  deriveBranchCircuitGroups,
} from "@/lib/electrical-circuit-group-topology";

const groups = [
  {
    id: "g6",
    circuit_group_id: "CG-FS-006",
    description: "D",
    suggested_panel: "PNL-FS-NW",
    breaker_number: 31,
  },
  {
    id: "g7",
    circuit_group_id: "CG-FS-007",
    description: "E",
    suggested_panel: "PNL-FS-NW",
    breaker_number: 29,
  },
];

const loads = [
  { id: "l38", load_id: "FS-038", circuit_group_uuid: "g6" },
  { id: "l39", load_id: "FS-039", circuit_group_uuid: "g7" },
  { id: "l99", load_id: "FS-099", circuit_group_uuid: null },
];

describe("branch circuit group from verified endpoint", () => {
  const plan = deriveBranchCircuitGroups({
    branches: [
      {
        id: "b1",
        branch_id: "BR-105-01-01",
        load_uuid: "l39",
        dest_endpoint_ref: "FS-039",
        source_jbox_uuid: "jb105",
      },
      {
        id: "b2",
        branch_id: "BR-105-01-02",
        load_uuid: "l38",
        dest_endpoint_ref: "FS-038",
        source_jbox_uuid: "jb105",
      },
      { id: "b3", branch_id: "BR-104-01-03", dest_endpoint_ref: "FS-054" },
      { id: "b4", branch_id: "BR-104-02-03", load_uuid: "l99", dest_endpoint_ref: "FS-099" },
      {
        id: "b5",
        branch_id: "BR-104-02-04",
        load_uuid: "l38",
        circuit_group_uuid: "g7",
      },
    ],
    loads,
    groups,
    jboxes: [{ id: "jb105", jbox_id: "JB-105-01" }],
  });

  it("proposes the endpoint load's single circuit group", () => {
    const byBranch = new Map(plan.proposals.map((p) => [p.branch_id, p]));
    expect(byBranch.get("BR-105-01-01")?.circuit_group_id).toBe("CG-FS-007");
    expect(byBranch.get("BR-105-01-02")?.circuit_group_id).toBe("CG-FS-006");
  });

  it("skips unlinked endpoints, groupless loads and conflicts without guessing", () => {
    const reasons = new Map(plan.skipped.map((s) => [s.branch_id, s.reason]));
    expect(reasons.get("BR-104-01-03")).toContain("FS-054");
    expect(reasons.get("BR-104-02-03")).toContain("no single circuit-group");
    expect(reasons.get("BR-104-02-04")).toContain("Conflict");
    expect(plan.proposals.some((p) => p.branch_id === "BR-104-02-04")).toBe(false);
  });

  it("never assigns a single group to a mixed junction box", () => {
    const box = plan.containers.find((c) => c.stable_id === "JB-105-01");
    expect(box?.circuitGroupIds).toEqual(["CG-FS-006", "CG-FS-007"]);
    expect(box?.reason).toContain("more than one circuit group");
  });
});

describe("circuit group display", () => {
  it("formats id, description and panel/breaker", () => {
    expect(circuitGroupDisplayLabel(groups[1]!)).toBe("CG-FS-007 — E — PNL-FS-NW-B29");
  });

  it("omits unknown parts instead of inventing them", () => {
    expect(circuitGroupBreakerText({ suggested_panel: null, breaker_number: null })).toBe("");
    expect(
      circuitGroupDisplayLabel({ id: "x", circuit_group_id: "CG-FS-010", description: null }),
    ).toBe("CG-FS-010");
  });
});
