import { describe, expect, it } from "vitest";
import { numericDiagnostics } from "@/lib/electrical-numeric-diagnostics";
import { runParallelComparison, type OdsSheetRows } from "@/lib/electrical-parallel-validation";
import { buildElectricalSnapshot, type RawRow } from "@/lib/electrical-snapshot";
import { ENTITIES } from "@/lib/electrical-entities";
import type { ElectricalEntityKind } from "@/lib/electrical";
import {
  isStandardOcpRating,
  loadSemanticsCsv,
  loadSemanticsMarkdown,
  loadVoltageCurrentReview,
  nominalNameplatePair,
  vaBasisFor,
} from "@/lib/electrical-load-semantics";

const KINDS = Object.keys(ENTITIES) as ElectricalEntityKind[];

function snapshot(loads: RawRow[]) {
  const rows = {} as Record<ElectricalEntityKind, RawRow[]>;
  for (const kind of KINDS) rows[kind] = [];
  rows.load = loads;
  return buildElectricalSnapshot({
    generatedAt: "2026-08-30T00:00:00.000Z",
    rows,
    waypoints: [],
    breakerPositions: [],
    panelExits: [],
    qa: [],
  });
}

const load = (over: RawRow): RawRow => ({
  id: "11111111-1111-1111-1111-111111111111",
  area: "Farm Shop",
  description: "Load",
  updated_at: "2026-08-01T00:00:00.000Z",
  ...over,
});

function sheet(
  rows: { stableId: string; values: Record<string, string>; sourceRow?: number }[],
): OdsSheetRows {
  return { sheet: "Loads", kind: "load", rows, unmapped: [] };
}

function review(
  odsRows: { stableId: string; values: Record<string, string>; sourceRow?: number }[],
  loads: RawRow[],
) {
  const report = runParallelComparison({
    odsFileName: "PremoFarmElectrical.ods",
    odsSha256: "b".repeat(64),
    comparedAt: "2026-08-30T01:00:00.000Z",
    sheets: [sheet(odsRows)],
    snapshot: snapshot(loads),
  });
  return loadVoltageCurrentReview(report, numericDiagnostics(report));
}

describe("Phase 4.4b load voltage/current semantics — reference model", () => {
  it("separates nominal supply voltage from equipment nameplate voltage", () => {
    expect(nominalNameplatePair(240, 220)).toMatchObject({
      nominal: 240,
      nameplate: 220,
      nominal_side: "ods",
    });
    expect(nominalNameplatePair(115, 120)).toMatchObject({ nominal: 120, nameplate: 115 });
    // two nominal systems disagreeing is engineering, not representation
    expect(nominalNameplatePair(120, 240)).toBeNull();
    expect(nominalNameplatePair(240, 208)).toBeNull();
    expect(nominalNameplatePair(240, 240)).toBeNull();
  });

  it("recognises standard OCP ratings only", () => {
    expect(isStandardOcpRating(60)).toBe(true);
    expect(isStandardOcpRating(30)).toBe(true);
    expect(isStandardOcpRating(24)).toBe(false);
    expect(isStandardOcpRating(null)).toBe(false);
  });

  it("proves a VA basis from voltage x current", () => {
    expect(vaBasisFor(7200, 240, 30)).toBe("calculated_from_nominal_supply");
    expect(vaBasisFor(6600, 220, 30)).toBe("calculated_from_nominal_supply");
    expect(vaBasisFor(6600, 240, 30)).toBeNull();
    expect(vaBasisFor(null, 240, 30)).toBeNull();
  });
});

