// Site plan geometry — derive a measured building footprint, its orientation and
// a reference grid from corners traced on aerial imagery.
//
// Everything here is deterministic and unit-testable. Nothing infers a
// structure identity: a traced outline is a measurement, and any link to an
// existing named structure is an explicit human mapping recorded separately.

export interface LatLng {
  lat: number;
  lng: number;
}

export interface PointFt {
  x: number;
  y: number;
}

/** Feet per degree of latitude (WGS84 mean). */
const FT_PER_DEG_LAT = 364_000 / 1.0034; // ≈ 362,776 ft
/** Feet per degree of longitude at the equator. */
const FT_PER_DEG_LNG_EQ = 365_221;

export function feetPerDegreeLongitude(latitude: number): number {
  return FT_PER_DEG_LNG_EQ * Math.cos((latitude * Math.PI) / 180);
}

/**
 * Project a lat/lng onto a local plane in feet, with +x = east and +y = north.
 * The origin is the first traced corner, so numbers stay small and readable.
 */
export function toLocalFeet(origin: LatLng, point: LatLng): PointFt {
  return {
    x: (point.lng - origin.lng) * feetPerDegreeLongitude(origin.lat),
    y: (point.lat - origin.lat) * FT_PER_DEG_LAT,
  };
}

export function fromLocalFeet(origin: LatLng, point: PointFt): LatLng {
  return {
    lat: origin.lat + point.y / FT_PER_DEG_LAT,
    lng: origin.lng + point.x / feetPerDegreeLongitude(origin.lat),
  };
}

export function centroid(points: LatLng[]): LatLng | null {
  if (points.length === 0) return null;
  const lat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const lng = points.reduce((sum, p) => sum + p.lng, 0) / points.length;
  return { lat, lng };
}

