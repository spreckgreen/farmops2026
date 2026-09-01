// Phase 4.4b — final load semantic adjudication with verified equipment provenance.
import { describe, expect, it } from "vitest";
import {
  adjudicateLoads,
  adjudicationCsv,
  adjudicationMarkdown,
  hasOcpProvenance,
  hasVoltageConceptProvenance,
} from "@/lib/electrical-load-adjudication";
import {
  buildProductionAdjudicationInput,
  evidenceFromFarmOps,
  type FarmOpsLoadRow,
} from "@/lib/electrical-load-adjudication-production";
import { equipmentFor } from "@/lib/electrical-equipment-provenance";

/** Live production values as stored in electrical_loads. */
const PRODUCTION_ROWS: FarmOpsLoadRow[] = [
  row("FS-034", "Shop Lift", 220, 30, 6600, "TBD"),
  row("FS-082", "Mini Split SE", 120, 0, 0, "0%"),
  row("FS-083", "Mini Split E", 120, 0, 0, "0%"),
  row("FS-084", "Mini Split W", 240, 60, 14400, "TBD"),
  row("FS-092", "Emergency shop purge (Fan/Louvers)", 115, 8.8, 1012, "No"),
];

function row(
  load_id: string,
  description: string,
  volts: number,
  amps: number,
  connected_va: number,
  notes: string,
): FarmOpsLoadRow {
  return {
    id: `uuid-${load_id}`,
    load_id,
    description,
    equipment_model: null,
    volts,
    amps,
    connected_va,
    demand_va: null,
    source_circuit: null,
    circuit_group_ref: null,
    source_reference: null,
    notes,
  };
}

const production = () =>
  adjudicateLoads(buildProductionAdjudicationInput(PRODUCTION_ROWS), "2026-09-01T18:00:00.000Z");

const find = (id: string, field: string) =>
  production().findings.find((f) => f.stable_id === id && f.field === field)!;

