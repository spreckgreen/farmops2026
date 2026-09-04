// Phase 4.4b — panel-position coverage regression.
//
// The core defence: when physical breakers are OMITTED from the transcription,
// the coverage report must name those positions as missing instead of shrinking
// the denominator so the inventory looks complete.
import { describe, expect, it } from "vitest";
import {
  analysePanelCoverage,
  panelCoverageCsv,
  type PanelCoverageInput,
} from "@/lib/electrical-panel-coverage";
import type {
  BreakerObservation,
  Confidence,
  FarmOpsBreaker,
  ObservedField,
} from "@/lib/electrical-house-panel-field";

const prov = (row: number) => ({
  workbook: "House.ods",
  worksheet: "House_Main",
  source_row: row,
  source_column: null,
  source_photo: null,
});

function label(text: string): ObservedField {
  return {
    field: "label",
    observed_text: text,
    interpreted: text,
    confidence: "high" as Confidence,
    verification_required: false,
    unknown_value: false,
    provenance: prov(1),
  } as ObservedField;
}

function obs(over: Partial<BreakerObservation>): BreakerObservation {
  const positions = over.positions ?? [1];
  return {
    key: `k-${positions.join("/")}`,
    panel_source_name: "House Main",
    panel_id: "PNL-H1",
    identity_status: "resolved",
    positions,
    positions_text: positions.join("/"),
    poles: positions.length,
    poles_stated: positions.length,
    slot: null,
    position_status: "resolved",
    fields: [],
    notes: "",
    provenance: prov(10),
    duplicate_sources: [],
    merged_positions_from: [],
    ...over,
  } as BreakerObservation;
}

/** A 42-space PNL-H1: Left 1-21 (odd 1-41), Right 1-21 (even 2-42). */
const PANEL = { panel_id: "PNL-H1", spaces: 42, breaker_columns: 2, positions_per_column: 21 };

/** Physical breakers the field review found absent from the transcription. */
const OMITTED = [29, 31, 37, 39, 2, 4, 14, 16];

function transcriptionMissingThose(): BreakerObservation[] {
  const out: BreakerObservation[] = [];
  for (let n = 1; n <= 42; n++) {
    if (OMITTED.includes(n)) continue;
    out.push(obs({ positions: [n], fields: [label(`Circuit ${n}`)] }));
  }
  return out;
}

function run(over: Partial<PanelCoverageInput> = {}) {
  return analysePanelCoverage({
    panels: [PANEL],
    observations: transcriptionMissingThose(),
    farmops: [],
    ...over,
  });
}

