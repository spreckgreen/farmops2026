import { describe, expect, it } from "vitest";
import { migrateRow, type MigrationInputRow } from "@/lib/electrical-grid-migration";
import {
  alreadyStored,
  applyAuditSummary,
  eligibility,
  patchFor,
  stillSafeToApply,
  summarizeApply,
  tableFor,
  GRID_TRANSFORM_FINGERPRINT,
  LOCATION_COLUMNS,
  type GridApplyProposal,
} from "@/lib/electrical-grid-apply-gate";

const load = (over: Partial<MigrationInputRow> = {}): MigrationInputRow => ({
  kind: "load",
  stable_id: "FS-001",
  description: "Bench receptacle",
  grid: "A6",
  location: "East Wall",
  area: "Farm Shop",
  ...over,
});

describe("apply-gate eligibility", () => {
  it("permits EXACT and NEAREST records", () => {
    const exact = migrateRow(load({ grid: "A6" }));
    expect(["EXACT", "NEAREST"]).toContain(exact.grid_reference_precision);
    expect(eligibility(exact).eligible).toBe(true);
  });

  it("withholds INTERVAL records without snapping", () => {
    const row = migrateRow(load({ stable_id: "FS-010", grid: "D2", location: "", description: "" }));
    expect(row.grid_reference_precision).toBe("INTERVAL");
    const e = eligibility(row);
    expect(e.eligible).toBe(false);
    expect(e.status).toBe("withheld_interval");
  });

  it("withholds UNRESOLVED artifacts", () => {
    const row = migrateRow(load({ stable_id: "FS-011", grid: "??", location: "", description: "" }));
    expect(row.grid_reference_precision).toBe("UNRESOLVED");
    expect(eligibility(row).status).toBe("withheld_unresolved");
  });

  it("withholds the two corner panels for field confirmation", () => {
    for (const id of ["PNL-FS-NW", "PNL-FS-NE"]) {
      const row = migrateRow({ kind: "panel", stable_id: id, description: id, grid: "", location: "Farm Shop" });
      const e = eligibility(row);
      expect(e.eligible).toBe(false);
      expect(e.status).toBe("field_confirmation_required");
    }
  });

  it("never invents a location for PNL-FS-CRIT or PNL-FS-EQ", () => {
    for (const id of ["PNL-FS-CRIT", "PNL-FS-EQ"]) {
      const row = migrateRow({ kind: "panel", stable_id: id, description: id, grid: "", location: "Farm Shop" });
      expect(row.location_x_ft).toBeNull();
      expect(eligibility(row).status).toBe("withheld_unresolved");
    }
  });
});

describe("apply-gate patches", () => {
  it("writes only location columns", () => {
    const row = migrateRow(load());
    for (const key of Object.keys(patchFor(row))) {
      expect(LOCATION_COLUMNS as readonly string[]).toContain(key);
    }
  });

  it("NON_FIXED writes classification/provenance/legacy only — never X/Y or a grid", () => {
    const row = migrateRow(load({ stable_id: "FS-050", description: "MOBILE welder", grid: "MOBILE" }));
    expect(row.grid_reference_precision).toBe("NON_FIXED");
    const patch = patchFor(row);
    expect(Object.keys(patch).sort()).toEqual([
      "grid_migration_provenance",
      "grid_reference_precision",
      "legacy_grid",
    ]);
    expect(patch).not.toHaveProperty("location_x_ft");
    expect(patch).not.toHaveProperty("grid_reference");
    expect(eligibility(row).status).toBe("non_fixed");
  });

  it("recognises an already-stored row as already_correct", () => {
    const row = migrateRow(load());
    const patch = patchFor(row);
    expect(alreadyStored(patch as Record<string, unknown>, patch)).toBe(true);
    expect(alreadyStored({ ...patch, location_x_ft: 1 } as Record<string, unknown>, patch)).toBe(false);
  });

  it("routes loads and panels to their own tables", () => {
    expect(tableFor("load")).toBe("electrical_loads");
    expect(tableFor("panel")).toBe("electrical_panels");
  });
});

const guard = (over: Partial<Parameters<typeof stillSafeToApply>[0]> = {}) =>
  stillSafeToApply({
    stable_id: "FS-001",
    live_stable_id: "FS-001",
    row_uuid: "uuid-1",
    previewed_legacy_grid: "A6",
    live_legacy_grid: "A6",
    previewed_fingerprint: GRID_TRANSFORM_FINGERPRINT,
    current_fingerprint: GRID_TRANSFORM_FINGERPRINT,
    previewed_precision: "EXACT",
    current_precision: "EXACT",
    previewed_grid_reference: "A9",
    rederived_grid_reference: "A9",
    eligible: true,
    withheld_status: null,
    newer_evidence: null,
    approved: true,
    ...over,
  });

describe("pre-write verification", () => {
  it("passes when nothing changed", () => {
    expect(guard().ok).toBe(true);
  });

  it("blocks a legacy-grid change as drifted", () => {
    const r = guard({ live_legacy_grid: "B6" });
    expect(r).toMatchObject({ ok: false, status: "drifted" });
  });

  it("blocks a precision change as drifted", () => {
    expect(guard({ current_precision: "INTERVAL" })).toMatchObject({ status: "drifted" });
  });

  it("blocks when the coordinates no longer derive the previewed grid", () => {
    expect(guard({ rederived_grid_reference: "B9" })).toMatchObject({ status: "drifted" });
  });

  it("blocks a changed transformation fingerprint", () => {
    expect(guard({ current_fingerprint: "other" })).toMatchObject({ status: "failed" });
  });

  it("blocks identity mismatch", () => {
    expect(guard({ live_stable_id: "FS-002" })).toMatchObject({ status: "failed" });
  });

  it("blocks newer physical-location evidence", () => {
    expect(guard({ newer_evidence: "field survey" })).toMatchObject({ status: "newer_evidence" });
  });

  it("blocks unapproved records", () => {
    expect(guard({ approved: false })).toMatchObject({ status: "not_approved" });
  });

  it("blocks withheld records", () => {
    expect(guard({ eligible: false, withheld_status: "withheld_interval" })).toMatchObject({
      status: "withheld_interval",
    });
  });
});

describe("summary and audit", () => {
  const p = (status: GridApplyProposal["status"]): GridApplyProposal => ({
    table: "electrical_loads",
    kind: "load",
    stable_id: `FS-${status}`,
    row_uuid: "u",
    description: "d",
    legacy_grid: "A6",
    current_farmops_grid: "A6",
    location_x_ft: 60,
    location_y_ft: 0,
    grid_reference: "A9",
    grid_reference_precision: "EXACT",
    grid_migration_provenance: "prov",
    supporting_evidence: ["east wall"],
    transform_fingerprint: GRID_TRANSFORM_FINGERPRINT,
    writes: ["location_x_ft"],
    status,
    applied_at: null,
  });

  it("counts statuses", () => {
    const s = summarizeApply([p("would_change"), p("withheld_interval"), p("applied")]);
    expect(s.rows).toBe(3);
    expect(s.would_change).toBe(1);
    expect(s.withheld).toBe(1);
    expect(s.applied).toBe(1);
  });

  it("audit summary carries old grid, coordinates, derived grid, version and evidence", () => {
    const text = applyAuditSummary(p("applied"));
    expect(text).toContain("A6");
    expect(text).toContain("x=60");
    expect(text).toContain("A9");
    expect(text).toContain(GRID_TRANSFORM_FINGERPRINT);
    expect(text).toContain("east wall");
  });
});
