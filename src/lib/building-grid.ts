// Tenant-defined building grids.
//
// A building grid can be defined three ways, and none of them guesses anything:
//   1. entered dimensions (W x L x Height) with a standard shape,
//   2. an outline imported from a drawing (corner list, SVG, DXF),
//   3. corners traced on imagery (the existing site-plan flow).
//
// Everything here is deterministic geometry in feet. Orientation is recorded as
// the compass bearing of the length axis, so the grid can be drawn north-up
// without changing the stored measurements. Grid references stay the existing
// convention: letter rows across the width, number columns along the length.

import { deriveGrid, fitRectangle, polygonAreaSqFt, polygonPerimeterFt, rowLabel } from "@/lib/site-plan";
import type { DerivedGrid, PointFt } from "@/lib/site-plan";

export type ShapeTemplate = "RECTANGLE" | "L_SHAPE" | "T_SHAPE" | "LEAN_TO";

export type DefinitionMethod =
  | "TRACED_IMAGERY"
  | "ENTERED_DIMENSIONS"
  | "STANDARD_SHAPE"
  | "CORNER_LIST"
  | "SVG_IMPORT"
  | "DXF_IMPORT"
  | "TRACED_PDF";

export type WalkPattern = "CLOCKWISE" | "COUNTERCLOCKWISE" | "SERPENTINE_ROWS" | "ROW_MAJOR";

export const SHAPE_TEMPLATES: { value: ShapeTemplate; label: string; help: string }[] = [
  { value: "RECTANGLE", label: "Rectangle", help: "Width × length, four corners." },
  {
    value: "L_SHAPE",
    label: "L-shape",
    help: "Rectangle with a bite taken out of the far corner — give the missing piece's size.",
  },
  {
    value: "T_SHAPE",
    label: "T-shape",
    help: "Rectangle with a centred extension off the long wall.",
  },
  {
    value: "LEAN_TO",
    label: "Rectangle with lean-to",
    help: "Main building plus an attached shed along part of one long wall.",
  },
];

export const WALK_PATTERNS: { value: WalkPattern; label: string; help: string }[] = [
  {
    value: "CLOCKWISE",
    label: "Walk the walls, clockwise",
    help: "Perimeter cells only, starting at your chosen corner.",
  },
  {
    value: "COUNTERCLOCKWISE",
    label: "Walk the walls, counter-clockwise",
    help: "Perimeter cells only, the other way round.",
  },
  {
    value: "SERPENTINE_ROWS",
    label: "Back and forth by row",
    help: "Every cell, alternating direction each row — no walking back to the start of a row.",
  },
  { value: "ROW_MAJOR", label: "Row by row, same direction", help: "Every cell, always left to right." },
];

export interface ShapeDimensions {
  /** Short side, feet — becomes the letter rows. */
  widthFt: number;
  /** Long side, feet — becomes the number columns. */
  lengthFt: number;
  /** Wall height, feet. Recorded, never used to derive the grid. */
  heightFt?: number | null;
  /** L-shape: size of the missing corner piece. */
  notchLengthFt?: number | null;
  notchWidthFt?: number | null;
  /** T-shape: centred extension off the long wall. */
  extensionWidthFt?: number | null;
  extensionDepthFt?: number | null;
  /** Lean-to: depth and run of the attached shed. */
  leanToDepthFt?: number | null;
  leanToLengthFt?: number | null;
}

function positive(value: number | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Corner points for a standard shape, in feet, origin at the first corner of
 * the length axis. +x runs along the length, +y across the width.
 */
export function templateOutline(template: ShapeTemplate, dims: ShapeDimensions): PointFt[] {
  const L = positive(dims.lengthFt);
  const W = positive(dims.widthFt);
  if (L <= 0 || W <= 0) return [];

  if (template === "L_SHAPE") {
    const nl = Math.min(positive(dims.notchLengthFt), L - 1);
    const nw = Math.min(positive(dims.notchWidthFt), W - 1);
    if (nl <= 0 || nw <= 0) return rect(L, W);
    return [
      { x: 0, y: 0 },
      { x: L, y: 0 },
      { x: L, y: W - nw },
      { x: L - nl, y: W - nw },
      { x: L - nl, y: W },
      { x: 0, y: W },
    ];
  }

  if (template === "T_SHAPE") {
    const ew = Math.min(positive(dims.extensionWidthFt), L);
    const ed = positive(dims.extensionDepthFt);
    if (ew <= 0 || ed <= 0) return rect(L, W);
    const left = (L - ew) / 2;
    return [
      { x: 0, y: 0 },
      { x: L, y: 0 },
      { x: L, y: W },
      { x: left + ew, y: W },
      { x: left + ew, y: W + ed },
      { x: left, y: W + ed },
      { x: left, y: W },
      { x: 0, y: W },
    ];
  }

  if (template === "LEAN_TO") {
    const depth = positive(dims.leanToDepthFt);
    const run = Math.min(positive(dims.leanToLengthFt) || L, L);
    if (depth <= 0) return rect(L, W);
    return [
      { x: 0, y: 0 },
      { x: L, y: 0 },
      { x: L, y: W },
      { x: run, y: W },
      { x: run, y: W + depth },
      { x: 0, y: W + depth },
    ];
  }

  return rect(L, W);
}

function rect(lengthFt: number, widthFt: number): PointFt[] {
  return [
    { x: 0, y: 0 },
    { x: lengthFt, y: 0 },
    { x: lengthFt, y: widthFt },
    { x: 0, y: widthFt },
  ];
}

export interface BoundsFt {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  lengthFt: number;
  widthFt: number;
}

export function outlineBounds(points: PointFt[]): BoundsFt | null {
  if (points.length < 3) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX,
    minY,
    maxX,
    maxY,
    lengthFt: Number((maxX - minX).toFixed(2)),
    widthFt: Number((maxY - minY).toFixed(2)),
  };
}

