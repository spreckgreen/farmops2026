// Phase 4.4b — panel-position coverage diagnostic (pure logic, read-only).
//
// The population planner answers "was every PARSED logical breaker reconciled?".
// That question cannot detect a physical breaker the transcription never
// mentioned: an omitted source row simply shrinks the denominator. This module
// asks the opposite question, from the panel's own physical position universe
// inwards:
//
//   physical panel positions → transcription evidence → logical breakers parsed
//     → existing electrical_breaker_positions records
//
// Nothing here writes, infers a breaker, or invents poles, amperage or labels.
// A position with no evidence is reported as MISSING, never as absent-by-design.
import { breakerReference } from "@/lib/electrical-breaker-reference";
import {
  slotForBreakerNumber,
  type BreakerObservation,
  type FarmOpsBreaker,
  type ObservationProvenance,
} from "./electrical-house-panel-field";
import { expectedBreakerNumber, resolvePanelLayout } from "./electrical-panel-layout";

export const PANEL_COVERAGE_PHASE = "4.4b";

export const POSITION_COVERAGE_STATES = [
  /** A surviving logical breaker and/or a FarmOps record covers this position. */
  "represented",
  /** Transcribed explicitly as a spare/empty space — a fact, not a gap. */
  "explicitly_empty",
  /** Evidence exists but the panel or physical slot could not be resolved. */
  "field_observed_unresolved",
  /** Second/third position of a multi-pole breaker owned by a lower position. */
  "suppressed_as_continuation",
  /** Only evidence was a duplicate source row suppressed during parsing. */
  "suppressed_duplicate",
  /** No transcription evidence and no record: a physical breaker may be unrecorded. */
  "missing_from_transcription",
] as const;

export type PositionCoverageState = (typeof POSITION_COVERAGE_STATES)[number];

export const POSITION_COVERAGE_LABELS: Record<PositionCoverageState, string> = {
  represented: "Represented",
  explicitly_empty: "Explicitly empty",
  field_observed_unresolved: "Field-observed but unresolved",
  suppressed_as_continuation: "Suppressed as continuation",
  suppressed_duplicate: "Suppressed duplicate",
  missing_from_transcription: "Missing from transcription",
};

/** Text that transcribes a position as deliberately empty rather than unknown. */
const EXPLICIT_EMPTY_TEXT = /^\s*(spare|space|empty|open|unused|blank|no\s+breaker|n\/?a)\s*$/i;

export interface PanelPositionCoverage {
  panel_id: string;
  /** Directory circuit/breaker number, e.g. 37. */
  breaker_number: number;
  side: "Left" | "Right";
  position: number;
  state: PositionCoverageState;
  state_label: string;
  /** True when a parsed observation (primary or continuation) covers it. */
  has_transcription_evidence: boolean;
  /** True when an electrical_breaker_positions row covers it. */
  has_record: boolean;
  /** Logical breaker that owns this position, e.g. "37/39". */
  logical_owner: string | null;
  /** Positions the owning logical breaker occupies. */
  owner_positions: number[];
  detail: string;
}

export interface PanelCoverage {
  panel_id: string;
  panel_source_names: string[];
  /** How the physical position universe was established. */
  capacity_source: "panel_configuration" | "inferred_from_evidence";
  capacity_known: boolean;
  /** Size of the physical position universe examined. */
  positions_expected: number;
  positions: PanelPositionCoverage[];
  counts: Record<PositionCoverageState, number>;
  /** One row per unique logical breaker parsed for this panel. */
  logical_breakers_parsed: number;
  /** Positions occupied by those logical breakers (multi-pole counts each position). */
  positions_claimed_by_logical_breakers: number;
  positions_with_records: number;
  /** Positions with a FarmOps record but no transcription evidence at all. */
  records_without_transcription: number;
  /** False whenever a position is missing, unresolved, or capacity is unknown. */
  inventory_complete: boolean;
  incomplete_reasons: string[];
}

