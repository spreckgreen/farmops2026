import { describe, expect, it } from "vitest";
import {
  CONTRACT_V3_FROZEN,
  SUPERSEDED_CANONICAL_VALUES,
  WITHHELD_CURRENT_SEMANTICS,
  buildV3Reconciliation,
  reconciliationCsv,
  type CanonicalProjectedRow,
} from "@/lib/electrical-contract-v3-reconciliation";
import { bindContract } from "@/lib/electrical-load-import-contract";
import { buildContractV3 } from "@/lib/electrical-load-contract-v3";
import type { Sheet } from "@/lib/electrical-ods";

const HEADERS = [
  "Load ID",
  "Area",
  "Load Description",
  "Volts",
  "Amps",
  "Connected VA",
  "Connected kVA",
  "Circuit Group Description",
  "Circuit Rating Amps",
  "Install Status",
  "Panel Side Connected",
  "Analysis Notes",
];

function fixture(rows: string[][]) {
  const sheet: Sheet = { name: "Load_Master", rows: [HEADERS, ...rows] };
  const contract = buildContractV3(sheet, 0);
  const binding = bindContract(sheet, 0, contract);
  const canonicalRows: CanonicalProjectedRow[] = rows.map((r, i) => {
    const raw: Record<number, string> = {};
    binding.columns.forEach((c) => {
      raw[c.physical_column] = String(sheet.rows[i + 1]?.[c.physical_column - 1] ?? "").trim();
    });
    return { stable_id: String(r[0]), raw };
  });
  return { binding, canonicalRows };
}

const live = (over: Partial<Parameters<typeof buildV3Reconciliation>[0]["live"]> = {}) => ({
  ods_sha256: CONTRACT_V3_FROZEN.authorized_sha256,
  observed_columns: CONTRACT_V3_FROZEN.observed_columns,
  bound_columns: CONTRACT_V3_FROZEN.bound_columns,
  row_count: CONTRACT_V3_FROZEN.canonical_rows,
  semantic_loss: 0,
  unknown_populated_columns: 0,
  critical_rules_pass: true,
  ...over,
});

const run = (rows: string[][], farmOpsRows: Record<string, unknown>[], liveOver = {}) => {
  const { binding, canonicalRows } = fixture(rows);
  return buildV3Reconciliation({ binding, canonicalRows, farmOpsRows, live: live(liveOver) });
};

const cell = (r: ReturnType<typeof run>, id: string, semantic: string) =>
  r.records.find((x) => x.stable_id === id && x.semantic === semantic)!;

describe("Contract v3 reconciliation — frozen acceptance baseline", () => {
  it("freezes the accepted v3 facts and the intentionally empty unbound column", () => {
    expect(CONTRACT_V3_FROZEN.authorized_sha256).toBe(
      "89da43c7f1f94948e17ecfdc942dbdba022cfee5ba504b70865529cf39877388",
    );
    expect(CONTRACT_V3_FROZEN.observed_columns).toBe(41);
    expect(CONTRACT_V3_FROZEN.bound_columns).toBe(40);
    expect(CONTRACT_V3_FROZEN.canonical_rows).toBe(138);
    expect(CONTRACT_V3_FROZEN.semantic_loss).toBe(0);
    expect(CONTRACT_V3_FROZEN.intentionally_empty_unbound_columns).toEqual([
      { physical_column: 31, header: "Analysis Notes" },
    ]);
  });

  it("fails the baseline check when the workbook is not the authorized SHA", () => {
    const r = run([["FS-001", "Farm Shop", "Light", "120", "", "", "", "", "", "", "", ""]], [], {
      ods_sha256: "f".repeat(64),
    });
    expect(r.acceptance.sha_authorized).toBe(false);
    expect(r.acceptance.frozen_baseline_reproduced).toBe(false);
    expect(r.ready_to_proceed).toBe(false);
  });
});

