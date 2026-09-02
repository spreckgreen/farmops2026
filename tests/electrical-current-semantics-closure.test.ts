import { describe, expect, it } from "vitest";
import {
  planCurrentSemanticsClosure,
  closureCsv,
  closureMarkdown,
  CLOSURE_FIXTURE_IDS,
} from "@/lib/electrical-current-semantics-closure";
import {
  makeAdjudicationBaseline,
  PHASE_44A_BASELINE_SHA256,
  PHASE_44A_BASELINE_ODS_FILE,
} from "@/lib/electrical-adjudication-baseline";
import type { FarmOpsLoadRow } from "@/lib/electrical-load-adjudication-production";

const sheets = [
  {
    name: "Loads",
    rows: [
      ["Load ID", "Description", "Volts", "Amps", "Connected VA"],
      ["FS-082", "Bryant ductless", "120", "0", "0"],
      ["FS-083", "Bryant ductless", "120", "0", "0"],
      ["FS-084", "Bryant ductless", "240", "60", "14400"],
      ["FS-034", "Well pump", "240", "10", "2400"],
      ["FS-092", "Shop receptacles", "120", "12", "1000"],
    ],
  },
];

const baseline = makeAdjudicationBaseline({
  ods_file_name: PHASE_44A_BASELINE_ODS_FILE,
  ods_sha256: PHASE_44A_BASELINE_SHA256,
  sheets: sheets as never,
});

function row(id: string, amps: number | null, extra: Partial<FarmOpsLoadRow> = {}): FarmOpsLoadRow {
  return {
    id: `u-${id}`,
    load_id: id,
    description: null,
    equipment_model: null,
    volts: 240,
    amps,
    connected_va: null,
    demand_va: null,
    source_circuit: null,
    circuit_group_ref: null,
    source_reference: null,
    notes: null,
    ...extra,
  };
}

const rows = [row("FS-082", 0), row("FS-083", 0), row("FS-084", 25), row("FS-034", 10), row("FS-092", 12)];

describe("current-semantics closure plan", () => {
  const plan = planCurrentSemanticsClosure({ baseline, rows });

  it("classifies the legacy column as semantically overloaded", () => {
    expect(plan.verdict).toBe("SEMANTICALLY_OVERLOADED_LEGACY_FIELD");
    expect(plan.conflicting_usages.length).toBeGreaterThan(1);
  });

  it("reports all eight candidate meanings with confidence and migration impact", () => {
    expect(plan.candidates.map((c) => c.candidate).sort()).toEqual(
      [
        "connected_load_current",
        "design_circuit_ampacity",
        "equipment_fla",
        "installed_ocp_rating",
        "maximum_overcurrent_protection",
        "minimum_circuit_ampacity",
        "rated_current_amps",
        "rated_load_amps",
      ].sort(),
    );
    for (const c of plan.candidates) {
      expect(c.migration_impact.length).toBeGreaterThan(10);
      expect(["established", "probable", "possible", "unresolved"]).toContain(c.confidence);
    }
  });

  it("never treats numeric coincidence with MOCP as support", () => {
    const mocp = plan.candidates.find((c) => c.candidate === "maximum_overcurrent_protection")!;
    expect(mocp.supporting_rows).toEqual([]);
    expect(mocp.viable_as_column_meaning).toBe(false);
  });

  it("recommends a minimum additive schema that keeps the legacy column", () => {
    const required = plan.additive_schema.filter((a) => a.required_now).map((a) => a.element);
    expect(required.join(" ")).toMatch(/amps — retained unchanged/);
    expect(required.join(" ")).toMatch(/amps_semantic/);
    expect(required.join(" ")).toMatch(/connected_load_current/);
    expect(plan.minimum_additive_schema_summary).toMatch(/nothing is backfilled/i);
  });

  it("assigns no Bryant value to a target field and states exit criteria", () => {
    expect(plan.exit_criteria.map((e) => e.stable_id)).toEqual([...CLOSURE_FIXTURE_IDS]);
    for (const e of plan.exit_criteria) {
      expect(e.proposed_target_field).toBeNull();
      expect(e.must_become_true.length).toBeGreaterThan(3);
    }
  });

  it("stays read-only and exports both formats", () => {
    expect(plan.read_only).toBe(true);
    expect(plan.apply_available).toBe(false);
    expect(plan.numeric_corrections_authorized).toBe(false);
    expect(closureCsv(plan).split("\n")).toHaveLength(9);
    expect(closureMarkdown(plan)).toMatch(/Current-semantics closure plan/);
  });

  it("honours explicit provenance when a source states a concept", () => {
    const p = planCurrentSemanticsClosure({
      baseline,
      rows: rows.map((r) =>
        r.load_id === "FS-034" ? { ...r, notes: "Installed breaker rating observed in field" } : r,
      ),
    });
    const ocp = p.candidates.find((c) => c.candidate === "installed_ocp_rating")!;
    expect(ocp.supporting_rows).toContain("FS-034");
    expect(p.rows_with_stated_concept).toBe(1);
  });
});
