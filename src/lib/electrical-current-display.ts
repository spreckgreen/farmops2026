// FARMOPS-ELEC-CURRENT-DISPLAY-V1 — how recorded current and VA are shown.
//
// A null amps or connected_va value means the record does not carry that value.
// It is NOT zero load and it is NOT zero circuit capacity. A branch-circuit
// overcurrent-device rating (circuit_rating_amps) must never be displayed as an
// outlet's load current: they are different quantities and only one of them is
// an observed property of the utilization equipment or receptacle outlet.

/** Wording used everywhere a nullable recorded current or VA is displayed. */
export const NOT_RECORDED = "not recorded";

/**
 * True when the value is genuinely recorded. Zero is a recorded value (some ODS
 * rows legitimately carry 0), so only null/undefined/blank/non-finite is
 * "not recorded".
 */
export function isRecordedNumber(value: unknown): value is number {
  if (value === null || value === undefined || value === "") return false;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n);
}

/** Format a recorded current, or "not recorded" when the record has none. */
export function displayAmps(value: unknown): string {
  return isRecordedNumber(value) ? `${Number(value)} A` : NOT_RECORDED;
}

/** Format a recorded apparent power, or "not recorded" when absent. */
export function displayVa(value: unknown): string {
  return isRecordedNumber(value) ? `${Number(value)} VA` : NOT_RECORDED;
}

/**
 * The current a capacity calculation may use. `known: false` means the caller
 * must report the load as undetermined rather than substituting zero.
 */
export function loadCurrentForCapacity(value: unknown): { known: boolean; amps: number } {
  return isRecordedNumber(value)
    ? { known: true, amps: Number(value) }
    : { known: false, amps: 0 };
}

/**
 * Rule text shown wherever a circuit rating sits next to a load current, so an
 * OCPD rating is never read as the outlet's own load.
 */
export const RATING_IS_NOT_LOAD_CURRENT =
  "The circuit rating is the overcurrent protective device rating for the branch circuit, not the load current of this outlet.";
