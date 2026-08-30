import { describe, expect, it } from "vitest";
import {
  normalizeValue,
  runParallelComparison,
  type OdsSheetRows,
  type ValidationReport,
} from "@/lib/electrical-parallel-validation";
import {
  PRE_4_4A_BASELINE,
  buildReconciliation,
  conflictsCsv,
  reconciliationMarkdown,
  unresolvedCsv,
} from "@/lib/electrical-reconciliation";
import { buildElectricalSnapshot, type RawRow } from "@/lib/electrical-snapshot";
import { ENTITIES, importColumns } from "@/lib/electrical-entities";
import { FIELD_MAP } from "@/lib/electrical-field-map";
import { classifySheet, mapSheet, type ParsedSheet } from "@/lib/electrical-ods";
import type { ElectricalEntityKind } from "@/lib/electrical";

const KINDS = Object.keys(ENTITIES) as ElectricalEntityKind[];

function snapshot(partial: Partial<Record<ElectricalEntityKind, RawRow[]>> = {}) {
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
  rows: { stableId: string; values: Record<string, string> }[],
  unmapped: OdsSheetRows["unmapped"] = [],
): OdsSheetRows {
  return { sheet: name, kind, rows, unmapped };
}

function run(sheets: OdsSheetRows[], snap: ReturnType<typeof snapshot>): ValidationReport {
  return runParallelComparison({
    odsFileName: "PremoFarmElectrical.ods",
    odsSha256: "b".repeat(64),
    comparedAt: "2026-08-31T00:00:00.000Z",
    sheets,
    snapshot: snap,
    snapshotSha256: "c".repeat(64),
  });
}

const load = (over: RawRow = {}): RawRow => ({
  id: "11111111-1111-1111-1111-111111111111",
  load_id: "FS-042",
  area: "Farm Shop",
  ...over,
});

const find = (r: ValidationReport, stableId: string, field: string) =>
  r.records.find((x) => x.stable_id === stableId && x.field === field)!;

describe("Phase 4.4a — named LOSS destinations survive the importer", () => {
  const headers = [
    "Load ID",
    "Equipment / Model",
    "Source / Reference",
    "Suggested Panel",
    "Connected kVA",
    "D/S",
  ];

  const parsed: ParsedSheet = {
    name: "Load_Master",
    rows: [headers, ["FS-042", "Miller 211 welder", "Sheet E-3 note 4", "PNL-FS-NW", "3.6", "TBD"]],
  };

  it("binds every previously lost canonical column to a FarmOps column", () => {
    const kind = classifySheet(parsed);
    expect(kind).toBe("load");
    const mapped = mapSheet(parsed, "load", importColumns("load"), "load_id");
    expect(mapped.columns.filter((c) => !c.target)).toHaveLength(0);
    const row = mapped.rows[0]!;
    expect(row.values["equipment_model"]).toBe("Miller 211 welder");
    expect(row.values["source_reference"]).toBe("Sheet E-3 note 4");
    expect(row.values["suggested_panel"]).toBe("PNL-FS-NW");
    // kVA is scaled to VA exactly once, deterministically.
    expect(row.values["connected_va"]).toBe("3600");
    expect(row.values["dedicated_shared"]).toBe("TBD");
  });

  it("documents each new destination in the mapping matrix", () => {
    for (const field of ["Equipment / Model", "Source / Reference", "Suggested Panel", "Connected kVA", "D/S"]) {
      const row = FIELD_MAP.find((r) => r.worksheet === "Load_Master" && r.field === field);
      expect(row, field).toBeTruthy();
      expect(row!.classification).toBe("directly_mapped");
    }
  });

  it("survives ODS -> FarmOps -> validator with no LOSS", () => {
    const mapped = mapSheet(parsed, "load", importColumns("load"), "load_id");
    const r = run(
      [sheet("Load_Master", "load", mapped.rows.map((x) => ({ stableId: x.stableId, values: x.values })))],
      snapshot({
        load: [
          load({
            equipment_model: "Miller 211 welder",
            source_reference: "Sheet E-3 note 4",
            suggested_panel: "PNL-FS-NW",
            connected_va: 3600,
          }),
        ],
      }),
    );
    expect(r.summary.LOSS).toBe(0);
    expect(find(r, "FS-042", "equipment_model").classification).toBe("MATCH");
    expect(find(r, "FS-042", "connected_va").classification).toBe("MATCH");
  });

  it("names the affected workbook rows and root cause when a column really is lost", () => {
    const r = run(
      [
        sheet("Load_Master", "load", [{ stableId: "FS-042", values: {} }], [
          {
            column: "Harmonic Distortion Factor",
            populated: true,
            populatedRows: 7,
            samples: [{ stableId: "FS-042", value: "0.08" }],
          },
        ]),
      ],
      snapshot({ load: [load()] }),
    );
    const loss = r.records.filter((x) => x.classification === "LOSS");
    expect(loss).toHaveLength(1);
    expect(loss[0].root_cause).toBe("missing_mapping_no_farmops_destination");
    expect(loss[0].note).toContain('FS-042="0.08"');
    expect(loss[0].note).toContain("+6 more");
    expect(loss[0].disposition).toBe("CORRECT_MAPPING");
    expect(r.gate.status).toBe("FAIL");
  });
});

