import { describe, expect, it } from "vitest";

import {
  CURRENT_SEMANTIC_FIELDS,
  currentMigrationCsv,
  currentMigrationMarkdown,
  planCurrentSemanticMigration,
} from "@/lib/electrical-current-semantic-migration";
import { testBaseline } from "../tests/helpers/adjudication-baseline";
import type { FarmOpsLoadRow } from "@/lib/electrical-load-adjudication-production";

const farmops: FarmOpsLoadRow[] = [
  {
    id: "1",
    load_id: "FS-082",
    description: "Mini Split SE",
    equipment_model: null,
    volts: 240,
    amps: 0,
    connected_va: 0,
    demand_va: null,
    source_circuit: null,
    circuit_group_ref: null,
    source_reference: null,
    notes: null,
  } as unknown as FarmOpsLoadRow,
];

// Canonical ODS values as parsed from the SHA-bound Phase 4.4a baseline for the
// three Bryant fixtures.
const loads = [
  ["FS-082", "Mini Split SE", 82, 120, 0, 0],
  ["FS-083", "Mini Split E", 83, 120, 0, 0],
  ["FS-084", "Mini Split W", 84, 240, 60, 14400],
] as const;

const plan = () =>
  planCurrentSemanticMigration({
    baseline: testBaseline({
      loads: loads.map(([stable_id, description, row, volts, amps, connected_va]) => ({
        stable_id,
        description,
        worksheet: "Loads",
        row,
        volts,
        amps,
        connected_va,
        open_questions: [],
      })),
    }),
    rows: farmops,
  });

describe("current semantic migration planning", () => {
  it("defines the eight target current concepts", () => {
    expect(CURRENT_SEMANTIC_FIELDS).toEqual([
      "connected_load_current",
      "rated_current_amps",
      "rated_load_amps",
      "equipment_fla",
      "minimum_circuit_ampacity",
      "maximum_overcurrent_protection",
      "installed_ocp_rating",
      "design_circuit_ampacity",
    ]);
  });

  it("includes the Bryant fixtures with unresolved semantics", () => {
    const p = plan();
    for (const id of ["FS-082", "FS-083", "FS-084"]) {
      const row = p.rows.find((r) => r.stable_id === id);
      expect(row, id).toBeTruthy();
      expect(row!.is_fixture).toBe(true);
      expect(row!.confidence).toBe("unresolved");
      expect(row!.blockers).toContain("SEMANTIC_NOT_ESTABLISHED");
    }
    expect(p.missing_fixture_ids).toEqual([]);
  });

  it("never reads 0 A as a verified zero load", () => {
    const p = plan();
    for (const id of ["FS-082", "FS-083"]) {
      const row = p.rows.find((r) => r.stable_id === id)!;
      expect(row.ods_amps).toBe(0);
      expect(row.blockers).toContain("ZERO_VALUE_MEANING_NOT_ESTABLISHED");
      expect(row.semantic).toMatch(/not read as a verified zero-load/i);
    }
  });

  it("flags FS-084 connected VA as dependent on the unresolved current", () => {
    const row = plan().rows.find((r) => r.stable_id === "FS-084")!;
    expect(row.ods_amps).toBe(60);
    expect(row.ods_va).toBe(14400);
    const va = row.dependent_formulas.find((d) => d.field === "connected_va")!;
    expect(va.basis).toBe("derived_volts_times_amps");
    expect(va.depends_on_unresolved_current).toBe(true);
    expect(row.blockers).toContain("DEPENDENT_VA_ARITHMETIC_UNRESOLVED");
  });

  it("never proposes MCA as a target and never derives it", () => {
    for (const row of plan().rows) {
      expect(row.recommended_target_fields).not.toContain("minimum_circuit_ampacity");
      expect(row.excluded_fields.some((e) => e.field === "minimum_circuit_ampacity")).toBe(true);
      expect(row.manufacturer.minimum_circuit_ampacity).toBeNull();
    }
  });

  it("keeps the Bryant manufacturer values distinct and never uses MOCP as current", () => {
    const row = plan().rows.find((r) => r.stable_id === "FS-082")!;
    expect(row.manufacturer.maximum_overcurrent_protection).toBe(25);
    expect(row.manufacturer.rated_current_amps).toBe(1.69);
    expect(row.manufacturer.rated_load_amps).toBe(4.15);
    expect(row.ods_amps).toBe(0);
    expect(row.planned_action).toMatch(/Keep MOCP/);
  });

  it("is read-only with no apply path", () => {
    const p = plan();
    expect(p.read_only).toBe(true);
    expect(p.apply_available).toBe(false);
    expect(p.rows.every((r) => r.ods_edit_authorized === false)).toBe(true);
    expect(p.rows.every((r) => r.farmops_write_required === false)).toBe(true);
  });

  it("exports CSV and Markdown preserving workbook identity", () => {
    const p = plan();
    const csv = currentMigrationCsv(p);
    expect(csv.split("\n")[0]).toContain("recommended_target_fields");
    expect(csv).toContain(p.workbook_sha256);
    const md = currentMigrationMarkdown(p);
    expect(md).toContain("Target semantic schema");
    expect(md).toContain("PremoFarmElectrical.ods");
  });
});