describe("panel-position coverage", () => {
  it("keeps the denominator at the panel's physical universe when rows are omitted", () => {
    const report = run();
    const h1 = report.panels[0]!;
    expect(h1.positions_expected).toBe(42);
    expect(h1.capacity_source).toBe("panel_configuration");
    // 34 transcribed breakers, not 34 of 34.
    expect(h1.logical_breakers_parsed).toBe(34);
    expect(h1.counts.missing_from_transcription).toBe(OMITTED.length);
  });

  it("names exactly the omitted physical positions as missing", () => {
    const missing = run()
      .panels[0]!.positions.filter((p) => p.state === "missing_from_transcription")
      .map((p) => p.breaker_number)
      .sort((a, b) => a - b);
    expect(missing).toEqual([...OMITTED].sort((a, b) => a - b));
  });

  it("never reports the inventory complete while positions are missing", () => {
    const report = run();
    expect(report.inventory_complete).toBe(false);
    expect(report.panels[0]!.inventory_complete).toBe(false);
    expect(report.incomplete_reasons.join(" ")).toMatch(/8 physical positions/);
  });

  it("reports complete only once every position is evidenced", () => {
    const report = analysePanelCoverage({
      panels: [PANEL],
      observations: Array.from({ length: 42 }, (_, i) =>
        obs({ positions: [i + 1], fields: [label(`Circuit ${i + 1}`)] }),
      ),
      farmops: [],
    });
    expect(report.inventory_complete).toBe(true);
    expect(report.totals.counts.missing_from_transcription).toBe(0);
  });

  it("counts a 2-pole 37/39 as one logical breaker over two physical positions", () => {
    const observations = transcriptionMissingThose().concat(
      obs({ positions: [37, 39], poles: 2, poles_stated: 2, fields: [label("Well pump")] }),
    );
    const h1 = analysePanelCoverage({ panels: [PANEL], observations, farmops: [] }).panels[0]!;
    const p37 = h1.positions.find((p) => p.breaker_number === 37)!;
    const p39 = h1.positions.find((p) => p.breaker_number === 39)!;
    expect(p37.state).toBe("represented");
    expect(p39.state).toBe("suppressed_as_continuation");
    expect(p39.logical_owner).toBe("37/39");
    expect(h1.logical_breakers_parsed).toBe(35);
    expect(h1.positions_claimed_by_logical_breakers).toBe(36);
    // 37/39 no longer missing; the other six positions still are.
    expect(h1.counts.missing_from_transcription).toBe(6);
  });

  it("credits an existing multi-pole FarmOps record across both positions", () => {
    // Right 19 = breaker 38, 2-pole, so breaker 40 is covered by that one row.
    const farmops: FarmOpsBreaker[] = [
      {
        panel_id: "PNL-H1",
        side: "Right",
        position: 19,
        breaker_number: 38,
        poles: 2,
        ocp_amps: 30,
        label: "Surge protective device (SPD)",
      },
    ];
    const h1 = analysePanelCoverage({
      panels: [PANEL],
      observations: [],
      farmops,
    }).panels[0]!;
    expect(h1.positions.find((p) => p.breaker_number === 38)!.has_record).toBe(true);
    expect(h1.positions.find((p) => p.breaker_number === 40)!.has_record).toBe(true);
    expect(h1.records_without_transcription).toBe(2);
    // Every other position is still missing — a record is not evidence of coverage elsewhere.
    expect(h1.counts.missing_from_transcription).toBe(40);
  });

  it("separates explicitly empty spaces from missing breakers", () => {
    const observations = transcriptionMissingThose().concat(
      obs({ positions: [29], fields: [label("SPARE")] }),
    );
    const h1 = analysePanelCoverage({ panels: [PANEL], observations, farmops: [] }).panels[0]!;
    expect(h1.positions.find((p) => p.breaker_number === 29)!.state).toBe("explicitly_empty");
    expect(h1.counts.missing_from_transcription).toBe(7);
  });

  it("flags unresolved observations and suppressed duplicates distinctly", () => {
    const report = analysePanelCoverage({
      panels: [PANEL],
      observations: transcriptionMissingThose().concat(
        obs({ positions: [31], position_status: "unresolved", fields: [label("??")] }),
      ),
      farmops: [],
      suppressed_duplicates: [{ panel_id: "PNL-H1", positions: [2, 4] }],
    });
    const h1 = report.panels[0]!;
    expect(h1.positions.find((p) => p.breaker_number === 31)!.state).toBe(
      "field_observed_unresolved",
    );
    expect(h1.positions.find((p) => p.breaker_number === 2)!.state).toBe("suppressed_duplicate");
    expect(h1.counts.missing_from_transcription).toBe(5);
    expect(report.inventory_complete).toBe(false);
  });

  it("refuses to claim completeness when panel capacity is unknown", () => {
    const report = analysePanelCoverage({
      panels: [{ panel_id: "PNL-H2" }],
      observations: [obs({ panel_id: "PNL-H2", positions: [20, 22], poles: 2 })],
      farmops: [],
    });
    const h2 = report.panels[0]!;
    expect(h2.capacity_source).toBe("inferred_from_evidence");
    expect(h2.positions_expected).toBe(2);
    expect(report.inventory_complete).toBe(false);
    expect(report.incomplete_reasons.join(" ")).toMatch(/no recorded space count/);
  });

  it("exports one CSV line per physical position", () => {
    const report = run();
    const csv = panelCoverageCsv(report);
    expect(csv.split("\n")).toHaveLength(43);
    expect(csv).toMatch(/PNL-H1,PNL-H1-B29,29,Left,15,missing_from_transcription/);
  });
});
