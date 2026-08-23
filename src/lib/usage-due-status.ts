// Per-service due status for usage-based (hours/miles) schedules.
// Pure functions: given a schedule, its asset, and the asset's usage snapshots,
// estimate the daily usage rate, the next threshold, and an estimated due date.
import type { ServiceSchedule } from "@/types/scheduling";
import type { Asset } from "@/components/dashboard/types";
import { computeReminder, parseUsageRecurrence, type Reminder } from "@/lib/maintenance-reminders";

export interface UsageSnapshot {
  recorded_at: string;
  hours: number | null;
  miles: number | null;
}

export type Urgency = "overdue" | "critical" | "soon" | "planned" | "unknown";

export interface UsageDueStatus {
  unit: "hours" | "miles";
  /** Live reading from the asset, null when unknown. */
  current: number | null;
  /** Reading the service is anchored from. */
  baseline: number;
  /** Interval between services, e.g. 100 hours. */
  interval: number;
  /** Next reading at which the service is due. */
  nextThreshold: number;
  /** Units remaining until the threshold (negative = past due). */
  remaining: number | null;
  /** 0-1 progress through the current interval. */
  progress: number | null;
  /** Units accumulated per day, derived from snapshots. Null when not derivable. */
  ratePerDay: number | null;
  /** Number of snapshot points and span used for the rate. */
  rateSamples: number;
  rateSpanDays: number | null;
  /** Estimated calendar due date, null when there's no usable rate. */
  estimatedDueDate: Date | null;
  /** Whole days until the estimated due date (negative = past due). */
  daysUntilDue: number | null;
  urgency: Urgency;
  /** One-line summary, e.g. "Due in 42 hours — est. Sep 14 (12 days)". */
  summary: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Least-squares slope of usage over time, in units/day.
 * Example: snapshots 1200h on Jun 1 and 1340h on Jul 1 -> ~4.67 hours/day.
 */
export function estimateUsageRatePerDay(
  snapshots: UsageSnapshot[],
  unit: "hours" | "miles",
): { ratePerDay: number | null; samples: number; spanDays: number | null } {
  const points = snapshots
    .map((s) => ({
      t: new Date(s.recorded_at).getTime(),
      v: unit === "hours" ? s.hours : s.miles,
    }))
    .filter((p) => Number.isFinite(p.t) && p.v != null && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t) as { t: number; v: number }[];

  if (points.length < 2) {
    return { ratePerDay: null, samples: points.length, spanDays: null };
  }

  const spanDays = (points[points.length - 1]!.t - points[0]!.t) / DAY_MS;
  if (spanDays <= 0) return { ratePerDay: null, samples: points.length, spanDays: 0 };

  const xs = points.map((p) => (p.t - points[0]!.t) / DAY_MS);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = points.reduce((a, p) => a + p.v, 0) / points.length;
  let num = 0;
  let den = 0;
  points.forEach((p, i) => {
    const dx = xs[i]! - meanX;
    num += dx * (p.v - meanY);
    den += dx * dx;
  });
  if (den === 0) return { ratePerDay: null, samples: points.length, spanDays };
  const rate = num / den;
  // Usage counters only go up; treat flat/negative slopes as "no signal".
  if (!Number.isFinite(rate) || rate <= 0) {
    return { ratePerDay: null, samples: points.length, spanDays };
  }
  return { ratePerDay: rate, samples: points.length, spanDays };
}

function urgencyFrom(
  remaining: number | null,
  daysUntilDue: number | null,
  interval: number,
): Urgency {
  if (remaining == null) return "unknown";
  if (remaining < 0) return "overdue";
  if (daysUntilDue != null) {
    if (daysUntilDue <= 7) return "critical";
    if (daysUntilDue <= 30) return "soon";
    return "planned";
  }
  if (remaining <= Math.max(1, interval * 0.1)) return "critical";
  if (remaining <= Math.max(1, interval * 0.25)) return "soon";
  return "planned";
}

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString();
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Build the due-status panel data for a usage-based schedule.
 * Returns null for date-based schedules (nothing usage-specific to show).
 */
export function computeUsageDueStatus(
  schedule: ServiceSchedule,
  asset: Asset | undefined,
  snapshots: UsageSnapshot[],
  now: Date = new Date(),
): UsageDueStatus | null {
  const usage = parseUsageRecurrence(schedule.recurrence);
  if (!usage) return null;

  const reminder: Reminder = computeReminder(schedule, asset);
  const raw = (schedule as unknown as { raw?: Record<string, unknown> }).raw ?? {};
  const baselineRaw = usage.unit === "hours" ? raw["baseline_hours"] : raw["baseline_miles"];
  const baseline = typeof baselineRaw === "number" ? baselineRaw : 0;
  const nextThreshold =
    typeof reminder.threshold === "number" ? reminder.threshold : baseline + usage.interval;
  const current =
    usage.unit === "hours" ? asset?.current_hours ?? null : asset?.current_miles ?? null;

  const { ratePerDay, samples, spanDays } = estimateUsageRatePerDay(snapshots, usage.unit);
  const remaining = reminder.remaining;

  let estimatedDueDate: Date | null = null;
  let daysUntilDue: number | null = null;
  if (ratePerDay != null && remaining != null) {
    daysUntilDue = Math.round(remaining / ratePerDay);
    estimatedDueDate = new Date(now.getTime() + (remaining / ratePerDay) * DAY_MS);
  }

  const urgency = urgencyFrom(remaining, daysUntilDue, usage.interval);
  const unitLabel = usage.unit;

  let summary: string;
  if (remaining == null) {
    summary = `Next service at ${fmtNum(nextThreshold)} ${unitLabel} — no current reading logged`;
  } else if (remaining < 0) {
    summary = `Overdue by ${fmtNum(Math.abs(remaining))} ${unitLabel} (threshold ${fmtNum(nextThreshold)})`;
  } else {
    summary = `Due in ${fmtNum(remaining)} ${unitLabel} at ${fmtNum(nextThreshold)}`;
    if (estimatedDueDate) {
      summary += ` — est. ${fmtDate(estimatedDueDate)}`;
      if (daysUntilDue != null) {
        summary += ` (${daysUntilDue} day${Math.abs(daysUntilDue) === 1 ? "" : "s"})`;
      }
    }
  }

  return {
    unit: usage.unit,
    current,
    baseline,
    interval: usage.interval,
    nextThreshold,
    remaining,
    progress: reminder.progress,
    ratePerDay,
    rateSamples: samples,
    rateSpanDays: spanDays,
    estimatedDueDate,
    daysUntilDue,
    urgency,
    summary,
  };
}

export const urgencyLabels: Record<Urgency, string> = {
  overdue: "Overdue",
  critical: "Critical",
  soon: "Due soon",
  planned: "On plan",
  unknown: "Unknown",
};
