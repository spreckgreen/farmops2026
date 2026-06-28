import type { ServiceSchedule } from "@/types/scheduling";
import type { Asset } from "@/components/dashboard/types";

export type ReminderKind = "date" | "hours" | "miles";
export type ReminderStatus = "ok" | "soon" | "due" | "overdue" | "unknown";

export interface Reminder {
  kind: ReminderKind;
  status: ReminderStatus;
  /** Short, user-facing label, e.g. "Due in 42 hours", "Overdue by 312 miles", "Due Apr 12". */
  label: string;
  /** Threshold the service is scheduled against (hours/miles/date ISO). */
  threshold: number | string | null;
  /** Remaining units (hours, miles, or days). Negative = overdue. */
  remaining: number | null;
  /** 0-1 progress toward next threshold (only meaningful for usage triggers). */
  progress: number | null;
}

type ScheduleRaw = {
  baseline_hours?: number;
  baseline_miles?: number;
  threshold_hours?: number;
  threshold_miles?: number;
};

/** Parse a usage-based recurrence string `custom:<interval>:hours|miles`. */
export function parseUsageRecurrence(
  recurrence: string | null,
): { interval: number; unit: "hours" | "miles" } | null {
  if (!recurrence || !recurrence.startsWith("custom:")) return null;
  const [intervalStr, unit] = recurrence.replace("custom:", "").split(":");
  if (unit !== "hours" && unit !== "miles") return null;
  const interval = parseInt(intervalStr, 10);
  if (!Number.isFinite(interval) || interval <= 0) return null;
  return { interval, unit };
}

/** Read baseline + threshold persisted on the schedule's `raw` jsonb blob. */
function readRaw(schedule: ServiceSchedule): ScheduleRaw {
  const raw = (schedule as unknown as { raw?: ScheduleRaw }).raw;
  return raw && typeof raw === "object" ? raw : {};
}

/** Compute the next threshold for a usage-based schedule, given a baseline. */
export function nextUsageThreshold(baseline: number, interval: number): number {
  return Math.max(0, baseline) + interval;
}

function statusFromRemaining(remaining: number, interval: number): ReminderStatus {
  if (remaining < 0) return "overdue";
  if (remaining === 0) return "due";
  // "soon" when within 10% of the interval window.
  if (remaining <= Math.max(1, interval * 0.1)) return "soon";
  return "ok";
}

/** Compute the next reminder for a schedule, given the live asset state. */
export function computeReminder(
  schedule: ServiceSchedule,
  asset: Asset | undefined,
): Reminder {
  const usage = parseUsageRecurrence(schedule.recurrence);

  if (usage) {
    const raw = readRaw(schedule);
    const baseline =
      usage.unit === "hours"
        ? raw.baseline_hours ?? 0
        : raw.baseline_miles ?? 0;
    const persistedThreshold =
      usage.unit === "hours" ? raw.threshold_hours : raw.threshold_miles;
    const threshold = persistedThreshold ?? nextUsageThreshold(baseline, usage.interval);

    const current =
      usage.unit === "hours" ? asset?.current_hours ?? null : asset?.current_miles ?? null;

    if (current == null) {
      const unitLabel = usage.unit === "hours" ? "operating hours" : "miles";
      return {
        kind: usage.unit,
        status: "unknown",
        label: `Next service at ${threshold.toLocaleString()} ${unitLabel} (no current reading)`,
        threshold,
        remaining: null,
        progress: null,
      };
    }

    const remaining = threshold - current;
    const status = statusFromRemaining(remaining, usage.interval);
    const unitLabel = usage.unit === "hours" ? "hours" : "miles";
    const label =
      remaining < 0
        ? `Overdue by ${Math.abs(remaining).toLocaleString()} ${unitLabel}`
        : remaining === 0
          ? `Due now at ${threshold.toLocaleString()} ${unitLabel}`
          : `Due in ${remaining.toLocaleString()} ${unitLabel} (at ${threshold.toLocaleString()})`;
    const consumed = Math.max(0, current - baseline);
    const progress = Math.min(1, Math.max(0, consumed / usage.interval));
    return { kind: usage.unit, status, label, threshold, remaining, progress };
  }

  // Date-based fallback.
  if (!schedule.scheduled_date) {
    return {
      kind: "date",
      status: "unknown",
      label: "No date scheduled",
      threshold: null,
      remaining: null,
      progress: null,
    };
  }
  const due = new Date(schedule.scheduled_date);
  const now = new Date();
  const days = Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const status: ReminderStatus =
    days < 0 ? "overdue" : days === 0 ? "due" : days <= 3 ? "soon" : "ok";
  const label =
    days < 0
      ? `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`
      : days === 0
        ? "Due today"
        : `Due in ${days} day${days === 1 ? "" : "s"}`;
  return {
    kind: "date",
    status,
    label,
    threshold: schedule.scheduled_date,
    remaining: days,
    progress: null,
  };
}

/** Build the `raw` payload that anchors a usage-based reminder to today's asset reading. */
export function buildUsageBaselineRaw(
  trigger: string,
  interval: number,
  asset: Asset | undefined,
  existingRaw: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const next = { ...(existingRaw ?? {}) } as Record<string, unknown>;
  if (trigger === "hours") {
    const baseline = asset?.current_hours ?? 0;
    next.baseline_hours = baseline;
    next.threshold_hours = nextUsageThreshold(baseline, interval);
  } else if (trigger === "miles") {
    const baseline = asset?.current_miles ?? 0;
    next.baseline_miles = baseline;
    next.threshold_miles = nextUsageThreshold(baseline, interval);
  }
  return next;
}
