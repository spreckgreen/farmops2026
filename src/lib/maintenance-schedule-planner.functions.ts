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
  /** true when the user confirmed they want to extend an existing schedule. */
  supplemental: z.boolean().optional(),
  /** Titles/service types already on the asset's schedule (skip duplicates). */
  existing_services: z.array(z.string().max(300)).max(200).optional(),
  /** Optional manufacturer/manual link the model should evaluate. */
  reference_url: z.string().url().max(2000).optional(),
  /** Optional pasted or uploaded reference text (manual excerpt, spec sheet). */
  reference_text: z.string().max(60000).optional(),
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

    const { resolveAreaAi, hostedHandle } = await import("./ai-routing.server");
    const ai = await resolveAreaAi("maintenance.schedule", {
      hostedDefaultModel: "google/gemini-3.6-flash",
    });
    let provider = ai.provider;
    let modelId = ai.modelId;
    let escalation: import("./ai-feature-areas").AiEscalation | null = null;

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
      "(7) Do not invent inventory ids. Do not exceed the limits above." +
      (data.supplemental
        ? " (8) This asset ALREADY has a schedule. Propose only SUPPLEMENTAL services" +
          " that are missing from EXISTING_SCHEDULE — never restate or duplicate one." +
          " If a listed service should run at a different interval, name it clearly as" +
          " a revision in its notes. Fewer, higher-value intervals are better here."
        : "") +
      (data.reference_url || data.reference_text
        ? " (9) REFERENCE_MATERIAL is authoritative: prefer its stated intervals and part" +
          " numbers over generic typicals, and cite it in citations."
        : "");

    // Fetch the linked reference (manual page / spec sheet) when provided.
    // The URL is user-supplied, so it goes through the SSRF guard: public
    // http(s) hosts only, no private/loopback/link-local targets, redirects
    // re-validated per hop.
    let referenceFetched = "";
    if (data.reference_url) {
      const { safePublicFetch } = await import("./url-guard");
      try {
        const res = await safePublicFetch(data.reference_url, {
          headers: { accept: "text/html,text/plain,*/*" },
        });
        if (res.ok) {
          const ct = res.headers.get("content-type") ?? "";
          if (/text\/|json|xml/i.test(ct)) {
            const body = await res.text();
            referenceFetched = body
              .replace(/<script[\s\S]*?<\/script>/gi, " ")
              .replace(/<style[\s\S]*?<\/style>/gi, " ")
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 20000);
          } else {
            referenceFetched = "(binary content at the reference link — could not read text)";
          }
        } else {
          // Don't echo upstream status codes: that turns the planner into an
          // internal port/host scanner oracle.
          referenceFetched = "(reference link could not be read)";
        }
      } catch {
        referenceFetched = "(reference link was rejected or unreachable)";
      }
    }


    const existing = (data.existing_services ?? []).slice(0, 100);

    const userPrompt =
      `ASSET:\n- name: ${assetLabel}\n- category: ${asset.category ?? "unknown"}\n` +
      `- description: ${asset.description ?? "(none)"}\n` +
      `- current hours: ${asset.current_hours ?? 0}\n` +
      `- current miles: ${asset.current_miles ?? 0}\n` +
      `- usage tracking: ${usageTracking}\n` +
      `- tags: ${tags || "(none)"}\n` +
      `- notes: ${asset.notes ?? "(none)"}\n\n` +
      (data.usage_context ? `USAGE_CONTEXT:\n${data.usage_context}\n\n` : "") +
      (existing.length > 0
        ? `EXISTING_SCHEDULE (already on record — do not duplicate):\n` +
          existing.map((s) => `- ${s}`).join("\n") +
          "\n\n"
        : "") +
      (data.reference_url ? `REFERENCE_URL: ${data.reference_url}\n\n` : "") +
      (referenceFetched || data.reference_text
        ? `REFERENCE_MATERIAL:\n${[data.reference_text, referenceFetched]
            .filter(Boolean)
            .join("\n\n")
            .slice(0, 40000)}\n\n`
        : "") +
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

    // Escalate to hosted AI when the (local) model can't produce a schedule.
    if (!parsed) {
      const hosted = hostedHandle(
        ai,
        "error",
        `${modelId} could not produce a usable schedule (${failureReason || "no JSON"}), ` +
          "so hosted AI was used instead.",
      );
      if (hosted) {
        provider = hosted.provider;
        modelId = hosted.modelId;
        escalation = hosted.escalation;
        try {
          const { output } = await generateText({
            model: provider(modelId),
            output: Output.object({ schema }),
            system: systemPrompt,
            prompt: userPrompt,
          });
          parsed = coerce(output) ?? (output as z.infer<typeof schema>);
          failureReason = "";
        } catch (error) {
          failureReason =
            error instanceof Error ? error.message : String(error);
        }
      }
    }

    // Already routed to hosted AI but the configured hosted model failed (bad
    // model id, temporary gateway error). Retry once on the known-good default.
    const HOSTED_DEFAULT = "google/gemini-3.6-flash";
    if (!parsed && ai.backend === "hosted" && modelId !== HOSTED_DEFAULT) {
      try {
        modelId = HOSTED_DEFAULT;
        const { output } = await generateText({
          model: provider(modelId),
          output: Output.object({ schema }),
          system: systemPrompt,
          prompt: userPrompt,
        });
        parsed = coerce(output) ?? (output as z.infer<typeof schema>);
        failureReason = "";
      } catch (error) {
        failureReason = error instanceof Error ? error.message : String(error);
      }
    }

    if (!parsed) {
      return {
        plan_id: crypto.randomUUID(),
        surface: "maintenance.generate_schedule",
        summary:
          `${ai.backend === "hosted" ? "Hosted" : "Local"} model "${modelId}" did not ` +
          "return a usable schedule" +
          (failureReason ? ` (${failureReason}).` : ".") +
          (ai.backend === "hosted"
            ? " Check the model id configured for the service-schedule area in AI settings."
            : " Small local models often struggle with structured output — try a" +
              " larger model (e.g. llama3.1:8b) or route this area to Lovable AI."),
        actions: [],
        citations: [],
        model: modelId,
        escalation,
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
      escalation,
    };
      },
    );
  });