describe("Contract v3 reconciliation — authority model", () => {
  const row = (over: string[] = []) => {
    const base = ["FS-001", "Farm Shop", "Light", "240", "10", "1200", "1.2", "Lighting A", "20", "Complete", "Y", ""];
    over.forEach((v, i) => {
      if (v !== undefined) base[i] = v;
    });
    return base;
  };

  it("classifies identical and normalization-equivalent values without action", () => {
    const r = run(
      [row()],
      [{ load_id: "FS-001", area: "Farm Shop", description: "Light", volts: 240, amps: "10.0", connected_va: 1200, install_status: "Complete" }],
    );
    expect(cell(r, "FS-001", "area").classification).toBe("MATCH");
    expect(cell(r, "FS-001", "amps").classification).toBe("NORMALIZATION_EQUIVALENT");
    expect(r.counts.NOT_REPRESENTABLE).toBe(0);
  });

  it("never imports a derived representation and never overwrites a legacy duplicate", () => {
    const r = run([row()], [{ load_id: "FS-001" }]);
    expect(cell(r, "FS-001", "connected_kva_display").classification).toBe("DERIVED_DO_NOT_IMPORT");
    expect(cell(r, "FS-001", "circuit_group_description").classification).toBe("LEGACY_PRESERVED");
  });

  it("keeps a schema-gap canonical value as a repair candidate rather than a write", () => {
    const r = run([row()], [{ load_id: "FS-001" }]);
    const c = cell(r, "FS-001", "circuit_rating_amps");
    expect(c.classification).toBe("CANONICAL_VALUE_MISSING_IN_FARMOPS");
    expect(c.proposed_action).toContain("SCHEMA EXTENSION REQUIRED");
  });

  it("leaves as-built and field-work state with FarmOps", () => {
    const r = run(
      [row([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, "Complete"])],
      [{ load_id: "FS-001", install_status: "In progress" }],
    );
    expect(cell(r, "FS-001", "install_status").classification).toBe("FARMOPS_AS_BUILT_AUTHORITY");
    expect(cell(r, "FS-001", "panel_side_connected").classification).toBe(
      "FARMOPS_AS_BUILT_AUTHORITY",
    );
  });

  it("never blanks recorded FarmOps evidence from an older blank workbook cell", () => {
    const r = run(
      [row([undefined, undefined, undefined, ""])],
      [{ load_id: "FS-001", volts: 240 }],
    );
    expect(cell(r, "FS-001", "volts").classification).toBe("NEWER_FARMOPS_EVIDENCE");
    expect(r.headline.newer_evidence).toBeGreaterThan(0);
  });

  it("reports a genuine engineering difference as a repair candidate, not an overwrite", () => {
    const r = run([row()], [{ load_id: "FS-001", volts: 120 }]);
    const c = cell(r, "FS-001", "volts");
    expect(c.classification).toBe("FARMOPS_VALUE_DIFFERS");
    expect(c.authority).toBe("canonical_ods");
    expect(c.proposed_action).toContain("no automatic overwrite");
  });

  it("keeps the four unresolved current-semantic findings withheld", () => {
    expect(WITHHELD_CURRENT_SEMANTICS).toHaveLength(4);
    const r = run(
      [
        ["FS-082", "Farm Shop", "Mini split", "240", "0", "", "", "", "", "", "", ""],
        ["FS-084", "Farm Shop", "Welder", "240", "60", "0", "", "", "", "", "", ""],
      ],
      [
        { load_id: "FS-082", amps: 5 },
        { load_id: "FS-084", amps: 25, connected_va: 7000 },
      ],
    );
    expect(cell(r, "FS-082", "amps").classification).toBe("CURRENT_SEMANTICS_WITHHELD");
    expect(cell(r, "FS-084", "amps").classification).toBe("CURRENT_SEMANTICS_WITHHELD");
    expect(cell(r, "FS-084", "connected_va").classification).toBe("CURRENT_SEMANTICS_WITHHELD");
  });

  it("never reintroduces the superseded FS-082 / FS-083 120 V canonical value", () => {
    expect(SUPERSEDED_CANONICAL_VALUES.map((s) => s.stable_id)).toEqual(["FS-082", "FS-083"]);
    const r = run(
      [
        ["FS-082", "Farm Shop", "Mini split", "120", "", "", "", "", "", "", "", ""],
        ["FS-083", "Farm Shop", "Mini split", "120", "", "", "", "", "", "", "", ""],
      ],
      [
        { load_id: "FS-082", volts: 240 },
        { load_id: "FS-083", volts: 240 },
      ],
    );
    for (const id of ["FS-082", "FS-083"]) {
      const c = cell(r, id, "volts");
      expect(c.classification).toBe("CANONICAL_CORRECTION_PENDING");
      expect(c.proposed_action).toContain("DO NOT IMPORT");
    }
    expect(r.headline.withheld).toBeGreaterThan(0);
  });

  it("gives every non-match an explicit authority, action and evidence", () => {
    const r = run(
      [row()],
      [{ load_id: "FS-001", volts: 120, install_status: "In progress" }],
    );
    for (const rec of r.records.filter((x) => x.classification !== "MATCH")) {
      expect(rec.authority.length, rec.semantic).toBeGreaterThan(0);
      expect(rec.proposed_action.length, rec.semantic).toBeGreaterThan(0);
      expect(rec.evidence.length, rec.semantic).toBeGreaterThan(0);
    }
    expect(r.headline.not_representable).toBe(0);
    expect(r.headline.semantic_loss).toBe(0);
  });

  it("ignores the empty unbound Analysis Notes column but flags a populated unbound cell", () => {
    const clean = run([["FS-001", "", "", "", "", "", "", "", "", "", "", ""]], [{ load_id: "FS-001" }]);
    expect(clean.counts.NOT_REPRESENTABLE).toBe(0);
    const dirty = run(
      [["FS-001", "", "", "", "", "", "", "", "", "", "", "note text"]],
      [{ load_id: "FS-001" }],
    );
    expect(dirty.counts.NOT_REPRESENTABLE).toBe(1);
    expect(dirty.ready_to_proceed).toBe(false);
  });

  it("exports the full record set and performs no writes", () => {
    const r = run([row()], [{ load_id: "FS-001" }]);
    expect(reconciliationCsv(r).split("\n")[0]).toContain(
      "canonical_raw,canonical_normalized,farmops_current,authority,classification",
    );
    expect(r.read_only).toBe(true);
    expect(r.farmops_written).toBe(false);
    expect(r.apply_gate_authorized).toBe(false);
    expect(r.phase_45_authorized).toBe(false);
    expect(String(buildV3Reconciliation)).not.toMatch(/insert\(|update\(|upsert\(|delete\(/);
  });
});
