import { describe, expect, it } from "vitest";
import {
  NEC_PROFILE,
  TERMS,
  TERMINOLOGY_REGISTRY_VERSION,
  operationalTerms,
  prohibitedUsages,
  resolveTerm,
  termHelp,
} from "@/lib/electrical-terminology";
import {
  REVIEW_GATE,
  errorCount,
  reconciliationReport,
  scanAiAnswer,
  scanCsvHeaders,
  scanText,
} from "@/lib/electrical-terminology-audit";

describe("terminology registry", () => {
  it("is versioned and records the applicable edition and jurisdiction profile", () => {
    expect(TERMINOLOGY_REGISTRY_VERSION).toBe("electrical.terminology.v1");
    expect(NEC_PROFILE.necEdition).toMatch(/NEC 20\d\d/);
    expect(NEC_PROFILE.jurisdiction).toBeTruthy();
    expect(NEC_PROFILE.notice).toMatch(/authority having jurisdiction/i);
    expect(NEC_PROFILE.notice).toMatch(/does not\s+determine code compliance/i);
  });

  it("carries every registry column for each term", () => {
    for (const t of TERMS) {
      expect(t.id, t.id).toMatch(/^[a-z0-9_]+$/);
      expect(t.canonical.length, t.id).toBeGreaterThan(2);
      expect(t.plain.length, t.id).toBeGreaterThan(20);
      expect(Array.isArray(t.aliases), t.id).toBe(true);
      expect(Array.isArray(t.deprecated), t.id).toBe(true);
      expect(Object.keys(t.affects).length, t.id).toBeGreaterThan(0);
      if (t.classification === "NEC_DEFINED") {
        expect(t.necEdition, t.id).toBeTruthy();
        expect(t.necReference, t.id).toMatch(/Art|\d{3}\./);
      } else {
        expect(t.necRelation, t.id).toBeTruthy();
      }
    }
  });

  it("covers the NEC terms that must be used accurately", () => {
    const ids = new Set(TERMS.map((t) => t.id));
    for (const id of [
      "panelboard",
      "service_equipment",
      "feeder",
      "branch_circuit",
      "ocpd",
      "circuit_breaker",
      "outlet",
      "receptacle",
      "receptacle_outlet",
      "junction_box",
      "device_box",
      "raceway",
      "cable",
      "conductor",
      "grounded_conductor",
      "egc",
      "gec",
      "disconnecting_means",
      "load",
      "utilization_equipment",
      "individual_branch_circuit",
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it("marks FarmOps operational terms as not NEC-defined and explains the relationship", () => {
    const ops = new Set(operationalTerms().map((t) => t.id));
    for (const id of [
      "circuit_group",
      "branch_run",
      "run_segment",
      "material_ready",
      "complete",
      "as_built_verified",
      "audit_batch",
      "pole_grid",
      "grid_reference",
    ]) {
      expect(ops.has(id), id).toBe(true);
      expect(termHelp(id)).toMatch(/\w/);
    }
    const cg = TERMS.find((t) => t.id === "circuit_group")!;
    expect(cg.classification).toBe("FARMOPS_OPERATIONAL");
    expect(cg.necRelation).toMatch(/one breaker-protected branch circuit/i);
    expect(cg.necRelation).toMatch(/stable\s+ID stays fixed/i);
  });

  it("keeps deprecated slang searchable as an alias while banning it from display", () => {
    expect(resolveTerm("daisy chain")?.canonical).toBe("Feed-through sequence");
    expect(resolveTerm("plug")?.canonical).toBe("Receptacle");
    expect(resolveTerm("dedicated circuit")?.id).toBe("individual_branch_circuit");
    for (const u of prohibitedUsages()) {
      expect(u.instead.length, u.usage).toBeGreaterThan(3);
      expect(u.reason.length, u.usage).toBeGreaterThan(10);
    }
  });
});

describe("terminology checker", () => {
  it("flags prohibited display wording with the replacement", () => {
    const f = scanText('const help = "Wire the plugs in a daisy chain from the panel board";', {
      surface: "ui_string",
      location: "example.tsx",
    });
    const matched = f.map((x) => x.termId);
    expect(matched).toContain("feed_through_sequence");
    expect(matched).toContain("panelboard");
    expect(f.find((x) => x.termId === "feed_through_sequence")!.instead).toMatch(
      /feed-through sequence/i,
    );
    expect(errorCount(f)).toBeGreaterThan(0);
  });

  it("does not flag alias declarations or lines marked terminology-ok", () => {
    expect(scanText('aliases: ["daisy chain", "plug"]', {
      surface: "ui_string",
      location: "a.ts",
    })).toHaveLength(0);
    expect(
      scanText('label = "daisy chain" // terminology-ok quoted field label', {
        surface: "ui_string",
        location: "a.ts",
      }),
    ).toHaveLength(0);
  });

  it("scans AI answers and CSV headers", () => {
    expect(scanAiAnswer("That load is on a dedicated circuit.")[0]?.termId).toBe(
      "individual_branch_circuit",
    );
    const csv = scanCsvHeaders("load_id,panel board,daisy chain", "export.csv");
    expect(csv.some((f) => f.termId === "panelboard")).toBe(true);
    expect(csv.find((f) => f.termId === "feed_through_sequence")!.severity).toBe("warn");
  });

  it("passes clean canonical text", () => {
    expect(
      scanText(
        "Branch circuit PNL-FS-NW-B37 supplies receptacle outlets through a feed-through sequence.",
        { surface: "ui_string", location: "clean.tsx" },
      ),
    ).toHaveLength(0);
  });
});

describe("reconciliation report", () => {
  it("lists every registry term with status, reference, screens and impact", () => {
    const rows = reconciliationReport();
    expect(rows).toHaveLength(TERMS.length);
    for (const r of rows) {
      expect(r.proposedCanonical.length).toBeGreaterThan(2);
      expect(r.necStatus).toMatch(/NEC-defined|FarmOps operational|NEC usage/);
      expect(r.sourceReference.length).toBeGreaterThan(5);
      expect(r.notes).toMatch(/Stable IDs are unchanged/);
      expect(["none", "display_only", "display_and_help", "needs_review"]).toContain(
        r.migrationImpact,
      );
    }
    expect(rows.find((r) => r.termId === "individual_branch_circuit")!.migrationImpact).toBe(
      "needs_review",
    );
  });

  it("requires human review before terminology is applied globally", () => {
    expect(REVIEW_GATE.requiresHumanReview).toBe(true);
    expect(REVIEW_GATE.statement).toMatch(/no automated process rewrites/i);
    expect(REVIEW_GATE.necNotice).toBe(NEC_PROFILE.notice);
  });
});
