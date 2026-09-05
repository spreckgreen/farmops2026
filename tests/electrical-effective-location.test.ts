// Regression tests for the ONE shared effective-location resolver.
import { describe, expect, it } from "vitest";
import {
  EFFECTIVE_LOCATION_PRIORITY,
  classifyPerimeter,
  effectiveLocationAfterObservation,
  effectiveLocationForRecord,
  resolveEffectiveLocation,
  type LocationStatement,
} from "@/lib/electrical-effective-location";
import { buildOperationalAssets, type OperationalInput } from "@/lib/electrical-grid-operational";
import { PROPOSED_POST_POSITIONS } from "@/lib/electrical-grid-post-geometry";

const POST = PROPOSED_POST_POSITIONS[13]!;

const perimeterRecord = {
  stableId: "FS-900",
  topologyPlacement: "PERIMETER",
  poleScheme: "fs-post-geometry-v1-confirmed",
  poleLocationKind: "AT_POST",
  poleRefStart: POST.ref,
  poleEvidence: "field verified",
  fieldGridReference: "A8",
  remappedGridReference: "E4",
  originalGrid: "C7",
};

describe("effective-location precedence", () => {
  it("keeps the documented priority order", () => {
    expect(EFFECTIVE_LOCATION_PRIORITY).toEqual([
      "FIELD_OBSERVED_POLE_ALIGNMENT",
      "FIELD_OBSERVED_GRID",
      "GRID_REMAPPED",
      "ORIGINAL_GRID",
    ]);
  });

  it("lets observed perimeter pole alignment beat every grid source", () => {
    const r = effectiveLocationForRecord(perimeterRecord);
    expect(r.effective?.source).toBe("FIELD_OBSERVED_POLE_ALIGNMENT");
    expect(r.provenance).toBe(`Post ${POST.ref} · observed pole alignment · field verified`);
    // Nothing lower is discarded.
    expect(r.statements.map((s) => s.source)).toEqual([
      "FIELD_OBSERVED_POLE_ALIGNMENT",
      "FIELD_OBSERVED_GRID",
      "GRID_REMAPPED",
      "ORIGINAL_GRID",
    ]);
    expect(r.statements.find((s) => s.source === "ORIGINAL_GRID")?.raw).toBe("C7");
  });

  it("lets observed A1–F9 beat remapped and original grid", () => {
    const r = effectiveLocationForRecord({ ...perimeterRecord, poleLocationKind: "NOT_APPLICABLE" });
    expect(r.effective?.source).toBe("FIELD_OBSERVED_GRID");
    expect(r.provenance).toBe("A8 · observed A1–F9 grid · field verified");
  });

  it("lets remapped A1–F9 beat the original grid", () => {
    const r = effectiveLocationForRecord({
      ...perimeterRecord,
      poleLocationKind: "NOT_APPLICABLE",
      fieldGridReference: null,
    });
    expect(r.effective?.source).toBe("GRID_REMAPPED");
    expect(r.provenance).toBe("E4 · remapped A1–F9 grid · derived");
  });

  it("falls back to the original grid", () => {
    const r = effectiveLocationForRecord({
      stableId: "FS-901",
      originalGrid: "C7",
    });
    expect(r.provenance).toBe("Old grid C7 · original grid · fallback");
  });

  it("makes pole alignment ineligible for a non-perimeter object", () => {
    const r = effectiveLocationForRecord({
      stableId: "FS-902",
      topologyPlacement: "INTERIOR",
      poleLocationKind: "AT_POST",
      poleRefStart: POST.ref,
      fieldGridReference: "A8",
    });
    expect(r.perimeter.onPerimeter).toBe(false);
    expect(r.effective?.source).toBe("FIELD_OBSERVED_GRID");
    expect(r.warnings.some((w) => w.code === "POLE_ALIGNMENT_NOT_ELIGIBLE")).toBe(true);
    // The pole statement is preserved even though it cannot win.
    expect(r.statements.find((s) => s.source === "FIELD_OBSERVED_POLE_ALIGNMENT")?.raw).toBe(
      POST.ref,
    );
  });

  it("never infers perimeter membership from a description", () => {
    expect(
      classifyPerimeter({ topologyPlacement: null, wallClassification: null }).onPerimeter,
    ).toBe(false);
    expect(classifyPerimeter({ wallClassification: "east wall" }).onPerimeter).toBe(true);
  });

  it("falls through an invalid higher-priority source with a warning", () => {
    const incomplete = effectiveLocationForRecord({
      ...perimeterRecord,
      poleRefStart: POST.ref,
      poleRefEnd: null,
      poleLocationKind: "BETWEEN_POSTS",
    });
    expect(incomplete.effective?.source).toBe("FIELD_OBSERVED_GRID");
    expect(incomplete.warnings.some((w) => w.code === "INCOMPLETE_POLE_REFERENCE")).toBe(true);

    const badGrid = effectiveLocationForRecord({
      stableId: "FS-903",
      fieldGridReference: "Z12",
      remappedGridReference: "E4",
    });
    expect(badGrid.effective?.source).toBe("GRID_REMAPPED");
    expect(badGrid.warnings.some((w) => w.code === "INVALID_SOURCE_VALUE")).toBe(true);
    expect(badGrid.statements.find((s) => s.source === "FIELD_OBSERVED_GRID")?.raw).toBe("Z12");
  });

  it("requires adjudication when equal-priority accepted observations disagree", () => {
    const statements: LocationStatement[] = [
      { source: "FIELD_OBSERVED_GRID", id: "obs-1", value: "A8", observedAt: "2026-09-01" },
      { source: "FIELD_OBSERVED_GRID", id: "obs-2", value: "C3", observedAt: "2026-09-02" },
    ];
    const r = resolveEffectiveLocation({ statements });
    expect(r.requiresAdjudication).toBe(true);
    expect(r.effective).toBeNull();
    expect(r.conflict?.statements.map((s) => s.label)).toEqual(["A8", "C3"]);
    expect(r.statements).toHaveLength(2);

    const resolved = resolveEffectiveLocation({
      statements: [statements[0]!, { ...statements[1]!, supersedes: ["obs-1"] }],
    });
    expect(resolved.requiresAdjudication).toBe(false);
    expect(resolved.effective?.label).toBe("C3");
  });

  it("recomputes automatically when a better observation is accepted, keeping prior evidence", () => {
    const record = { stableId: "FS-904", remappedGridReference: "E4", originalGrid: "C7" };
    const { before, after, changed } = effectiveLocationAfterObservation(record, {
      fieldGridReference: "A8",
      evidence: "audit item FA-FS-2026-09-03-PM-R2#12",
      observedAt: "2026-09-03",
    });
    expect(before.effective?.source).toBe("GRID_REMAPPED");
    expect(after.effective?.source).toBe("FIELD_OBSERVED_GRID");
    expect(changed).toBe(true);
    expect(after.statements.map((s) => s.raw)).toContain("E4");
    expect(after.statements.map((s) => s.raw)).toContain("C7");
  });
});

describe("shared resolver feeds the operational consumers", () => {
  const base: OperationalInput = {
    kind: "load",
    stableId: "FS-905",
    description: "Test load",
    grid: null,
    designGrid: null,
    legacyGrid: null,
    gridReference: "E4",
    storedPrecision: null,
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
    location: "Farm Shop",
    panel: null,
    panelBasis: null,
    circuitClass: null,
    circuitClassBasis: null,
  };

  it("exposes one derived provenance line on every asset", () => {
    const [asset] = buildOperationalAssets([base]);
    expect(asset!.locationProvenance).toBe("E4 · remapped A1–F9 grid · derived");
    expect(asset!.effectiveLocation.effective?.source).toBe("GRID_REMAPPED");
  });

  it("keeps stable IDs and relationships untouched when the effective location changes", () => {
    const [before] = buildOperationalAssets([base]);
    const [after] = buildOperationalAssets([{ ...base, fieldGridReference: "A8" }]);
    expect(after!.locationProvenance).toBe("A8 · observed A1–F9 grid · field verified");
    expect(after!.stableId).toBe(before!.stableId);
    expect(after!.panel).toBe(before!.panel);
    expect(after!.gridReference).toBe("E4");
  });
});
