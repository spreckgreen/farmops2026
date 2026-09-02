// Phase 4.4b — Demand VA placeholder semantic adjudication (read-only).
//
// Category-C pattern analysis proved that the 138 Category-C findings are one
// systematic group: `loads · demand_va`, ODS = PLACEHOLDER_TOKEN, FarmOps =
// absent, likely cause PLACEHOLDER_OR_UNKNOWN. This module adjudicates that
// group *semantically* — per distinct source token, never per collapsed bucket.
//
// Invariants:
//  - The immutable raw Category-C findings are never reclassified. The raw
//    category stays C; this module adds a separate adjudication measure.
//  - Distinct source tokens (TBD, blank, N/A, ?, UNKNOWN, VERIFY, 0) are never
//    merged into one semantic state, and the exact source token is preserved.
//  - Numeric 0 is an explicit numeric value only when the cell actually holds
//    numeric zero. A text placeholder is never coerced to zero.
//  - Only "unknown / not yet determined" may be adjudicated
//    PLACEHOLDER_PRESERVED_AS_NULL. N/A, VERIFY, explicit zero and any other
//    semantics stay unresolved until equivalence is independently established.
//  - No ODS edits, no FarmOps writes, no schema change, no normalization change.
//    The semantic-status model below is a *proposal only*; the field is not added.
import type {
  NumericDiagnosticsReport,
  NumericFinding,
} from "@/lib/electrical-numeric-diagnostics";

export const DEMAND_VA_PLACEHOLDER_VERSION =
  "4.4b-demand-va-placeholder-semantic-adjudication-1";

/** FarmOps field this adjudication is scoped to. */
export const DEMAND_VA_FIELD = "demand_va";

export type DemandVaSemanticState =
  | "UNKNOWN_NOT_YET_DETERMINED"
  | "NOT_APPLICABLE"
  | "VERIFICATION_REQUIRED"
  | "EXPLICIT_ZERO"
  | "BLANK_UNSPECIFIED"
  | "OTHER_UNRESOLVED";

export const DEMAND_VA_STATE_LABELS: Record<DemandVaSemanticState, string> = {
  UNKNOWN_NOT_YET_DETERMINED:
    "Engineering has not yet determined the value (TBD, unknown, ?, pending).",
  NOT_APPLICABLE:
    "The quantity does not apply to this record (N/A, none, dash) — not the same as unknown.",
  VERIFICATION_REQUIRED:
    "The workbook asks for field verification (verify, check, confirm) — an action, not a value.",
  EXPLICIT_ZERO: "The cell actually holds numeric zero — an explicit engineering value.",
  BLANK_UNSPECIFIED: "The cell is empty; nothing about the engineering state is stated.",
  OTHER_UNRESOLVED: "A token whose semantics are not established — individual review required.",
};

export type DemandVaAdjudication =
  | "PLACEHOLDER_PRESERVED_AS_NULL"
  | "SEMANTIC_NOT_EQUIVALENT_TO_NULL"
  | "EXPLICIT_VALUE_NOT_A_PLACEHOLDER"
  | "SEMANTICS_UNRESOLVED";

export const DEMAND_VA_ADJUDICATION_LABELS: Record<DemandVaAdjudication, string> = {
  PLACEHOLDER_PRESERVED_AS_NULL:
    "Unknown / not-yet-determined; FarmOps NULL preserves the numeric state faithfully and the source token is retained as provenance — resolved for Phase 4.5 without writing a number.",
  SEMANTIC_NOT_EQUIVALENT_TO_NULL:
    "A distinct semantic (not-applicable / verification-required) that plain NULL does not represent — equivalence to NULL is not established.",
  EXPLICIT_VALUE_NOT_A_PLACEHOLDER:
    "The source states an explicit numeric value; it is not a placeholder and cannot be closed by a NULL-preservation rule.",
  SEMANTICS_UNRESOLVED: "Token semantics not established — stays unresolved for Phase 4.5.",
};

/* ------------------------------------------------------- token classification */

const NUMERIC = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const UNKNOWN =
  /^(?:tbd|t\.?b\.?d\.?|tba|\?+|unk|unknown|nd|n\/d|pending|to be determined)$/i;
const NOT_APPLICABLE = /^(?:n\/?a|na|none|-{1,3}|\u2013|\u2014)$/i;
const VERIFICATION =
  /^(?:verify|verify field|field verify|verify in field|check|confirm|to be verified|to be confirmed)$/i;

/**
 * Classify a single source token. The token is never rewritten; only a semantic
 * state is attached to it. Text is never coerced to zero.
 */
