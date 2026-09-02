// Phase 4.4b — Bryant amperage semantic adjudication (read-only).
import { describe, expect, it } from "vitest";
import {
  adjudicateAmpSemantics,
  ampSemanticsCsv,
  ampSemanticsMarkdown,
  vaDerivation,
} from "@/lib/electrical-amp-semantics";
import type { FarmOpsLoadRow } from "@/lib/electrical-load-adjudication-production";
import { testBaseline } from "./helpers/adjudication-baseline";
import { openQuestionsFor } from "@/lib/electrical-adjudication-baseline";

/** Canonical ODS values confirmed for this adjudication. */
const CANONICAL: Array<[string, string, number, number, number, number]> = [
  ["FS-082", "Mini Split SE", 82, 120, 0, 0],
  ["FS-083", "Mini Split E", 83, 120, 0, 0],
  ["FS-084", "Mini Split W", 84, 240, 60, 14400],
];

const baseline = () =>
  testBaseline({
    loads: CANONICAL.map(([stable_id, description, row, volts, amps, connected_va]) => ({
      stable_id,
      description,
      worksheet: "Loads",
      row,
      volts,
      amps,
      connected_va,
      open_questions: openQuestionsFor(stable_id),
    })),
  });

const fp = (load_id: string, amps: number | null, notes: string | null): FarmOpsLoadRow => ({
  id: `uuid-${load_id}`,
  load_id,
  description: null,
  equipment_model: null,
  volts: null,
  amps,
  connected_va: null,
  demand_va: null,
  source_circuit: null,
  circuit_group_ref: null,
  source_reference: null,
  notes,
});

const ROWS = [fp("FS-082", 0, "0%"), fp("FS-083", 0, "0%"), fp("FS-084", 60, "TBD")];

const report = (rows = ROWS) =>
  adjudicateAmpSemantics({ baseline: baseline(), rows, generatedAt: "2026-09-02T00:00:00.000Z" });

const find = (id: string) => report().rows.find((r) => r.stable_id === id)!;

describe("VA derivation", () => {
  it("proves a Volts × Amps derivation", () => {
    expect(vaDerivation(240, 60, 14400).basis).toBe("derived_volts_times_amps");
    expect(vaDerivation(240, 30, 6600).basis).toBe("not_derived_from_volts_times_amps");
  });

  it("treats a zero product as indeterminate rather than proof", () => {
    expect(vaDerivation(120, 0, 0).basis).toBe("zero_product_indeterminate");
    expect(vaDerivation(null, 0, 0).basis).toBe("not_computable");
  });
});

describe("Bryant amperage semantic adjudication", () => {
  it("covers exactly the three loads in scope and preserves workbook identity", () => {
    const r = report();
    expect(r.rows.map((x) => x.stable_id)).toEqual(["FS-082", "FS-083", "FS-084"]);
    for (const row of r.rows) {
      expect(row.workbook_name).toBe("PremoFarmElectrical.ods");
      expect(row.workbook_sha256).toHaveLength(64);
      expect(row.worksheet).toBe("Loads");
      expect(row.worksheet_row).toBeGreaterThan(0);
    }
    expect(r.is_phase_44a_baseline).toBe(true);
  });

  it("leaves the amp field semantics unresolved for FS-084", () => {
    const r = find("FS-084");
    expect(r.disposition).toBe("AMP_FIELD_SEMANTICS_UNRESOLVED");
    expect(r.candidate_concepts).toEqual(
      expect.arrayContaining([
        "connected_load_current",
        "equipment_rated_current",
        "installed_breaker_ocp",
        "design_circuit_ampacity",
      ]),
    );
    expect(r.probes.every((p) => !p.proves_semantic)).toBe(true);
  });

  it("never replaces the ODS amps with the 25 A MOCP and never derives MCA", () => {
    for (const id of ["FS-082", "FS-083", "FS-084"]) {
      const r = find(id);
      expect(r.equipment_mocp).toBe(25);
      expect(r.rca).toBe(1.69);
      expect(r.rla).toBe(4.15);
      expect(r.mca).toBeNull();
      expect(r.mca_status).toMatch(/never derived/);
      expect(r.excluded_concepts.map((e) => e.concept)).toContain("minimum_circuit_ampacity");
      expect(r.recommended_action).toMatch(/Do not substitute the 25 A MOCP/);
    }
    // FS-084's 60 A is excluded from being MOCP, not rewritten to 25 A.
    expect(find("FS-084").ods_amps).toBe(60);
    expect(find("FS-084").excluded_concepts.map((e) => e.concept)).toContain(
      "maximum_overcurrent_protection",
    );
  });

  it("identifies 14400 VA as formula-driven from the questionable 60 A", () => {
    const r = find("FS-084");
    expect(r.va_basis).toBe("derived_volts_times_amps");
    expect(r.va_basis_proof).toMatch(/240 V × 60 A = 14400 VA/);
    expect(r.additional_dispositions).toContain("VA_DERIVED_FROM_UNRESOLVED_AMP_SEMANTIC");
  });

  it("does not accept 0 A as a verified zero-load condition", () => {
    for (const id of ["FS-082", "FS-083"]) {
      const r = find(id);
      expect(r.disposition).toBe("ZERO_AMPS_NOT_ESTABLISHED_AS_ZERO_LOAD");
      expect(r.additional_dispositions).toContain("AMP_FIELD_SEMANTICS_UNRESOLVED");
      expect(r.va_basis).toBe("zero_product_indeterminate");
      expect(r.va_basis_proof).toMatch(/neither proves nor disproves/);
    }
  });

  it("accepts an explicit provenance statement when one exists", () => {
    const r = adjudicateAmpSemantics({
      baseline: baseline(),
      rows: [fp("FS-084", 60, "60 A installed breaker OCP observed at PNL-FS-EQ")],
    }).rows.find((x) => x.stable_id === "FS-084")!;
    expect(r.disposition).toBe("AMP_SEMANTIC_ESTABLISHED_BY_PROVENANCE");
    expect(r.inferred_ods_amp_semantic).toMatch(/installed_breaker_ocp/);
  });

  it("reports missing loads instead of inventing canonical values", () => {
    const b = baseline();
    const r = adjudicateAmpSemantics({
      baseline: { ...b, loads: b.loads.filter((l) => l.stable_id !== "FS-083") },
      rows: ROWS,
    });
    expect(r.missing_load_ids).toEqual(["FS-083"]);
    expect(r.rows).toHaveLength(2);
  });

  it("is read-only with no apply path and exports the full table", () => {
    const r = report();
    expect(r.read_only).toBe(true);
    expect(r.apply_available).toBe(false);
    for (const row of r.rows) {
      expect(row.farmops_write_required).toBe(false);
      expect(row.ods_edit_authorized).toBe(false);
    }
    const csv = ampSemanticsCsv(r).trim().split("\n");
    expect(csv).toHaveLength(4);
    expect(csv[0]).toMatch(/^stable_id,workbook_name/);
    const md = ampSemanticsMarkdown(r);
    expect(md).toMatch(/no canonical ODS edit is authorized/i);
    for (const id of ["FS-082", "FS-083", "FS-084"]) expect(md).toContain(id);
  });
});
