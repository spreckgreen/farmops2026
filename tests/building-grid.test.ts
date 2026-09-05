import { describe, expect, it } from "vitest";
import {
  compassPoint,
  defineBuildingGrid,
  gridCorners,
  templateOutline,
} from "@/lib/building-grid";
import { importDrawing, parseCornerList, parseSvgOutlines } from "@/lib/building-drawing-import";

describe("templateOutline", () => {
  it("makes a rectangle from length and width", () => {
    const outline = templateOutline("RECTANGLE", { lengthFt: 60, widthFt: 40 });
    expect(outline).toHaveLength(4);
    expect(Math.max(...outline.map((p) => p.x))).toBe(60);
    expect(Math.max(...outline.map((p) => p.y))).toBe(40);
  });

  it("cuts a corner out for an L shape", () => {
    const outline = templateOutline("L_SHAPE", {
      lengthFt: 60,
      widthFt: 40,
      notchLengthFt: 20,
      notchWidthFt: 10,
    });
    expect(outline.length).toBeGreaterThan(4);
  });

  it("returns nothing without both dimensions", () => {
    expect(templateOutline("RECTANGLE", { lengthFt: 0, widthFt: 40 })).toEqual([]);
  });
});

describe("defineBuildingGrid", () => {
  it("derives a 40x60 grid at 8 ft cells with a clockwise walk", () => {
    const result = defineBuildingGrid({
      buildingName: "Pump House",
      definitionMethod: "ENTERED_DIMENSIONS",
      shapeTemplate: "RECTANGLE",
      outlineFt: templateOutline("RECTANGLE", { lengthFt: 60, widthFt: 40 }),
      heightFt: 10,
      cellFt: 8,
      lengthAxisBearing: 90,
      walkPattern: "CLOCKWISE",
      walkStartCell: null,
    });
    expect(result).not.toBeNull();
    expect(result!.footprintSqFt).toBeCloseTo(2400, 3);
    expect(result!.grid.cellFt).toBe(8);
    expect(result!.grid.rows * result!.grid.columns).toBeGreaterThan(0);
    expect(result!.walk.cells.length).toBeGreaterThan(3);
    expect(result!.gaps).not.toContain("Wall height not recorded.");
  });

  it("reports a missing height and uneven cells as gaps, not guesses", () => {
    const result = defineBuildingGrid({
      buildingName: "Boiler",
      definitionMethod: "ENTERED_DIMENSIONS",
      outlineFt: templateOutline("RECTANGLE", { lengthFt: 31, widthFt: 21 }),
      cellFt: 8,
      lengthAxisBearing: 0,
    });
    expect(result!.gaps.some((g) => g.includes("part cell"))).toBe(true);
    expect(result!.gaps).toContain("Wall height not recorded.");
  });

  it("returns null for an unusable outline", () => {
    expect(
      defineBuildingGrid({
        buildingName: "",
        definitionMethod: "ENTERED_DIMENSIONS",
        outlineFt: [],
      }),
    ).toBeNull();
  });

  it("offers four grid corners as walk starts", () => {
    const result = defineBuildingGrid({
      buildingName: "Shop",
      definitionMethod: "ENTERED_DIMENSIONS",
      outlineFt: templateOutline("RECTANGLE", { lengthFt: 48, widthFt: 32 }),
      cellFt: 8,
    })!;
    expect(gridCorners(result.grid)).toHaveLength(4);
  });
});

describe("compassPoint", () => {
  it("names the bearing", () => {
    expect(compassPoint(0)).toBe("N");
    expect(compassPoint(90)).toBe("E");
  });
});

describe("drawing import", () => {
  it("reads a CSV corner list in feet", () => {
    const result = parseCornerList("0,0\n60,0\n60,40\n0,40");
    expect(result.outlines[0]!.lengthFt).toBe(60);
    expect(result.outlines[0]!.widthFt).toBe(40);
  });

  it("scales SVG geometry with the supplied feet per unit", () => {
    const svg = '<svg><rect x="0" y="0" width="30" height="20"/></svg>';
    const result = parseSvgOutlines(svg, 2);
    expect(result.outlines[0]!.lengthFt).toBe(60);
    expect(result.outlines[0]!.widthFt).toBe(40);
  });

  it("says a PDF must be traced by hand instead of inventing sizes", () => {
    const result = importDrawing("plan.pdf", "", {});
    expect(result.needsManualTrace).toBe(true);
    expect(result.outlines).toHaveLength(0);
  });
});
