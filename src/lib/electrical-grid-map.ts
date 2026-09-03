// Farm Shop grid map: pure geometry + circuit-class classification for the
// overview dot map. Read-only presentation logic — it never writes, and it never
// invents a coordinate, a panel relationship or an engineering value. When a
// fact is absent the point is reported as unplaced / unclassified instead.
import {
  NEW_COLS,
  NEW_ROWS,
  SHOP_DEPTH_FT,
  SHOP_WIDTH_FT,
  nearestNewCol,
  nearestNewRow,
  oldLetterToFeet,
  oldNumberToFeet,
  parseOldGrid,
} from "@/lib/electrical-grid-migration";

export const NOT_IN_RECORD = "NOT IN RECORD";

/** Existing app-wide large-load signal thresholds (see nameplate coverage). */
export const LARGE_LOAD_VA = 1920;
export const LARGE_LOAD_AMPS = 15;
/** A general-purpose branch circuit in this record set. */
export const STANDARD_BRANCH_AMPS = 20;

export type CircuitClass =
  | "LARGE_DEDICATED"
  | "DEDICATED_20A"
  | "SHARED"
  | "UNCLASSIFIED";

export const CLASS_META: Record<
  CircuitClass,
  { label: string; dot: string; ring: string; swatch: string }
> = {
  LARGE_DEDICATED: {
    label: "Large dedicated",
    dot: "bg-red-500",
    ring: "ring-red-500/40",
    swatch: "bg-red-500",
  },
  DEDICATED_20A: {
    label: "Dedicated 20 A",
    dot: "bg-orange-500",
    ring: "ring-orange-500/40",
    swatch: "bg-orange-500",
  },
  SHARED: {
    label: "Shared",
    dot: "bg-blue-500",
    ring: "ring-blue-500/40",
    swatch: "bg-blue-500",
  },
  UNCLASSIFIED: {
    label: "Not classified in record",
    dot: "bg-muted-foreground",
    ring: "ring-muted-foreground/40",
    swatch: "bg-muted-foreground",
  },
};

export const CLASS_ORDER: CircuitClass[] = [
  "LARGE_DEDICATED",
  "DEDICATED_20A",
  "SHARED",
  "UNCLASSIFIED",
];

export interface GridMapLoadInput {
  load_id: string;
  description: string | null;
  area: string | null;
  location: string | null;
  grid: string | null;
  legacy_grid: string | null;
  grid_reference: string | null;
  location_x_ft: number | null;
  location_y_ft: number | null;
  dedicated: boolean | null;
  dedicated_shared: string | null;
  circuit_group_ref: string | null;
  amps: number | null;
  volts: number | null;
  connected_va: number | null;
  design_circuit_ampacity: number | null;
  installed_ocp_rating: number | null;
  minimum_circuit_ampacity: number | null;
  maximum_overcurrent_protection: number | null;
  /** Resolved panel, when a proven or design-intent relationship exists. */
  panel: string | null;
  panelBasis: string | null;
}

export type CoordinateBasis =
  | "RECORDED_XY"
  | "DERIVED_FROM_LEGACY_GRID"
  | "UNPLACED";

export interface GridMapPoint {
  loadId: string;
  label: string;
  description: string;
  location: string;
  rawGrid: string;
  /** Percent of the plan envelope, west→east. */
  xPct: number | null;
  yPct: number | null;
  xFt: number | null;
  yFt: number | null;
  gridReference: string;
  coordinateBasis: CoordinateBasis;
  coordinateNote: string;
  klass: CircuitClass;
  classBasis: string;
  panel: string;
  panelBasis: string;
  amps: string;
  volts: string;
  /** Points that share the same coordinate, for fan-out placement. */
  stackIndex: number;
  stackSize: number;
}

const s = (v: unknown): string => (v == null ? "" : String(v).trim());
const n = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** D / S decision — record fields only, exactly as the business rules read them. */
export function dedicatedShared(row: GridMapLoadInput): "D" | "S" | "REVIEW" {
  const ds = s(row.dedicated_shared).toUpperCase();
  if (ds === "D" || ds === "DEDICATED") return "D";
  if (ds === "S" || ds === "SHARED") return "S";
  if (row.dedicated === true) return "D";
  if (row.dedicated === false) return "S";
  return "REVIEW";
}

/** Documented circuit rating, when the record actually states one. */
export function documentedRatingAmps(row: GridMapLoadInput): number | null {
  return (
    n(row.installed_ocp_rating) ??
    n(row.design_circuit_ampacity) ??
    n(row.maximum_overcurrent_protection)
  );
}

