import { describe, expect, it } from "vitest";

import {
  buildPanelCompleteness,
  circuitRollout,
  classifyPosition,
  deriveMilestones,
  milestoneCountLines,
  panelCapacity,
  positionClassTotals,
  type ScopedCircuit,
} from "@/lib/electrical-lifecycle";
import {
  panelCompletenessCsv,
  panelCompletenessFromSnapshot,
} from "@/lib/electrical-panel-completeness";
import { buildFsNwAuditManifestR3 } from "@/lib/electrical-fs-nw-audit-r3";
import { buildFsNwAuditManifestR2, FS_NW_AUDITED_LOADS } from "@/lib/electrical-fs-nw-audit-r1";

const activePos = (position: number, poles = 1) => ({
  position,
  poles,
  label: `CG ${position}`,
  circuit_group_uuid: `cg-${position}`,
  install_status: "complete",
});

const sevenOfForty = Array.from({ length: 7 }, (_, i) => activePos(i + 1));

const circuit = (id: string, status: string, breaker = true): ScopedCircuit => ({
  circuit_group_id: id,
  in_scope: true,
  milestones: deriveMilestones({ install_status: status, breaker_installed: breaker }),
});

describe("capacity vs completion", () => {
  it("reads 7 of 40 as 17.5% utilization, not project completion", () => {
    const cap = panelCapacity(sevenOfForty, 40);
    expect(cap.occupiedPositions).toBe(7);
    expect(cap.utilizationPercent).toBe(17.5);
    const rollout = circuitRollout(
      sevenOfForty.map((p, i) => circuit(`CG-FS-00${i + 1}`, "as_built_verified")),
    );
    expect(rollout.rolloutPercent).toBeGreaterThan(cap.utilizationPercent);
    expect(cap.denominator).toMatch(/not project completion/i);
  });

  it("classified spare positions never reduce completion", () => {
    const spares = Array.from({ length: 33 }, (_, i) => ({
      position: i + 8,
      poles: 1,
      label: "SPARE",
    }));
    const rollout = circuitRollout(
      sevenOfForty.map((_, i) => circuit(`CG-FS-00${i + 1}`, "as_built_verified")),
    );
    const result = buildPanelCompleteness({
      panel_id: "PNL-FS-NW",
      infrastructure_status: "raceway_installed",
      usablePositions: 40,
      positions: [...sevenOfForty, ...spares],
      circuits: sevenOfForty.map((_, i) => circuit(`CG-FS-00${i + 1}`, "as_built_verified")),
    });
    expect(result.rollout.rolloutPercent).toBe(rollout.rolloutPercent);
    expect(result.positionClasses.totals["spare"]).toBe(33);
    expect(result.positionClasses.unclassified).toBe(0);
    expect(result.capacity.utilizationPercent).toBe(17.5);
  });

  it("unclassified positions reduce documentation coverage only", () => {
    const totals = positionClassTotals(sevenOfForty, 40);
    expect(totals.unclassified).toBe(33);
    expect(totals.documentationCoveragePercent).toBe(17.5);
    const rollout = circuitRollout(
      sevenOfForty.map((_, i) => circuit(`CG-FS-00${i + 1}`, "as_built_verified")),
    );
    expect(rollout.rolloutPercent).toBe(100);
  });

  it("counts a multi-pole breaker once but takes its poles", () => {
    const cap = panelCapacity([activePos(1, 2), activePos(3, 3)], 40);
    expect(cap.occupiedPositions).toBe(5);
    expect(cap.breakerCount).toBe(2);
  });

  it("excludes not-applicable milestones from denominators", () => {
    const cabled: ScopedCircuit = {
      circuit_group_id: "CG-FS-009",
      in_scope: true,
      milestones: deriveMilestones({
        install_status: "conductors_installed",
        breaker_installed: true,
        not_applicable: ["raceway_installed"],
      }),
    };
    const r = circuitRollout([cabled]);
    const raceway = r.counts.find((c) => c.milestone === "raceway_installed")!;
    expect(raceway.applicable).toBe(0);
    expect(raceway.notApplicable).toBe(1);
    expect(r.applicableMilestones).toBe(8);
  });

  it("can be operational and partially populated", () => {
    const r = buildPanelCompleteness({
      panel_id: "PNL-FS-NW",
      infrastructure_status: "raceway_installed",
      usablePositions: 40,
      positions: sevenOfForty,
      circuits: sevenOfForty.map((_, i) => circuit(`CG-FS-00${i + 1}`, "complete")),
    });
    expect(r.operational).toBe("Operational — partially populated");
    expect(r.infrastructure.label).toBe("Raceway installed");
    expect(r.infrastructure.stage).toBe(4);
  });

  it("one incomplete circuit leaves siblings' results untouched", () => {
    const all = [circuit("A", "complete"), circuit("B", "complete")];
    const mixed = [circuit("A", "complete"), circuit("B", "planned")];
    const a = circuitRollout(all).counts.find((c) => c.milestone === "source_termination")!;
    const b = circuitRollout(mixed).counts.find((c) => c.milestone === "source_termination")!;
    expect(a.complete).toBe(2);
    expect(b.complete).toBe(1);
    expect(b.applicable).toBe(2);
  });

  it("shows holds separately from every percentage", () => {
    const base = {
      panel_id: "PNL-FS-NW",
      infrastructure_status: "raceway_installed",
      usablePositions: 40,
      positions: sevenOfForty,
      circuits: sevenOfForty.map((_, i) => circuit(`CG-FS-00${i + 1}`, "complete")),
    };
    const without = buildPanelCompleteness(base);
    const withHold = buildPanelCompleteness({
      ...base,
      holds: [{ ref: "FS-999 (F9 / 06SE)", reason: "Load not in record", kind: "hold" }],
    });
    expect(withHold.rollout.rolloutPercent).toBe(without.rollout.rolloutPercent);
    expect(withHold.holds).toHaveLength(1);
    expect(milestoneCountLines(withHold).join(" ")).toMatch(/1 unresolved hold/);
  });

  it("never advances testing or energization without evidence", () => {
    const m = deriveMilestones({ install_status: "conductors_installed", breaker_installed: true });
    expect(m["tested"]).toBe("pending");
    expect(m["energized"]).toBe("pending");
    expect(m["as_built_verified"]).toBe("pending");
    const evidenced = deriveMilestones({
      install_status: "conductors_installed",
      evidence: ["tested", "energized"],
    });
    expect(evidenced["tested"]).toBe("complete");
    expect(evidenced["energized"]).toBe("complete");
    expect(evidenced["as_built_verified"]).toBe("pending");
  });

  it("classifies positions from their own record only", () => {
    expect(classifyPosition({ position: 1, poles: 1, label: "SPARE" })).toBe("spare");
    expect(classifyPosition({ position: 2, poles: 1, label: "Reserved — future shop" })).toBe(
      "reserved",
    );
    expect(classifyPosition({ position: 3, poles: 1, label: "N/A" })).toBe("unavailable");
    expect(classifyPosition({ position: 4, poles: 1 })).toBe("unclassified");
    expect(classifyPosition(activePos(5))).toBe("active");
  });
});