describe("Phase 4.4a — tri-state and boolean semantics", () => {
  it("keeps TBD distinct from blank, true, false and 0", () => {
    const bool = { key: "critical", label: "Critical", kind: "bool" } as const;
    const num = { key: "amps", label: "Amps", kind: "number" } as const;
    expect(normalizeValue(bool, "TBD").tbd).toBe(true);
    expect(normalizeValue(bool, "TBD").value).toBeNull();
    expect(normalizeValue(bool, "").tbd).toBeUndefined();
    // A bare 1 or 0 in a workbook Yes/No column is ambiguous, never invented.
    expect(normalizeValue(bool, "1").value).toBe("1");
    expect(normalizeValue(bool, "0").value).toBe("0");
    expect(normalizeValue(bool, 1).value).toBe(true);
    expect(normalizeValue(num, "3.6 kVA").value).toBe(3.6);
    expect(normalizeValue({ key: "connected_va", label: "VA", kind: "number" }, "3.6 kVA").value).toBe(3600);
  });

  it("reports a TBD design value as an engineering state, never as a conflict", () => {
    const r = run(
      [sheet("Load_Master", "load", [{ stableId: "FS-042", values: { critical: "TBD" } }])],
      snapshot({ load: [load({ critical: false })] }),
    );
    const cell = find(r, "FS-042", "critical");
    expect(cell.classification).toBe("INCOMPLETE");
    expect(cell.tbd).toBe(true);
    expect(cell.disposition).toBe("TBD_ENGINEERING_STATE");
    expect(r.summary.CONFLICT).toBe(0);
  });

  it("does not silently accept a FarmOps default as new engineering data", () => {
    const r = run(
      [sheet("Load_Master", "load", [{ stableId: "FS-042", values: {} }])],
      snapshot({ load: [load({ critical: true })] }),
    );
    const cell = find(r, "FS-042", "critical");
    expect(cell.classification).toBe("FARMOPS_ONLY");
    expect(cell.farmops_only_category).toBe("E");
    expect(cell.disposition).toBe("REVIEW_REQUIRED");
  });
});

