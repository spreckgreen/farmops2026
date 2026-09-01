import { describe, expect, it } from "vitest";
import {
  SYSTEM_VOLTAGE_COLUMN,
  isSystemVoltageField,
  resolveSystemVoltage,
  sameSystemVoltage,
  systemVoltageMigrationPreview,
  systemVoltagePreviewCsv,
  voltageSemantics,
} from "@/lib/electrical-system-voltage";
import { numericDiagnostics } from "@/lib/electrical-numeric-diagnostics";
import type { ComparisonRecord, ValidationReport } from "@/lib/electrical-parallel-validation";

const PANELS = [
  "PNL-BLR",
  "PNL-FS-CRIT",
  "PNL-FS-EQ",
  "PNL-FS-NE",
  "PNL-FS-NW",
  "PNL-H1",
  "PNL-PH",
];

function rec(over: Partial<ComparisonRecord>): ComparisonRecord {
  return {
    domain: "panel",
    stable_id: "PNL-H1",
    field: "voltage",
    classification: "CONFLICT",
    ods_value: "120/240",
    farmops_value: 240,
    farmops_entity: "electrical_panels",
    farmops_field: "voltage",
    farmops_uuid: null,
    ods_worksheet: "Panel_Schedule",
    ods_column: "Voltage",
    ods_row: 4,
    root_cause: "unclassified",
    disposition: "REVIEW_REQUIRED",
    ...over,
  } as unknown as ComparisonRecord;
}

function report(records: ComparisonRecord[]): ValidationReport {
  return {
    ods: { file_name: "PremoFarmElectrical.ods", sha256: "a".repeat(64) },
    compared_at: "2026-09-01T00:00:00.000Z",
    records,
  } as unknown as ValidationReport;
}

describe("Phase 4.4b — panel system-voltage semantic model", () => {
  it("keeps panel system semantics distinct from load utilization voltage", () => {
    expect(voltageSemantics("electrical_panels", "voltage")).toBe("system_designation");
    expect(voltageSemantics("electrical_loads", "volts")).toBe("utilization_scalar");
    expect(isSystemVoltageField("electrical_loads", "volts")).toBe(false);
    expect(isSystemVoltageField("electrical_feeders", "voltage")).toBe(true);
  });

  it("represents 120/240 without losing either voltage component", () => {
    const rep = resolveSystemVoltage("120/240")!;
    expect(rep.line_neutral_volts).toBe(120);
    expect(rep.line_line_volts).toBe(240);
    expect(rep.phases).toBe(1);
    expect(rep.wires).toBe(3);
    expect(rep.designation).toBe("120/240 V, 1φ, 3-wire");
    expect(rep.code).toBe("SYSV-120/240-1P3W");
  });

  it("never promotes a bare scalar into a system designation", () => {
    expect(resolveSystemVoltage("240")).toBeNull();
    expect(resolveSystemVoltage(240)).toBeNull();
    expect(sameSystemVoltage(resolveSystemVoltage("120/240"), resolveSystemVoltage("240"))).toBe(
      false,
    );
  });

  it("recognises ODS 120/240 <-> FarmOps system 120/240 as an agreement", () => {
    const r = numericDiagnostics(
      report([
        rec({}),
        rec({ field: SYSTEM_VOLTAGE_COLUMN, farmops_field: SYSTEM_VOLTAGE_COLUMN, farmops_value: "120/240", ods_value: "120/240" }),
      ]),
    );
    expect(r.counts_by_category.E).toBe(0);
    expect(r.agreements).toBe(1);
  });

  it("reports E while FarmOps still stores only the scalar", () => {
    const r = numericDiagnostics(report([rec({})]));
    expect(r.counts_by_category.E).toBe(1);
    expect(r.findings[0].disposition).toBe("requires_data_model_decision");
    expect(r.findings[0].proposed_value).toBeUndefined();
    expect(r.findings[0].farmops_value).toBe(240);
  });

  it("treats two represented but different designations as an engineering disagreement", () => {
    const r = numericDiagnostics(
      report([
        rec({}),
        rec({ field: SYSTEM_VOLTAGE_COLUMN, farmops_field: SYSTEM_VOLTAGE_COLUMN, farmops_value: "120/208" }),
      ]),
    );
    expect(r.counts_by_category.E).toBe(0);
    expect(r.counts_by_category.B).toBe(1);
  });

  it("previews all seven production panels without losing a voltage component", () => {
    const r = numericDiagnostics(
      report(PANELS.map((id) => rec({ stable_id: id }))),
    );
    expect(r.counts_by_category.E).toBe(7);
    const preview = r.system_voltage_preview;
    expect(preview.applied).toBe(false);
    expect(preview.affected_stable_ids).toEqual([...PANELS].sort());
    for (const row of preview.rows) {
      expect(row.current_scalar).toBe(240);
      expect(row.proposed.line_neutral_volts).toBe(120);
      expect(row.proposed.line_line_volts).toBe(240);
      expect(row.status).toBe("scalar_loses_line_neutral");
      expect(row.read_only).toBe(true);
    }
    const csv = systemVoltagePreviewCsv(preview);
    for (const id of PANELS) expect(csv).toContain(id);
    expect(csv).toContain("120/240 V, 1φ, 3-wire");
  });

  it("has no write path", () => {
    const source = String(systemVoltageMigrationPreview) + String(resolveSystemVoltage);
    expect(source).not.toMatch(/\.from\(|insert\(|update\(|upsert\(|delete\(/);
  });
});
