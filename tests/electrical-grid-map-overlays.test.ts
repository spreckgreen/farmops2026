import { describe, expect, it } from "vitest";
import {
  GRID_BASE_OVERLAY_ORDER,
  PROGRESS_MODE_ORDER,
  gridCellCounts,
  isGridBaseOverlay,
  isProgressMode,
  overlayPosts,
  overlayShowsGrid,
  overlayShowsPosts,
  progressCounts,
  progressModeMatches,
  recentObserved,
} from "@/lib/electrical-grid-map-overlays";
import type { OperationalAsset } from "@/lib/electrical-grid-operational";

function asset(over: Partial<OperationalAsset>): OperationalAsset {
  return {
    kind: "load",
    stableId: "FS-001",
    description: null,
    grid: null,
    designGrid: null,
    legacyGrid: null,
    gridReference: null,
    xFt: null,
    yFt: null,
    designXFt: null,
    designYFt: null,
    installStatus: null,
    verification: null,
    verificationNotes: null,
    locationEvidence: null,
    verifiedAt: null,
    updatedAt: null,
    location: null,
    panel: null,
    panelBasis: null,
    circuitClass: null,
    circuitClassBasis: null,
    precision: "EXACT",
    precisionBasis: "test",
    xPct: null,
    yPct: null,
    plottedXFt: null,
    plottedYFt: null,
    spanned: false,
    locationSource: "NOT_PLOTTED",
    placementCandidates: [],
    placementDisagreement: null,
    stackIndex: 0,
    stackSize: 1,
    fanDxFt: 0,
    fanDyFt: 0,
    ...over,
  } as OperationalAsset;
}

describe("base reference overlay", () => {
  it("exposes the three selectable bases", () => {
    expect(GRID_BASE_OVERLAY_ORDER).toEqual(["POLE_AND_GRID", "GRID_ONLY", "POLE_ONLY"]);
    expect(isGridBaseOverlay("GRID_ONLY")).toBe(true);
    expect(isGridBaseOverlay("SOMETHING")).toBe(false);
  });

  it("shows grid lines and posts only where the base says so", () => {
    expect(overlayShowsGrid("GRID_ONLY")).toBe(true);
    expect(overlayShowsPosts("GRID_ONLY")).toBe(false);
    expect(overlayPosts("GRID_ONLY")).toHaveLength(0);
    expect(overlayShowsGrid("POLE_ONLY")).toBe(false);
    expect(overlayPosts("POLE_ONLY").length).toBeGreaterThan(0);
    expect(overlayShowsGrid("POLE_AND_GRID") && overlayShowsPosts("POLE_AND_GRID")).toBe(true);
  });
});

describe("progress modes", () => {
  const installed = asset({ stableId: "FS-010", installStatus: "complete" });
  const planned = asset({ stableId: "FS-011", installStatus: "planned" });
  const staged = asset({
    stableId: "FS-012",
    installStatus: "planned",
    pendingObservation: {
      batchId: "FA-FS-2026-09-03-PM-R1",
      itemKey: "k",
      fieldGridReference: "C4",
      poleScheme: null,
      poleLocationKind: null,
      poleRefStart: null,
      poleRefEnd: null,
      observedAt: "2026-09-03T18:00:00.000Z",
      evidence: "audit",
    },
  });

  it("keeps planned, remaining and current distinct", () => {
    expect(PROGRESS_MODE_ORDER).toEqual(["PLANNED", "REMAINING", "CURRENT"]);
    expect(isProgressMode("CURRENT")).toBe(true);
    expect(progressModeMatches(planned, "PLANNED")).toBe(true);
    expect(progressModeMatches(planned, "REMAINING")).toBe(true);
    expect(progressModeMatches(planned, "CURRENT")).toBe(false);
    expect(progressModeMatches(installed, "REMAINING")).toBe(false);
    expect(progressModeMatches(installed, "CURRENT")).toBe(true);
  });

  it("includes recent staged audits in current only", () => {
    expect(progressModeMatches(staged, "CURRENT")).toBe(true);
    expect(progressModeMatches(staged, "REMAINING")).toBe(true);
  });

  it("counts each mode and the staged-only share", () => {
    const c = progressCounts([installed, planned, staged]);
    expect(c).toMatchObject({ PLANNED: 3, REMAINING: 2, CURRENT: 2, stagedOnly: 1 });
    expect(c.installedPct).toBeCloseTo(33.3, 1);
  });
});

describe("per-grid counts", () => {
  it("counts plotted records into corrected cells and skips unplotted ones", () => {
    const counts = gridCellCounts([
      asset({ stableId: "FS-020", plottedXFt: 24, plottedYFt: 16 }),
      asset({ stableId: "FS-021", plottedXFt: 25, plottedYFt: 17 }),
      asset({ stableId: "FS-022", plottedXFt: 0, plottedYFt: 0 }),
      asset({ stableId: "FS-023" }),
    ]);
    const c4 = counts.find((c) => c.cell === "C4");
    expect(c4?.count).toBe(2);
    expect(c4?.stableIds).toEqual(["FS-020", "FS-021"]);
    expect(counts.find((c) => c.cell === "A1")?.count).toBe(1);
    expect(counts.reduce((n, c) => n + c.count, 0)).toBe(3);
  });
});

describe("most recent observed", () => {
  it("ranks verified observations, then staged audits, then record updates", () => {
    const list = recentObserved([
      asset({
        stableId: "FS-030",
        verification: "VERIFIED_AS_INSTALLED",
        verifiedAt: "2026-09-01T00:00:00.000Z",
      }),
      asset({
        stableId: "FS-031",
        updatedAt: "2026-09-02T00:00:00.000Z",
      }),
      asset({
        stableId: "FS-032",
        pendingObservation: {
          batchId: "FA-FS-2026-09-03-PM-R1",
          itemKey: "k",
          fieldGridReference: "F9",
          poleScheme: null,
          poleLocationKind: null,
          poleRefStart: null,
          poleRefEnd: null,
          observedAt: "2026-09-03T00:00:00.000Z",
          evidence: "audit",
        },
      }),
    ]);
    expect(list.map((e) => e.stableId)).toEqual(["FS-032", "FS-031", "FS-030"]);
    expect(list[0]!.source).toBe("STAGED_AUDIT");
    expect(list[0]!.batchId).toBe("FA-FS-2026-09-03-PM-R1");
    expect(list[1]!.source).toBe("RECORD_UPDATE");
    expect(list[2]!.source).toBe("VERIFIED_FIELD");
  });

  it("honours the limit", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      asset({ stableId: `FS-1${i}`, updatedAt: `2026-09-0${(i % 9) + 1}T00:00:00.000Z` }),
    );
    expect(recentObserved(many, 5)).toHaveLength(5);
  });
});