export function classifyCircuit(row: GridMapLoadInput): {
  klass: CircuitClass;
  basis: string;
} {
  const ds = dedicatedShared(row);
  if (ds === "S") {
    const grp = s(row.circuit_group_ref);
    return {
      klass: "SHARED",
      basis: grp
        ? `Shared circuit, circuit group ${grp}.`
        : "Shared circuit; circuit group is not in the record.",
    };
  }
  if (ds === "REVIEW") {
    return {
      klass: "UNCLASSIFIED",
      basis:
        "Dedicated/Shared is blank in the record, so the circuit class cannot be decided from this row.",
    };
  }

  const rating = documentedRatingAmps(row);
  if (rating != null) {
    return rating > STANDARD_BRANCH_AMPS
      ? {
          klass: "LARGE_DEDICATED",
          basis: `Dedicated circuit with a documented ${rating} A rating (above ${STANDARD_BRANCH_AMPS} A).`,
        }
      : {
          klass: "DEDICATED_20A",
          basis: `Dedicated circuit with a documented ${rating} A rating.`,
        };
  }

  // No documented circuit rating. Fall back to the same recorded size signals
  // the large-load nameplate scan already uses, and say so in the tooltip.
  const amps = n(row.amps);
  const va = n(row.connected_va);
  const mca = n(row.minimum_circuit_ampacity);
  const signals: string[] = [];
  if (amps != null && amps >= LARGE_LOAD_AMPS) signals.push(`${amps} A recorded`);
  if (mca != null && mca >= LARGE_LOAD_AMPS) signals.push(`MCA ${mca} A`);
  if (va != null && va >= LARGE_LOAD_VA) signals.push(`${va} VA connected`);
  if (signals.length) {
    return {
      klass: "LARGE_DEDICATED",
      basis: `Dedicated circuit; no documented circuit rating. Sized as large from recorded values: ${signals.join(", ")}.`,
    };
  }
  if (amps == null && va == null && mca == null) {
    return {
      klass: "UNCLASSIFIED",
      basis:
        "Dedicated circuit, but no circuit rating and no recorded current or VA, so the size cannot be stated.",
    };
  }
  return {
    klass: "DEDICATED_20A",
    basis: `Dedicated circuit; no documented circuit rating. Recorded values stay below the large-load signal (${LARGE_LOAD_AMPS} A / ${LARGE_LOAD_VA} VA), so it is shown on the standard ${STANDARD_BRANCH_AMPS} A branch class.`,
  };
}

export interface Placement {
  xFt: number | null;
  yFt: number | null;
  basis: CoordinateBasis;
  note: string;
  gridReference: string;
}

const NON_LOCATION = new Set(["", "NA", "N/A", "?", "??", "TBD", "0.00%", "0%", "MOBILE"]);

/** Grid label derived from feet, using the corrected (frozen) axis lines. */
export function derivedGridLabel(xFt: number, yFt: number): string {
  const row = nearestNewRow(yFt);
  const col = nearestNewCol(xFt);
  const rowLabel = row.tie && row.runnerUp ? `${row.label}-${row.runnerUp.label}` : row.label;
  const colLabel = col.tie && col.runnerUp ? `${col.label}-${col.runnerUp.label}` : col.label;
  return `${rowLabel}${colLabel}`;
}

/**
 * Physical position for a row. Recorded X/Y wins. Otherwise the legacy grid text
 * is transformed with the frozen old→new dictionaries. Non-location artifacts and
 * MOBILE stay unplaced — they are never snapped onto the plan.
 */
export function placeLoad(row: GridMapLoadInput): Placement {
  const x = n(row.location_x_ft);
  const y = n(row.location_y_ft);
  if (x != null && y != null) {
    return {
      xFt: x,
      yFt: y,
      basis: "RECORDED_XY",
      note: "Recorded physical position (feet from the west and north walls).",
      gridReference: s(row.grid_reference) || derivedGridLabel(x, y),
    };
  }

  const raw = s(row.grid) || s(row.legacy_grid);
  const upper = raw.toUpperCase();
  if (NON_LOCATION.has(upper)) {
    return {
      xFt: null,
      yFt: null,
      basis: "UNPLACED",
      note:
        upper === "MOBILE"
          ? "MOBILE — non-fixed equipment. No fixed position is assigned."
          : `Grid value "${raw || NOT_IN_RECORD}" is not a location, so no position is assigned.`,
      gridReference: raw || NOT_IN_RECORD,
    };
  }

  const parsed = parseOldGrid(raw);
  if (parsed.uninterpretable || parsed.letter == null || parsed.number == null) {
    return {
      xFt: null,
      yFt: null,
      basis: "UNPLACED",
      note: `Grid value "${raw || NOT_IN_RECORD}" cannot be interpreted on the previous grid, so no position is derived.`,
      gridReference: raw || NOT_IN_RECORD,
    };
  }
  const yFt = oldLetterToFeet(parsed.letter);
  const xFt = oldNumberToFeet(parsed.number);
  if (xFt == null || yFt == null) {
    return {
      xFt: null,
      yFt: null,
      basis: "UNPLACED",
      note: `Grid value "${raw}" falls outside the previous grid, so no position is derived.`,
      gridReference: raw,
    };
  }
  return {
    xFt,
    yFt,
    basis: "DERIVED_FROM_LEGACY_GRID",
    note: `Derived from legacy grid ${raw} through the frozen old→new transformation: ${xFt} ft east, ${yFt} ft south.`,
    gridReference: derivedGridLabel(xFt, yFt),
  };
}

