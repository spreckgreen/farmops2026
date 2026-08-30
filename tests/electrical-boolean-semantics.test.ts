import { describe, expect, it } from "vitest";
import { booleanFromSelect, booleanSelectValue, parseBooleanCell } from "@/lib/electrical-boolean";
import { ENTITIES, coerceValue } from "@/lib/electrical-entities";
import { booleanDiagnostics } from "@/lib/electrical-boolean-diagnostics";
import type { ComparisonRecord, ValidationReport } from "@/lib/electrical-parallel-validation";

function boolField(kind: "load", key: string) {
  const field = ENTITIES[kind].fields.find((f) => f.key === key);
  if (!field) throw new Error(`missing field ${key}`);
  return field;
}

describe("Phase 4.4b tri-state Yes/No parsing", () => {
  it("imports Y as true and N as false", () => {
    expect(parseBooleanCell("Y").value).toBe(true);
    expect(parseBooleanCell("Yes").value).toBe(true);
    expect(parseBooleanCell("N").value).toBe(false);
    expect(parseBooleanCell("No").value).toBe(false);
  });

  it("leaves blank as unknown rather than false", () => {
    for (const blank of ["", "   ", "N/A", null, undefined]) {
      const parsed = parseBooleanCell(blank);
      expect(parsed.value).toBeNull();
      expect(parsed.state).toBe("unknown");
    }
  });

  it("keeps TBD as an engineering state, never a boolean", () => {
    const parsed = parseBooleanCell("TBD");
    expect(parsed.value).toBeNull();
    expect(parsed.state).toBe("tbd");
  });

  it("does not invent a value for unrecognised text", () => {
    const parsed = parseBooleanCell("see note 4");
    expect(parsed.value).toBeNull();
    expect(parsed.recognized).toBe(false);
  });

  it("preserves explicit booleans already stored in FarmOps", () => {
    expect(parseBooleanCell(true).value).toBe(true);
    expect(parseBooleanCell(false).value).toBe(false);
  });
});

describe("Phase 4.4b coercion on the write path", () => {
  it("never coerces N or blank to a forced boolean", () => {
    const critical = boolField("load", "critical");
    expect(coerceValue(critical, "N")).toBe(false);
    expect(coerceValue(critical, "Y")).toBe(true);
    expect(coerceValue(critical, "")).toBeNull();
    expect(coerceValue(critical, "TBD")).toBeNull();
  });

  it("round-trips the tri-state form control", () => {
    expect(booleanSelectValue(null)).toBe("unknown");
    expect(booleanSelectValue(false)).toBe("no");
    expect(booleanSelectValue(true)).toBe("yes");
    expect(booleanFromSelect("unknown")).toBeNull();
    expect(booleanFromSelect("no")).toBe(false);
    expect(booleanFromSelect("yes")).toBe(true);
    // A form value that was never touched must not become false.
    expect(coerceValue(boolField("load", "future"), "unknown")).toBeNull();
  });
});

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

function reportOf(records: ComparisonRecord[]): ValidationReport {
  return { records } as unknown as ValidationReport;
}

describe("Phase 4.4b boolean diagnostics", () => {
  it("separates implementation defaults from engineering disagreements", () => {
    const diag = booleanDiagnostics(
      reportOf([
        record({ stable_id: "FS-001" }),
        record({ stable_id: "FS-002" }),
        record({ stable_id: "FS-003", field: "critical", farmops_field: "critical" }),
        record({
          stable_id: "FS-004",
          ods_value: "",
          farmops_value: "false",
          field: "dedicated",
          farmops_field: "dedicated",
        }),
        record({ stable_id: "FS-005", ods_value: "Y", farmops_value: "false" }),
      ]),
    );

    expect(diag.total_findings).toBe(5);
    const coercion = diag.groups.find((g) => g.default_source === "importer_boolean_coercion");
    expect(coercion?.affected_records).toBe(2);
    expect(coercion?.stable_ids).toEqual(["FS-001", "FS-002"]);
    expect(diag.groups.some((g) => g.default_source === "database_column_default")).toBe(true);
    expect(diag.true_disagreements).toBe(1);
    expect(diag.groups.find((g) => !g.implementation_created)?.ods_value).toBe("Y");
  });

  it("flags TBD workbook states as never-boolean", () => {
    const diag = booleanDiagnostics(reportOf([record({ ods_value: "TBD" })]));
    expect(diag.groups[0]?.default_source).toBe("workbook_tbd_state");
    expect(diag.groups[0]?.ods_meaning).toBe("tbd");
  });

  it("ignores findings outside the boolean group", () => {
    const diag = booleanDiagnostics(
      reportOf([record({ root_cause: "design_value_disagreement" })]),
    );
    expect(diag.total_findings).toBe(0);
  });
});

