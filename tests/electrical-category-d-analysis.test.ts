import { describe, expect, it } from "vitest";
import {
  categoryDAnalysis,
  categoryDAnalysisMarkdown,
  categoryDFindingsCsv,
  categoryDGroupsCsv,
  missingProvenance,
  side,
} from "@/lib/electrical-category-d-analysis";
import { numericDiagnostics, type NumericFinding } from "@/lib/electrical-numeric-diagnostics";
import { runParallelComparison, type OdsSheetRows } from "@/lib/electrical-parallel-validation";
import { buildElectricalSnapshot, type RawRow } from "@/lib/electrical-snapshot";
import { ENTITIES } from "@/lib/electrical-entities";
import type { ElectricalEntityKind } from "@/lib/electrical";

const SHA = "89da43c7f1f94948e17ecfdc942dbdba022cfee5ba504b70865529cf39877388";
const KINDS = Object.keys(ENTITIES) as ElectricalEntityKind[];

function snapshot(partial: Partial<Record<ElectricalEntityKind, RawRow[]>>) {
  const rows = {} as Record<ElectricalEntityKind, RawRow[]>;
  for (const kind of KINDS) rows[kind] = partial[kind] ?? [];
  return buildElectricalSnapshot({
    generatedAt: "2026-09-02T00:00:00.000Z",
    rows,
    waypoints: [],
    breakerPositions: [],
    panelExits: [],
    qa: [],
  });
}

const load = (id: string, over: RawRow = {}): RawRow => ({
  id: `0000-${id}`,
  load_id: id,
  area: "Farm Shop",
  description: "load",
  updated_at: "2026-08-01T00:00:00.000Z",
  ...over,
});

function analyze(
  rows: { stableId: string; values: Record<string, string>; sourceRow?: number }[],
  snap: ReturnType<typeof snapshot>,
) {
  const sheets: OdsSheetRows[] = [{ sheet: "Load_Master", kind: "load", rows, unmapped: [] }];
  const diag = numericDiagnostics(
    runParallelComparison({
      odsFileName: "PremoFarmElectrical.ods",
      odsSha256: SHA,
      comparedAt: "2026-09-02T01:00:00.000Z",
      sheets,
      snapshot: snap,
    }),
  );
  return { diag, analysis: categoryDAnalysis(diag) };
}

const finding = (over: Partial<NumericFinding> = {}) =>
  ({
    domain: "loads",
    stable_id: "FS-001",
    field: "amps",
    label: "Amps",
    farmops_entity: "electrical_loads",
    farmops_field: "amps",
    ods_worksheet: "Load_Master",
    ods_column: "Amps",
    ods_state: "absent",
    farmops_state: "value",
    ods_raw: "",
    farmops_raw: "20",
    unit: "amp",
    ...over,
  }) as unknown as NumericFinding;

