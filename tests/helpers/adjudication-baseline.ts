// Test-only stand-in for the SHA-verified Phase 4.4a workbook baseline.
//
// Production code never contains canonical ODS values: they are parsed from the
// workbook at view time. Tests therefore construct a baseline explicitly, using
// the values the Phase 4.4a parse of PremoFarmElectrical.ods produced.
import {
  ADJUDICATION_BASELINE_VERSION,
  PHASE_44A_BASELINE_ODS_FILE,
  PHASE_44A_BASELINE_SHA256,
  openQuestionsFor,
  type AdjudicationBaseline,
} from "@/lib/electrical-adjudication-baseline";

const ROWS: Array<[string, string, number, number | null, number | null, number | null]> = [
  ["FS-034", "Shop Lift", 34, 240, 30, 7200],
  ["FS-082", "Mini Split SE", 82, 240, 24, 0],
  ["FS-083", "Mini Split E", 83, 240, 25, 0],
  ["FS-084", "Mini Split W", 84, 240, 25, 14400],
  ["FS-092", "Emergency shop purge (Fan/Louvers)", 92, 120, 8.8, 1056],
];

export function testBaseline(
  over: Partial<AdjudicationBaseline> = {},
): AdjudicationBaseline {
  const sha = (over.ods_sha256 ?? PHASE_44A_BASELINE_SHA256).toLowerCase();
  return {
    version: ADJUDICATION_BASELINE_VERSION,
    ods_file_name: over.ods_file_name ?? PHASE_44A_BASELINE_ODS_FILE,
    ods_sha256: sha,
    parsed_at: over.parsed_at ?? "2026-09-01T18:00:00.000Z",
    is_phase_44a_baseline: sha === PHASE_44A_BASELINE_SHA256,
    load_worksheets: over.load_worksheets ?? ["Loads"],
    loads:
      over.loads ??
      ROWS.map(([stable_id, description, row, volts, amps, connected_va]) => ({
        stable_id,
        description,
        worksheet: "Loads",
        row,
        volts,
        amps,
        connected_va,
        open_questions: openQuestionsFor(stable_id),
      })),
    missing_load_ids: over.missing_load_ids ?? [],
  };
}