/** Signed shoelace area in square feet (absolute value returned). */
export function polygonAreaSqFt(points: PointFt[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function polygonPerimeterFt(points: PointFt[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/** Convex hull (monotone chain), counter-clockwise. */
export function convexHull(points: PointFt[]): PointFt[] {
  if (points.length < 3) return [...points];
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: PointFt, a: PointFt, b: PointFt) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const build = (input: PointFt[]) => {
    const stack: PointFt[] = [];
    for (const p of input) {
      while (stack.length >= 2 && cross(stack[stack.length - 2]!, stack[stack.length - 1]!, p) <= 0) {
        stack.pop();
      }
      stack.push(p);
    }
    return stack;
  };
  const lower = build(sorted);
  const upper = build([...sorted].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export interface FittedRectangle {
  /** Long side of the best-fit rectangle, in feet. */
  lengthFt: number;
  /** Short side of the best-fit rectangle, in feet. */
  widthFt: number;
  /**
   * Compass azimuth of the long side, 0–179.9 degrees clockwise from north.
   * 0 = the long side runs north–south, 90 = it runs east–west.
   */
  azimuthDegrees: number;
  /** Rotation of the fitted rectangle's local axes, radians, math convention. */
  angleRadians: number;
  /** Rectangle corners in local feet, in order. */
  corners: PointFt[];
}

/**
 * Smallest-area rectangle enclosing the outline (rotating calipers over the
 * hull edges). This is the measured footprint envelope — never a guess about
 * how the building is used.
 */
export function fitRectangle(points: PointFt[]): FittedRectangle | null {
  const hull = convexHull(points);
  if (hull.length < 3) return null;

  let best: FittedRectangle | null = null;
  let bestArea = Number.POSITIVE_INFINITY;

  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    let minU = Number.POSITIVE_INFINITY;
    let maxU = Number.NEGATIVE_INFINITY;
    let minV = Number.POSITIVE_INFINITY;
    let maxV = Number.NEGATIVE_INFINITY;
    for (const p of hull) {
      const u = p.x * cos - p.y * sin;
      const v = p.x * sin + p.y * cos;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const du = maxU - minU;
    const dv = maxV - minV;
    const area = du * dv;
    if (area >= bestArea) continue;
    bestArea = area;

    const back = (u: number, v: number): PointFt => ({
      x: u * Math.cos(angle) - v * Math.sin(angle),
      y: u * Math.sin(angle) + v * Math.cos(angle),
    });
    const corners = [
      back(minU, minV),
      back(maxU, minV),
      back(maxU, maxV),
      back(minU, maxV),
    ];
    const longIsU = du >= dv;
    const longAngle = longIsU ? angle : angle + Math.PI / 2;
    best = {
      lengthFt: Math.max(du, dv),
      widthFt: Math.min(du, dv),
      azimuthDegrees: azimuthFromAngle(longAngle),
      angleRadians: longAngle,
      corners,
    };
  }
  return best;
}

/** Math angle (radians, +x = east, counter-clockwise) → compass azimuth 0–180. */
export function azimuthFromAngle(angleRadians: number): number {
  const deg = (90 - (angleRadians * 180) / Math.PI) % 360;
  const positive = (deg + 360) % 360;
  return Number((positive % 180).toFixed(2));
}

export interface DerivedGrid {
  /** Cell size in feet — the Farm Shop convention is 8 ft. */
  cellFt: number;
  /** Letter rows across the short side. */
  rows: number;
  /** Number columns across the long side. */
  columns: number;
  rowLabels: string[];
  columnLabels: string[];
  /** Grid reference of the first cell, e.g. "A1". */
  firstCell: string;
  /** Grid reference of the last cell, e.g. "F9". */
  lastCell: string;
}

export function rowLabel(index: number): string {
  // A..Z, then AA, AB, ... so a very large building still gets unique rows.
  let n = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

/**
 * Derive the reference grid for one building: letter rows across the short
 * side, number columns across the long side, 8-foot cells, matching the
 * existing Farm Shop convention.
 */
export function deriveGrid(rect: FittedRectangle, cellFt = 8): DerivedGrid {
  const size = cellFt > 0 ? cellFt : 8;
  const rows = Math.max(1, Math.ceil(Number((rect.widthFt / size).toFixed(3))));
  const columns = Math.max(1, Math.ceil(Number((rect.lengthFt / size).toFixed(3))));
  const rowLabels = Array.from({ length: rows }, (_, i) => rowLabel(i));
  const columnLabels = Array.from({ length: columns }, (_, i) => String(i + 1));
  return {
    cellFt: size,
    rows,
    columns,
    rowLabels,
    columnLabels,
    firstCell: `${rowLabels[0]}${columnLabels[0]}`,
    lastCell: `${rowLabels[rows - 1]}${columnLabels[columns - 1]}`,
  };
}

export interface TracedBuilding {
  /** Traced corners in order, as clicked on the imagery. */
  outline: LatLng[];
  notes?: string | null;
}

export interface DerivedBuilding {
  tempName: string;
  sizeRank: number;
  outline: LatLng[];
  origin: LatLng;
  footprintSqFt: number;
  perimeterFt: number;
  fitLengthFt: number;
  fitWidthFt: number;
  orientationDegrees: number;
  orientationLabel: string;
  grid: DerivedGrid;
  /** Fitted rectangle corners as lat/lng, for drawing the grid frame. */
  fitCorners: LatLng[];
  gaps: string[];
}

export function orientationLabel(azimuth: number): string {
  const compass = ((azimuth % 180) + 180) % 180;
  if (compass < 11.25 || compass >= 168.75) return "long axis runs north–south";
  if (compass < 78.75) return "long axis runs north-east to south-west";
  if (compass < 101.25) return "long axis runs east–west";
  return "long axis runs north-west to south-east";
}

export const MIN_TRACED_CORNERS = 3;

/**
 * Derive footprint, orientation and grid for every traced building, then name
 * them BLDG-1 (largest footprint) through BLDG-n (smallest). Buildings with too
 * few corners are reported as gaps instead of being silently dropped.
 */
export function deriveBuildings(traced: TracedBuilding[], cellFt = 8): {
  buildings: DerivedBuilding[];
  skipped: { index: number; reason: string }[];
} {
  const skipped: { index: number; reason: string }[] = [];
  const measured: Omit<DerivedBuilding, "tempName" | "sizeRank">[] = [];

  traced.forEach((item, index) => {
    if (item.outline.length < MIN_TRACED_CORNERS) {
      skipped.push({
        index,
        reason: `Only ${item.outline.length} corner(s) traced — at least ${MIN_TRACED_CORNERS} are needed to measure a footprint.`,
      });
      return;
    }
    const origin = item.outline[0]!;
    const local = item.outline.map((p) => toLocalFeet(origin, p));
    const area = polygonAreaSqFt(local);
    const rect = fitRectangle(local);
    if (!rect || area <= 0) {
      skipped.push({ index, reason: "Traced corners do not enclose an area." });
      return;
    }
    const gaps: string[] = [];
    if (area < 60) {
      gaps.push("Footprint under 60 sq ft — check the traced corners against the imagery.");
    }
    if (rect.widthFt > 0 && area / (rect.lengthFt * rect.widthFt) < 0.55) {
      gaps.push(
        "Outline fills less than 55% of its fitted rectangle — the derived grid frame is larger than the building.",
      );
    }
    measured.push({
      outline: item.outline,
      origin,
      footprintSqFt: Number(area.toFixed(2)),
      perimeterFt: Number(polygonPerimeterFt(local).toFixed(2)),
      fitLengthFt: Number(rect.lengthFt.toFixed(2)),
      fitWidthFt: Number(rect.widthFt.toFixed(2)),
      orientationDegrees: rect.azimuthDegrees,
      orientationLabel: orientationLabel(rect.azimuthDegrees),
      grid: deriveGrid(rect, cellFt),
      fitCorners: rect.corners.map((c) => fromLocalFeet(origin, c)),
      gaps,
    });
  });

  const buildings = measured
    .slice()
    .sort((a, b) => b.footprintSqFt - a.footprintSqFt)
    .map((item, i) => ({ ...item, tempName: `BLDG-${i + 1}`, sizeRank: i + 1 }));

  return { buildings, skipped };
}

/** Ray casting — is a lat/lng inside a traced outline? */
export function pointInOutline(point: LatLng, outline: LatLng[]): boolean {
  if (outline.length < 3) return false;
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i]!;
    const b = outline[j]!;
    const intersects =
      a.lat > point.lat !== b.lat > point.lat &&
      point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (intersects) inside = !inside;
  }
  return inside;
}

export interface ExistingStructure {
  name: string;
  /** Where the name is already used, e.g. "3 panel(s), 101 load(s)". */
  usedBy: string;
  /** Known footprint from an existing frozen plan, when the app has one. */
  knownLengthFt?: number | null;
  knownWidthFt?: number | null;
}

export interface StructureMatch {
  structure: ExistingStructure;
  /** How the suggestion was reached — never treated as confirmed. */
  basis: string;
  confidence: "exact_size" | "close_size" | "name_only";
  differenceNote: string;
}

/**
 * Suggest which already-named structure a traced building might be, using only
 * measured size. A suggestion is never applied automatically; the mapping is
 * recorded only when a person picks it.
 */
export function suggestStructure(
  building: Pick<DerivedBuilding, "fitLengthFt" | "fitWidthFt">,
  structures: ExistingStructure[],
): StructureMatch | null {
  let best: StructureMatch | null = null;
  let bestWorst = Number.POSITIVE_INFINITY;
  for (const structure of structures) {
    const l = structure.knownLengthFt ?? null;
    const w = structure.knownWidthFt ?? null;
    if (l === null || w === null) continue;
    const dl = Math.abs(building.fitLengthFt - l);
    const dw = Math.abs(building.fitWidthFt - w);
    const worst = Math.max(dl, dw);
    if (worst > 12 || worst >= bestWorst) continue;
    const confidence: StructureMatch["confidence"] = worst <= 3 ? "exact_size" : "close_size";
    bestWorst = worst;
    best = {
      structure,
      basis: `Measured ${building.fitLengthFt.toFixed(0)}′ × ${building.fitWidthFt.toFixed(0)}′ against the recorded ${l.toFixed(0)}′ × ${w.toFixed(0)}′`,
      confidence,
      differenceNote: `${dl.toFixed(1)}′ length / ${dw.toFixed(1)}′ width difference`,
    };
  }
  return best;
}
