// FARMOPS-ELEC-CIRCUIT-GROUP-STATE-V1 — display-only lifecycle state for a
// circuit group.
//
// A circuit group is a container: its own completeness is a *consequence* of the
// breaker assignment plus the loads field evidence proved are connected to it.
//
// Rules (display only — this module never writes):
//   * complete            → the breaker position is complete/as-built verified
//                           AND every explicitly audited connected load is at
//                           least complete.
//   * partially_complete  → some audited connected loads are complete, or the
//                           breaker is complete while audited loads are not.
//   * configured          → the group exists and is wired up in records, but no
//                           field evidence has advanced it.
//
// Completion is never cascaded from mere assignment: a planned load that was
// simply assigned to the group contributes nothing. Only loads carrying accepted
// field evidence (an approved FIELD_AS_BUILT observation) are counted.
import { DONE_STAGES } from "@/lib/electrical-lifecycle";

export const CIRCUIT_GROUP_DISPLAY_STATES = [
  "configured",
  "partially_complete",
  "complete",
] as const;
export type CircuitGroupDisplayState = (typeof CIRCUIT_GROUP_DISPLAY_STATES)[number];

export const CIRCUIT_GROUP_STATE_LABELS: Record<CircuitGroupDisplayState, string> = {
  configured: "Configured",
  partially_complete: "Partially complete",
  complete: "Complete",
};

export const CIRCUIT_GROUP_NO_CASCADE_RULE =
  "A circuit group never becomes complete because a planned load was assigned to it. Only loads with accepted field evidence count, and the breaker assignment must itself be complete.";

/** One connected load, as far as circuit-group state is concerned. */
export interface CircuitGroupLoadState {
  load_id: string;
  install_status: string | null;
  /** True only when an approved field audit explicitly observed this connection. */
  field_audited: boolean;
}

export interface CircuitGroupStateInput {
  /** Install status of the breaker position assigned to this group, if any. */
  breaker_install_status: string | null;
  /** True when a breaker position is actually linked to the group. */
  breaker_assigned: boolean;
  loads: readonly CircuitGroupLoadState[];
}

export interface CircuitGroupStateResult {
  state: CircuitGroupDisplayState;
  label: string;
  /** Plain-language reason, shown as helper text next to the state. */
  because: string;
  breakerComplete: boolean;
  auditedTotal: number;
  auditedComplete: number;
  /** Assigned but unaudited loads — they are visible gaps, never cascaded. */
  unauditedAssigned: number;
}

const isDone = (status: string | null) =>
  DONE_STAGES.includes((status ?? "").trim().toLowerCase());

export function deriveCircuitGroupState(
  input: CircuitGroupStateInput,
): CircuitGroupStateResult {
  const breakerComplete = input.breaker_assigned && isDone(input.breaker_install_status);
  const audited = input.loads.filter((l) => l.field_audited);
  const auditedComplete = audited.filter((l) => isDone(l.install_status)).length;
  const unauditedAssigned = input.loads.length - audited.length;

  let state: CircuitGroupDisplayState = "configured";
  let because: string;

  if (breakerComplete && audited.length > 0 && auditedComplete === audited.length) {
    state = "complete";
    because = `Breaker assignment is complete and all ${audited.length} audited connected load(s) are complete.`;
  } else if (breakerComplete || auditedComplete > 0) {
    state = "partially_complete";
    because = !breakerComplete
      ? `${auditedComplete} of ${audited.length} audited load(s) complete, but the breaker assignment is not complete.`
      : audited.length === 0
        ? "Breaker assignment is complete, but no connected load has accepted field evidence yet."
        : `Breaker assignment is complete, but only ${auditedComplete} of ${audited.length} audited load(s) are complete.`;
  } else {
    because = input.loads.length
      ? `Recorded with ${input.loads.length} assigned load(s), none advanced by accepted field evidence.`
      : "Recorded, with no connected load and no field evidence yet.";
  }

  if (unauditedAssigned > 0) {
    because += ` ${unauditedAssigned} assigned load(s) have no field evidence and are not counted.`;
  }

  return {
    state,
    label: CIRCUIT_GROUP_STATE_LABELS[state],
    because,
    breakerComplete,
    auditedTotal: audited.length,
    auditedComplete,
    unauditedAssigned,
  };
}
