import { describe, expect, it } from "vitest";
import {
  auditLoadMasterMapping,
  canonicalFieldForHeader,
  mappingAuditPreviewCsv,
  REQUIRED_VERIFIED_FIELDS,
} from "@/lib/electrical-load-mapping-audit";

// A miniature Load_Master reproducing the reported live symptoms: the FarmOps
// backup_priority column actually holds the Circuit Group ID column's values
// (one-column shift), suggested_panel is empty, D/S is empty, and Generator
// Start Class has no FarmOps load column at all.
const header = [
  "Load ID",
  "Load Description",
  "D/S",
  "Circuit Group ID",
  "Suggested Panel",
  "Critical",
  "Backup Eligible",
  "Backup Priority",
  "Backup Panel",
  "Load Shed Group",
  "Generator Start Class",
  "Generator Start Amps",
  "Continuous Load",
  "Demand VA",
  "Phase",
];

const rows = [
  header,
  ["FS-082", "Mini Split SE", "D", "East01", "PNL-FS-A", "Y", "Y", "Critical", "PNL-FS-CRIT", "LS-1", "Soft start", "45", "N", "3000", "1"],
  ["FS-083", "Mini Split E", "S", "Ceil03", "PNL-FS-A", "Y", "Y", "Nice to Have", "PNL-FS-CRIT", "LS-2", "TBD", "", "N", "3000", "1"],
];

const dbRows = [
  {
    load_id: "FS-082",
    description: "Mini Split SE",
    dedicated_shared: null,
    circuit_group_ref: null,
    suggested_panel: null,
    critical: true,
    backup_eligible: true,
    // shifted: holds the Circuit Group ID value
    backup_priority: "East01",
    backup_panel: "PNL-FS-CRIT",
    load_shed_group: "LS-1",
    continuous_load: false,
    demand_va: 3000,
    phase: "1",
  },
  {
    load_id: "FS-083",
    description: "Mini Split E",
    dedicated_shared: null,
    circuit_group_ref: null,
    suggested_panel: null,
    critical: true,
    backup_eligible: true,
    backup_priority: "Ceil03",
    backup_panel: "PNL-FS-CRIT",
    load_shed_group: "LS-2",
    continuous_load: false,
    demand_va: 3000,
    phase: "1",
  },
];

const audit = auditLoadMasterMapping({
  sheet: { name: "Load_Master", rows },
  headerRow: 0,
  importerColumns: header.map((source) => ({
    source,
    target: canonicalFieldForHeader(source)?.destination ?? null,
  })),
  odsRows: [
    { sourceRow: 1, stableId: "FS-082" },
    { sourceRow: 2, stableId: "FS-083" },
  ],
  dbRows,
});

const col = (semantic: string) => audit.columns.find((c) => c.semantic_field === semantic)!;

describe("Load_Master field-mapping audit (preview only)", () => {
  it("verifies every acceptance-listed canonical field", () => {
    for (const f of REQUIRED_VERIFIED_FIELDS) {
      expect(audit.required_verdicts.some((v) => v.semantic_field === f)).toBe(true);
    }
  });

  it("identifies fields by physical column + exact header, not FarmOps contents", () => {
    expect(col("circuit_group_id").physical_column).toBe(4);
    expect(col("backup_priority").physical_column).toBe(8);
    expect(col("dedicated_shared").ods_header).toBe("D/S");
  });

  it("proves the Backup Priority destination is fed by the Circuit Group ID column", () => {
    const bp = col("backup_priority");
    expect(bp.status).toBe("SHIFTED_COLUMN_MAPPING");
    expect(bp.content_source_column).toBe(4);
    expect(bp.confidence).toBe("HIGH");
    expect(audit.deterministic_shift_detected).toBe(true);
  });

  it("reports dropped canonical values instead of inventing meaning", () => {
    expect(col("suggested_panel").status).toBe("REQUIRES_REVIEW");
    expect(col("suggested_panel").finding).toMatch(/dropped on import/);
    expect(col("dedicated_shared").status).toBe("REQUIRES_REVIEW");
  });

  it("reports canonical fields with no FarmOps load column as unmapped", () => {
    expect(col("generator_start_class").status).toBe("UNMAPPED_CANONICAL_FIELD");
    expect(col("generator_start_class").expected_destination).toBeNull();
    expect(col("generator_start_amps").status).toBe("UNMAPPED_CANONICAL_FIELD");
  });

  it("marks correctly mapped engineering fields exact", () => {
    expect(col("demand_va").status).toBe("EXACT_MAPPING");
    expect(col("phase").status).toBe("EXACT_MAPPING");
    expect(col("backup_panel").status).toBe("EXACT_MAPPING");
  });

  it("previews row-level corrections without proposing writes for unrepresentable fields", () => {
    const bp = audit.preview.filter((r) => r.field === "backup_priority");
    expect(bp.map((r) => r.stable_id).sort()).toEqual(["FS-082", "FS-083"]);
    expect(bp[0].current_farmops_value).toBe("East01");
    expect(bp[0].proposed_farmops_value).toBe("Critical");
    const gsc = audit.preview.filter((r) => r.field === "generator_start_class");
    expect(gsc[0].proposed_farmops_value).toMatch(/NOT REPRESENTABLE/);
    expect(mappingAuditPreviewCsv(audit).split("\n")[0]).toContain("proposed_farmops_value");
  });
});
