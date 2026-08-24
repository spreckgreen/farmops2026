// Maintenance forecaster — deterministic projection + optional AI narrative.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  forecastAsset,
  bucketByHorizon,
  type AssetForecast,
  type AssetHistoryInput,
} from "./maintenance-forecast.server";

/**
 * An asset that tracks hours/miles but doesn't have enough usage readings for
 * the forecaster to compute a usage rate (needs 2+ snapshots at different times).
 */
export interface UsageGap {
  itemId: string;
  itemName: string;
  usageTracking: string;
  snapshotCount: number;
  /** A maintenance record for this asset, so the edit dialog can be opened. */
  recordId: string | null;
}

export interface ForecastResponse {
  assets: AssetForecast[];
  /** Assets missing usage snapshots — drives the forecast page empty-state. */
  usageGaps: UsageGap[];
  buckets: ReturnType<typeof bucketByHorizon>;
  narrative: string | null;
  model: string | null;
}

export interface ForecastNarrative {
  /** Set when a local model failed/truncated and hosted AI was used instead. */
  escalation?: import("./ai-feature-areas").AiEscalation | null;
  narrative: string;
  model: string;
  /** Present when the briefing looks cut off or the context window was strained. */
  truncation: import("./ai-truncation").TruncationSignal | null;
}


/** Deterministic forecast, no AI. Fast, safe to call on load. */
export const getMaintenanceForecast = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ForecastResponse> => {
    const { supabase, userId } = context;

    // Pull inventory items that track usage OR that have any maintenance history.
    const { data: items, error: itemsErr } = await supabase
      .from("inventory_items")
      .select(
        "id, name, sku, usage_tracking, current_hours, current_miles",
      )
      .eq("user_id", userId);
    if (itemsErr) throw new Error(itemsErr.message);

    const itemIds = (items ?? []).map((i) => i.id);
    if (itemIds.length === 0) {
      return {
        assets: [],
        usageGaps: [],
        buckets: { h30: [], h60: [], h90: [], later: [], overdue: [] },
        narrative: null,
        model: null,
      };
    }

    // Snapshots per item
    const { data: snapshots, error: snapErr } = await supabase
      .from("asset_usage_snapshots")
      .select("inventory_item_id, recorded_at, hours, miles")
      .eq("user_id", userId)
      .in("inventory_item_id", itemIds)
      .order("recorded_at", { ascending: true });
    if (snapErr) throw new Error(snapErr.message);

    // Maintenance records linked to those assets (by asset_id OR name match)
    const { data: records, error: recErr } = await supabase
      .from("maintenance_records")
      .select("id, asset_id, asset_name, service_type, performed_at, raw")
      .eq("user_id", userId)
      .not("performed_at", "is", null);
    if (recErr) throw new Error(recErr.message);

    const snapByItem = new Map<string, AssetHistoryInput["snapshots"]>();
    for (const s of snapshots ?? []) {
      const list = snapByItem.get(s.inventory_item_id) ?? [];
      list.push({
        recorded_at: s.recorded_at,
        hours: s.hours == null ? null : Number(s.hours),
        miles: s.miles == null ? null : Number(s.miles),
      });
      snapByItem.set(s.inventory_item_id, list);
    }

    const nameToId = new Map<string, string>();
    for (const i of items ?? []) {
      if (i.name) nameToId.set(i.name.toLowerCase(), i.id);
    }

    const recByItem = new Map<string, AssetHistoryInput["records"]>();
    for (const r of records ?? []) {
      let itemId = r.asset_id ?? null;
      if (!itemId && r.asset_name) {
        itemId = nameToId.get(r.asset_name.toLowerCase()) ?? null;
      }
      if (!itemId) continue;
      const raw = (r.raw ?? {}) as Record<string, unknown>;
      const rawHours =
        typeof raw.current_hours === "number"
          ? raw.current_hours
          : typeof raw.hours === "number"
            ? raw.hours
            : null;
      const rawMiles =
        typeof raw.current_miles === "number"
          ? raw.current_miles
          : typeof raw.miles === "number"
            ? raw.miles
            : null;
      const list = recByItem.get(itemId) ?? [];
      list.push({
        id: r.id,
        service_type: r.service_type,
        performed_at: r.performed_at,
        raw_hours: rawHours,
        raw_miles: rawMiles,
      });
      recByItem.set(itemId, list);
    }

    const forecasts: AssetForecast[] = (items ?? [])
      .filter(
        (i) =>
          (i.usage_tracking && i.usage_tracking !== "none") ||
          recByItem.has(i.id),
      )
      .map((i) =>
        forecastAsset({
          itemId: i.id,
          itemName: i.name ?? i.sku ?? "Unnamed asset",
          usageTracking: i.usage_tracking ?? "none",
          currentHours: Number(i.current_hours ?? 0),
          currentMiles: Number(i.current_miles ?? 0),
          snapshots: snapByItem.get(i.id) ?? [],
          records: recByItem.get(i.id) ?? [],
        }),
      );

    // Which usage-tracked assets can't be projected because they lack readings?
    const usageGaps: UsageGap[] = (items ?? [])
      .filter((i) => {
        const track = (i.usage_tracking ?? "none").toLowerCase();
        if (track !== "hours" && track !== "miles") return false;
        const snaps = snapByItem.get(i.id) ?? [];
        const field = track === "hours" ? "hours" : "miles";
        const withValue = snaps.filter((s) => s[field] != null);
        return withValue.length < 2;
      })
      .map((i) => ({
        itemId: i.id,
        itemName: i.name ?? i.sku ?? "Unnamed asset",
        usageTracking: (i.usage_tracking ?? "none").toLowerCase(),
        snapshotCount: (snapByItem.get(i.id) ?? []).filter(
          (s) => s[(i.usage_tracking ?? "").toLowerCase() === "miles" ? "miles" : "hours"] != null,
        ).length,
        recordId: recByItem.get(i.id)?.[0]?.id ?? null,
      }));

    const buckets = bucketByHorizon(forecasts);
    return { assets: forecasts, usageGaps, buckets, narrative: null, model: null };
  });

