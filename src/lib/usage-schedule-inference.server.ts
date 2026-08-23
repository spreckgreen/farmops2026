// Server-side backfill: give usage-based maintenance records a projected
// scheduled_date so they always render in date/calendar views.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServiceSchedule } from "@/types/scheduling";
import type { Asset } from "@/components/dashboard/types";
import { inferUsageScheduledDate, type UsageSnapshot } from "./usage-due-status";
import { parseUsageRecurrence } from "./maintenance-reminders";

export interface InferenceSummary {
  scanned: number;
  updated: number;
  measured: number;
  assumed: number;
  overdue: number;
  errors: string[];
}

/**
 * Fill scheduled_date for every open usage-based record that lacks one.
 * Example: "Hydraulic filter — every 100 hours" with no date gets
 * scheduled_date ≈ today + (remaining hours / hours-per-day).
 */
export async function backfillUsageScheduledDates(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<InferenceSummary> {
  const summary: InferenceSummary = {
    scanned: 0,
    updated: 0,
    measured: 0,
    assumed: 0,
    overdue: 0,
    errors: [],
  };

  const { data: records, error: recErr } = await supabase
    .from("maintenance_records")
    .select("id, asset_id, recurrence, scheduled_date, status, raw")
    .eq("user_id", userId)
    .is("scheduled_date", null);
  if (recErr) {
    summary.errors.push(recErr.message);
    return summary;
  }

  const candidates = (records ?? []).filter(
    (r) =>
      (r.status ?? "scheduled") !== "completed" &&
      parseUsageRecurrence(r.recurrence) != null,
  );
  summary.scanned = candidates.length;
  if (candidates.length === 0) return summary;

  const assetIds = [...new Set(candidates.map((r) => r.asset_id).filter(Boolean))] as string[];

  const [itemsRes, snapsRes] = await Promise.all([
    assetIds.length
      ? supabase
          .from("inventory_items")
          .select("id, name, current_hours, current_miles, usage_tracking")
          .in("id", assetIds)
      : Promise.resolve({ data: [], error: null } as const),
    assetIds.length
      ? supabase
          .from("asset_usage_snapshots")
          .select("inventory_item_id, recorded_at, hours, miles")
          .eq("user_id", userId)
          .in("inventory_item_id", assetIds)
          .order("recorded_at", { ascending: true })
      : Promise.resolve({ data: [], error: null } as const),
  ]);

  const assetById = new Map<string, Asset>();
  for (const i of itemsRes.data ?? []) assetById.set(i.id, i as unknown as Asset);

  const snapsByAsset = new Map<string, UsageSnapshot[]>();
  for (const s of snapsRes.data ?? []) {
    const list = snapsByAsset.get(s.inventory_item_id) ?? [];
    list.push({
      recorded_at: s.recorded_at,
      hours: s.hours == null ? null : Number(s.hours),
      miles: s.miles == null ? null : Number(s.miles),
    });
    snapsByAsset.set(s.inventory_item_id, list);
  }

  for (const r of candidates) {
    const asset = r.asset_id ? assetById.get(r.asset_id) : undefined;
    const inferred = inferUsageScheduledDate(
      r as unknown as ServiceSchedule,
      asset,
      (r.asset_id && snapsByAsset.get(r.asset_id)) || [],
      now,
    );
    if (!inferred) continue;

    const raw = (r.raw && typeof r.raw === "object" ? { ...(r.raw as object) } : {}) as Record<
      string,
      unknown
    >;
    raw["scheduled_date_inferred"] = true;
    raw["scheduled_date_source"] = inferred.source;
    raw["scheduled_date_rate_per_day"] = inferred.ratePerDay;
    raw["scheduled_date_inferred_at"] = now.toISOString();

    const { error } = await supabase
      .from("maintenance_records")
      .update({
        scheduled_date: inferred.iso,
        due_at: inferred.date,
        raw: raw as never,
      } as never)
      .eq("id", r.id);
    if (error) {
      summary.errors.push(`${r.id}: ${error.message}`);
      continue;
    }
    summary.updated += 1;
    if (inferred.source === "measured") summary.measured += 1;
    else if (inferred.source === "assumed") summary.assumed += 1;
    else summary.overdue += 1;
  }

  return summary;
}
