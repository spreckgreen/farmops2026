// FARMOPS-ELEC-RING-CAMERA-DESIGN-V1 — approved planned design for the eight
// Farm Shop exterior Ring cameras, FS-002 … FS-009.
//
// The pattern is two cameras per building corner, clockwise from the northeast
// corner. Each pair SHARES the corner coordinate and corner reference while
// keeping its own wall face and coverage direction, so the location source is
// APPROVED_DESIGN_CORNER_FACE: the corner feet are the plotted geometry, the
// face/coverage disambiguate the two devices, and the A1–F9 label is a derived
// read-out only.
//
// These are PLANNED design facts. Nothing here is field observed or as-built
// verified: lifecycle stays planned, no verification field is written, and an
// accepted field observation supersedes the planned position while the planned
// values remain recorded for comparison.
import { SHOP_DEPTH_FT, SHOP_WIDTH_FT } from "@/lib/electrical-grid-migration";
import { derivedGridLabel } from "@/lib/electrical-grid-map";

export const RING_CAMERA_DESIGN_VERSION = "farm-shop-ring-camera-corner-face-1";

export const RING_CAMERA_LOCATION_SOURCE = "APPROVED_DESIGN_CORNER_FACE";
export const RING_CAMERA_MOUNTING_CLASSIFICATION = "EXTERIOR_WALL_MOUNT";
export const RING_CAMERA_MOUNT_HEIGHT_FT = 8;
/** Logical resilience grouping — never a physical panelboard. */
export const RING_CAMERA_RESILIENCE_CLASS = "CRITICAL_CAMERA_GROUP";
/** Proposed *physical* source panel. Planned assignment only. */
export const RING_CAMERA_PROPOSED_PANEL = "PNL-FS-NE";
/** The logical grouping that must not sit in a physical panel field. */
export const RING_CAMERA_LOGICAL_PANEL_TOKEN = "PNL-FS-CRIT";
/** Not part of the eight-camera corner pattern without further evidence. */
export const RING_CAMERA_HELD_LOAD = "FS-010";

export type Corner = "NE" | "SE" | "SW" | "NW";
export type WallFace = "north" | "east" | "south" | "west";

/** Frozen building corners in feet (origin = north-west corner, A1). */
export const CORNER_FEET: Record<Corner, { xFt: number; yFt: number }> = {
  NW: { xFt: 0, yFt: 0 },
  NE: { xFt: SHOP_WIDTH_FT, yFt: 0 },
  SE: { xFt: SHOP_WIDTH_FT, yFt: SHOP_DEPTH_FT },
  SW: { xFt: 0, yFt: SHOP_DEPTH_FT },
};

export interface RingCameraDesign {
  load_id: string;
  /** Owner wording, e.g. "North side, NE Ring Camera". */
  wording: string;
  corner: Corner;
  wallFace: WallFace;
  /** Outward coverage direction of the mounted face. */
  coverageDirection: WallFace;
  xFt: number;
  yFt: number;
  /** Derived read-out of the corner coordinate; never field evidence. */
  derivedGrid: string;
}

const face = (
  load_id: string,
  corner: Corner,
  wallFace: WallFace,
  wording: string,
): RingCameraDesign => ({
  load_id,
  wording,
  corner,
  wallFace,
  coverageDirection: wallFace,
  xFt: CORNER_FEET[corner].xFt,
  yFt: CORNER_FEET[corner].yFt,
  derivedGrid: derivedGridLabel(CORNER_FEET[corner].xFt, CORNER_FEET[corner].yFt),
});

/** Clockwise from the north-east corner, two cameras per corner. */
export const RING_CAMERA_DESIGN: RingCameraDesign[] = [
  face("FS-002", "NE", "north", "North side, NE Ring Camera"),
  face("FS-003", "NE", "east", "East side, NE Ring Camera"),
  face("FS-004", "SE", "east", "East side, SE Ring Camera"),
  face("FS-005", "SE", "south", "South side, SE Ring Camera"),
  face("FS-006", "SW", "south", "South side, SW Ring Camera"),
  face("FS-007", "SW", "west", "West side, SW Ring Camera"),
  face("FS-008", "NW", "west", "West side, NW Ring Camera"),
  face("FS-009", "NW", "north", "North side, NW Ring Camera"),
];

export const RING_CAMERA_LOADS = RING_CAMERA_DESIGN.map((d) => d.load_id);

/** The structured planned-location description stored in `location`. */
export function ringCameraLocationDescription(d: RingCameraDesign): string {
  return (
    `${d.wording} — Farm Shop exterior, ${d.corner} corner, ${d.wallFace} wall face, ` +
    `coverage ${d.coverageDirection}; exterior wall mount at ${RING_CAMERA_MOUNT_HEIGHT_FT} ft planned height ` +
    `(approved planned design, not field verified)`
  );
}

/** The exact planned-design field set for one camera. */
export function ringCameraDesignFields(d: RingCameraDesign): Record<string, unknown> {
  return {
    location: ringCameraLocationDescription(d),
    design_location_source: RING_CAMERA_LOCATION_SOURCE,
    corner_reference: d.corner,
    mounting_wall_face: d.wallFace,
    coverage_direction: d.coverageDirection,
    mounting_classification: RING_CAMERA_MOUNTING_CLASSIFICATION,
    mounting_height_ft: RING_CAMERA_MOUNT_HEIGHT_FT,
    design_x_ft: d.xFt,
    design_y_ft: d.yFt,
    design_grid: d.derivedGrid,
    suggested_panel: RING_CAMERA_PROPOSED_PANEL,
    resilience_class: RING_CAMERA_RESILIENCE_CLASS,
    load_shed_capable: true,
    // Circuit grouping is unknown, and an unknown circuit group is never
    // evidence of a dedicated branch circuit.
    dedicated: false,
  };
}

export const RING_CAMERA_UNRESOLVED_NOTE =
  "Unresolved and deliberately not written: power method, equipment model, voltage, whether the light and camera are one combined device, circuit group, breaker position and overcurrent protection.";
