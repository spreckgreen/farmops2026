import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { generateText, Output } from "ai";

const SummaryInput = z.object({
  mode: z.enum(["task_update", "project_rollup", "weekly_report"]),
  scope_task_id: z.string().uuid().nullable().optional(),
  period_days: z.number().int().min(1).max(60).default(7),
});

const ProjectGroup = z.object({
  project: z.string(),
  summary: z.string(),
  highlights: z.array(z.string()),
});

const SummarySchema = z.object({
  summary: z.string(),
  key_decisions: z.array(z.string()),
  blockers: z.array(z.string()),
  next_steps: z.array(z.string()),
  by_project: z.array(ProjectGroup),
});

const MODE_INSTRUCTIONS: Record<string, string> = {
  task_update:
    "Write a 2-3 sentence progress note in past tense, no fluff. Focus on what actually happened.",
  project_rollup:
    "Produce a fresh rollup for ONE project covering its entire activity history to date. Re-summarize from scratch every run — features change during development, so do not assume any prior summary. Without a formal plan, treat this as a chronological status: where the project stands now, what has been accomplished, current blockers, and what is next. Use `summary` for the narrative (120-180 words), and populate key_decisions / blockers / next_steps. Leave `by_project` empty.",
  weekly_report:
    "Write an executive weekly report grouped by project. Populate `by_project`: one entry per distinct project tag in the activity (use 'Unassigned' for entries with no tag), each with a 2-3 sentence past-tense narrative and 2-5 highlight bullets scoped strictly to that project's entries. Then write `summary` as a 100-150 word executive overview that references the projects by name. Past tense, plain language, lead with outcomes.",
};

type EntryRow = {
  created_at: string;
  entry_type: string;
  raw_content: string;
  task_id: string | null;
  tasks: { title?: string; slug?: string; project_tags?: string[] } | null;
};

function formatEntries(entries: EntryRow[]): string {
  return entries
    .map((e) => {
      const tags = e.tasks?.project_tags ?? [];
      const projectLabel = tags.length
        ? tags.map((t) => `#project/${t}`).join(" ")
        : "#project/Unassigned";
      const t = e.tasks?.title;
      return `- [${e.created_at.slice(0, 10)}] [${e.entry_type}] ${projectLabel}${t ? ` (${t})` : ""} ${e.raw_content}`;
    })
    .join("\n");
}

export const generateSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SummaryInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - data.period_days * 24 * 60 * 60 * 1000);

    // project_rollup is a fresh resummarization of the entire project history;
    // weekly_report and task_update stay scoped to the rolling period.
    const useFullHistory = data.mode === "project_rollup";

    let q = supabase
      .from("activity_log")
      .select("created_at, entry_type, raw_content, task_id, tasks(title, slug, project_tags)")
      .order("created_at", { ascending: true });
    if (!useFullHistory) q = q.gte("created_at", periodStart.toISOString());
    if (data.scope_task_id) q = q.eq("task_id", data.scope_task_id);

    const { data: entriesRaw, error } = await q;
    if (error) throw new Error(error.message);
    const entries = (entriesRaw ?? []) as unknown as EntryRow[];

    if (entries.length === 0) {
      return {
        ok: false as const,
        error: useFullHistory
          ? "No activity logged yet — write a note first."
          : "No activity in this period yet — write a note first.",
      };
    }

    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(apiKey);

    const runOne = async (params: {
      scope_project: string | null;
      scope_task_id: string | null;
      entriesForScope: EntryRow[];
      extraContext?: string;
    }) => {
      const scopeHeader = params.scope_project
        ? `PROJECT: #project/${params.scope_project}`
        : "SCOPE: all activity";

      const prompt = `You are writing a fresh summary of an activity log. Re-summarize from scratch every time — do not assume any prior summary exists.

MODE: ${data.mode}
${scopeHeader}
INSTRUCTIONS: ${MODE_INSTRUCTIONS[data.mode]}
${params.extraContext ? `\n${params.extraContext}\n` : ""}
ACTIVITY ENTRIES (chronological, full scope being summarized):
${formatEntries(params.entriesForScope)}

Return a structured summary. ALWAYS include every field in the schema — use empty arrays ([]) for lists that don't apply and empty strings ("") for unused text fields. Never omit a field.`;

      const { experimental_output: output } = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        experimental_output: Output.object({ schema: SummarySchema }),
        prompt,
      });

      // Fresh resummarization: remove any prior summaries for the same mode + scope
      // so the list shows the latest take rather than an accumulating history.
      let delQ = supabase
        .from("summaries")
        .delete()
        .eq("user_id", userId)
        .eq("mode", data.mode);
      delQ = params.scope_task_id
        ? delQ.eq("scope_task_id", params.scope_task_id)
        : delQ.is("scope_task_id", null);
      delQ = params.scope_project
        ? delQ.eq("scope_project", params.scope_project)
        : delQ.is("scope_project", null);
      await delQ;

      const { data: inserted, error: insErr } = await supabase
        .from("summaries")
        .insert({
          user_id: userId,
          mode: data.mode,
          scope_task_id: params.scope_task_id,
          scope_project: params.scope_project,
          period_start: periodStart.toISOString(),
          period_end: periodEnd.toISOString(),
          generated_summary: output,
          status: "draft",
        })
        .select()
        .single();
      if (insErr) throw new Error(insErr.message);
      return inserted;
    };

    try {
      if (data.mode === "project_rollup" && !data.scope_task_id) {
        // Group entries by project tag; an entry with multiple tags appears in each.
        const groups = new Map<string, EntryRow[]>();
        for (const e of entries) {
          const tags = e.tasks?.project_tags ?? [];
          const keys = tags.length ? tags : ["Unassigned"];
          for (const k of keys) {
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k)!.push(e);
          }
        }

        const summaries = [];
        for (const [project, projectEntries] of groups) {
          const s = await runOne({
            scope_project: project,
            scope_task_id: null,
            entriesForScope: projectEntries,
          });
          summaries.push(s);
        }
        return { ok: true as const, summaries };
      }

      const summary = await runOne({
        scope_project: null,
        scope_task_id: data.scope_task_id ?? null,
        entriesForScope: entries,
      });
      return { ok: true as const, summary };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("429")) throw new Error("Rate limit reached. Try again shortly.");
      if (msg.includes("402"))
        throw new Error("AI credits exhausted. Add credits in workspace settings.");
      throw err;
    }
  });
