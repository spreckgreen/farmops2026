// Pure math for maintenance forecasting.
// Deterministic: given usage history and past maintenance records,
// project the next due date per (asset, service_type).
// The AI overlay lives in maintenance-forecast.functions.ts and consumes
// the shape returned here.

export type UsageBasis = "hours" | "miles" | "date";

export interface AssetHistoryInput {
  itemId: string;
  itemName: string;
  usageTracking: string; // "hours" | "miles" | "none"
  currentHours: number;
  currentMiles: number;
  snapshots: { recorded_at: string; hours: number | null; miles: number | null }[];
  records: {
    id: string;
    service_type: string | null;
    performed_at: string | null; // YYYY-MM-DD
    raw_hours?: number | null;
    raw_miles?: number | null;
  }[];
}

export interface DueItem {
  serviceType: string;
  basis: UsageBasis;
  intervalValue: number | null; // avg interval (hours/miles/days)
  lastPerformedAt: string | null;
  lastPerformedValue: number | null;
  dueValue: number | null;
  dueDate: string | null; // ISO date
  daysOut: number | null;
  overdue: boolean;
  reason: string;
}

export interface AssetForecast {
  itemId: string;
  itemName: string;
  usageTracking: string;
  currentHours: number;
  currentMiles: number;
  usageRatePerDay: number | null; // hours/day or miles/day
  dueItems: DueItem[];
  note?: string;
}

const MS_PER_DAY = 86_400_000;

function daysBetween(a: string, b: string): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.max(0, (db - da) / MS_PER_DAY);
}

/** Estimate usage/day from the last ~90 days of snapshots. */
export function estimateUsageRate(
  snapshots: AssetHistoryInput["snapshots"],
  field: "hours" | "miles",
): number | null {
  const filtered = snapshots
    .filter((s) => s[field] != null)
    .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  if (filtered.length < 2) return null;
  const last = filtered[filtered.length - 1];
  // Walk back up to 90 days
  const cutoff = new Date(new Date(last.recorded_at).getTime() - 90 * MS_PER_DAY).toISOString();
  const window = filtered.filter((s) => s.recorded_at >= cutoff);
  const first = window[0];
  if (!first || first.recorded_at === last.recorded_at) return null;
  const days = daysBetween(first.recorded_at, last.recorded_at);
  if (days <= 0) return null;
  const delta = (last[field] as number) - (first[field] as number);
  if (delta <= 0) return 0;
  return delta / days;
}

/** Average interval between successive completed records of the same service_type. */
function averageInterval(
  records: AssetHistoryInput["records"],
  serviceType: string,
  basis: UsageBasis,
): { avg: number | null; last: (typeof records)[number] | null } {
  const matching = records
    .filter(
      (r) =>
        (r.service_type ?? "").toLowerCase() === serviceType.toLowerCase() &&
        r.performed_at,
    )
    .sort((a, b) => (a.performed_at ?? "").localeCompare(b.performed_at ?? ""));
  if (matching.length === 0) return { avg: null, last: null };
  const last = matching[matching.length - 1];
  if (matching.length === 1) return { avg: null, last };
  const deltas: number[] = [];
  for (let i = 1; i < matching.length; i++) {
    const a = matching[i - 1];
    const b = matching[i];
    if (basis === "date" && a.performed_at && b.performed_at) {
      deltas.push(daysBetween(a.performed_at, b.performed_at));
    } else if (basis === "hours" && a.raw_hours != null && b.raw_hours != null) {
      deltas.push(b.raw_hours - a.raw_hours);
    } else if (basis === "miles" && a.raw_miles != null && b.raw_miles != null) {
      deltas.push(b.raw_miles - a.raw_miles);
    }
  }
  const valid = deltas.filter((d) => d > 0);
  if (valid.length === 0) return { avg: null, last };
  return { avg: valid.reduce((s, d) => s + d, 0) / valid.length, last };
}

