import { describe, expect, it } from "vitest";
import {
  auditLoadMasterMapping,
  type LoadMappingAudit,
} from "@/lib/electrical-load-mapping-audit";
import {
  columnIsEligible,
  eligibleColumns,
  projectRows,
  reconcileRuleEffects,
  repairAuditSummary,
  repairKey,
  ruleEffect,
  schemaGaps,
  stillSafeToRepair,
  summarizeRepair,
  typedForColumn,
  type RepairProposal,
} from "@/lib/electrical-mapping-repair-gate";

/**
 * Worksheet where the importer sends "Circuit Group ID" into backup_priority
 * (wrong destination) — the exact defect class the gate may repair.
 */
function shiftedAudit(): LoadMappingAudit {
  const sheet = {
    name: "Load_Master",
    rows: [
      ["Load ID", "Load Description", "Critical", "Circuit Group ID", "Backup Priority"],
      ["FS-082", "Mini-split", "Y", "East01", "Critical"],
      ["FS-083", "Mini-split", "Y", "East02", "Nice to Have"],
    ],
  };
  return auditLoadMasterMapping({
    sheet,
    headerRow: 0,
    importerColumns: [
      { source: "Load ID", target: "load_id" },
      { source: "Load Description", target: "description" },
      { source: "Critical", target: "critical" },
      { source: "Circuit Group ID", target: "backup_priority" },
      { source: "Backup Priority", target: "backup_priority" },
    ],
    odsRows: [
      { sourceRow: 1, stableId: "FS-082" },
      { sourceRow: 2, stableId: "FS-083" },
    ],
    dbRows: [
      { id: "u1", load_id: "FS-082", description: "Mini-split", critical: true, backup_priority: "East01" },
      { id: "u2", load_id: "FS-083", description: "Mini-split", critical: true, backup_priority: "East02" },
    ],
  });
}

const guardOk = { ok: true } as const;

describe("mapping repair eligibility", () => {
  it("only accepts deterministic defects at HIGH confidence", () => {
    const audit = shiftedAudit();
    const cols = eligibleColumns(audit);
    expect(cols.length).toBeGreaterThan(0);
    for (const c of cols) {
      expect(["SHIFTED_COLUMN_MAPPING", "WRONG_DESTINATION_FIELD"]).toContain(c.status);
      expect(c.confidence).toBe("HIGH");
    }
    expect(
      columnIsEligible({
        ...cols[0],
        status: "DUPLICATE_HEADER_AMBIGUITY",
      }),
    ).toBe(false);
    expect(columnIsEligible({ ...cols[0], confidence: "MEDIUM" })).toBe(false);
  });

  it("reports schema gaps as SCHEMA_EXTENSION_REQUIRED and never repairs them", () => {
    const sheet = {
      name: "Load_Master",
      rows: [
        ["Load ID", "Generator Start Class", "Generator Start Amps"],
        ["FS-082", "MOTOR", "58"],
      ],
    };
    const audit = auditLoadMasterMapping({
      sheet,
      headerRow: 0,
      importerColumns: [{ source: "Load ID", target: "load_id" }, { source: "", target: null }, { source: "", target: null }],
      odsRows: [{ sourceRow: 1, stableId: "FS-082" }],
      dbRows: [{ id: "u1", load_id: "FS-082" }],
    });
    const gaps = schemaGaps(audit);
    expect(gaps.map((g) => g.semantic_field).sort()).toEqual([
      "generator_start_amps",
      "generator_start_class",
    ]);
    for (const g of gaps) expect(g.status).toBe("SCHEMA_EXTENSION_REQUIRED");
    // Never eligible for a write.
    expect(eligibleColumns(audit).some((c) => c.semantic_field?.startsWith("generator_start"))).toBe(
      false,
    );
  });
});

describe("value typing", () => {
  it("types booleans, numbers and text, refusing inference", () => {
    expect(typedForColumn("critical", "Y")).toBe(true);
    expect(typedForColumn("critical", "N")).toBe(false);
    expect(typedForColumn("critical", "maybe")).toBeUndefined();
    expect(typedForColumn("demand_va", "1,200")).toBe(1200);
    expect(typedForColumn("demand_va", "TBD")).toBeUndefined();
    expect(typedForColumn("backup_priority", " Critical ")).toBe("Critical");
    expect(typedForColumn("suggested_panel", "")).toBeNull();
  });
});

