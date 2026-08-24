// Keeps "Maintenance plan" procedure pages in sync with maintenance_records.
//
// Called automatically whenever maintenance work is generated or edited in the
// maintenance tab, so a plan page always exists for the asset without the user
// having to run the backfill by hand. Best-effort: never throws, since the
// maintenance records themselves are the source of truth.
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildTinyWikiHtml } from "@/lib/tinywiki";
import { buildBackfilledPlanBody, type PlanRecord } from "@/lib/maintenance-plan-backfill";
import { maintenancePlanName } from "@/lib/maintenance-plan-name";

export interface PlanSyncResult {
  name: string;
  asset: string;
  records: number;
}

/**
 * Rebuild the plan page for each named asset from that asset's current
 * (not-yet-completed) maintenance records, and link it to the inventory item.
 */
export async function syncMaintenancePlanDocs(
  supabase: SupabaseClient,
  userId: string,
  assetNames: (string | null | undefined)[],
): Promise<PlanSyncResult[]> {
  const names = Array.from(
    new Set(assetNames.map((n) => (n ?? "").trim()).filter(Boolean)),
  );
  if (!names.length) return [];

  const out: PlanSyncResult[] = [];
  for (const asset of names) {
    try {
      const { data: rows, error } = await supabase
        .from("maintenance_records")
        .select(
          "asset_id, asset_name, title, service_type, recurrence, description, notes, due_at, scheduled_date, completed_date",
        )
        .eq("user_id", userId)
        .ilike("asset_name", asset);
      if (error) throw new Error(error.message);

      const records = ((rows ?? []) as (PlanRecord & {
        completed_date: string | null;
        asset_id: string | null;
      })[]).filter((r) => !r.completed_date);
      if (!records.length) continue;

      records.sort((a, b) =>
        String(a.title ?? "").localeCompare(String(b.title ?? ""), undefined, {
          numeric: true,
        }),
      );

      const name = maintenancePlanName(asset);
      const body = buildBackfilledPlanBody(name, asset, records);
      const saved = await supabase
        .from("procedures")
        .upsert(
          { user_id: userId, name, content: buildTinyWikiHtml(name, body) } as never,
          { onConflict: "user_id,name" },
        )
        .select("id")
        .single<{ id: string }>();
      if (saved.error) throw new Error(saved.error.message);

      const assetId = records.find((r) => r.asset_id)?.asset_id ?? null;
      if (assetId && saved.data?.id) {
        const dup = await supabase
          .from("procedure_links")
          .select("id")
          .eq("user_id", userId)
          .eq("procedure_id", saved.data.id)
          .eq("inventory_item_id", assetId)
          .maybeSingle();
        if (!dup.data) {
          await supabase.from("procedure_links").insert({
            user_id: userId,
            procedure_id: saved.data.id,
            inventory_item_id: assetId,
            notes: "Generated maintenance plan",
          } as never);
        }
      }

      out.push({ name, asset, records: records.length });
    } catch {
      // Ignore — plan documents are a convenience layer over the records.
    }
  }
  return out;
}