export function forecastAsset(input: AssetHistoryInput): AssetForecast {
  const track = (input.usageTracking ?? "").toLowerCase();
  const field: "hours" | "miles" | null =
    track === "hours" ? "hours" : track === "miles" ? "miles" : null;
  const basis: UsageBasis = field ?? "date";

  const rate =
    field == null ? null : estimateUsageRate(input.snapshots, field);

  // Unique service types from records
  const services = Array.from(
    new Set(
      input.records
        .map((r) => (r.service_type ?? "").trim())
        .filter((s) => s.length > 0),
    ),
  );

  const dueItems: DueItem[] = services.map((serviceType) => {
    const { avg, last } = averageInterval(input.records, serviceType, basis);

    let dueValue: number | null = null;
    let dueDate: string | null = null;
    let daysOut: number | null = null;
    let overdue = false;
    let reason = "";
    let lastValue: number | null = null;

    if (basis === "hours" && field === "hours" && last?.raw_hours != null) {
      lastValue = last.raw_hours;
      if (avg != null) {
        dueValue = last.raw_hours + avg;
        const hoursRemaining = dueValue - input.currentHours;
        if (rate && rate > 0) {
          daysOut = Math.round(hoursRemaining / rate);
          dueDate = new Date(Date.now() + daysOut * MS_PER_DAY)
            .toISOString()
            .slice(0, 10);
        }
        overdue = input.currentHours >= dueValue;
        reason = `avg every ${avg.toFixed(0)} hrs; last at ${last.raw_hours} hrs`;
      } else {
        reason = "only one prior service — need 2+ to compute interval";
      }
    } else if (basis === "miles" && field === "miles" && last?.raw_miles != null) {
      lastValue = last.raw_miles;
      if (avg != null) {
        dueValue = last.raw_miles + avg;
        const milesRemaining = dueValue - input.currentMiles;
        if (rate && rate > 0) {
          daysOut = Math.round(milesRemaining / rate);
          dueDate = new Date(Date.now() + daysOut * MS_PER_DAY)
            .toISOString()
            .slice(0, 10);
        }
        overdue = input.currentMiles >= dueValue;
        reason = `avg every ${avg.toFixed(0)} mi; last at ${last.raw_miles} mi`;
      } else {
        reason = "only one prior service — need 2+ to compute interval";
      }
    } else if (last?.performed_at) {
      if (avg != null) {
        const nextDate = new Date(
          new Date(last.performed_at).getTime() + avg * MS_PER_DAY,
        );
        dueDate = nextDate.toISOString().slice(0, 10);
        daysOut = Math.round((nextDate.getTime() - Date.now()) / MS_PER_DAY);
        overdue = daysOut < 0;
        reason = `avg every ${avg.toFixed(0)} days; last on ${last.performed_at}`;
      } else {
        reason = "only one prior service — need 2+ to compute interval";
      }
    } else {
      reason = "no prior service records";
    }

    return {
      serviceType,
      basis,
      intervalValue: avg,
      lastPerformedAt: last?.performed_at ?? null,
      lastPerformedValue: lastValue,
      dueValue,
      dueDate,
      daysOut,
      overdue,
      reason,
    };
  });

  const note =
    services.length === 0
      ? "No maintenance history yet — log 2+ completed services to enable forecasting."
      : rate == null && field != null
        ? `No usage rate yet — record ${field} readings over time to project dates.`
        : undefined;

  return {
    itemId: input.itemId,
    itemName: input.itemName,
    usageTracking: input.usageTracking,
    currentHours: input.currentHours,
    currentMiles: input.currentMiles,
    usageRatePerDay: rate,
    dueItems: dueItems.sort((a, b) => {
      const av = a.daysOut ?? 99999;
      const bv = b.daysOut ?? 99999;
      return av - bv;
    }),
    note,
  };
}

export function bucketByHorizon(forecasts: AssetForecast[]): {
  h30: { asset: AssetForecast; item: DueItem }[];
  h60: { asset: AssetForecast; item: DueItem }[];
  h90: { asset: AssetForecast; item: DueItem }[];
  later: { asset: AssetForecast; item: DueItem }[];
  overdue: { asset: AssetForecast; item: DueItem }[];
} {
  const h30: { asset: AssetForecast; item: DueItem }[] = [];
  const h60: { asset: AssetForecast; item: DueItem }[] = [];
  const h90: { asset: AssetForecast; item: DueItem }[] = [];
  const later: { asset: AssetForecast; item: DueItem }[] = [];
  const overdue: { asset: AssetForecast; item: DueItem }[] = [];
  for (const asset of forecasts) {
    for (const item of asset.dueItems) {
      const pair = { asset, item };
      if (item.overdue) overdue.push(pair);
      else if (item.daysOut == null) later.push(pair);
      else if (item.daysOut <= 30) h30.push(pair);
      else if (item.daysOut <= 60) h60.push(pair);
      else if (item.daysOut <= 90) h90.push(pair);
      else later.push(pair);
    }
  }
  return { h30, h60, h90, later, overdue };
}
