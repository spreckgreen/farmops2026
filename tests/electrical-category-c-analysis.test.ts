import { describe, expect, it } from "vitest";
import {
  categoryCAnalysis,
  categoryCAnalysisMarkdown,
  categoryCFindingsCsv,
  categoryCGroupsCsv,
  likelyCause,
  odsPattern,
} from "@/lib/electrical-category-c-analysis";
import { numericDiagnostics } from "@/lib/electrical-numeric-diagnostics";
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
    generatedAt: "2026-09-01T00:00:00.000Z",
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
  const sheets: OdsSheetRows[] = [
    { sheet: "Load_Master", kind: "load", rows, unmapped: [] },
  ];
  const diag = numericDiagnostics(
    runParallelComparison({
      odsFileName: "PremoFarmElectrical.ods",
      odsSha256: SHA,
      comparedAt: "2026-09-01T01:00:00.000Z",
      sheets,
      snapshot: snap,
    }),
  );
  return { diag, analysis: categoryCAnalysis(diag) };
}

describe("Phase 4.4b Category C pattern analysis", () => {
  it("recognises ODS representation patterns structurally", () => {
    expect(odsPattern("TBD")).toBe("PLACEHOLDER_TOKEN");
    expect(odsPattern("?")).toBe("PLACEHOLDER_TOKEN");
    expect(odsPattern("N/A")).toBe("NOT_APPLICABLE_MARKER");
    expect(odsPattern("40-60")).toBe("RANGE");
    expect(odsPattern("~45")).toBe("APPROXIMATE");
    expect(odsPattern("=B4*1.25")).toBe("FORMULA");
    expect(odsPattern("25 m")).toBe("NUMBER_WITH_UNRECOGNISED_UNIT");
    expect(odsPattern("20, 30")).toBe("MULTI_VALUE_LIST");
    expect(odsPattern("see panel schedule")).toBe("FREE_TEXT");
  });

  it("maps patterns to a likely cause without changing classification", () => {
    expect(likelyCause("PLACEHOLDER_TOKEN", "non_numeric")).toBe("PLACEHOLDER_OR_UNKNOWN");
    expect(likelyCause("NOT_APPLICABLE_MARKER", "non_numeric")).toBe("BLANK_OR_NULL_SEMANTICS");
    expect(likelyCause("FORMULA", "non_numeric")).toBe("FORMULA_OR_DERIVED_VALUE");
    expect(likelyCause("RANGE", "non_numeric")).toBe("COMPOSITE_VALUE_NOT_REPRESENTABLE");
    expect(likelyCause("APPROXIMATE", "non_numeric")).toBe("MISSING_MODEL_CONCEPT");
    expect(likelyCause("NUMBER_WITH_UNRECOGNISED_UNIT", "ambiguous_unit")).toBe("MISSING_MAPPING");
    expect(likelyCause("FREE_TEXT", "non_numeric")).toBe("TEXT_IN_NUMERIC_FIELD");
    expect(likelyCause("NON_PRINTING_OR_NOISE", "non_numeric")).toBe("SOURCE_PARSE_ISSUE");
  });

  it("groups repeated patterns and separates one-off rows", () => {
    const { analysis } = analyze(
      [
        { stableId: "FS-001", values: { amps: "TBD" }, sourceRow: 5 },
        { stableId: "FS-002", values: { amps: "TBD" }, sourceRow: 6 },
        { stableId: "FS-003", values: { amps: "TBD" }, sourceRow: 7 },
        { stableId: "FS-004", values: { amps: "40-60" }, sourceRow: 8 },
      ],
      snapshot({
        load: [
          load("FS-001", { amps: 20 }),
          load("FS-002", { amps: 20 }),
          load("FS-003", { amps: 20 }),
          load("FS-004", { amps: 50 }),
        ],
      }),
    );

    expect(analysis.raw_c).toBe(4);
    expect(analysis.groups_count).toBe(2);
    const placeholder = analysis.groups.find((g) => g.ods_pattern === "PLACEHOLDER_TOKEN")!;
    expect(placeholder.count).toBe(3);
    expect(placeholder.systematic).toBe(true);
    expect(placeholder.likely_cause).toBe("PLACEHOLDER_OR_UNKNOWN");
    expect(placeholder.representative_stable_ids).toContain("FS-001");
    expect(placeholder.source_worksheets).toContain("Load_Master");
    expect(placeholder.mapping_rule).toContain("electrical_loads.amps");
    expect(placeholder.findings).toHaveLength(3);

    const range = analysis.groups.find((g) => g.ods_pattern === "RANGE")!;
    expect(range.count).toBe(1);
    expect(range.systematic).toBe(false);

    expect(analysis.rows_explained_by_systematic_pattern).toBe(3);
    expect(analysis.rows_requiring_individual_review).toBe(1);
    expect(
      analysis.rows_explained_by_systematic_pattern + analysis.rows_requiring_individual_review,
    ).toBe(analysis.raw_c);
  });

  it("does not reclassify findings and stays bound to the workbook SHA", () => {
    const { diag, analysis } = analyze(
      [{ stableId: "FS-001", values: { amps: "TBD" } }],
      snapshot({ load: [load("FS-001", { amps: 20 })] }),
    );
    expect(analysis.ods_sha256).toBe(SHA);
    expect(analysis.read_only).toBe(true);
    for (const g of analysis.groups) {
      for (const f of g.findings) {
        expect(f.raw_category).toBe("C");
        expect(f.category).toBe("C");
      }
    }
    // raw counts untouched
    expect(diag.counts_by_category.C).toBe(analysis.raw_c);
    for (const fn of [categoryCAnalysis]) {
      expect(String(fn)).not.toMatch(/insert\(|update\(|upsert\(|delete\(/);
    }
  });

  it("exports groups, underlying findings and a markdown report", () => {
    const { analysis } = analyze(
      [
        { stableId: "FS-001", values: { amps: "TBD" }, sourceRow: 5 },
        { stableId: "FS-002", values: { amps: "TBD" }, sourceRow: 6 },
      ],
      snapshot({ load: [load("FS-001", { amps: 20 }), load("FS-002", { amps: 20 })] }),
    );
    const groupsCsv = categoryCGroupsCsv(analysis);
    expect(groupsCsv.split("\n")[0]).toContain("likely_cause");
    expect(groupsCsv).toContain(SHA);
    const findingsCsv = categoryCFindingsCsv(analysis);
    expect(findingsCsv).toContain("FS-001");
    expect(findingsCsv).toContain("FS-002");
    const md = categoryCAnalysisMarkdown(analysis);
    expect(md).toContain("# Phase 4.4b — Category C pattern analysis");
    expect(md).toContain(SHA);
    expect(md).toContain("Raw C = 2");
    expect(md).toContain("Groups = 1");
  });
});
