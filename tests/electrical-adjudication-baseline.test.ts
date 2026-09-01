// Phase 4.4 — canonical adjudication baseline must be SHA-bound to the workbook.
import { describe, expect, it } from "vitest";
import {
  baselineAuthorizesApply,
  baselineLabel,
  canonicalLoad,
  makeAdjudicationBaseline,
  odsNumber,
  PHASE_44A_BASELINE_SHA256,
} from "@/lib/electrical-adjudication-baseline";
import { buildProductionAdjudicationInput } from "@/lib/electrical-load-adjudication-production";
import { adjudicateLoads } from "@/lib/electrical-load-adjudication";
import { testBaseline } from "./helpers/adjudication-baseline";

const liveRow = (load_id: string, volts: number | null) => ({
  id: `uuid-${load_id}`,
  load_id,
  description: load_id,
  equipment_model: null,
  volts,
  amps: 0,
  connected_va: 0,
  demand_va: null,
  source_circuit: null,
  circuit_group_ref: null,
  source_reference: null,
  notes: "0%",
});

describe("canonical baseline identity", () => {
  it("authorizes apply only for the confirmed Phase 4.4a SHA", () => {
    expect(baselineAuthorizesApply(testBaseline()).ok).toBe(true);
    const other = baselineAuthorizesApply(testBaseline({ ods_sha256: "a".repeat(64) }));
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.reason).toContain(PHASE_44A_BASELINE_SHA256);
    expect(baselineAuthorizesApply(null).ok).toBe(false);
  });

  it("refuses a load the workbook does not contain instead of back-filling it", () => {
    const b = testBaseline({ loads: [], missing_load_ids: ["FS-082"] });
    const guard = baselineAuthorizesApply(b, { stable_id: "FS-082" });
    expect(guard.ok).toBe(false);
    expect(canonicalLoad(b, "FS-082")).toBeUndefined();
  });

  it("produces no canonical findings when no baseline is attached", () => {
    const rows = [liveRow("FS-082", 120), liveRow("FS-083", 120)];
    const withBaseline = adjudicateLoads(buildProductionAdjudicationInput(rows, testBaseline()));
    const without = adjudicateLoads(buildProductionAdjudicationInput(rows, null));
    expect(withBaseline.total_findings).toBeGreaterThan(0);
    expect(without.total_findings).toBe(0);
  });

  it("records the workbook identity in the human label", () => {
    expect(baselineLabel(testBaseline())).toContain(PHASE_44A_BASELINE_SHA256);
    expect(baselineLabel(testBaseline({ ods_sha256: "b".repeat(64) }))).toContain(
      "NOT the Phase 4.4a baseline",
    );
    expect(baselineLabel(null)).toMatch(/no canonical/i);
  });

  it("parses workbook numbers without inventing values", () => {
    expect(odsNumber("1,056")).toBe(1056);
    expect(odsNumber("8.8 A")).toBe(8.8);
    expect(odsNumber("")).toBeNull();
    expect(odsNumber("TBD")).toBeNull();
  });

  it("reports adjudicated IDs that the workbook lacks", () => {
    const b = makeAdjudicationBaseline({
      ods_file_name: "empty.ods",
      ods_sha256: "c".repeat(64),
      sheets: [],
    });
    expect(b.loads).toEqual([]);
    expect(b.missing_load_ids).toContain("FS-082");
    expect(b.is_phase_44a_baseline).toBe(false);
  });
});
