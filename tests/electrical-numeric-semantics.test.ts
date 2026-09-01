import { describe, expect, it } from "vitest";
import {
  numericRegistry,
  numericRegistryEntry,
  parseNumericCell,
  sameNumeric,
  EXCLUDED_NON_ENTITY_NUMERICS,
} from "@/lib/electrical-numeric-semantics";
import {
  numericDiagnostics,
  numericFindingsCsv,
  numericDiagnosticsMarkdown,
  numericRegistryCsv,
  numericReconciliation,
  serializeNumericDiagnostics,
} from "@/lib/electrical-numeric-diagnostics";
import { runParallelComparison, type OdsSheetRows } from "@/lib/electrical-parallel-validation";
import { buildElectricalSnapshot, type RawRow } from "@/lib/electrical-snapshot";
import { ENTITIES } from "@/lib/electrical-entities";
import type { ElectricalEntityKind } from "@/lib/electrical";

const KINDS = Object.keys(ENTITIES) as ElectricalEntityKind[];

function snapshot(partial: Partial<Record<ElectricalEntityKind, RawRow[]>>) {
  const rows = {} as Record<ElectricalEntityKind, RawRow[]>;
  for (const kind of KINDS) rows[kind] = partial[kind] ?? [];
  return buildElectricalSnapshot({
    generatedAt: "2026-08-30T00:00:00.000Z",
    rows,
    waypoints: [],
    breakerPositions: [],
    panelExits: [],
    qa: [],
  });
}

function sheet(
  name: string,
  kind: ElectricalEntityKind,
  rows: { stableId: string; values: Record<string, string>; sourceRow?: number }[],
): OdsSheetRows {
  return { sheet: name, kind, rows, unmapped: [] };
}

function diag(sheets: OdsSheetRows[], snap: ReturnType<typeof snapshot>) {
  return numericDiagnostics(
    runParallelComparison({
      odsFileName: "PremoFarmElectrical.ods",
      odsSha256: "b".repeat(64),
      comparedAt: "2026-08-30T01:00:00.000Z",
      sheets,
      snapshot: snap,
    }),
  );
}

const load = (over: RawRow = {}): RawRow => ({
  id: "11111111-1111-1111-1111-111111111111",
  load_id: "FS-042",
  area: "Farm Shop",
  description: "Bench receptacle",
  updated_at: "2026-08-01T00:00:00.000Z",
  ...over,
});

const findingFor = (
  r: ReturnType<typeof diag>,
  stableId: string,
  field: string,
) => r.findings.find((f) => f.stable_id === stableId && f.farmops_field === field);

describe("Phase 4.4b numeric field inventory and ownership", () => {
  it("classifies every numeric field before any value is compared", () => {
    const reg = numericRegistry();
    expect(reg.length).toBeGreaterThan(20);
    for (const e of reg) {
      expect(e.ownership).toBeTruthy();
      expect(e.reason.length).toBeGreaterThan(10);
      expect(e.comparable).toBe(e.ownership === "ODS_ENGINEERING_OWNED");
    }
  });

  it("excludes derived, field-observed, ordinal and FarmOps-native numbers from comparison", () => {
    const own = (table: string, field: string) => numericRegistryEntry(table, field)!.ownership;
    expect(own("electrical_loads", "completion_percent")).toBe("DERIVED");
    expect(own("electrical_feeders", "measured_length_ft")).toBe("FIELD_OBSERVATION");
    expect(own("electrical_junction_boxes", "raceway_sequence")).toBe("IDENTIFIER_OR_ORDINAL");
    expect(own("electrical_devices", "rack_position_u")).toBe("IDENTIFIER_OR_ORDINAL");
    expect(own("electrical_power_assets", "input_voltage")).toBe("FARMOPS_OPERATIONAL");
    expect(own("electrical_circuit_groups", "generator_start_amps")).toBe("UNKNOWN_OWNERSHIP");
    // canonical engineering values remain comparable
    expect(own("electrical_feeders", "ampacity_amps")).toBe("ODS_ENGINEERING_OWNED");
    expect(own("electrical_loads", "amps")).toBe("ODS_ENGINEERING_OWNED");
  });

  it("documents breaker-position amperage as field-observed, never workbook-driven", () => {
    const ocp = EXCLUDED_NON_ENTITY_NUMERICS.find(
      (e) => e.table === "electrical_breaker_positions" && e.field === "ocp_amps",
    )!;
    expect(ocp.ownership).toBe("FIELD_OBSERVATION");
    expect(ocp.reason).toMatch(/never inferred/i);
  });
});

