// Farm Shop plan geometry — the single documented feet → drawing transform.
//
// Every consumer (screen SVG, print SVG, PDF export) places the plan drawing and
// every marker in ONE coordinate system: the drawing's own pixel space, used as
// an SVG viewBox. Nothing is positioned from viewport size, page coordinates or
// separately measured elements, so a marker stays attached to the same physical
// location at any window size, device pixel ratio or browser zoom level.
//
// The anchors below are measured from the drawing itself (wall centrelines and
// the orange grid markers on the west wall), not guessed percentages:
//
//   west wall  (column 1, 0 ft)  x = 185 px
//   east wall  (column 9, 60 ft) x = 1253 px
//   north wall (row A, 0 ft)     y = 210 px
//   south wall (row F, 40 ft)    y = 826 px
//
// The drawing is not uniformly scaled (1068 px across 60 ft, 616 px across
// 40 ft), so X and Y carry their own scale. That is a property of the drawing
// and is why the transform must be applied per axis instead of assuming a
// square scale.
import { SHOP_DEPTH_FT, SHOP_WIDTH_FT } from "@/lib/electrical-grid-migration";

export const PLAN_GEOMETRY_VERSION = "farm-shop-plan-geometry-2";

/** Intrinsic pixel size of the bundled plan drawing. */
export const PLAN_IMAGE = { width: 1448, height: 1086 } as const;

/** Measured building envelope inside the drawing, in drawing pixels. */
export const PLAN_ANCHORS_PX = {
  westWallX: 185,
  eastWallX: 1253,
  northWallY: 210,
  southWallY: 826,
} as const;

export const PLAN_VIEW_BOX = `0 0 ${PLAN_IMAGE.width} ${PLAN_IMAGE.height}`;

const buildingLeft = PLAN_ANCHORS_PX.westWallX;
const buildingTop = PLAN_ANCHORS_PX.northWallY;
const buildingWidth = PLAN_ANCHORS_PX.eastWallX - PLAN_ANCHORS_PX.westWallX;
const buildingHeight = PLAN_ANCHORS_PX.southWallY - PLAN_ANCHORS_PX.northWallY;

export const PLAN_BUILDING_PX = {
  left: buildingLeft,
  top: buildingTop,
  width: buildingWidth,
  height: buildingHeight,
} as const;

/**
 * The one documented transformation. Origin is the north-west corner; X grows
 * east across 60 ft, Y grows south across 40 ft.
 *
 *   screenX = buildingLeft + (xFeet / 60) * buildingWidth
 *   screenY = buildingTop  + (yFeet / 40) * buildingHeight
 */
export function feetToPlanPx(xFt: number, yFt: number): { x: number; y: number } {
  return {
    x: buildingLeft + (xFt / SHOP_WIDTH_FT) * buildingWidth,
    y: buildingTop + (yFt / SHOP_DEPTH_FT) * buildingHeight,
  };
}

/** Inverse transform, used by tests and by any pointer-driven inspection. */
export function planPxToFeet(x: number, y: number): { xFt: number; yFt: number } {
  return {
    xFt: ((x - buildingLeft) / buildingWidth) * SHOP_WIDTH_FT,
    yFt: ((y - buildingTop) / buildingHeight) * SHOP_DEPTH_FT,
  };
}

/**
 * Building envelope as a fraction of the drawing (0–1). Only for raster targets
 * such as the PDF export, which draws the same image into a known rectangle and
 * therefore needs the same anchors expressed relative to the image.
 */
export const PLAN_BUILDING_FRACTION = {
  left: buildingLeft / PLAN_IMAGE.width,
  top: buildingTop / PLAN_IMAGE.height,
  width: buildingWidth / PLAN_IMAGE.width,
  height: buildingHeight / PLAN_IMAGE.height,
} as const;

/** Feet → fraction of the drawing, for the raster PDF path. */
export function feetToPlanFraction(xFt: number, yFt: number): { fx: number; fy: number } {
  const p = feetToPlanPx(xFt, yFt);
  return { fx: p.x / PLAN_IMAGE.width, fy: p.y / PLAN_IMAGE.height };
}

/**
 * Openings drawn on the accepted plan, with the drawn dimension strings that
 * define them. Used by the alignment regression tests.
 */
export const PLAN_OPENINGS: {
  id: string;
  wall: "north" | "west" | "south" | "east";
  centreXFt: number;
  centreYFt: number;
  /** Pixel span of the graphic on the drawing, where one is drawn to scale. */
  drawnSpanPx?: [number, number];
  evidence: string;
}[] = [
  {
    id: "GD2",
    wall: "north",
    centreXFt: 9.9,
    centreYFt: 0,
    drawnSpanPx: [300, 453],
    evidence: "GD2 12'x12' overhead door spans 3'-10 1/2\" to 15'-10 1/2\" on the north wall.",
  },
  {
    id: "GD1",
    wall: "north",
    centreXFt: 30.1,
    centreYFt: 0,
    drawnSpanPx: [619, 772],
    evidence: "GD1 12'x12' overhead door spans 24'-1 1/2\" to 36'-1 1/2\" on the north wall.",
  },
  {
    id: "MAN DOOR (NE)",
    wall: "north",
    centreXFt: 57,
    centreYFt: 0,
    evidence: "MAN DOOR (NE), 3'-0\" wide, spans 55'-6\" to 58'-6\" on the north wall.",
  },
  {
    id: "MAN DOOR (SW)",
    wall: "west",
    centreXFt: 0,
    centreYFt: 32,
    evidence: "MAN DOOR (SW) sits on the west wall about 32 ft south of the north wall.",
  },
];
