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
}

const AREA_GUIDANCE: Record<string, string> = {
  food:
    "You are the FOOD advisor. Prioritize planting/harvest timing, preservation safety (never recommend water-bath canning for low-acid crops), pantry burn-down, and food plan progress. Point users toward /food/preserve, /food/crops, /food/plan when relevant.",
  maintenance:
    "You are the MAINTENANCE advisor. Prioritize service intervals by hours/miles, upcoming/overdue tasks, and matching symptoms to existing procedures. Point users to /maintenance/forecast, /maintenance/diagnose, and specific procedures.",
  irrigation:
    "You are the IRRIGATION & WEATHER advisor. Use the current Tempest/Open-Meteo forecast, recent Rachio runs, and soil conditions. Recommend deferring or extending runs when rain is forecast. Point users to /irrigation and /weather.",
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

    // Full farm snapshot: run every read in parallel, cap rows aggressively.
    const [
      inv,
      procs,
      plantings,
      harvests,
      pantry,
      priceHist,
      mainte,
      usage,
      tasks,
      forecast,
      dailyNote,
      rachZones,
      rachRuns,
      livestock,
      trees,
      plots,
    ] = await Promise.all([
      supabase
        .from("inventory_items")
        .select("id,name,category,quantity,unit,min_quantity,status,current_hours,current_miles")
        .eq("user_id", userId)
        .limit(120),
      supabase.from("procedures").select("id,name").eq("user_id", userId).limit(80),
      supabase
        .from("crop_plantings")
        .select("id,crop_name,variety,status,planted_at,expected_harvest_at,season_year")
        .eq("user_id", userId)
        .order("planted_at", { ascending: false })
        .limit(40),
      supabase
        .from("crop_harvests")
        .select("crop_name,variety,quantity,unit,harvested_at")
        .eq("user_id", userId)
        .order("harvested_at", { ascending: false })
        .limit(20),
      supabase
        .from("food_storage_items")
        .select("name,quantity,unit,best_by,storage_method,notes")
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
        .select("title,service_type,performed_at,due_at,status")
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
        .select("title,status,due_at,priority")
        .eq("user_id", userId)
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(20),
      supabase
        .from("weather_forecasts")
        .select("forecast_date,summary,temp_high,temp_low,precip_mm,precip_prob")
        .eq("user_id", userId)
        .order("forecast_date", { ascending: false })
        .limit(7),
      supabase
        .from("daily_notes")
        .select("note_date,content")
        .eq("user_id", userId)
        .order("note_date", { ascending: false })
        .limit(1),
      supabase.from("rachio_zones").select("id,name,controller_id").eq("user_id", userId).limit(30),
      supabase
        .from("rachio_runs")
        .select("zone_id,started_at,duration_seconds,source")
        .eq("user_id", userId)
        .order("started_at", { ascending: false })
        .limit(15),
      supabase.from("livestock_animals").select("species,name,status").eq("user_id", userId).limit(30),
      supabase.from("orchard_trees").select("species,variety,status").eq("user_id", userId).limit(30),
      supabase.from("garden_plots").select("name,size_sqft,notes").eq("user_id", userId).limit(20),
    ]);

    const inventory = inv.data ?? [];
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
                `- ${i.name} [${i.category ?? "n/a"}] ${fmt(i.quantity)}${i.unit ? " " + i.unit : ""}` +
                (i.min_quantity != null ? ` (min ${i.min_quantity})` : "") +
                (i.current_hours ? ` ${fmt(i.current_hours)}h` : "") +
                (i.current_miles ? ` ${fmt(i.current_miles)}mi` : "") +
                ` [${i.status ?? "?"}]`,
            )
            .join("\n"),
      );
    }
    if (procs.data?.length) {
      sections.push(
        `PROCEDURES (${procs.data.length}):\n` +
          procs.data.slice(0, 40).map((p) => `- ${p.name}`).join("\n"),
      );
    }
    if (plantings.data?.length) {
      sections.push(
        `RECENT PLANTINGS:\n` +
          plantings.data
            .slice(0, 20)
            .map(
              (p) =>
                `- ${p.crop_name}${p.variety ? " (" + p.variety + ")" : ""} planted ${p.planted_at ?? "?"} exp ${p.expected_harvest_at ?? "?"} [${p.status ?? "?"}] ${p.season_year ?? ""}`,
            )
            .join("\n"),
      );
    }
    if (harvests.data?.length) {
      sections.push(
        `RECENT HARVESTS:\n` +
          harvests.data
            .map(
              (h) =>
                `- ${h.harvested_at?.slice(0, 10) ?? "?"} ${h.crop_name}${h.variety ? " (" + h.variety + ")" : ""} ${fmt(h.quantity)} ${h.unit ?? ""}`,
            )
            .join("\n"),
      );
    }
    if (pantry.data?.length) {
      sections.push(
        `PANTRY / STORAGE (soonest best-by first):\n` +
          pantry.data
            .slice(0, 30)
            .map(
              (p) =>
                `- ${p.name} ${fmt(p.quantity)} ${p.unit ?? ""}${p.best_by ? " best-by " + p.best_by : ""}${p.storage_method ? " [" + p.storage_method + "]" : ""}`,
            )
            .join("\n"),
      );
    }
    if (mainte.data?.length) {
      sections.push(
        `RECENT / DUE MAINTENANCE:\n` +
          mainte.data
            .map(
              (m) =>
                `- ${m.title} [${m.service_type ?? "?"}] performed=${m.performed_at?.slice(0, 10) ?? "-"} due=${m.due_at?.slice(0, 10) ?? "-"} [${m.status ?? "?"}]`,
            )
            .join("\n"),
      );
    }
    if (usage.data?.length) {
      const invById = new Map(inventory.map((i) => [i.id, i.name]));
      sections.push(
        `RECENT USAGE SNAPSHOTS:\n` +
          usage.data
            .slice(0, 15)
            .map(
              (u) =>
                `- ${u.recorded_at?.slice(0, 10)} ${invById.get(u.inventory_item_id) ?? u.inventory_item_id}: ${u.hours ? u.hours + "h " : ""}${u.miles ? u.miles + "mi" : ""}`,
            )
            .join("\n"),
      );
    }
    if (tasks.data?.length) {
      sections.push(
        `TASKS:\n` +
          tasks.data
            .map(
              (t) =>
                `- [${t.status ?? "?"}] ${t.title} due=${t.due_at?.slice(0, 10) ?? "-"} pri=${t.priority ?? "-"}`,
            )
            .join("\n"),
      );
    }
    if (forecast.data?.length) {
      sections.push(
        `WEATHER FORECAST (last ${forecast.data.length} days):\n` +
          forecast.data
            .map(
              (f) =>
                `- ${f.forecast_date}: ${f.summary ?? ""} hi=${fmt(f.temp_high)} lo=${fmt(f.temp_low)} precip=${fmt(f.precip_mm)}mm (${fmt(f.precip_prob)}%)`,
            )
            .join("\n"),
      );
    }
    if (rachRuns.data?.length) {
      const zoneById = new Map((rachZones.data ?? []).map((z) => [z.id, z.name]));
      sections.push(
        `RECENT IRRIGATION RUNS:\n` +
          rachRuns.data
            .map(
              (r) =>
                `- ${r.started_at?.slice(0, 16) ?? "?"} ${zoneById.get(r.zone_id) ?? r.zone_id}: ${Math.round((r.duration_seconds ?? 0) / 60)}min (${r.source ?? "?"})`,
            )
            .join("\n"),
      );
    }
    if (livestock.data?.length) {
      sections.push(
        `LIVESTOCK:\n` +
          livestock.data.map((a) => `- ${a.species} ${a.name ?? ""} [${a.status ?? "?"}]`).join("\n"),
      );
    }
    if (trees.data?.length) {
      sections.push(
        `ORCHARD:\n` +
          trees.data.map((t) => `- ${t.species}${t.variety ? " (" + t.variety + ")" : ""} [${t.status ?? "?"}]`).join("\n"),
      );
    }
    if (plots.data?.length) {
      sections.push(
        `GARDEN PLOTS:\n` +
          plots.data.map((p) => `- ${p.name} ${p.size_sqft ?? "?"} sqft`).join("\n"),
      );
    }
    if (priceHist.data?.length) {
      sections.push(
        `RECENT FOOD PRICE CHANGES:\n` +
          priceHist.data
            .map((p) => `- ${p.food_name}: ${fmt(p.new_price)} on ${p.changed_at?.slice(0, 10)}`)
            .join("\n"),
      );
    }
    if (dailyNote.data?.[0]) {
      const dn = dailyNote.data[0];
      sections.push(
        `TODAY'S NOTE (${dn.note_date}):\n${String(dn.content ?? "").slice(0, 800)}`,
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
    const { text } = await generateText({
      model: provider(modelId),
      system,
      messages: data.messages.map((m) => ({ role: m.role, content: m.content })),
    });

    return {
      text: text.trim(),
      model: modelId,
      latencyMs: Date.now() - started,
      snapshotChars: snapshot.length,
    };
  });