export function classifyDemandVaToken(raw: string): DemandVaSemanticState {
  const s = (raw ?? "").trim();
  if (s === "") return "BLANK_UNSPECIFIED";
  if (NUMERIC.test(s)) return Number(s) === 0 ? "EXPLICIT_ZERO" : "OTHER_UNRESOLVED";
  if (UNKNOWN.test(s)) return "UNKNOWN_NOT_YET_DETERMINED";
  if (NOT_APPLICABLE.test(s)) return "NOT_APPLICABLE";
  if (VERIFICATION.test(s)) return "VERIFICATION_REQUIRED";
  return "OTHER_UNRESOLVED";
}

function adjudicate(
  state: DemandVaSemanticState,
  farmopsIsNull: boolean,
): { adjudication: DemandVaAdjudication; resolved: boolean; reason: string } {
  if (state === "UNKNOWN_NOT_YET_DETERMINED") {
    return farmopsIsNull
      ? {
          adjudication: "PLACEHOLDER_PRESERVED_AS_NULL",
          resolved: true,
          reason:
            "FarmOps demand_va = NULL states \u201cno numeric value determined\u201d, which is exactly what the source token states; the token itself is retained as provenance on the SHA-bound finding. No numeric value is written.",
        }
      : {
          adjudication: "SEMANTICS_UNRESOLVED",
          resolved: false,
          reason:
            "The source states an undetermined value but FarmOps holds something other than NULL \u2014 preservation is not demonstrated.",
        };
  }
  if (state === "NOT_APPLICABLE" || state === "VERIFICATION_REQUIRED") {
    return {
      adjudication: "SEMANTIC_NOT_EQUIVALENT_TO_NULL",
      resolved: false,
      reason:
        "Plain NULL cannot distinguish this semantic from \u201cnot yet determined\u201d; equivalence has not been independently established. Requires the proposed semantic-status field.",
    };
  }
  if (state === "EXPLICIT_ZERO") {
    return {
      adjudication: "EXPLICIT_VALUE_NOT_A_PLACEHOLDER",
      resolved: false,
      reason:
        "Numeric zero is an explicit engineering value, not a placeholder; NULL does not represent it and it is not covered by the preservation rule.",
    };
  }
  if (state === "BLANK_UNSPECIFIED") {
    return {
      adjudication: "SEMANTICS_UNRESOLVED",
      resolved: false,
      reason:
        "A blank cell does not state that the value is undetermined; \u201cblank\u201d and \u201cTBD\u201d are not proven equivalent, so it is not closed under the preservation rule.",
    };
  }
  return {
    adjudication: "SEMANTICS_UNRESOLVED",
    resolved: false,
    reason: "Token semantics not established \u2014 individual review required.",
  };
}

/* ------------------------------------------------------------------- report */

export interface DemandVaTokenGroup {
  /** Exact source token, verbatim. Empty string means a genuinely blank cell. */
  token: string;
  /** Display form for a blank token; never used for matching. */
  token_display: string;
  semantic_state: DemandVaSemanticState;
  count: number;
  worksheets: string[];
  representative_stable_ids: string[];
  stable_ids: string[];
  /** FarmOps representation states observed for this token. */
  farmops_states: string[];
  /** True when every FarmOps value for this token is NULL / absent. */
  farmops_all_null: boolean;
  /** Does FarmOps `demand_va = NULL` losslessly represent this semantic alone? */
  null_lossless: boolean;
  loss_description: string;
  adjudication: DemandVaAdjudication;
  resolved_for_phase_4_5: boolean;
  rationale: string;
  findings: NumericFinding[];
}

export interface DemandVaModelProposal {
  proposal_only: true;
  applied: false;
  value_field: string;
  status_field: string;
  provenance_field: string;
  status_values: DemandVaSemanticState[];
  note: string;
}

export interface DemandVaPlaceholderReport {
  version: string;
  ods_file_name: string;
  ods_sha256: string;
  compared_at: string;
  /** All immutable raw Category-C findings in the run. */
  raw_c: number;
  /** Raw Category-C findings scoped to loads · demand_va. */
  in_scope: number;
  /** Raw Category-C findings outside this group — untouched by this adjudication. */
  out_of_scope: number;
  distinct_source_tokens: number;
  tokens: DemandVaTokenGroup[];
  counts_by_state: Record<DemandVaSemanticState, number>;
  counts_by_adjudication: Record<DemandVaAdjudication, number>;
  placeholder_preserved_as_null: number;
  /** Still unresolved Category C across the whole run after this adjudication. */
  still_unresolved_c: number;
  /** Unresolved rows inside this group only. */
  still_unresolved_in_scope: number;
  semantic_status_model_required: boolean;
  semantic_status_model_reason: string;
  model_proposal: DemandVaModelProposal;
  read_only: true;
  write_authorized: false;
}