describe("panel completeness from stored records", () => {
  const snapshot = {
    panels: [
      {
        id: "p1",
        panel_id: "PNL-FS-NW",
        description: null,
        building: "Farm Shop",
        install_status: "raceway_installed",
        completion_percent: null,
        label_status: null,
        spaces: 40,
        notes: null,
      },
    ],
    circuits: Array.from({ length: 7 }, (_, i) => ({
      id: `c${i + 1}`,
      circuit_group_id: `CG-FS-00${i + 1}`,
      description: null,
      panel_uuid: "p1",
      breaker_number: 29 + i,
      circuit_rating_amps: 20,
      voltage: 120,
      install_status: "complete",
      completion_percent: null,
      notes: null,
    })),
    positions: Array.from({ length: 7 }, (_, i) => ({
      id: `x${i + 1}`,
      panel_uuid: "p1",
      side: "left",
      position: i + 1,
      poles: 1,
      breaker_number: 29 + i,
      ocp_amps: 20,
      label: "shop",
      circuit_group_uuid: `c${i + 1}`,
      install_status: "complete",
      notes: null,
    })),
    loads: Array.from({ length: 20 }, (_, i) => ({
      id: `l${i}`,
      load_id: `FS-0${i + 40}`,
      description: null,
      area: null,
      suggested_panel: "PNL-FS-NW",
      circuit_group_uuid: `c${(i % 7) + 1}`,
      install_status: "complete",
    })),
  };

  it("reports the PNL-FS-NW shape from records, not from example text", () => {
    const r = panelCompletenessFromSnapshot(snapshot, "p1", {
      holds: [{ ref: "B29 (F9 / 06SE)", reason: "Load not in record", kind: "hold" }],
      evidenceSource: "FA-FS-2026-09-03-PM-R2",
      calculatedAt: "2026-09-05T00:00:00.000Z",
    })!;
    expect(r.operational).toBe("Operational — partially populated");
    expect(r.infrastructure.label).toBe("Raceway installed");
    expect(r.infrastructure.stage).toBe(4);
    expect(r.capacity.occupiedPositions).toBe(7);
    expect(r.capacity.utilizationPercent).toBe(17.5);
    expect(r.rollout.inScopeCircuits).toBe(7);
    expect(r.loads.identified).toBe(20);
    expect(r.loads.connected).toBe(20);
    expect(r.holds).toHaveLength(1);
    const spareOrUnclassified =
      r.positionClasses.totals["spare"] +
      r.positionClasses.totals["reserved"] +
      r.positionClasses.totals["unclassified"];
    expect(spareOrUnclassified).toBe(33);
    expect(r.evidenceSource).toBe("FA-FS-2026-09-03-PM-R2");
    expect(panelCompletenessCsv(r)).toMatch(/Capacity utilization/);
  });

  it("does not advance a planned load merely because it is assigned to a group", () => {
    const planned = {
      ...snapshot,
      loads: snapshot.loads.map((l) => ({ ...l, install_status: "planned" })),
    };
    const r = panelCompletenessFromSnapshot(planned, "p1")!;
    expect(r.loads.connected).toBe(0);
    expect(r.loads.verified).toBe(0);
    const verified = r.rollout.counts.find((c) => c.milestone === "as_built_verified")!;
    expect(verified.complete).toBe(0);
  });
});

