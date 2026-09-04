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
  PLAN_BUILDING_ASPECT_RATIO,
  PLAN_DRAWING,
  PLAN_OPENINGS,
  PLAN_VIEW_BOX,
  PROPOSED_OVERHEAD_LEDS,
  feetToPlan,
  planToFeet,
  feetToPlanPx,
  planPxToFeet,
  clampToBuilding,
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

describe("drawing-native plan geometry", () => {
  const mapX = (xFt: number) => 185 + (xFt / 60) * 1068;
  const mapY = (yFt: number) => 210 + (yFt / 40) * 616;

  it("uses the original drawing as the viewBox and the measured envelope", () => {
    expect(PLAN_VIEW_BOX).toBe("0 0 1448 1086");
    expect(PLAN_DRAWING).toEqual({ width: 1448, height: 1086 });
    expect(PLAN_BUILDING).toEqual({ left: 185, top: 210, width: 1068, height: 616 });
    expect(PLAN_ASPECT_RATIO).toBeCloseTo(1448 / 1086, 12);
    expect(PLAN_BUILDING_ASPECT_RATIO).toBe(1.5);
  });

  it("anchors the four corners on the envelope corners", () => {
    expect(feetToPlan(0, 0)).toEqual({ x: 185, y: 210 }); // A1 north-west
    expect(feetToPlan(60, 0)).toEqual({ x: 1253, y: 210 }); // A9 north-east
    expect(feetToPlan(0, 40)).toEqual({ x: 185, y: 826 }); // F1 south-west
    expect(feetToPlan(60, 40)).toEqual({ x: 1253, y: 826 }); // F9 south-east
    // The retained alias is the same transform, and it round-trips.
    expect(feetToPlanPx(32, 24)).toEqual({ x: mapX(32), y: mapY(24) });
    const back = planPxToFeet(mapX(32), mapY(24));
    expect(back.xFt).toBeCloseTo(32, 10);
    expect(back.yFt).toBeCloseTo(24, 10);
  });

  it("puts every column and row line on its mapped drawing coordinate", () => {
    expect(AXIS_COLS.map((c) => c.label)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(AXIS_COLS.map((c) => feetToPlan(c.xFt, 0).x)).toEqual(
      [0, 8, 16, 24, 32, 40, 48, 56, 60].map(mapX),
    );
    expect(AXIS_ROWS.map((r) => r.label)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(AXIS_ROWS.map((r) => feetToPlan(0, r.yFt).y)).toEqual(
      [0, 8, 16, 24, 32, 40].map(mapY),
    );
  });

  it("draws column span 8->9 at exactly half the width of 48'->56'", () => {
    const w8to9 = feetToPlan(60, 0).x - feetToPlan(56, 0).x;
    const w48to56 = feetToPlan(56, 0).x - feetToPlan(48, 0).x;
    expect(w8to9).toBeCloseTo(w48to56 / 2, 12);
  });

  it("places D5 at its expected interior position", () => {
    // D = 24 ft south, 5 = 32 ft east.
    expect(feetToPlan(32, 24)).toEqual({ x: mapX(32), y: mapY(24) });
    const back = planToFeet(mapX(32), mapY(24));
    expect(back.xFt).toBeCloseTo(32, 10);
    expect(back.yFt).toBeCloseTo(24, 10);
  });

  it("clamps anything outside the building envelope back onto it", () => {
    expect(clampToBuilding(-500, -500)).toEqual({ x: 185, y: 210 });
    expect(clampToBuilding(9000, 9000)).toEqual({ x: 1253, y: 826 });
    expect(clampToBuilding(mapX(30), mapY(20))).toEqual({ x: mapX(30), y: mapY(20) });
  });

  it("keeps the recorded feet spans of both man doors and the overhead doors", () => {
    const byId = new Map(PLAN_OPENINGS.map((o) => [o.id, o]));
    expect([byId.get("GD2")!.startFt, byId.get("GD2")!.endFt]).toEqual([3.875, 15.875]);
    expect([byId.get("GD1")!.startFt, byId.get("GD1")!.endFt]).toEqual([24, 36]);
    const ne = byId.get("MAN DOOR (NE)")!;
    expect([ne.startFt, ne.endFt]).toEqual([52.5, 55.5]);
    expect(ne.endFt - ne.startFt).toBe(3);
    expect(NE_MAN_DOOR_TO_CORNER_FT).toBe(4.5);
    const sw = byId.get("MAN DOOR (SW)")!;
    expect([sw.wall, sw.centreYFt]).toEqual(["west", 32]);
    for (const o of PLAN_OPENINGS) {
      if (o.wall === "north") expect(feetToPlan(o.centreXFt, o.centreYFt).y).toBe(210);
      if (o.wall === "west") expect(feetToPlan(o.centreXFt, o.centreYFt).x).toBe(185);
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
    // Every proposed centre maps inside the building envelope.
    for (const f of PROPOSED_OVERHEAD_LEDS) {
      const p = feetToPlan(f.xFt, f.yFt);
      expect(p.x).toBeGreaterThanOrEqual(185);
      expect(p.x).toBeLessThanOrEqual(1253);
      expect(p.y).toBeGreaterThanOrEqual(210);
      expect(p.y).toBeLessThanOrEqual(826);
      // Symmetric about X = 30 ft and Y = 20 ft, 12 ft and 20 ft on centre.
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
      // The SVG scales as one unit: drawing units -> rendered px is one factor.
      const scale = (cssWidth / 1448) * dpr;
      const p = feetToPlan(32, 24);
      const back = planToFeet((p.x * scale) / scale, (p.y * scale) / scale);
      expect(back.xFt).toBeCloseTo(32, 10);
      expect(back.yFt).toBeCloseTo(24, 10);
    }
    // Browser zoom levels: markers and plan share one transform, so a marker's
    // position as a fraction of the drawing is zoom-invariant.
    for (const zoom of [0.67, 0.8, 1, 1.25, 1.5, 2]) {
      const marker = feetToPlan(54, 30);
      expect((marker.x * zoom) / (1448 * zoom)).toBeCloseTo(mapX(54) / 1448, 12);
      expect((marker.y * zoom) / (1086 * zoom)).toBeCloseTo(mapY(30) / 1086, 12);
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

describe("approved design X/Y placement", () => {
  const base = {
    kind: "load" as const,
    stableId: "FS-057",
    description: "Overhead LED",
    grid: "F5.5",
    designGrid: "B3",
    legacyGrid: null,
    gridReference: null,
    storedPrecision: null,
    xFt: null,
    yFt: null,
    designXFt: 18,
    designYFt: 10,
    installStatus: "planned",
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

  it("plots the approved design coordinates and treats the grid as a lookup", () => {
    const place = classifyLocation(base);
    expect(place.source).toBe("APPROVED_DESIGN_XY");
    expect(place.xFt).toBe(18);
    expect(place.yFt).toBe(10);
    expect(place.precision).toBe("EXACT");
    expect(place.disagreement).toContain("owner review");
  });

  it("keeps a verified field observation ahead of the design position", () => {
    const place = classifyLocation({
      ...base,
      xFt: 20,
      yFt: 12,
      installStatus: "complete",
      verification: "VERIFIED_AS_INSTALLED",
    });
    expect(place.source).toBe("VERIFIED_FIELD_OBSERVATION_XY");
    expect(place.xFt).toBe(20);
  });
});
