import { describe, expect, it } from "vitest";

import {
  PEER_BUNDLE_SCHEMA_VERSION,
  buildPeerBundle,
  isFieldVerified,
  parsePeerBundle,
  planBatchImport,
  planCanonicalImport,
  planKey,
  serializePeerBundle,
  summarizeCanonicalPlan,
  writableRows,
} from "@/lib/electrical-peer-bundle";

const verifiedLoadRow = {
  load_id: "FS-035",
  description: "Air compressor",
  updated_at: "2026-09-01T00:00:00.000Z",
  field_grid_reference: "C4",
  field_verification_status: "VERIFIED_AS_INSTALLED",
  location_source: "FIELD_OBSERVED_GRID",
  location_precision: "NEAREST",
  location_x_ft: 20,
  location_y_ft: 30,
  design_x_ft: 99,
};

describe("bundle build and parse", () => {
  it("carries only field-verified records and only location columns", () => {
    const bundle = buildPeerBundle({
      generatedAt: "2026-09-08T12:00:00.000Z",
      origin: "https://site-a.example.com",
      rows: {
        load: [
          verifiedLoadRow,
          { load_id: "FS-900", description: "Planned only", design_x_ft: 10, design_y_ft: 12 },
        ],
      },
      batches: [
        {
          batch_id: "FA-FS-2026-09-06-R1",
          title: "Farm Shop audit",
          status: "applied",
          applied_at: "2026-09-06T18:00:00.000Z",
          manifest_sha256: "abc",
          manifest: { batch_id: "FA-FS-2026-09-06-R1" },
        },
      ],
    });
    expect(bundle.records).toHaveLength(1);
    expect(bundle.records[0]!.stable_id).toBe("FS-035");
    expect(bundle.records[0]!.fields).not.toHaveProperty("design_x_ft");
    expect(bundle.schema_version).toBe(PEER_BUNDLE_SCHEMA_VERSION);

    const round = parsePeerBundle(serializePeerBundle(bundle));
    expect(round.ok).toBe(true);
    expect(round.bundle!.records[0]!.fields["field_grid_reference"]).toBe("C4");
    expect(round.bundle!.batches[0]!.batch_id).toBe("FA-FS-2026-09-06-R1");
  });

  it("rejects an unreadable or wrong-version bundle", () => {
    expect(parsePeerBundle("nope").ok).toBe(false);
    const wrong = parsePeerBundle(JSON.stringify({ schema_version: "9.9", origin: "x" }));
    expect(wrong.ok).toBe(false);
    expect(wrong.errors.join(" ")).toMatch(/schema/i);
  });

  it("treats a design-only location as unverified", () => {
    expect(isFieldVerified({ design_x_ft: 4, location_source: "APPROVED_DESIGN_XY" })).toBe(false);
    expect(isFieldVerified({ pole_location_kind: "BETWEEN_POSTS" })).toBe(true);
  });
});

describe("canonical import plan", () => {
  const record = {
    kind: "load" as const,
    stable_id: "FS-035",
    description: "Air compressor",
    updated_at: null,
    fields: {
      field_grid_reference: "C4",
      location_precision: "NEAREST",
      location_x_ft: 20,
    },
  };

  it("creates a record that does not exist locally, without approval", () => {
    const rows = planCanonicalImport([record], new Map());
    expect(rows[0]!.decision).toBe("create");
    expect(rows[0]!.requires_approval).toBe(false);
    expect(writableRows(rows, [])).toHaveLength(1);
  });

  it("fills blank local fields automatically", () => {
    const local = new Map([
      [planKey("load", "FS-035"), { load_id: "FS-035", field_grid_reference: null }],
    ]);
    const rows = planCanonicalImport([record], local);
    expect(rows[0]!.decision).toBe("fill");
    expect(rows[0]!.requires_approval).toBe(false);
  });

  it("holds a disagreement with an existing value until approved", () => {
    const local = new Map([
      [
        planKey("load", "FS-035"),
        { load_id: "FS-035", field_grid_reference: "B2", location_precision: "NEAREST" },
      ],
    ]);
    const rows = planCanonicalImport([record], local);
    expect(rows[0]!.decision).toBe("conflict");
    expect(rows[0]!.requires_approval).toBe(true);
    expect(writableRows(rows, [])).toHaveLength(0);
    expect(writableRows(rows, [rows[0]!.key])).toHaveLength(1);
    expect(rows[0]!.changes.find((c) => c.column === "field_grid_reference")?.before).toBe("B2");
  });

  it("reports a matching record as no change", () => {
    const local = new Map([
      [
        planKey("load", "FS-035"),
        {
          load_id: "FS-035",
          field_grid_reference: "C4",
          location_precision: "NEAREST",
          location_x_ft: 20,
        },
      ],
    ]);
    const rows = planCanonicalImport([record], local);
    expect(rows[0]!.decision).toBe("no_change");
    expect(summarizeCanonicalPlan(rows).auto_apply).toBe(0);
  });

  it("never imports a location with no field evidence", () => {
    const rows = planCanonicalImport(
      [{ ...record, fields: { location_precision: "NEAREST" } }],
      new Map(),
    );
    expect(rows[0]!.decision).toBe("not_verified");
    expect(writableRows(rows, [rows[0]!.key])).toHaveLength(0);
  });
});

describe("audit batch import plan", () => {
  const base = { title: null, applied_at: null, manifest_sha256: null };
  it("classifies each batch deterministically", () => {
    const rows = planBatchImport(
      [
        { batch_id: "A", status: "applied", manifest: { batch_id: "A" }, ...base },
        { batch_id: "B", status: "validated", manifest: { batch_id: "B" }, ...base },
        { batch_id: "C", status: "applied", manifest: null, ...base },
        { batch_id: "D", status: "applied", manifest: { batch_id: "D" }, ...base },
      ],
      ["d"],
    );
    expect(rows.map((r) => r.outcome)).toEqual([
      "importable",
      "skipped_status",
      "metadata_only",
      "present_locally",
    ]);
  });
});
