import { describe, expect, it } from "vitest";
import {
  BRYANT_VOLTAGE_LOAD_IDS,
  bryantProvenanceHolds,
  bryantVoltageGateCsv,
  bryantVoltageGateKey,
  bryantVoltageGateMarkdown,
  stillSafeToApplyBryantVoltage,
  summarizeBryantVoltageGate,
  type BryantVoltageGateRow,
} from "@/lib/electrical-bryant-voltage-gate";
import { equipmentFor } from "@/lib/electrical-equipment-provenance";

const equipment = equipmentFor("FS-082");

const input = (over: Partial<Parameters<typeof stillSafeToApplyBryantVoltage>[0]> = {}) => ({
  stable_id: "FS-082",
  live_volts: 120 as number | null,
  equipment,
  adjudication_bucket: "farmops_value_incompatible_with_verified_equipment" as string | null,
  ods_volts: 240 as number | null,
  ...over,
});

describe("Phase 4.4b — Bryant nominal supply voltage apply gate", () => {
  it("authorizes exactly FS-082 and FS-083", () => {
    expect([...BRYANT_VOLTAGE_LOAD_IDS]).toEqual(["FS-082", "FS-083"]);
    for (const id of ["FS-084", "FS-034", "FS-092"]) {
      const r = stillSafeToApplyBryantVoltage(input({ stable_id: id }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe("not_approved");
    }
  });

  it("allows the reviewed 120 V rows", () => {
    expect(stillSafeToApplyBryantVoltage(input()).ok).toBe(true);
    expect(stillSafeToApplyBryantVoltage(input({ stable_id: "FS-083" })).ok).toBe(true);
  });

  it("reports already_correct once the row is at 240", () => {
    const r = stillSafeToApplyBryantVoltage(input({ live_volts: 240 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe("already_correct");
  });

  it("refuses a drifted scalar or a drifted canonical value", () => {
    for (const over of [{ live_volts: 208 }, { live_volts: null }, { ods_volts: 208 }]) {
      const r = stillSafeToApplyBryantVoltage(input(over));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe("drifted");
    }
  });

  it("refuses when equipment provenance no longer resolves", () => {
    const r = stillSafeToApplyBryantVoltage(input({ equipment: undefined }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe("conflict");
  });

  it("refuses when live adjudication no longer supports the correction", () => {
    for (const bucket of [null, "insufficient_provenance", "nominal_vs_nameplate_representation"]) {
      const r = stillSafeToApplyBryantVoltage(input({ adjudication_bucket: bucket }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe("conflict");
    }
  });

  it("keeps the rated equipment class verbatim and treats the XA3/XA4 suffix as non-blocking", () => {
    expect(equipment!.semantics.rated_equipment_voltage_class).toBe("208/230");
    expect(equipment!.semantics.nominal_supply_voltage).toBe(240);
    expect(equipment!.semantics.minimum_circuit_ampacity).toBeNull();
    expect(equipment!.discrepancies.map((d) => d.code)).toContain(
      "INDOOR_MODEL_SUFFIX_VERIFICATION_REQUIRED",
    );
    expect(bryantProvenanceHolds(equipment).ok).toBe(true);
  });

  it("blocks on conflicting newer evidence outside the known suffix question", () => {
    const tampered = {
      ...equipment!,
      discrepancies: [
        ...equipment!.discrepancies,
        {
          code: "SUPPLY_VOLTAGE_CONFLICT",
          detail: "new photo shows a 120 V circuit",
          status: "conflicting_evidence" as const,
          resolves_with: [],
        },
      ],
    };
    expect(bryantProvenanceHolds(tampered).ok).toBe(false);
    const r = stillSafeToApplyBryantVoltage(input({ equipment: tampered }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe("conflict");
  });

  it("reconciles every row into exactly one status bucket and exports it", () => {
    const rows: BryantVoltageGateRow[] = ["applied", "drifted"].map((status, i) => ({
      table: "electrical_loads",
      stable_id: BRYANT_VOLTAGE_LOAD_IDS[i]!,
      row_uuid: null,
      column: "volts",
      live_volts: 120,
      proposed_volts: 240,
      rated_equipment_voltage: "208/230",
      phase: "1",
      frequency_hz: 60,
      status: status as BryantVoltageGateRow["status"],
      applied_at: status === "applied" ? "2026-09-01T00:00:00.000Z" : null,
    }));
    const summary = summarizeBryantVoltageGate(rows);
    expect(summary.reconciles).toBe(true);
    expect(summary.applied).toBe(1);
    expect(summary.drifted).toBe(1);
    const csv = bryantVoltageGateCsv(rows);
    expect(csv.split("\n")).toHaveLength(3);
    expect(csv).toContain("208/230");
    // The class is never collapsed to a scalar 230 in any cell.
    expect(csv.split("\n").slice(1).flatMap((l) => l.split(","))).not.toContain("230");
    const md = bryantVoltageGateMarkdown(rows, summary, {
      applied: true,
      generated_at: "2026-09-01T00:00:00.000Z",
    });
    expect(md).toContain("208/230 VAC, 1Ø, 60 Hz");
    expect(bryantVoltageGateKey({ table: "electrical_loads", stable_id: "FS-082" })).toBe(
      "electrical_loads|FS-082|volts",
    );
  });
});
