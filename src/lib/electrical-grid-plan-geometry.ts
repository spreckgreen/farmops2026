// Farm Shop plan geometry — one SVG coordinate system for the drawing and for
// every marker.
//
// The base plan is the original `farm-shop-grid-plan.png`, whose intrinsic size
// is 1448 x 1086 px. That is the SVG viewBox, so a drawing unit is one pixel of
// the original drawing and the raster is placed 1:1 at the origin. The building
// envelope inside that drawing is the measured rectangle
// x = 185..1253, y = 210..826, and physical feet map into it linearly:
//
//   mapX = 185 + (xFeet / 60) * 1068
//   mapY = 210 + (yFeet / 40) * 616
//
// Because the backdrop and every marker share this single viewBox with a
// uniform `preserveAspectRatio`, container width, browser zoom and device pixel
// ratio cannot move a marker relative to the plan.
//
// Origin of the feet system is the north-west corner (A1). X grows east across
// 60 ft, Y grows south across 40 ft. A9 = north-east, F1 = south-west,
// F9 = south-east.
import { SHOP_DEPTH_FT, SHOP_WIDTH_FT } from "@/lib/electrical-grid-migration";

export const PLAN_GEOMETRY_VERSION = "farm-shop-plan-geometry-4-drawing-native";

/** Intrinsic size of the original drawing — and the SVG viewBox. */
export const PLAN_DRAWING = { width: 1448, height: 1086 } as const;

export const PLAN_VIEW_BOX = `0 0 ${PLAN_DRAWING.width} ${PLAN_DRAWING.height}`;

/** The building envelope inside the drawing, in drawing units. */
export const PLAN_BUILDING = {
  left: 185,
  top: 210,
  width: 1068,
  height: 616,
} as const;

/** Aspect ratio of the whole drawing — used to size the responsive container. */
export const PLAN_ASPECT_RATIO = PLAN_DRAWING.width / PLAN_DRAWING.height;

/** Aspect ratio of the physical building, 60:40 — used by foreign renderers. */
export const PLAN_BUILDING_ASPECT_RATIO = SHOP_WIDTH_FT / SHOP_DEPTH_FT;

/** Drawing units per physical foot, along each axis. */
export const PLAN_UNITS_PER_FT_X = PLAN_BUILDING.width / SHOP_WIDTH_FT;
export const PLAN_UNITS_PER_FT_Y = PLAN_BUILDING.height / SHOP_DEPTH_FT;
/** One conservative scalar for circular/symmetric symbol sizes. */
export const PLAN_UNITS_PER_FT = Math.min(PLAN_UNITS_PER_FT_X, PLAN_UNITS_PER_FT_Y);

/** Feet → drawing units, the single documented transform. */
export function feetToPlan(xFt: number, yFt: number): { x: number; y: number } {
  return {
    x: PLAN_BUILDING.left + (xFt / SHOP_WIDTH_FT) * PLAN_BUILDING.width,
    y: PLAN_BUILDING.top + (yFt / SHOP_DEPTH_FT) * PLAN_BUILDING.height,
  };
}

/** Retained name used across the map, print and test code. */
export const feetToPlanPx = feetToPlan;

export function planToFeet(x: number, y: number): { xFt: number; yFt: number } {
  return {
    xFt: ((x - PLAN_BUILDING.left) / PLAN_BUILDING.width) * SHOP_WIDTH_FT,
    yFt: ((y - PLAN_BUILDING.top) / PLAN_BUILDING.height) * SHOP_DEPTH_FT,
  };
}

export const planPxToFeet = planToFeet;

/** Feet → fraction of the building envelope (0–1), for foreign rectangles. */
export function feetToPlanFraction(xFt: number, yFt: number): { fx: number; fy: number } {
  return { fx: xFt / SHOP_WIDTH_FT, fy: yFt / SHOP_DEPTH_FT };
}

/** The building envelope as a fraction of the drawing. */
export const PLAN_BUILDING_FRACTION = {
  left: PLAN_BUILDING.left / PLAN_DRAWING.width,
  top: PLAN_BUILDING.top / PLAN_DRAWING.height,
  width: PLAN_BUILDING.width / PLAN_DRAWING.width,
  height: PLAN_BUILDING.height / PLAN_DRAWING.height,
} as const;

/** Clamp a drawing-unit point inside the building envelope. */
export function clampToBuilding(x: number, y: number): { x: number; y: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  return {
    x: clamp(x, PLAN_BUILDING.left, PLAN_BUILDING.left + PLAN_BUILDING.width),
    y: clamp(y, PLAN_BUILDING.top, PLAN_BUILDING.top + PLAN_BUILDING.height),
  };
}

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

/** Openings recorded in feet from the corrected Farm Shop drawing. */
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

/**
 * Approved design coordinates for the pattern-generated overhead LED records,
 * in plan order (north row west→east, then south row). These are APPROVED
 * DESIGN X/Y, not field observations: lifecycle stays planned and the location
 * stays unverified until accepted field evidence supersedes it. Consumers plot
 * these exact feet; the A1–F9 label shown alongside is derived read-out only.
 */
export const APPROVED_DESIGN_XY_BY_STABLE_ID: Record<string, { xFt: number; yFt: number; approval: string }> =
  Object.fromEntries(
    PROPOSED_OVERHEAD_LEDS.map((f, i) => [
      `FS-${String(56 + i).padStart(3, "0")}`,
      {
        xFt: f.xFt,
        yFt: f.yFt,
        approval: "Approved 2 x 5 overhead LED design layout (frozen plan geometry)",
      },
    ]),
  );

/** Approved design coordinates for a stable ID, or null when none is approved. */
export function approvedDesignXy(stableId: string | null | undefined) {
  const id = (stableId ?? "").trim().toUpperCase();
  return id ? (APPROVED_DESIGN_XY_BY_STABLE_ID[id] ?? null) : null;
}

export const PROPOSED_OVERHEAD_LED_LEGEND = `Overhead LED — Proposed (${PROPOSED_OVERHEAD_LEDS.length})`;

export { SHOP_DEPTH_FT, SHOP_WIDTH_FT };