const EMPTY_STATES = (): Record<DemandVaSemanticState, number> => ({
  UNKNOWN_NOT_YET_DETERMINED: 0,
  NOT_APPLICABLE: 0,
  VERIFICATION_REQUIRED: 0,
  EXPLICIT_ZERO: 0,
  BLANK_UNSPECIFIED: 0,
  OTHER_UNRESOLVED: 0,
});

const EMPTY_ADJUDICATIONS = (): Record<DemandVaAdjudication, number> => ({
  PLACEHOLDER_PRESERVED_AS_NULL: 0,
  SEMANTIC_NOT_EQUIVALENT_TO_NULL: 0,
  EXPLICIT_VALUE_NOT_A_PLACEHOLDER: 0,
  SEMANTICS_UNRESOLVED: 0,
});

const uniq = (v: string[]) => [...new Set(v.filter((s) => s !== ""))].sort();

export function demandVaPlaceholderAdjudication(
  r: NumericDiagnosticsReport,
): DemandVaPlaceholderReport {
  const allC = r.findings.filter((f) => f.raw_category === "C");
  const scope = allC.filter((f) => f.farmops_field === DEMAND_VA_FIELD);

  const buckets = new Map<string, NumericFinding[]>();
  for (const f of scope) {
    const token = (f.ods_raw ?? "").trim();
    const list = buckets.get(token);
    if (list) list.push(f);
    else buckets.set(token, [f]);
  }

  const tokens: DemandVaTokenGroup[] = [...buckets.entries()].map(([token, findings]) => {
    const sorted = [...findings].sort((a, b) => a.stable_id.localeCompare(b.stable_id));
    const state = classifyDemandVaToken(token);
    const farmopsStates = uniq(sorted.map((f) => f.farmops_state));
    const allNull = sorted.every(
      (f) => f.farmops_state === "absent" && (f.farmops_raw ?? "").trim() === "",
    );
    const decision = adjudicate(state, allNull);
    return {
      token,
      token_display: token === "" ? "(blank cell)" : token,
      semantic_state: state,
      count: sorted.length,
      worksheets: uniq(sorted.map((f) => f.ods_worksheet)),
      representative_stable_ids: sorted.slice(0, 5).map((f) => f.stable_id),
      stable_ids: sorted.map((f) => f.stable_id),
      farmops_states: farmopsStates,
      farmops_all_null: allNull,
      null_lossless: state === "UNKNOWN_NOT_YET_DETERMINED" && allNull,
      loss_description:
        state === "UNKNOWN_NOT_YET_DETERMINED"
          ? allNull
            ? "NULL preserves the numeric state (no value determined); the source token is retained as provenance."
            : "FarmOps is not NULL for every row, so NULL-preservation cannot be asserted."
          : `NULL does not carry \u201c${state}\u201d; the distinction against \u201cnot yet determined\u201d is lost without a semantic-status field.`,
      adjudication: decision.adjudication,
      resolved_for_phase_4_5: decision.resolved,
      rationale: decision.reason,
      findings: sorted,
    };
  });

  tokens.sort((a, b) => b.count - a.count || a.token_display.localeCompare(b.token_display));

  const counts_by_state = EMPTY_STATES();
  const counts_by_adjudication = EMPTY_ADJUDICATIONS();
  let preserved = 0;
  for (const t of tokens) {
    counts_by_state[t.semantic_state] += t.count;
    counts_by_adjudication[t.adjudication] += t.count;
    if (t.resolved_for_phase_4_5) preserved += t.count;
  }

  const distinctStates = (Object.keys(counts_by_state) as DemandVaSemanticState[]).filter(
    (s) => counts_by_state[s] > 0,
  );
  const modelRequired = distinctStates.length > 1;

  return {
    version: DEMAND_VA_PLACEHOLDER_VERSION,
    ods_file_name: r.generated_from_ods,
    ods_sha256: r.ods_sha256,
    compared_at: r.compared_at,
    raw_c: allC.length,
    in_scope: scope.length,
    out_of_scope: allC.length - scope.length,
    distinct_source_tokens: tokens.length,
    tokens,
    counts_by_state,
    counts_by_adjudication,
    placeholder_preserved_as_null: preserved,
    still_unresolved_c: allC.length - preserved,
    still_unresolved_in_scope: scope.length - preserved,
    semantic_status_model_required: modelRequired,
    semantic_status_model_reason: modelRequired
      ? `More than one distinct source semantic is present (${distinctStates.join(", ")}); a single NULL column cannot distinguish them.`
      : distinctStates.length === 1
        ? `Only one source semantic is present (${distinctStates[0]}); NULL plus retained provenance represents it without loss.`
        : "No Category-C demand_va findings in this run.",
    model_proposal: {
      proposal_only: true,
      applied: false,
      value_field: "electrical_loads.demand_va (stays NULL — never a substituted number)",
      status_field: "electrical_loads.demand_va_status (proposed semantic state)",
      provenance_field:
        "electrical_loads.demand_va_source_token (proposed — the exact canonical token, verbatim)",
      status_values: [
        "UNKNOWN_NOT_YET_DETERMINED",
        "NOT_APPLICABLE",
        "VERIFICATION_REQUIRED",
        "EXPLICIT_ZERO",
        "BLANK_UNSPECIFIED",
        "OTHER_UNRESOLVED",
      ],
      note: "Model proposal only. The field is not added in this phase and no migration is authorized.",
    },
    read_only: true,
    write_authorized: false,
  };
}

