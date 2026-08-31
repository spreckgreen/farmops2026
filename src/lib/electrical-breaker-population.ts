// Phase 4.4b — House breaker-position population planning (pure logic).
//
// Source of truth for this planner is the CORRECTED field-observation output:
// one `BreakerObservation` per unique LOGICAL breaker, after duplicate source
// suppression and multi-pole continuation merging. Raw spreadsheet rows are
// never used to propose records.
//
// Hard rules encoded here:
//  - Only physical facts may be proposed: panel, occupied position(s), pole
//    count, breaker amperage when actually known, and the directory description
//    as observed text with its verification state preserved.
//  - Unknown amps stay unknown. VERIFY / UNKNOWN / "?" / uncertain commentary is
//    never promoted to a confirmed engineering value.
//  - Evidence-only material (photo filename, raw notes, worksheet, side text,
//    uncertainty commentary) stays in `electrical_field_observations`.
//  - poles > 1 must agree with the occupied-position count, otherwise the
//    record is blocked, not created.
//  - An existing FarmOps record is compared, never duplicated or overwritten.
import {
  AMP_STATUS_LABELS,
  classifyAmpObservation,
  slotForBreakerNumber,
  type AmpObservationStatus,
  type AmpSourceTrace,
  type BreakerObservation,
  type Confidence,
  type FarmOpsBreaker,
  type FieldReconciliationScope,
  type ObservedField,
  type SourceEvidenceConflict,
  HOUSE_SCOPE,
} from "./electrical-house-panel-field";

export const BREAKER_POPULATION_PHASE = "4.4b";

export type PopulationAction =
  /** Every proposed value is a known physical fact; safe to create when selected. */
  | "propose_create"
  /** A FarmOps record already occupies these positions; values compared only. */
  | "already_exists"
  /** Engineering review required before anything is created. */
  | "requires_review"
  /** Pole count disagrees with the occupied-position count. */
  | "blocked_position_mismatch"
  /** Panel or physical slot could not be resolved from the evidence. */
  | "blocked_unresolved"
  /** Two source sheets describe this breaker differently. */
  | "conflict_do_not_apply";

export const POPULATION_ACTION_LABELS: Record<PopulationAction, string> = {
  propose_create: "Create missing record",
  already_exists: "Already exists — compare only",
  requires_review: "Requires review",
  blocked_position_mismatch: "Blocked — position/pole mismatch",
  blocked_unresolved: "Blocked — unresolved panel or position",
  conflict_do_not_apply: "Conflict — do not apply",
};

/**
 * Initial-population safety gate. Independent of `action`: it answers the single
 * question "may this row be written to `electrical_breaker_positions` now?".
 *
 *  - SAFE_STRUCTURAL_CREATE — every proposed column is a structural fact taken
 *    straight from the parsed observation (panel identity, explicitly parsed
 *    occupied positions, an observed pole count that agrees with them, and the
 *    provenance link). Nothing is inferred.
 *  - CREATE_WITH_VERIFICATION_FLAGS — the structure is sound but some observed
 *    text is uncertain. The row may be created, with the uncertain text kept as
 *    an observation note and the record marked as needing field verification.
 *    Uncertain text is never promoted into an authoritative label.
 *  - BLOCKED — must not be created: position/pole mismatch, unresolved panel or
 *    slot, source conflict, unestablished pole count, or an existing record.
 */
export type BreakerSafetyClass =
  | "SAFE_STRUCTURAL_CREATE"
  | "CREATE_WITH_VERIFICATION_FLAGS"
  | "BLOCKED";

export const SAFETY_CLASS_LABELS: Record<BreakerSafetyClass, string> = {
  SAFE_STRUCTURAL_CREATE: "Safe structural create",
  CREATE_WITH_VERIFICATION_FLAGS: "Create with verification flags",
  BLOCKED: "Blocked",
};

/** One database column the Apply would populate, with the evidence behind it. */
export interface ProposedColumn {
  column: string;
  value: string | number | null;
  /** Why this value would be written, or why it stays NULL. */
  source_evidence: string;
}


export interface ProposedSlot {
  /** Breaker/circuit number as it appears in the directory (e.g. 26). */
  breaker_number: number;
  side: "Left" | "Right";
  /** Physical column position within that side. */
  position: number;
  /** True when a FarmOps breaker-position row already occupies this slot. */
  occupied: boolean;
}