describe("Phase 4.4a — identity, references and dispositions", () => {
  it("explains an ODS-only record that exists in another collection", () => {
    const r = run(
      [sheet("Panel_Schedule", "panel", [{ stableId: "CON-104", values: {} }])],
      snapshot({ raceway: [{ id: "r1", conduit_id: "CON-104" }] }),
    );
    const rec = find(r, "CON-104", "__record");
    expect(rec.classification).toBe("ODS_ONLY");
    expect(rec.root_cause).toBe("identity_present_in_other_collection");
    expect(r.gate.unexplained_ods_only).toBe(0);
  });

  it("treats a pre-existing EMT-### record as the same raceway as canonical CON-###", () => {
    const r = run(
      [sheet("Conduit_Runs", "raceway", [{ stableId: "CON-104", values: {} }])],
      snapshot({ raceway: [{ id: "r1", conduit_id: "EMT-104" }] }),
    );
    const rec = find(r, "CON-104", "__record");
    expect(rec.classification).toBe("EXPECTED_TRANSFORMATION");
    expect(rec.root_cause).toBe("legacy_stable_id_equivalence");
  });

  it("preserves a descriptive workbook endpoint instead of guessing a relationship", () => {
    const r = run(
      [
        sheet("Conduit_Runs", "raceway", [
          { stableId: "CON-001", values: { to_label: "Pull Box: Boiler" } },
        ]),
      ],
      snapshot({ raceway: [{ id: "r1", conduit_id: "CON-001", to_label: "Pull Box: Boiler" }] }),
    );
    const unresolved = r.records.filter(
      (x) => x.root_cause === "unresolved_reference_text_not_a_stable_id",
    );
    expect(unresolved.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.records)).toContain("Pull Box: Boiler");
    expect(r.summary.CONFLICT).toBe(0);
  });

  it("gives every finding a root cause and a disposition", () => {
    const r = run(
      [
        sheet("Load_Master", "load", [
          { stableId: "FS-042", values: { volts: "240" } },
          { stableId: "FS-099", values: { area: "Farm Shop" } },
        ]),
      ],
      snapshot({ load: [load({ volts: 120 })] }),
    );
    expect(r.records.every((x) => x.root_cause !== "unclassified")).toBe(true);
    expect(r.gate.unexplained).toBe(0);
    const conflict = find(r, "FS-042", "volts");
    expect(conflict.authority_class).toBe("DESIGN_CANONICAL");
    expect(conflict.disposition).toBe("ENGINEERING_DECISION_REQUIRED");
  });

  it("passes the gate only when loss and unexplained findings are zero", () => {
    const clean = run(
      [sheet("Load_Master", "load", [{ stableId: "FS-042", values: { area: "Farm Shop" } }])],
      snapshot({ load: [load()] }),
    );
    expect(clean.gate.loss).toBe(0);
    expect(clean.gate.status).toBe("PASS");
  });
});

describe("Phase 4.4a — reconciliation artifacts", () => {
  const report = run(
    [
      sheet("Load_Master", "load", [
        { stableId: "FS-042", values: { volts: "240", critical: "TBD" } },
      ]),
    ],
    snapshot({ load: [load({ volts: 120, critical: false })] }),
  );

  it("compares the preserved pre-4.4a baseline with the current run", () => {
    const data = buildReconciliation(report);
    expect(data.phase).toBe("4.4a");
    expect(data.baseline).toBe(PRE_4_4A_BASELINE);
    expect(data.baseline.counts.LOSS).toBe(67);
    expect(data.delta.LOSS).toBe(report.summary.LOSS - 67);
    expect(data.ods.sha256).toBe("b".repeat(64));
    expect(data.farmops.snapshot_sha256).toBe("c".repeat(64));
  });

  it("exports conflicts and unresolved findings as machine-readable CSV", () => {
    expect(conflictsCsv(report).split("\n")[0]).toContain("authority_class,disposition,root_cause");
    expect(conflictsCsv(report)).toContain("ENGINEERING_DECISION_REQUIRED");
    expect(unresolvedCsv(report)).toContain("TBD_ENGINEERING_STATE");
  });

  it("writes a reconciliation report that never claims synchronization", () => {
    const md = reconciliationMarkdown(report);
    expect(md).toContain("# Phase 4.4a — Electrical SOR Reconciliation");
    expect(md).toContain("Baseline vs final");
    expect(md).toContain("b".repeat(64));
    expect(md).toContain("canonical_ods");
    expect(md).not.toMatch(/overwrit|synchroniz/i);
  });

  it("is pure: no database or workbook writes", () => {
    const source = String(buildReconciliation) + String(reconciliationMarkdown);
    expect(source).not.toMatch(/\.from\(|insert\(|update\(|upsert\(|delete\(/);
  });
});
