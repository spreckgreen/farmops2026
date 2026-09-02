import { describe, expect, it } from "vitest";
import {
  ESTABLISHED_ADJUDICATIONS,
  adjudicationsFor,
  convergeValidation,
  convergenceCsv,
  convergenceMarkdown,
} from "@/lib/electrical-convergence";
import { PHASE_44A_BASELINE_SHA256 } from "@/lib/electrical-adjudication-baseline";
import type {
  ComparisonRecord,
  ValidationReport,
} from "@/lib/electrical-parallel-validation";

function rec(over: Partial<ComparisonRecord>): ComparisonRecord {
  return {
    domain: "load",
    stable_id: "FS-082",
    field: "volts",
    label: "Volts",
    ods_worksheet: "Loads",
    ods_column: "Volts",
    ods_value: "120",
    farmops_entity: "electrical_loads",
    farmops_field: "volts",
    farmops_value: "240",
    authority: "canonical_ods",
    classification: "CONFLICT",
    rules: [],
    note: "scalar inequality",
    authority_class: "DECISION_REQUIRED",
    disposition: "ENGINEERING_DECISION_REQUIRED",
    root_cause: "unclassified",
    farmops_only_category: null,
    tbd: false,
    ...over,
  } as ComparisonRecord;
}

function report(records: ComparisonRecord[], sha = PHASE_44A_BASELINE_SHA256): ValidationReport {
  return {
    schema_version: "1.4",
    normalization_version: "1.4",
    mapping_version: "1",
    compared_at: "2026-09-02T00:00:00.000Z",
    sor_authority: "canonical_ods",
    farmops_role: "candidate_sor",
    ods: { file_name: "PremoFarmElectrical.ods", sha256: sha, worksheets: ["Loads"] },
    farmops: {
      snapshot_schema_version: "1",
      snapshot_generated_at: "2026-09-01T00:00:00.000Z",
      snapshot_sha256: null,
    },
    summary: {
      MATCH: 100,
      EXPECTED_TRANSFORMATION: 0,
      FARMOPS_AS_BUILT_ADDITION: 0,
      ODS_ONLY: 0,
      FARMOPS_ONLY: 0,
      CONFLICT: records.filter((r) => r.classification === "CONFLICT").length,
      LOSS: 0,
      INCOMPLETE: 0,
    },
    by_domain: {},
    as_built_additions_by_entity: {},
    by_root_cause: {},
    by_disposition: {} as ValidationReport["by_disposition"],
    farmops_only_by_category: { A: 0, B: 0, C: 0, D: 0, E: 0 },
    gate: {
      loss: 0,
      unexplained_ods_only: 0,
      unexplained: 0,
      open_dispositions: records.length,
      status: "PASS",
      reasons: [],
    },
    records,
    workbook_metadata: [],
  };
}

describe("established adjudication registry", () => {
  it("binds every entry to the confirmed Phase 4.4a baseline SHA", () => {
    expect(ESTABLISHED_ADJUDICATIONS.length).toBeGreaterThan(0);
    for (const a of ESTABLISHED_ADJUDICATIONS) {
      expect(a.ods_sha256).toBe(PHASE_44A_BASELINE_SHA256);
      expect(a.write_authorized).toBe(false);
    }
  });

  it("covers the established Phase 4.4b findings", () => {
    expect(adjudicationsFor("FS-082", "volts")[0]?.disposition).toBe(
      "CANONICAL_ODS_CORRECTION_REQUIRED",
    );
    expect(adjudicationsFor("FS-083", "volts")[0]?.disposition).toBe(
      "CANONICAL_ODS_CORRECTION_REQUIRED",
    );
    expect(adjudicationsFor("FS-034", "connected_va")[0]?.category).toBe("F");
    expect(adjudicationsFor("FS-092", "volts")[0]?.disposition).toBe(
      "SEMANTIC_REPRESENTATION_DIFFERENCE",
    );
    expect(adjudicationsFor("FS-082", "amps")[0]?.disposition).toBe("CURRENT_SEMANTICS_UNRESOLVED");
    expect(adjudicationsFor("FS-084", "connected_va")[0]?.disposition).toBe(
      "CURRENT_SEMANTICS_UNRESOLVED",
    );
  });

  it("preserves both source values instead of collapsing them", () => {
    const fs034 = adjudicationsFor("FS-034", "volts")[0]!;
    expect(fs034.preserved.join(" ")).toMatch(/240 V/);
    expect(fs034.preserved.join(" ")).toMatch(/220 V/);
    const fs084 = adjudicationsFor("FS-084", "connected_va")[0]!;
    expect(fs084.preserved.join(" ")).toMatch(/14400/);
    expect(fs084.preserved.join(" ")).toMatch(/240 × 60/);
  });
});

