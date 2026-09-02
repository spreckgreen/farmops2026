import { describe, expect, it } from "vitest";
import {
  classifyZeroOrigin,
  zeroOriginReport,
  zeroOriginScope,
  type LoadProvenanceRow,
} from "@/lib/electrical-zero-origin-provenance";
import type { NumericFinding } from "@/lib/electrical-numeric-diagnostics";

const SHA = "89da43c7f1f94948e17ecfdc942dbdba022cfee5ba504b70865529cf39877388";

const finding = (over: Partial<NumericFinding> = {}): NumericFinding =>
  ({
    domain: "load",
    stable_id: "FS-029",
    label: "Connected VA",
    farmops_entity: "electrical_loads",
    farmops_field: "connected_va",
    farmops_uuid: null,
    ods_worksheet: "Loads",
    ods_column: "Connected VA",
    ods_row: 12,
    unit: "VA",
    ods_raw: "",
    ods_state: "absent",
    farmops_raw: "0",
    farmops_state: "zero",
    raw_category: "D",
    convergence_disposition: "UNADJUDICATED",
    ...over,
  }) as unknown as NumericFinding;

const prov = (over: Partial<LoadProvenanceRow> = {}): LoadProvenanceRow => ({
  load_id: "FS-029",
  connected_va: 0,
  volts: 120,
  amps: 0,
  source_reference: null,
  notes: "0%",
  created_at: "2026-08-29T01:44:31.000Z",
  updated_at: "2026-08-29T05:01:02.000Z",
  audit_entries: 0,
  import_snapshot: false,
  creation_batch_size: 11,
  ...over,
});

describe("connected VA zero-origin provenance", () => {
  it("classifies a bulk-imported zero against a blank cell as a coercion artifact", () => {
    const { origin } = classifyZeroOrigin(finding(), prov());
    expect(origin).toBe("DEFAULTED_OR_COERCED_FROM_BLANK_NULL_OR_TEXT");
  });

  it("keeps an explicit numeric ODS zero as an imported explicit zero", () => {
    const { origin } = classifyZeroOrigin(
      finding({ ods_raw: "0", ods_state: "zero" }),
      prov(),
    );
    expect(origin).toBe("IMPORTED_FROM_EXPLICIT_NUMERIC_ODS_ZERO");
  });

  it("reports unknown provenance when no FarmOps row is available", () => {
    const { origin } = classifyZeroOrigin(finding(), undefined);
    expect(origin).toBe("PROVENANCE_UNAVAILABLE");
  });

  it("treats a cited, audited zero as explicitly supported", () => {
    const { origin } = classifyZeroOrigin(
      finding(),
      prov({ source_reference: "Panel schedule H1 rev B", audit_entries: 1 }),
    );
    expect(origin).toBe("EXPLICITLY_ENTERED_FROM_SOURCE_EVIDENCE");
  });

  it("excludes FS-084 from the zero-origin scope", () => {
    const rows = zeroOriginScope([
      finding(),
      finding({ stable_id: "FS-084", farmops_raw: "14400", farmops_state: "value" }),
    ]);
    expect(rows.map((r) => r.stable_id)).toEqual(["FS-029"]);
  });

  it("defers the nameplate until the zero origin is settled, and never writes", () => {
    const r = zeroOriginReport({
      findings: [finding()],
      provenance: [prov()],
      odsFileName: "PremoFarmElectrical.ods",
      odsSha256: SHA,
      comparedAt: "2026-09-02T00:00:00.000Z",
    });
    expect(r.write_authorized).toBe(false);
    expect(r.rows[0].disposition).toBe("ZERO_DEFAULT_OR_COERCION_ARTIFACT");
    expect(r.rows[0].next_resolution_source).toBe("EQUIPMENT_NAMEPLATE_REQUIRED");
    expect(r.rows[0].farmops_connected_va).toBe(0);
    expect(r.ods_sha256).toBe(SHA);
    // ODS blank stays blank.
    expect(r.rows[0].ods_raw).toBe("");
    expect(r.separate_cases.map((c) => `${c.stable_id}.${c.field}`)).toEqual([
      "FS-084.connected_va",
      "PNL-H1.bus_rating_amps",
      "PNL-H1.spaces",
    ]);
  });

  it("falls back to unknown provenance for a single-row creation with no evidence", () => {
    const { origin } = classifyZeroOrigin(
      finding(),
      prov({ creation_batch_size: 1 }),
    );
    expect(origin).toBe("PROVENANCE_UNAVAILABLE");
  });
});
