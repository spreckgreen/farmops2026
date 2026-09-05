// Deriving camera positions on a building grid from recorded compass sides.
//
// Nothing here invents a measurement. A camera is placed only when the account
// already records (a) which side of the building it is mounted on and (b) a
// building grid with a cell size, rows and columns. The position is derived
// from that grid geometry: it is a plan position on the building outline, not a
// tape-measured mount point, and it is labelled that way everywhere it shows.
import { COMPASS_SIDE_HEADING, type CompassSide, isCompassSide } from "@/lib/ring-cameras";

export interface GridBuilding {
  id: string;
  building_name?: string | null;
  temp_name?: string | null;
  grid_cell_ft?: number | string | null;
  grid_rows?: number | null;
  grid_columns?: number | null;
  grid_row_labels?: string | null;
  grid_column_labels?: string | null;
  north_offset_degrees?: number | string | null;
}

export interface GridExtent {
  cellFeet: number;
  rows: number;
  columns: number;
  widthFeet: number;
  depthFeet: number;
  rowLabels: string[];
  columnLabels: string[];
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function labelList(value: unknown, count: number, letters: boolean): string[] {
  const text = String(value ?? "").trim();
  if (text !== "") {
    const parts = text
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p !== "");
    if (parts.length >= count) return parts.slice(0, count);
  }
  return Array.from({ length: count }, (_, i) =>
    letters ? (LETTERS[i] ?? String(i + 1)) : String(i + 1),
  );
}

/** The grid's real extent in feet, or null when the building has no usable grid. */
export function gridExtent(building: GridBuilding | null | undefined): GridExtent | null {
  if (!building) return null;
  const cellFeet = Number(building.grid_cell_ft ?? 0);
  const rows = Number(building.grid_rows ?? 0);
  const columns = Number(building.grid_columns ?? 0);
  if (!(cellFeet > 0) || !(rows > 0) || !(columns > 0)) return null;
  return {
    cellFeet,
    rows,
    columns,
    widthFeet: columns * cellFeet,
    depthFeet: rows * cellFeet,
    rowLabels: labelList(building.grid_row_labels, rows, true),
    columnLabels: labelList(building.grid_column_labels, columns, false),
  };
}

/** Grid cell label (for example "C4") for a position in feet inside the grid. */
export function cellForPoint(extent: GridExtent, xFeet: number, yFeet: number): string | null {
  const column = Math.floor(Math.min(Math.max(xFeet, 0), extent.widthFeet - 0.001) / extent.cellFeet);
  const row = Math.floor(Math.min(Math.max(yFeet, 0), extent.depthFeet - 0.001) / extent.cellFeet);
  const rowLabel = extent.rowLabels[row];
  const columnLabel = extent.columnLabels[column];
  if (!rowLabel || !columnLabel) return null;
  return `${rowLabel}${columnLabel}`;
}

export interface PlacementMember {
  id: string;
  camera_id: string;
  compass_side?: string | null;
  side_slot?: number | null;
  x_feet?: number | null;
  y_feet?: number | null;
  heading_degrees?: number | null;
}

export interface DerivedPlacement {
  id: string;
  camera_id: string;
  side: CompassSide;
  slot: number;
  slots: number;
  x_feet: number;
  y_feet: number;
  heading_degrees: number;
  cell: string | null;
  /** Already recorded at this same position and heading. */
  unchanged: boolean;
}

export interface PlacementPlan {
  placements: DerivedPlacement[];
  /** Cameras that cannot be placed, with the reason in plain words. */
  withheld: { id: string; camera_id: string; reason: string }[];
}

/**
 * Where along a side the camera sits: members of the same side are spread
 * evenly, so a single camera lands at the middle of that wall and two cameras
 * land at the one-third points. Corner sides (NE, SE, SW, NW) land on the
 * corner itself.
 */
function sidePoint(
  extent: GridExtent,
  side: CompassSide,
  index: number,
  count: number,
): { x: number; y: number } {
  const w = extent.widthFeet;
  const d = extent.depthFeet;
  const fraction = (index + 1) / (count + 1);
  switch (side) {
    case "N":
      return { x: w * fraction, y: 0 };
    case "S":
      return { x: w * fraction, y: d };
    case "W":
      return { x: 0, y: d * fraction };
    case "E":
      return { x: w, y: d * fraction };
    case "NE":
      return { x: w, y: 0 };
    case "SE":
      return { x: w, y: d };
    case "SW":
      return { x: 0, y: d };
    case "NW":
    default:
      return { x: 0, y: 0 };
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function samePoint(a: number | null | undefined, b: number): boolean {
  if (a === null || a === undefined) return false;
  return Math.abs(Number(a) - b) < 0.05;
}

/**
 * Derive a placement for every camera that records a compass side. Cameras
 * without a side, or on a building without a grid, are withheld with a reason.
 */
export function derivePlacements(
  building: GridBuilding | null | undefined,
  cameras: readonly PlacementMember[],
): PlacementPlan {
  const extent = gridExtent(building);
  if (!extent) {
    return {
      placements: [],
      withheld: cameras.map((c) => ({
        id: c.id,
        camera_id: c.camera_id,
        reason: "This building has no grid yet — define its grid first.",
      })),
    };
  }

  const withheld: PlacementPlan["withheld"] = [];
  const bySide = new Map<CompassSide, PlacementMember[]>();
  for (const camera of cameras) {
    if (!isCompassSide(camera.compass_side)) {
      withheld.push({
        id: camera.id,
        camera_id: camera.camera_id,
        reason: "No compass side recorded for this camera.",
      });
      continue;
    }
    const side = camera.compass_side;
    const list = bySide.get(side) ?? [];
    list.push(camera);
    bySide.set(side, list);
  }

  const northOffset = Number(building?.north_offset_degrees ?? 0) || 0;
  const placements: DerivedPlacement[] = [];
  for (const [side, members] of bySide) {
    const ordered = [...members].sort((a, b) => {
      const slotA = Number(a.side_slot ?? 1);
      const slotB = Number(b.side_slot ?? 1);
      if (slotA !== slotB) return slotA - slotB;
      return a.camera_id.localeCompare(b.camera_id);
    });
    ordered.forEach((camera, index) => {
      const point = sidePoint(extent, side, index, ordered.length);
      const x = round(point.x);
      const y = round(point.y);
      const heading = ((COMPASS_SIDE_HEADING[side] + northOffset) % 360 + 360) % 360;
      placements.push({
        id: camera.id,
        camera_id: camera.camera_id,
        side,
        slot: index + 1,
        slots: ordered.length,
        x_feet: x,
        y_feet: y,
        heading_degrees: round(heading),
        cell: cellForPoint(extent, x, y),
        unchanged:
          samePoint(camera.x_feet, x) &&
          samePoint(camera.y_feet, y) &&
          samePoint(camera.heading_degrees, heading),
      });
    });
  }

  placements.sort((a, b) => a.camera_id.localeCompare(b.camera_id));
  return { placements, withheld };
}

export function buildingLabel(building: GridBuilding | null | undefined): string {
  if (!building) return "Building";
  const name = String(building.building_name ?? "").trim();
  if (name !== "") return name;
  return String(building.temp_name ?? "Building").trim() || "Building";
}
