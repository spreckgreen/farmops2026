import { describe, expect, it } from "vitest";
import {
  NORMALIZATION_RULES,
  normalizeValue,
  runParallelComparison,
  sameNormalized,
  serializeValidationReport,
  validationCsv,
  validationMarkdown,
  type OdsSheetRows,
  type ValidationReport,
} from "@/lib/electrical-parallel-validation";
import { buildElectricalSnapshot, type RawRow } from "@/lib/electrical-snapshot";
import { ENTITIES } from "@/lib/electrical-entities";
import { validatePanelLayout } from "@/lib/electrical-panel-layout";
import type { ElectricalEntityKind } from "@/lib/electrical";

const KINDS = Object.keys(ENTITIES) as ElectricalEntityKind[];

function snapshot(partial: Partial<Record<ElectricalEntityKind, RawRow[]>>, extra: {
  waypoints?: RawRow[];
  breakerPositions?: RawRow[];
  panelExits?: RawRow[];
} = {}) {
  const rows = {} as Record<ElectricalEntityKind, RawRow[]>;
  for (const kind of KINDS) rows[kind] = partial[kind] ?? [];
  return buildElectricalSnapshot({
    generatedAt: "2026-08-30T00:00:00.000Z",
    rows,
    waypoints: extra.waypoints ?? [],
    breakerPositions: extra.breakerPositions ?? [],
    panelExits: extra.panelExits ?? [],
    qa: [],
  });
}

function sheet(
  name: string,
  kind: ElectricalEntityKind,
  rows: { stableId: string; values: Record<string, string> }[],
  unmapped: { column: string; populated: boolean }[] = [],
): OdsSheetRows {
  return { sheet: name, kind, rows, unmapped };
}

function run(sheets: OdsSheetRows[], snap: ReturnType<typeof snapshot>): ValidationReport {
  return runParallelComparison({
    odsFileName: "PremoFarmElectrical.ods",
    odsSha256: "a".repeat(64),
    comparedAt: "2026-08-30T01:00:00.000Z",
    sheets,
    snapshot: snap,
  });
}

const load = (over: RawRow = {}): RawRow => ({
  id: "11111111-1111-1111-1111-111111111111",
  load_id: "FS-042",
  area: "Farm Shop",
  description: "Bench receptacle",
  volts: 120,
  amps: 20,
  updated_at: "2026-08-01T00:00:00.000Z",
  ...over,
});

const find = (r: ValidationReport, stableId: string, field: string) =>
  r.records.find((x) => x.stable_id === stableId && x.field === field)!;

