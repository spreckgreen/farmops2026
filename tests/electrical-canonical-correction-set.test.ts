import { describe, expect, it } from "vitest";
import {
  buildCanonicalCorrectionSet,
  canonicalCorrectionSetCsv,
  canonicalCorrectionSetMarkdown,
} from "@/lib/electrical-canonical-correction-set";
import { PHASE_44A_BASELINE_SHA256 } from "@/lib/electrical-adjudication-baseline";
import { openQuestionsFor } from "@/lib/electrical-adjudication-baseline";
import { testBaseline } from "./helpers/adjudication-baseline";

// Canonical rows as the SHA-verified workbook records them for this manifest:
// FS-082/083 Volts = 120 with Amps = 0, FS-084 Amps = 60 with 14,400 VA.
const LOADS = [
  ["FS-082", "Mini Split SE", 82, 120, 0, null],
  ["FS-083", "Mini Split E", 83, 120, 0, null],
  ["FS-084", "Mini Split W", 84, 240, 60, 14400],
] as const;

const baseline = () =>
  testBaseline({
    loads: LOADS.map(([stable_id, description, row, volts, amps, connected_va]) => ({
      stable_id,
      description,
      worksheet: "Loads",
      row,
      volts,
      amps,
      connected_va,
      open_questions: openQuestionsFor(stable_id),
    })),
  });

describe("Phase 4.4c canonical correction-set manifest", () => {
  const set = buildCanonicalCorrectionSet(baseline(), "2026-09-02T06:00:00.000Z");


  it("headlines 2 approved / 4 withheld / baseline unmodified", () => {
    expect(set.headline).toEqual({
      approved_canonical_correction_candidates: 2,
      withheld_unresolved_candidates: 4,
      current_baseline_modified: "NO",
    });
    expect(set.baseline_sha256).toBe(PHASE_44A_BASELINE_SHA256);
    expect(set.is_phase_44a_baseline).toBe(true);
    expect(set.ods_edited).toBe(false);
    expect(set.farmops_written).toBe(false);
    expect(set.phase_45_authorized).toBe(false);
  });

  it("approves only FS-082/FS-083 volts 120 -> 240 with worksheet/row provenance", () => {
    expect(set.approved.map((r) => `${r.stable_id}:${r.field}`)).toEqual([
      "FS-082:volts",
      "FS-083:volts",
    ]);
    for (const r of set.approved) {
      expect(r.old_raw_value).toBe(120);
      expect(r.proposed_value).toBe(240);
      expect(r.confidence).toBe("high");
      expect(r.worksheet).toBe("Loads");
      expect(r.row).toBeGreaterThan(0);
      expect(r.adjudication).toBe("CANONICAL_ODS_VALUE_INCOMPATIBLE_WITH_VERIFIED_EQUIPMENT");
      expect(r.evidence.join(" ")).toContain("208/230");
    }
  });

  it("withholds the unresolved current-semantic values without proposing replacements", () => {
    expect(set.withheld.map((r) => `${r.stable_id}:${r.field}`)).toEqual([
      "FS-082:amps",
      "FS-083:amps",
      "FS-084:amps",
      "FS-084:connected_va",
    ]);
    expect(set.withheld.every((r) => r.proposed_value === null)).toBe(true);
    expect(set.withheld.every((r) => r.withheld_reason)).toBeTruthy();
    const fs084 = set.withheld.find((r) => r.stable_id === "FS-084" && r.field === "amps")!;
    expect(fs084.old_raw_value).toBe(60);
    const va = set.withheld.find((r) => r.field === "connected_va")!;
    expect(va.old_raw_value).toBe(14400);
  });

  it("refuses approval when the attached workbook is not the Phase 4.4a baseline", () => {
    const other = buildCanonicalCorrectionSet({ ...baseline(), ods_sha256: "a".repeat(64), is_phase_44a_baseline: false });
    expect(other.headline.approved_canonical_correction_candidates).toBe(0);
    expect(other.headline.withheld_unresolved_candidates).toBe(6);
    expect(other.withheld[0].withheld_reason).toContain("not the authorized Phase 4.4a baseline");
  });

  it("exports CSV and Markdown carrying both sections and the baseline SHA", () => {
    const csv = canonicalCorrectionSetCsv(set);
    expect(csv.split("\n")).toHaveLength(7);
    expect(csv).toContain("approved_candidate,FS-082,Loads,82,volts,V,120,240");
    expect(csv).toContain("withheld_unresolved,FS-084");
    const md = canonicalCorrectionSetMarkdown(set);
    expect(md).toContain("Approved canonical correction candidates = 2");
    expect(md).toContain("Withheld unresolved candidates = 4");
    expect(md).toContain("Current baseline modified = NO");
    expect(md).toContain(PHASE_44A_BASELINE_SHA256);
  });
});
