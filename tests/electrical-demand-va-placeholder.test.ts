import { describe, expect, it } from "vitest";
import {
  classifyDemandVaToken,
  demandVaPlaceholderAdjudication,
  demandVaPlaceholderMarkdown,
  demandVaTokensCsv,
} from "@/lib/electrical-demand-va-placeholder";
import { numericDiagnostics } from "@/lib/electrical-numeric-diagnostics";
import { runParallelComparison, type OdsSheetRows } from "@/lib/electrical-parallel-validation";
import { buildElectricalSnapshot, type RawRow } from "@/lib/electrical-snapshot";
import { ENTITIES } from "@/lib/electrical-entities";
import type { ElectricalEntityKind } from "@/lib/electrical";

const SHA = "89da43c7f1f94948e17ecfdc942dbdba022cfee5ba504b70865529cf39877388";
const KINDS = Object.keys(ENTITIES) as ElectricalEntityKind[];

function snapshot(loads: RawRow[]) {
  const rows = {} as Record<ElectricalEntityKind, RawRow[]>;
  for (const kind of KINDS) rows[kind] = [];
  rows.load = loads;
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

function report(tokens: Record<string, string>) {
  const ids = Object.keys(tokens);
  const sheets: OdsSheetRows[] = [
    {
      sheet: "Load_Master",
      kind: "load",
      rows: ids.map((id, i) => ({
        stableId: id,
        values: { load_id: id, demand_va: tokens[id] },
        sourceRow: i + 2,
      })),
      unmapped: [],
    },
  ];
  const diag = numericDiagnostics(
    runParallelComparison({
      odsFileName: "PremoFarmElectrical.ods",
      odsSha256: SHA,
      comparedAt: "2026-09-01T01:00:00.000Z",
      sheets,
      snapshot: snapshot(ids.map((id) => load(id))),
    }),
  );
  return demandVaPlaceholderAdjudication(diag);
}

describe("Phase 4.4b demand VA placeholder semantic adjudication", () => {
  it("classifies each source token without collapsing distinct semantics", () => {
    expect(classifyDemandVaToken("TBD")).toBe("UNKNOWN_NOT_YET_DETERMINED");
    expect(classifyDemandVaToken("?")).toBe("UNKNOWN_NOT_YET_DETERMINED");
    expect(classifyDemandVaToken("UNKNOWN")).toBe("UNKNOWN_NOT_YET_DETERMINED");
    expect(classifyDemandVaToken("N/A")).toBe("NOT_APPLICABLE");
    expect(classifyDemandVaToken("VERIFY")).toBe("VERIFICATION_REQUIRED");
    expect(classifyDemandVaToken("0")).toBe("EXPLICIT_ZERO");
    expect(classifyDemandVaToken("")).toBe("BLANK_UNSPECIFIED");
    expect(classifyDemandVaToken("per panel schedule")).toBe("OTHER_UNRESOLVED");
  });

  it("never coerces a text placeholder to zero", () => {
    for (const t of ["TBD", "N/A", "VERIFY", "?", "UNKNOWN"]) {
      expect(classifyDemandVaToken(t)).not.toBe("EXPLICIT_ZERO");
    }
  });

  it("preserves the exact source token per group", () => {
    const a = report({ "FS-201": "TBD", "FS-202": "tbd", "FS-203": "N/A" });
    expect(a.tokens.map((t) => t.token).sort()).toEqual(["N/A", "TBD", "tbd"]);
    expect(a.distinct_source_tokens).toBe(3);
  });

  it("resolves only unknown tokens as PLACEHOLDER_PRESERVED_AS_NULL", () => {
    const a = report({
      "FS-201": "TBD",
      "FS-202": "TBD",
      "FS-203": "N/A",
      "FS-204": "VERIFY",
      "FS-205": "per panel schedule",
    });
    const byToken = new Map(a.tokens.map((t) => [t.token, t]));
    expect(byToken.get("TBD")?.adjudication).toBe("PLACEHOLDER_PRESERVED_AS_NULL");
    expect(byToken.get("TBD")?.resolved_for_phase_4_5).toBe(true);
    expect(byToken.get("N/A")?.adjudication).toBe("SEMANTIC_NOT_EQUIVALENT_TO_NULL");
    expect(byToken.get("VERIFY")?.adjudication).toBe("SEMANTIC_NOT_EQUIVALENT_TO_NULL");
    expect(byToken.get("per panel schedule")?.resolved_for_phase_4_5).toBe(false);
    expect(a.placeholder_preserved_as_null).toBe(2);
    expect(a.still_unresolved_c).toBe(a.raw_c - 2);
    expect(a.semantic_status_model_required).toBe(true);
  });

  it("keeps raw Category-C findings and the SHA binding immutable", () => {
    const a = report({ "FS-201": "TBD", "FS-202": "N/A" });
    expect(a.ods_sha256).toBe(SHA);
    expect(a.tokens.every((t) => t.findings.every((f) => f.raw_category === "C"))).toBe(true);
    expect(a.read_only).toBe(true);
    expect(a.write_authorized).toBe(false);
    expect(a.model_proposal.applied).toBe(false);
  });

  it("reports no status model when only one semantic is present", () => {
    const a = report({ "FS-201": "TBD", "FS-202": "TBD" });
    expect(a.semantic_status_model_required).toBe(false);
    expect(a.still_unresolved_in_scope).toBe(0);
  });

  it("exports token and markdown reports", () => {
    const a = report({ "FS-201": "TBD", "FS-202": "N/A" });
    expect(demandVaTokensCsv(a)).toContain("PLACEHOLDER_PRESERVED_AS_NULL");
    const md = demandVaPlaceholderMarkdown(a);
    expect(md).toContain("Placeholder-preserved-as-NULL");
    expect(md).toContain("Distinct source tokens");
  });
});