describe("R2 immutability and the R3 metadata follow-up", () => {
  it("keeps R2 relationship-only", () => {
    const r2 = buildFsNwAuditManifestR2();
    expect(r2.batch_id).toBe("FA-FS-2026-09-03-PM-R2");
    for (const i of r2.items.filter((x) => x.entity_kind === "load" && x.operation === "LINK")) {
      expect(i.fields).toEqual({});
    }
  });

  it("R3-METADATA changes load metadata only and recreates nothing from R2", () => {
    const auditedIds = Array.from(
      new Set(Object.values(FS_NW_AUDITED_LOADS).flat().map((v) => v.toUpperCase())),
    );
    const groups = Object.keys(FS_NW_AUDITED_LOADS).map((breaker, i) => ({
      breaker_reference: breaker,
      circuit_group_id: `CG-FS-00${i + 1}`,
    }));
    const built = buildFsNwAuditManifestR3({
      groups,
      knownLoadIds: auditedIds,
      buildingFromPanel: "Farm Shop",
    });
    expect(built.manifest.batch_id).toBe("FA-FS-2026-09-03-PM-R3-METADATA");
    expect(built.manifest.compensates_batch_id).toBeNull();
    for (const item of built.manifest.items) {
      expect(item.entity_kind).toBe("load");
      expect(item.operation).not.toBe("CREATE");
    }
    expect(built.reconciled).toHaveLength(20);
  });
});