export interface PanelCoverageReport {
  phase: string
  panels: PanelCoverage[];
  totals: {
    panels: number;
    positions_expected: number;
    counts: Record<PositionCoverageState, number>;
    logical_breakers_parsed: number;
    positions_with_records: number;
    panels_with_unknown_capacity: number;
  };
  /** Never true while any position is missing or unresolved. */
  inventory_complete: boolean;
  /** Human-readable reasons the House/Farm Shop inventory is not complete. */
  incomplete_reasons: string[];
}

/** Panel capacity as recorded on the panel itself. Blank stays blank. */
export interface CoveragePanel {
  panel_id: string;
  spaces?: number | null;
  breaker_columns?: number | null;
  positions_per_column?: number | null;
}

/** A duplicate source row suppressed during parsing, kept for traceability. */
export interface SuppressedDuplicateEvidence {
  panel_id: string | null;
  panel_source_name?: string;
  positions: number[];
  provenance?: ObservationProvenance | null;
}

export interface PanelCoverageInput {
  /** Panels in scope, with their own configuration. */
  panels: CoveragePanel[];
  /** Corrected logical-breaker observations from the transcription. */
  observations: BreakerObservation[];
  /** Live electrical_breaker_positions rows. */
  farmops: FarmOpsBreaker[];
  suppressed_duplicates?: SuppressedDuplicateEvidence[];
}

function emptyCounts(): Record<PositionCoverageState, number> {
  return {
    represented: 0,
    explicitly_empty: 0,
    field_observed_unresolved: 0,
    suppressed_as_continuation: 0,
    suppressed_duplicate: 0,
    missing_from_transcription: 0,
  };
}

function observationText(o: BreakerObservation): string {
  const label = o.fields.find((f) => f.field === "label");
  return String(label?.observed_text ?? "").trim();
}

/**
 * Breaker numbers a single FarmOps record covers. A 2-pole record at Right 19
 * covers breakers 38 and 40 — the consumed slot is not a separate record.
 */
function recordCoverage(
  layout: ReturnType<typeof resolvePanelLayout>,
  b: FarmOpsBreaker,
): number[] {
  const poles = Math.max(1, Number(b.poles ?? 1));
  const out: number[] = [];
  for (let i = 0; i < poles; i++) {
    const n = expectedBreakerNumber(layout, b.side, b.position + i);
    if (n != null) out.push(n);
  }
  if (!out.length && b.breaker_number != null) out.push(b.breaker_number);
  return out;
}

/**
 * Classify every physical position of every panel in scope. Read-only.
 *
 * The denominator is the panel's own physical position universe, so a breaker
 * omitted from the transcription surfaces as `missing_from_transcription`
 * instead of quietly disappearing from both numerator and denominator.
 */
