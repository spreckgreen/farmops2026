import { describe, expect, it } from "vitest";
import {
  ODS_EXTRAS_FIELD,
  checkStableId,
  parseOdsExtras,
  preservedOdsValues,
} from "@/lib/electrical";
import { ENTITIES, importColumns, writableColumns } from "@/lib/electrical-entities";
import { mapSheet } from "@/lib/electrical-ods";
import { FIELD_MAP } from "@/lib/electrical-field-map";
import {
  runParallelComparison,
  type OdsSheetRows,
  type ValidationReport,
} from "@/lib/electrical-parallel-validation";
import { buildElectricalSnapshot, type RawRow } from "@/lib/electrical-snapshot";
import type { ElectricalEntityKind } from "@/lib/electrical";

const KINDS = Object.keys(ENTITIES) as ElectricalEntityKind[];

function snapshot(partial: Partial<Record<ElectricalEntityKind, RawRow[]>> = {}) {
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

function run(sheets: OdsSheetRows[], snap: ReturnType<typeof snapshot>): ValidationReport {
  return runParallelComparison({
    odsFileName: "PremoFarmElectrical.ods",
    odsSha256: "d".repeat(64),
    comparedAt: "2026-09-01T00:00:00.000Z",
    sheets,
    snapshot: snap,
    snapshotSha256: "e".repeat(64),
  });
}

describe("Phase 4.4a — lossless capture of canonical columns", () => {
  const sheet = {
    name: "Load_Master",
    rows: [
      ["Load ID", "Load Description", "Harmonic Distortion Factor", "Insulation Class"],
      ["FS-042", "Welder", "0.08", "THHN 90C"],
    ],
  };

  it("preserves every unmapped populated column verbatim under its exact header", () => {
    const mapped = mapSheet(sheet, "load", importColumns("load"), "load_id");
    const extras = JSON.parse(mapped.rows[0]!.values[ODS_EXTRAS_FIELD]!) as Record<string, string>;
    expect(extras["Harmonic Distortion Factor"]).toBe("0.08");
    expect(extras["Insulation Class"]).toBe("THHN 90C");
    // Source identity makes the preserved value traceable to its canonical cell.
    expect((extras as any).__source["Insulation Class"]).toEqual({
      sheet: "Load_Master",
      header: "Insulation Class",
      column: 4,
    });
  });

  it("reports a duplicate header collision instead of dropping it silently", () => {
    const dup = {
      name: "Load_Master",
      rows: [
        ["Load ID", "Load Description", "Description"],
        ["FS-042", "Welder", "Shop welder 240V"],
      ],
    };
    const mapped = mapSheet(dup, "load", importColumns("load"), "load_id");
    const collided = mapped.columns.find((c) => c.collidedWith);
    expect(collided?.source).toBe("Description");
    expect(collided?.collidedWith).toBe("description");
    const extras = JSON.parse(mapped.rows[0]!.values[ODS_EXTRAS_FIELD]!) as Record<string, string>;
    expect(extras["Description"]).toBe("Shop welder 240V");
  });

  it("classifies a preserved column as an expected transformation, not LOSS", () => {
    const r = run(
      [
        {
          sheet: "Load_Master",
          kind: "load",
          rows: [{ stableId: "FS-042", values: {} }],
          unmapped: [
            {
              column: "Harmonic Distortion Factor",
              populated: true,
              populatedRows: 1,
              samples: [{ stableId: "FS-042", value: "0.08" }],
            },
          ],
        },
      ],
      snapshot({
        load: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            load_id: "FS-042",
            ods_extras: JSON.stringify({ "Harmonic Distortion Factor": "0.08" }),
          },
        ],
      }),
    );
    const rec = r.records.find((x) => x.ods_column === "Harmonic Distortion Factor")!;
    expect(rec.classification).toBe("EXPECTED_TRANSFORMATION");
    expect(rec.root_cause).toBe("documented_verbatim_preservation_in_ods_extras");
    expect(rec.farmops_field).toBe(ODS_EXTRAS_FIELD);
    expect(r.summary.LOSS).toBe(0);
  });

  it("still reports LOSS when the value was not actually preserved", () => {
    const r = run(
      [
        {
          sheet: "Load_Master",
          kind: "load",
          rows: [{ stableId: "FS-042", values: {} }],
          unmapped: [
            {
              column: "Harmonic Distortion Factor",
              populated: true,
              populatedRows: 1,
              samples: [{ stableId: "FS-042", value: "0.08" }],
            },
          ],
        },
      ],
      snapshot({
        load: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            load_id: "FS-042",
            ods_extras: JSON.stringify({ "Harmonic Distortion Factor": "0.09" }),
          },
        ],
      }),
    );
    expect(r.summary.LOSS).toBe(1);
    expect(r.gate.status).toBe("FAIL");
  });

  it("keeps the capture column read-only and out of user-editable forms", () => {
    for (const kind of ["panel", "load", "raceway", "jbox", "branch", "feeder", "circuit_group"] as const) {
      expect(importColumns(kind), kind).toContain(ODS_EXTRAS_FIELD);
      expect(writableColumns(kind), kind).not.toContain(ODS_EXTRAS_FIELD);
    }
    for (const kind of ["rack", "power_asset", "device"] as const) {
      expect(importColumns(kind), kind).not.toContain(ODS_EXTRAS_FIELD);
    }
  });

  it("documents the preservation rule in the mapping matrix", () => {
    expect(FIELD_MAP.some((r) => r.farmops.includes("ods_extras"))).toBe(true);
  });

  it("keeps CON-### canonical and refuses new EMT-### raceway IDs", () => {
    expect(checkStableId("raceway", "CON-104").ok).toBe(true);
    // Pre-existing EMT records stay readable and are never renamed...
    expect(checkStableId("raceway", "EMT-104", { mode: "existing" }).ok).toBe(true);
    // ...but a new EMT-### raceway ID cannot be created.
    const created = checkStableId("raceway", "EMT-104", { mode: "create" });
    expect(created.ok).toBe(false);
    expect(created.error).toContain("CON-###");
  });
});