describe("Phase 4.4b tri-state numeric parsing", () => {
  it("keeps blank, explicit zero and explicit value distinct", () => {
    expect(parseNumericCell("", "amp").state).toBe("absent");
    expect(parseNumericCell(null, "amp").state).toBe("absent");
    expect(parseNumericCell("0", "amp")).toMatchObject({ state: "zero", value: 0 });
    expect(parseNumericCell("20", "amp")).toMatchObject({ state: "value", value: 20 });
    expect(sameNumeric(0, null)).toBe(false);
  });

  it("normalizes units and separators without changing magnitude", () => {
    expect(parseNumericCell("20 A", "amp").value).toBe(20);
    expect(parseNumericCell("240V", "volt").value).toBe(240);
    expect(parseNumericCell("12,000 VA", "volt_ampere").value).toBe(12000);
    expect(parseNumericCell("7.5 kVA", "volt_ampere").value).toBe(7500);
    expect(parseNumericCell("80 ft", "foot").value).toBe(80);
    expect(parseNumericCell("80.0", "foot").value).toBe(80);
    expect(sameNumeric(80, 80.0)).toBe(true);
  });

  it("never guesses a foreign or unrecognised unit", () => {
    expect(parseNumericCell("25 m", "foot").state).toBe("ambiguous_unit");
    expect(parseNumericCell("20 kw", "amp").state).toBe("ambiguous_unit");
    expect(parseNumericCell("20 blorp", "amp").state).toBe("ambiguous_unit");
  });

  it("preserves unresolved engineering notation instead of coercing it", () => {
    for (const raw of ["TBD", "?", "verify field", "40-60", "~45", "approx 45", "120/240V"]) {
      const p = parseNumericCell(raw, "amp");
      expect(p.state).toBe("non_numeric");
      expect(p.value).toBeNull();
      expect(p.raw).toBe(raw);
    }
  });
});