describe("write guard", () => {
  const base = {
    stable_id: "FS-082",
    destination: "backup_priority",
    live_value: "East01",
    previewed_current: "East01",
    canonical_raw_now: "Critical",
    previewed_canonical_raw: "Critical",
    proposed_value: "Critical" as string | number | boolean | null | undefined,
    defect: "WRONG_DESTINATION_FIELD" as const,
    confidence: "HIGH" as const,
    baseline: guardOk,
    supersedingEvidence: null as string | null,
    approved: true,
  };

  it("allows an approved deterministic repair", () => {
    expect(stillSafeToRepair(base).ok).toBe(true);
  });

  it("blocks on baseline, drift, evidence, approval, classification and typing", () => {
    const status = (o: Partial<typeof base>) => {
      const r = stillSafeToRepair({ ...base, ...o });
      return r.ok ? "ok" : r.status;
    };
    expect(status({ baseline: { ok: false, reason: "wrong SHA" } })).toBe("baseline_blocked");
    expect(status({ live_value: "changed" })).toBe("drifted");
    expect(status({ canonical_raw_now: "Stretch" })).toBe("drifted");
    expect(status({ live_value: "Critical", previewed_current: "Critical" })).toBe("already_correct");
    expect(status({ supersedingEvidence: "field correction 2026-09-01" })).toBe("newer_evidence");
    expect(status({ approved: false })).toBe("not_approved");
    expect(status({ defect: "REQUIRES_REVIEW" })).toBe("not_approved");
    expect(status({ confidence: "MEDIUM" })).toBe("not_approved");
    expect(status({ proposed_value: undefined })).toBe("failed");
  });
});

describe("business-rule reconciliation", () => {
  const rows = [
    { load_id: "A", load: 1, critical: true, dedicated_shared: "D", backup_priority: "East01" },
    { load_id: "B", critical: true, dedicated_shared: "S", circuit_group_ref: "", backup_priority: "Ceil03" },
  ];
  const proposals: RepairProposal[] = [
    {
      table: "electrical_loads",
      stable_id: "A",
      row_uuid: "u1",
      ods_physical_column: 5,
      ods_header: "Backup Priority",
      semantic_field: "backup_priority",
      destination: "backup_priority",
      canonical_raw: "Critical",
      proposed_value: "Critical",
      current_farmops_value: "East01",
      defect: "WRONG_DESTINATION_FIELD",
      confidence: "HIGH",
      baseline_sha256: "abc",
      status: "would_change",
      applied_at: null,
    },
  ];

  it("projects proposals in memory without mutating the source rows", () => {
    const after = projectRows(rows, proposals);
    expect(after[0]["backup_priority"]).toBe("Critical");
    expect(rows[0].backup_priority).toBe("East01");
  });

  it("moves the REQUIRED tier only after the repair and reports unresolved shared rows", () => {
    const before = ruleEffect(rows);
    const after = ruleEffect(projectRows(rows, proposals));
    expect(before.circuitsByTier.REQUIRED).toBe(0);
    expect(after.circuitsByTier.REQUIRED).toBe(1);
    expect(after.unresolvedSharedCircuits).toBe(1);
  });

  it("reconciles only when the post-repair view equals the canonical view", () => {
    const after = ruleEffect(projectRows(rows, proposals));
    expect(reconcileRuleEffects(ruleEffect(rows), after, after).reconciles).toBe(true);
    const mismatch = reconcileRuleEffects(ruleEffect(rows), after, ruleEffect(rows));
    expect(mismatch.reconciles).toBe(false);
    expect(mismatch.differences.length).toBeGreaterThan(0);
  });

  it("keys, summarizes and records mapping-defect provenance", () => {
    expect(repairKey(proposals[0])).toBe("electrical_loads|A|backup_priority");
    const s = summarizeRepair(proposals, [], { sha256: "abc", authorized: true });
    expect(s.would_change).toBe(1);
    expect(s.reconciles).toBe(true);
    expect(repairAuditSummary(proposals[0])).toContain("proven Load_Master mapping/import defect");
  });
});
