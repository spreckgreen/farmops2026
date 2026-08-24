// Turns an applied maintenance ActionPlan into a procedure document of type
// "Maintenance plan", one page per asset, and links it to the inventory item.
//
// Server-only (writes via the caller's authenticated Supabase client).
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildTinyWikiHtml, extractBodyWiki } from "@/lib/tinywiki";
import { appendProcedureBody } from "@/lib/procedure-append";
import type { Action, ActionPlan, ActionResult } from "./types";

type Interval = Extract<Action, { type: "maintenance.create_interval" }>;

export interface PlanDocResult {
  name: string;
  asset_id: string | null;
  mode: "created" | "appended";
}

/** Page name for an asset's maintenance plan document. */
export function maintenancePlanName(assetName: string): string {
  const base = (assetName || "Asset").trim().replace(/[\/\\<>:"|?*]/g, "-");
  return `${base} — Maintenance plan`.slice(0, 120);
}

function esc(cell: string): string {
  return String(cell ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ");
}

/** Build the TinyWiki body for one asset's plan. Pure — unit-testable. */
export function buildMaintenancePlanBody(
  assetName: string,
  intervals: Interval[],
  meta: { summary: string; model: string; citations: string[]; date?: string },
): string {
  const day = meta.date ?? new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`! ${maintenancePlanName(assetName)}`, "");
  lines.push(`''Type:'' Maintenance plan`);
  lines.push(`''Asset:'' ${assetName}`);
  lines.push(`''Generated:'' ${day} (model: ${meta.model})`, "");
  if (meta.summary) lines.push(meta.summary, "");
  lines.push("!! Service intervals", "");
  lines.push("|!Service|!Interval|!Type|!First due|!Parts|");
  for (const a of intervals) {
    lines.push(
      `|${esc(a.title)}|every ${a.interval_value} ${a.trigger_type}|${esc(a.service_type)}|${
        esc(a.first_due_date ?? "—")
      }|${esc(a.parts.map((p) => `${p.name} ×${p.quantity}`).join(", ") || "—")}|`,
    );
  }
  lines.push("");
  lines.push("!! Task detail", "");
  for (const a of intervals) {
    lines.push(`!!! ${a.title}`, "");
    lines.push(`Interval: every ${a.interval_value} ${a.trigger_type}${a.recurrence ? ` (${a.recurrence})` : ""}`, "");
    if (a.description) lines.push(a.description.trim(), "");
    if (a.parts.length) {
      lines.push("Parts:");
      for (const p of a.parts) {
        lines.push(`* ${p.name} ×${p.quantity}${p.inventory_item_id ? " (in inventory)" : " (not in inventory)"}`);
      }
      lines.push("");
    }
    if (a.notes) lines.push(`//${a.notes.trim()}//`, "");
  }
  if (meta.citations.length) {
    lines.push("!! References", "");
    for (const c of meta.citations) lines.push(`* ${c}`);
    lines.push("");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

/**
 * Write one "Maintenance plan" procedure page per asset in the plan and link it
 * to the asset's inventory item. Never throws — document creation is a
 * convenience on top of the maintenance records that were already written.
 */
export async function saveMaintenancePlanDocs(
  supabase: SupabaseClient,
  userId: string,
  plan: ActionPlan,
  results: ActionResult[],
): Promise<PlanDocResult[]> {
  const intervals = plan.actions
    .map((a, i) => ({ a, ok: results[i]?.ok === true }))
    .filter((x) => x.ok && x.a.type === "maintenance.create_interval")
    .map((x) => x.a as Interval);
  if (!intervals.length) return [];

  const byAsset = new Map<string, Interval[]>();
  for (const a of intervals) {
    const key = a.asset_id ?? `name:${a.asset_name}`;
    byAsset.set(key, [...(byAsset.get(key) ?? []), a]);
  }

  const out: PlanDocResult[] = [];
  for (const list of byAsset.values()) {
    const first = list[0];
    const name = maintenancePlanName(first.asset_name);
    try {
      const addition = buildMaintenancePlanBody(first.asset_name, list, {
        summary: plan.summary,
        model: plan.model,
        citations: plan.citations,
      });

      const existing = await supabase
        .from("procedures")
        .select("id, content")
        .eq("user_id", userId)
        .eq("name", name)
        .maybeSingle();

      let body = addition;
      let mode: PlanDocResult["mode"] = "created";
      const prev = (existing.data as { content?: string } | null)?.content;
      if (prev) {
        const prevBody = extractBodyWiki(prev, name) || prev;
        // Drop the duplicated page title from the appended section.
        const section = addition.replace(/^!\s+.*\n+/, "");
        body = appendProcedureBody(prevBody, section, "Maintenance plan");
        mode = "appended";
      }

      const saved = await supabase
        .from("procedures")
        .upsert(
          { user_id: userId, name, content: buildTinyWikiHtml(name, body) } as never,
          { onConflict: "user_id,name" },
        )
        .select("id")
        .single<{ id: string }>();
      if (saved.error) throw new Error(saved.error.message);

      if (first.asset_id && saved.data?.id) {
        const dup = await supabase
          .from("procedure_links")
          .select("id")
          .eq("user_id", userId)
          .eq("procedure_id", saved.data.id)
          .eq("inventory_item_id", first.asset_id)
          .maybeSingle();
        if (!dup.data) {
          await supabase.from("procedure_links").insert({
            user_id: userId,
            procedure_id: saved.data.id,
            inventory_item_id: first.asset_id,
            notes: "Generated maintenance plan",
          } as never);
        }
      }

      out.push({ name, asset_id: first.asset_id, mode });
    } catch {
      // Ignore — records already saved; the document is best-effort.
    }
  }
  return out;
}
