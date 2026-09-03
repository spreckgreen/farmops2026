import { describe, expect, it } from "vitest";
import {
  buildGridRecovery,
  normalizeGridText,
  recoveryCsv,
  type CanonicalGridRow,
  type FarmOpsGridRow,
} from "@/lib/electrical-grid-recovery";

const canonical: CanonicalGridRow[] = [
  {
    stable_id: "FS-001",
    description: "Welder receptacle",
    area: "Farm Shop",
    location: "East Wall",
    canonical_grid_raw: "A1",
  },
  {
    stable_id: "FS-002",
    description: "Portable compressor",
    area: "Farm Shop",
    location: "",
    canonical_grid_raw: "MOBILE",
  },
  {
    stable_id: "FS-003",
    description: "Bench lighting",
    area: "Farm Shop",
    location: "",
    canonical_grid_raw: "??",
  },
];

const farmOps: FarmOpsGridRow[] = [
  {
    stable_id: "FS-001",
    description: "Welder receptacle",
    area: "Farm Shop",
    location: "East Wall",
    grid: "C4",
  },
  {
    stable_id: "FS-002",
    description: "Portable compressor",
    area: "Farm Shop",
    location: "",
    grid: "MOBILE",
  },
  {
    stable_id: "FS-003",
    description: "Bench lighting",
    area: "Farm Shop",
    location: "",
    grid: "??",
  },
];

describe("farm shop grid recovery validation", () => {
  it("normalizes grid text for comparison only", () => {
    expect(normalizeGridText(" c 4 ")).toBe("C4");
  });

  it("takes location from canonical and flags FarmOps disagreement", () => {
    const report = buildGridRecovery({ canonical, farmOps, panels: [] });
    const fs1 = report.rows.find((r) => r.stable_id === "FS-001")!;
    expect(fs1.canonical_grid_raw).toBe("A1");
    expect(fs1.farmops_grid_current).toBe("C4");
    expect(fs1.farmops_disagrees).toBe(true);
    expect(fs1.overlay).toBe("FARMOPS_GRID_DISAGREES_WITH_CANONICAL");
    expect(report.counts.FARMOPS_GRID_DISAGREES_WITH_CANONICAL).toBe(1);
  });

  it("keeps MOBILE non-fixed and artifacts unresolved without inventing a position", () => {
    const report = buildGridRecovery({ canonical, farmOps, panels: [] });
    const mobile = report.rows.find((r) => r.stable_id === "FS-002")!;
    expect(mobile.precision).toBe("NON_FIXED");
    expect(mobile.x_ft).toBeNull();
    const artifact = report.rows.find((r) => r.stable_id === "FS-003")!;
    expect(artifact.precision).toBe("UNRESOLVED");
    expect(artifact.x_ft).toBeNull();
  });

  it("reports how many migration records change when the source grid is canonical", () => {
    const report = buildGridRecovery({ canonical, farmOps, panels: [] });
    expect(report.delta.compared).toBe(3);
    expect(report.delta.changed).toBe(1);
    expect(report.delta.records.find((r) => r.stable_id === "FS-001")!.changed_fields.length)
      .toBeGreaterThan(0);
  });

  it("attributes the wrong map to the FarmOps import when canonical is self-consistent", () => {
    const report = buildGridRecovery({ canonical, farmOps, panels: [] });
    expect(report.diagnosis.farmops_grid_disagreements).toBe(1);
    expect(["FARMOPS_IMPORT_DEFECT", "MIXED"]).toContain(report.diagnosis.verdict);
  });

  it("emits a csv with the requested columns and writes nothing", () => {
    const report = buildGridRecovery({ canonical, farmOps, panels: [] });
    const csv = recoveryCsv(report.rows);
    expect(csv.split("\n")[0]).toContain("canonical_grid_raw,farmops_grid_current");
    expect(csv.split("\n").length).toBe(report.rows.length + 1);
  });
});
