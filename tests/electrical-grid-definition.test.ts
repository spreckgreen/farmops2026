import { afterEach, describe, expect, it } from "vitest";
import {
  FROZEN_GEOMETRY,
  activeGridGeometry,
  intervalMidpoint,
  lineFeet,
  normalizeGridDefinition,
  postFeet,
  setActiveGridGeometry,
  validateGridGeometry,
} from "@/lib/electrical-grid-definition";
import { newGridFeet, parseNewGrid } from "@/lib/electrical-grid-operational";
import { proposedPostFeet } from "@/lib/electrical-grid-post-geometry";

const raw = {
  definition_id: "GRID-TEST",
  name: "Test grid",
  envelope_width_ft: 100,
  envelope_depth_ft: 50,
  lines: [
    { axis: "ROW", label: "N", offset_ft: 0 },
    { axis: "ROW", label: "M", offset_ft: 25 },
    { axis: "ROW", label: "S", offset_ft: 50 },
    { axis: "COLUMN", label: "1", offset_ft: 0 },
    { axis: "COLUMN", label: "2", offset_ft: 50 },
    { axis: "COLUMN", label: "3", offset_ft: 100 },
  ],
  posts: [
    { post_ref: "P1", wall: "north", is_corner: true, x_ft: 0, y_ft: 0 },
    { post_ref: "P2", wall: "north", is_corner: false, x_ft: 40, y_ft: 0 },
  ],
  intervals: [
    { interval_ref: "NORTH-RUN-01", kind: "POST_SPAN", from_ref: "P1", to_ref: "P2" },
    { interval_ref: "SPAN-A", kind: "LINE_SPAN", from_ref: "N1", to_ref: "S3" },
  ],
};

afterEach(() => setActiveGridGeometry(null));

describe("site grid definition", () => {
  it("normalizes and sorts the definition", () => {
    const g = normalizeGridDefinition(raw);
    expect(g.rows.map((r) => r.label)).toEqual(["N", "M", "S"]);
    expect(g.cols.map((c) => c.offsetFt)).toEqual([0, 50, 100]);
    expect(g.source).toBe("SITE_DEFINITION");
    expect(validateGridGeometry(g)).toEqual([]);
  });

  it("reports duplicate and out-of-envelope definitions", () => {
    const g = normalizeGridDefinition({
      ...raw,
      lines: [...raw.lines, { axis: "ROW", label: "N", offset_ft: 900 }],
    });
    const issues = validateGridGeometry(g);
    expect(issues.some((i) => i.includes("listed twice"))).toBe(true);
    expect(issues.some((i) => i.includes("past the 50 ft depth"))).toBe(true);
  });

  it("falls back to the frozen design geometry when nothing is active", () => {
    expect(activeGridGeometry()).toBe(FROZEN_GEOMETRY);
    expect(lineFeet(activeGridGeometry(), "COLUMN", "9")).toBe(60);
  });

  it("plots records from the site definition, not the design drawing", () => {
    setActiveGridGeometry(normalizeGridDefinition(raw));
    const parsed = parseNewGrid("M2");
    expect(parsed.ok).toBe(true);
    expect(newGridFeet(parsed)).toEqual({ xFt: 50, yFt: 25, span: false });
    // A label from the old drawing is no longer a defined cell.
    expect(parseNewGrid("A1").ok).toBe(false);
  });

  it("keeps interval precision for a defined interval and spans", () => {
    setActiveGridGeometry(normalizeGridDefinition(raw));
    const named = parseNewGrid("NORTH-RUN-01");
    expect(named).toMatchObject({ ok: true, interval: true, intervalRef: "NORTH-RUN-01" });
    expect(newGridFeet(named)).toEqual({ xFt: 20, yFt: 0, span: true });
    expect(intervalMidpoint(activeGridGeometry(), "SPAN-A")).toMatchObject({
      xFt: 50,
      yFt: 25,
      spanned: true,
    });
    const span = parseNewGrid("N-M1-2");
    expect(newGridFeet(span)).toEqual({ xFt: 25, yFt: 12.5, span: true });
  });

  it("prefers a site-defined post over the derived proposal", () => {
    setActiveGridGeometry(
      normalizeGridDefinition({
        ...raw,
        posts: [{ post_ref: "06SE", wall: "east", is_corner: true, x_ft: 12, y_ft: 34 }],
      }),
    );
    expect(postFeet(activeGridGeometry(), "Post 06SE")).toMatchObject({ xFt: 12, yFt: 34 });
    const post = proposedPostFeet("Post 06SE");
    expect(post).toMatchObject({ xFt: 12, yFt: 34 });
    expect(post?.basis).toContain("Site-defined post");
  });
});
