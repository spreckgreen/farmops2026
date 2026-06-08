import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { generateText, Output } from "ai";

const SummaryInput = z.object({
  mode: z.enum(["task_update", "project_rollup", "weekly_report"]),
  scope_task_id: z.string().uuid().nullable().optional(),
  period_days: z.number().int().min(1).max(60).default(7),
});

const SummarySchema = z.object({
  summary: z.string(),
  key_decisions: z.array(z.string()).default([]),
  blockers: z.array(z.string()).default([]),
  next_steps: z.array(z.string()).default([]),
});

const MODE_INSTRUCTIONS: Record<string, string> = {
  task_update:
    "Write a 2-3 sentence progress note in past tense, no fluff. Focus on what actually happened.",
  project_rollup:
    "Produce a structured rollup: bullets for what shipped, what is blocked, and what is next. Be concise.",
  weekly_report:
    "Write an executive narrative of 150-200 words suitable for a stakeholder email. Past tense, plain language, lead with outcomes.",
};

export const generateSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SummaryInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - data.period_days * 24 * 60 * 60 * 1000);

    let q = supabase
      .from("activity_log")
      .select("created_at, entry_type, raw_content, task_id, tasks(title, slug)")
      .gte("created_at", periodStart.toISOString())
      .order("created_at", { ascending: true });
    if (data.scope_task_id) q = q.eq("task_id", data.scope_task_id);

    const { data: entries, error } = await q;
    if (error) throw new Error(error.message);

    if (!entries || entries.length === 0) {
      throw new Error("No activity in this period yet — write a note first.");
    }

    // Previous summary for same scope (extend, don't restart)
    let prevQ = supabase
      .from("summaries")
      .select("generated_summary, edited_summary")
      .eq("mode", data.mode)
      .order("created_at", { ascending: false })
      .limit(1);
    prevQ = data.scope_task_id
      ? prevQ.eq("scope_task_id", data.scope_task_id)
      : prevQ.is("scope_task_id", null);
    const { data: prev } = await prevQ.maybeSingle();

    const prevText = prev
      ? JSON.stringify(prev.edited_summary ?? prev.generated_summary)
      : "(none)";

    const entryLines = entries
      .map((e) => {
        const t = (e.tasks as { title?: string } | null)?.title;
        return `- [${e.created_at.slice(0, 10)}] [${e.entry_type}]${t ? ` (${t})` : ""} ${e.raw_content}`;
      })
      .join("\n");

    const prompt = `You are summarizing an activity log.

MODE: ${data.mode}
INSTRUCTIONS: ${MODE_INSTRUCTIONS[data.mode]}

PREVIOUS SUMMARY (extend, do not restart):
${prevText}

NEW ACTIVITY ENTRIES (chronological):
${entryLines}

Return a structured summary.`;

    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(apiKey);

    try {
      const { experimental_output: output } = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        experimental_output: Output.object({ schema: SummarySchema }),
        prompt,
      });

      const { data: inserted, error: insErr } = await supabase
        .from("summaries")
        .insert({
          user_id: userId,
          mode: data.mode,
          scope_task_id: data.scope_task_id ?? null,
          period_start: periodStart.toISOString(),
          period_end: periodEnd.toISOString(),
          generated_summary: output,
          status: "draft",
        })
        .select()
        .single();
      if (insErr) throw new Error(insErr.message);
      return inserted;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("429")) throw new Error("Rate limit reached. Try again shortly.");
      if (msg.includes("402"))
        throw new Error("AI credits exhausted. Add credits in workspace settings.");
      throw err;
    }
  });
