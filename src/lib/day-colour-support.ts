/**
 * Graceful degradation for the "day colour" columns
 * (`daily_notes.energy_level`, `daily_notes.productivity_level`).
 *
 * On a self-hosted database that has not yet applied the day-colour migration,
 * PostgREST rejects any read/write touching those columns with an error like:
 *
 *   { code: "PGRST204",
 *     message: "Could not find the 'energy_level' column of 'daily_notes' in the schema cache" }
 *
 * or, straight from Postgres:
 *
 *   { code: "42703", message: "column daily_notes.energy_level does not exist" }
 *
 * Instead of surfacing those as hard failures, callers treat the feature as
 * unavailable and fall back to `null` (or a configured baseline).
 */

export const DAY_COLOUR_COLUMNS = ["energy_level", "productivity_level"] as const;

export type DayColourRatings = {
  energy_level: number | null;
  productivity_level: number | null;
};

export const DAY_COLOUR_UNSUPPORTED_MESSAGE =
  "Day colour ratings aren't available yet on this database — run the deploy migration step (scripts/apply-migrations.sh) to add energy_level and productivity_level.";

type MaybePostgrestError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
} | null;

/**
 * True when an error means "these columns don't exist here", e.g.
 * isMissingDayColourColumnError({ code: "PGRST204", message: "Could not find the 'energy_level' column of 'daily_notes' in the schema cache" }) === true
 */
export function isMissingDayColourColumnError(error: unknown): boolean {
  const err = error as MaybePostgrestError;
  if (!err) return false;
  const code = typeof err.code === "string" ? err.code : "";
  const text = [err.message, err.details, err.hint]
    .filter((v): v is string => typeof v === "string")
    .join(" ")
    .toLowerCase();

  const mentionsColumn = DAY_COLOUR_COLUMNS.some((c) => text.includes(c));
  if (!mentionsColumn) return false;

  // PGRST204 = column not found in schema cache, 42703 = undefined_column
  if (code === "PGRST204" || code === "42703") return true;
  return (
    text.includes("could not find") ||
    text.includes("does not exist") ||
    text.includes("unknown column")
  );
}

/**
 * Baseline used when the columns are missing. Set DAY_COLOUR_BASELINE=3 to have
 * unrated/unsupported days read back as "3 · ok" instead of null.
 */
export function dayColourBaseline(env?: Record<string, string | undefined>): number | null {
  const raw = (env ?? (typeof process !== "undefined" ? process.env : undefined))?.[
    "DAY_COLOUR_BASELINE"
  ];
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > 5) return null;
  return n;
}

/** Ratings shape to report when the columns aren't present. */
export function fallbackRatings(baseline: number | null = null): DayColourRatings {
  return { energy_level: baseline, productivity_level: baseline };
}

/**
 * Normalize any row (which may be missing the columns entirely) into ratings,
 * falling back to the baseline when a value is absent.
 */
export function readRatings(
  row: Record<string, unknown> | null | undefined,
  baseline: number | null = null,
): DayColourRatings {
  const pick = (key: (typeof DAY_COLOUR_COLUMNS)[number]) => {
    const v = row?.[key];
    return typeof v === "number" && Number.isFinite(v) ? v : baseline;
  };
  return { energy_level: pick("energy_level"), productivity_level: pick("productivity_level") };
}