describe("production adjudication", () => {
  it("reconciles to exactly nine findings across the buckets", () => {
    const r = production();
    expect(r.total_findings).toBe(9);
    expect(Object.values(r.counts).reduce((a, b) => a + b, 0)).toBe(9);
  });

  it("keeps one finding per differing field per load", () => {
    const r = production();
    const byLoad = (id: string) => r.findings.filter((f) => f.stable_id === id).map((f) => f.field);
    expect(byLoad("FS-034").sort()).toEqual(["connected_va", "volts"]);
    expect(byLoad("FS-082").sort()).toEqual(["amps", "volts"]);
    expect(byLoad("FS-083").sort()).toEqual(["amps", "volts"]);
    expect(byLoad("FS-084")).toEqual(["amps"]);
    expect(byLoad("FS-092").sort()).toEqual(["connected_va", "volts"]);
  });

  it("treats FS-034 and FS-092 voltage as nominal vs nameplate on equipment provenance", () => {
    for (const [id, nominal, nameplate] of [
      ["FS-034", 240, 220],
      ["FS-092", 120, 115],
    ] as const) {
      const f = find(id, "volts");
      expect(f.bucket).toBe("nominal_vs_nameplate_representation");
      expect(f.recommendation).toBe("PRESERVE_BOTH_AS_DISTINCT_SEMANTICS");
      expect(f.equipment_evidence.length).toBeGreaterThan(1);
      expect(f.semantic_interpretation).toContain(`nominal_supply_voltage = ${nominal}`);
      expect(f.proposed_representation.map((p) => p.field)).toContain("rated_nameplate_voltage");
      expect(f.semantic_interpretation).toContain(`${nameplate} V`);
    }
  });

  it("treats the VA differences as a documented calculation-basis difference", () => {
    for (const id of ["FS-034", "FS-092"]) {
      const f = find(id, "connected_va");
      expect(f.bucket).toBe("calculation_basis_difference");
      expect(f.recommendation).toBe("PRESERVE_BOTH_AS_DISTINCT_SEMANTICS");
      expect(f.proposed_representation.map((p) => p.field)).toEqual(["connected_va_basis"]);
    }
  });

  it("supports canonical 240 V for the Bryant units and never collapses 208/230", () => {
    for (const id of ["FS-082", "FS-083"]) {
      const f = find(id, "volts");
      expect(f.bucket).toBe("farmops_value_incompatible_with_verified_equipment");
      expect(f.recommendation).toBe("CORRECT_FARMOPS_WITH_SEMANTIC_REPRESENTATION");
      const rated = f.proposed_representation.find((p) => p.field === "rated_equipment_voltage")!;
      expect(rated.value).toBe("208/230");
      const nominal = f.proposed_representation.find((p) => p.field === "nominal_supply_voltage")!;
      expect(nominal.value).toBe("240");
      // Recommendation only — nothing is written by adjudication.
      expect(f.missing_evidence.join(" ")).toMatch(/not written in this phase/);
    }
  });

  it("adjudicates the Bryant amperages against the established 25 A MOCP", () => {
    const fs082 = find("FS-082", "amps");
    expect(fs082.bucket).toBe("amp_semantic_provenance_required");
    expect(fs082.reason).toMatch(/does not equal/);

    const fs083 = find("FS-083", "amps");
    expect(fs083.bucket).toBe("consistent_with_manufacturer_mocp");
    expect(fs083.recommendation).toBe("NO_CHANGE");
    expect(fs083.reason).toMatch(/not a claim that the canonical amps column semantically means MOCP/);

    const fs084 = find("FS-084", "amps");
    expect(fs084.bucket).toBe("farmops_amp_semantic_or_source_requires_review");
    expect(fs084.reason).toMatch(/not silently changed to 25 A/);
    expect(fs084.farmops_value).toBe(60);
  });

  it("keeps MCA unset while RCA, RLA and MOCP stay distinct", () => {
    for (const id of ["FS-082", "FS-083", "FS-084"]) {
      const rep = find(id, "amps").proposed_representation;
      const val = (field: string) => rep.find((p) => p.field === field)!.value;
      expect(val("maximum_overcurrent_protection")).toBe("25 A");
      expect(val("rated_current_amps")).toBe("1.69 A");
      expect(val("rated_load_amps")).toBe("4.15 A");
      expect(val("minimum_circuit_ampacity")).toMatch(/must remain NULL/);
    }
    const eq = equipmentFor("FS-082")!;
    expect(eq.semantics.minimum_circuit_ampacity).toBeNull();
    expect(eq.semantics.maximum_overcurrent_protection).toBe(25);
    expect(eq.semantics.rated_current_amps).toBe(1.69);
    expect(eq.semantics.rated_load_amps).toBe(4.15);
    expect(eq.semantics.frequency_hz).toBe(60);
  });

  it("models the mini-split as one load with two equipment components", () => {
    const eq = equipmentFor("FS-084")!;
    expect(eq.components.map((c) => c.role)).toEqual(["outdoor_unit", "indoor_unit"]);
    expect(eq.components[0].model).toBe("37MARAQ24AA3");
    expect(eq.components[1].model_verified).toBe(false);
    // All three installations resolve to the same configuration.
    for (const id of ["FS-082", "FS-083", "FS-084"]) {
      const e = equipmentFor(id)!;
      expect(e.model).toBe(eq.model);
      expect(e.semantics.rated_equipment_voltage_class).toBe("208/230");
      expect(e.semantics.nominal_supply_voltage).toBe(240);
    }
  });

  it("groups the three Bryant installations and preserves the suffix discrepancy", () => {
    const r = production();
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].members).toEqual(["FS-082", "FS-083", "FS-084"]);
    expect(r.groups[0].loads.map((l) => l.stable_id)).toEqual(["FS-082", "FS-083", "FS-084"]);
    expect(r.discrepancies).toHaveLength(1);
    expect(r.discrepancies[0].code).toBe("INDOOR_MODEL_SUFFIX_VERIFICATION_REQUIRED");
    expect(r.discrepancies[0].stable_ids).toEqual(["FS-082", "FS-083", "FS-084"]);
    expect(r.discrepancies[0].resolves_with.length).toBeGreaterThan(0);
  });

  it("reports every finding with a recommendation, reason and provenance", () => {
    for (const f of production().findings) {
      expect(f.recommendation).toBeTruthy();
      expect(f.reason.length).toBeGreaterThan(20);
      expect(f.ods_provenance).toMatch(/worksheet/);
      expect(f.farmops_provenance).toMatch(/electrical_loads\./);
    }
  });

  it("shows not established rather than manufacturing ampacity concepts", () => {
    const bryant = production().loads.find((x) => x.stable_id === "FS-084")!;
    const concept = (label: string) => bryant.concepts.find((x) => x.concept === label)!;
    for (const label of ["Minimum circuit ampacity (MCA)", "Installed OCP rating"]) {
      expect(concept(label).value).toBe("not established");
      expect(concept(label).kind).toBe("not_established");
    }
    expect(concept("Maximum overcurrent protection (MOCP)").value).toBe("25 A");
    expect(concept("Maximum overcurrent protection (MOCP)").kind).toBe("observed");
    expect(concept("Rated current amps (RCA)").value).toBe("1.69 A");
    expect(concept("Rated load amps (RLA)").value).toBe("4.15 A");
    const lift = production().loads.find((x) => x.stable_id === "FS-034")!;
    expect(lift.concepts.find((c) => c.concept === "Equipment identity")!.value).toContain(
      "HL2C-10K",
    );
    expect(lift.concepts.find((c) => c.concept === "Rated / nameplate voltage")!.kind).toBe(
      "observed",
    );
  });

  it("stays read-only with no apply path", () => {
    const r = production();
    expect(r.read_only).toBe(true);
    expect(r.apply_available).toBe(false);
  });

  it("exports CSV and Markdown containing all nine findings", () => {
    const r = production();
    expect(adjudicationCsv(r).trim().split("\n")).toHaveLength(10);
    const md = adjudicationMarkdown(r);
    for (const id of ["FS-034", "FS-082", "FS-083", "FS-084", "FS-092"]) {
      expect(md).toContain(id);
    }
    expect(md).toContain("INDOOR_MODEL_SUFFIX_VERIFICATION_REQUIRED");
  });
});

