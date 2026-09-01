// Phase 4.4a/4.4b — canonical ODS baseline for load adjudication.
//
// Load adjudication used to carry its own hard-coded copy of the canonical
// workbook values. That made the adjudication/correction workflow a second,
// independent definition of "what the canonical ODS contains", which could
// silently disagree with the SHA-verified workbook that Parallel Validation
// actually parses.
//
// From this module onward there is exactly one canonical source: the .ods file
// the owner selects. It is parsed in memory, hashed, and every canonical load
// value carries the worksheet, row and the workbook SHA-256 it came from.
//
// Rules enforced here:
//   1. Canonical load values are ONLY ever the parsed workbook values.
//   2. No hard-coded value is ever substituted for a parsed value.
//   3. Every baseline records the ODS file name + SHA-256.
//   4. An apply operation is refused unless its canonical evidence came from
//      the expected Phase 4.4a baseline SHA.
//   5. Equipment/nameplate provenance stays a separate axis of evidence. It may
//      prove an ODS or FarmOps value is wrong; it never rewrites the historical
//      fact of what the ODS contained.
import { ENTITIES, importColumns } from "@/lib/electrical-entities";
import { classifySheet, mapSheet, type Sheet } from "@/lib/electrical-ods";
import { ADJUDICATED_LOAD_IDS } from "@/lib/electrical-load-adjudication";

/** The confirmed Phase 4.4a baseline identity. */
export const PHASE_44A_BASELINE_ODS_FILE = "PremoFarmElectrical.ods";
export const PHASE_44A_BASELINE_SHA256 =
  "89da43c7f1f94948e17ecfdc942dbdba022cfee5ba504b70865529cf39877388";

export const ADJUDICATION_BASELINE_VERSION = "4.4-adjudication-baseline-sha-bound-1";

/** One canonical load record, as parsed from the SHA-verified workbook. */
export interface CanonicalOdsLoadValues {
  stable_id: string;
  description: string;
  worksheet: string;
  row: number;
  volts: number | null;
  amps: number | null;
  connected_va: number | null;
  /** Open questions carried from prior phases — narrative only, never values. */
  open_questions: string[];
}

export interface AdjudicationBaseline {
  version: string;
  ods_file_name: string;
  ods_sha256: string;
  parsed_at: string;
  /** True when this workbook is the confirmed Phase 4.4a baseline. */
  is_phase_44a_baseline: boolean;
  /** Worksheets classified as load sheets in this workbook. */
  load_worksheets: string[];
  loads: CanonicalOdsLoadValues[];
  /** Adjudicated IDs the workbook does not contain. Never back-filled. */
  missing_load_ids: string[];
}

/**
 * Narrative open questions previously recorded alongside the nine Category-B
 * findings. These are prose only: no voltage, current or VA value here is ever
 * used as a canonical value. They are keyed by stable ID and attached to the
 * parsed baseline row purely so the report keeps its review history.
 */
const OPEN_QUESTIONS: Record<string, string[]> = {
  "FS-034": [
    "Resolved by equipment provenance: 220 V is the Halo Lifts HL2C-10K rated nameplate voltage; the canonical workbook value remains the nominal supply designation.",
  ],
  "FS-082": [
    "Did the canonical amps/volts pair come from newer equipment selection, a design assumption or a field observation? Source and date are not recorded.",
    "Does the FarmOps 0 A / 120 V pair mean 'not yet installed' or an actual 120 V circuit?",
  ],
  "FS-083": [
    "Did the canonical amps/volts pair come from newer equipment selection, a design assumption or a field observation? Source and date are not recorded.",
    "Does the FarmOps 0 A / 120 V pair mean 'not yet installed' or an actual 120 V circuit?",
  ],
  "FS-084": [
    "Is the FarmOps 60 A figure a breaker / OCP rating or a stated load current? No OCP field, breaker relationship or specification distinguishes them.",
  ],
  "FS-092": [
    "Resolved by equipment provenance: 115 V is the Greenheck AER-24-03-0315-VG rated nameplate voltage at 8.8 A FLA; the canonical workbook value remains the nominal supply designation.",
  ],
};

export function openQuestionsFor(stableId: string): string[] {
  return OPEN_QUESTIONS[stableId] ?? [];
}

