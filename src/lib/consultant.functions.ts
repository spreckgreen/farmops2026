// Context-aware farm consultant. One-shot chat: client sends full history +
// the current area label; server assembles a compact whole-farm snapshot
// from the authenticated user's tables and answers with generateText.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
});

const Input = z.object({
  area: z.string().trim().max(64),
  path: z.string().trim().max(256).optional(),
  messages: z.array(MessageSchema).min(1).max(40),
});

export interface ConsultantReply {
  text: string;
  model: string;
  latencyMs: number;
  snapshotChars: number;
  /** Present when the reply looks cut off or the context window was strained. */
  truncation: import("./ai-truncation").TruncationSignal | null;
}

const AREA_GUIDANCE: Record<string, string> = {
  food:
    "You are the FOOD advisor. Prioritize planting/harvest timing, preservation safety (never recommend water-bath canning for low-acid crops), pantry burn-down, and food plan progress. Point users to /food/preserve, /food/crops, /food/plan.",
  maintenance:
    "You are the MAINTENANCE advisor. Prioritize service intervals by hours/miles, upcoming/overdue tasks, and matching symptoms to existing procedures. Point users to /maintenance/forecast, /maintenance/diagnose, and specific procedures.",
  irrigation:
    "You are the IRRIGATION & WEATHER advisor. Use the current forecast and recent Rachio runs. Recommend deferring or extending runs when rain is forecast. Point users to /irrigation and /weather.",
  inventory:
    "You are the INVENTORY & PROCEDURES advisor. Focus on stock levels vs min quantities, reorder priorities, and connecting inventory items or maintenance plans to the right procedure. Point users to /inventory and /procedures.",
  general:
    "You are the general farm advisor. Cover any area the user asks about using the snapshot data.",
};

function areaKey(area: string): keyof typeof AREA_GUIDANCE {
  const a = area.toLowerCase();
  if (a.startsWith("food")) return "food";
  if (a.startsWith("maint")) return "maintenance";
  if (a.startsWith("irrig") || a.startsWith("weather")) return "irrigation";
  if (a.startsWith("inv") || a.startsWith("proc")) return "inventory";
  return "general";
}

function fmt(n: unknown, unit = ""): string {
  if (n == null) return "?";
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return String(n);
  return `${Math.round(v * 10) / 10}${unit}`;
}

