import { describe, expect, it } from "vitest";
import {
  CONTRACT_COLUMN_COUNT,
  LOAD_MASTER_CONTRACT_V2,
  bindContract,
  contractCsv,
  simulateContractReimport,
  simulationCsv,
  triState,
} from "@/lib/electrical-load-import-contract";
import type { Sheet } from "@/lib/electrical-ods";

const header = LOAD_MASTER_CONTRACT_V2.map((c) => c.exact_header);

function row(overrides: Record<number, string>): string[] {
  const r = new Array(CONTRACT_COLUMN_COUNT).fill("");
  for (const [col, v] of Object.entries(overrides)) r[Number(col) - 1] = v;
  return r;
}

/** Two shared fixtures on one circuit group + one dedicated critical load. */
function sheet(): Sheet {
  return {
    name: "Load_Master",
    rows: [
      [...header],
      row({ 1: "FS-001", 2: "Shop lights A", 5: "S", 9: "CG-FS-01", 11: "PNL-FS-NW", 13: "20", 16: "600", 17: "0.6", 19: "Y", 24: "Critical", 28: "Y", 29: "600", 30: "1Ph" }),
      row({ 1: "FS-002", 2: "Shop lights B", 5: "S", 9: "CG-FS-01", 11: "PNL-FS-NW", 16: "400", 19: "N", 24: "Nice to Have", 26: "SOFT", 27: "TBD", 29: "TBD", 30: "TBD" }),
      row({ 1: "FS-082", 2: "Mini split", 5: "D", 11: "PNL-FS-EQ", 14: "240", 15: "15", 16: "3600", 18: "Circuit Capacity Only", 19: "Y", 24: "Critical", 39: "50%" }),
      row({ 1: "FS-003", 2: "Unassigned shared", 5: "S", 9: "TBD", 19: "TBD", 24: "" }),
    ],
  };
}

const rows = () =>
  [1, 2, 3, 4].map((i) => ({ sourceRow: i, stableId: sheet().rows[i][0] }));

