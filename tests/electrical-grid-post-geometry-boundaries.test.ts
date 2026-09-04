import { describe, expect, it } from "vitest";
import { POLE_CORNERS, POLE_SEQUENCE } from "@/lib/electrical-audit-batch";
import { derivedGridLabel } from "@/lib/electrical-grid-map";
import {
  POST_GEOMETRY_AUDIT,
  PROPOSED_POST_POSITIONS,
  postObservationFeet,
  proposedPostFeet,
} from "@/lib/electrical-grid-post-geometry";

const W = 60;
const D = 40;
const onEast = (p: { xFt: number }) => p.xFt === W;
const onWest = (p: { xFt: number }) => p.xFt === 0;
const onNorth = (p: { yFt: number }) => p.yFt === 0;
const onSouth = (p: { yFt: number }) => p.yFt === D;

describe("post geometry — outline boundaries", () => {
  it("keeps every post inside the frozen 60 x 40 envelope", () => {
    for (const p of PROPOSED_POST_POSITIONS) {
      expect(p.xFt).toBeGreaterThanOrEqual(0);
      expect(p.xFt).toBeLessThanOrEqual(W);
      expect(p.yFt).toBeGreaterThanOrEqual(0);
      expect(p.yFt).toBeLessThanOrEqual(D);
    }
  });

  it("puts corner posts on exactly two walls and every other post on exactly one", () => {
    for (const p of PROPOSED_POST_POSITIONS) {
      const edges = [onEast(p), onWest(p), onNorth(p), onSouth(p)].filter(Boolean).length;
      expect(edges).toBe(POLE_CORNERS.includes(p.ref) ? 2 : 1);
    }
  });

  it("pins the four corners to their exact corner coordinates and cells", () => {
    expect(proposedPostFeet("01NE")).toMatchObject({ xFt: W, yFt: 0, gridCell: "A9", corner: true });
    expect(proposedPostFeet("06SE")).toMatchObject({ xFt: W, yFt: D, gridCell: "F9", corner: true });
    expect(proposedPostFeet("14SW")).toMatchObject({ xFt: 0, yFt: D, gridCell: "F1", corner: true });
    expect(proposedPostFeet("19NW")).toMatchObject({ xFt: 0, yFt: 0, gridCell: "A1", corner: true });
  });

  it("walks each wall monotonically with the frozen spacing and no float drift", () => {
    const by = new Map(PROPOSED_POST_POSITIONS.map((p) => [p.ref, p]));
    const walls: { refs: string[]; axis: "x" | "y"; step: number; from: number }[] = [
      { refs: ["01NE", "02NE", "03NE", "04SE", "05SE", "06SE"], axis: "y", step: 8, from: 0 },
      {
        refs: ["06SE", "07SE", "08SE", "09SE", "10S", "11S", "12SW", "13SW", "14SW"],
        axis: "x",
        step: -7.5,
        from: W,
      },
      { refs: ["14SW", "15SW", "16SW", "17NW", "18NW", "19NW"], axis: "y", step: -8, from: D },
      {
        refs: ["19NW", "20NW", "21NW", "22N", "23N", "24NE", "25NE", "26NE", "01NE"],
        axis: "x",
        step: 7.5,
        from: 0,
      },
    ];
    for (const wall of walls) {
      wall.refs.forEach((ref, i) => {
        const p = by.get(ref)!;
        const value = wall.axis === "x" ? p.xFt : p.yFt;
        // Exact equality: the audit must not lean on its 0.01 ft tolerance.
        expect(value).toBe(wall.from + wall.step * i);
      });
    }
  });

  it("holds the audit at zero off-outline distance with exact spacing", () => {
    for (const c of POST_GEOMETRY_AUDIT.checks) {
      expect(c.offOutlineFt).toBe(0);
      expect(Math.abs(c.spacingFromPreviousFt - c.expectedSpacingFt)).toBeLessThanOrEqual(
        c.corner ? 0.5 : 0,
      );
    }
    const sum = POST_GEOMETRY_AUDIT.checks.reduce((t, c) => t + c.spacingFromPreviousFt, 0);
    expect(Math.round(sum * 100) / 100).toBe(200);
  });

  it("lands every post on an unambiguous grid cell (no tied axis label)", () => {
    for (const p of PROPOSED_POST_POSITIONS) {
      expect(p.gridCell).toMatch(/^[A-F][1-9]$/);
      expect(p.gridCell).toBe(derivedGridLabel(p.xFt, p.yFt));
    }
  });
});