/* ------------------------------------------------------------------ exports */

function csv(rows: string[][]): string {
  return rows
    .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\n");
}

export function demandVaTokensCsv(a: DemandVaPlaceholderReport): string {
  return csv([
    [
      "ods_sha256",
      "source_token",
      "count",
      "worksheets",
      "representative_stable_ids",
      "semantic_state",
      "farmops_states",
      "farmops_all_null",
      "null_lossless",
      "adjudication",
      "resolved_for_phase_4_5",
      "rationale",
    ],
    ...a.tokens.map((t) => [
      a.ods_sha256,
      t.token_display,
      String(t.count),
      t.worksheets.join(" | "),
      t.representative_stable_ids.join(" | "),
      t.semantic_state,
      t.farmops_states.join(" | "),
      String(t.farmops_all_null),
      String(t.null_lossless),
      t.adjudication,
      String(t.resolved_for_phase_4_5),
      t.rationale,
    ]),
  ]);
}

export function demandVaFindingsCsv(a: DemandVaPlaceholderReport): string {
  return csv([
    [
      "ods_sha256",
      "stable_id",
      "farmops_entity",
      "farmops_field",
      "ods_worksheet",
      "ods_row",
      "source_token",
      "semantic_state",
      "farmops_raw",
      "farmops_state",
      "raw_category",
      "adjudication",
      "resolved_for_phase_4_5",
    ],
    ...a.tokens.flatMap((t) =>
      t.findings.map((f) => [
        a.ods_sha256,
        f.stable_id,
        f.farmops_entity ?? "",
        f.farmops_field,
        f.ods_worksheet,
        f.ods_row === null ? "" : String(f.ods_row),
        t.token_display,
        t.semantic_state,
        f.farmops_raw,
        f.farmops_state,
        f.raw_category,
        t.adjudication,
        String(t.resolved_for_phase_4_5),
      ]),
    ),
  ]);
}

export function demandVaPlaceholderMarkdown(a: DemandVaPlaceholderReport): string {
  return [
    "# Phase 4.4b \u2014 Demand VA placeholder semantic adjudication (read-only)",
    "",
    `- Canonical workbook: \`${a.ods_file_name}\``,
    `- Workbook SHA-256: \`${a.ods_sha256}\``,
    `- Compared at: ${a.compared_at}`,
    `- Version: \`${a.version}\``,
    "- Writes performed: **none** \u2014 no ODS change, no FarmOps write, no schema change, no normalization change",
    "",
    "## Totals",
    "",
    `- Raw C = ${a.raw_c}`,
    `- In scope (loads \u00b7 demand_va) = ${a.in_scope}; out of scope = ${a.out_of_scope}`,
    `- Placeholder-preserved-as-NULL = ${a.placeholder_preserved_as_null}`,
    `- Still unresolved C = ${a.still_unresolved_c} (in scope: ${a.still_unresolved_in_scope})`,
    `- Distinct source tokens = ${a.distinct_source_tokens}`,
    `- Semantic-status model required = ${a.semantic_status_model_required ? "yes" : "no"} \u2014 ${a.semantic_status_model_reason}`,
    "",
    "## Source tokens",
    "",
    "| Token | Count | Worksheets | Representative stable IDs | Semantic state | FarmOps | NULL lossless | Adjudication | Resolved for 4.5 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...a.tokens.map(
      (t) =>
        `| \`${t.token_display}\` | ${t.count} | ${t.worksheets.join(", ") || "\u2014"} | ${t.representative_stable_ids.join(", ")} | ${t.semantic_state} | ${t.farmops_states.join(", ")} | ${t.null_lossless ? "yes" : "no"} | ${t.adjudication} | ${t.resolved_for_phase_4_5 ? "yes" : "no"} |`,
    ),
    "",
    "## Proposed semantic-status model (proposal only \u2014 not applied)",
    "",
    `- ${a.model_proposal.value_field}`,
    `- ${a.model_proposal.status_field}`,
    `- ${a.model_proposal.provenance_field}`,
    `- Allowed status values: ${a.model_proposal.status_values.join(", ")}`,
    `- ${a.model_proposal.note}`,
    "",
  ].join("\n");
}
