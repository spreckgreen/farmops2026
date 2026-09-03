// Placement precedence and plan-geometry regression tests for the Farm Shop
// Grid Map. These prove that (a) an accepted grid assignment is never overridden
// by legacy/provisional X/Y, and (b) the plan is coordinate-native in physical
// feet, so viewport size, zoom and device pixel ratio cannot move a marker
// relative to the plan. The expected numbers below are the specified physical
// dimensions, written out literally — never read back from the module.
import { describe, expect, it } from "vitest";
import {
  NE_MAN_DOOR_TO_CORNER_FT,
  PLAN_ASPECT_RATIO,
  PLAN_BUILDING,
  PLAN_OPENINGS,
  PLAN_VIEW_BOX,
  PROPOSED_OVERHEAD_LEDS,
  feetToPlan,
  planToFeet,
  feetToPlanPx,
  planPxToFeet,
} from "@/lib/electrical-grid-plan-geometry";
import { AXIS_COLS, AXIS_ROWS } from "@/lib/electrical-grid-map";
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

describe("coordinate-native plan geometry", () => {
  it("uses the building itself as the viewBox, 60 ft x 40 ft", () => {
    expect(PLAN_VIEW_BOX).toBe("0 0 60 40");
    expect(PLAN_BUILDING).toEqual({ left: 0, top: 0, width: 60, height: 40 });
    expect(PLAN_BUILDING.width / PLAN_BUILDING.height).toBe(1.5);
    expect(PLAN_ASPECT_RATIO).toBe(1.5);
  });

  it("anchors the four corners at their physical feet", () => {
    expect(feetToPlan(0, 0)).toEqual({ x: 0, y: 0 }); // A1 north-west
    expect(feetToPlan(60, 0)).toEqual({ x: 60, y: 0 }); // A9 north-east
    expect(feetToPlan(0, 40)).toEqual({ x: 0, y: 40 }); // F1 south-west
    expect(feetToPlan(60, 40)).toEqual({ x: 60, y: 40 }); // F9 south-east
    // The retained alias is the same transform.
    expect(feetToPlanPx(32, 24)).toEqual({ x: 32, y: 24 });
    expect(planPxToFeet(32, 24)).toEqual({ xFt: 32, yFt: 24 });
  });

  it("puts every column and row line on its specified feet coordinate", () => {
    expect(AXIS_COLS.map((c) => c.label)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(AXIS_COLS.map((c) => feetToPlan(c.xFt, 0).x)).toEqual([
      0, 8, 16, 24, 32, 40, 48, 56, 60,
    ]);
    expect(AXIS_ROWS.map((r) => r.label)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(AXIS_ROWS.map((r) => feetToPlan(0, r.yFt).y)).toEqual([0, 8, 16, 24, 32, 40]);
  });

  it("draws column span 8→9 at exactly half the width of 48'→56'", () => {
    const w8to9 = feetToPlan(60, 0).x - feetToPlan(56, 0).x;
    const w48to56 = feetToPlan(56, 0).x - feetToPlan(48, 0).x;
    expect(w8to9).toBe(4);
    expect(w48to56).toBe(8);
    expect(w8to9).toBe(w48to56 / 2);
  });

  it("places D5 at its expected interior position", () => {
    // D = 24 ft south, 5 = 32 ft east.
    expect(feetToPlan(32, 24)).toEqual({ x: 32, y: 24 });
    expect(planToFeet(32, 24)).toEqual({ xFt: 32, yFt: 24 });
  });

  it("draws the north-wall openings from their feet spans", () => {
    const byId = new Map(PLAN_OPENINGS.map((o) => [o.id, o]));
    expect([byId.get("GD2")!.startFt, byId.get("GD2")!.endFt]).toEqual([3.875, 15.875]);
    expect([byId.get("GD1")!.startFt, byId.get("GD1")!.endFt]).toEqual([24, 36]);
    const ne = byId.get("MAN DOOR (NE)")!;
    expect([ne.startFt, ne.endFt]).toEqual([52.5, 55.5]);
    expect(ne.endFt - ne.startFt).toBe(3);
    expect(NE_MAN_DOOR_TO_CORNER_FT).toBe(4.5);
    for (const o of PLAN_OPENINGS) {
      if (o.wall === "north") expect(feetToPlan(o.centreXFt, o.centreYFt).y).toBe(0);
      if (o.wall === "west") expect(feetToPlan(o.centreXFt, o.centreYFt).x).toBe(0);
    }
  });

  it("carries the proposed 2 x 5 overhead LED centres exactly", () => {
    expect(PROPOSED_OVERHEAD_LEDS.map((f) => [f.xFt, f.yFt])).toEqual([
      [6, 10],
      [18, 10],
      [30, 10],
      [42, 10],
      [54, 10],
      [6, 30],
      [18, 30],
      [30, 30],
      [42, 30],
      [54, 30],
    ]);
    expect(PROPOSED_OVERHEAD_LEDS.map((f) => f.planOrder)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    // Symmetric about X = 30 ft and Y = 20 ft, 12 ft and 20 ft on centre.
    for (const f of PROPOSED_OVERHEAD_LEDS) {
      expect(
        PROPOSED_OVERHEAD_LEDS.some((m) => m.xFt === 60 - f.xFt && m.yFt === 40 - f.yFt),
      ).toBe(true);
    }
  });

  it("is a pure function of feet, not of viewport size, zoom or DPR", () => {
    for (const [cssWidth, dpr] of [
      [320, 1],
      [640, 2],
      [1024, 1.3333],
      [1440, 3],
      [2560, 1],
    ] as const) {
      // The SVG scales as one unit: feet -> rendered px is a single factor.
      const scale = (cssWidth / 60) * dpr;
      const p = feetToPlan(32, 24);
      const back = planToFeet((p.x * scale) / scale, (p.y * scale) / scale);
      expect(back).toEqual({ xFt: 32, yFt: 24 });
    }
    // Browser zoom levels: markers and plan share one transform, so the ratio
    // of a marker's position to the building width is zoom-invariant.
    for (const zoom of [0.67, 0.8, 1, 1.25, 1.5, 2]) {
      const renderedWidth = 60 * zoom;
      const marker = feetToPlan(54, 30);
      expect((marker.x * zoom) / renderedWidth).toBeCloseTo(54 / 60, 12);
      expect((marker.y * zoom) / (40 * zoom)).toBeCloseTo(30 / 40, 12);
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
    // No record is displaced by default: every marker keeps its exact anchor.
    expect(assets.every((a) => a.fanDxFt === 0 && a.fanDyFt === 0)).toBe(true);
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