/** Shift an outline so its bounding box starts at (0, 0). */
export function normalizeOutline(points: PointFt[]): PointFt[] {
  const bounds = outlineBounds(points);
  if (!bounds) return [...points];
  return points.map((p) => ({
    x: Number((p.x - bounds.minX).toFixed(3)),
    y: Number((p.y - bounds.minY).toFixed(3)),
  }));
}

/** Rotate points so north points up on screen, given the length axis bearing. */
export function rotateToNorthUp(points: PointFt[], lengthAxisBearingDeg: number): PointFt[] {
  const bearing = ((Number(lengthAxisBearingDeg) || 0) % 360 + 360) % 360;
  const angle = ((90 - bearing) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return points.map((p) => ({
    x: Number((p.x * cos - p.y * sin).toFixed(3)),
    y: Number((p.x * sin + p.y * cos).toFixed(3)),
  }));
}

const COMPASS_16 = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

export function compassPoint(bearingDeg: number): string {
  const bearing = ((Number(bearingDeg) || 0) % 360 + 360) % 360;
  const index = Math.round(bearing / 22.5) % 16;
  return COMPASS_16[index]!;
}

/** Plain-language orientation for a length-axis bearing. */
export function bearingDescription(bearingDeg: number): string {
  const bearing = ((Number(bearingDeg) || 0) % 360 + 360) % 360;
  const opposite = (bearing + 180) % 360;
  return `Column 1 → last column runs ${compassPoint(bearing)} (${bearing.toFixed(0)}° from north); rows read back toward ${compassPoint(opposite)}.`;
}

export interface GridCellRef {
  row: number;
  column: number;
  ref: string;
}

export function cellRef(row: number, column: number): string {
  return `${rowLabel(row)}${column + 1}`;
}

export function gridCorners(grid: Pick<DerivedGrid, "rows" | "columns">): GridCellRef[] {
  const lastRow = grid.rows - 1;
  const lastCol = grid.columns - 1;
  const seen = new Set<string>();
  const out: GridCellRef[] = [];
  for (const [row, column] of [
    [0, 0],
    [0, lastCol],
    [lastRow, lastCol],
    [lastRow, 0],
  ] as [number, number][]) {
    const ref = cellRef(row, column);
    if (seen.has(ref)) continue;
    seen.add(ref);
    out.push({ row, column, ref });
  }
  return out;
}

function perimeterCells(rows: number, columns: number): GridCellRef[] {
  const out: GridCellRef[] = [];
  const push = (row: number, column: number) => {
    const ref = cellRef(row, column);
    if (!out.some((c) => c.ref === ref)) out.push({ row, column, ref });
  };
  for (let c = 0; c < columns; c += 1) push(0, c);
  for (let r = 1; r < rows; r += 1) push(r, columns - 1);
  for (let c = columns - 2; c >= 0; c -= 1) push(rows - 1, c);
  for (let r = rows - 2; r >= 1; r -= 1) push(r, 0);
  return out;
}

export interface WalkRoute {
  pattern: WalkPattern;
  startCell: string;
  finishCell: string;
  cells: string[];
  coversWholeFloor: boolean;
}

/**
 * Ordered walk-around route through the grid. The start must be one of the four
 * grid corners; the finish is wherever that route ends.
 */
export function walkRoute(
  grid: Pick<DerivedGrid, "rows" | "columns">,
  startCell: string,
  pattern: WalkPattern,
): WalkRoute {
  const corners = gridCorners(grid);
  const start = corners.find((c) => c.ref === startCell) ?? corners[0]!;
  const rows = Math.max(1, grid.rows);
  const columns = Math.max(1, grid.columns);

  let cells: string[];
  if (pattern === "CLOCKWISE" || pattern === "COUNTERCLOCKWISE") {
    const loop = perimeterCells(rows, columns);
    const ordered = pattern === "CLOCKWISE" ? loop : [loop[0]!, ...loop.slice(1).reverse()];
    const at = ordered.findIndex((c) => c.ref === start.ref);
    const from = at >= 0 ? at : 0;
    cells = [...ordered.slice(from), ...ordered.slice(0, from)].map((c) => c.ref);
  } else {
    const rowOrder = start.row === 0 ? [...Array(rows).keys()] : [...Array(rows).keys()].reverse();
    const forward = start.column === 0;
    cells = [];
    rowOrder.forEach((row, index) => {
      const leftToRight = pattern === "ROW_MAJOR" ? forward : index % 2 === 0 ? forward : !forward;
      const colOrder = leftToRight
        ? [...Array(columns).keys()]
        : [...Array(columns).keys()].reverse();
      for (const column of colOrder) cells.push(cellRef(row, column));
    });
  }

  return {
    pattern,
    startCell: cells[0] ?? start.ref,
    finishCell: cells[cells.length - 1] ?? start.ref,
    cells,
    coversWholeFloor: pattern === "ROW_MAJOR" || pattern === "SERPENTINE_ROWS",
  };
}

export interface DefinedBuildingGrid {
  buildingName: string;
  definitionMethod: DefinitionMethod;
  shapeTemplate: ShapeTemplate | null;
  heightFt: number | null;
  /** Outline in feet, normalised so the bounding box starts at (0, 0). */
  outlineFt: PointFt[];
  footprintSqFt: number;
  perimeterFt: number;
  lengthFt: number;
  widthFt: number;
  /** Compass bearing of the length axis, 0–359. */
  lengthAxisBearing: number;
  orientationNote: string;
  grid: DerivedGrid;
  walk: WalkRoute;
  gaps: string[];
}

export interface DefineBuildingInput {
  buildingName: string;
  definitionMethod: DefinitionMethod;
  shapeTemplate?: ShapeTemplate | null;
  outlineFt: PointFt[];
  heightFt?: number | null;
  cellFt?: number | null;
  lengthAxisBearing?: number | null;
  walkStartCell?: string | null;
  walkPattern?: WalkPattern | null;
}

/**
 * Turn a named outline in feet into its starting location grid. Unusable input
 * is reported as a gap rather than guessed at.
 */
export function defineBuildingGrid(input: DefineBuildingInput): DefinedBuildingGrid | null {
  const name = String(input.buildingName ?? "").trim();
  const outline = normalizeOutline(input.outlineFt ?? []);
  const bounds = outlineBounds(outline);
  if (!name || !bounds || bounds.lengthFt <= 0 || bounds.widthFt <= 0) return null;

  const area = polygonAreaSqFt(outline);
  if (area <= 0) return null;

  const cellFt = positive(input.cellFt) || 8;
  const gaps: string[] = [];
  const rect = fitRectangle(outline);
  const boxLength = Math.max(bounds.lengthFt, bounds.widthFt);
  const boxWidth = Math.min(bounds.lengthFt, bounds.widthFt);

  const grid = deriveGrid(
    {
      lengthFt: bounds.lengthFt,
      widthFt: bounds.widthFt,
      azimuthDegrees: rect?.azimuthDegrees ?? 0,
      angleRadians: rect?.angleRadians ?? 0,
      corners: rect?.corners ?? outline,
    },
    cellFt,
  );

  if (bounds.lengthFt % cellFt !== 0 || bounds.widthFt % cellFt !== 0) {
    gaps.push(
      `The ${bounds.lengthFt.toFixed(1)}′ × ${bounds.widthFt.toFixed(1)}′ footprint does not divide evenly into ${cellFt}′ cells — the last row or column is a part cell.`,
    );
  }
  if (area / (bounds.lengthFt * bounds.widthFt) < 0.6) {
    gaps.push(
      "The outline fills less than 60% of its grid frame, so some grid cells sit outside the building.",
    );
  }
  if (!positive(input.heightFt)) {
    gaps.push("Wall height not recorded.");
  }

  const bearing = ((Number(input.lengthAxisBearing) || 0) % 360 + 360) % 360;
  const pattern: WalkPattern = input.walkPattern ?? "CLOCKWISE";
  const startCell = input.walkStartCell ?? gridCorners(grid)[0]!.ref;

  return {
    buildingName: name,
    definitionMethod: input.definitionMethod,
    shapeTemplate: input.shapeTemplate ?? null,
    heightFt: positive(input.heightFt) || null,
    outlineFt: outline,
    footprintSqFt: Number(area.toFixed(2)),
    perimeterFt: Number(polygonPerimeterFt(outline).toFixed(2)),
    lengthFt: boxLength,
    widthFt: boxWidth,
    lengthAxisBearing: bearing,
    orientationNote: bearingDescription(bearing),
    grid,
    walk: walkRoute(grid, startCell, pattern),
    gaps,
  };
}