describe("Phase 4.4a — sheet-specific importer aliases", () => {
  it("binds canonical feeder, raceway, j-box, branch and circuit-group headers", () => {
    const cases: { kind: ElectricalEntityKind; id: string; header: string; target: string }[] = [
      { kind: "feeder", id: "feeder_id", header: "Wire Size", target: "conductor_size" },
      { kind: "raceway", id: "conduit_id", header: "Conduit Type", target: "raceway_type" },
      { kind: "jbox", id: "jbox_id", header: "Box Size", target: "dimensions" },
      { kind: "branch", id: "branch_id", header: "Breaker Size", target: "circuit_rating_amps" },
      { kind: "circuit_group", id: "circuit_group_id", header: "Breaker No", target: "breaker_number" },
    ];
    for (const c of cases) {
      const mapped = mapSheet(
        { name: c.kind, rows: [[c.id, c.header], ["X-001", "value"]] },
        c.kind,
        importColumns(c.kind),
        c.id,
      );
      const bound = mapped.columns.find((x) => x.source === c.header);
      expect(bound?.target, `${c.kind}/${c.header}`).toBe(c.target);
    }
  });
});

describe("Phase 4.4a — duplicate and unnamed header preservation", () => {
  it("keeps both occurrences of an identical duplicate header", () => {
    const dup = {
      name: "Load_Master",
      rows: [
        ["Load ID", "Source / Reference", "Source / Reference"],
        ["FS-042", "Sheet 3", "Field survey"],
      ],
    };
    const mapped = mapSheet(dup, "load", importColumns("load"), "load_id");
    const extras = JSON.parse(mapped.rows[0]!.values[ODS_EXTRAS_FIELD]!) as Record<string, unknown>;
    // The first occurrence binds the typed field; the second is preserved
    // verbatim under a column-numbered key instead of overwriting the first.
    expect(mapped.rows[0]!.values["source_reference"]).toBe("Sheet 3");
    expect(preservedOdsValues(extras, "Load_Master", "Source / Reference")).toEqual([
      "Field survey",
    ]);
  });

  it("preserves populated cells under unnamed columns", () => {
    const unnamed = {
      name: "Load_Master",
      rows: [
        ["Load ID", "Load Description", ""],
        ["FS-042", "Welder", "12.5 kVA"],
      ],
    };
    const mapped = mapSheet(unnamed, "load", importColumns("load"), "load_id");
    const extras = JSON.parse(mapped.rows[0]!.values[ODS_EXTRAS_FIELD]!) as Record<string, unknown>;
    expect(Object.values(extras)).toContain("12.5 kVA");
  });

  it("rejects capture that is not valid JSON as preservation evidence", () => {
    expect(parseOdsExtras("not json")).toBeNull();
    expect(preservedOdsValues(parseOdsExtras("not json"), "Load_Master", "Any")).toEqual([]);
  });
});
