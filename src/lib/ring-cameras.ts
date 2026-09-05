// Ring camera knowledge and compass-side placement.
//
// Two jobs:
//
// 1. Hold Ring's OWN published view width per model, so a coverage wedge uses
//    the manufacturer's figure instead of a guess. `fov_degrees` on the camera
//    record always wins once someone edits it — this is only a source for
//    prefilling and for reporting where a number came from.
//
// 2. Let a camera be recorded BEFORE its building has a location grid. Until a
//    grid exists there is no honest X/Y in feet, so the camera carries a
//    compass side (which wall it is on) and, when more than one camera shares
//    that side, a slot number. That is enough to draw a compass coverage rose
//    and nothing more: no position on any plan is invented from a side.

export const COMPASS_SIDES = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type CompassSide = (typeof COMPASS_SIDES)[number];

export const COMPASS_SIDE_LABEL: Record<CompassSide, string> = {
  N: "North side",
  NE: "North-east corner",
  E: "East side",
  SE: "South-east corner",
  S: "South side",
  SW: "South-west corner",
  W: "West side",
  NW: "North-west corner",
};

/** Outward-facing heading of each side, in compass degrees (0 = north). */
export const COMPASS_SIDE_HEADING: Record<CompassSide, number> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

export function isCompassSide(value: unknown): value is CompassSide {
  return (COMPASS_SIDES as readonly string[]).includes(String(value ?? ""));
}

export interface RingModel {
  id: string;
  label: string;
  /** Ring's published horizontal field of view, in degrees. */
  fovDegrees: number;
  /** Ring's published motion-detection distance, in feet. */
  motionRangeFeet: number;
  /** True when the camera can be aimed remotely, so one unit can cover a side. */
  pans: boolean;
  note: string;
}

/**
 * Ring's published figures. Horizontal field of view is used, not the larger
 * diagonal number, because a coverage wedge is drawn on a flat plan.
 */
export const RING_MODELS: readonly RingModel[] = [
  {
    id: "stick-up-cam",
    label: "Stick Up Cam (battery, plug-in or wired)",
    fovDegrees: 110,
    motionRangeFeet: 30,
    pans: false,
    note: "Ring publishes 110° horizontal view and motion detection up to 30 ft.",
  },
  {
    id: "stick-up-cam-pro",
    label: "Stick Up Cam Pro",
    fovDegrees: 140,
    motionRangeFeet: 30,
    pans: false,
    note: "Ring publishes 140° horizontal view and motion detection up to 30 ft.",
  },
  {
    id: "spotlight-cam",
    label: "Spotlight Cam (battery, wired, Plus or Pro)",
    fovDegrees: 140,
    motionRangeFeet: 30,
    pans: false,
    note: "Ring publishes 140° horizontal view and motion detection up to 30 ft.",
  },
  {
    id: "floodlight-cam",
    label: "Floodlight Cam (Wired Plus or Pro)",
    fovDegrees: 140,
    motionRangeFeet: 30,
    pans: false,
    note: "Ring publishes 140° horizontal view and motion detection up to 30 ft.",
  },
  {
    id: "video-doorbell",
    label: "Video Doorbell (wired, 2, 3, 4)",
    fovDegrees: 155,
    motionRangeFeet: 30,
    pans: false,
    note: "Ring publishes 155° horizontal view (160° diagonal) and motion detection up to 30 ft.",
  },
  {
    id: "video-doorbell-pro-2",
    label: "Video Doorbell Pro 2",
    fovDegrees: 150,
    motionRangeFeet: 30,
    pans: false,
    note: "Ring publishes 150° horizontal view with head-to-toe framing.",
  },
  {
    id: "indoor-cam",
    label: "Indoor Cam",
    fovDegrees: 115,
    motionRangeFeet: 25,
    pans: false,
    note: "Ring publishes 115° horizontal view for the Indoor Cam.",
  },
  {
    id: "pan-tilt-indoor-cam",
    label: "Pan-Tilt Indoor Cam",
    fovDegrees: 115,
    motionRangeFeet: 25,
    pans: true,
    note: "Ring publishes 115° horizontal view with 360° pan, so the aimed direction changes in use.",
  },
];

export function ringModel(id: string | null | undefined): RingModel | null {
  const key = String(id ?? "").trim();
  if (!key) return null;
  return RING_MODELS.find((model) => model.id === key) ?? null;
}

export function ringModelLabel(id: string | null | undefined): string | null {
  return ringModel(id)?.label ?? null;
}

/* ------------------------------------------------------- sharing one side */

export interface SideAim {
  /** Aim in compass degrees, 0 = north. */
  headingDegrees: number;
  fovDegrees: number;
  /** How the aim was arrived at, in plain words. */
  basis: string;
}

export interface SideMember {
  cameraId: string;
  /** Slot number within the side; 1 is the left-most looking outward. */
  slot: number;
  ringModelId: string | null;
  /** Recorded view width, when someone has already entered one. */
  fovDegrees: number | null;
}