describe("Phase 4.4b load semantic reclassification", () => {
  it("reclassifies 240 V vs 220 V with identical current as nominal-vs-nameplate, VA included", () => {
    const r = review(
      [
        {
          stableId: "FS-034",
          sourceRow: 12,
          values: { volts: "240", amps: "30", connected_va: "7200" },
        },
      ],
      [load({ load_id: "FS-034", volts: 220, amps: 30, connected_va: 6600 })],
    );
    const volts = r.findings.find((f) => f.field === "volts")!;
    expect(volts.original_category).toBe("B");
    expect(volts.bucket).toBe("nominal_vs_nameplate_representation");
    expect(volts.proposed_category).toBe("E");
    expect(volts.basis_proven).toBe(true);
    expect(volts.ods_basis).toBe("nominal_supply");
    expect(volts.farmops_basis).toBe("equipment_rated_nameplate");

    const va = r.findings.find((f) => f.field === "connected_va")!;
    expect(va.bucket).toBe("nominal_vs_nameplate_representation");
    expect(va.ods_basis).toBe("calculated_from_nominal_supply");
    expect(va.farmops_basis).toBe("calculated_from_nameplate");
    expect(va.proof.join(" ")).toMatch(/240 × 30 = 7200/);
  });

  it("flags a standard OCP rating against equipment current as a semantic mismatch, not a wrong number", () => {
    const r = review(
      [{ stableId: "FS-050", sourceRow: 20, values: { amps: "60" } }],
      [load({ load_id: "FS-050", amps: 25 })],
    );
    const amps = r.findings.find((f) => f.field === "amps")!;
    expect(amps.bucket).toBe("current_ocp_semantic_mismatch");
    expect(amps.proposed_category).toBe("E");
    expect(amps.basis_proven).toBe(false);
    expect(amps.disposition).toMatch(/separate fields/i);
  });

  it("keeps 0 A vs a stated current as insufficient provenance and never normalizes it", () => {
    const r = review(
      [{ stableId: "FS-082", sourceRow: 31, values: { amps: "0" } }],
      [load({ load_id: "FS-082", amps: 24 })],
    );
    const amps = r.findings.find((f) => f.field === "amps")!;
    expect(amps.bucket).toBe("insufficient_provenance");
    expect(amps.proposed_category).toBe("D");
    expect(amps.disposition).toMatch(/no writes/i);
  });

  it("keeps two nominal systems as a true engineering disagreement", () => {
    const r = review(
      [{ stableId: "FS-090", sourceRow: 40, values: { volts: "120" } }],
      [load({ load_id: "FS-090", volts: 240 })],
    );
    const volts = r.findings.find((f) => f.field === "volts")!;
    expect(volts.bucket).toBe("true_engineering_disagreement");
    expect(volts.proposed_category).toBe("B");
    expect(r.loads[0]!.targeted_review).toBe(true);
  });

  it("holds VA back when the current also differs, so the basis cannot be isolated", () => {
    const r = review(
      [{ stableId: "FS-092", sourceRow: 45, values: { volts: "240", amps: "30", connected_va: "7200" } }],
      [load({ load_id: "FS-092", volts: 220, amps: 25, connected_va: 5500 })],
    );
    const va = r.findings.find((f) => f.field === "connected_va")!;
    expect(va.bucket).toBe("insufficient_provenance");
    expect(va.basis_proven).toBe(false);
    expect(va.proof.join(" ")).toMatch(/Current also differs/);
  });

  it("is read-only: no apply path and every finding carries provenance and evidence", () => {
    const r = review(
      [{ stableId: "FS-034", sourceRow: 12, values: { volts: "240", amps: "30", connected_va: "7200" } }],
      [load({ load_id: "FS-034", volts: 220, amps: 30, connected_va: 6600 })],
    );
    expect(r.read_only).toBe(true);
    expect(r.apply_available).toBe(false);
    for (const f of r.findings) {
      expect(f.proof.length).toBeGreaterThan(0);
      expect(f.provenance.length).toBeGreaterThan(10);
      expect(f).not.toHaveProperty("proposed_value");
    }
    expect(loadSemanticsCsv(r).split("\n")[0]).toMatch(/^stable_id,field,unit/);
    expect(loadSemanticsMarkdown(r)).toMatch(/no apply path/i);
    // provenance drill-down is present for the load
    const detail = r.loads[0]!;
    expect(detail.stable_id).toBe("FS-034");
    expect(detail.values.some((v) => v.field === "volts" && v.ods_row === 12)).toBe(true);
  });
});
