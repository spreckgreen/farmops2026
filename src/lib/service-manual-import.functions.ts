// Service-manual import: take a long-form manual (usually AI-written from the
// prompt in service-manual-template.ts), attach it to one asset in inventory,
// and turn its "Service Intervals" section into maintenance records.
//
// Parts named by the manual are matched against existing inventory. Anything
// unmatched becomes a NEW inventory item stocked at 0 with min_quantity set to
// the quantity the maintenance needs, so it shows up as "need to buy".
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { AiEscalation } from "./ai-feature-areas";
import type { Action, ActionResult, ActionStatus } from "./ai-actions/types";
import { matchPart, type PartMatchCandidate, type PartMatchConfidence } from "./part-match";

export interface ManualPart {
  name: string;
  quantity: number;
  unit: string;
  /**
   * Auto-accepted inventory match, or null when the user must decide (either a
   * fuzzy candidate needing confirmation, or nothing matched at all).
   */
  inventory_item_id: string | null;
  /** Name of the matched inventory item (for the review UI). */
  matched_name: string | null;
  /** Ranked alternates the review UI offers, best first. */
  candidates: PartMatchCandidate[];
  /** How good the top candidate is. */
  confidence: PartMatchConfidence;
  /** True when the import should not link this part until the user confirms. */
  needs_confirmation: boolean;
}

export interface ManualInterval {
  key: string;
  title: string;
  trigger_type: "hours" | "miles" | "months";
  interval_value: number;
  recurrence: string;
  tasks: string[];
  parts: ManualPart[];
  notes: string | null;
}

export interface ManualImportPlan {
  plan_id: string;
  asset_id: string;
  asset_name: string;
  summary: string;
  intervals: ManualInterval[];
  citations: string[];
  model: string;
  escalation: AiEscalation | null;
}

