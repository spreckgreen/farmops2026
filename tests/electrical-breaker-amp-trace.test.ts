// Phase 4.4b — pre-Apply diagnostic correction fixtures.
//
// Traces the workbook's breaker-amperage column end-to-end:
//   header detection → field observation → logical-breaker grouping → preview
// and pins the position/pole mismatch inspection record. Read-only: nothing here
// creates FarmOps records.
import { describe, expect, it } from "vitest";
import type { Sheet } from "@/lib/electrical-ods";
import { classifyAmpObservation, parseHousePanelSheets } from "@/lib/electrical-house-panel-field";
import {
  breakerMismatchCsv,
  breakerPopulationDiagnostics,
  breakerPositionMismatches,
  planBreakerPopulation,
} from "@/lib/electrical-breaker-population";

const HEADER = ["Panel", "Circuit", "Poles", "Breaker Amps", "Description", "Notes", "Photo"];

const sheets: Sheet[] = [
  {
    name: "HOUSE-MAIN",
    rows: [
      ["House main panel directory — photo transcription"],
      HEADER,
      // 1. explicit numeric amp
      ["HOUSE-MAIN", "26/28", "2", "60", "SUB PANEL", "", "IMG_1.jpg"],
      // 2. blank amp cell (amp column exists, cell empty)
      ["HOUSE-MAIN", "1", "1", "", "Kitchen lights", "", "IMG_1.jpg"],
      // 3. VERIFY amp cell
      ["HOUSE-MAIN", "3", "1", "VERIFY", "Well pump", "", "IMG_1.jpg"],
      // 4. amp-looking number that appears ONLY in the directory description
      ["HOUSE-MAIN", "5", "1", "", "AC 1ST FL 30A", "", "IMG_2.jpg"],
      // 5. position/pole mismatch: Poles=2 with a single position and no pair
      ["HOUSE-MAIN", "9", "2", "40", "Dryer", "", "IMG_2.jpg"],
    ],
  },
  {
    // No breaker-amp column at all on this sheet.
    name: "HOUSE-SUBPANEL",
    rows: [
      ["Panel", "Circuit", "Poles", "Description"],
      ["HOUSE-SUBPANEL", "2", "1", "Basement receptacles"],
    ],
  },
];

const parsed = parseHousePanelSheets(sheets, { workbook: "house_panels_bulk_update.ods" });
const rows = planBreakerPopulation({ observations: parsed.observations, farmops: [] });
const at = (positions: string) => rows.find((r) => r.positions_text === positions)!;

describe("breaker amperage trace", () => {
  it("detects the Breaker Amps header and preserves an explicit numeric amp with provenance", () => {
    const r = at("26/28");
    expect(r.ocp_amps).toBe(60);
    expect(r.amp_status).toBe("explicit_numeric");
    expect(r.amp_source_column).toBe("Breaker Amps");
    expect(r.amp_observation_present).toBe(true);
    expect(r.amp_evidence).toContain("Breaker Amps");
    expect(r.amp_evidence).toContain("HOUSE-MAIN");
  });

  it("leaves a blank amp cell NULL and distinguishes it from a missing column", () => {
    const blank = at("1");
    expect(blank.ocp_amps).toBeNull();
    expect(blank.amp_status).toBe("blank");
    expect(blank.amp_source_column).toBe("Breaker Amps");
    expect(blank.amp_observation_present).toBe(false);
    expect(blank.amp_evidence).toBeNull();

    const unmapped = at("2");
    expect(unmapped.amp_status).toBe("no_mapping");
    expect(unmapped.amp_source_column).toBeNull();
    expect(unmapped.ocp_amps).toBeNull();
  });

  it("keeps a VERIFY amp cell unknown but records it as an explicit observation", () => {
    const r = at("3");
    expect(r.ocp_amps).toBeNull();
    expect(r.amp_status).toBe("uncertain");
    expect(r.amp_observation_present).toBe(true);
    expect(r.amps_observed_text).toBe("VERIFY");
  });

  it("never derives amperage from directory description text like AC 1ST FL 30A", () => {
    const r = at("5");
    expect(r.label).toBe("AC 1ST FL 30A");
    expect(r.ocp_amps).toBeNull();
    expect(r.amp_status).toBe("blank");
  });

  it("reports amp diagnostics as distinct counts", () => {
    const d = breakerPopulationDiagnostics(rows);
    expect(d.explicit_numeric_amps).toBe(2); // 26/28 = 60 A, 9 = 40 A
    expect(d.uncertain_amps).toBe(1);
    expect(d.blank_amps).toBe(2);
    expect(d.no_amp_mapping).toBe(1);
    expect(d.explicit_amp_observations).toBe(d.explicit_numeric_amps + d.uncertain_amps);
    expect(d.breaker_amps_unknown).toBe(rows.length - d.explicit_numeric_amps);
  });

  it("classifies amp cells without consulting anything else", () => {
    expect(classifyAmpObservation("Breaker Amps", "60A").status).toBe("explicit_numeric");
    expect(classifyAmpObservation("Breaker Amps", " ").status).toBe("blank");
    expect(classifyAmpObservation("Breaker Amps", "?").status).toBe("uncertain");
    expect(classifyAmpObservation(null, "60").status).toBe("no_mapping");
  });
});

describe("position/pole mismatch inspection", () => {
  it("reports panel, raw text, parsed positions, observed poles, sheet, rows and reason", () => {
    const mismatches = breakerPositionMismatches(rows);
    expect(mismatches).toHaveLength(1);
    const m = mismatches[0]!;
    expect(m.panel).toBe("PNL-H1");
    expect(m.raw_circuit_text).toBe("9");
    expect(m.parsed_positions).toEqual([9]);
    expect(m.observed_poles).toBe(2);
    expect(m.observed_poles_text).toBe("2");
    expect(m.poles_source).toBe("observed");
    expect(m.source_sheet).toBe("HOUSE-MAIN");
    expect(m.source_rows).toEqual([7]);
    expect(m.reason).toContain("Poles column states 2");
  });

  it("exports mismatches without repairing them", () => {
    const csv = breakerMismatchCsv(rows).split("\n");
    expect(csv[0]).toContain("raw_circuit_text");
    expect(csv).toHaveLength(2);
    expect(at("9").action).toBe("blocked_position_mismatch");
    expect(at("9").ocp_amps).toBe(40); // an explicit amp observation survives the block
  });
});
