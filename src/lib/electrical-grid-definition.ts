// Owner-defined site grid geometry.
//
// FarmOps used to plot every record from frozen design constants (the corrected
// 60 x 40 ft Farm Shop drawing, its A–F / 1–9 lines and the derived perimeter
// post ring). This module makes that geometry data instead of code: the site
// owner defines grid lines, posts and intervals in FarmOps, and every plot then
// resolves against the ACTIVE definition. The frozen design geometry stays as
// the fallback when no definition is loaded, so nothing silently loses a plot.
//
// This module never invents a position. Feet come from the definition rows only;
// a label that is not defined resolves to null.
import {
  NEW_COLS,
  NEW_ROWS,
  SHOP_DEPTH_FT,
  SHOP_WIDTH_FT,
} from "@/lib/electrical-grid-migration";

export type GridAxis = "COLUMN" | "ROW";
export type GridIntervalKind = "POST_SPAN" | "LINE_SPAN";
export type GridWall = "north" | "east" | "south" | "west";

export const GRID_AXES: GridAxis[] = ["ROW", "COLUMN"];
export const GRID_INTERVAL_KINDS: GridIntervalKind[] = ["POST_SPAN", "LINE_SPAN"];
export const GRID_WALLS: GridWall[] = ["north", "east", "south", "west"];

export const AXIS_LABEL: Record<GridAxis, string> = {
  ROW: "Row line (north → south)",
  COLUMN: "Column line (west → east)",
};

export const INTERVAL_KIND_LABEL: Record<GridIntervalKind, string> = {
  POST_SPAN: "Between two posts",
  LINE_SPAN: "Between two grid lines",
};

export interface GridLineDef {
  label: string;
  offsetFt: number;
  notes?: string | null;
}

export interface GridPostDef {
  ref: string;
  wall: GridWall | null;
  corner: boolean;
  xFt: number;
  yFt: number;
  notes?: string | null;
}

export interface GridIntervalDef {
  ref: string;
  kind: GridIntervalKind;
  fromRef: string;
  toRef: string;
  notes?: string | null;
}

export interface GridGeometry {
  definitionId: string;
  name: string;
  scopeNote: string | null;
  widthFt: number;
  depthFt: number;
  notes: string | null;
  /** Row lines, north → south, sorted by offset. */
  rows: GridLineDef[];
  /** Column lines, west → east, sorted by offset. */
  cols: GridLineDef[];
  posts: GridPostDef[];
  intervals: GridIntervalDef[];
  source: "SITE_DEFINITION" | "FROZEN_DESIGN";
}

const round = (n: number) => Math.round(n * 100) / 100;
const txt = (v: unknown) => (v == null ? "" : String(v)).trim();
const upper = (v: unknown) => txt(v).toUpperCase();

/** The pre-existing frozen design geometry — used until a definition is loaded. */
export const FROZEN_GEOMETRY: GridGeometry = {
  definitionId: "FROZEN-DESIGN",
  name: "Frozen corrected design drawing",
  scopeNote: "Farm Shop building envelope",
  widthFt: SHOP_WIDTH_FT,
  depthFt: SHOP_DEPTH_FT,
  notes:
    "Built into FarmOps from the corrected Farm Shop drawing. Used only while no site grid definition is active.",
  rows: NEW_ROWS.map((r) => ({ label: r.label, offsetFt: r.yFt })),
  cols: NEW_COLS.map((c) => ({ label: c.label, offsetFt: c.xFt })),
  posts: [],
  intervals: [],
  source: "FROZEN_DESIGN",
};

/* --------------------------------------------------------------- registry */

let ACTIVE: GridGeometry = FROZEN_GEOMETRY;

/** Installs the geometry every plot resolves against. `null` restores the frozen design. */
export function setActiveGridGeometry(geometry: GridGeometry | null): void {
  ACTIVE = geometry ?? FROZEN_GEOMETRY;
}

export function activeGridGeometry(): GridGeometry {
  return ACTIVE;
}

/* ------------------------------------------------------------ normalising */