const ParseInput = z.object({
  asset_id: z.string().uuid(),
  manual_text: z.string().trim().min(40).max(120000),
  /**
   * How sure a fuzzy match must be to be pre-linked without a confirmation.
   * Lower = more auto-linking, higher = more prompts. 0.82 by default.
   */
  match_threshold: z.coerce.number().min(0.4).max(1).default(0.82),
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

const triggerFrom = z
  .string()
  .transform((t) => {
    const s = t.toLowerCase();
    if (s.includes("mile") || s.includes("km")) return "miles";
    if (s.includes("month") || s.includes("year") || s.includes("annual") || s.includes("season"))
      return "months";
    return "hours";
  })
  .pipe(z.enum(["hours", "miles", "months"]));

/** Lenient shape — small models drift, so everything has a fallback. */
const Lenient = z.object({
  manual_summary: z.string().optional().default(""),
  intervals: z
    .array(
      z.object({
        name: z.string(),
        trigger_type: triggerFrom.optional().default("hours"),
        interval_value: z.coerce.number().optional().default(1),
        tasks: z.array(z.string()).optional().default([]),
        parts: z
          .array(
            z.object({
              name: z.string(),
              quantity: z.coerce.number().optional().default(1),
              unit: z.string().nullish().default("each"),
            }),
          )
          .optional()
          .default([]),
        notes: z.string().nullish().default(null),
      }),
    )
    .optional()
    .default([]),
  citations: z.array(z.string()).optional().default([]),
});

const SYSTEM_PROMPT =
  "You EXTRACT structured maintenance data from a service manual. You do not " +
  "invent services: every interval must be supported by the manual text. " +
  "Rules: (1) Emit one entry per recurring service, up to 25. " +
  "(2) trigger_type is hours, miles, or months — convert 'annually' to 12 months. " +
  "(3) interval_value is a positive integer taken from the manual (use the ongoing " +
  "interval, and mention any break-in first-change in notes). " +
  "(4) tasks: 1-8 short imperative steps from the manual's procedure. " +
  "(5) parts: every consumable or part the service needs, with the quantity and " +
  "unit stated in the manual (default quantity 1, unit 'each'). Include fluids " +
  "with their volume, e.g. name 'SAE 15W-40 engine oil', quantity 4, unit 'qt'. " +
  "(6) notes: specs, capacities, and the first-service exception. " +
  "(7) citations: the manual's own references, max 8, each under 160 chars.";

export const parseServiceManual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ParseInput.parse(d))
  .handler(async ({ data, context }): Promise<ManualImportPlan> => {
    const { supabase, userId } = context;
    const { withIdempotency } = await import("./ai-idempotency.server");
    return withIdempotency(
      { supabase, userId, surface: "maintenance.import_manual", input: data },
      async (): Promise<ManualImportPlan> => {
        const { data: asset, error: assetErr } = await supabase
          .from("inventory_items")
          .select("id, name, sku, category, usage_tracking, current_hours, current_miles")
          .eq("id", data.asset_id)
          .eq("user_id", userId)
          .maybeSingle();
        if (assetErr) throw new Error(assetErr.message);
        if (!asset) throw new Error("Asset not found");
        const assetLabel = asset.name ?? asset.sku ?? "the asset";

        const { data: inventory } = await supabase
          .from("inventory_items")
          .select("id, name, sku")
          .eq("user_id", userId)
          .neq("status", "retired");
        const inv = (inventory ?? []).map((i) => ({
          id: i.id,
          label: (i.name ?? i.sku ?? "").trim(),
          lower: (i.name ?? i.sku ?? "").trim().toLowerCase(),
        }));

        const { resolveAreaAi, hostedHandle } = await import("./ai-routing.server");
        const ai = await resolveAreaAi("maintenance.schedule", {
          hostedDefaultModel: "google/gemini-3.6-flash",
          client: supabase,
        });
        let provider = ai.provider;
        let modelId = ai.modelId;
        let escalation: AiEscalation | null = null;

        const { generateText, Output, NoObjectGeneratedError } = await import("ai");
        const { extractJsonObject } = await import("./ai-json");

        const schema = z.object({
          manual_summary: z.string(),
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
                  unit: z.string(),
                }),
              ),
              notes: z.string().nullable(),
            }),
          ),
          citations: z.array(z.string()),
        });

        const userPrompt =
          `ASSET: ${assetLabel}${asset.category ? ` (${asset.category})` : ""}\n` +
          `- usage tracking: ${asset.usage_tracking ?? "none"}\n` +
          `- current hours: ${asset.current_hours ?? 0}\n` +
          `- current miles: ${asset.current_miles ?? 0}\n\n` +
          `SERVICE MANUAL:\n${data.manual_text.slice(0, 100000)}`;

        function coerce(raw: unknown): z.infer<typeof Lenient> | null {
          const res = Lenient.safeParse(raw);
          if (!res.success || res.data.intervals.length === 0) return null;
          return res.data;
        }

        let parsed: z.infer<typeof Lenient> | null = null;
        let failureReason = "";
        try {
          const { output } = await generateText({
            model: provider(modelId),
            output: Output.object({ schema }),
            system: SYSTEM_PROMPT,
            prompt: userPrompt,
          });
          parsed = coerce(output);
        } catch (error) {
          if (NoObjectGeneratedError.isInstance(error)) {
            parsed = coerce(extractJsonObject(String(error.text ?? "")));
            failureReason = "structured output rejected by model";
          } else {
            failureReason = error instanceof Error ? error.message : String(error);
          }
        }

        if (!parsed) {
          try {
            const { text } = await generateText({
              model: provider(modelId),
              system:
                SYSTEM_PROMPT +
                "\n\nRespond with ONLY a JSON object, no prose, no markdown fences, " +
                'shaped exactly as: {"manual_summary": string, "intervals": ' +
                '[{"name": string, "trigger_type": "hours"|"miles"|"months", ' +
                '"interval_value": number, "tasks": string[], "parts": ' +
                '[{"name": string, "quantity": number, "unit": string}], ' +
                '"notes": string|null}], "citations": string[]}',
              prompt: userPrompt,
            });
            parsed = coerce(extractJsonObject(text));
            if (!parsed && !failureReason) failureReason = "model returned no JSON";
          } catch (error) {
            failureReason = error instanceof Error ? error.message : String(error);
          }
        }

        if (!parsed) {
          const hosted = hostedHandle(
            ai,
            "error",
            `${modelId} could not read the manual (${failureReason || "no JSON"}), ` +
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
                system: SYSTEM_PROMPT,
                prompt: userPrompt,
              });
              parsed = coerce(output);
              failureReason = "";
            } catch (error) {
              failureReason = error instanceof Error ? error.message : String(error);
            }
          }
        }

        if (!parsed) {
          return {
            plan_id: crypto.randomUUID(),
            asset_id: asset.id,
            asset_name: assetLabel,
            summary:
              `Model "${modelId}" could not extract service intervals from that manual` +
              (failureReason ? ` (${failureReason}).` : ".") +
              " Try a larger model for the service-schedule area, or trim the manual to" +
              " its Service Intervals section.",
            intervals: [],
            citations: [],
            model: modelId,
            escalation,
          };
        }

        const matchTargets = inv
          .filter((i) => i.label)
          .map((i) => ({ id: i.id, label: i.label }));

        const intervals: ManualInterval[] = parsed.intervals.slice(0, 25).map((iv, i) => {
          const trigger = iv.trigger_type;
          const value = Math.max(1, Math.round(Number(iv.interval_value) || 1));
          return {
            key: `iv-${i}`,
            title: String(iv.name).slice(0, 200),
            trigger_type: trigger,
            interval_value: value,
            recurrence: recurrenceLabel(trigger, value),
            tasks: (iv.tasks ?? []).slice(0, 8).map((t) => String(t).slice(0, 200)),
            notes: iv.notes ? String(iv.notes).slice(0, 500) : null,
            parts: (iv.parts ?? []).slice(0, 10).map((p) => {
              const name = String(p.name).slice(0, 200).trim();
              const m = matchPart(name, matchTargets, {
                autoAcceptScore: data.match_threshold,
              });
              // Only a confident, unambiguous hit is pre-linked; everything
              // else waits for the user's pick in the review step.
              const auto = m.best && !m.needsConfirmation ? m.best : null;
              return {
                name,
                quantity: Math.max(
                  0.01,
                  Math.round((Number(p.quantity) || 1) * 100) / 100,
                ),
                unit: (p.unit ?? "each").toString().slice(0, 30) || "each",
                inventory_item_id: auto?.id ?? null,
                matched_name: auto?.label ?? null,
                candidates: m.candidates,
                confidence: m.confidence,
                needs_confirmation: m.needsConfirmation,
              };
            }),
          };
        });

        return {
          plan_id: crypto.randomUUID(),
          asset_id: asset.id,
          asset_name: assetLabel,
          summary:
            (parsed.manual_summary || "").slice(0, 400) ||
            `${intervals.length} service interval${intervals.length === 1 ? "" : "s"} read from the manual.`,
          intervals,
          citations: Array.from(
            new Set((parsed.citations ?? []).map((c) => String(c).slice(0, 160))),
          ).slice(0, 8),
          model: modelId,
          escalation,
        };
      },
    );
  });

