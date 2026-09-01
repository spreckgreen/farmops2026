import { describe, expect, it } from "vitest";
import {
  booleanDiagnostics,
  categoryACorrectionPlan,
  correctionPlanCsv,
} from "@/lib/electrical-boolean-diagnostics";
import {
  artifactStillJustified,
  displayBool,
  displayOds,
  gateMarkdown,
  gatePlanCsv,
  summarizeGate,
  type GateRow,
} from "@/lib/electrical-boolean-gate";
import type { ComparisonRecord, ValidationReport } from "@/lib/electrical-parallel-validation";

function record(over: Partial<ComparisonRecord>): ComparisonRecord {
  return {
    domain: "loads",
    stable_id: "FS-001",
    field: "future",
    label: "Future",
    ods_worksheet: "Load_Master",
    ods_column: "Future",
    ods_value: "N",
    farmops_entity: "electrical_loads",
    farmops_field: "future",
    farmops_value: "true",
    authority: "engineering_design",
    classification: "CONFLICT",
    rules: [],
    note: "",
    authority_class: "engineering_design_ods_authoritative",
    disposition: "requires_engineering_review",
    root_cause: "boolean_or_default_semantics",
    farmops_only_category: null,
    tbd: false,
    ...over,
  } as ComparisonRecord;
}

const reportOf = (records: ComparisonRecord[]) => ({ records }) as unknown as ValidationReport;

function gateRow(over: Partial<GateRow>): GateRow {
  return {
    table: "electrical_loads",
    stable_id: "FS-001",
    row_uuid: "11111111-1111-1111-1111-111111111111",
    column: "future",
    ods_value: "N",
    reconciliation_value: true,
    live_value: true,
    artifact_type: "A1_N_COERCED_TRUE",
    proposed_value: false,
    status: "would_change",
    evidence: "importer_boolean_coercion",
    ...over,
  };
}

describe("Phase 4.4b Category-A artifact typing", () => {
  it("labels N→true as A1 and blank→false as A2", () => {
    const diag = booleanDiagnostics(
      reportOf([
        record({ stable_id: "FS-001" }),
        record({
          stable_id: "FS-002",
          ods_value: "",
          farmops_value: "false",
          field: "critical",
          farmops_field: "critical",
        }),
      ]),
    );
    const plan = categoryACorrectionPlan(diag);
    expect(plan.artifact_counts).toEqual({ A1_N_COERCED_TRUE: 1, A2_BLANK_DEFAULTED_FALSE: 1 });
    const a1 = plan.entries.find((e) => e.stable_id === "FS-001")!;
    const a2 = plan.entries.find((e) => e.stable_id === "FS-002")!;
    expect(a1.artifact_type).toBe("A1_N_COERCED_TRUE");
    expect(a1.proposed_value).toBe(false);
    expect(a2.artifact_type).toBe("A2_BLANK_DEFAULTED_FALSE");
    expect(a2.proposed_value).toBeNull();
    expect(correctionPlanCsv(plan)).toContain("A2_BLANK_DEFAULTED_FALSE");
  });

  it("never types B/C/D findings as an artifact", () => {
    const diag = booleanDiagnostics(
      reportOf([
        record({ stable_id: "FS-010", ods_value: "Y", farmops_value: "false" }),
        record({ stable_id: "FS-011", ods_value: "TBD" }),
        record({ stable_id: "FS-012", ods_value: "maybe later" }),
      ]),
    );
    expect(diag.groups.every((g) => g.artifact_type === null)).toBe(true);
    expect(categoryACorrectionPlan(diag).entries).toHaveLength(0);
  });
});

describe("Phase 4.4b artifact re-justification against live state", () => {
  it("accepts A1 only when live is true and proposal is false", () => {
    const base = { artifact_type: "A1_N_COERCED_TRUE", table: "electrical_loads", column: "future" } as const;
    expect(artifactStillJustified({ ...base, live_value: true, proposed_value: false }).ok).toBe(true);
    expect(artifactStillJustified({ ...base, live_value: false, proposed_value: false }).ok).toBe(false);
    expect(artifactStillJustified({ ...base, live_value: true, proposed_value: null }).ok).toBe(false);
  });

  it("accepts A2 only on documented NOT NULL DEFAULT false columns", () => {
    const base = { artifact_type: "A2_BLANK_DEFAULTED_FALSE", table: "electrical_loads" } as const;
    expect(
      artifactStillJustified({ ...base, column: "critical", live_value: false, proposed_value: null }).ok,
    ).toBe(true);
    expect(
      artifactStillJustified({ ...base, column: "gfci", live_value: false, proposed_value: null }).ok,
    ).toBe(false);
    expect(
      artifactStillJustified({ ...base, column: "critical", live_value: true, proposed_value: null }).ok,
    ).toBe(false);
  });
});

describe("Phase 4.4b gate summary arithmetic", () => {
  const diag = booleanDiagnostics(
    reportOf([
      record({ stable_id: "FS-001" }),
      record({ stable_id: "FS-002" }),
      record({ stable_id: "FS-003" }),
      record({ stable_id: "FS-100", ods_value: "maybe later" }),
    ]),
  );
  const plan = categoryACorrectionPlan(diag);

  it("reconciles status counts against the Category-A finding count", () => {
    const rows = [
      gateRow({ stable_id: "FS-001", status: "would_change" }),
      gateRow({ stable_id: "FS-002", status: "already_correct", live_value: false }),
      gateRow({ stable_id: "FS-003", status: "drifted", live_value: false }),
    ];
    const s = summarizeGate({ diag, plan, rows });
    expect(s.category_a_findings).toBe(3);
    expect(s.a1_artifacts).toBe(3);
    expect(s.would_change).toBe(1);
    expect(s.already_correct).toBe(1);
    expect(s.drifted).toBe(1);
    expect(s.accounted).toBe(3);
    expect(s.reconciles).toBe(true);
    expect(s.category_d).toBe(1);
  });

  it("flags a non-reconciling run instead of hiding the gap", () => {
    const s = summarizeGate({ diag, plan, rows: [gateRow({ status: "would_change" })] });
    expect(s.reconciles).toBe(false);
  });

  it("renders NULL as not stated, never as false", () => {
    expect(displayBool(null)).toBe("Not stated / NULL");
    expect(displayBool(false)).toBe("No / false");
    expect(displayOds("")).toBe("Not stated / NULL");
  });
});

describe("Phase 4.4b gate exports", () => {
  const diag = booleanDiagnostics(reportOf([record({ stable_id: "FS-001" })]));
  const plan = categoryACorrectionPlan(diag);
  const rows = [gateRow({})];
  const summary = summarizeGate({ diag, plan, rows });

  it("exports one CSV row per finding with uuid and both artifact-distinct columns", () => {
    const csv = gatePlanCsv(rows);
    expect(csv.split("\n")[0]).toContain("row_uuid");
    expect(csv).toContain("11111111-1111-1111-1111-111111111111");
    expect(csv).toContain("A1_N_COERCED_TRUE");
  });

  it("writes an archivable markdown report with the preview-only banner", () => {
    const md = gateMarkdown({ generatedAt: "2026-09-01T00:00:00Z", summary, rows, applied: false });
    expect(md).toContain("Preview only — no production values changed");
    expect(md).toContain("A1 N→true artifacts");
    expect(md).toContain("Category-D exclusion");
    expect(md).toContain("Post-Apply gate");
  });
});
