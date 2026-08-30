import { describe, expect, it } from "vitest";
import { ODS_EXTRAS_FIELD, ODS_EXTRAS_SOURCE_KEY, preservedOdsEntries } from "@/lib/electrical";
import { classifySheet, isNonEntitySheet } from "@/lib/electrical-ods";
import { lossDiagnosticsCsv } from "@/lib/electrical-reconciliation";
import {
  runParallelComparison,
  type OdsSheetRows,
  type ValidationReport,
  type WorkbookMetadataSheet,
} from "@/lib/electrical-parallel-validation";
import { ENTITIES } from "@/lib/electrical-entities";
import { buildElectricalSnapshot, type RawRow } from "@/lib/electrical-snapshot";
import type { ElectricalEntityKind } from "@/lib/electrical";

const KINDS = Object.keys(ENTITIES) as ElectricalEntityKind[];

function snapshot(partial: Partial<Record<ElectricalEntityKind, RawRow[]>> = {}) {
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

function run(
  sheets: OdsSheetRows[],
  snap: ReturnType<typeof snapshot>,
  workbookMetadata: WorkbookMetadataSheet[] = [],
): ValidationReport {
  return runParallelComparison({
    odsFileName: "PremoFarmElectrical.ods",
    odsSha256: "f".repeat(64),
    comparedAt: "2026-09-02T00:00:00.000Z",
    sheets,
    workbookMetadata,
    snapshot: snap,
    snapshotSha256: "0".repeat(64),
  });
}

const unmappedSheet = (
  values: { stableId: string; value: string }[],
  column = "Harmonic Distortion Factor",
  duplicate = false,
  columnIndex = 9,
): OdsSheetRows => ({
  sheet: "Load_Master",
  kind: "load",
  rows: values.map((v) => ({ stableId: v.stableId, values: {} })),
  unmapped: [
    {
      column,
      populated: true,
      populatedRows: values.length,
      columnIndex,
      duplicateHeader: duplicate,
      samples: values.map((v) => ({ stableId: v.stableId, value: v.value })),
    },
  ],
});

const load = (extras: Record<string, unknown> | null): RawRow => ({
  id: "l1",
  load_id: "FS-042",
  [ODS_EXTRAS_FIELD]: extras ? JSON.stringify(extras) : null,
});

const diag = (r: ValidationReport) => r.records.find((x) => x.loss_diagnostic)?.loss_diagnostic;

describe("Phase 4.4a — LOSS diagnostics and non-entity worksheets", () => {
  it("proves preservation through source identity for a duplicate-header column", () => {
    const extras = {
      "Circuit Group Description#33": "Shop lighting bank B",
      [ODS_EXTRAS_SOURCE_KEY]: {
        "Circuit Group Description#33": {
          sheet: "Load_Master",
          header: "Circuit Group Description",
          column: 33,
        },
      },
    };
    expect(
      preservedOdsEntries(extras, "Load_Master", "Circuit Group Description").map((e) => e.key),
    ).toEqual(["Circuit Group Description#33"]);

    const r = run(
      [
        unmappedSheet(
          [{ stableId: "FS-042", value: "Shop lighting bank B" }],
          "Circuit Group Description",
          true,
          32,
        ),
      ],
      snapshot({ load: [load(extras)] }),
    );
    const rec = r.records.find((x) => x.field === "Circuit Group Description")!;
    expect(rec.classification).toBe("EXPECTED_TRANSFORMATION");
    expect(rec.root_cause).toBe("duplicate_header_collision_preserved_verbatim");
  });

  it("reports why a record with capture still loses one column", () => {
    const r = run(
      [unmappedSheet([{ stableId: "FS-042", value: "0.08" }])],
      snapshot({
        load: [
          load({
            "Insulation Class": "THHN 90C",
            [ODS_EXTRAS_SOURCE_KEY]: {
              "Insulation Class": { sheet: "Load_Master", header: "Insulation Class", column: 8 },
            },
          }),
        ],
      }),
    );
    const d = diag(r)!;
    expect(d.rows[0].capture_present).toBe(true);
    expect(d.rows[0].capture_has_column).toBe(false);
    expect(d.rows[0].capture_has_source_metadata).toBe(true);
    expect(d.rows[0].capture_keys).toContain("Insulation Class");
    expect(d.rows[0].reason).toBe("column_absent_from_capture");
    expect(lossDiagnosticsCsv(r)).toContain("column_absent_from_capture");
  });

  it("distinguishes a differing captured value from an absent one", () => {
    const r = run(
      [unmappedSheet([{ stableId: "FS-042", value: "0.08" }])],
      snapshot({
        load: [load({ "Harmonic Distortion Factor": "0.09" })],
      }),
    );
    expect(diag(r)!.rows[0].reason).toBe("value_differs");
  });

  it("names an absent Feeders record rather than blaming capture", () => {
    const r = run(
      [
        {
          sheet: "Feeders",
          kind: "feeder",
          rows: [{ stableId: "FDR-001", values: {} }],
          unmapped: [
            {
              column: "Voltage Drop %",
              populated: true,
              populatedRows: 1,
              columnIndex: 12,
              duplicateHeader: false,
              samples: [{ stableId: "FDR-001", value: "1.8" }],
            },
          ],
        },
      ],
      snapshot({ feeder: [] }),
    );
    const d = diag(r)!;
    expect(d.rows[0].reason).toBe("record_not_found");
    expect(d.rows[0].capture_present).toBe(false);
  });

  it("never treats Design_Lists or Workbook_Info as electrical entities", () => {
    expect(isNonEntitySheet("Design_Lists")).toBe(true);
    expect(isNonEntitySheet("Workbook_Info")).toBe(true);
    expect(isNonEntitySheet("Load_Master")).toBe(false);
    expect(
      classifySheet({ name: "Design_Lists", rows: [["Panel", "Voltage"], ["PNL-X", "240"]] }),
    ).toBeNull();
    expect(
      classifySheet({ name: "Workbook_Info", rows: [["Feeder", "Revision"], ["A", "3"]] }),
    ).toBeNull();
  });

  it("preserves non-entity worksheet values verbatim without inventing records", () => {
    const meta: WorkbookMetadataSheet[] = [
      {
        sheet: "Workbook_Info",
        columns: [
          {
            header: "Revision",
            column: 2,
            populated_rows: 1,
            values: [{ row: 2, value: "Rev C 2026-04-01" }],
          },
        ],
      },
    ];
    const r = run([], snapshot(), meta);
    expect(r.workbook_metadata).toEqual(meta);
    const rec = r.records.find((x) => x.domain === "workbook_metadata")!;
    expect(rec.classification).toBe("EXPECTED_TRANSFORMATION");
    expect(rec.root_cause).toBe("documented_non_entity_workbook_structure");
    expect(rec.ods_value).toBe("Rev C 2026-04-01");
    expect(r.records.some((x) => x.domain === "panels" || x.domain === "feeders")).toBe(false);
  });
});