describe("Phase 4.4b Task 1B classification", () => {
  it("classifies importer coercion as Category A with a false proposal", () => {
    const diag = booleanDiagnostics(reportOf([record({ stable_id: "FS-010" })]));
    const g = diag.groups[0]!;
    expect(g.category).toBe("A");
    expect(g.proposed_value).toBe(false);
    expect(diag.counts_by_category.A).toBe(1);
  });

  it("classifies NOT NULL column defaults as Category A proposing null", () => {
    const diag = booleanDiagnostics(
      reportOf([
        record({ stable_id: "FS-011", ods_value: "", farmops_value: "false", field: "critical", farmops_field: "critical" }),
      ]),
    );
    expect(diag.groups[0]?.category).toBe("A");
    expect(diag.groups[0]?.proposed_value).toBeNull();
  });

  it("classifies explicit disagreements as Category B and leaves them alone", () => {
    const diag = booleanDiagnostics(
      reportOf([record({ stable_id: "FS-012", ods_value: "Y", farmops_value: "false" })]),
    );
    expect(diag.groups[0]?.category).toBe("B");
    expect(diag.groups[0]?.proposed_value).toBeUndefined();
  });

  it("classifies TBD and unrepresentable states as Category C", () => {
    const diag = booleanDiagnostics(reportOf([record({ stable_id: "FS-013", ods_value: "TBD" })]));
    expect(diag.groups[0]?.category).toBe("C");
    expect(diag.groups[0]?.proposed_value).toBeUndefined();
  });

  it("classifies unrecognised workbook text as Category D", () => {
    const diag = booleanDiagnostics(
      reportOf([record({ stable_id: "FS-014", ods_value: "maybe later", farmops_value: "true" })]),
    );
    expect(diag.groups[0]?.category).toBe("D");
  });

  it("builds a Category-A-only correction plan with per-record evidence", () => {
    const diag = booleanDiagnostics(
      reportOf([
        record({ stable_id: "FS-020" }),
        record({ stable_id: "FS-021", ods_value: "Y", farmops_value: "false" }),
        record({ stable_id: "FS-022", ods_value: "TBD" }),
      ]),
    );
    const plan = categoryACorrectionPlan(diag);
    expect(plan.entries.map((e) => e.stable_id)).toEqual(["FS-020"]);
    expect(plan.entries[0]).toMatchObject({
      table: "electrical_loads",
      column: "future",
      stable_id_field: "load_id",
      proposed_value: false,
    });
    expect(plan.skipped_categories.B).toBe(1);
    expect(plan.skipped_categories.C).toBe(1);
    expect(correctionPlanCsv(plan)).toContain("FS-020");
    expect(correctionPlanCsv(plan)).not.toContain("FS-021");
  });

  it("exports every individual stable ID for drill-down", () => {
    const diag = booleanDiagnostics(
      reportOf([record({ stable_id: "FS-030" }), record({ stable_id: "FS-031" })]),
    );
    const csv = booleanRecordCsv(diag);
    expect(csv).toContain("FS-030");
    expect(csv).toContain("FS-031");
    expect(csv.trim().split("\n")).toHaveLength(3);
  });
});
