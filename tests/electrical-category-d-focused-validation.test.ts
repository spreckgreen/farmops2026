// Focused Numeric Semantics / Category-D validation pass. Read-only:
// no FarmOps write, no canonical ODS write. Acceptance: 14 raw / 13 resolved /
// 1 open (FS-084).
import { describe, expect, it } from "vitest";
import { categoryDAnalysis } from "@/lib/electrical-category-d-analysis";
import { numericDiagnostics } from "@/lib/electrical-numeric-diagnostics";
import { runParallelComparison, type OdsSheetRows } from "@/lib/electrical-parallel-validation";
import { buildElectricalSnapshot, type RawRow } from "@/lib/electrical-snapshot";
import { ENTITIES } from "@/lib/electrical-entities";
import { PHASE_44A_BASELINE_SHA256 } from "@/lib/electrical-adjudication-baseline";
import type { ElectricalEntityKind } from "@/lib/electrical";

const KINDS = Object.keys(ENTITIES) as ElectricalEntityKind[];
/** Eleven loads whose FarmOps connected_va zero is an import/default artifact. */
const ZERO_LOADS = [
  "FS-011",
  "FS-012",
  "FS-013",
  "FS-014",
  "FS-015",
  "FS-016",
  "FS-017",
  "FS-018",
  "FS-019",
  "FS-020",
  "FS-021",
];

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

function run() {
  const sheets: OdsSheetRows[] = [
    {
      sheet: "Load_Master",
      kind: "load",
      rows: [
        // Eleven blank canonical connected_va cells against FarmOps zero.
        ...ZERO_LOADS.map((id, i) => ({
          stableId: id,
          values: { description: "load" },
          sourceRow: 10 + i,
        })),
        // FS-084: canonical 14,400 VA, FarmOps blank — stays open.
        { stableId: "FS-084", values: { connected_va: "14400" }, sourceRow: 84 },
      ],
      unmapped: [],
    },
    {
      sheet: "Panel_Schedule",
      kind: "panel",
      rows: [{ stableId: "PNL-H1", values: { panel_name: "House Main" }, sourceRow: 3 }],
      unmapped: [],
    },
  ];

  const report = runParallelComparison({
    odsFileName: "PremoFarmElectrical.ods",
    odsSha256: PHASE_44A_BASELINE_SHA256,
    comparedAt: "2026-09-02T06:00:00.000Z",
    sheets,
    snapshot: snapshot({
      load: [
        ...ZERO_LOADS.map((id) => load(id, { connected_va: 0 })),
        load("FS-084", { connected_va: null }),
      ],
      panel: [
        {
          id: "0000-PNL-H1",
          panel_id: "PNL-H1",
          panel_name: "House Main",
          bus_rating_amps: 200,
          spaces: 40,
          updated_at: "2026-08-01T00:00:00.000Z",
        },
      ],
    }),
  });

  const diag = numericDiagnostics(report);
  return { diag, analysis: categoryDAnalysis(diag) };
}

describe("focused Category-D validation (SHA-bound, read-only)", () => {
  it("reports 14 raw / 13 resolved / 1 open (FS-084)", () => {
    const { diag, analysis } = run();

    expect(analysis.ods_sha256).toBe(PHASE_44A_BASELINE_SHA256);
    expect(analysis.read_only).toBe(true);
    expect(analysis.write_authorized).toBe(false);

    expect(analysis.raw_d).toBe(14);
    expect(diag.counts_by_category.D).toBe(14);
    expect(analysis.rows_resolved_by_adjudication).toBe(13);
    expect(analysis.rows_open).toBe(1);

    const dFindings = diag.findings.filter((f) => f.raw_category === "D");
    const zeros = dFindings.filter(
      (f) => f.farmops_field === "connected_va" && f.stable_id !== "FS-084",
    );
    expect(zeros).toHaveLength(11);
    for (const f of zeros) {
      expect(f.convergence_disposition).toBe("IMPORT_DEFAULT_ZERO_ARTIFACT");
      expect(f.adjudication_classification).toBe("ZERO_DEFAULT_OR_COERCION_ARTIFACT");
      expect(f.unresolved).toBe(false);
      // Neither side is rewritten by the adjudication.
      expect(f.ods_raw.trim()).toBe("");
      expect(f.farmops_value).toBe(0);
    }

    const panel = dFindings.filter((f) => f.stable_id === "PNL-H1");
    expect(panel.map((f) => f.farmops_field).sort()).toEqual(["bus_rating_amps", "spaces"]);
    for (const f of panel)
      expect(f.convergence_disposition).toBe("FARMOPS_AS_BUILT_VALUE_VERIFIED");

    const open = dFindings.filter((f) => f.unresolved);
    expect(open).toHaveLength(1);
    expect(open[0]!.stable_id).toBe("FS-084");
    expect(open[0]!.farmops_field).toBe("connected_va");
    expect(open[0]!.ods_raw).toContain("14400");
    expect(open[0]!.farmops_value).toBeNull();
    expect(open[0]!.convergence_disposition).toBe("CURRENT_SEMANTICS_UNRESOLVED");
    // The canonical 14,400 VA is never proposed for import into FarmOps.
    expect(open[0]!.proposed_value ?? null).toBeNull();
  });
});
