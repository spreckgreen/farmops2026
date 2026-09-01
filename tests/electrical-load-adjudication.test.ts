// Phase 4.4b — final load semantic adjudication: production result + evidence gate.
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

describe("production adjudication", () => {
  it("reconciles to exactly nine findings across the four buckets", () => {
    const r = production();
    expect(r.total_findings).toBe(9);
    const sum = Object.values(r.counts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(9);
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

  it("treats 240 V vs 120 V as a true engineering disagreement", () => {
    const r = production();
    for (const id of ["FS-082", "FS-083"]) {
      const f = r.findings.find((x) => x.stable_id === id && x.field === "volts")!;
      expect(f.bucket).toBe("true_engineering_disagreement");
    }
  });

  it("does not infer OCP semantics for FS-084 from a standard breaker size", () => {
    const f = production().findings.find((x) => x.stable_id === "FS-084")!;
    expect(f.bucket).toBe("insufficient_provenance");
    expect(f.supporting_only.join(" ")).toMatch(/supporting evidence only/i);
    expect(f.recommendation).toBe("FIELD_OR_DOCUMENT_VERIFICATION_REQUIRED");
  });

  it("does not reclassify FS-034 / FS-092 on arithmetic compatibility alone", () => {
    const r = production();
    for (const id of ["FS-034", "FS-092"]) {
      for (const f of r.findings.filter((x) => x.stable_id === id)) {
        expect(f.bucket).toBe("insufficient_provenance");
        expect(f.evidence).toEqual([]);
      }
    }
    expect(r.counts.nominal_vs_nameplate_representation).toBe(0);
    expect(r.counts.current_ocp_semantic_mismatch).toBe(0);
    expect(r.counts.true_engineering_disagreement).toBe(2);
    expect(r.counts.insufficient_provenance).toBe(7);
  });

  it("reports every finding with a recommendation and a reason", () => {
    for (const f of production().findings) {
      expect(f.recommendation).toBeTruthy();
      expect(f.reason.length).toBeGreaterThan(20);
      expect(f.ods_provenance).toMatch(/worksheet/);
      expect(f.farmops_provenance).toMatch(/electrical_loads\./);
    }
  });

  it("shows not established rather than manufacturing concepts", () => {
    const l = production().loads.find((x) => x.stable_id === "FS-034")!;
    const ocp = l.concepts.find((c) => c.concept === "Circuit / OCP rating")!;
    expect(ocp.value).toBe("not established");
    expect(ocp.kind).toBe("not_established");
    const nameplate = l.concepts.find((c) => c.concept === "Rated / nameplate voltage")!;
    expect(nameplate.kind).toBe("inferred_candidate");
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
  });
});

describe("evidence gate", () => {
  it("ignores placeholder notes as provenance", () => {
    const e = evidenceFromFarmOps(PRODUCTION_ROWS[3]);
    expect(hasOcpProvenance(e)).toBe(false);
    expect(hasVoltageConceptProvenance(e)).toBe(false);
  });

  it("classifies OCP mismatch once affirmative provenance exists", () => {
    const input = buildProductionAdjudicationInput(PRODUCTION_ROWS).map((l) =>
      l.stable_id === "FS-084"
        ? { ...l, evidence: { ocp_field: "Panel PNL-FS-EQ 60 A 2-pole breaker serving this load" } }
        : l,
    );
    const f = adjudicateLoads(input).findings.find((x) => x.stable_id === "FS-084")!;
    expect(f.bucket).toBe("current_ocp_semantic_mismatch");
    expect(f.recommendation).toBe("PRESERVE_BOTH_AS_DISTINCT_SEMANTICS");
  });

  it("classifies nominal-vs-nameplate once voltage concepts are documented", () => {
    const input = buildProductionAdjudicationInput(PRODUCTION_ROWS).map((l) =>
      l.stable_id === "FS-034"
        ? {
            ...l,
            evidence: { equipment_spec: "Lift nameplate: 220 V rated voltage, 30 A" },
          }
        : l,
    );
    const r = adjudicateLoads(input);
    const volts = r.findings.find((x) => x.stable_id === "FS-034" && x.field === "volts")!;
    const va = r.findings.find((x) => x.stable_id === "FS-034" && x.field === "connected_va")!;
    expect(volts.bucket).toBe("nominal_vs_nameplate_representation");
    expect(va.bucket).toBe("nominal_vs_nameplate_representation");
  });
});