/** Parse a workbook numeric cell without inventing a value. */
export function odsNumber(raw: string | undefined): number | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const cleaned = s.replace(/,/g, "").replace(/[^0-9.\-]/g, "");
  // A cell like "TBD" or "n/a" carries no number: it must stay null, never 0.
  if (!/[0-9]/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract the adjudicated loads from the parsed workbook sheets. Only values
 * present in the workbook are returned; absent cells stay null.
 */
export function extractCanonicalLoads(sheets: Sheet[]): {
  loads: CanonicalOdsLoadValues[];
  worksheets: string[];
} {
  const wanted = new Set<string>(ADJUDICATED_LOAD_IDS);
  const def = ENTITIES["load"];
  const targets = importColumns("load");
  const loads: CanonicalOdsLoadValues[] = [];
  const worksheets: string[] = [];

  for (const sheet of sheets) {
    if (classifySheet(sheet) !== "load") continue;
    worksheets.push(sheet.name);
    const mapped = mapSheet(sheet, "load", targets, def.stableIdField);
    for (const row of mapped.rows) {
      const id = row.stableId.trim();
      if (!wanted.has(id)) continue;
      if (loads.some((l) => l.stable_id === id)) continue;
      loads.push({
        stable_id: id,
        description: (row.values["description"] ?? "").trim(),
        worksheet: sheet.name,
        row: row.sourceRow,
        volts: odsNumber(row.values["volts"]),
        amps: odsNumber(row.values["amps"]),
        connected_va: odsNumber(row.values["connected_va"]),
        open_questions: openQuestionsFor(id),
      });
    }
  }

  return { loads, worksheets };
}

/** Build the SHA-bound baseline record from parsed sheets. */
export function makeAdjudicationBaseline(input: {
  ods_file_name: string;
  ods_sha256: string;
  sheets: Sheet[];
  parsed_at?: string;
}): AdjudicationBaseline {
  const { loads, worksheets } = extractCanonicalLoads(input.sheets);
  const present = new Set(loads.map((l) => l.stable_id));
  return {
    version: ADJUDICATION_BASELINE_VERSION,
    ods_file_name: input.ods_file_name,
    ods_sha256: input.ods_sha256.toLowerCase(),
    parsed_at: input.parsed_at ?? new Date().toISOString(),
    is_phase_44a_baseline: input.ods_sha256.toLowerCase() === PHASE_44A_BASELINE_SHA256,
    load_worksheets: worksheets,
    loads: loads.sort((a, b) => a.stable_id.localeCompare(b.stable_id)),
    missing_load_ids: ADJUDICATED_LOAD_IDS.filter((id) => !present.has(id)),
  };
}

/** Canonical values for one load, or undefined when the workbook lacks it. */
export function canonicalLoad(
  baseline: AdjudicationBaseline | null | undefined,
  stableId: string,
): CanonicalOdsLoadValues | undefined {
  return baseline?.loads.find((l) => l.stable_id === stableId.trim());
}

export type BaselineGuard = { ok: true } | { ok: false; reason: string };

/**
 * May a correction be applied using this baseline as canonical evidence?
 * Refused when there is no baseline, when the workbook SHA is not the expected
 * Phase 4.4a baseline, or when the workbook does not actually contain the load.
 */
export function baselineAuthorizesApply(
  baseline: AdjudicationBaseline | null | undefined,
  opts: { expected_sha256?: string; stable_id?: string } = {},
): BaselineGuard {
  const expected = (opts.expected_sha256 ?? PHASE_44A_BASELINE_SHA256).toLowerCase();
  if (!baseline) {
    return {
      ok: false,
      reason:
        "No canonical ODS baseline is attached. Adjudication will not substitute stored values for the SHA-verified workbook.",
    };
  }
  if (baseline.ods_sha256 !== expected) {
    return {
      ok: false,
      reason: `Canonical evidence came from workbook SHA-256 ${baseline.ods_sha256}, but the authorized Phase 4.4a baseline is ${expected}. Nothing may be applied from a different workbook.`,
    };
  }
  if (opts.stable_id && !canonicalLoad(baseline, opts.stable_id)) {
    return {
      ok: false,
      reason: `The baseline workbook does not contain a canonical row for ${opts.stable_id}.`,
    };
  }
  return { ok: true };
}

/** Short human label for the baseline in reports and exports. */
export function baselineLabel(baseline: AdjudicationBaseline | null | undefined): string {
  if (!baseline) return "no canonical ODS baseline attached";
  return `${baseline.ods_file_name} (SHA-256 ${baseline.ods_sha256}${
    baseline.is_phase_44a_baseline ? ", confirmed Phase 4.4a baseline" : ", NOT the Phase 4.4a baseline"
  })`;
}
