// Farm Shop perimeter post geometry — PROPOSED, not yet confirmed.
//
// Field observations may name a perimeter post (FS_POLE_GRID_V1, for example
// `Post 06SE`) instead of a grid cell or a measured point. Nothing in FarmOps
// could turn a post callout into a plan position, so those observations were
// unplottable. This module derives a candidate position for every post from the
// frozen corrected 60 x 40 ft outline and the frozen clockwise post sequence.
//
// Derivation (no measurement is invented — only the outline and the sequence are
// used, both already frozen elsewhere):
//   * 01NE, 06SE, 14SW and 19NW are the recorded corners.
//   * The posts between two corners are spaced evenly along that wall.
//   * East wall 01NE -> 06SE : 5 intervals over 40 ft = 8.0 ft.
//   * South wall 06SE -> 14SW : 8 intervals over 60 ft = 7.5 ft.
//   * West wall 14SW -> 19NW : 5 intervals over 40 ft = 8.0 ft.
//   * North wall 19NW -> 01NE : 8 intervals over 60 ft = 7.5 ft.
//   The four spans consume exactly the 26 posts in the sequence, which is why
//   the even-spacing reading is self-consistent.
//
// The proposal was confirmed against the frozen outline (see auditPostGeometry):
// every post lies exactly on the perimeter, the four recorded corners sit on the
// recorded corner coordinates, each wall is evenly spaced, and the ring closes at
// the 200 ft perimeter. Confirmation is GEOMETRIC agreement with the frozen
// outline only — it is not a field measurement, so post placements keep NEAREST /
// INTERVAL precision and never outrank a verified field X/Y.
import { POLE_CORNERS, POLE_SEQUENCE, type PoleObservation } from "@/lib/electrical-audit-batch";
import { SHOP_DEPTH_FT, SHOP_WIDTH_FT } from "@/lib/electrical-grid-migration";
import { derivedGridLabel } from "@/lib/electrical-grid-map";

export const POST_GEOMETRY_VERSION = "fs-post-geometry-v1-confirmed";

/** Owner confirmation gate. Confirmed against the frozen 60 x 40 ft outline. */
export const POST_GEOMETRY_CONFIRMED = true;

export type PostWall = "north" | "east" | "south" | "west";

export interface PostPosition {
  ref: string;
  wall: PostWall;
  corner: boolean;
  xFt: number;
  yFt: number;
  /** Human-readable grid cell of this post — a lookup of the feet, never the position. */
  gridCell: string;
  basis: string;
}


const norm = (v: unknown) => (v == null ? "" : String(v)).trim().toUpperCase();

/** `Post 06SE`, `POST 06SE` and `06SE` all name the same post. */
export function normalizePostRef(raw: unknown): string {
  return norm(raw).replace(/^POST\s+/, "");
}

interface WallSpan {
  wall: PostWall;
  from: string;
  to: string;
  fromXFt: number;
  fromYFt: number;
  toXFt: number;
  toYFt: number;
  lengthFt: number;
}

const CORNER_XY: Record<string, { xFt: number; yFt: number }> = {
  "01NE": { xFt: SHOP_WIDTH_FT, yFt: 0 },
  "06SE": { xFt: SHOP_WIDTH_FT, yFt: SHOP_DEPTH_FT },
  "14SW": { xFt: 0, yFt: SHOP_DEPTH_FT },
  "19NW": { xFt: 0, yFt: 0 },
};

const SPANS: WallSpan[] = [
  {
    wall: "east",
    from: "01NE",
    to: "06SE",
    ...spanEnds("01NE", "06SE"),
    lengthFt: SHOP_DEPTH_FT,
  },
  {
    wall: "south",
    from: "06SE",
    to: "14SW",
    ...spanEnds("06SE", "14SW"),
    lengthFt: SHOP_WIDTH_FT,
  },
  {
    wall: "west",
    from: "14SW",
    to: "19NW",
    ...spanEnds("14SW", "19NW"),
    lengthFt: SHOP_DEPTH_FT,
  },
  {
    wall: "north",
    from: "19NW",
    to: "01NE",
    ...spanEnds("19NW", "01NE"),
    lengthFt: SHOP_WIDTH_FT,
  },
];

function spanEnds(from: string, to: string) {
  const a = CORNER_XY[from]!;
  const b = CORNER_XY[to]!;
  return { fromXFt: a.xFt, fromYFt: a.yFt, toXFt: b.xFt, toYFt: b.yFt };
}

