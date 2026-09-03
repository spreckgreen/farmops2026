import { describe, expect, it } from "vitest";
import {
  IMPORT_CONTRACT_V3_VERSION,
  alignContractRegistry,
  alignmentCsv,
  buildContractV3,
  semanticForHeader,
} from "@/lib/electrical-load-contract-v3";
import {
  LOAD_MASTER_CONTRACT_V2,
  simulateContractReimport,
  type Sheet,
} from "@/lib/electrical-load-import-contract";
import { buildLossClosure } from "@/lib/electrical-load-loss-closure";

/**
 * Header row shaped like the SHA-authorized workbook: known canonical fields sit
 * at physical positions Contract v2 did not expect (Area at 2, Load Description
 * at 3, Demand Basis at 14, Volts at 15, Critical at 18, ...), plus one repeated
 * header and one genuinely unknown populated column.
 */
const HEADERS: string[] = [
  "Load ID", // 1
  "Area", // 2  (v2 expected Load Description)
  "Load Description", // 3  (v2 expected Area)
  "Count", // 4  (v2 expected Grid)
  "D/S", // 5
  "Grid", // 6  (v2 expected Count)
  "Equipment / Model", // 7
  "Location", // 8
  "Circuit Group ID", // 9
  "Circuit Group Description", // 10
  "Suggested Panel", // 11
  "Source Circuit", // 12
  "Circuit Rating Amps", // 13
  "Demand Basis", // 14 (v2 expected Volts)
  "Volts", // 15 (v2 expected Amps)
  "Connected VA", // 16
  "Connected kVA", // 17
  "Critical", // 18 (v2 expected Demand Basis)
  "Amps", // 19
  "Future", // 20
  "Source / Reference", // 21
  "Backup Priority", // 22 (v2 expected Notes)
  "Backup Eligible", // 23
  "Notes", // 24
  "Backup Panel", // 25
  "Generator Start Class", // 26
  "Generator Start Amps", // 27
  "Continuous Load", // 28
  "Demand VA", // 29
  "Phase", // 30
  "Load Shed Group", // 31
  "Circuit Group ID", // 32 duplicate
  "Mystery Column", // 33 genuinely unknown
  "Existing Panel", // 34
  "Installation Status", // 35 (v2 expected Existing Circuit)
  "Existing Circuit", // 36
  "Install Date", // 37
  "Installed By", // 38
  "Label Status", // 39
  "Calculated Complete %", // 40 (v2 expected Label Status)
  "Installation Notes", // 41
];

function sheet(): Sheet {
  const at = (h: string) => HEADERS.indexOf(h);
  const row = (id: string): string[] => {
    const r = new Array(HEADERS.length).fill("");
    r[at("Load ID")] = id;
    r[at("Area")] = "Farm Shop";
    r[at("Load Description")] = "Shop lights";
    r[at("Count")] = "2";
    r[at("Grid")] = "C3";
    r[at("D/S")] = "S";
    r[at("Volts")] = "120";
    r[at("Demand Basis")] = "Connected VA";
    r[at("Connected VA")] = "600";
    r[at("Critical")] = "Y";
    r[at("Backup Priority")] = "Critical";
    r[at("Notes")] = "engineering note";
    r[at("Circuit Group ID")] = "CG-FS-01";
    r[at("Generator Start Amps")] = "TBD";
    r[at("Installation Status")] = "Planned";
    r[at("Calculated Complete %")] = "25%";
    r[at("Mystery Column")] = "??";
    r[32] = "CG-FS-01"; // duplicate Circuit Group ID occurrence
    return r;
  };
  return { name: "Load_Master", rows: [[...HEADERS], row("FS-001"), row("FS-002")] };
}

const odsRows = [
  { sourceRow: 1, stableId: "FS-001" },
  { sourceRow: 2, stableId: "FS-002" },
];