export interface RawGridDefinition {
  definition_id?: unknown;
  name?: unknown;
  scope_note?: unknown;
  envelope_width_ft?: unknown;
  envelope_depth_ft?: unknown;
  notes?: unknown;
  lines?: { axis?: unknown; label?: unknown; offset_ft?: unknown; notes?: unknown }[];
  posts?: {
    post_ref?: unknown;
    wall?: unknown;
    is_corner?: unknown;
    x_ft?: unknown;
    y_ft?: unknown;
    notes?: unknown;
  }[];
  intervals?: {
    interval_ref?: unknown;
    kind?: unknown;
    from_ref?: unknown;
    to_ref?: unknown;
    notes?: unknown;
  }[];
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(txt(v));
  return Number.isFinite(n) ? round(n) : null;
};

/** Turns stored rows into a geometry object. Unusable rows are dropped, never guessed. */
export function normalizeGridDefinition(raw: RawGridDefinition): GridGeometry {
  const lines = raw.lines ?? [];
  const rows: GridLineDef[] = [];
  const cols: GridLineDef[] = [];
  for (const l of lines) {
    const label = upper(l.label);
    const offsetFt = num(l.offset_ft);
    if (!label || offsetFt == null) continue;
    const entry: GridLineDef = { label, offsetFt, notes: txt(l.notes) || null };
    if (upper(l.axis) === "ROW") rows.push(entry);
    else if (upper(l.axis) === "COLUMN") cols.push(entry);
  }
  const byOffset = (a: GridLineDef, b: GridLineDef) => a.offsetFt - b.offsetFt;

  const posts: GridPostDef[] = [];
  for (const p of raw.posts ?? []) {
    const ref = normalizePostToken(p.post_ref);
    const xFt = num(p.x_ft);
    const yFt = num(p.y_ft);
    if (!ref || xFt == null || yFt == null) continue;
    const wall = txt(p.wall).toLowerCase() as GridWall;
    posts.push({
      ref,
      wall: GRID_WALLS.includes(wall) ? wall : null,
      corner: p.is_corner === true,
      xFt,
      yFt,
      notes: txt(p.notes) || null,
    });
  }

  const intervals: GridIntervalDef[] = [];
  for (const i of raw.intervals ?? []) {
    const ref = upper(i.interval_ref);
    const kind = upper(i.kind) as GridIntervalKind;
    const fromRef = upper(i.from_ref);
    const toRef = upper(i.to_ref);
    if (!ref || !fromRef || !toRef || !GRID_INTERVAL_KINDS.includes(kind)) continue;
    intervals.push({ ref, kind, fromRef, toRef, notes: txt(i.notes) || null });
  }

  return {
    definitionId: txt(raw.definition_id) || "GRID-01",
    name: txt(raw.name) || "Site grid",
    scopeNote: txt(raw.scope_note) || null,
    widthFt: num(raw.envelope_width_ft) ?? SHOP_WIDTH_FT,
    depthFt: num(raw.envelope_depth_ft) ?? SHOP_DEPTH_FT,
    notes: txt(raw.notes) || null,
    rows: rows.sort(byOffset),
    cols: cols.sort(byOffset),
    posts: posts.sort((a, b) => a.ref.localeCompare(b.ref)),
    intervals: intervals.sort((a, b) => a.ref.localeCompare(b.ref)),
    source: "SITE_DEFINITION",
  };
}

/** `Post 06SE`, `POST 06SE` and `06SE` all name the same post. */
export function normalizePostToken(raw: unknown): string {
  return upper(raw).replace(/^POST\s+/, "");
}

/* ------------------------------------------------------------- validation */

