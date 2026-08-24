// Backfill "Maintenance plan" procedure pages from maintenance records that
// were generated before plan documents existed.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildTinyWikiHtml } from "@/lib/tinywiki";
import {
  buildBackfilledPlanBody,
  type PlanRecord,
} from "@/lib/maintenance-plan-backfill";

export interface BackfillResult {
  pages: { name: string; asset: string; records: number }[];
  skipped: string[];
}

export const backfillMaintenancePlanDocs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d?: { overwrite?: boolean }) => ({ overwrite: d?.overwrite === true }))
  .handler(async ({ context, data }): Promise<BackfillResult> => {
    const { data: rows, error } = await context.supabase
      .from("maintenance_records")
      .select(
        "asset_id, asset_name, title, service_type, recurrence, description, notes, due_at, scheduled_date, completed_date",
      )
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);

    // Group scheduled/recurring work by asset name; ignore rows already done.
    const byAsset = new Map<string, PlanRecord[]>();
    for (const r of (rows ?? []) as (PlanRecord & { completed_date: string | null })[]) {
      const asset = (r.asset_name ?? "").trim();
      if (!asset) continue;
      if (r.completed_date) continue;
      byAsset.set(asset, [...(byAsset.get(asset) ?? []), r]);
    }

    const { maintenancePlanName } = await import("@/lib/maintenance-plan-name");
    const pages: BackfillResult["pages"] = [];
    const skipped: string[] = [];

    for (const [asset, records] of byAsset) {
      records.sort((a, b) =>
        String(a.title ?? "").localeCompare(String(b.title ?? ""), undefined, { numeric: true }),
      );
      const name = maintenancePlanName(asset);
      const existing = await context.supabase
        .from("procedures")
        .select("name")
        .eq("user_id", context.userId)
        .eq("name", name)
        .maybeSingle();
      if (existing.data && !data.overwrite) {
        skipped.push(name);
        continue;
      }
      const body = buildBackfilledPlanBody(name, asset, records);
      const html = buildTinyWikiHtml(name, body);
      const { error: upErr } = await context.supabase
        .from("procedures")
        .upsert(
          { user_id: context.userId, name, content: html },
          { onConflict: "user_id,name" },
        );
      if (upErr) throw new Error(upErr.message);
      pages.push({ name, asset, records: records.length });
    }

    return { pages, skipped };
  });
