import { describe, expect, it } from "vitest";
import {
  bindContract,
  simulateContractReimport,
  type Sheet,
} from "@/lib/electrical-load-import-contract";
import { buildLossClosure, closureCsv } from "@/lib/electrical-load-loss-closure";

// Header row where the as-built tail carries the real workbook headers instead of
// the contract's declared ones, plus the derived and duplicate/legacy columns.
function sheet(): Sheet {
  const header = Array.from({ length: 41 }, (_, i) => `Col${i + 1}`);
  header[0] = "Load ID";
  header[13] = "Circuit Rating Amps";
  header[17] = "Connected kVA";
  header[24] = "Generator Start Class";
  header[25] = "Generator Start Amps";
  header[32] = "Circuit Group ID";
  header[33] = "Existing Panel";
  header[35] = "Installation Status";
  header[36] = "Conduit / Flex Run Complete";
  header[37] = "Device Side Connected";
  header[38] = "Panel Side Connected";
  header[39] = "Fixture / Device Installed";
  header[40] = "Installation Notes";

  const row = (id: string) => {
    const r = Array.from({ length: 41 }, () => "");
    r[0] = id;
    r[13] = "20";
    r[17] = "0.6";
    r[24] = "Across the line";
    r[25] = "TBD";
    r[32] = "CG-FS-01";
    r[33] = "PNL-FS-NW";
    r[35] = "Planned";
    r[36] = "Y";
    r[37] = "N";
    r[38] = "TBD";
    r[39] = "Y";
    r[40] = "pulled 12/2 to north wall";
    r[10] = "Col11 value"; // populated, unbound, unknown semantics
    return r;
  };
  return { name: "Load_Master", rows: [header, row("FS-001"), row("FS-002")] };
}

const report = () => {
  const s = sheet();
  const sim = simulateContractReimport({
    sheet: s,
    headerRow: 0,
    odsRows: [
      { sourceRow: 1, stableId: "FS-001" },
      { sourceRow: 2, stableId: "FS-002" },
    ],
  });
  return { sim, closure: buildLossClosure(sim.binding, sim.fields, sim.row_count) };
};

describe("Load_Master semantic-loss closure", () => {
  it("covers exactly the unbound physical columns", () => {
    const { sim, closure } = report();
    const unbound = bindContract(sheet(), 0).columns.filter(
      (c) => c.effective_action === "UNRESOLVED",
    );
    expect(closure.unbound_column_count).toBe(unbound.length);
    expect(closure.rows).toHaveLength(unbound.length);
    expect(closure.totals.semantic_loss_before).toBe(sim.totals.semantic_loss);
  });

  it("proposes first-class queryable fields for engineering/business-logic columns", () => {
    const { closure } = report();
    const method = (header: string) =>
      closure.rows.find((r) => r.observed_header === header)?.preservation_method;
    expect(method("Circuit Rating Amps")).toBe("FIRST_CLASS_FIELD");
    expect(method("Generator Start Class")).toBe("FIRST_CLASS_FIELD");
    expect(method("Generator Start Amps")).toBe("FIRST_CLASS_FIELD");
    expect(method("Existing Panel")).toBe("AS_BUILT_FIRST_CLASS_FIELD");
    expect(method("Installation Status")).toBe("AS_BUILT_FIRST_CLASS_FIELD");
    expect(method("Conduit / Flex Run Complete")).toBe("AS_BUILT_FIRST_CLASS_FIELD");
    expect(method("Device Side Connected")).toBe("AS_BUILT_FIRST_CLASS_FIELD");
    expect(method("Panel Side Connected")).toBe("AS_BUILT_FIRST_CLASS_FIELD");
    expect(method("Fixture / Device Installed")).toBe("AS_BUILT_FIRST_CLASS_FIELD");
    expect(method("Installation Notes")).toBe("AS_BUILT_FIRST_CLASS_FIELD");
    for (const r of closure.rows.filter((x) => x.schema_required)) {
      expect(r.schema_proposal).not.toBeNull();
    }
  });

  it("keeps derived and legacy columns out of independent import", () => {
    const { closure } = report();
    const kva = closure.rows.find((r) => r.observed_header === "Connected kVA");
    expect(kva?.preservation_method).toBe("DERIVED_REPRESENTATION");
    expect(kva?.schema_required).toBe(false);
    const legacy = closure.rows.find(
      (r) => r.physical_column === 33 && r.observed_header === "Circuit Group ID",
    );
    expect(legacy?.preservation_method).toBe("LEGACY_FIELD");
    expect(legacy?.schema_required).toBe(false);
  });

  it("gives tri-state semantics for as-built completion states", () => {
    const { closure } = report();
    const p = closure.rows.find((r) => r.observed_header === "Device Side Connected")
      ?.schema_proposal;
    expect(p?.tri_state).toBe(true);
    expect(p?.allowed_states).toEqual(["Y", "N", "TBD", "(blank)"]);
  });

  it("uses structured extras rather than a column for unknown populated headers", () => {
    const { closure } = report();
    const r = closure.rows.find((x) => x.physical_column === 11);
    expect(r?.preservation_method).toBe("STRUCTURED_ODS_EXTRA");
    expect(r?.schema_required).toBe(false);
    expect(r?.populated_cells).toBe(2);
  });

  it("treats unpopulated unbound columns as zero semantic content", () => {
    const { closure } = report();
    const empty = closure.rows.filter((r) => r.populated_cells === 0);
    expect(empty.length).toBeGreaterThan(0);
    for (const r of empty) {
      expect(r.preservation_method).toBe("INTENTIONALLY_IGNORED_WITH_ZERO_SEMANTIC_CONTENT");
      expect(r.semantic_loss_cells).toBe(0);
    }
  });

  it("balances the closure arithmetic and closes when nothing is unresolved", () => {
    const { closure } = report();
    const t = closure.totals;
    expect(
      t.removed_by_first_class +
        t.removed_by_structured_preservation +
        t.removed_with_zero_semantic_content +
        t.remaining_unresolved,
    ).toBe(t.semantic_loss_before);
    expect(t.remaining_unresolved).toBe(0);
    expect(closure.closes).toBe(true);
  });

  it("exports a CSV row per unbound column", () => {
    const { closure } = report();
    const lines = closureCsv(closure).trim().split("\n");
    expect(lines).toHaveLength(closure.rows.length + 1);
    expect(lines[0]).toContain("preservation_method");
  });
});