export interface BreakerPopulationRow {
  key: string;
  panel_id: string | null;
  panel_source_name: string;
  /** Verbatim position text, e.g. "26/28". */
  positions_text: string;
  positions: number[];
  slots: ProposedSlot[];
  /** Pole count used for the proposal, or null when it could not be established. */
  poles: number | null;
  poles_source: "observed" | "position_count" | "single_position" | "unknown";
  /** Breaker amperage only when actually known; null means unknown, not zero. */
  ocp_amps: number | null;
  amps_unknown: boolean;
  amps_observed_text: string | null;
  /**
   * Why amperage is or is not known, traced back to the workbook column.
   * Directory description text such as `AC 1ST FL 30A` never contributes.
   */
  amp_status: AmpObservationStatus;
  amp_status_label: string;
  /** Header text of the mapped breaker-amp column, null when the sheet has none. */
  amp_source_column: string | null;
  /** True when an explicit amp cell (numeric or uncertain) was observed. */
  amp_observation_present: boolean;
  /** Provenance sentence for the amp observation, when one exists. */
  amp_evidence: string | null;
  /** Populated only for `blocked_position_mismatch` rows. */
  mismatch: BreakerPositionMismatch | null;
  /** Directory description exactly as observed. Never cleaned into a value. */
  label: string | null;
  label_observed_text: string | null;
  confidence: Confidence;
  verification_required: boolean;
  verification_status: "required" | "not_required";
  /** Existing FarmOps record for the primary slot, when one exists. */
  existing: FarmOpsBreaker | null;
  /** Field-by-field differences against the existing record. */
  differences: { field: "poles" | "ocp_amps" | "label"; existing: string | null; observed: string | null }[];
  action: PopulationAction;
  blocking_reason: string | null;
  /** Initial-population safety gate verdict. */
  safety_class: BreakerSafetyClass;
  safety_class_label: string;
  /** Every reason contributing to the verdict, in evaluation order. */
  safety_reasons: string[];
  /** True when the created record must be field-verified before it is trusted. */
  requires_field_verification: boolean;
  /** Uncertain observed text, preserved verbatim — never promoted to a label. */
  verification_note: string | null;
  /** Exactly the columns Apply would populate, with their evidence. */
  proposed_columns: ProposedColumn[];
  /** Evidence pointer — provenance stays in the observation journal. */
  evidence: string;

}

/**
 * Full inspection record for one blocked position/pole mismatch. Presented so a
 * genuine transcription problem can be told apart from a parser problem; nothing
 * here is auto-repaired.
 */
export interface BreakerPositionMismatch {
  panel: string;
  /** Circuit text exactly as transcribed, e.g. "26/28". */
  raw_circuit_text: string;
  /** Positions the parser extracted from that text. */
  parsed_positions: number[];
  /** Pole count as observed (Poles column) or derived, with its origin. */
  observed_poles: number | null;
  observed_poles_text: string | null;
  poles_source: BreakerPopulationRow["poles_source"];
  source_sheet: string | null;
  /** Every source row that contributed: primary, merged continuations, duplicates. */
  source_rows: number[];
  reason: string;
}

export interface BreakerPopulationDiagnostics {
  unique_breakers_considered: number;
  eligible_to_create: number;
  /** Safety gate — rows whose every proposed column is a structural fact. */
  safe_structural_creates: number;
  /** Safety gate — creatable rows carrying a field-verification flag. */
  creates_requiring_verification: number;
  /** Safety gate — rows that must not be created, for any reason. */
  blocked_total: number;
  already_existing: number;
  blocked_position_mismatch: number;
  blocked_unresolved: number;
  breaker_amps_unknown: number;

  /** Breakers with an explicit amp cell in the workbook (numeric or uncertain). */
  explicit_amp_observations: number;
  explicit_numeric_amps: number;
  blank_amps: number;
  uncertain_amps: number;
  no_amp_mapping: number;
  verification_required: number;
  conflicts: number;
  requires_review: number;
  /** Positions that would be newly created across all eligible rows. */
  positions_to_create: number;
}

export interface BreakerPopulationInput {
  observations: BreakerObservation[];
  farmops: FarmOpsBreaker[];
  conflicts?: SourceEvidenceConflict[];
  scope?: FieldReconciliationScope;
}