describe("Load_Master Import Contract v2 — shape", () => {
  it("defines exactly 41 physical columns with unique positions", () => {
    expect(CONTRACT_COLUMN_COUNT).toBe(41);
    const positions = LOAD_MASTER_CONTRACT_V2.map((c) => c.physical_column);
    expect(new Set(positions).size).toBe(41);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("pins the explicitly required physical columns", () => {
    const at = (n: number) => LOAD_MASTER_CONTRACT_V2[n - 1];
    expect(at(5).canonical_semantic).toBe("dedicated_shared");
    expect(at(9).canonical_semantic).toBe("circuit_group_id");
    expect(at(10).canonical_semantic).toBe("circuit_group_description");
    expect(at(11).canonical_semantic).toBe("suggested_panel");
    expect(at(13).canonical_semantic).toBe("circuit_rating_amps");
    expect(at(16).canonical_semantic).toBe("connected_va");
    expect(at(17).canonical_semantic).toBe("connected_kva_display");
    expect(at(23).canonical_semantic).toBe("backup_eligible");
    expect(at(26).canonical_semantic).toBe("generator_start_class");
    expect(at(27).canonical_semantic).toBe("generator_start_amps");
    expect(at(28).canonical_semantic).toBe("continuous_load");
    expect(at(29).canonical_semantic).toBe("demand_va");
    expect(at(30).canonical_semantic).toBe("phase");
    expect(at(32).canonical_semantic).toBe("circuit_group_id_legacy");
    expect(at(33).canonical_semantic).toBe("circuit_group_description_legacy");
  });

  it("never gives column 17 a connected_va destination", () => {
    const kva = LOAD_MASTER_CONTRACT_V2[16];
    expect(kva.farmops_destination).toBeNull();
    expect(kva.import_action).toBe("DERIVED_REPRESENTATION_DO_NOT_IMPORT");
    expect(LOAD_MASTER_CONTRACT_V2[15].farmops_destination).toBe("connected_va");
  });

  it("reports generator start class/amps and circuit rating as schema gaps only", () => {
    for (const n of [13, 26, 27]) {
      const c = LOAD_MASTER_CONTRACT_V2[n - 1];
      expect(c.import_action).toBe("SCHEMA_EXTENSION_REQUIRED");
      expect(c.farmops_destination).toBeNull();
      expect(c.preservation_key).toBeTruthy();
    }
  });

  it("treats columns 34-41 as installation/as-built fields", () => {
    for (let n = 34; n <= 41; n++) {
      const c = LOAD_MASTER_CONTRACT_V2[n - 1];
      expect(c.import_action).toBe("AS_BUILT_FIELD");
      expect(c.authority === "field_observation" || c.authority === "generated").toBe(true);
    }
  });

  it("keeps duplicate circuit-group columns as legacy preserve, never authority", () => {
    for (const n of [10, 32, 33]) {
      const c = LOAD_MASTER_CONTRACT_V2[n - 1];
      expect(c.import_action).toBe("LEGACY_PRESERVE");
      expect(c.farmops_destination).toBeNull();
    }
  });
});

describe("tri-state representation", () => {
  it("distinguishes Y, N, TBD and blank losslessly", () => {
    expect(triState("Y")).toMatchObject({ state: "Y", bool: true, lossless: true });
    expect(triState("N")).toMatchObject({ state: "N", bool: false });
    expect(triState("TBD")).toMatchObject({ state: "TBD", bool: null, token: "TBD" });
    expect(triState("")).toMatchObject({ state: "BLANK", bool: null, token: "" });
    expect(triState("maybe")).toMatchObject({ state: "OUT_OF_VOCABULARY", bool: null });
  });
});

describe("binding by physical position + exact header", () => {
  it("binds every column of a conforming worksheet", () => {
    const b = bindContract(sheet(), 0);
    expect(b.bound).toBe(41);
    expect(b.unresolved).toBe(0);
    expect(b.extra_populated_columns).toEqual([]);
  });

  it("marks a shifted header UNRESOLVED instead of sliding onto a neighbour", () => {
    const s = sheet();
    s.rows[0][10] = "Panel Suggestion (old)";
    const b = bindContract(s, 0);
    const col = b.columns[10];
    expect(col.binding_status).toBe("HEADER_MISMATCH");
    expect(col.effective_action).toBe("UNRESOLVED");
    expect(b.columns[11].effective_action).not.toBe("UNRESOLVED");
  });
});

describe("re-import simulation", () => {
  it("achieves semantic loss = 0 on a conforming workbook", () => {
    const sim = simulateContractReimport({ sheet: sheet(), headerRow: 0, odsRows: rows() });
    expect(sim.row_count).toBe(4);
    expect(sim.totals.semantic_loss).toBe(0);
    expect(sim.accepted).toBe(true);
    expect(sim.totals.source_populated).toBeGreaterThan(0);
  });

  it("counts schema-blocked values but still represents them verbatim", () => {
    const sim = simulateContractReimport({ sheet: sheet(), headerRow: 0, odsRows: rows() });
    const gen = sim.fields.find((f) => f.field === "generator_start_amps")!;
    expect(gen.source_populated).toBe(1);
    expect(gen.schema_blocked).toBe(1);
    expect(gen.semantic_loss).toBe(0);
    expect(sim.rows[1].captured["Generator Start Amps#27"]).toBe("TBD");
  });

  it("never imports the derived kVA column", () => {
    const sim = simulateContractReimport({ sheet: sheet(), headerRow: 0, odsRows: rows() });
    const kva = sim.fields.find((f) => f.field === "connected_kva_display")!;
    expect(kva.would_import).toBe(0);
    expect(sim.rows[0].record.connected_va).toBe(600);
  });

  it("reports unresolved bindings as semantic loss", () => {
    const s = sheet();
    s.rows[0][18] = "Crit?";
    const sim = simulateContractReimport({ sheet: s, headerRow: 0, odsRows: rows() });
    const crit = sim.fields.find((f) => f.physical_column === 19)!;
    expect(crit.import_action).toBe("UNRESOLVED");
    expect(crit.semantic_loss).toBe(crit.source_populated);
    expect(sim.accepted).toBe(false);
  });

  it("reproduces the canonical ODS-derived business-rule result", () => {
    const sim = simulateContractReimport({ sheet: sheet(), headerRow: 0, odsRows: rows() });
    expect(sim.reproduces_canonical).toBe(true);
    expect(sim.rule_deltas.every((d) => d.matches)).toBe(true);
    // Derived from the fixture by the rules themselves, not asserted as a constant
    // mapping: two shared rows fold to one circuit, the dedicated row is its own,
    // and the blank/TBD shared row stays unresolved.
    expect(sim.simulated_rules.physical_rows).toBe(4);
    expect(sim.simulated_rules.logical_circuits).toBe(2);
    expect(sim.simulated_rules.unresolved_shared_circuits).toBe(1);
    expect(sim.simulated_rules.critical_logical_circuits).toBe(2);
  });

  it("emits CSV for the contract and the simulation", () => {
    const sim = simulateContractReimport({ sheet: sheet(), headerRow: 0, odsRows: rows() });
    expect(contractCsv(sim.binding).split("\n")).toHaveLength(42);
    expect(simulationCsv(sim).split("\n")).toHaveLength(42);
  });
});