describe("Phase 4.4b Category D provenance analysis", () => {
  it("describes which side states something without interpreting it", () => {
    expect(side(finding({ ods_state: "value", farmops_state: "absent" }))).toBe("ODS_ONLY");
    expect(side(finding())).toBe("FARMOPS_ONLY");
    expect(side(finding({ ods_state: "non_numeric", farmops_state: "non_numeric" }))).toBe(
      "NEITHER_INTERPRETABLE",
    );
  });

  it("classifies the missing provenance by evidence owed", () => {
    expect(missingProvenance(finding())).toBe("EQUIPMENT_NAMEPLATE_REQUIRED");
    expect(missingProvenance(finding({ ods_state: "value", farmops_state: "absent" }))).toBe(
      "FARMOPS_PROVENANCE_REQUIRED",
    );
    expect(
      missingProvenance(finding({ ods_state: "non_numeric", farmops_state: "non_numeric" })),
    ).toBe("ODS_SEMANTIC_CONTEXT_REQUIRED");
    expect(
      missingProvenance(
        finding({ farmops_field: "measured_length_ft", farmops_entity: "electrical_raceways" }),
      ),
    ).toBe("FIELD_VERIFICATION_REQUIRED");
    expect(missingProvenance(finding({ farmops_field: "count" }))).toBe(
      "SOURCE_DOCUMENT_REQUIRED",
    );
    expect(missingProvenance(finding({ ods_worksheet: "" }))).toBe(
      "IDENTITY_OR_MAPPING_PROVENANCE_REQUIRED",
    );
  });

  it("groups repeated deficiencies and separates one-off rows", () => {
    const { analysis } = analyze(
      [
        { stableId: "FS-001", values: { amps: "20" }, sourceRow: 5 },
        { stableId: "FS-002", values: { amps: "20" }, sourceRow: 6 },
        { stableId: "FS-003", values: {}, sourceRow: 7 },
      ],
      snapshot({
        load: [
          load("FS-001", { amps: null }),
          load("FS-002", { amps: null }),
          load("FS-003", { amps: 30 }),
        ],
      }),
    );

    expect(analysis.raw_d).toBe(3);
    const odsOnly = analysis.groups.find((g) => g.side === "ODS_ONLY")!;
    expect(odsOnly.count).toBe(2);
    expect(odsOnly.systematic).toBe(true);
    expect(odsOnly.missing_provenance).toBe("FARMOPS_PROVENANCE_REQUIRED");
    expect(odsOnly.representative_stable_ids).toContain("FS-001");
    expect(odsOnly.source_worksheets).toContain("Load_Master");
    expect(odsOnly.source_rows).toEqual([5, 6]);
    expect(odsOnly.ods_values).toContain("20");
    expect(odsOnly.likely_resolution_source).toMatch(/import history/i);

    const fpOnly = analysis.groups.find((g) => g.side === "FARMOPS_ONLY")!;
    expect(fpOnly.count).toBe(1);
    expect(fpOnly.systematic).toBe(false);
    expect(fpOnly.missing_provenance).toBe("EQUIPMENT_NAMEPLATE_REQUIRED");

    expect(
      analysis.rows_explained_by_systematic_pattern + analysis.rows_requiring_individual_review,
    ).toBe(analysis.raw_d);
  });

  it("never reclassifies or resolves a D finding and stays SHA-bound", () => {
    const { diag, analysis } = analyze(
      [{ stableId: "FS-001", values: { amps: "20" } }],
      snapshot({ load: [load("FS-001", { amps: null })] }),
    );
    expect(analysis.ods_sha256).toBe(SHA);
    expect(analysis.read_only).toBe(true);
    expect(analysis.write_authorized).toBe(false);
    expect(diag.counts_by_category.D).toBe(analysis.raw_d);
    for (const g of analysis.groups) {
      for (const f of g.findings) {
        expect(f.raw_category).toBe("D");
        expect(f.category).toBe("D");
        expect(f.unresolved).toBe(true);
        expect(f.convergence_disposition).toBe("PROVENANCE_VERIFICATION_REQUIRED");
      }
    }
    expect(String(categoryDAnalysis)).not.toMatch(/insert\(|update\(|upsert\(|delete\(/);
  });

  it("exports groups, findings and a markdown report", () => {
    const { analysis } = analyze(
      [
        { stableId: "FS-001", values: { amps: "20" }, sourceRow: 5 },
        { stableId: "FS-002", values: { amps: "20" }, sourceRow: 6 },
      ],
      snapshot({ load: [load("FS-001", { amps: null }), load("FS-002", { amps: null })] }),
    );
    expect(categoryDGroupsCsv(analysis).split("\n")[0]).toContain("missing_provenance");
    expect(categoryDGroupsCsv(analysis)).toContain(SHA);
    expect(categoryDFindingsCsv(analysis)).toContain("FS-002");
    const md = categoryDAnalysisMarkdown(analysis);
    expect(md).toContain("# Phase 4.4b — Category D provenance pattern analysis");
    expect(md).toContain(SHA);
    expect(md).toContain("Raw D = 2");
  });
});

describe("Category C stays resolved through PLACEHOLDER_PRESERVED_AS_NULL", () => {
  it("dispositions an unknown demand_va token against FarmOps NULL as resolved", () => {
    const { diag } = analyze(
      [{ stableId: "FS-010", values: { demand_va: "TBD" }, sourceRow: 9 }],
      snapshot({ load: [load("FS-010", { demand_va: null })] }),
    );
    const f = diag.findings.find(
      (x) => x.stable_id === "FS-010" && x.farmops_field === "demand_va",
    )!;
    expect(f.raw_category).toBe("C");
    expect(f.convergence_disposition).toBe("PLACEHOLDER_PRESERVED_AS_NULL");
    expect(f.unresolved).toBe(false);
    expect(diag.counts_by_category.C).toBe(1);
    expect(diag.unresolved_counts_by_category.C).toBe(0);
    expect(f.preserved.join(" ")).toContain("TBD");
  });
});