/** Build the plotted points, fanning out overlapping coordinates so all dots show. */
export function buildGridMapPoints(rows: GridMapLoadInput[]): GridMapPoint[] {
  const staged = rows.map((row) => {
    const place = placeLoad(row);
    const { klass, basis } = classifyCircuit(row);
    return { row, place, klass, basis };
  });

  const buckets = new Map<string, number>();
  for (const item of staged) {
    if (item.place.xFt == null) continue;
    const key = `${item.place.xFt}:${item.place.yFt}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const seen = new Map<string, number>();

  return staged.map(({ row, place, klass, basis }) => {
    const key = place.xFt == null ? "" : `${place.xFt}:${place.yFt}`;
    const stackSize = key ? (buckets.get(key) ?? 1) : 1;
    const stackIndex = key ? (seen.get(key) ?? 0) : 0;
    if (key) seen.set(key, stackIndex + 1);

    const offset = fanOffset(stackIndex, stackSize);
    const xPct =
      place.xFt == null ? null : clampPct(((place.xFt + offset.dx) / SHOP_WIDTH_FT) * 100);
    const yPct =
      place.yFt == null ? null : clampPct(((place.yFt + offset.dy) / SHOP_DEPTH_FT) * 100);

    return {
      loadId: s(row.load_id) || NOT_IN_RECORD,
      label: s(row.description) || s(row.load_id) || NOT_IN_RECORD,
      description: s(row.description) || NOT_IN_RECORD,
      location: s(row.location) || NOT_IN_RECORD,
      rawGrid: s(row.grid) || s(row.legacy_grid) || NOT_IN_RECORD,
      xPct,
      yPct,
      xFt: place.xFt,
      yFt: place.yFt,
      gridReference: place.gridReference,
      coordinateBasis: place.basis,
      coordinateNote: place.note,
      klass,
      classBasis: basis,
      panel: s(row.panel) || NOT_IN_RECORD,
      panelBasis: s(row.panelBasis) || "No proven circuit → breaker → panel relationship in the record.",
      amps: n(row.amps) == null ? NOT_IN_RECORD : `${row.amps} A`,
      volts: n(row.volts) == null ? NOT_IN_RECORD : `${row.volts} V`,
      stackIndex,
      stackSize,
    };
  });
}

/** Spiral fan-out in feet so co-located loads stay individually hoverable. */
function fanOffset(index: number, size: number): { dx: number; dy: number } {
  if (size <= 1 || index === 0) return { dx: 0, dy: 0 };
  const ring = Math.ceil(index / 8);
  const slot = (index - 1) % 8;
  const angle = (slot / 8) * Math.PI * 2;
  const radius = 1.6 * ring;
  return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius };
}

const clampPct = (v: number): number => Math.min(99.2, Math.max(0.8, v));

export interface GridMapSummary {
  counts: Record<CircuitClass, number>;
  placed: number;
  unplaced: number;
  total: number;
}

export function summarizeGridMap(points: GridMapPoint[]): GridMapSummary {
  const counts: Record<CircuitClass, number> = {
    LARGE_DEDICATED: 0,
    DEDICATED_20A: 0,
    SHARED: 0,
    UNCLASSIFIED: 0,
  };
  let placed = 0;
  for (const p of points) {
    counts[p.klass] += 1;
    if (p.xPct != null && p.yPct != null) placed += 1;
  }
  return { counts, placed, unplaced: points.length - placed, total: points.length };
}

export const AXIS_ROWS = NEW_ROWS;
export const AXIS_COLS = NEW_COLS;
export { SHOP_DEPTH_FT, SHOP_WIDTH_FT };