/**
 * Split one side between the cameras mounted on it, using each camera's Ring
 * view width.
 *
 * One camera: it looks straight out from the side.
 *
 * Two or more: the side is shared left to right by slot, and each camera is
 * aimed at the centre of its own share. When the models' own view widths add up
 * to more than the shared arc the wedges overlap — that overlap is real and is
 * drawn, never trimmed. Cameras with no recorded slot are left unaimed rather
 * than assumed to be in any order.
 */
export function aimSideMembers(
  side: CompassSide,
  members: readonly SideMember[],
): Map<string, SideAim> {
  const out = new Map<string, SideAim>();
  const outward = COMPASS_SIDE_HEADING[side];
  const slotted = members
    .filter((m) => Number.isFinite(m.slot) && m.slot >= 1)
    .sort((a, b) => a.slot - b.slot || a.cameraId.localeCompare(b.cameraId));

  const widthOf = (m: SideMember) =>
    m.fovDegrees ?? ringModel(m.ringModelId)?.fovDegrees ?? null;

  if (slotted.length === 1) {
    const only = slotted[0];
    const fov = widthOf(only);
    if (fov !== null) {
      out.set(only.cameraId, {
        headingDegrees: outward,
        fovDegrees: fov,
        basis: `Only camera on the ${COMPASS_SIDE_LABEL[side].toLowerCase()}, so it looks straight out; ${fov}° view width from Ring.`,
      });
    }
    return out;
  }

  if (slotted.length < 2) return out;

  // Widest realistic arc a side can be asked to cover: the two neighbouring
  // compass directions, i.e. 90° centred on the outward heading.
  const arc = 90;
  const share = arc / slotted.length;
  const start = outward - arc / 2;
  slotted.forEach((member, index) => {
    const fov = widthOf(member);
    if (fov === null) return;
    const centre = start + share * index + share / 2;
    const heading = ((centre % 360) + 360) % 360;
    out.set(member.cameraId, {
      headingDegrees: Math.round(heading * 10) / 10,
      fovDegrees: fov,
      basis: `${slotted.length} cameras share the ${COMPASS_SIDE_LABEL[side].toLowerCase()}; this one takes share ${member.slot} of ${slotted.length} and keeps its ${fov}° Ring view width.`,
    });
  });
  return out;
}

/* --------------------------------------------------------- grid readiness */

export interface GridAwareCamera {
  camera_id: string;
  building: string | null;
  x_feet: number | null;
  y_feet: number | null;
  compass_side: string | null;
  side_slot: number | null;
  ring_model: string | null;
}

export type CameraPlacementState =
  | "on_plan"
  | "compass_only"
  | "awaiting_side";

export interface CameraPlacement {
  state: CameraPlacementState;
  label: string;
  detail: string;
  side: CompassSide | null;
}

/**
 * What is known about where a camera is. A camera only reaches the plan when
 * real feet are recorded; a compass side is explicitly NOT converted into feet.
 */
export function cameraPlacement(
  camera: GridAwareCamera,
  gridDefinedForBuilding: boolean,
): CameraPlacement {
  const side = isCompassSide(camera.compass_side) ? camera.compass_side : null;
  if (camera.x_feet !== null && camera.y_feet !== null) {
    return {
      state: "on_plan",
      label: "On the plan",
      detail: "Measured position recorded, so it is drawn on the building plan.",
      side,
    };
  }
  if (side) {
    return {
      state: "compass_only",
      label: gridDefinedForBuilding ? "Side only — ready to measure" : "Waiting for a building grid",
      detail: gridDefinedForBuilding
        ? `Recorded on the ${COMPASS_SIDE_LABEL[side].toLowerCase()}. This building now has a grid, so a measured position can be added.`
        : `Recorded on the ${COMPASS_SIDE_LABEL[side].toLowerCase()}. No grid exists for this building yet, so no plan position is recorded.`,
      side,
    };
  }
  return {
    state: "awaiting_side",
    label: "No side recorded",
    detail: "Choose which side of the building this camera is on to place it on the compass view.",
    side: null,
  };
}

/** Group cameras by side and hand back the aim each one gets. */
export function aimByCompassSide(
  cameras: readonly GridAwareCamera[],
): Map<string, SideAim> {
  const bySide = new Map<CompassSide, SideMember[]>();
  for (const camera of cameras) {
    if (!isCompassSide(camera.compass_side)) continue;
    if (camera.x_feet !== null && camera.y_feet !== null) continue;
    const list = bySide.get(camera.compass_side) ?? [];
    list.push({
      cameraId: camera.camera_id,
      slot: Number(camera.side_slot ?? 0),
      ringModelId: camera.ring_model,
      fovDegrees: null,
    });
    bySide.set(camera.compass_side, list);
  }
  const out = new Map<string, SideAim>();
  for (const [side, members] of bySide) {
    for (const [cameraId, aim] of aimSideMembers(side, members)) out.set(cameraId, aim);
  }
  return out;
}

/** Next free slot on a side, so two cameras never claim the same share. */
export function nextSideSlot(
  cameras: readonly GridAwareCamera[],
  building: string | null,
  side: CompassSide,
): number {
  let max = 0;
  for (const camera of cameras) {
    if (String(camera.building ?? "") !== String(building ?? "")) continue;
    if (camera.compass_side !== side) continue;
    max = Math.max(max, Number(camera.side_slot ?? 0));
  }
  return max + 1;
}