export function validateGridGeometry(g: GridGeometry): string[] {
  const issues: string[] = [];
  if (!(g.widthFt > 0) || !(g.depthFt > 0))
    issues.push("The envelope needs a width and a depth greater than zero.");
  if (!g.rows.length) issues.push("Add at least one row line so records can plot north-to-south.");
  if (!g.cols.length) issues.push("Add at least one column line so records can plot west-to-east.");

  const dup = (labels: string[], what: string) => {
    const seen = new Set<string>();
    for (const l of labels) {
      if (seen.has(l)) issues.push(`${what} "${l}" is listed twice.`);
      seen.add(l);
    }
  };
  dup(
    g.rows.map((r) => r.label),
    "Row line",
  );
  dup(
    g.cols.map((c) => c.label),
    "Column line",
  );
  dup(
    g.posts.map((p) => p.ref),
    "Post",
  );
  dup(
    g.intervals.map((i) => i.ref),
    "Interval",
  );

  for (const r of g.rows)
    if (r.offsetFt > g.depthFt)
      issues.push(`Row ${r.label} at ${r.offsetFt} ft is past the ${g.depthFt} ft depth.`);
  for (const c of g.cols)
    if (c.offsetFt > g.widthFt)
      issues.push(`Column ${c.label} at ${c.offsetFt} ft is past the ${g.widthFt} ft width.`);
  for (const p of g.posts) {
    if (p.xFt < 0 || p.xFt > g.widthFt || p.yFt < 0 || p.yFt > g.depthFt)
      issues.push(`Post ${p.ref} at ${p.xFt} / ${p.yFt} ft is outside the envelope.`);
  }
  for (const i of g.intervals) {
    const ends = intervalEnds(g, i);
    if (!ends)
      issues.push(
        `Interval ${i.ref} points at ${i.fromRef} → ${i.toRef}, which are not both defined.`,
      );
  }
  return issues;
}

/* ---------------------------------------------------------------- lookups */

export function lineFeet(g: GridGeometry, axis: GridAxis, label: unknown): number | null {
  const key = upper(label);
  const list = axis === "ROW" ? g.rows : g.cols;
  return list.find((l) => l.label === key)?.offsetFt ?? null;
}

export function postFeet(g: GridGeometry, ref: unknown): GridPostDef | null {
  const key = normalizePostToken(ref);
  return g.posts.find((p) => p.ref === key) ?? null;
}

function endPoint(
  g: GridGeometry,
  kind: GridIntervalKind,
  ref: string,
): { xFt: number; yFt: number } | null {
  if (kind === "POST_SPAN") {
    const p = postFeet(g, ref);
    return p ? { xFt: p.xFt, yFt: p.yFt } : null;
  }
  const m = /^([A-Z]+)\s*([0-9]+)$/.exec(upper(ref));
  if (!m) return null;
  const yFt = lineFeet(g, "ROW", m[1]);
  const xFt = lineFeet(g, "COLUMN", m[2]);
  return xFt == null || yFt == null ? null : { xFt, yFt };
}

export function intervalEnds(
  g: GridGeometry,
  interval: GridIntervalDef,
): { from: { xFt: number; yFt: number }; to: { xFt: number; yFt: number } } | null {
  const from = endPoint(g, interval.kind, interval.fromRef);
  const to = endPoint(g, interval.kind, interval.toRef);
  return from && to ? { from, to } : null;
}

/**
 * Midpoint of a named interval. Intervals stay intervals: `spanned` is always
 * true so callers keep INTERVAL precision instead of claiming a measured point.
 */
export function intervalMidpoint(
  g: GridGeometry,
  ref: unknown,
): { xFt: number; yFt: number; spanned: true; interval: GridIntervalDef; basis: string } | null {
  const key = upper(ref);
  const interval = g.intervals.find((i) => i.ref === key);
  if (!interval) return null;
  const ends = intervalEnds(g, interval);
  if (!ends) return null;
  return {
    xFt: round((ends.from.xFt + ends.to.xFt) / 2),
    yFt: round((ends.from.yFt + ends.to.yFt) / 2),
    spanned: true,
    interval,
    basis: `Site-defined interval ${interval.ref} (${interval.fromRef} → ${interval.toRef}) — plotted at the interval midpoint, a derived rendering point, not a measured field X/Y.`,
  };
}

/** Human summary of the geometry a plot resolved against. */
export function geometryProvenance(g: GridGeometry): string {
  return g.source === "SITE_DEFINITION"
    ? `Site grid definition ${g.definitionId} — ${g.name} (${g.rows.length} row lines, ${g.cols.length} column lines, ${g.posts.length} posts, ${g.intervals.length} named intervals, ${g.widthFt} x ${g.depthFt} ft).`
    : `Frozen design drawing geometry (no site grid definition is active).`;
}
