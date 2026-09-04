import { describe, expect, it } from "vitest";
import {
  POST_GEOMETRY_AUDIT,
  POST_GEOMETRY_CONFIRMED,
  PROPOSED_POST_POSITIONS,
  auditPostGeometry,
} from "@/lib/electrical-grid-post-geometry";

describe("perimeter post geometry audit", () => {
  it("confirms all 26 callouts against the frozen 60 x 40 outline", () => {
    const a = auditPostGeometry();
    expect(a.postCount).toBe(26);
    expect(a.expectedPostCount).toBe(26);
    expect(a.ringLengthFt).toBe(200);
    expect(a.outline).toEqual({ widthFt: 60, depthFt: 40, perimeterFt: 200 });
    expect(a.issues).toEqual([]);
    expect(a.checks.filter((c) => !c.ok)).toEqual([]);
    expect(a.ok).toBe(true);
    expect(POST_GEOMETRY_CONFIRMED).toBe(true);
    expect(POST_GEOMETRY_AUDIT.ok).toBe(true);
  });

  it("keeps every post on the outline with the frozen wall spacing", () => {
    for (const c of POST_GEOMETRY_AUDIT.checks) {
      expect(c.offOutlineFt).toBe(0);
      // A corner post closes the previous wall, so its spacing is that wall's.
      expect([8, 7.5]).toContain(c.spacingFromPreviousFt);
      if (!c.corner) {
        expect(c.spacingFromPreviousFt).toBe(c.expectedSpacingFt);
      }
    }
  });

  it("fills in a real grid cell for every post", () => {
    for (const p of PROPOSED_POST_POSITIONS) {
      expect(p.gridCell).toMatch(/^[A-F](-[A-F])?[1-9](-[1-9])?$/);
    }
    const byRef = new Map(PROPOSED_POST_POSITIONS.map((p) => [p.ref, p.gridCell]));
    expect(byRef.get("01NE")).toBe("A9");
    expect(byRef.get("06SE")).toBe("F9");
    expect(byRef.get("14SW")).toBe("F1");
    expect(byRef.get("19NW")).toBe("A1");
  });
});