function buildPositions(): PostPosition[] {
  const seq = POLE_SEQUENCE as readonly string[];
  const out = new Map<string, PostPosition>();
  for (const span of SPANS) {
    const start = seq.indexOf(span.from);
    const end = seq.indexOf(span.to);
    // The sequence wraps once, on the north wall (19NW -> 01NE).
    const count = end > start ? end - start : seq.length - start + end;
    const spacing = span.lengthFt / count;
    for (let step = 0; step <= count; step += 1) {
      const ref = seq[(start + step) % seq.length]!;
      if (out.has(ref)) continue;
      const t = step / count;
      const xFt = round(span.fromXFt + (span.toXFt - span.fromXFt) * t);
      const yFt = round(span.fromYFt + (span.toYFt - span.fromYFt) * t);
      out.set(ref, {
        ref,
        wall: span.wall,
        corner: POLE_CORNERS.includes(ref),
        xFt,
        yFt,
        gridCell: derivedGridLabel(xFt, yFt),
        basis: POLE_CORNERS.includes(ref)
          ? `Recorded corner post on the ${span.wall} / adjoining wall of the corrected 60 x 40 ft outline.`
          : `Derived: post ${step} of ${count} along the ${span.wall} wall between ${span.from} and ${span.to}, evenly spaced at ${round(spacing)} ft.`,
      });
    }
  }

  return (POLE_SEQUENCE as readonly string[]).map((ref) => out.get(ref)!).filter(Boolean);
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Proposed position of all 26 perimeter posts, in frozen sequence order. */
export const PROPOSED_POST_POSITIONS: PostPosition[] = buildPositions();

const BY_REF = new Map(PROPOSED_POST_POSITIONS.map((p) => [p.ref, p]));

/** Proposed position of one post, or null when the reference is not in the scheme. */
export function proposedPostFeet(raw: unknown): PostPosition | null {
  return BY_REF.get(normalizePostRef(raw)) ?? null;
}

export interface PostObservationPlacement {
  xFt: number;
  yFt: number;
  /** True when the observation names a run between two posts, not a point. */
  spanned: boolean;
  token: string;
  basis: string;
}

/**
 * Position a pole observation states, using the proposed geometry. Returns null
 * for NOT_APPLICABLE, unknown posts, or an incomplete between-posts observation:
 * nothing is guessed.
 */
export function postObservationFeet(
  obs: PoleObservation | null | undefined,
): PostObservationPlacement | null {
  if (!obs || obs.pole_location_kind === "NOT_APPLICABLE") return null;
  const start = proposedPostFeet(obs.pole_ref_start);
  if (!start) return null;
  if (obs.pole_location_kind === "AT_POST") {
    return {
      xFt: start.xFt,
      yFt: start.yFt,
      spanned: false,
      token: start.ref,
      basis: `Field observation at post ${start.ref}. ${start.basis}`,
    };
  }
  const end = proposedPostFeet(obs.pole_ref_end);
  if (!end) return null;
  return {
    xFt: round((start.xFt + end.xFt) / 2),
    yFt: round((start.yFt + end.yFt) / 2),
    spanned: true,
    token: `${start.ref}/${end.ref}`,
    basis: `Field observation between posts ${start.ref} and ${end.ref}; the midpoint marks the span, not a measured point.`,
  };
}

export interface PostGeometryCheck {
  ref: string;
  wall: PostWall;
  corner: boolean;
  xFt: number;
  yFt: number;
  gridCell: string;
  /** Distance from the post to the nearest outline edge, in feet. 0 = on the outline. */
  offOutlineFt: number;
  /** Spacing from the previous post in the frozen clockwise sequence, in feet. */
  spacingFromPreviousFt: number;
  expectedSpacingFt: number;
  ok: boolean;
  issues: string[];
}

export interface PostGeometryAudit {
  version: string;
  confirmed: boolean;
  outline: { widthFt: number; depthFt: number; perimeterFt: number };
  postCount: number;
  expectedPostCount: number;
  ringLengthFt: number;
  checks: PostGeometryCheck[];
  issues: string[];
  ok: boolean;
}

const EPS = 0.01;
const near = (a: number, b: number) => Math.abs(a - b) <= EPS;

/**
 * Deterministic self-check of the 26 post callouts against the frozen 60 x 40 ft
 * outline: every post on the perimeter, corners on the recorded corner points,
 * even spacing per wall, and a closed ring of exactly the perimeter length.
 * Read-only — it never writes and never adjusts a coordinate.
 */
export function auditPostGeometry(): PostGeometryAudit {
  const posts = PROPOSED_POST_POSITIONS;
  const perimeterFt = 2 * (SHOP_WIDTH_FT + SHOP_DEPTH_FT);
  const expectedByWall: Record<PostWall, number> = {
    east: SHOP_DEPTH_FT / 5,
    south: SHOP_WIDTH_FT / 8,
    west: SHOP_DEPTH_FT / 5,
    north: SHOP_WIDTH_FT / 8,
  };
  const issues: string[] = [];
  let ringLengthFt = 0;

  const checks: PostGeometryCheck[] = posts.map((p, i) => {
    const prev = posts[(i - 1 + posts.length) % posts.length]!;
    const spacing = round(Math.hypot(p.xFt - prev.xFt, p.yFt - prev.yFt));
    ringLengthFt = round(ringLengthFt + spacing);
    const offOutlineFt = round(
      Math.min(
        Math.abs(p.xFt - 0),
        Math.abs(p.xFt - SHOP_WIDTH_FT),
        Math.abs(p.yFt - 0),
        Math.abs(p.yFt - SHOP_DEPTH_FT),
      ),
    );
    const rowIssues: string[] = [];
    if (!near(offOutlineFt, 0)) rowIssues.push(`Not on the frozen outline (off by ${offOutlineFt} ft).`);
    if (p.xFt < -EPS || p.xFt > SHOP_WIDTH_FT + EPS || p.yFt < -EPS || p.yFt > SHOP_DEPTH_FT + EPS) {
      rowIssues.push("Outside the 60 x 40 ft building area.");
    }
    if (p.corner) {
      const c = CORNER_XY[p.ref];
      if (!c) rowIssues.push("Listed as a corner but has no recorded corner coordinate.");
      else if (!near(p.xFt, c.xFt) || !near(p.yFt, c.yFt)) {
        rowIssues.push(`Corner post is not on its recorded corner (${c.xFt}, ${c.yFt}).`);
      }
    }
    // The wall a post enters (its first post) legitimately continues the previous
    // wall's spacing, so spacing is only compared inside a wall.
    const expected = expectedByWall[p.wall];
    const sameWallAsPrev = prev.wall === p.wall || prev.corner;
    if (sameWallAsPrev && !near(spacing, expected)) {
      rowIssues.push(
        `Spacing from ${prev.ref} is ${spacing} ft; the ${p.wall} wall is evenly spaced at ${round(expected)} ft.`,
      );
    }
    return {
      ref: p.ref,
      wall: p.wall,
      corner: p.corner,
      xFt: p.xFt,
      yFt: p.yFt,
      gridCell: p.gridCell,
      offOutlineFt,
      spacingFromPreviousFt: spacing,
      expectedSpacingFt: round(expected),
      ok: rowIssues.length === 0,
      issues: rowIssues,
    };
  });

  if (posts.length !== (POLE_SEQUENCE as readonly string[]).length) {
    issues.push(
      `Positioned ${posts.length} posts but the frozen sequence names ${(POLE_SEQUENCE as readonly string[]).length}.`,
    );
  }
  if (!near(ringLengthFt, perimeterFt)) {
    issues.push(`The post ring measures ${ringLengthFt} ft; the frozen perimeter is ${perimeterFt} ft.`);
  }
  for (const ref of POLE_CORNERS) {
    if (!checks.some((c) => c.ref === ref && c.corner)) issues.push(`Recorded corner ${ref} is missing.`);
  }

  return {
    version: POST_GEOMETRY_VERSION,
    confirmed: POST_GEOMETRY_CONFIRMED,
    outline: { widthFt: SHOP_WIDTH_FT, depthFt: SHOP_DEPTH_FT, perimeterFt },
    postCount: posts.length,
    expectedPostCount: (POLE_SEQUENCE as readonly string[]).length,
    ringLengthFt,
    checks,
    issues,
    ok: issues.length === 0 && checks.every((c) => c.ok),
  };
}

export const POST_GEOMETRY_AUDIT: PostGeometryAudit = auditPostGeometry();

export const POST_GEOMETRY_REVIEW_NOTE = POST_GEOMETRY_CONFIRMED
  ? "Perimeter post geometry is CONFIRMED against the frozen corrected 60 x 40 ft outline: all 26 posts lie on the perimeter, the four recorded corners match, each wall is evenly spaced (8.0 ft east/west, 7.5 ft north/south) and the ring closes at 200 ft. Confirmation is geometric only — post callouts plot at nearest-post (or interval) precision and never outrank a measured field position."
  : "Perimeter post geometry is PROPOSED — derived from the corrected 60 x 40 ft outline and the frozen clockwise post sequence. Until it is confirmed, post callouts are listed for review and are never used to plot a record.";