const field = (o: BreakerObservation, k: ObservedField["field"]) =>
  o.fields.find((f) => f.field === k) ?? null;

const CONFIDENCE_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1, unknown: 0 };

/** Directory text that must never become an authoritative engineering label. */
const UNCERTAIN_LABEL_TEXT = /(\?|\bverify\b|\bunknown\b|\bunk\b|\btbd\b|\bunsure\b|\bmaybe\b)/i;


function weakestConfidence(fields: ObservedField[]): Confidence {
  let worst: Confidence = "high";
  for (const f of fields) {
    if (CONFIDENCE_RANK[f.confidence] < CONFIDENCE_RANK[worst]) worst = f.confidence;
  }
  return fields.length ? worst : "unknown";
}

const numOrNull = (v: string | number | null): number | null => {
  if (v === null) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Groups the corrected observations by logical breaker identity (panel +
 * occupied positions) and produces exactly one proposed breaker-position record
 * per unique breaker. Read-only: this never writes and never mutates its input.
 */
export function planBreakerPopulation(input: BreakerPopulationInput): BreakerPopulationRow[] {
  const live = new Map<string, FarmOpsBreaker>();
  for (const b of input.farmops) live.set(`${b.panel_id}|${b.side}|${b.position}`, b);

  const conflictKeys = new Set(
    (input.conflicts ?? []).map((c) => `${c.panel_id ?? c.panel_source_name}|${c.positions_text}`),
  );

  // One row per unique logical breaker: panel + occupied positions.
  const grouped = new Map<string, BreakerObservation[]>();
  for (const o of input.observations) {
    const id = `${o.panel_id ?? o.panel_source_name}|${[...o.positions].sort((a, b) => a - b).join("/")}`;
    const bucket = grouped.get(id);
    if (bucket) bucket.push(o);
    else grouped.set(id, [o]);
  }

  const rows: BreakerPopulationRow[] = [];

  for (const [id, group] of grouped) {
    // Merge the group's evidence: positions union, first non-empty attribute.
    const primary = group[0]!;
    const positions = [...new Set(group.flatMap((g) => g.positions))].sort((a, b) => a - b);
    const allFields = group.flatMap((g) => g.fields);

    const polesField = allFields.find((f) => f.field === "poles" && f.interpreted !== null) ?? null;
    const ampsField = allFields.find((f) => f.field === "ocp_amps") ?? null;
    const labelField = allFields.find((f) => f.field === "label") ?? null;
    const comparable = allFields.filter((f) => f.field === "poles" || f.field === "ocp_amps" || f.field === "label");

    // ---- poles: observed if stated, otherwise the physical occupied-slot count.
    let poles: number | null = null;
    let poles_source: BreakerPopulationRow["poles_source"] = "unknown";
    const observedPoles = polesField && !polesField.verification_required && !polesField.unknown_value
      ? numOrNull(polesField.interpreted)
      : null;
    if (observedPoles) {
      poles = observedPoles;
      poles_source = "observed";
    } else if (positions.length > 1) {
      poles = positions.length;
      poles_source = "position_count";
    } else if (positions.length === 1) {
      poles = 1;
      poles_source = "single_position";
    }

    // ---- amps: only when the workbook's own amp column states a number.
    // The amp trace is taken from the source row, so "no amp column on the
    // sheet", "amp cell blank" and "amp cell says VERIFY" stay distinguishable.
    const ampTraces: AmpSourceTrace[] = group.map(
      (g) => g.amp_source ?? classifyAmpObservation(
        g.fields.some((f) => f.field === "ocp_amps") ? "Breaker Amps" : null,
        g.fields.find((f) => f.field === "ocp_amps")?.observed_text ?? "",
      ),
    );
    const ampTrace =
      ampTraces.find((t) => t.status === "explicit_numeric") ??
      ampTraces.find((t) => t.status === "uncertain") ??
      ampTraces.find((t) => t.status === "blank") ??
      ampTraces[0] ?? { column: null, cell_text: "", status: "no_mapping" as AmpObservationStatus, mapped: false };

    const ampsKnown =
      ampTrace.status === "explicit_numeric" && ampsField && !ampsField.unknown_value
        ? numOrNull(ampsField.interpreted)
        : ampTrace.status === "explicit_numeric"
          ? numOrNull(ampTrace.cell_text)
          : null;
    const ampProvenance = ampsField?.provenance ?? null;
    const amp_evidence =
      ampTrace.status === "no_mapping" || ampTrace.status === "blank"
        ? null
        : [
            `column “${ampTrace.column ?? "Breaker Amps"}”`,
            ampProvenance?.worksheet ? `sheet “${ampProvenance.worksheet}”` : primary.provenance.worksheet ? `sheet “${primary.provenance.worksheet}”` : null,
            (ampProvenance?.source_row ?? primary.provenance.source_row)
              ? `row ${ampProvenance?.source_row ?? primary.provenance.source_row}`
              : null,
            `observed “${ampTrace.cell_text}”`,
          ]
            .filter(Boolean)
            .join(" · ");

    // ---- label: observed text only, verification state preserved. Uncertain
    // directory text ("?", "???", UNKNOWN, VERIFY, low-confidence transcription)
    // is never promoted into an authoritative engineering description: it stays
    // in the field observation and flags the record for verification instead.
    const labelUsable = !!labelField && !labelField.unknown_value;
    const rawLabel = labelUsable ? (labelField!.observed_text || null) : null;
    const labelUncertain =
      !!labelField &&
      (labelField.unknown_value ||
        labelField.verification_required ||
        CONFIDENCE_RANK[labelField.confidence] <= CONFIDENCE_RANK["low"] ||
        UNCERTAIN_LABEL_TEXT.test(labelField.observed_text ?? ""));
    const label = labelUncertain ? null : rawLabel;

    const verification_required = comparable.some((f) => f.verification_required);
    const confidence = weakestConfidence(comparable);


    const slots: ProposedSlot[] = [];
    let unresolvedSlot = false;
    for (const n of positions) {
      const slot = slotForBreakerNumber(n);
      if (!slot) {
        unresolvedSlot = true;
        continue;
      }
      slots.push({
        breaker_number: n,
        side: slot.side,
        position: slot.position,
        occupied: primary.panel_id ? live.has(`${primary.panel_id}|${slot.side}|${slot.position}`) : false,
      });
    }

    const existing =
      primary.panel_id && slots.length
        ? live.get(`${primary.panel_id}|${slots[0]!.side}|${slots[0]!.position}`) ?? null
        : null;

    const differences: BreakerPopulationRow["differences"] = [];
    if (existing) {
      if (poles !== null && existing.poles !== null && existing.poles !== poles) {
        differences.push({ field: "poles", existing: String(existing.poles), observed: String(poles) });
      }
      if (ampsKnown !== null && existing.ocp_amps !== null && existing.ocp_amps !== ampsKnown) {
        differences.push({ field: "ocp_amps", existing: String(existing.ocp_amps), observed: String(ampsKnown) });
      }
      if (label && (existing.label ?? "").trim().toUpperCase() !== label.trim().toUpperCase()) {
        differences.push({ field: "label", existing: existing.label ?? null, observed: label });
      }
    }

    // ---- action + single blocking reason, in precedence order.
    let action: PopulationAction = "propose_create";
    let blocking_reason: string | null = null;

    if (conflictKeys.has(`${primary.panel_id ?? primary.panel_source_name}|${primary.positions_text}`)) {
      action = "conflict_do_not_apply";
      blocking_reason = "Two source sheets describe this breaker differently; resolve the source conflict first.";
    } else if (!primary.panel_id) {
      action = "blocked_unresolved";
      blocking_reason = `Panel “${primary.panel_source_name}” could not be resolved to a FarmOps panel.`;
    } else if (unresolvedSlot || !slots.length) {
      action = "blocked_unresolved";
      blocking_reason = "One or more occupied positions could not be resolved to a physical slot.";
    } else if (poles !== null && poles > 1 && slots.length !== poles) {
      action = "blocked_position_mismatch";
      blocking_reason = `A ${poles}-pole breaker resolves to ${slots.length} position${slots.length === 1 ? "" : "s"} (${primary.positions_text}); reviewed correction required before creation.`;
    } else if (existing || slots.some((s) => s.occupied)) {
      action = "already_exists";
      blocking_reason = existing
        ? differences.length
          ? "A FarmOps record already occupies this slot and its values differ from the photograph."
          : "A FarmOps record already occupies this slot and matches the photograph."
        : "Another occupied slot in this breaker already has a FarmOps record.";
    } else if (verification_required) {
      action = "requires_review";
      blocking_reason = "The observed directory text carries an uncertainty marker and stays verification-required.";
    } else if (poles === null) {
      action = "requires_review";
      blocking_reason = "Pole count could not be established from the evidence.";
    }

    const source_rows = [
      primary.provenance.source_row,
      ...primary.merged_positions_from.map((m) => m.source_row),
      ...primary.duplicate_sources.map((d) => d.source_row),
      ...group.slice(1).map((g) => g.provenance.source_row),
    ].filter((n): n is number => typeof n === "number" && Number.isFinite(n));

    const mismatch: BreakerPositionMismatch | null =
      action === "blocked_position_mismatch"
        ? {
            panel: primary.panel_id ?? primary.panel_source_name,
            raw_circuit_text: primary.positions_text,
            parsed_positions: positions,
            observed_poles: poles,
            observed_poles_text:
              primary.poles_stated !== null && primary.poles_stated !== undefined
                ? String(primary.poles_stated)
                : polesField?.observed_text || null,
            poles_source,
            source_sheet: primary.provenance.worksheet ?? null,
            source_rows: [...new Set(source_rows)].sort((a, b) => a - b),
            reason:
              poles_source === "observed" || primary.poles_stated
                ? `Poles column states ${poles}, but the circuit text “${primary.positions_text}” parses to ${slots.length} physical position${slots.length === 1 ? "" : "s"} (${positions.join(", ") || "none"}). Either the transcription omits a paired position or the circuit text is not a position list.`
                : `A ${poles}-pole breaker was derived, but only ${slots.length} position${slots.length === 1 ? "" : "s"} resolved from “${primary.positions_text}”.`,
          }
        : null;

    const evidence = [
      primary.provenance.worksheet ? `sheet “${primary.provenance.worksheet}”` : null,
      primary.provenance.source_row ? `row ${primary.provenance.source_row}` : null,
      group.length > 1 ? `${group.length} source representations` : null,
      primary.duplicate_sources.length ? `${primary.duplicate_sources.length} duplicate suppressed` : null,
      primary.merged_positions_from.length
        ? `${primary.merged_positions_from.length} continuation merged`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");

    // ---- safety gate: may this row be written now, and if so with what flags?
    const safety_reasons: string[] = [];
    let safety_class: BreakerSafetyClass = "SAFE_STRUCTURAL_CREATE";

    if (
      action === "conflict_do_not_apply" ||
      action === "blocked_position_mismatch" ||
      action === "blocked_unresolved" ||
      action === "already_exists"
    ) {
      safety_class = "BLOCKED";
      safety_reasons.push(blocking_reason ?? POPULATION_ACTION_LABELS[action]);
    } else if (poles === null) {
      safety_class = "BLOCKED";
      safety_reasons.push(
        "Pole count could not be established from the evidence; a missing paired position is never inferred from panel geometry.",
      );
    } else {
      if (verification_required) {
        safety_reasons.push("Observed directory text carries an uncertainty marker.");
      }
      if (labelUncertain) {
        safety_reasons.push(
          `Directory description “${labelField?.observed_text ?? ""}” is uncertain; it stays in the field observation and is not written as a label.`,
        );
      }
      if (ampTrace.status === "uncertain") {
        safety_reasons.push(
          `Breaker-amp cell reads “${ampTrace.cell_text}”; amperage stays NULL and must be verified in the field.`,
        );
      }
      if (CONFIDENCE_RANK[confidence] <= CONFIDENCE_RANK["low"]) {
        safety_reasons.push(`Weakest observation confidence is “${confidence}”.`);
      }
      if (safety_reasons.length) safety_class = "CREATE_WITH_VERIFICATION_FLAGS";
      else
        safety_reasons.push(
          "Panel identity, occupied position(s), observed pole count and provenance are all directly supported by the parsed observation.",
        );
    }

    const requires_field_verification = safety_class === "CREATE_WITH_VERIFICATION_FLAGS";
    const verification_note = requires_field_verification
      ? [
          "Field verification required (phase 4.4b structural create).",
          labelUncertain && rawLabel ? `Observed directory text: “${rawLabel}”.` : null,
          ampTrace.status === "uncertain" ? `Observed breaker-amp text: “${ampTrace.cell_text}”.` : null,
          `Evidence: ${evidence || "field observation journal"}.`,
        ]
          .filter(Boolean)
          .join(" ")
      : null;

    const ampEvidenceText =
      ampsKnown !== null
        ? amp_evidence ?? "explicit numeric breaker-amp observation"
        : `NULL — ${AMP_STATUS_LABELS[ampTrace.status]}; never inferred from directory description text.`;

    const proposed_columns: ProposedColumn[] = [
      {
        column: "panel_uuid",
        value: primary.panel_id,
        source_evidence: `Panel identity resolved from the observation (“${primary.panel_source_name}”).`,
      },
      {
        column: "side / position",
        value: slots.map((s) => `${s.side} ${s.position}`).join(", ") || null,
        source_evidence: `Explicitly parsed occupied position(s) “${primary.positions_text}”.`,
      },
      {
        column: "breaker_number",
        value: slots.map((s) => s.breaker_number).join(", ") || null,
        source_evidence: "Circuit number(s) exactly as transcribed.",
      },
      {
        column: "poles",
        value: poles,
        source_evidence:
          poles_source === "observed"
            ? `Poles column states ${poles}, consistent with ${slots.length} occupied position(s).`
            : `Derived from the ${slots.length} explicitly parsed occupied position(s).`,
      },
      {
        column: "ocp_amps",
        value: ampsKnown,
        source_evidence: ampEvidenceText,
      },
      {
        column: "label",
        value: label,
        source_evidence: label
          ? "Directory description observed with adequate confidence and no uncertainty marker."
          : "NULL — no confident directory description; uncertain text stays in the field observation.",
      },
      {
        column: "notes",
        value: verification_note,
        source_evidence: verification_note
          ? "Verification flag and verbatim uncertain text."
          : "NULL — nothing to flag.",
      },
      {
        column: "install_status",
        value: null,
        source_evidence: "NULL — install progress is not observable from a panel directory photo.",
      },
      {
        column: "label_status / load_uuid / circuit_group_uuid / completion_percent",
        value: null,
        source_evidence: "NULL — not supported by the field observation; never filled by inference.",
      },
    ];

    rows.push({
      key: id,
      panel_id: primary.panel_id,
      panel_source_name: primary.panel_source_name,
      positions_text: primary.positions_text,
      positions,
      slots,
      poles,
      poles_source,
      ocp_amps: ampsKnown,
      amps_unknown: ampsKnown === null,
      amps_observed_text: ampsField?.observed_text || (ampTrace.cell_text || null),
      amp_status: ampTrace.status,
      amp_status_label: AMP_STATUS_LABELS[ampTrace.status],
      amp_source_column: ampTrace.column,
      amp_observation_present: ampTrace.status === "explicit_numeric" || ampTrace.status === "uncertain",
      amp_evidence,
      mismatch,
      label,
      label_observed_text: labelField?.observed_text || null,
      confidence,
      verification_required,
      verification_status: verification_required ? "required" : "not_required",
      existing,
      differences,
      action,
      blocking_reason,
      safety_class,
      safety_class_label: SAFETY_CLASS_LABELS[safety_class],
      safety_reasons,
      requires_field_verification,
      verification_note,
      proposed_columns,
      evidence,
    });
  }


  const order: PopulationAction[] = [
    "propose_create",
    "requires_review",
    "blocked_position_mismatch",
    "blocked_unresolved",
    "conflict_do_not_apply",
    "already_exists",
  ];
  return rows.sort(
    (a, b) =>
      order.indexOf(a.action) - order.indexOf(b.action) ||
      (a.panel_id ?? "").localeCompare(b.panel_id ?? "") ||
      (a.positions[0] ?? 0) - (b.positions[0] ?? 0),
  );
}

/** True when the safety gate permits creation of this row (selection still required). */
export function isCreatable(r: BreakerPopulationRow): boolean {
  return r.safety_class !== "BLOCKED";
}

export function breakerPopulationDiagnostics(rows: BreakerPopulationRow[]): BreakerPopulationDiagnostics {
  const count = (a: PopulationAction) => rows.filter((r) => r.action === a).length;
  const cls = (c: BreakerSafetyClass) => rows.filter((r) => r.safety_class === c).length;
  return {
    unique_breakers_considered: rows.length,
    eligible_to_create: rows.filter(isCreatable).length,
    safe_structural_creates: cls("SAFE_STRUCTURAL_CREATE"),
    creates_requiring_verification: cls("CREATE_WITH_VERIFICATION_FLAGS"),
    blocked_total: cls("BLOCKED"),
    already_existing: count("already_exists"),
    blocked_position_mismatch: count("blocked_position_mismatch"),
    blocked_unresolved: count("blocked_unresolved"),
    breaker_amps_unknown: rows.filter((r) => r.amps_unknown).length,
    explicit_amp_observations: rows.filter((r) => r.amp_observation_present).length,
    explicit_numeric_amps: rows.filter((r) => r.amp_status === "explicit_numeric").length,
    blank_amps: rows.filter((r) => r.amp_status === "blank").length,
    uncertain_amps: rows.filter((r) => r.amp_status === "uncertain").length,
    no_amp_mapping: rows.filter((r) => r.amp_status === "no_mapping").length,
    verification_required: rows.filter((r) => r.verification_required).length,
    conflicts: count("conflict_do_not_apply"),
    requires_review: count("requires_review"),
    positions_to_create: rows.filter(isCreatable).reduce((n, r) => n + r.slots.length, 0),
  };
}


/** Every blocked position/pole mismatch, for inspection before any correction. */
export function breakerPositionMismatches(rows: BreakerPopulationRow[]): BreakerPositionMismatch[] {
  return rows.map((r) => r.mismatch).filter((m): m is BreakerPositionMismatch => m !== null);
}

export const BREAKER_MISMATCH_CSV = "phase-4.4b-breaker-position-mismatches.csv";

export function breakerMismatchCsv(rows: BreakerPopulationRow[]): string {
  const head = [
    "panel",
    "raw_circuit_text",
    "parsed_occupied_positions",
    "observed_poles",
    "observed_poles_text",
    "poles_source",
    "source_sheet",
    "source_rows",
    "reason",
  ];
  const lines = breakerPositionMismatches(rows).map((m) =>
    [
      m.panel,
      m.raw_circuit_text,
      m.parsed_positions.join("/"),
      m.observed_poles ?? "",
      m.observed_poles_text ?? "",
      m.poles_source,
      m.source_sheet ?? "",
      m.source_rows.join(" "),
      m.reason,
    ]
      .map(csvCell)
      .join(","),
  );
  return [head.join(","), ...lines].join("\n");
}

// ------------------------------------------------------------------- exports

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const BREAKER_POPULATION_CSV = "phase-4.4b-breaker-position-population.csv";

export function breakerPopulationCsv(rows: BreakerPopulationRow[]): string {
  const head = [
    "panel",
    "positions",
    "poles",
    "poles_source",
    "breaker_amps",
    "amps_observed_text",
    "amp_status",
    "amp_source_column",
    "amp_evidence",
    "directory_description",
    "confidence",
    "verification_status",
    "existing_farmops_record",
    "existing_poles",
    "existing_amps",
    "existing_label",
    "differences",
    "proposed_action",
    "safety_class",
    "requires_field_verification",
    "safety_reasons",
    "populated_columns",
    "blocking_reason",
    "evidence",

  ];
  const lines = rows.map((r) =>
    [
      r.panel_id ?? r.panel_source_name,
      r.positions_text,
      r.poles ?? "",
      r.poles_source,
      r.ocp_amps ?? "UNKNOWN",
      r.amps_observed_text ?? "",
      r.amp_status,
      r.amp_source_column ?? "",
      r.amp_evidence ?? "",
      r.label ?? "",
      r.confidence,
      r.verification_status,
      r.existing ? "present" : "absent",
      r.existing?.poles ?? "",
      r.existing?.ocp_amps ?? "",
      r.existing?.label ?? "",
      r.differences.map((d) => `${d.field}: ${d.existing ?? "(blank)"} vs ${d.observed ?? "(blank)"}`).join("; "),
      r.action,
      r.safety_class,
      r.requires_field_verification ? "yes" : "no",
      r.safety_reasons.join("; "),
      r.proposed_columns
        .filter((c) => c.value !== null && c.value !== "")
        .map((c) => `${c.column}=${c.value}`)
        .join("; "),
      r.blocking_reason ?? "",
      r.evidence,

    ]
      .map(csvCell)
      .join(","),
  );
  return [head.join(","), ...lines].join("\n");
}

export function breakerPopulationMarkdown(
  rows: BreakerPopulationRow[],
  diagnostics: BreakerPopulationDiagnostics,
  generatedAt: string,
  scope: FieldReconciliationScope = HOUSE_SCOPE,
): string {
  const d = diagnostics;
  const table = [
    "| Panel | Positions | Poles | Amps | Directory description | Confidence | Verification | Existing | Safety class | Action | Blocking reason |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((r) =>
      `| ${r.panel_id ?? r.panel_source_name} | ${r.positions_text} | ${r.poles ?? "?"} | ${
        r.ocp_amps ?? "UNKNOWN"
      } | ${(r.label ?? "").replace(/\|/g, "/")} | ${r.confidence} | ${r.verification_status} | ${
        r.existing ? "present" : "absent"
      } | ${r.safety_class} | ${r.action} | ${(r.blocking_reason ?? "").replace(/\|/g, "/")} |`,
    ),
  ].join("\n");


  return [
    `# Phase ${BREAKER_POPULATION_PHASE} — ${scope.area} breaker-position population preview`,
    "",
    `Generated ${generatedAt}. Read-only: no FarmOps record was created or modified.`,
    "",
    "## Diagnostics",
    "",
    `- Unique logical breakers considered: ${d.unique_breakers_considered}`,
    `- Safe structural creates: ${d.safe_structural_creates}`,
    `- Creates requiring verification: ${d.creates_requiring_verification}`,
    `- Blocked (any reason): ${d.blocked_total}`,
    `- Eligible to create: ${d.eligible_to_create} (${d.positions_to_create} positions)`,
    `- Already existing in FarmOps: ${d.already_existing}`,

    `- Blocked by position/pole mismatch: ${d.blocked_position_mismatch}`,
    `- Blocked by unresolved panel or position: ${d.blocked_unresolved}`,
    `- Breaker amps unknown: ${d.breaker_amps_unknown}`,
    `- Explicit amp observations: ${d.explicit_amp_observations} (numeric ${d.explicit_numeric_amps}, uncertain ${d.uncertain_amps})`,
    `- Blank amp cells: ${d.blank_amps}`,
    `- No breaker-amp column mapping: ${d.no_amp_mapping}`,
    `- Verification required: ${d.verification_required}`,
    `- Source conflicts: ${d.conflicts}`,
    `- Requires review: ${d.requires_review}`,
    "",
    ...(rows.some((r) => r.mismatch)
      ? [
          "## Position / pole mismatches (inspection only — not repaired)",
          "",
          "| Panel | Raw circuit text | Parsed positions | Observed poles | Source sheet | Source row(s) | Reason |",
          "| --- | --- | --- | --- | --- | --- | --- |",
          ...breakerPositionMismatches(rows).map(
            (m) =>
              `| ${m.panel} | ${m.raw_circuit_text} | ${m.parsed_positions.join("/") || "(none)"} | ${
                m.observed_poles ?? "?"
              }${m.observed_poles_text ? ` (“${m.observed_poles_text}”)` : ""} | ${m.source_sheet ?? "?"} | ${
                m.source_rows.join(", ") || "?"
              } | ${m.reason.replace(/\|/g, "/")} |`,
          ),
          "",
        ]
      : []),
    "## Guarantees",
    "",
    "- One proposed record per unique logical breaker (panel + occupied positions), never per spreadsheet row.",
    "- Unknown breaker amperage stays unknown; VERIFY / UNKNOWN / uncertain text is never promoted to an engineering value.",
    "- Evidence-only material (photo filename, raw notes, worksheet, side text, uncertainty commentary) stays in the field-observation journal.",
    "- A multi-pole breaker whose occupied-position count disagrees with its pole count is blocked, not created.",
    "- Existing records are compared, never duplicated and never overwritten.",
    "- No service revision, panel ID, canonical ODS value, or topology relationship is touched.",
    "",
    "## Proposed records",
    "",
    table,
    "",
  ].join("\n");
}