describe("Phase 4.4 parallel validation", () => {
  it("classifies an exact engineering match", () => {
    const r = run(
      [sheet("Load_Master", "load", [{ stableId: "FS-042", values: { volts: "120" } }])],
      snapshot({ load: [load()] }),
    );
    expect(find(r, "FS-042", "volts").classification).toBe("MATCH");
  });

  it("treats representation differences as expected transformations", () => {
    const r = run(
      [
        sheet("Load_Master", "load", [
          {
            stableId: "FS-042",
            values: { volts: "120 V", amps: "20 A", connected_va: "2,400", critical: "Yes" },
          },
        ]),
      ],
      snapshot({ load: [load({ connected_va: 2400, critical: true })] }),
    );
    for (const field of ["volts", "amps", "connected_va", "critical"]) {
      expect(find(r, "FS-042", field).classification).toBe("EXPECTED_TRANSFORMATION");
    }
  });

  it("normalizes units, booleans, dual voltage and percentages", () => {
    const num = { key: "amps", label: "Amps", kind: "number" } as const;
    const bool = { key: "critical", label: "Critical", kind: "bool" } as const;
    const pct = { key: "completion_percent", label: "Complete %", kind: "number" } as const;
    expect(normalizeValue(num, "20 A").value).toBe(20);
    expect(normalizeValue(num, "120/240V").value).toBe(240);
    expect(normalizeValue(num, "12,000").value).toBe(12000);
    expect(normalizeValue(bool, "Y").value).toBe(true);
    expect(normalizeValue(bool, "no").value).toBe(false);
    expect(normalizeValue(pct, "65%").value).toBe(65);
    expect(normalizeValue(pct, "0.75").value).toBe(75);
    expect(normalizeValue(num, "n/a").value).toBeNull();
    expect(normalizeValue({ key: "area", label: "Area", kind: "text" }, "  Farm   Shop ").value).toBe(
      "Farm Shop",
    );
    expect(sameNormalized(20, 20.001)).toBe(true);
    expect(sameNormalized(120, 240)).toBe(false);
    expect(NORMALIZATION_RULES.map((x) => x.id)).toContain("dual_voltage");
  });

  it("does not normalize two genuinely different values into equality", () => {
    const r = run(
      [sheet("Load_Master", "load", [{ stableId: "FS-042", values: { volts: "240" } }])],
      snapshot({ load: [load({ volts: 120 })] }),
    );
    const cell = find(r, "FS-042", "volts");
    expect(cell.classification).toBe("CONFLICT");
    expect(cell.ods_value).toBe("240");
    expect(cell.farmops_value).toBe("120");
    expect(cell.authority).toBe("engineering_design");
  });

  it("reports an ODS-only value and an ODS-only record", () => {
    const r = run(
      [
        sheet("Load_Master", "load", [
          { stableId: "FS-042", values: { demand_va: "1500" } },
          { stableId: "FS-099", values: { area: "Farm Shop" } },
        ]),
      ],
      snapshot({ load: [load()] }),
    );
    expect(find(r, "FS-042", "demand_va").classification).toBe("ODS_ONLY");
    expect(find(r, "FS-099", "__record").classification).toBe("ODS_ONLY");
  });

  it("reports a FarmOps-only design value for review", () => {
    const r = run(
      [sheet("Load_Master", "load", [{ stableId: "FS-042", values: {} }])],
      snapshot({ load: [load({ demand_va: 1500 })] }),
    );
    expect(find(r, "FS-042", "demand_va").classification).toBe("FARMOPS_ONLY");
  });

  it("classifies newly installed raceways, j-boxes and branches as as-built additions", () => {
    const r = run(
      [sheet("Conduit_Runs", "raceway", [])],
      snapshot({
        raceway: [{ id: "r1", conduit_id: "CON-105", raceway_type: "FLEX" }],
        jbox: [{ id: "j1", jbox_id: "JB-105-01" }],
        branch: [{ id: "b1", branch_id: "BR-105-01-02" }],
      }),
    );
    for (const id of ["CON-105", "JB-105-01", "BR-105-01-02"]) {
      expect(find(r, id, "__record").classification).toBe("FARMOPS_AS_BUILT_ADDITION");
    }
  });

  it("keeps CON-### raceway identity independent of EMT/FLEX/PVC type", () => {
    const r = run(
      [
        sheet("Conduit_Runs", "raceway", [
          { stableId: "CON-104", values: { raceway_type: "EMT", trade_size: '3/4"' } },
          { stableId: "CON-106", values: { raceway_type: "FLEX", trade_size: '1/2"' } },
        ]),
      ],
      snapshot({
        raceway: [
          { id: "r1", conduit_id: "CON-104", raceway_type: "EMT", trade_size: '3/4"' },
          { id: "r2", conduit_id: "CON-106", raceway_type: "FLEX", trade_size: '1/2"' },
        ],
      }),
    );
    expect(find(r, "CON-104", "raceway_type").classification).toBe("MATCH");
    expect(find(r, "CON-106", "raceway_type").classification).toBe("MATCH");
    expect(r.records.some((x) => x.stable_id.startsWith("EMT-"))).toBe(false);
    expect(r.summary.CONFLICT).toBe(0);
  });

  it("does not treat a measured length as conflicting with a design length", () => {
    const r = run(
      [
        sheet("Conduit_Runs", "raceway", [
          { stableId: "CON-104", values: { planned_length_ft: "45", measured_length_ft: "45" } },
        ]),
      ],
      snapshot({
        raceway: [
          { id: "r1", conduit_id: "CON-104", planned_length_ft: 45, measured_length_ft: 48 },
        ],
      }),
    );
    expect(find(r, "CON-104", "planned_length_ft").classification).toBe("MATCH");
    expect(find(r, "CON-104", "measured_length_ft").classification).toBe(
      "FARMOPS_AS_BUILT_ADDITION",
    );
    expect(r.summary.CONFLICT).toBe(0);
  });

  it("flags a populated workbook column with no FarmOps destination as LOSS", () => {
    const r = run(
      [
        sheet("Load_Master", "load", [{ stableId: "FS-042", values: {} }], [
          { column: "Harmonic Distortion Factor", populated: true },
          { column: "Blank Scratch Column", populated: false },
        ]),
      ],
      snapshot({ load: [load()] }),
    );
    const loss = r.records.filter((x) => x.classification === "LOSS");
    expect(loss).toHaveLength(1);
    expect(loss[0].field).toBe("Harmonic Distortion Factor");
  });

  it("treats an unfinished relationship as INCOMPLETE, not an error", () => {
    const r = run(
      [
        sheet("Load_Master", "load", [
          { stableId: "FS-042", values: { circuit_group_ref: "CG-FS-01" } },
        ]),
      ],
      snapshot({ load: [load({ circuit_group_ref: "CG-FS-01", circuit_group_uuid: null })] }),
    );
    const rel = find(r, "FS-042", "circuit_group_uuid");
    expect(rel.classification).toBe("INCOMPLETE");
    expect(r.summary.CONFLICT).toBe(0);
  });

  it("compares relationships by stable ID rather than UUID", () => {
    const snap = snapshot({
      load: [load({ circuit_group_ref: "CG-FS-01", circuit_group_uuid: "cg-uuid-1" })],
      circuit_group: [{ id: "cg-uuid-1", circuit_group_id: "CG-FS-01" }],
    });
    const r = run(
      [
        sheet("Load_Master", "load", [
          { stableId: "FS-042", values: { circuit_group_ref: "CG-FS-01" } },
        ]),
      ],
      snap,
    );
    const rel = find(r, "FS-042", "circuit_group_uuid");
    expect(rel.classification).toBe("EXPECTED_TRANSFORMATION");
    expect(rel.farmops_value).toBe("CG-FS-01");
    expect(JSON.stringify(r.records)).not.toContain("cg-uuid-1");
  });

  it("compares circuit-group membership as a set, ignoring row order", () => {
    const snap = snapshot({
      load: [
        load({ id: "l1", load_id: "FS-042", circuit_group_uuid: "cg1", circuit_group_ref: "CG-1" }),
        load({ id: "l2", load_id: "FS-043", circuit_group_uuid: "cg1", circuit_group_ref: "CG-1" }),
      ],
      circuit_group: [{ id: "cg1", circuit_group_id: "CG-1" }],
    });
    const r = run(
      [
        sheet("Load_Master", "load", [
          { stableId: "FS-043", values: { circuit_group_ref: "CG-1" } },
          { stableId: "FS-042", values: { circuit_group_ref: "CG-1" } },
        ]),
      ],
      snap,
    );
    const member = r.records.find(
      (x) => x.domain === "circuit_group_membership" && x.stable_id === "CG-1",
    )!;
    expect(member.classification).toBe("MATCH");
  });

  it("preserves J-box and branch hierarchy identities in the report", () => {
    const r = run(
      [],
      snapshot({
        jbox: [{ id: "j1", jbox_id: "JB-104-03" }],
        branch: [{ id: "b1", branch_id: "BR-104-03-01", source_jbox_uuid: "j1" }],
      }),
    );
    expect(find(r, "JB-104-03", "__record").domain).toBe("junction_boxes");
    const rel = find(r, "BR-104-03-01", "source_jbox_uuid");
    expect(rel.farmops_value).toBe("JB-104-03");
    expect(rel.classification).toBe("FARMOPS_AS_BUILT_ADDITION");
  });

  it("counts breaker positions and panel exits as as-built additions per entity", () => {
    const r = run(
      [],
      snapshot(
        { panel: [{ id: "p1", panel_id: "PNL-FS-NW" }] },
        {
          breakerPositions: [{ id: "bp1", panel_uuid: "p1", position_number: 1, side: "left" }],
          panelExits: [{ id: "pe1", panel_uuid: "p1", exit_order: 1, exit_side: "lower-right" }],
        },
      ),
    );
    expect(r.as_built_additions_by_entity["panel_breaker_positions"]).toBe(1);
    expect(r.as_built_additions_by_entity["panel_exits"]).toBe(1);
  });

  it("respects each panel's own capacity and exit ordering rules", () => {
    const small = validatePanelLayout(
      { panel_id: "PNL-PH", spaces: 12 },
      [
        { position_number: 1, side: "left" },
        { position_number: 30, side: "left" },
      ],
      [{ exit_order: 1 }, { exit_order: 3 }],
    );
    expect(JSON.stringify(small)).toContain("30");
    const ok = validatePanelLayout(
      { panel_id: "PNL-FS-NW", spaces: 30 },
      [{ position_number: 1, side: "left" }],
      [{ exit_order: 1 }],
    );
    expect(ok.errors.length).toBe(0);
  });

  it("produces deterministic output including the ODS SHA-256", () => {
    const sheets = [
      sheet("Load_Master", "load", [{ stableId: "FS-042", values: { volts: "240" } }]),
    ];
    const snap = snapshot({ load: [load()] });
    const a = serializeValidationReport(run(sheets, snap));
    const b = serializeValidationReport(run(sheets, snap));
    expect(a).toBe(b);
    const parsed = JSON.parse(a) as ValidationReport;
    expect(parsed.ods.sha256).toBe("a".repeat(64));
    expect(parsed.ods.file_name).toBe("PremoFarmElectrical.ods");
    expect(parsed.sor_authority).toBe("canonical_ods");
    expect(parsed.farmops_role).toBe("candidate_sor");
    expect(parsed.mapping_version).toBeTruthy();
    expect(parsed.normalization_version).toBeTruthy();
  });

  it("exports CSV and Markdown", () => {
    const r = run(
      [sheet("Load_Master", "load", [{ stableId: "FS-042", values: { volts: "240" } }])],
      snapshot({ load: [load()] }),
    );
    expect(validationCsv(r).split("\n")[0]).toContain("domain,stable_id,field");
    expect(validationCsv(r)).toContain("CONFLICT");
    const md = validationMarkdown(r);
    expect(md).toContain("# Phase 4.4 — Lossless Parallel Validation");
    expect(md).toContain("a".repeat(64));
  });

  it("performs no database or ODS writes: the engine is pure", () => {
    const snap = snapshot({ load: [load()] });
    const before = JSON.stringify(snap);
    const sheets = [
      sheet("Load_Master", "load", [{ stableId: "FS-042", values: { volts: "240" } }]),
    ];
    const beforeSheets = JSON.stringify(sheets);
    run(sheets, snap);
    expect(JSON.stringify(snap)).toBe(before);
    expect(JSON.stringify(sheets)).toBe(beforeSheets);
    const source = String(runParallelComparison);
    expect(source).not.toMatch(/\.from\(|update\(|insert\(|upsert\(|delete\(/);
  });
});
