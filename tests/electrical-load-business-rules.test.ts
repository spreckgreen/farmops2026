import { describe, expect, it } from "vitest";
import {
  criticality,
  demandFacts,
  generatorTier,
  logicalCircuits,
  panelRuleRollup,
  physicalLoad,
  preservedFacts,
  SHARED_DEFAULT_RATING_AMPS,
} from "@/lib/electrical-load-business-rules";

const row = (over: Record<string, unknown> = {}) => ({
  load_id: "FS-001",
  description: "Fiber switch",
  critical: true,
  backup_priority: "Critical",
  dedicated_shared: "D",
  suggested_panel: "PNL-FS-CRIT",
  connected_va: 150,
  ...over,
});

describe("criticality", () => {
  it("comes only from Critical = Y", () => {
    expect(criticality(row()).value).toBe("CRITICAL");
    expect(criticality(row({ critical: false })).value).toBe("NOT CRITICAL");
    expect(criticality(row({ critical: null })).value).toBe("REVIEW");
  });

  it("ignores description, amps and panel", () => {
    const r = row({ critical: false, description: "Well pump", amps: 40, suggested_panel: "PNL-FS-CRIT" });
    expect(criticality(r).value).toBe("NOT CRITICAL");
  });
});

describe("generator tier", () => {
  it("maps Backup Priority literally", () => {
    expect(generatorTier(row({ backup_priority: "Critical" })).tier).toBe("REQUIRED");
    expect(generatorTier(row({ backup_priority: "Nice to Have" })).tier).toBe("OPTIONAL-1");
    expect(generatorTier(row({ backup_priority: "Stretch" })).tier).toBe("OPTIONAL-2");
    expect(generatorTier(row({ backup_priority: "Never" })).tier).toBe("EXCLUDE");
    expect(generatorTier(row({ backup_priority: "TBD" })).tier).toBe("REVIEW");
    expect(generatorTier(row({ backup_priority: "" })).tier).toBe("REVIEW");
    expect(generatorTier(row({ backup_priority: "East01" })).tier).toBe("REVIEW");
  });
});

describe("demand", () => {
  it("never converts Circuit Capacity Only into VA", () => {
    const d = demandFacts(row({ demand_basis: "Circuit Capacity Only", amps: 20, volts: 120 }));
    expect(d.circuitCapacityOnly).toBe(true);
    expect(d.demandVa).toBeNull();
    expect(d.demandUnknown).toBe(true);
  });

  it("preserves stated fields including TBD", () => {
    const p = preservedFacts(row({ demand_va: "TBD", phase: "", continuous_load: null }));
    expect(p.demandVa).toBe("TBD");
    expect(p.phase).toBe("NOT IN RECORD");
    expect(p.continuousLoad).toBe("NOT IN RECORD");
  });
});

describe("logical circuits", () => {
  it("counts a dedicated row as one circuit", () => {
    const circuits = logicalCircuits([row()]);
    expect(circuits).toHaveLength(1);
    expect(circuits[0]!.kind).toBe("DEDICATED");
    expect(circuits[0]!.countsAsCircuit).toBe(true);
  });

  it("collapses shared rows on one group into one circuit (BR-003)", () => {
    const circuits = logicalCircuits([
      row({ load_id: "FS-010", dedicated_shared: "S", circuit_group_ref: "CG-EAST01" }),
      row({ load_id: "FS-011", dedicated_shared: "S", circuit_group_ref: "CG-EAST01", critical: false, backup_priority: "Never" }),
    ]);
    expect(circuits).toHaveLength(1);
    const c = circuits[0]!;
    expect(c.kind).toBe("SHARED");
    expect(c.loads).toHaveLength(2);
    expect(c.tier).toBe("REQUIRED");
    expect(c.coLoads).toEqual(["FS-011"]);
    expect(c.connectedVaTotal).toBe(300);
    expect(c.plannedRatingAmps).toBe(SHARED_DEFAULT_RATING_AMPS);
  });

  it("lets a documented rating override the BR-002 default", () => {
    const [c] = logicalCircuits([
      row({ dedicated_shared: "S", circuit_group_ref: "CG-A", installed_ocp_rating: 30 }),
    ]);
    expect(c!.plannedRatingAmps).toBe(30);
    expect(c!.ratingBasis).toContain("documented");
  });

  it("keeps blank/TBD shared groups unresolved and uncounted", () => {
    const [c] = logicalCircuits([row({ dedicated_shared: "S", circuit_group_ref: "TBD" })]);
    expect(c!.kind).toBe("UNRESOLVED");
    expect(c!.countsAsCircuit).toBe(false);
  });
});

describe("panel rollup", () => {
  it("groups by Suggested Panel only and reports review items", () => {
    const rollup = panelRuleRollup("PNL-FS-CRIT", [
      row(),
      row({ load_id: "FS-002", suggested_panel: "PNL-FS-NE" }),
      row({ load_id: "FS-003", backup_panel: "PNL-FS-CRIT", suggested_panel: "" }),
      row({ load_id: "FS-004", backup_priority: "TBD" }),
    ]);
    expect(rollup.counts.physicalRows).toBe(2);
    expect(rollup.counts.tier.REVIEW).toBe(1);
    expect(rollup.reviewItems.some((r) => r.startsWith("FS-004"))).toBe(true);
  });

  it("does not drop a critical load because Future = Y", () => {
    const rollup = panelRuleRollup("PNL-FS-CRIT", [row({ future: true })]);
    expect(rollup.counts.critical).toBe(1);
  });
});