// ---------------------------------------------------------------- apply

const PartInput = z.object({
  name: z.string().min(1).max(200),
  quantity: z.number().positive().max(100000),
  unit: z.string().max(30).default("each"),
  inventory_item_id: z.string().uuid().nullable(),
});

const ApplyInput = z.object({
  plan_id: z.string().uuid(),
  asset_id: z.string().uuid(),
  asset_name: z.string().max(200),
  /** Create inventory rows for parts with no match. */
  create_missing_parts: z.boolean().default(true),
  intervals: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        trigger_type: z.enum(["hours", "miles", "months"]),
        interval_value: z.number().positive().max(1000000),
        recurrence: z.string().max(200),
        tasks: z.array(z.string().max(200)).max(8),
        notes: z.string().max(500).nullable(),
        parts: z.array(PartInput).max(10),
      }),
    )
    .min(1)
    .max(25),
});

export interface CreatedPart {
  id: string;
  name: string;
  quantity_needed: number;
  unit: string;
  reused: boolean;
}

export interface ManualImportResult {
  status: ActionStatus;
  results: ActionResult[];
  created_parts: CreatedPart[];
  reused: boolean;
}

export const applyServiceManualImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ApplyInput.parse(d))
  .handler(async ({ data, context }): Promise<ManualImportResult> => {
    const { supabase, userId } = context;

    // Idempotent per plan_id — a double-click replays the stored result.
    const prior = await supabase
      .from("ai_action_log")
      .select("id, status, result")
      .eq("user_id", userId)
      .eq("id", data.plan_id)
      .maybeSingle();
    if (prior.data) {
      const stored = (prior.data.result ?? {}) as {
        results?: ActionResult[];
        created_parts?: CreatedPart[];
      };
      return {
        status: prior.data.status as ActionStatus,
        results: stored.results ?? [],
        created_parts: stored.created_parts ?? [],
        reused: true,
      };
    }

    const { error: logErr } = await supabase.from("ai_action_log").insert({
      id: data.plan_id,
      user_id: userId,
      surface: "maintenance.import_manual",
      plan: data as unknown as never,
      status: "pending",
    } as never);
    if (logErr) throw new Error(`Failed to record import: ${logErr.message}`);

    // 1. Resolve parts. Unmatched names become new inventory rows stocked at 0
    //    with min_quantity = what the maintenance needs, so they read as "low".
    const created: CreatedPart[] = [];
    const resolved = new Map<string, string>(); // lowercased name -> item id

    if (data.create_missing_parts) {
      const needed = new Map<string, { name: string; quantity: number; unit: string }>();
      for (const iv of data.intervals) {
        for (const p of iv.parts) {
          if (p.inventory_item_id) continue;
          const key = p.name.trim().toLowerCase();
          const prev = needed.get(key);
          if (!prev || p.quantity > prev.quantity) {
            needed.set(key, { name: p.name.trim(), quantity: p.quantity, unit: p.unit });
          }
        }
      }

      for (const [key, part] of needed) {
        // Re-check by exact name first: the asset may already stock it under a
        // name the fuzzy matcher missed, and we never want a duplicate row.
        const { data: existing } = await supabase
          .from("inventory_items")
          .select("id, name")
          .eq("user_id", userId)
          .ilike("name", part.name)
          .maybeSingle();
        if (existing) {
          resolved.set(key, existing.id);
          created.push({
            id: existing.id,
            name: existing.name ?? part.name,
            quantity_needed: part.quantity,
            unit: part.unit,
            reused: true,
          });
          continue;
        }

        const { data: row, error } = await supabase
          .from("inventory_items")
          .insert({
            user_id: userId,
            name: part.name.slice(0, 200),
            item_type: "part",
            category: "Maintenance parts",
            status: "available",
            quantity: 0,
            min_quantity: Math.max(1, Math.ceil(part.quantity)),
            unit: part.unit.slice(0, 30),
            usage_tracking: "none",
            notes: `Added from the service manual import for ${data.asset_name}. Needs ${part.quantity} ${part.unit} per service.`,
            tags: ["service-manual", "maintenance-part"],
          } as never)
          .select("id, name")
          .single<{ id: string; name: string | null }>();
        if (error) throw new Error(`Could not create part "${part.name}": ${error.message}`);
        resolved.set(key, row.id);
        created.push({
          id: row.id,
          name: row.name ?? part.name,
          quantity_needed: part.quantity,
          unit: part.unit,
          reused: false,
        });
      }
    }

    // 2. Write the maintenance records through the shared action executor.
    const { executeAction } = await import("./ai-actions/registry.server");
    const results: ActionResult[] = [];
    for (const iv of data.intervals) {
      const parts = iv.parts.map((p) => ({
        name: p.name,
        quantity: p.quantity,
        inventory_item_id:
          p.inventory_item_id ?? resolved.get(p.name.trim().toLowerCase()) ?? null,
      }));
      const description = [
        iv.tasks.length > 0 ? "Tasks:\n- " + iv.tasks.join("\n- ") : "",
        iv.parts.length > 0
          ? "Parts:\n- " +
            iv.parts
              .map((p) => `${p.name} × ${p.quantity} ${p.unit}`.trim())
              .join("\n- ")
          : "",
        iv.notes ? `Notes: ${iv.notes}` : "",
        `Source: imported service manual for ${data.asset_name}`,
      ]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 2000);

      const action: Action = {
        type: "maintenance.create_interval",
        asset_id: data.asset_id,
        asset_name: data.asset_name,
        title: iv.title,
        service_type: iv.title.slice(0, 100),
        description,
        trigger_type: iv.trigger_type,
        interval_value: iv.interval_value,
        first_due_date: firstDueDate(iv.trigger_type, iv.interval_value),
        recurrence: iv.recurrence || recurrenceLabel(iv.trigger_type, iv.interval_value),
        parts,
        notes: iv.notes,
      };
      results.push(await executeAction(action, { supabase, userId }));
    }

    const ok = results.filter((r) => r.ok).length;
    const status: ActionStatus =
      ok === results.length ? "applied" : ok === 0 ? "failed" : "partial";

    await supabase
      .from("ai_action_log")
      .update({
        result: { results, created_parts: created } as unknown as never,
        status,
        applied_at: new Date().toISOString(),
      } as never)
      .eq("id", data.plan_id)
      .eq("user_id", userId);

    return { status, results, created_parts: created, reused: false };
  });
