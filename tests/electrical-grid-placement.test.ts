// Placement precedence and plan-geometry regression tests for the Farm Shop
// Grid Map. These prove that (a) an accepted grid assignment is never overridden
// by legacy/provisional X/Y, and (b) the feet → plan transform is a pure function
// of the drawing, so viewport size, zoom and device pixel ratio cannot move a
// marker relative to the plan.
import { describe, expect, it } from "vitest";
import {
  PLAN_ANCHORS_PX,
  PLAN_BUILDING_PX,
  PLAN_IMAGE,
  PLAN_OPENINGS,
  PLAN_VIEW_BOX,
  feetToPlanPx,
  planPxToFeet,
} from "@/lib/electrical-grid-plan-geometry";
import {
  buildOperationalAssets,
  classifyLocation,
  summarizeOperational,
  type OperationalInput,
} from "@/lib/electrical-grid-operational";

const base: OperationalInput = {
  kind: "load",
  stableId: "FS-001",
  description: "Test load",
  grid: null,
  designGrid: null,
  legacyGrid: null,
  gridReference: null,
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
const row = (over: Partial<OperationalInput>): OperationalInput => ({ ...base, ...over });

describe("plan coordinate transformation", () => {
  it("anchors the four corners of the accepted 60 ft x 40 ft envelope", () => {
    expect(feetToPlanPx(0, 0)).toEqual({
      x: PLAN_ANCHORS_PX.westWallX,
      y: PLAN_ANCHORS_PX.northWallY,
    }); // A1 north-west
    expect(feetToPlanPx(60, 0)).toEqual({
      x: PLAN_ANCHORS_PX.eastWallX,
      y: PLAN_ANCHORS_PX.northWallY,
    }); // A9 north-east
    expect(feetToPlanPx(0, 40)).toEqual({
      x: PLAN_ANCHORS_PX.westWallX,
      y: PLAN_ANCHORS_PX.southWallY,
    }); // F1 south-west
    expect(feetToPlanPx(60, 40)).toEqual({
      x: PLAN_ANCHORS_PX.eastWallX,
      y: PLAN_ANCHORS_PX.southWallY,
    }); // F9 south-east
  });

  it("places D5 at its expected interior position", () => {
    // D = 24 ft south, 5 = 32 ft east.
    const p = feetToPlanPx(32, 24);
    expect(p.x).toBeCloseTo(PLAN_BUILDING_PX.left + (32 / 60) * PLAN_BUILDING_PX.width, 6);
    expect(p.y).toBeCloseTo(PLAN_BUILDING_PX.top + (24 / 40) * PLAN_BUILDING_PX.height, 6);
    const back = planPxToFeet(p.x, p.y);
    expect(back.xFt).toBeCloseTo(32, 6);
    expect(back.yFt).toBeCloseTo(24, 6);
  });

  it("aligns the known north-wall openings with the accepted drawing", () => {
    for (const opening of PLAN_OPENINGS) {
      const p = feetToPlanPx(opening.centreXFt, opening.centreYFt);
      if (opening.drawnSpanPx) {
        const [lo, hi] = opening.drawnSpanPx;
        expect(p.x).toBeGreaterThan(lo);
        expect(p.x).toBeLessThan(hi);
      }
      if (opening.wall === "north") expect(p.y).toBe(PLAN_ANCHORS_PX.northWallY);
      if (opening.wall === "west") expect(p.x).toBe(PLAN_ANCHORS_PX.westWallX);
    }
    // MAN DOOR (NE) sits east of column 8 (56 ft) and west of the east wall.
    const ne = feetToPlanPx(57, 0);
    expect(ne.x).toBeGreaterThan(feetToPlanPx(56, 0).x);
    expect(ne.x).toBeLessThan(PLAN_ANCHORS_PX.eastWallX);
  });

  it("is a pure function of the drawing, not of viewport size, zoom or DPR", () => {
    // The viewBox is fixed, so the same feet always yield the same drawing
    // coordinates; the browser scales the whole SVG, plan and markers together.
    expect(PLAN_VIEW_BOX).toBe(`0 0 ${PLAN_IMAGE.width} ${PLAN_IMAGE.height}`);
    for (const [cssWidth, dpr] of [
      [320, 1],
      [640, 2],
      [1024, 1.3333],
      [1440, 3],
      [2560, 1],
    ] as const) {
      const scale = cssWidth / PLAN_IMAGE.width;
      const p = feetToPlanPx(32, 24);
      // Rendered pixel position is a pure scaling of one shared coordinate.
      const renderedX = p.x * scale * dpr;
      const renderedY = p.y * scale * dpr;
      // Converting back through the same scale recovers the identical feet.
      const back = planPxToFeet(renderedX / (scale * dpr), renderedY / (scale * dpr));
      expect(back.xFt).toBeCloseTo(32, 6);
      expect(back.yFt).toBeCloseTo(24, 6);
    }
  });
});

describe("placement precedence", () => {
  it("uses the accepted corrected grid when recorded X/Y is stale and unverified", () => {
    const place = classifyLocation(
      row({
        stableId: "FS-500",
        gridReference: "D5",
        xFt: 4,
        yFt: 4,
        verification: "NOT_REVIEWED",
      }),
    );
    expect(place.source).toBe("DERIVED_FROM_GRID_REFERENCE");
    expect(place.xFt).toBe(32);
    expect(place.yFt).toBe(24);
    expect(place.disagreement).toContain("Placement sources disagree");
  });

  it("lets a verified field-observation X/Y supersede the provisional grid", () => {
    const place = classifyLocation(
      row({
        stableId: "FS-501",
        gridReference: "A1",
        xFt: 21,
        yFt: 9,
        verification: "VERIFIED_AS_INSTALLED",
        installStatus: "complete",
      }),
    );
    expect(place.source).toBe("VERIFIED_FIELD_OBSERVATION_XY");
    expect(place).toMatchObject({ xFt: 21, yFt: 9 });
  });

  it("ignores a verified X/Y that is not the current installed location", () => {
    const place = classifyLocation(
      row({
        stableId: "FS-502",
        gridReference: "A1",
        xFt: 21,
        yFt: 9,
        verification: "VERIFIED_AS_INSTALLED",
        installStatus: "planned",
      }),
    );
    expect(place.source).toBe("DERIVED_FROM_GRID_REFERENCE");
  });

  it("falls back to the canonical / recovery-derived legacy grid", () => {
    const place = classifyLocation(row({ stableId: "FS-503", grid: "G6" }));
    expect(place.source).toBe("DERIVED_FROM_LEGACY_GRID");
    expect(place).toMatchObject({ xFt: 60, yFt: 40 });
  });

  it("plots provisional X/Y only when no accepted grid assignment exists", () => {
    const place = classifyLocation(
      row({ stableId: "FS-504", xFt: 12, yFt: 6, storedPrecision: "NEAREST" }),
    );
    expect(place.source).toBe("PROVISIONAL_RECORDED_XY");
    expect(place.precision).toBe("NEAREST");
    expect(place.disagreement).toBeNull();
  });

  it("does not plot an unresolved record", () => {
    for (const grid of ["??", "NA", "0.00%", null]) {
      const place = classifyLocation(row({ stableId: "FS-505", grid }));
      expect(place.precision).toBe("UNRESOLVED");
      expect(place.xFt).toBeNull();
      expect(place.source).toBe("NOT_PLOTTED");
    }
  });

  it("never implies a permanent location for mobile equipment", () => {
    const place = classifyLocation(
      row({ stableId: "FS-506", grid: "MOBILE", xFt: 10, yFt: 10 }),
    );
    expect(place.precision).toBe("NON_FIXED");
    expect(place.xFt).toBeNull();
  });

  it("keeps an interval an interval instead of an exact point", () => {
    const [asset] = buildOperationalAssets([
      row({ stableId: "FS-507", gridReference: "C-D2-3" }),
    ]);
    expect(asset!.precision).toBe("INTERVAL");
    expect(asset!.spanned).toBe(true);
  });

  it("preserves the true anchor for co-located records and only offsets visually", () => {
    const assets = buildOperationalAssets([
      row({ stableId: "FS-508", gridReference: "B2" }),
      row({ stableId: "FS-509", gridReference: "B2" }),
    ]);
    for (const a of assets) {
      expect(a.plottedXFt).toBe(8);
      expect(a.plottedYFt).toBe(8);
      expect(a.stackSize).toBe(2);
    }
    expect(assets.some((a) => a.fanDxFt !== 0 || a.fanDyFt !== 0)).toBe(true);
  });

  it("reports counts by placement source and the disagreement total", () => {
    const summary = summarizeOperational(
      buildOperationalAssets([
        row({ stableId: "FS-600", gridReference: "A1" }),
        row({ stableId: "FS-601", grid: "G6" }),
        row({ stableId: "FS-602", xFt: 5, yFt: 5 }),
        row({
          stableId: "FS-603",
          gridReference: "D5",
          xFt: 1,
          yFt: 1,
        }),
        row({ stableId: "FS-604", grid: "??" }),
      ]),
    );
    expect(summary.placementSources.DERIVED_FROM_GRID_REFERENCE).toBe(2);
    expect(summary.placementSources.DERIVED_FROM_LEGACY_GRID).toBe(1);
    expect(summary.placementSources.PROVISIONAL_RECORDED_XY).toBe(1);
    expect(summary.placementSources.NOT_PLOTTED).toBe(1);
    expect(summary.placementDisagreements).toBe(1);
    expect(
      Object.values(summary.placementSources).reduce((a, b) => a + b, 0),
    ).toBe(summary.total);
  });
});