describe("grid label — tie tolerance thresholds", () => {
  it("labels a point exactly on an axis line without a tie", () => {
    expect(derivedGridLabel(0, 0)).toBe("A1");
    expect(derivedGridLabel(W, D)).toBe("F9");
    expect(derivedGridLabel(56, 8)).toBe("B8");
  });

  it("ties only inside the 0.5 ft equidistance window", () => {
    // Midway between rows A (0) and B (8): 4 / 4 — tie.
    expect(derivedGridLabel(0, 4)).toBe("A-B1");
    // 3.75 ft: 3.75 vs 4.25, difference exactly 0.5 — still a tie.
    expect(derivedGridLabel(0, 3.75)).toBe("A-B1");
    // 3.7 ft: difference 0.6 — resolves to the nearer row.
    expect(derivedGridLabel(0, 3.7)).toBe("A1");
    // Same thresholds on the column axis (lines 0 and 8).
    expect(derivedGridLabel(4, 0)).toBe("A1-2");
    expect(derivedGridLabel(3.75, 0)).toBe("A1-2");
    expect(derivedGridLabel(3.7, 0)).toBe("A1");
  });

  it("does not tie across the narrow 56 → 60 ft column pair beyond tolerance", () => {
    expect(derivedGridLabel(58, 0)).toBe("A8-9");
    expect(derivedGridLabel(59.5, 0)).toBe("A9");
  });

  it("clamps points beyond the envelope to the outermost lines", () => {
    expect(derivedGridLabel(-5, -5)).toBe("A1");
    expect(derivedGridLabel(120, 90)).toBe("F9");
  });
});

describe("post observations — near-edge and wrap cases", () => {
  it("keeps a same-wall span on that wall", () => {
    expect(
      postObservationFeet({
        pole_location_kind: "BETWEEN_POSTS",
        pole_ref_start: "05SE",
        pole_ref_end: "06SE",
      }),
    ).toMatchObject({ xFt: W, yFt: 36, spanned: true, token: "05SE/06SE" });
  });

  it("cuts the corner for a span that turns at 06SE", () => {
    expect(
      postObservationFeet({
        pole_location_kind: "BETWEEN_POSTS",
        pole_ref_start: "06SE",
        pole_ref_end: "07SE",
      }),
    ).toMatchObject({ xFt: 56.25, yFt: D, spanned: true });
  });

  it("handles the 26NE → 01NE sequence wrap on the north wall", () => {
    expect(
      postObservationFeet({
        pole_location_kind: "BETWEEN_POSTS",
        pole_ref_start: "26NE",
        pole_ref_end: "01NE",
      }),
    ).toMatchObject({ xFt: 56.25, yFt: 0, spanned: true });
  });

  it("still marks a degenerate same-post span as spanned, at that post", () => {
    expect(
      postObservationFeet({
        pole_location_kind: "BETWEEN_POSTS",
        pole_ref_start: "14SW",
        pole_ref_end: "14SW",
      }),
    ).toMatchObject({ xFt: 0, yFt: D, spanned: true, token: "14SW/14SW" });
  });

  it("marks an at-post observation as a point, not a span", () => {
    for (const ref of POLE_SEQUENCE as readonly string[]) {
      const at = postObservationFeet({ pole_location_kind: "AT_POST", pole_ref_start: ref });
      const post = proposedPostFeet(ref)!;
      expect(at).toMatchObject({ xFt: post.xFt, yFt: post.yFt, spanned: false, token: ref });
    }
  });

  it("returns nothing rather than guessing for bad or missing references", () => {
    expect(proposedPostFeet("")).toBeNull();
    expect(proposedPostFeet(null)).toBeNull();
    expect(proposedPostFeet(27)).toBeNull();
    expect(proposedPostFeet("1NE")).toBeNull();
    expect(proposedPostFeet("06SE ")).toMatchObject({ xFt: W, yFt: D });
    expect(proposedPostFeet("post 06se")).toMatchObject({ xFt: W, yFt: D });
    expect(
      postObservationFeet({ pole_location_kind: "AT_POST", pole_ref_start: "99XX" }),
    ).toBeNull();
    expect(
      postObservationFeet({
        pole_location_kind: "BETWEEN_POSTS",
        pole_ref_start: "01NE",
        pole_ref_end: "99XX",
      }),
    ).toBeNull();
    expect(postObservationFeet(null)).toBeNull();
  });
});