export const askConsultant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<ConsultantReply> => {
    const { supabase, userId } = context;
    const started = Date.now();

    const [
      invR,
      procsR,
      plantingsR,
      harvestsR,
      pantryR,
      priceHistR,
      mainteR,
      usageR,
      tasksR,
      forecastR,
      dailyNoteR,
      rachZonesR,
      rachRunsR,
      livestockR,
      treesR,
      plotsR,
    ] = await Promise.all([
      supabase
        .from("inventory_items")
        .select("id,name,sku,category,quantity,unit,min_quantity,status,current_hours,current_miles")
        .eq("user_id", userId)
        .limit(120),
      supabase.from("procedures").select("id,name").eq("user_id", userId).limit(80),
      supabase
        .from("crop_plantings")
        .select("id,crop,variety,status,planted_on,expected_harvest,area")
        .eq("user_id", userId)
        .order("planted_on", { ascending: false })
        .limit(40),
      supabase
        .from("crop_harvests")
        .select("planting_id,quantity,unit,harvested_on,quality")
        .eq("user_id", userId)
        .order("harvested_on", { ascending: false })
        .limit(20),
      supabase
        .from("food_storage_items")
        .select("name,quantity,unit,best_by,location,category,status")
        .eq("user_id", userId)
        .order("best_by", { ascending: true, nullsFirst: false })
        .limit(60),
      supabase
        .from("food_price_history")
        .select("food_name,new_price,changed_at")
        .eq("user_id", userId)
        .order("changed_at", { ascending: false })
        .limit(10),
      supabase
        .from("maintenance_records")
        .select("title,service_type,performed_at,due_at,status,asset_name")
        .eq("user_id", userId)
        .order("performed_at", { ascending: false, nullsFirst: false })
        .limit(20),
      supabase
        .from("asset_usage_snapshots")
        .select("inventory_item_id,hours,miles,recorded_at")
        .eq("user_id", userId)
        .order("recorded_at", { ascending: false })
        .limit(20),
      supabase
        .from("tasks")
        .select("title,status,start_at,recurrence,percent_complete")
        .eq("user_id", userId)
        .order("start_at", { ascending: true, nullsFirst: false })
        .limit(20),
      supabase
        .from("weather_forecasts")
        .select("forecast_date,conditions,high_temp_f,low_temp_f,precip_probability,precip_type")
        .eq("user_id", userId)
        .order("forecast_date", { ascending: false })
        .limit(7),
      supabase
        .from("daily_notes")
        .select("date,markdown_content")
        .eq("user_id", userId)
        .order("date", { ascending: false })
        .limit(1),
      supabase.from("rachio_zones").select("id,name,rachio_id").eq("user_id", userId).limit(30),
      supabase
        .from("rachio_runs")
        .select("zone_id,started_at,duration_seconds,source,gallons")
        .eq("user_id", userId)
        .order("started_at", { ascending: false })
        .limit(15),
      supabase
        .from("livestock_animals")
        .select("species,breed,tag,quantity,status")
        .eq("user_id", userId)
        .limit(30),
      supabase
        .from("orchard_trees")
        .select("species,variety,status,quantity")
        .eq("user_id", userId)
        .limit(30),
      supabase
        .from("garden_plots")
        .select("row_label,position,plant_name")
        .eq("user_id", userId)
        .limit(40),
    ]);

    const inventory = invR.data ?? [];
    const lowStock = inventory.filter(
      (i) =>
        i.min_quantity != null &&
        Number(i.quantity ?? 0) <= Number(i.min_quantity ?? 0),
    );

    const sections: string[] = [];

    if (inventory.length) {
      sections.push(
        `INVENTORY (${inventory.length} items, ${lowStock.length} at/below min):\n` +
          inventory
            .slice(0, 40)
            .map(
              (i) =>
                `- ${i.name ?? i.sku ?? "?"} [${i.category ?? "n/a"}] ${fmt(i.quantity)}${i.unit ? " " + i.unit : ""}` +
                (i.min_quantity != null ? ` (min ${i.min_quantity})` : "") +
                (i.current_hours ? ` ${fmt(i.current_hours)}h` : "") +
                (i.current_miles ? ` ${fmt(i.current_miles)}mi` : "") +
                ` [${i.status ?? "?"}]`,
            )
            .join("\n"),
      );
    }
    if (procsR.data?.length) {
      sections.push(
        `PROCEDURES (${procsR.data.length}):\n` +
          procsR.data.slice(0, 40).map((p) => `- ${p.name}`).join("\n"),
      );
    }

    const plantings = plantingsR.data ?? [];
    if (plantings.length) {
      sections.push(
        `RECENT PLANTINGS:\n` +
          plantings
            .slice(0, 20)
            .map(
              (p) =>
                `- ${p.crop}${p.variety ? " (" + p.variety + ")" : ""} planted ${p.planted_on ?? "?"} exp ${p.expected_harvest ?? "?"} [${p.status ?? "?"}]${p.area ? " area=" + p.area : ""}`,
            )
            .join("\n"),
      );
    }
    if (harvestsR.data?.length) {
      const plantById = new Map(plantings.map((p) => [p.id, p]));
      sections.push(
        `RECENT HARVESTS:\n` +
          harvestsR.data
            .map((h) => {
              const p = h.planting_id ? plantById.get(h.planting_id) : null;
              const label = p ? `${p.crop}${p.variety ? " (" + p.variety + ")" : ""}` : "harvest";
              return `- ${h.harvested_on ?? "?"} ${label} ${fmt(h.quantity)} ${h.unit ?? ""}${h.quality ? " [" + h.quality + "]" : ""}`;
            })
            .join("\n"),
      );
    }
    if (pantryR.data?.length) {
      sections.push(
        `PANTRY / STORAGE (soonest best-by first):\n` +
          pantryR.data
            .slice(0, 30)
            .map(
              (p) =>
                `- ${p.name} ${fmt(p.quantity)} ${p.unit ?? ""}${p.best_by ? " best-by " + p.best_by : ""}${p.location ? " @" + p.location : ""} [${p.status ?? "?"}]`,
            )
            .join("\n"),
      );
    }
    if (mainteR.data?.length) {
      sections.push(
        `RECENT / DUE MAINTENANCE:\n` +
          mainteR.data
            .map(
              (m) =>
                `- ${m.title ?? "?"} [${m.service_type ?? "?"}]${m.asset_name ? " on " + m.asset_name : ""} performed=${m.performed_at?.slice(0, 10) ?? "-"} due=${m.due_at?.slice(0, 10) ?? "-"} [${m.status ?? "?"}]`,
            )
            .join("\n"),
      );
    }
    if (usageR.data?.length) {
      const invById = new Map(inventory.map((i) => [i.id, i.name ?? i.sku ?? i.id]));
      sections.push(
        `RECENT USAGE SNAPSHOTS:\n` +
          usageR.data
            .slice(0, 15)
            .map(
              (u) =>
                `- ${u.recorded_at?.slice(0, 10)} ${invById.get(u.inventory_item_id) ?? u.inventory_item_id}: ${u.hours ? u.hours + "h " : ""}${u.miles ? u.miles + "mi" : ""}`,
            )
            .join("\n"),
      );
    }
    if (tasksR.data?.length) {
      sections.push(
        `TASKS:\n` +
          tasksR.data
            .map(
              (t) =>
                `- [${t.status}] ${t.title} start=${t.start_at?.slice(0, 10) ?? "-"} ${t.percent_complete ?? 0}%${t.recurrence && t.recurrence !== "none" ? " (" + t.recurrence + ")" : ""}`,
            )
            .join("\n"),
      );
    }
    if (forecastR.data?.length) {
      sections.push(
        `WEATHER FORECAST (last ${forecastR.data.length} days):\n` +
          forecastR.data
            .map(
              (f) =>
                `- ${f.forecast_date}: ${f.conditions ?? ""} hi=${fmt(f.high_temp_f)}F lo=${fmt(f.low_temp_f)}F precip=${fmt(f.precip_probability)}%${f.precip_type ? " " + f.precip_type : ""}`,
            )
            .join("\n"),
      );
    }
    if (rachRunsR.data?.length) {
      const zoneById = new Map((rachZonesR.data ?? []).map((z) => [z.id, z.name ?? z.rachio_id]));
      sections.push(
        `RECENT IRRIGATION RUNS:\n` +
          rachRunsR.data
            .map(
              (r) =>
                `- ${r.started_at?.slice(0, 16) ?? "?"} ${zoneById.get(r.zone_id) ?? r.zone_id}: ${Math.round((r.duration_seconds ?? 0) / 60)}min${r.gallons ? " " + fmt(r.gallons) + "gal" : ""} (${r.source ?? "?"})`,
            )
            .join("\n"),
      );
    }
    if (livestockR.data?.length) {
      sections.push(
        `LIVESTOCK:\n` +
          livestockR.data
            .map(
              (a) =>
                `- ${a.species}${a.breed ? " (" + a.breed + ")" : ""}${a.tag ? " #" + a.tag : ""} qty=${a.quantity} [${a.status ?? "?"}]`,
            )
            .join("\n"),
      );
    }
    if (treesR.data?.length) {
      sections.push(
        `ORCHARD:\n` +
          treesR.data
            .map((t) => `- ${t.species}${t.variety ? " (" + t.variety + ")" : ""} qty=${t.quantity} [${t.status ?? "?"}]`)
            .join("\n"),
      );
    }
    if (plotsR.data?.length) {
      sections.push(
        `GARDEN PLOTS:\n` +
          plotsR.data
            .map((p) => `- ${p.row_label}#${p.position}${p.plant_name ? " → " + p.plant_name : ""}`)
            .join("\n"),
      );
    }
    if (priceHistR.data?.length) {
      sections.push(
        `RECENT FOOD PRICE CHANGES:\n` +
          priceHistR.data
            .map((p) => `- ${p.food_name}: ${fmt(p.new_price)} on ${p.changed_at?.slice(0, 10)}`)
            .join("\n"),
      );
    }
    if (dailyNoteR.data?.[0]) {
      const dn = dailyNoteR.data[0];
      sections.push(
        `TODAY'S NOTE (${dn.date}):\n${String(dn.markdown_content ?? "").slice(0, 800)}`,
      );
    }

    const snapshot = sections.join("\n\n");
    const key = areaKey(data.area);
    const areaSystem = AREA_GUIDANCE[key];

    const system =
      `You are the Bostead Farms consultant, an AI advisor embedded in the FarmOps application. ` +
      `${areaSystem} ` +
      `Ground every recommendation in the FARM SNAPSHOT below. If the snapshot lacks the answer, say so and suggest where in the app to record it. ` +
      `Keep replies under ~180 words unless the user asks for detail. Use short markdown lists when helpful. ` +
      `Never invent inventory items, procedures, or maintenance history that aren't in the snapshot. ` +
      `Current area: ${key}${data.path ? ` (path ${data.path})` : ""}.\n\n` +
      `FARM SNAPSHOT:\n${snapshot || "(no data yet — snapshot is empty)"}`;

    const { createAiProvider } = await import("./ai-gateway.server");
    const { provider, modelOverride } = await createAiProvider();
    const modelId = modelOverride ?? "google/gemini-3.6-flash";

    const { generateText } = await import("ai");
    const messages = data.messages.map((m) => ({ role: m.role, content: m.content }));
    const result = await generateText({ model: provider(modelId), system, messages });
    const text = result.text;

    // The farm snapshot plus chat history is the biggest input in the app, so
    // say plainly when it overflowed rather than letting the model answer from
    // a silently trimmed snapshot.
    const { getActiveContextLimit } = await import("./ai-context-limit.server");
    const { truncationOrNull } = await import("./ai-truncation");
    const { contextLength } = await getActiveContextLimit(modelId);
    const truncation = truncationOrNull({
      finishReason: result.finishReason,
      usage: result.usage,
      promptChars:
        system.length + messages.reduce((n, m) => n + m.content.length, 0),
      outputText: text,
      contextLimit: contextLength,
      model: modelId,
    });

    return {
      text: text.trim(),
      model: modelId,
      latencyMs: Date.now() - started,
      snapshotChars: snapshot.length,
      truncation,
    };
  });

