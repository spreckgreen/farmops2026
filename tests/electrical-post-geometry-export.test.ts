import { describe, expect, it } from "vitest";
import {
  buildPostGeometryExport,
  postGeometryExportCsv,
  postGeometryExportFilename,
  postGeometryExportJson,
} from "@/lib/electrical-post-geometry-export";
import { POST_GEOMETRY_VERSION } from "@/lib/electrical-grid-post-geometry";

const NOW = new Date("2026-09-04T16:50:00.000Z");

describe("post callout export", () => {
  it("exports all 26 confirmed posts with grid cells and audit metadata", () => {
    const r = buildPostGeometryExport(NOW);
    expect(r.posts).toHaveLength(26);
    expect(r.confirmed).toBe(true);
    expect(r.geometry_version).toBe(POST_GEOMETRY_VERSION);
    expect(r.audit).toMatchObject({
      post_count: 26,
      expected_post_count: 26,
      ring_length_ft: 200,
      posts_passing: 26,
      posts_failing: 0,
      audit_ok: true,
      audit_issues: [],
    });
    expect(r.outline).toMatchObject({ widthFt: 60, depthFt: 40, perimeterFt: 200 });
    expect(r.generated_at).toBe(NOW.toISOString());
    for (const p of r.posts) {
      expect(p.grid_cell).toMatch(/^[A-F][1-9]$/);
      expect(p.basis.length).toBeGreaterThan(0);
      expect(p.check_ok).toBe(true);
    }
  });

  it("carries the corner posts and their final grid cells", () => {
    const by = new Map(buildPostGeometryExport(NOW).posts.map((p) => [p.ref, p]));
    expect(by.get("01NE")).toMatchObject({ x_ft: 60, y_ft: 0, grid_cell: "A9", corner: true });
    expect(by.get("06SE")).toMatchObject({ x_ft: 60, y_ft: 40, grid_cell: "F9", corner: true });
    expect(by.get("14SW")).toMatchObject({ x_ft: 0, y_ft: 40, grid_cell: "F1", corner: true });
    expect(by.get("19NW")).toMatchObject({ x_ft: 0, y_ft: 0, grid_cell: "A1", corner: true });
  });

  it("writes a self-describing CSV with one row per post", () => {
    const csv = postGeometryExportCsv(NOW);
    const lines = csv.trim().split("\r\n");
    const meta = lines.filter((l) => l.startsWith("#"));
    expect(meta.some((l) => l.startsWith("# geometry_version,"))).toBe(true);
    expect(meta.some((l) => l === "# audit_ok,true")).toBe(true);
    const header = lines[meta.length]!;
    expect(header).toBe(
      "ref,wall,corner,x_ft,y_ft,grid_cell,off_outline_ft,spacing_from_previous_ft,expected_spacing_ft,check_ok,issues,basis",
    );
    expect(lines.length - meta.length - 1).toBe(26);
    expect(lines[meta.length + 1]!.startsWith("01NE,")).toBe(true);
    // Any comma inside a basis sentence must be quoted, not split into a column.
    for (const row of lines.slice(meta.length + 1)) {
      const outsideQuotes = row.replace(/"(?:[^"]|"")*"/g, "");
      expect(outsideQuotes.split(",")).toHaveLength(12);
    }
  });

  it("emits valid JSON and timestamped filenames", () => {
    expect(JSON.parse(postGeometryExportJson(NOW)).posts).toHaveLength(26);
    expect(postGeometryExportFilename("csv", NOW)).toBe(
      `farm-shop-post-callouts-${POST_GEOMETRY_VERSION}-2026-09-04-16-50-00.csv`,
    );
    expect(postGeometryExportFilename("json", NOW).endsWith(".json")).toBe(true);
  });
});