export function analysePanelCoverage(input: PanelCoverageInput): PanelCoverageReport {
  const panelsById = new Map<string, CoveragePanel>();
  for (const p of input.panels) if (p.panel_id) panelsById.set(p.panel_id, p);

  const obsByPanel = new Map<string, BreakerObservation[]>();
  const unresolvedObservations: BreakerObservation[] = [];
  for (const o of input.observations) {
    if (!o.panel_id) {
      unresolvedObservations.push(o);
      continue;
    }
    obsByPanel.set(o.panel_id, [...(obsByPanel.get(o.panel_id) ?? []), o]);
    if (!panelsById.has(o.panel_id)) panelsById.set(o.panel_id, { panel_id: o.panel_id });
  }

  const recordsByPanel = new Map<string, FarmOpsBreaker[]>();
  for (const b of input.farmops) {
    if (!b.panel_id) continue;
    recordsByPanel.set(b.panel_id, [...(recordsByPanel.get(b.panel_id) ?? []), b]);
    if (!panelsById.has(b.panel_id)) panelsById.set(b.panel_id, { panel_id: b.panel_id });
  }

  const dupByPanel = new Map<string, SuppressedDuplicateEvidence[]>();
  for (const d of input.suppressed_duplicates ?? []) {
    if (!d.panel_id) continue;
    dupByPanel.set(d.panel_id, [...(dupByPanel.get(d.panel_id) ?? []), d]);
  }

  const panels: PanelCoverage[] = [];
  for (const panel of [...panelsById.values()].sort((a, b) =>
    a.panel_id.localeCompare(b.panel_id),
  )) {
    const layout = resolvePanelLayout(panel as unknown as Record<string, unknown>);
    const observations = obsByPanel.get(panel.panel_id) ?? [];
    const records = recordsByPanel.get(panel.panel_id) ?? [];
    const duplicates = dupByPanel.get(panel.panel_id) ?? [];

    // Position universe: the panel's own configuration when it is recorded,
    // otherwise every position any evidence source mentions. Inference is
    // reported, never presented as the panel's true capacity.
    const capacity_known = layout.totalSpaces > 0;
    const universe: number[] = [];
    if (capacity_known) {
      for (let n = 1; n <= layout.totalSpaces; n++) universe.push(n);
    } else {
      const seen = new Set<number>();
      for (const o of observations) for (const n of o.positions) seen.add(n);
      for (const d of duplicates) for (const n of d.positions) seen.add(n);
      for (const b of records) for (const n of recordCoverage(layout, b)) seen.add(n);
      for (const n of [...seen].sort((a, b) => a - b)) universe.push(n);
    }

    // Index evidence and records by breaker number.
    const ownerByNumber = new Map<string, BreakerObservation>();
    for (const o of observations) {
      for (const n of o.positions) ownerByNumber.set(String(n), o);
    }
    const recordNumbers = new Set<number>();
    for (const b of records) for (const n of recordCoverage(layout, b)) recordNumbers.add(n);
    const duplicateNumbers = new Set<number>();
    for (const d of duplicates) for (const n of d.positions) duplicateNumbers.add(n);

    const counts = emptyCounts();
    const positions: PanelPositionCoverage[] = [];
    let records_without_transcription = 0;

    for (const n of universe) {
      const slot = slotForBreakerNumber(n) ?? { side: "Left" as const, position: n };
      const owner = ownerByNumber.get(String(n)) ?? null;
      const hasRecord = recordNumbers.has(n);
      const primary = owner ? owner.positions[0] : null;
      const observedText = owner ? observationText(owner) : "";

      let state: PositionCoverageState;
      let detail: string;
      if (owner && (owner.identity_status === "unresolved" || owner.position_status === "unresolved")) {
        state = "field_observed_unresolved";
        detail = `Transcribed as "${owner.positions_text}" but the ${
          owner.identity_status === "unresolved" ? "panel identity" : "physical slot"
        } could not be resolved — nothing is proposed for it.`;
      } else if (owner && primary != null && n !== primary) {
        state = "suppressed_as_continuation";
        detail = `Occupied by the ${owner.poles ?? owner.positions.length}-pole breaker recorded at position ${primary} (${owner.positions_text}) — one logical breaker, ${owner.positions.length} physical positions.`;
      } else if (owner && EXPLICIT_EMPTY_TEXT.test(observedText)) {
        state = "explicitly_empty";
        detail = `Transcribed as "${observedText}" — recorded as an empty space, not a missing breaker.`;
      } else if (owner || hasRecord) {
        state = "represented";
        detail = owner
          ? hasRecord
            ? `Transcription evidence and a FarmOps record both cover this position.`
            : `Parsed as logical breaker ${owner.positions_text}; no FarmOps record yet.`
          : `A FarmOps breaker record covers this position, but the transcription never mentions it.`;
        if (!owner) records_without_transcription++;
      } else if (duplicateNumbers.has(n)) {
        state = "suppressed_duplicate";
        detail = `The only evidence for this position was a duplicate source row suppressed during parsing; no surviving logical breaker covers it.`;
      } else {
        state = "missing_from_transcription";
        detail = `No transcription evidence and no FarmOps record. If a physical breaker occupies this position it is unrecorded — enter it from the verified field observation; nothing is inferred here.`;
      }

      counts[state]++;
      positions.push({
        panel_id: panel.panel_id,
        breaker_number: n,
        side: slot.side,
        position: slot.position,
        state,
        state_label: POSITION_COVERAGE_LABELS[state],
        has_transcription_evidence: Boolean(owner),
        has_record: hasRecord,
        logical_owner: owner ? owner.positions_text : null,
        owner_positions: owner ? [...owner.positions] : [],
        detail,
      });
    }

    const incomplete_reasons: string[] = [];
    if (!capacity_known)
      incomplete_reasons.push(
        `${panel.panel_id} has no recorded space count, so its physical position universe was inferred from evidence (${universe.length} positions seen) and cannot prove completeness.`,
      );
    if (counts.missing_from_transcription)
      incomplete_reasons.push(
        `${panel.panel_id}: ${counts.missing_from_transcription} physical position${counts.missing_from_transcription === 1 ? "" : "s"} have neither transcription evidence nor a record.`,
      );
    if (counts.field_observed_unresolved)
      incomplete_reasons.push(
        `${panel.panel_id}: ${counts.field_observed_unresolved} position${counts.field_observed_unresolved === 1 ? "" : "s"} were field-observed but could not be resolved.`,
      );
    if (counts.suppressed_duplicate)
      incomplete_reasons.push(
        `${panel.panel_id}: ${counts.suppressed_duplicate} position${counts.suppressed_duplicate === 1 ? "" : "s"} are covered only by suppressed duplicate evidence.`,
      );

    panels.push({
      panel_id: panel.panel_id,
      panel_source_names: [...new Set(observations.map((o) => o.panel_source_name).filter(Boolean))],
      capacity_source: capacity_known ? "panel_configuration" : "inferred_from_evidence",
      capacity_known,
      positions_expected: universe.length,
      positions,
      counts,
      logical_breakers_parsed: observations.length,
      positions_claimed_by_logical_breakers: observations.reduce(
        (n, o) => n + o.positions.length,
        0,
      ),
      positions_with_records: universe.filter((n) => recordNumbers.has(n)).length,
      records_without_transcription,
      inventory_complete:
        capacity_known &&
        counts.missing_from_transcription === 0 &&
        counts.field_observed_unresolved === 0 &&
        counts.suppressed_duplicate === 0,
      incomplete_reasons,
    });
  }

  const totals = {
    panels: panels.length,
    positions_expected: panels.reduce((n, p) => n + p.positions_expected, 0),
    counts: panels.reduce((acc, p) => {
      for (const s of POSITION_COVERAGE_STATES) acc[s] += p.counts[s];
      return acc;
    }, emptyCounts()),
    logical_breakers_parsed: panels.reduce((n, p) => n + p.logical_breakers_parsed, 0),
    positions_with_records: panels.reduce((n, p) => n + p.positions_with_records, 0),
    panels_with_unknown_capacity: panels.filter((p) => !p.capacity_known).length,
  };

  const incomplete_reasons = panels.flatMap((p) => p.incomplete_reasons);
  if (unresolvedObservations.length)
    incomplete_reasons.push(
      `${unresolvedObservations.length} transcribed breaker${unresolvedObservations.length === 1 ? "" : "s"} could not be attributed to any panel, so they are not counted against a position universe.`,
    );

  return {
    phase: PANEL_COVERAGE_PHASE,
    panels,
    totals,
    inventory_complete: panels.length > 0 && incomplete_reasons.length === 0,
    incomplete_reasons,
  };
}

export const PANEL_COVERAGE_CSV = "phase-4.4b-panel-position-coverage.csv";

/** Flat per-position CSV, mirroring exactly what the diagnostic shows. */
export function panelCoverageCsv(report: PanelCoverageReport): string {
  const head = [
    "panel_id",
    "breaker_reference",
    "breaker_number",
    "side",
    "position",
    "state",
    "state_label",
    "has_transcription_evidence",
    "has_record",
    "logical_owner",
    "detail",
  ];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [head.join(",")];
  for (const p of report.panels) {
    for (const pos of p.positions) {
      lines.push(
        [
          pos.panel_id,
          breakerReference(pos.panel_id, pos.breaker_number) ?? "",
          pos.breaker_number,
          pos.side,
          pos.position,
          pos.state,
          pos.state_label,
          pos.has_transcription_evidence ? "yes" : "no",
          pos.has_record ? "yes" : "no",
          pos.logical_owner ?? "",
          pos.detail,
        ]
          .map(esc)
          .join(","),
      );
    }
  }
  return lines.join("\n");
}
