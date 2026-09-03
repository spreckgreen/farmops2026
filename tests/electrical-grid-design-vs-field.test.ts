import { describe, expect, it } from "vitest";
import {
  DESIGN_FIELD_TOLERANCE_FT,
  designFieldOverlay,
  designFieldPair,
} from "@/lib/electrical-grid-design-vs-field";
import type { OperationalAsset, PlacementCandidate } from "@/lib/electrical-grid-operational";

const candidate = (
  source: PlacementCandidate["source"],
  xFt: number,
  yFt: number,
): PlacementCandidate => ({
  source,
  xFt,
  yFt,
  precision: "EXACT",
  spanned: false,
  basis: "test",
  accepted: true,
});

const asset = (stableId: string, candidates: PlacementCandidate[]): OperationalAsset =>
  ({
    stableId,
    description: "Overhead LED",
    panel: "PNL-FS-SW",
    placementCandidates: candidates,
  }) as unknown as OperationalAsset;

describe("design vs field overlay", () => {
  it("reports a match inside tolerance", () => {
    const p = designFieldPair(
      asset("FS-056", [
        candidate("APPROVED_DESIGN_XY", 6, 10),
        candidate("VERIFIED_FIELD_OBSERVATION_XY", 6.3, 10),
      ]),
    );
    expect(p?.status).toBe("MATCH");
    expect(p?.deltaFt).toBeLessThanOrEqual(DESIGN_FIELD_TOLERANCE_FT);
  });

  it("reports a mismatch beyond tolerance with the separation in feet", () => {
    const p = designFieldPair(
      asset("FS-057", [
        candidate("APPROVED_DESIGN_XY", 18, 10),
        candidate("VERIFIED_FIELD_OBSERVATION_XY", 21, 14),
      ]),
    );
    expect(p?.status).toBe("MISMATCH");
    expect(p?.deltaFt).toBe(5);
    expect(p?.designXFt).toBe(18);
    expect(p?.fieldYFt).toBe(14);
  });

  it("keeps design-only and field-only records distinct and never invents the other side", () => {
    const designOnly = designFieldPair(
      asset("FS-058", [candidate("APPROVED_DESIGN_XY", 30, 10)]),
    );
    expect(designOnly?.status).toBe("DESIGN_ONLY");
    expect(designOnly?.fieldXFt).toBeNull();

    const fieldOnly = designFieldPair(
      asset("FS-101", [candidate("VERIFIED_FIELD_OBSERVATION_XY", 12, 22)]),
    );
    expect(fieldOnly?.status).toBe("FIELD_ONLY");
    expect(fieldOnly?.designYFt).toBeNull();
  });

  it("ignores grid-derived positions entirely", () => {
    expect(
      designFieldPair(asset("FS-999", [candidate("DERIVED_FROM_GRID_REFERENCE", 6, 10)])),
    ).toBeNull();
  });

  it("summarises counts and lists the biggest mismatch first", () => {
    const o = designFieldOverlay([
      asset("A", [
        candidate("APPROVED_DESIGN_XY", 0, 0),
        candidate("VERIFIED_FIELD_OBSERVATION_XY", 2, 0),
      ]),
      asset("B", [
        candidate("APPROVED_DESIGN_XY", 0, 0),
        candidate("VERIFIED_FIELD_OBSERVATION_XY", 9, 0),
      ]),
      asset("C", [candidate("APPROVED_DESIGN_XY", 5, 5)]),
      asset("D", [candidate("DERIVED_FROM_CURRENT_GRID", 5, 5)]),
    ]);
    expect(o.counts).toMatchObject({ MISMATCH: 2, DESIGN_ONLY: 1, MATCH: 0, FIELD_ONLY: 0 });
    expect(o.pairs.map((p) => p.stableId)).toEqual(["B", "A", "C"]);
    expect(o.mismatchIds).toEqual(["B", "A"]);
  });
});