describe("Contract registry alignment audit (v2 -> v3)", () => {
  it("never mutates the retained v2 registry", () => {
    expect(LOAD_MASTER_CONTRACT_V2[1].exact_header).toBe("Load Description");
    expect(LOAD_MASTER_CONTRACT_V2[13].exact_header).toBe("Volts");
    expect(LOAD_MASTER_CONTRACT_V2).toHaveLength(41);
  });

  it("reports each mismatched position with prior and new semantic identity", () => {
    const audit = alignContractRegistry(sheet(), 0);
    const row = (pc: number) => audit.rows.find((r) => r.physical_column === pc)!;
    expect(audit.to_version).toBe(IMPORT_CONTRACT_V3_VERSION);
    expect(row(1).disposition).toBe("ALIGNED");

    expect(row(2)).toMatchObject({
      v2_expected_header: "Load Description",
      observed_header: "Area",
      prior_semantic_identity: "description",
      v3_semantic_identity: "area",
      disposition: "REBOUND_BY_OBSERVED_HEADER",
    });
    expect(row(2).note).toContain("physical column 3");
    expect(row(14).v3_semantic_identity).toBe("demand_basis");
    expect(row(18).v3_semantic_identity).toBe("critical");
    expect(row(22).v3_semantic_identity).toBe("backup_priority");
    expect(row(35).v3_semantic_identity).toBe("install_status");
    expect(row(40).v3_semantic_identity).toBe("completion_percent");
  });

  it("separates duplicate headers from genuinely unknown ones", () => {
    const audit = alignContractRegistry(sheet(), 0);
    const row = (pc: number) => audit.rows.find((r) => r.physical_column === pc)!;
    expect(row(32).disposition).toBe("DUPLICATE_HEADER_LEGACY_PRESERVE");
    expect(row(32).v3_semantic_identity).toBe("circuit_group_id_legacy");
    expect(row(33).disposition).toBe("UNKNOWN_HEADER_OWNER_REVIEW");
    expect(audit.unknown_populated_columns).toBe(1);
  });

  it("emits one CSV row per physical column", () => {
    const audit = alignContractRegistry(sheet(), 0);
    expect(alignmentCsv(audit).trim().split("\n")).toHaveLength(audit.rows.length + 1);
  });
});

describe("Contract v3 binding", () => {
  it("binds known canonical fields at their observed physical positions", () => {
    const v3 = buildContractV3(sheet(), 0);
    const at = (pc: number) => v3.find((c) => c.physical_column === pc)!;
    expect(at(2)).toMatchObject({ canonical_semantic: "area", farmops_destination: "area" });
    expect(at(3).farmops_destination).toBe("description");
    expect(at(15).farmops_destination).toBe("volts");
    expect(at(19).farmops_destination).toBe("amps");
    expect(at(17).import_action).toBe("DERIVED_REPRESENTATION_DO_NOT_IMPORT");
    expect(at(13).import_action).toBe("SCHEMA_EXTENSION_REQUIRED");
    expect(at(27).import_action).toBe("SCHEMA_EXTENSION_REQUIRED");
    expect(at(33).import_action).toBe("UNRESOLVED");
    expect(at(41).canonical_semantic).toBe("installation_notes");
  });

  it("keeps the registry position-free but header-exact", () => {
    expect(semanticForHeader("Demand Basis")?.canonical_semantic).toBe("demand_basis");
    expect(semanticForHeader("Device Side Connected")?.canonical_semantic).toBe(
      "device_side_connected",
    );
    expect(semanticForHeader("Not A Header")).toBeUndefined();
  });
});

describe("re-simulation under v3", () => {
  const run = () => {
    const s = sheet();
    const sim = simulateContractReimport({
      sheet: s,
      headerRow: 0,
      odsRows,
      contract: buildContractV3(s, 0),
      contractVersion: IMPORT_CONTRACT_V3_VERSION,
    });
    return { sim, closure: buildLossClosure(sim.binding, sim.fields, sim.row_count, sim.contract_version) };
  };

  it("removes the registry-mismatch loss and imports canonical fields", () => {
    const { sim } = run();
    expect(sim.contract_version).toBe(IMPORT_CONTRACT_V3_VERSION);
    expect(sim.binding.unresolved).toBe(1); // only the genuinely unknown column
    expect(sim.rows[0].record.area).toBe("Farm Shop");
    expect(sim.rows[0].record.description).toBe("Shop lights");
    expect(sim.rows[0].record.demand_basis).toBe("Connected VA");
    expect(sim.rows[0].record.volts).toBe(120);
    expect(sim.rows[0].record.critical).toBe(true);
    // Loss is now confined to the unknown column's populated cells.
    expect(sim.totals.semantic_loss).toBe(2);
  });

  it("only considers the genuinely unknown column for structured extras", () => {
    const { closure } = run();
    expect(closure.version).toBe(`${IMPORT_CONTRACT_V3_VERSION}.loss-closure.v1`);
    const extras = closure.rows.filter(
      (r) => r.preservation_method === "STRUCTURED_ODS_EXTRA" && r.populated_cells > 0,
    );
    expect(extras).toHaveLength(1);
    expect(extras[0]).toMatchObject({ physical_column: 33, observed_header: "Mystery Column" });
    expect(closure.totals.remaining_unresolved).toBe(0);
    expect(closure.closes).toBe(true);
  });

  it("still reproduces the canonical business-rule result", () => {
    const { sim } = run();
    expect(sim.reproduces_canonical).toBe(true);
  });
});
