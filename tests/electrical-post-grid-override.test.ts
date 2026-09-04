import { describe, expect, it } from "vitest";
import { POST_GEOMETRY_AUDIT, POST_GEOMETRY_VERSION } from "@/lib/electrical-grid-post-geometry";
import {
  GRID_CELL_CHOICES,
  postGridRows,
  postGridUncertainty,
  validateOverrideDraft,
} from "@/lib/electrical-post-grid-override";

const check = (ref: string) => POST_GEOMETRY_AUDIT.checks.find((c) => c.ref === ref)!;

describe("post grid override — uncertainty", () => {
  it("reports no uncertainty for a clean, untied post", () => {
    expect(postGridUncertainty(check("01NE"))).toEqual({ uncertain: false, reasons: [] });
  });

  it("flags a tied derived cell as ambiguous", () => {
    const u = postGridUncertainty({ ...check("07SE"), gridCell: "A-B9" });
    expect(u.uncertain).toBe(true);
    expect(u.reasons[0]).toContain("tied");
  });

  it("flags an off-outline post and carries the audit issues through", () => {
    const u = postGridUncertainty({
      ...check("07SE"),
      offOutlineFt: 0.4,
      ok: false,
      issues: ["Not on the frozen outline (off by 0.4 ft)."],
    });
    expect(u.uncertain).toBe(true);
    expect(u.reasons).toContain("Not on the frozen outline (off by 0.4 ft).");
  });
});

describe("post grid override — rows", () => {
  it("shows the derived cell when no override is saved", () => {
    const rows = postGridRows();
    expect(rows).toHaveLength(POST_GEOMETRY_AUDIT.checks.length);
    const row = rows.find((r) => r.ref === "07SE")!;
    expect(row.effectiveGridCell).toBe("F8");
    expect(row.effectiveBasis).toBe("DERIVED_FROM_FROZEN_GEOMETRY");
    expect(row.override).toBeNull();
  });

  it("prefers a saved override without moving the coordinates", () => {
    const rows = postGridRows([
      {
        postRef: "07SE",
        overrideGridCell: "F7",
        derivedGridCell: "F8",
        geometryVersion: POST_GEOMETRY_VERSION,
        reconciliationNote: "Measured on site nearer column 7.",
        updatedAt: "2026-09-04T00:00:00Z",
      },
    ]);
    const row = rows.find((r) => r.ref === "07SE")!;
    expect(row.effectiveGridCell).toBe("F7");
    expect(row.effectiveBasis).toBe("MANUAL_OVERRIDE");
    expect({ xFt: row.xFt, yFt: row.yFt }).toEqual({ xFt: 52.5, yFt: 40 });
  });
});

describe("post grid override — validation", () => {
  it("accepts a different cell with a reconciliation note", () => {
    const r = validateOverrideDraft({ postRef: "07se", gridCell: "f7", note: "Field tape reads column 7." });
    expect(r).toMatchObject({
      ok: true,
      postRef: "07SE",
      gridCell: "F7",
      derivedGridCell: "F8",
      geometryVersion: POST_GEOMETRY_VERSION,
    });
  });

  it("rejects unknown posts, bad cells, restatements and thin notes", () => {
    expect(validateOverrideDraft({ postRef: "99XX", gridCell: "F7", note: "Long enough note." })).toMatchObject({
      ok: false,
    });
    expect(validateOverrideDraft({ postRef: "07SE", gridCell: "Z9", note: "Long enough note." })).toMatchObject({
      ok: false,
    });
    expect(validateOverrideDraft({ postRef: "07SE", gridCell: "F8", note: "Long enough note." })).toMatchObject({
      ok: false,
    });
    expect(validateOverrideDraft({ postRef: "07SE", gridCell: "F7", note: "short" })).toMatchObject({
      ok: false,
    });
    expect(validateOverrideDraft({ postRef: null, gridCell: null, note: null })).toMatchObject({ ok: false });
  });

  it("offers every row/column cell in the picker", () => {
    expect(GRID_CELL_CHOICES).toHaveLength(54);
    expect(GRID_CELL_CHOICES[0]).toBe("A1");
    expect(GRID_CELL_CHOICES.at(-1)).toBe("F9");
  });
});
