import { describe, expect, it } from "vitest";
import {
  AUTHORIZED_PANELS,
  stillSafeToApply,
  summarizeSystemVoltageGate,
  systemVoltageGateCsv,
  systemVoltageGateKey,
  systemVoltageGateMarkdown,
  systemVoltagePayload,
  type SystemVoltageGateRow,
} from "@/lib/electrical-system-voltage-gate";
import { resolveSystemVoltage } from "@/lib/electrical-system-voltage";
import { numericDiagnostics } from "@/lib/electrical-numeric-diagnostics";
import type { ComparisonRecord, ValidationReport } from "@/lib/electrical-parallel-validation";

const PROPOSED = resolveSystemVoltage("120/240")!;

const safeInput = (over: Partial<Parameters<typeof stillSafeToApply>[0]> = {}) => ({
  stable_id: "PNL-H1",
  ods_value: "120/240",
  expected_scalar: 240 as number | null,
  live_scalar: 240 as number | null,
  live_representation: null as unknown,
  proposed: PROPOSED,
  ...over,
});

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

const report = (records: ComparisonRecord[]): ValidationReport =>
  ({
    ods: { file_name: "PremoFarmElectrical.ods", sha256: "a".repeat(64) },
    compared_at: "2026-09-01T00:00:00.000Z",
    records,
  }) as unknown as ValidationReport;

describe("Phase 4.4b — system-voltage apply gate", () => {
  it("authorizes exactly the seven reviewed panels", () => {
    expect([...AUTHORIZED_PANELS]).toEqual([
      "PNL-BLR",
      "PNL-FS-CRIT",
      "PNL-FS-EQ",
      "PNL-FS-NE",
      "PNL-FS-NW",
      "PNL-H1",
      "PNL-PH",
    ]);
    expect(stillSafeToApply(safeInput({ stable_id: "PNL-SHOP" })).ok).toBe(false);
  });

  it("allows the reviewed scalar-240 rows", () => {
    expect(stillSafeToApply(safeInput()).ok).toBe(true);
  });

  it("refuses a drifted scalar", () => {
    const r = stillSafeToApply(safeInput({ live_scalar: 208 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe("drifted");
  });

  it("refuses when the canonical workbook no longer states the designation", () => {
    const r = stillSafeToApply(safeInput({ ods_value: "240" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe("drifted");
  });

  it("refuses a conflicting stored designation and never overwrites it", () => {
    const r = stillSafeToApply(safeInput({ live_representation: { line_neutral: 120, line_line: 208 } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe("conflict");
  });

  it("writes only the designation payload, never the scalar", () => {
    const payload = systemVoltagePayload(PROPOSED);
    expect(payload).toMatchObject({
      code: "SYSV-120/240-1P3W",
      line_neutral_volts: 120,
      line_line_volts: 240,
      phases: 1,
      wires: 3,
    });
    expect(Object.keys(payload)).not.toContain("voltage");
  });

  it("reconciles every row into exactly one status bucket", () => {
    const rows: SystemVoltageGateRow[] = ["applied", "drifted", "conflict"].map((status, i) => ({
      table: "electrical_panels",
      stable_id: AUTHORIZED_PANELS[i]!,
      row_uuid: null,
      column: "system_voltage",
      ods_value: "120/240",
      expected_scalar: 240,
      live_scalar: 240,
      live_representation: "",
      proposed: PROPOSED,
      status: status as SystemVoltageGateRow["status"],
      applied_at: status === "applied" ? "2026-09-01T00:00:00.000Z" : null,
    }));
    const summary = summarizeSystemVoltageGate(rows);
    expect(summary.reconciles).toBe(true);
    expect(summary.applied).toBe(1);
    expect(summary.drifted).toBe(1);
    expect(summary.conflict).toBe(1);
    const csv = systemVoltageGateCsv(rows);
    expect(csv.split("\n")).toHaveLength(4);
    expect(csv).toContain("applied_at");
    const md = systemVoltageGateMarkdown(rows, summary, {
      applied: true,
      generated_at: "2026-09-01T00:00:00.000Z",
    });
    expect(md).toContain("120/240 V, 1φ, 3-wire");
    expect(systemVoltageGateKey({ table: "electrical_panels", stable_id: "PNL-H1" })).toBe(
      "electrical_panels|PNL-H1|system_voltage",
    );
  });

  it("resolves a stored jsonb designation and turns Category E into an agreement", () => {
    const stored = JSON.stringify(systemVoltagePayload(PROPOSED));
    expect(resolveSystemVoltage(stored)!.designation).toBe("120/240 V, 1φ, 3-wire");
    const r = numericDiagnostics(
      report([
        rec({}),
        rec({ field: "system_voltage", farmops_field: "system_voltage", farmops_value: stored }),
      ]),
    );
    expect(r.counts_by_category.E).toBe(0);
    expect(r.agreements).toBe(1);
  });
});
