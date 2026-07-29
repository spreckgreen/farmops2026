// Planner: given an asset (inventory item), ask the configured AI model to
// propose a structured maintenance schedule. Returns an ActionPlan that the
// user reviews in a preview dialog and applies via applyActionPlan.
//
// Follows gateway rules: no field bounds inside Output.object, limits in prompt,
// NoObjectGeneratedError fallback that parses error.text.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { Action, ActionPlan } from "./ai-actions/types";

const PlannerInput = z.object({
  asset_id: z.string().uuid(),
  usage_context: z.string().trim().max(2000).optional(),
});

function recurrenceLabel(
  trigger: "hours" | "miles" | "months",
  value: number,
): string {
  const v = Math.max(1, Math.round(value));
  if (trigger === "hours") return `every ${v} hours`;
  if (trigger === "miles") return `every ${v} miles`;
  return v === 1 ? "every month" : `every ${v} months`;
}

function firstDueDate(
  trigger: "hours" | "miles" | "months",
  interval: number,
): string | null {
  if (trigger !== "months") return null;
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + Math.max(1, Math.round(interval)));
  return d.toISOString().slice(0, 10);
}

export const planMaintenanceSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PlannerInput.parse(d))
  .handler(async ({ data, context }): Promise<ActionPlan> => {
    const { supabase, userId } = context;
    const { withIdempotency } = await import("./ai-idempotency.server");
    return withIdempotency(
      { supabase, userId, surface: "maintenance.plan_schedule", input: data },
      async (): Promise<ActionPlan> => {

    const { data: asset, error: assetErr } = await supabase
      .from("inventory_items")
      .select(
        "id, name, sku, category, description, notes, current_hours, current_miles, usage_tracking, tags",
      )
      .eq("id", data.asset_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (assetErr) throw new Error(assetErr.message);
    if (!asset) throw new Error("Asset not found");

    const { data: inventory } = await supabase
      .from("inventory_items")
      .select("id, name, sku, category")
      .eq("user_id", userId)
      .neq("status", "retired");

    const inv = inventory ?? [];
    const inventoryBlock = inv
      .slice(0, 200)
      .map((i) => `- ${i.name ?? i.sku ?? "?"} (id:${i.id})`)
      .join("\n");

    const { createAiProvider } = await import("./ai-gateway.server");
    const { provider, modelOverride } = await createAiProvider();
    const modelId = modelOverride ?? "google/gemini-3.6-flash";

    const { generateText, Output, NoObjectGeneratedError } = await import("ai");

    const schema = z.object({
      asset_summary: z.string(),
      intervals: z.array(
        z.object({
          name: z.string(),
          trigger_type: z.enum(["hours", "miles", "months"]),
          interval_value: z.number(),
          tasks: z.array(z.string()),
          parts: z.array(
            z.object({
              name: z.string(),
              quantity: z.number(),
              match_inventory_hint: z.string().nullable(),
            }),
          ),
          notes: z.string().nullable(),
        }),
      ),
      citations: z.array(z.string()),
    });

    const usageTracking = asset.usage_tracking ?? "hours";
    const assetLabel =
      asset.name ?? asset.sku ?? asset.category ?? "the asset";
    const tags = Array.isArray(asset.tags) ? asset.tags.join(", ") : "";

    // Small local models (gemma, llama3.2:1b, …) often ignore json_schema mode
    // and answer with prose or fenced JSON. Keep a lenient parser + a plain-text
    // retry so those models still produce a usable plan.
    const lenient = z.object({
      asset_summary: z.string().optional().default(""),
      intervals: z
        .array(
          z.object({
            name: z.string(),
            trigger_type: z
              .string()
              .transform((t) => {
                const s = t.toLowerCase();
                return s.includes("mile")
                  ? "miles"
                  : s.includes("month") || s.includes("year") || s.includes("day")
                    ? "months"
                    : "hours";
              })
              .pipe(z.enum(["hours", "miles", "months"])),
            interval_value: z.coerce.number().optional().default(1),
            tasks: z.array(z.string()).optional().default([]),
            parts: z
              .array(
                z.object({
                  name: z.string(),
                  quantity: z.coerce.number().optional().default(1),
                  match_inventory_hint: z.string().nullish().default(null),
                }),
              )
              .optional()
              .default([]),
            notes: z.string().nullish().default(null),
          }),
        )
        .default([]),
      citations: z.array(z.string()).optional().default([]),
    });

    /** Pull the first balanced JSON object out of arbitrary model text. */
    function extractJson(text: string): unknown | null {
      const cleaned = text.replace(/```(?:json)?/gi, "");
      const start = cleaned.indexOf("{");
      if (start === -1) return null;
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let i = start; i < cleaned.length; i++) {
        const c = cleaned[i];
        if (inStr) {
          if (esc) esc = false;
          else if (c === "\\") esc = true;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') inStr = true;
        else if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(cleaned.slice(start, i + 1));
            } catch {
              return null;
            }
          }
        }
      }
      return null;
    }

    function coerce(raw: unknown): z.infer<typeof schema> | null {
      const res = lenient.safeParse(raw);
      if (!res.success || res.data.intervals.length === 0) return null;
      return res.data as z.infer<typeof schema>;
    }

    const systemPrompt =
      "You are a small-farm equipment maintenance planner. Given an asset " +
      "and the user's inventory, propose a realistic recurring service schedule. " +
      "Rules: (1) Emit 4-10 intervals covering the most important recurring services. " +
      "(2) trigger_type must be one of hours, miles, or months. Match the asset's " +
      "usage tracking mode when appropriate. (3) interval_value is a positive integer. " +
      "(4) Each interval has 1-6 tasks (short imperative phrases). " +
      "(5) Each interval has 0-6 parts. match_inventory_hint should be a short " +
      "phrase we can substring-search in the inventory list, or null if no likely match. " +
      "(6) citations: cite manufacturer typicals, general service manuals, or 'user context'. " +
      "Keep each citation under 120 chars, max 6 items. " +
      "(7) Do not invent inventory ids. Do not exceed the limits above.";

    const userPrompt =
      `ASSET:\n- name: ${assetLabel}\n- category: ${asset.category ?? "unknown"}\n` +
      `- description: ${asset.description ?? "(none)"}\n` +
      `- current hours: ${asset.current_hours ?? 0}\n` +
      `- current miles: ${asset.current_miles ?? 0}\n` +
      `- usage tracking: ${usageTracking}\n` +
      `- tags: ${tags || "(none)"}\n` +
      `- notes: ${asset.notes ?? "(none)"}\n\n` +
      (data.usage_context ? `USAGE_CONTEXT:\n${data.usage_context}\n\n` : "") +
      `INVENTORY (for parts matching):\n${inventoryBlock || "(none)"}`;

    let parsed: z.infer<typeof schema> | null = null;
    let failureReason = "";
    try {
      const { output } = await generateText({
        model: provider(modelId),
        output: Output.object({ schema }),
        system: systemPrompt,
        prompt: userPrompt,
      });
      parsed = coerce(output) ?? (output as z.infer<typeof schema>);
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        parsed = coerce(extractJson(String(error.text ?? "")));
        failureReason = "structured output rejected by model";
      } else {
        failureReason =
          error instanceof Error ? error.message : String(error);
      }
    }

    // Retry in plain-text JSON mode — works with models that don't support
    // json_schema / json_object response formats at all.
    if (!parsed) {
      try {
        const { text } = await generateText({
          model: provider(modelId),
          system:
            systemPrompt +
            "\n\nRespond with ONLY a JSON object, no prose, no markdown fences, " +
            'shaped exactly as: {"asset_summary": string, "intervals": ' +
            '[{"name": string, "trigger_type": "hours"|"miles"|"months", ' +
            '"interval_value": number, "tasks": string[], "parts": ' +
            '[{"name": string, "quantity": number, "match_inventory_hint": string|null}], ' +
            '"notes": string|null}], "citations": string[]}',
          prompt: userPrompt,
        });
        parsed = coerce(extractJson(text));
        if (!parsed && !failureReason) failureReason = "model returned no JSON";
      } catch (error) {
        failureReason =
          error instanceof Error ? error.message : String(error);
      }
    }

    if (!parsed) {
      return {
        plan_id: crypto.randomUUID(),
        surface: "maintenance.generate_schedule",
        summary:
          `Model "${modelId}" did not return a usable schedule` +
          (failureReason ? ` (${failureReason}).` : ".") +
          " Small local models often struggle with structured output — try a" +
          " larger model (e.g. llama3.1:8b) or an external provider.",
        actions: [],
        citations: [],
        model: modelId,
      };
    }


    // Substring-match parts to inventory. Longest hint wins.
    const invLower = inv.map((i) => ({
      id: i.id,
      name: (i.name ?? i.sku ?? "").toLowerCase(),
    }));
    function matchInventory(hint: string | null): string | null {
      if (!hint) return null;
      const h = hint.toLowerCase().trim();
      if (h.length < 3) return null;
      let best: { id: string; len: number } | null = null;
      for (const item of invLower) {
        if (!item.name) continue;
        if (item.name.includes(h) || h.includes(item.name)) {
          const len = Math.min(item.name.length, h.length);
          if (!best || len > best.len) best = { id: item.id, len };
        }
      }
      return best?.id ?? null;
    }

    const clampedIntervals = parsed.intervals.slice(0, 10);
    const actions: Action[] = clampedIntervals.map((iv) => {
      const trigger = iv.trigger_type;
      const val = Math.max(1, Math.round(Number(iv.interval_value) || 1));
      const parts = (iv.parts ?? [])
        .slice(0, 6)
        .map((p) => ({
          name: String(p.name).slice(0, 200),
          quantity: Math.max(1, Math.round(Number(p.quantity) || 1)),
          inventory_item_id: matchInventory(p.match_inventory_hint ?? null),
        }));
      const tasks = (iv.tasks ?? []).slice(0, 6).map((t) => String(t).slice(0, 200));
      const description = [
        tasks.length > 0 ? "Tasks:\n- " + tasks.join("\n- ") : "",
        parts.length > 0
          ? "Parts:\n- " +
            parts
              .map(
                (p) =>
                  `${p.name} × ${p.quantity}${p.inventory_item_id ? " (in inventory)" : ""}`,
              )
              .join("\n- ")
          : "",
        iv.notes ? `Notes: ${iv.notes}` : "",
      ]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 2000);

      return {
        type: "maintenance.create_interval" as const,
        asset_id: asset.id,
        asset_name: assetLabel,
        title: String(iv.name).slice(0, 200),
        service_type: String(iv.name).slice(0, 100),
        description,
        trigger_type: trigger,
        interval_value: val,
        first_due_date: firstDueDate(trigger, val),
        recurrence: recurrenceLabel(trigger, val),
        parts,
        notes: iv.notes ? String(iv.notes).slice(0, 500) : null,
      };
    });

    return {
      plan_id: crypto.randomUUID(),
      surface: "maintenance.generate_schedule",
      summary: parsed.asset_summary.slice(0, 400),
      actions,
      citations: (parsed.citations ?? []).slice(0, 6).map((c) => String(c).slice(0, 200)),
      model: modelId,
    };
      },
    );
  });