describe("evidence gate without equipment provenance", () => {
  it("ignores placeholder notes as provenance", () => {
    const e = evidenceFromFarmOps(PRODUCTION_ROWS[3]);
    expect(hasOcpProvenance(e)).toBe(false);
    expect(hasVoltageConceptProvenance(e)).toBe(false);
  });

  it("falls back to insufficient provenance when equipment identity is stripped", () => {
    const input = buildProductionAdjudicationInput(PRODUCTION_ROWS).map((l) => ({
      ...l,
      equipment: undefined,
    }));
    const r = adjudicateLoads(input);
    expect(r.counts.insufficient_provenance).toBeGreaterThan(0);
    expect(r.groups).toEqual([]);
  });

  it("still classifies OCP mismatch from an affirmative OCP citation alone", () => {
    const input = buildProductionAdjudicationInput(PRODUCTION_ROWS).map((l) =>
      l.stable_id === "FS-084"
        ? {
            ...l,
            equipment: undefined,
            evidence: { ocp_field: "Panel PNL-FS-EQ 60 A 2-pole breaker serving this load" },
          }
        : l,
    );
    const f = adjudicateLoads(input).findings.find((x) => x.stable_id === "FS-084")!;
    expect(f.bucket).toBe("current_ocp_semantic_mismatch");
    expect(f.recommendation).toBe("PRESERVE_BOTH_AS_DISTINCT_SEMANTICS");
  });
});