describe("Phase 4.4b numeric diagnostics", () => {
  it("agreements are not findings", () => {
    const r = diag(
      [sheet("Load_Master", "load", [{ stableId: "FS-042", values: { amps: "20 A" } }])],
      snapshot({ load: [load({ amps: 20 })] }),
    );
    expect(findingFor(r, "FS-042", "amps")).toBeUndefined();
    expect(r.agreements).toBeGreaterThan(0);
  });

  it("Category A: a blank workbook cell against a NOT NULL DEFAULT column", () => {
    const r = diag(
      [sheet("Load_Master", "load", [{ stableId: "FS-042", values: { amps: "20" } }])],
      snapshot({ load: [load({ amps: 20, count: 1 })] }),
    );
    const f = findingFor(r, "FS-042", "count")!;
    expect(f.category).toBe("A");
    expect(f.artifact_type).toBe("N2_BLANK_DEFAULTED_NONZERO");
    expect(f.implementation_created).toBe(true);
    // electrical_loads.count is NOT NULL, so no value may be substituted
    expect(f.disposition).toBe("blocked_column_not_nullable");
    expect(r.plan).toHaveLength(0);
    expect(r.blocked).toContain(f);
  });

  it("Category B: both sides hold explicit, different numbers", () => {
    const r = diag(
      [sheet("Load_Master", "load", [{ stableId: "FS-042", values: { amps: "30 A" } }])],
      snapshot({ load: [load({ amps: 20 })] }),
    );
    const f = findingFor(r, "FS-042", "amps")!;
    expect(f.category).toBe("B");
    expect(f.delta).toBe(-10);
    expect(f.proposed_value).toBeUndefined();
  });

  it("Category B: an explicit zero is a stated value, never 'unknown'", () => {
    const r = diag(
      [sheet("Load_Master", "load", [{ stableId: "FS-042", values: { amps: "0" } }])],
      snapshot({ load: [load({ amps: 20 })] }),
    );
    const f = findingFor(r, "FS-042", "amps")!;
    expect(f.category).toBe("B");
    expect(f.ods_state).toBe("zero");
    expect(f.provenance).toMatch(/Explicit zero/);
  });

  it("Category C: TBD and unit-ambiguous cells are preserved, not reconciled", () => {
    const r = diag(
      [
        sheet("Load_Master", "load", [
          { stableId: "FS-042", values: { amps: "TBD", connected_va: "20 kw" } },
        ]),
      ],
      snapshot({ load: [load({ amps: 20, connected_va: 2400 })] }),
    );
    const tbd = findingFor(r, "FS-042", "amps")!;
    expect(tbd.category).toBe("C");
    expect(tbd.ods_raw).toBe("TBD");
    expect(tbd.disposition).toBe("resolve_in_canonical_ods_first");
    expect(findingFor(r, "FS-042", "connected_va")!.category).toBe("C");
  });

  it("Category D: one side silent with no proven default", () => {
    const odsOnly = diag(
      [sheet("Load_Master", "load", [{ stableId: "FS-042", values: { amps: "20" } }])],
      snapshot({ load: [load({ amps: null })] }),
    );
    expect(findingFor(odsOnly, "FS-042", "amps")!.category).toBe("D");

    const fpOnly = diag(
      [sheet("Load_Master", "load", [{ stableId: "FS-042", values: {} }])],
      snapshot({ load: [load({ amps: 20 })] }),
    );
    const f = findingFor(fpOnly, "FS-042", "amps")!;
    expect(f.category).toBe("D");
    expect(f.disposition).toBe("requires_human_review");
  });

  it("does not compare field-observed, derived or ordinal numbers at all", () => {
    const r = diag(
      [sheet("Conduit_Runs", "raceway", [{ stableId: "CON-104", values: { planned_length_ft: "45" } }])],
      snapshot({
        raceway: [
          {
            id: "r1",
            conduit_id: "CON-104",
            planned_length_ft: 45,
            measured_length_ft: 48,
            completion_percent: 0,
          },
        ],
      }),
    );
    expect(findingFor(r, "CON-104", "measured_length_ft")).toBeUndefined();
    expect(findingFor(r, "CON-104", "completion_percent")).toBeUndefined();
    expect(r.not_compared.some((e) => e.field === "measured_length_ft")).toBe(true);
  });

  it("carries record-level provenance for drill-down", () => {
    const r = diag(
      [
        sheet("Load_Master", "load", [
          { stableId: "FS-042", values: { amps: "30" }, sourceRow: 17 },
        ]),
      ],
      snapshot({ load: [load({ amps: 20 })] }),
    );
    const f = findingFor(r, "FS-042", "amps")!;
    expect(f.ods_row).toBe(17);
    expect(f.farmops_uuid).toBe("11111111-1111-1111-1111-111111111111");
    expect(f.ods_worksheet).toBeTruthy();
  });

  it("reconciles arithmetic: agreements + categories = compared cells", () => {
    const r = diag(
      [
        sheet("Load_Master", "load", [
          { stableId: "FS-042", values: { amps: "30", volts: "120", connected_va: "TBD" } },
        ]),
      ],
      snapshot({ load: [load({ amps: 20, volts: 120, connected_va: 2400 })] }),
    );
    const recon = numericReconciliation(r);
    expect(recon.balanced).toBe(true);
    expect(recon.category_a_balanced).toBe(true);
  });

  it("is deterministic and performs no writes", () => {
    const sheets = [
      sheet("Load_Master", "load", [{ stableId: "FS-042", values: { amps: "30" } }]),
    ];
    const snap = snapshot({ load: [load({ amps: 20 })] });
    const before = JSON.stringify(snap);
    const a = serializeNumericDiagnostics(diag(sheets, snap));
    const b = serializeNumericDiagnostics(diag(sheets, snap));
    expect(a).toBe(b);
    expect(JSON.stringify(snap)).toBe(before);
    for (const fn of [numericDiagnostics, numericReconciliation]) {
      expect(String(fn)).not.toMatch(/\.from\(|insert\(|update\(|upsert\(|delete\(/);
    }
  });

  it("exports the registry, findings and a markdown report", () => {
    const r = diag(
      [sheet("Load_Master", "load", [{ stableId: "FS-042", values: { amps: "30" } }])],
      snapshot({ load: [load({ amps: 20 })] }),
    );
    expect(numericRegistryCsv(r).split("\n")[0]).toContain("ownership");
    expect(numericFindingsCsv(r)).toContain("FS-042");
    const md = numericDiagnosticsMarkdown(r);
    expect(md).toContain("# Phase 4.4b — Numeric Semantics Diagnostics");
    expect(md).toContain("b".repeat(64));
    expect(md).toContain("no database writes");
  });
});