describe("convergence over the immutable raw comparison", () => {
  it("keeps an adjudicated conflict a raw conflict", () => {
    const c = convergeValidation(report([rec({})]));
    const f = c.findings[0]!;
    expect(f.raw_classification).toBe("CONFLICT");
    expect(f.raw_ods_value).toBe("120");
    expect(f.raw_farmops_value).toBe("240");
    expect(f.disposition).toBe("CANONICAL_ODS_CORRECTION_REQUIRED");
    expect(c.raw_summary.CONFLICT).toBe(1);
    expect(c.by_raw_classification.CONFLICT).toEqual({ raw: 1, adjudicated: 1, unresolved: 0 });
  });

  it("reports raw / adjudicated / unresolved as separate measures", () => {
    const c = convergeValidation(
      report([
        rec({}),
        rec({ stable_id: "FS-083" }),
        rec({ stable_id: "FS-999", field: "volts", note: "no adjudication" }),
        rec({ stable_id: "FS-082", field: "amps", ods_value: "0", farmops_value: "1.69" }),
      ]),
    );
    expect(c.counts.raw_findings).toBe(4);
    expect(c.counts.adjudicated).toBe(3);
    expect(c.counts.unresolved).toBe(2); // unadjudicated + current semantics
    expect(c.counts.canonical_corrections_pending).toBe(2);
    expect(c.counts.current_semantics_unresolved).toBe(1);
  });

  it("classifies FarmOps-only category B as converged without a write", () => {
    const c = convergeValidation(
      report([
        rec({
          stable_id: "CON-101",
          classification: "FARMOPS_ONLY",
          farmops_only_category: "B",
          ods_value: "",
        }),
      ]),
    );
    expect(c.findings[0]!.disposition).toBe("RESOLVED_NO_WRITE_REQUIRED");
    expect(c.counts.unresolved).toBe(0);
    expect(c.by_raw_classification.FARMOPS_ONLY.adjudicated).toBe(1);
  });

  it("shows adjudications from another workbook SHA as stale and reduces nothing", () => {
    const c = convergeValidation(report([rec({})], "0".repeat(64)));
    expect(c.stale).toHaveLength(1);
    expect(c.findings[0]!.disposition).toBe("UNADJUDICATED");
    expect(c.counts.adjudicated).toBe(0);
    expect(c.counts.unresolved).toBe(1);
    expect(c.findings[0]!.rationale).toMatch(/stale/i);
  });

  it("does not treat Phase 4.4a PASS as Phase 4.5 readiness", () => {
    const c = convergeValidation(report([rec({ stable_id: "FS-999" })]));
    expect(c.phase_45.phase_44a_status).toBe("PASS");
    expect(c.phase_45.status).toBe("BLOCKED");
    expect(c.phase_45.depends_on_phase_44a).toBe(false);
  });

  it("is read-only and offers no apply path", () => {
    const c = convergeValidation(report([rec({})]));
    expect(c.read_only).toBe(true);
    expect(c.apply_available).toBe(false);
    expect(convergenceCsv(c).split("\n")[0]).toMatch(/raw_classification/);
    expect(convergenceMarkdown(c)).toMatch(/Phase 4.5 readiness/);
  });
});
