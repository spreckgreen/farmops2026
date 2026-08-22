/**
 * Shape + remediation copy for the /health/schema day-colour check.
 *
 * Pure helpers so the route handler stays thin and the logic is unit-testable.
 */
import {
  DAY_COLOUR_COLUMNS,
  isMissingDayColourColumnError,
  dayColourBaseline,
} from "./day-colour-support";

export const DAY_COLOUR_MIGRATION_FILE =
  "supabase/migrations/20260820211737_7d33c0b4-f451-436c-a635-5cc2e361c5cc.sql";

export type SchemaHealthStatus = "ok" | "missing" | "unknown";

export type SchemaHealthPayload = {
  ok: boolean;
  service: "bostead";
  check: "schema/day-colour";
  status: SchemaHealthStatus;
  table: "daily_notes";
  columns: string[];
  baseline: number | null;
  detail: string;
  remediation: string[];
  error?: string;
  checkedAt: string;
};

export const DAY_COLOUR_REMEDIATION: string[] = [
  `Apply pending migrations on the host: ./scripts/apply-migrations.sh (or ./scripts/fix-day-colour.sh to apply just ${DAY_COLOUR_MIGRATION_FILE}).`,
  "Redeploy with ./scripts/refresh.sh — it runs the migration step automatically before starting the new containers.",
  "If migrations ran but the column is still reported missing, reload the API schema cache: psql \"$SUPABASE_DB_URL\" -c \"NOTIFY pgrst, 'reload schema'\".",
  "Manual fallback SQL: ALTER TABLE public.daily_notes ADD COLUMN IF NOT EXISTS energy_level smallint, ADD COLUMN IF NOT EXISTS productivity_level smallint;",
  "Until fixed the app degrades gracefully: day-colour ratings read as the configured baseline (DAY_COLOUR_BASELINE) or null, and saving shows an unavailable notice instead of an error.",
];

/**
 * Build the payload from a probe result, e.g.
 * buildSchemaHealth({ error: { code: "PGRST204", message: "Could not find the 'energy_level' column ..." } })
 *   => { ok: false, status: "missing", remediation: [...] }
 */
export function buildSchemaHealth(probe: {
  error?: unknown;
  baseline?: number | null;
  now?: Date;
}): SchemaHealthPayload {
  const base = {
    service: "bostead" as const,
    check: "schema/day-colour" as const,
    table: "daily_notes" as const,
    columns: [...DAY_COLOUR_COLUMNS],
    baseline: probe.baseline ?? dayColourBaseline(),
    checkedAt: (probe.now ?? new Date()).toISOString(),
  };

  if (!probe.error) {
    return {
      ...base,
      ok: true,
      status: "ok",
      detail: "daily_notes.energy_level and daily_notes.productivity_level are present and readable.",
      remediation: [],
    };
  }

  const message =
    probe.error instanceof Error
      ? probe.error.message
      : ((probe.error as { message?: string } | null)?.message ??
        String(probe.error ?? "unknown error"));

  if (isMissingDayColourColumnError(probe.error)) {
    return {
      ...base,
      ok: false,
      status: "missing",
      detail:
        "The day-colour migration has not been applied to this database, so energy_level / productivity_level are missing.",
      remediation: DAY_COLOUR_REMEDIATION,
      error: message,
    };
  }

  return {
    ...base,
    ok: false,
    status: "unknown",
    detail:
      "Could not verify the day-colour columns — the probe failed for another reason (connectivity, API keys, or table permissions).",
    remediation: [
      "Check backend connectivity and env vars: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set for the app container.",
      "Confirm the Data API grants exist: GRANT SELECT ON public.daily_notes TO authenticated;",
      "Then re-run this check: curl -s http://localhost:3000/health/schema | jq",
    ],
    error: message,
  };
}
