// Phase 4.4b — Yes/No engineering semantics.
//
// A Yes/No engineering field has three states, not two: Yes, No and "not
// stated yet". Historically the importer coerced every cell with `Boolean()`,
// so the *text* "N" became `true` and a blank cell became `false`. That is the
// implementation-created default behind the boolean_or_default_semantics
// conflict group: nothing about the workbook said "yes".
//
// This module is the single place that decides what a Yes/No cell means. It is
// pure: no writes, no database access, no reconciliation classification.

export type BooleanState = "true" | "false" | "unknown" | "tbd";

export interface ParsedBoolean {
  /** null means "not stated" — never guessed as false. */
  value: boolean | null;
  state: BooleanState;
  /** False when the text was not a recognised Yes/No token. */
  recognized: boolean;
}

const TRUE_TOKENS = new Set(["y", "yes", "true", "t", "x", "✓", "1"]);
const FALSE_TOKENS = new Set(["n", "no", "false", "f", "0"]);
const BLANK_TOKENS = new Set(["", "n/a", "na", "none", "null", "-", "—"]);
const TBD_TOKENS = new Set(["tbd", "t.b.d.", "tbd?", "?", "??", "unknown", "unk", "to be determined"]);

/**
 * Interpret one Yes/No cell or form value.
 *
 * "Y"/"Yes"/true -> true, "N"/"No"/false -> false, blank -> unknown (null),
 * "TBD"/"?" -> engineering TBD (also null, but a distinct state that must
 * never be written as a boolean). Anything unrecognised stays unknown and is
 * reported rather than invented.
 */
export function parseBooleanCell(raw: unknown): ParsedBoolean {
  if (typeof raw === "boolean") return { value: raw, state: raw ? "true" : "false", recognized: true };
  if (raw === null || raw === undefined) return { value: null, state: "unknown", recognized: true };
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { value: null, state: "unknown", recognized: false };
    return { value: raw !== 0, state: raw !== 0 ? "true" : "false", recognized: true };
  }
  const text = String(raw).replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  if (TBD_TOKENS.has(lower)) return { value: null, state: "tbd", recognized: true };
  if (BLANK_TOKENS.has(lower)) return { value: null, state: "unknown", recognized: true };
  if (TRUE_TOKENS.has(lower)) return { value: true, state: "true", recognized: true };
  if (FALSE_TOKENS.has(lower)) return { value: false, state: "false", recognized: true };
  return { value: null, state: "unknown", recognized: false };
}

/** Form/select representation of a tri-state Yes/No value. */
export function booleanSelectValue(raw: unknown): "yes" | "no" | "unknown" {
  const parsed = parseBooleanCell(raw);
  if (parsed.value === true) return "yes";
  if (parsed.value === false) return "no";
  return "unknown";
}

/** Turn a tri-state select value back into a storable value. */
export function booleanFromSelect(v: string): boolean | null {
  if (v === "yes") return true;
  if (v === "no") return false;
  return null;
}

export function booleanDisplay(raw: unknown): string {
  const parsed = parseBooleanCell(raw);
  if (parsed.state === "tbd") return "TBD";
  if (parsed.value === true) return "yes";
  if (parsed.value === false) return "no";
  return "unknown";
}