const NarrativeInput = z.object({
  regenerate: z.boolean().optional(),
});

/** AI overlay — takes the deterministic forecast and asks the model to
 * prioritize and narrate it. The model can only reference computed items;
 * it never invents new services. */
export const getMaintenanceForecastNarrative = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => NarrativeInput.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<ForecastNarrative> => {
    const { supabase, userId } = context;
    const { withIdempotency } = await import("./ai-idempotency.server");
    return withIdempotency(
      { supabase, userId, surface: "maintenance.forecast_narrative", input: data },
      async (): Promise<ForecastNarrative> => {
    // Recompute the forecast inline (cheap; keeps single source of truth).
    const forecast = await getMaintenanceForecast();

    if (forecast.assets.length === 0) {
      return {
        narrative:
          "No assets are tracking usage or maintenance history yet — nothing to forecast.",
        model: "",
        truncation: null,
      };
    }

    const summary = forecast.assets
      .filter((a) => a.dueItems.length > 0)
      .map((a) => {
        const lines = a.dueItems.map(
          (d) =>
            `  - ${d.serviceType}: ${
              d.dueDate ? `due ~${d.dueDate}` : "no projected date"
            }${d.overdue ? " (OVERDUE)" : d.daysOut != null ? ` (in ${d.daysOut}d)` : ""}; ${d.reason}`,
        );
        return `${a.itemName} [usage=${a.usageTracking}, rate=${
          a.usageRatePerDay != null ? a.usageRatePerDay.toFixed(2) : "n/a"
        }/day]\n${lines.join("\n")}`;
      })
      .join("\n\n");

    if (!summary.trim()) {
      return {
        narrative:
          "Assets are tracked but have no projected services yet — log at least two completed services per asset to enable forecasting.",
        model: "",
        truncation: null,
      };
    }

    const { resolveAreaAi, runAreaAi } = await import("./ai-routing.server");
    const ai = await resolveAreaAi("maintenance.forecast", {
      hostedDefaultModel: "google/gemini-3.6-flash",
      client: context.supabase,
    });

    const { generateText } = await import("ai");
    const system =
      "You are a maintenance planner for a small farm. Read the provided " +
      "computed forecast and produce a short, prioritized action briefing. " +
      "Rules: (1) Only reference services in the forecast — do not invent new ones. " +
      "(2) Call out anything OVERDUE first. (3) Group by asset. (4) Keep it under " +
      "200 words. (5) End with one 'parts to stage' line if any asset needs it. " +
      "Use plain prose with short bullets — no markdown headings.";
    const prompt = `Computed forecast:\n\n${summary}\n\nWrite the briefing.`;
    const run = await runAreaAi(
      ai,
      ({ provider, modelId }) => generateText({ model: provider(modelId), system, prompt }),
      { isTruncated: (r) => !r.text.trim() || r.finishReason === "length" },
    );
    const result = run.value;
    const modelId = run.modelId;
    const escalation = run.escalation;

    const { getActiveContextLimit } = await import("./ai-context-limit.server");
    const { truncationOrNull } = await import("./ai-truncation");
    const { contextLength } = await getActiveContextLimit(modelId);
    const truncation = truncationOrNull({
      finishReason: result.finishReason,
      usage: result.usage,
      promptChars: system.length + prompt.length,
      outputText: result.text,
      contextLimit: contextLength,
      model: modelId,
    });

    return { narrative: result.text.trim(), model: modelId, truncation, escalation };

      },
    );
  });
