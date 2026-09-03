// Farm Shop plan geometry — coordinate-native, in physical feet.
//
// There is exactly one coordinate system: the building's own feet. The SVG
// viewBox IS the building area, `0 0 60 40`, so a drawing unit is one foot and
// every wall, gridline, opening, marker and proposed fixture is placed from its
// physical dimension. Nothing is calibrated against a raster drawing, no pixel
// anchors exist, and `preserveAspectRatio="none"` is never used — so browser
// zoom, window size and device pixel ratio cannot shift anything relative to
// anything else.
//
// Origin is the north-west corner (A1). X grows east across 60 ft, Y grows
// south across 40 ft. A9 = north-east, F1 = south-west, F9 = south-east.
import { SHOP_DEPTH_FT, SHOP_WIDTH_FT } from "@/lib/electrical-grid-migration";

export const PLAN_GEOMETRY_VERSION = "farm-shop-plan-geometry-3-coordinate-native";

/** The building envelope, in feet. This is also the SVG viewBox. */
export const PLAN_BUILDING = {
  left: 0,
  top: 0,
  width: SHOP_WIDTH_FT,
  height: SHOP_DEPTH_FT,
} as const;

/** Exactly 60:40 — the drawn aspect ratio equals the physical one. */
export const PLAN_ASPECT_RATIO = SHOP_WIDTH_FT / SHOP_DEPTH_FT;

export const PLAN_VIEW_BOX = `0 0 ${SHOP_WIDTH_FT} ${SHOP_DEPTH_FT}`;

/**
 * Feet → drawing units. The transform is the identity by construction:
 *
 *   drawX = xFeet, drawY = yFeet
 *
 * Consumers that render into an arbitrary rectangle (the PDF export) use
 * `feetToPlanFraction` and multiply by their own rectangle instead.
 */
export function feetToPlan(xFt: number, yFt: number): { x: number; y: number } {
  return { x: xFt, y: yFt };
}

/** Retained name used across the map, print and test code. */
export const feetToPlanPx = feetToPlan;

export function planToFeet(x: number, y: number): { xFt: number; yFt: number } {
  return { xFt: x, yFt: y };
}

export const planPxToFeet = planToFeet;

/** Feet → fraction of the building envelope (0–1), for foreign rectangles. */
export function feetToPlanFraction(xFt: number, yFt: number): { fx: number; fy: number } {
  return { fx: xFt / SHOP_WIDTH_FT, fy: yFt / SHOP_DEPTH_FT };
}

/** The building envelope as a fraction of itself — kept for raster consumers. */
export const PLAN_BUILDING_FRACTION = { left: 0, top: 0, width: 1, height: 1 } as const;

/* ------------------------------------------------------------ wall openings */

export interface PlanOpening {
  id: string;
  wall: "north" | "west" | "south" | "east";
  /** Physical span along the wall, in feet from the north-west corner. */
  startFt: number;
  endFt: number;
  centreXFt: number;
  centreYFt: number;
  kind: "overhead_door" | "man_door" | "window";
  evidence: string;
}

const northOpening = (
  id: string,
  startFt: number,
  endFt: number,
  kind: PlanOpening["kind"],
  evidence: string,
): PlanOpening => ({
  id,
  wall: "north",
  startFt,
  endFt,
  centreXFt: (startFt + endFt) / 2,
  centreYFt: 0,
  kind,
  evidence,
});

/** Openings drawn directly in feet from the corrected Farm Shop drawing. */
export const PLAN_OPENINGS: PlanOpening[] = [
  northOpening(
    "GD2",
    3.875,
    15.875,
    "overhead_door",
    "GD2 12' overhead door spans 3'-10 1/2\" to 15'-10 1/2\" on the north wall.",
  ),
  northOpening(
    "GD1",
    24,
    36,
    "overhead_door",
    "GD1 12' overhead door spans 24'-0\" to 36'-0\" on the north wall.",
  ),
  northOpening(
    "MAN DOOR (NE)",
    52.5,
    55.5,
    "man_door",
    "MAN DOOR (NE), 3'-0\" wide, spans 52'-6\" to 55'-6\"; 4'-6\" of wall remains to the NE corner.",
  ),
  {
    id: "MAN DOOR (SW)",
    wall: "west",
    startFt: 30.5,
    endFt: 33.5,
    centreXFt: 0,
    centreYFt: 32,
    kind: "man_door",
    evidence: "MAN DOOR (SW), 3'-0\" wide, on the west wall about 32 ft south of the north wall.",
  },
];

/** Wall remaining east of the NE man door, in feet. */
export const NE_MAN_DOOR_TO_CORNER_FT =
  SHOP_WIDTH_FT - (PLAN_OPENINGS.find((o) => o.id === "MAN DOOR (NE)")?.endFt ?? 0);

/* -------------------------------------------------- proposed overhead lights */

export interface ProposedFixture {
  /** Plan order: west-to-east across the northern row, then the southern row. */
  planOrder: number;
  xFt: number;
  yFt: number;
  row: "north" | "south";
}

const LED_X_FT = [6, 18, 30, 42, 54] as const;

/**
 * Proposed 2 x 5 symmetric overhead LED layout. Design/proposed geometry only —
 * these are not field observations and are not tied to any record until an
 * approved update assigns them.
 */
export const PROPOSED_OVERHEAD_LEDS: ProposedFixture[] = [
  ...LED_X_FT.map((xFt, i) => ({ planOrder: i + 1, xFt, yFt: 10, row: "north" as const })),
  ...LED_X_FT.map((xFt, i) => ({ planOrder: i + 6, xFt, yFt: 30, row: "south" as const })),
];

export const PROPOSED_OVERHEAD_LED_LEGEND = `Overhead LED — Proposed (${PROPOSED_OVERHEAD_LEDS.length})`;

export { SHOP_DEPTH_FT, SHOP_WIDTH_FT };
