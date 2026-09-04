// Post callout export — read-only report of the 26 confirmed perimeter posts with
// their final grid cells and the audit metadata behind them.
//
// Pure builders: they serialize what auditPostGeometry() already derived from the
// frozen 60 x 40 ft outline. Nothing here measures, adjusts or writes a coordinate,
// and the grid cell is carried as the human-readable lookup of the feet, never as
// the position itself.
import {
  POST_GEOMETRY_AUDIT,
  POST_GEOMETRY_CONFIRMED,
  POST_GEOMETRY_REVIEW_NOTE,
  POST_GEOMETRY_VERSION,
  PROPOSED_POST_POSITIONS,
  type PostGeometryAudit,
} from "@/lib/electrical-grid-post-geometry";

export interface PostExportRow {
  ref: string;
  wall: string;
  corner: boolean;
  x_ft: number;
  y_ft: number;
  grid_cell: string;
  off_outline_ft: number;
  spacing_from_previous_ft: number;
  expected_spacing_ft: number;
  check_ok: boolean;
  issues: string;
  basis: string;
}

export interface PostGeometryExport {
  report: "farmops.electrical.post-geometry.v1";
  generated_at: string;
  geometry_version: string;
  confirmed: boolean;
  confirmation_basis: string;
  precision: string;
  outline: PostGeometryAudit["outline"];
  audit: {
    post_count: number;
    expected_post_count: number;
    ring_length_ft: number;
    posts_passing: number;
    posts_failing: number;
    audit_ok: boolean;
    audit_issues: string[];
  };
  posts: PostExportRow[];
}

const CSV_COLUMNS: (keyof PostExportRow)[] = [
  "ref",
  "wall",
  "corner",
  "x_ft",
  "y_ft",
  "grid_cell",
  "off_outline_ft",
  "spacing_from_previous_ft",
  "expected_spacing_ft",
  "check_ok",
  "issues",
  "basis",
];

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per post, in the frozen clockwise sequence, with its audit result. */
export function buildPostGeometryExport(now: Date = new Date()): PostGeometryExport {
  const audit = POST_GEOMETRY_AUDIT;
  const basisByRef = new Map(PROPOSED_POST_POSITIONS.map((p) => [p.ref, p.basis]));
  const posts: PostExportRow[] = audit.checks.map((c) => ({
    ref: c.ref,
    wall: c.wall,
    corner: c.corner,
    x_ft: c.xFt,
    y_ft: c.yFt,
    grid_cell: c.gridCell,
    off_outline_ft: c.offOutlineFt,
    spacing_from_previous_ft: c.spacingFromPreviousFt,
    expected_spacing_ft: c.expectedSpacingFt,
    check_ok: c.ok,
    issues: c.issues.join(" | "),
    basis: basisByRef.get(c.ref) ?? "",
  }));
  const failing = posts.filter((p) => !p.check_ok).length;
  return {
    report: "farmops.electrical.post-geometry.v1",
    generated_at: now.toISOString(),
    geometry_version: POST_GEOMETRY_VERSION,
    confirmed: POST_GEOMETRY_CONFIRMED,
    confirmation_basis: POST_GEOMETRY_REVIEW_NOTE,
    precision:
      "Post callouts plot at nearest-post (or interval) precision. They never outrank a measured field X/Y and the grid cell is a lookup of the feet.",
    outline: audit.outline,
    audit: {
      post_count: audit.postCount,
      expected_post_count: audit.expectedPostCount,
      ring_length_ft: audit.ringLengthFt,
      posts_passing: posts.length - failing,
      posts_failing: failing,
      audit_ok: audit.ok,
      audit_issues: audit.issues,
    },
    posts,
  };
}

export function postGeometryExportJson(now?: Date): string {
  return `${JSON.stringify(buildPostGeometryExport(now), null, 2)}\n`;
}

/**
 * CSV with the audit metadata as leading `#` comment lines so the report stays
 * self-describing when it is opened in a spreadsheet.
 */
export function postGeometryExportCsv(now?: Date): string {
  const r = buildPostGeometryExport(now);
  const meta = [
    `# report,${r.report}`,
    `# generated_at,${r.generated_at}`,
    `# geometry_version,${r.geometry_version}`,
    `# confirmed,${r.confirmed}`,
    `# outline_ft,${r.outline.widthFt} x ${r.outline.depthFt}`,
    `# perimeter_ft,${r.outline.perimeterFt}`,
    `# ring_length_ft,${r.audit.ring_length_ft}`,
    `# posts,${r.audit.post_count} of ${r.audit.expected_post_count}`,
    `# posts_passing,${r.audit.posts_passing}`,
    `# posts_failing,${r.audit.posts_failing}`,
    `# audit_ok,${r.audit.audit_ok}`,
    `# audit_issues,${cell(r.audit.audit_issues.join(" | ")).replace(/^"|"$/g, "")}`,
    `# precision,${r.precision.replace(/,/g, ";")}`,
  ];
  const rows = r.posts.map((p) => CSV_COLUMNS.map((k) => cell(p[k])).join(","));
  return [...meta, CSV_COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}

export function postGeometryExportFilename(kind: "json" | "csv", now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `farm-shop-post-callouts-${POST_GEOMETRY_VERSION}-${stamp}.${kind}`;
}
