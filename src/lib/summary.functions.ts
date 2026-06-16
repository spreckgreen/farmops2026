import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { generateText } from "ai";

const SummaryInput = z.object({
  mode: z.enum([
    "task_update",
    "project_rollup",
    "weekly_report",
    "quarter_review",
    "daily_recap",
    "monthly_rollup",
    "yearly_rollup",
  ]),
  scope_task_id: z.string().uuid().nullable().optional(),
  period_days: z.number().int().min(1).max(60).default(7),
  // Optional: target a specific quarter when mode === "quarter_review".
  // When omitted, the server iterates the last 8 quarters (2 years).
  quarter: z
    .object({ year: z.number().int().min(2000).max(2100), q: z.number().int().min(1).max(4) })
    .optional(),
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

type SummaryOutput = z.infer<typeof SummarySchema>;

const MODE_INSTRUCTIONS: Record<string, string> = {
  task_update:
    "Write a 2-3 sentence progress note in past tense, no fluff. Focus on what actually happened.",
  project_rollup:
    "Produce a fresh running summary for ONE project covering its entire activity history to date. Re-summarize from scratch every run — features change during development, so do not assume any prior summary. Without a formal plan, treat this as a chronological status: where the project stands now, what has been accomplished, current blockers, and what is next. Use `summary` for the narrative (120-180 words), and populate key_decisions / blockers / next_steps. Leave `by_project` empty.",
  weekly_report:
    "Write an executive weekly status report covering ONE Monday-Sunday week (week ending Sunday). Populate `by_project`: one entry per distinct project tag in the activity (use 'Unassigned' for entries with no tag), each with a 2-3 sentence past-tense narrative and 2-5 highlight bullets scoped strictly to that project's entries. Then write `summary` as a 100-150 word executive overview that references the projects by name. Past tense, plain language, lead with outcomes.",
  quarter_review:
    "Write a quarterly review for ONE project covering ONE calendar quarter. Focus on what was completed in the quarter (especially tasks closed in-period), key decisions made, blockers encountered, and what is next for the project going into the following quarter. Use `summary` for a 120-180 word narrative. Populate key_decisions / blockers / next_steps. Leave `by_project` empty.",
  daily_recap:
    "Write a daily recap covering ONE calendar day of activity. Populate `by_project`: one entry per distinct project tag (use 'Unassigned' for entries with no tag), each with a 1-2 sentence past-tense narrative and 1-4 highlight bullets scoped strictly to that project's entries. Then write `summary` as a 60-100 word recap of the day. Past tense, plain language.",
  monthly_rollup:
    "Write a monthly project rollup for ONE project covering ONE calendar month. Focus on what was accomplished in the month, key decisions, blockers, and what is next. Use `summary` for an 80-140 word narrative. Populate key_decisions / blockers / next_steps. Leave `by_project` empty.",
  yearly_rollup:
    "Write a yearly project rollup for ONE project covering ONE calendar year. Focus on the year's accomplishments, key decisions, blockers encountered, and what is next going into the following year. Use `summary` for a 150-220 word narrative. Populate key_decisions / blockers / next_steps. Leave `by_project` empty.",
};

type EntryRow = {
  created_at: string;
  entry_type: string;
  raw_content: string;
  task_id: string | null;
  tasks: { title?: string; slug?: string; project_tags?: string[] } | null;
};

type TaskRow = {
  id: string;
  title: string | null;
  slug: string | null;
  status: string | null;
  closed_at: string | null;
  project_tags: string[] | null;
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

function extractJsonObject(raw: string): unknown {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("AI response was not JSON");
    return JSON.parse(stripped.slice(start, end + 1));
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function normalizeSummary(value: unknown): SummaryOutput {
  const obj = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const byProject = Array.isArray(obj.by_project)
    ? obj.by_project.map((item) => {
        const p = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        return {
          project: typeof p.project === "string" && p.project.trim() ? p.project : "Unassigned",
          summary: typeof p.summary === "string" ? p.summary : "",
          highlights: asStringArray(p.highlights),
        };
      })
    : [];

  return SummarySchema.parse({
    summary: typeof obj.summary === "string" ? obj.summary : "",
    key_decisions: asStringArray(obj.key_decisions),
    blockers: asStringArray(obj.blockers),
    next_steps: asStringArray(obj.next_steps),
    by_project: byProject,
  });
}

function buildFallbackSummary(
  entries: EntryRow[],
  mode: string,
  scopeProject: string | null,
): SummaryOutput {
  const first = entries[0]?.created_at?.slice(0, 10);
  const last = entries[entries.length - 1]?.created_at?.slice(0, 10);
  const projectLabel = scopeProject ? `#project/${scopeProject}` : "the selected activity";
  const recent = entries
    .slice(-4)
    .map((e) => e.raw_content.trim())
    .filter(Boolean)
    .join(" ");

  const summary = `${projectLabel} has ${entries.length} logged update${entries.length === 1 ? "" : "s"}${first && last ? ` from ${first} through ${last}` : ""}. ${recent || "The available entries were captured and can be rerun when more detail is logged."}`;

  const blockers = entries
    .filter((e) => /block|blocked|stuck|risk|issue|problem|waiting/i.test(e.raw_content))
    .map((e) => e.raw_content.trim())
    .slice(-5);

  const nextSteps = entries
    .filter((e) => /next|todo|follow.?up|plan|start|ship|finish/i.test(e.raw_content))
    .map((e) => e.raw_content.trim())
    .slice(-5);

  return {
    summary,
    key_decisions: [],
    blockers,
    next_steps: nextSteps,
    by_project:
      mode === "weekly_report"
        ? [
            {
              project: scopeProject ?? "Unassigned",
              summary,
              highlights: entries
                .slice(-5)
                .map((e) => e.raw_content.trim())
                .filter(Boolean),
            },
          ]
        : [],
  };
}

// ---- Date helpers --------------------------------------------------------

function pad(n: number, w = 2) {
  return String(n).padStart(w, "0");
}

function yyyymmdd(d: Date) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

// Returns Monday 00:00 UTC and Sunday 23:59:59.999 UTC for the week containing `ref`.
// If `ref` is Sunday, that Sunday IS the week-end.
function weekBoundsEndingSunday(ref: Date): { start: Date; end: Date } {
  const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  const dow = end.getUTCDay(); // 0 Sun..6 Sat
  const daysAfterSunday = dow === 0 ? 0 : dow; // distance from Sunday going forward (we walk back to previous Sun if not Sun)
  // Walk back to the most recent Sunday (today if today is Sunday)
  end.setUTCDate(end.getUTCDate() - daysAfterSunday + (dow === 0 ? 0 : 0));
  // ^ when dow !== 0, daysAfterSunday equals dow, which subtracts to the prior Sunday.
  end.setUTCHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  start.setUTCHours(0, 0, 0, 0);
  return { start, end };
}

function quarterBounds(year: number, q: number): { start: Date; end: Date } {
  const startMonth = (q - 1) * 3;
  const start = new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, startMonth + 3, 1, 0, 0, 0, 0));
  end.setUTCMilliseconds(end.getUTCMilliseconds() - 1);
  return { start, end };
}

function dayBounds(ref: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(start);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

function monthBounds(year: number, monthIdx: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, monthIdx, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIdx + 1, 1, 0, 0, 0, 0));
  end.setUTCMilliseconds(end.getUTCMilliseconds() - 1);
  return { start, end };
}

function yearBounds(year: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));
  end.setUTCMilliseconds(end.getUTCMilliseconds() - 1);
  return { start, end };
}

function lastNQuarters(n: number, ref = new Date()): { year: number; q: number }[] {
  const out: { year: number; q: number }[] = [];
  let year = ref.getUTCFullYear();
  let q = Math.floor(ref.getUTCMonth() / 3) + 1;
  for (let i = 0; i < n; i++) {
    out.push({ year, q });
    q -= 1;
    if (q < 1) {
      q = 4;
      year -= 1;
    }
  }
  return out;
}

// ---- Generate ------------------------------------------------------------

export const generateSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SummaryInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(apiKey);

    const callAi = async (prompt: string, entriesForScope: EntryRow[], scopeProject: string | null): Promise<SummaryOutput> => {
      const { text } = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        prompt,
      });
      try {
        return normalizeSummary(extractJsonObject(text));
      } catch {
        return buildFallbackSummary(entriesForScope, data.mode, scopeProject);
      }
    };

    const buildPrompt = (params: {
      scopeProject: string | null;
      entriesForScope: EntryRow[];
      extraContext?: string;
    }) => {
      const scopeHeader = params.scopeProject
        ? `PROJECT: #project/${params.scopeProject}`
        : "SCOPE: all activity";
      return `You are writing a fresh summary of an activity log. Re-summarize from scratch every time — do not assume any prior summary exists.

MODE: ${data.mode}
${scopeHeader}
INSTRUCTIONS: ${MODE_INSTRUCTIONS[data.mode]}
${params.extraContext ? `\n${params.extraContext}\n` : ""}
ACTIVITY ENTRIES (chronological, full scope being summarized):
${formatEntries(params.entriesForScope)}

Return only valid JSON with this exact shape:
{"summary":"","key_decisions":[],"blockers":[],"next_steps":[],"by_project":[{"project":"","summary":"","highlights":[]}]}
Use empty arrays ([]) for lists that don't apply and empty strings ("") for unused text fields. Never omit a field. Do not wrap the JSON in markdown.`;
    };

    type SummaryMode =
      | "task_update"
      | "project_rollup"
      | "weekly_report"
      | "quarter_review"
      | "daily_recap"
      | "monthly_rollup"
      | "yearly_rollup";
    type InsertRow = {
      mode: SummaryMode;
      scope_project: string | null;
      scope_task_id: string | null;
      period_start: string;
      period_end: string;
      display_title: string | null;
      output: SummaryOutput;
    };

    const insertSummary = async (row: InsertRow) => {
      // Replace any prior row for the same (mode, scope_project, scope_task_id, period).
      let delQ = supabase.from("summaries").delete().eq("user_id", userId).eq("mode", row.mode);
      delQ = row.scope_task_id ? delQ.eq("scope_task_id", row.scope_task_id) : delQ.is("scope_task_id", null);
      delQ = row.scope_project ? delQ.eq("scope_project", row.scope_project) : delQ.is("scope_project", null);
      if (row.mode === "weekly_report" || row.mode === "quarter_review") {
        delQ = delQ.eq("period_start", row.period_start).eq("period_end", row.period_end);
      }
      await delQ;

      const { data: inserted, error: insErr } = await supabase
        .from("summaries")
        .insert({
          user_id: userId,
          mode: row.mode,
          scope_task_id: row.scope_task_id,
          scope_project: row.scope_project,
          period_start: row.period_start,
          period_end: row.period_end,
          display_title: row.display_title,
          generated_summary: row.output,
          status: "draft",
        })
        .select()
        .single();
      if (insErr) throw new Error(insErr.message);
      return inserted!;
    };
    type InsertedSummary = Awaited<ReturnType<typeof insertSummary>>;

    try {
      // ----- WEEKLY REPORT: one row covering Mon-Sun ending Sunday ----------
      if (data.mode === "weekly_report") {
        const { start, end } = weekBoundsEndingSunday(new Date());
        const { data: entriesRaw, error } = await supabase
          .from("activity_log")
          .select("created_at, entry_type, raw_content, task_id, tasks(title, slug, project_tags)")
          .gte("created_at", start.toISOString())
          .lte("created_at", end.toISOString())
          .order("created_at", { ascending: true });
        if (error) throw new Error(error.message);
        const entries = (entriesRaw ?? []) as unknown as EntryRow[];
        if (entries.length === 0) {
          return {
            ok: false as const,
            error: `No activity logged for week ending ${end.toISOString().slice(0, 10)}.`,
          };
        }
        const output = await callAi(
          buildPrompt({
            scopeProject: null,
            entriesForScope: entries,
            extraContext: `WEEK BOUNDS: ${start.toISOString().slice(0, 10)} (Mon) through ${end.toISOString().slice(0, 10)} (Sun, week-ending).`,
          }),
          entries,
          null,
        );
        const summary = await insertSummary({
          mode: "weekly_report",
          scope_project: null,
          scope_task_id: null,
          period_start: start.toISOString(),
          period_end: end.toISOString(),
          display_title: null,
          output,
        });
        return { ok: true as const, summary };
      }

      // ----- DAILY RECAP: one row covering today (UTC) ---------------------
      if (data.mode === "daily_recap") {
        const { start, end } = dayBounds(new Date());
        const { data: entriesRaw, error } = await supabase
          .from("activity_log")
          .select("created_at, entry_type, raw_content, task_id, tasks(title, slug, project_tags)")
          .gte("created_at", start.toISOString())
          .lte("created_at", end.toISOString())
          .order("created_at", { ascending: true });
        if (error) throw new Error(error.message);
        const entries = (entriesRaw ?? []) as unknown as EntryRow[];
        if (entries.length === 0) {
          return {
            ok: false as const,
            error: `No activity logged for ${end.toISOString().slice(0, 10)}.`,
          };
        }
        const output = await callAi(
          buildPrompt({
            scopeProject: null,
            entriesForScope: entries,
            extraContext: `DAY: ${start.toISOString().slice(0, 10)}.`,
          }),
          entries,
          null,
        );
        const summary = await insertSummary({
          mode: "daily_recap",
          scope_project: null,
          scope_task_id: null,
          period_start: start.toISOString(),
          period_end: end.toISOString(),
          display_title: `Daily Recap ${start.toISOString().slice(0, 10)}`,
          output,
        });
        return { ok: true as const, summary };
      }

      // ----- MONTHLY ROLLUP: per-project for the current calendar month ----
      if (data.mode === "monthly_rollup") {
        const now = new Date();
        const { start, end } = monthBounds(now.getUTCFullYear(), now.getUTCMonth());
        const yLabel = `${start.getUTCFullYear()}${pad(start.getUTCMonth() + 1)}`;
        const { data: entriesRaw, error } = await supabase
          .from("activity_log")
          .select("created_at, entry_type, raw_content, task_id, tasks(title, slug, project_tags)")
          .gte("created_at", start.toISOString())
          .lte("created_at", end.toISOString())
          .order("created_at", { ascending: true });
        if (error) throw new Error(error.message);
        const entries = (entriesRaw ?? []) as unknown as EntryRow[];
        if (entries.length === 0) {
          return { ok: false as const, error: `No activity logged for ${yLabel}.` };
        }
        const projects = new Map<string, EntryRow[]>();
        for (const e of entries) {
          const tags = e.tasks?.project_tags ?? [];
          const keys = tags.length ? tags : ["Unassigned"];
          for (const k of keys) {
            if (!projects.has(k)) projects.set(k, []);
            projects.get(k)!.push(e);
          }
        }
        const summaries: InsertedSummary[] = [];
        for (const [project, projectEntries] of projects) {
          const output = await callAi(
            buildPrompt({
              scopeProject: project,
              entriesForScope: projectEntries,
              extraContext: `MONTH: ${yLabel} — ${start.toISOString().slice(0, 10)} through ${end.toISOString().slice(0, 10)}.`,
            }),
            projectEntries,
            project,
          );
          const inserted = await insertSummary({
            mode: "monthly_rollup",
            scope_project: project,
            scope_task_id: null,
            period_start: start.toISOString(),
            period_end: end.toISOString(),
            display_title: `Monthly Rollup ${yLabel} — #project/${project}`,
            output,
          });
          summaries.push(inserted);
        }
        if (summaries.length === 0) {
          return { ok: false as const, error: `No project activity in ${yLabel}.` };
        }
        return { ok: true as const, summaries };
      }

      // ----- YEARLY ROLLUP: per-project for the current calendar year ------
      if (data.mode === "yearly_rollup") {
        const now = new Date();
        const { start, end } = yearBounds(now.getUTCFullYear());
        const yLabel = `${start.getUTCFullYear()}`;
        const { data: entriesRaw, error } = await supabase
          .from("activity_log")
          .select("created_at, entry_type, raw_content, task_id, tasks(title, slug, project_tags)")
          .gte("created_at", start.toISOString())
          .lte("created_at", end.toISOString())
          .order("created_at", { ascending: true });
        if (error) throw new Error(error.message);
        const entries = (entriesRaw ?? []) as unknown as EntryRow[];
        if (entries.length === 0) {
          return { ok: false as const, error: `No activity logged for ${yLabel}.` };
        }
        const projects = new Map<string, EntryRow[]>();
        for (const e of entries) {
          const tags = e.tasks?.project_tags ?? [];
          const keys = tags.length ? tags : ["Unassigned"];
          for (const k of keys) {
            if (!projects.has(k)) projects.set(k, []);
            projects.get(k)!.push(e);
          }
        }
        const summaries: InsertedSummary[] = [];
        for (const [project, projectEntries] of projects) {
          const output = await callAi(
            buildPrompt({
              scopeProject: project,
              entriesForScope: projectEntries,
              extraContext: `YEAR: ${yLabel} — ${start.toISOString().slice(0, 10)} through ${end.toISOString().slice(0, 10)}.`,
            }),
            projectEntries,
            project,
          );
          const inserted = await insertSummary({
            mode: "yearly_rollup",
            scope_project: project,
            scope_task_id: null,
            period_start: start.toISOString(),
            period_end: end.toISOString(),
            display_title: `Yearly Rollup ${yLabel} — #project/${project}`,
            output,
          });
          summaries.push(inserted);
        }
        if (summaries.length === 0) {
          return { ok: false as const, error: `No project activity in ${yLabel}.` };
        }
        return { ok: true as const, summaries };
      }




      // ----- QUARTER REVIEW: per-quarter, per-project ----------------------
      if (data.mode === "quarter_review") {
        const quarters = data.quarter ? [data.quarter] : lastNQuarters(8);
        const summaries: InsertedSummary[] = [];

        for (const qq of quarters) {
          const { start, end } = quarterBounds(qq.year, qq.q);
          const qLabel = `${qq.year}Q${pad(qq.q)}`;

          const [{ data: entriesRaw, error: eErr }, { data: tasksRaw, error: tErr }] =
            await Promise.all([
              supabase
                .from("activity_log")
                .select("created_at, entry_type, raw_content, task_id, tasks(title, slug, project_tags)")
                .gte("created_at", start.toISOString())
                .lte("created_at", end.toISOString())
                .order("created_at", { ascending: true }),
              supabase
                .from("tasks")
                .select("id, title, slug, status, closed_at, project_tags")
                .gte("closed_at", start.toISOString())
                .lte("closed_at", end.toISOString()),
            ]);
          if (eErr) throw new Error(eErr.message);
          if (tErr) throw new Error(tErr.message);

          const entries = (entriesRaw ?? []) as unknown as EntryRow[];
          const closedTasks = (tasksRaw ?? []) as unknown as TaskRow[];

          // Group projects from entries + closed tasks.
          const projects = new Map<string, { entries: EntryRow[]; closed: TaskRow[] }>();
          const bucket = (key: string) => {
            if (!projects.has(key)) projects.set(key, { entries: [], closed: [] });
            return projects.get(key)!;
          };
          for (const e of entries) {
            const tags = e.tasks?.project_tags ?? [];
            const keys = tags.length ? tags : ["Unassigned"];
            for (const k of keys) bucket(k).entries.push(e);
          }
          for (const t of closedTasks) {
            const tags = t.project_tags ?? [];
            const keys = tags.length ? tags : ["Unassigned"];
            for (const k of keys) bucket(k).closed.push(t);
          }

          if (projects.size === 0) continue;

          for (const [project, group] of projects) {
            const closedList = group.closed
              .map((t) => `- ${t.title ?? t.slug ?? t.id} (closed ${t.closed_at?.slice(0, 10)})`)
              .join("\n");
            const extra =
              `QUARTER: ${qLabel} — ${start.toISOString().slice(0, 10)} through ${end.toISOString().slice(0, 10)}.\n` +
              (closedList ? `TASKS CLOSED IN QUARTER (#project/${project}):\n${closedList}` : `No tasks closed in quarter for #project/${project}.`);

            // Skip empty quarters for this project (no entries AND no closures).
            if (group.entries.length === 0 && group.closed.length === 0) continue;

            const output = await callAi(
              buildPrompt({
                scopeProject: project,
                entriesForScope: group.entries,
                extraContext: extra,
              }),
              group.entries,
              project,
            );
            const inserted = await insertSummary({
              mode: "quarter_review",
              scope_project: project,
              scope_task_id: null,
              period_start: start.toISOString(),
              period_end: end.toISOString(),
              display_title: `Quarter Review ${qLabel} — #project/${project}`,
              output,
            });
            summaries.push(inserted);
          }
        }

        if (summaries.length === 0) {
          return { ok: false as const, error: "No activity or closed tasks in the last 2 years." };
        }
        return { ok: true as const, summaries };
      }

      // ----- PROJECT ROLLUP: per-project running summary across full history
      if (data.mode === "project_rollup" && !data.scope_task_id) {
        const { data: entriesRaw, error } = await supabase
          .from("activity_log")
          .select("created_at, entry_type, raw_content, task_id, tasks(title, slug, project_tags)")
          .order("created_at", { ascending: true });
        if (error) throw new Error(error.message);
        const entries = (entriesRaw ?? []) as unknown as EntryRow[];
        if (entries.length === 0) {
          return { ok: false as const, error: "No activity logged yet — write a note first." };
        }

        const groups = new Map<string, EntryRow[]>();
        for (const e of entries) {
          const tags = e.tasks?.project_tags ?? [];
          const keys = tags.length ? tags : ["Unassigned"];
          for (const k of keys) {
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k)!.push(e);
          }
        }

        const summaries: InsertedSummary[] = [];
        const now = new Date();
        const farPast = new Date(0);
        for (const [project, projectEntries] of groups) {
          const output = await callAi(
            buildPrompt({ scopeProject: project, entriesForScope: projectEntries }),
            projectEntries,
            project,
          );
          const inserted = await insertSummary({
            mode: "project_rollup",
            scope_project: project,
            scope_task_id: null,
            period_start: farPast.toISOString(),
            period_end: now.toISOString(),
            display_title: `Running Summary — #project/${project}`,
            output,
          });
          summaries.push(inserted);
        }
        return { ok: true as const, summaries };
      }

      // ----- TASK UPDATE (or scoped project_rollup) ------------------------
      const periodEnd = new Date();
      const periodStart = new Date(periodEnd.getTime() - data.period_days * 24 * 60 * 60 * 1000);
      let q = supabase
        .from("activity_log")
        .select("created_at, entry_type, raw_content, task_id, tasks(title, slug, project_tags)")
        .order("created_at", { ascending: true });
      if (data.mode !== "project_rollup") q = q.gte("created_at", periodStart.toISOString());
      if (data.scope_task_id) q = q.eq("task_id", data.scope_task_id);
      const { data: entriesRaw, error } = await q;
      if (error) throw new Error(error.message);
      const entries = (entriesRaw ?? []) as unknown as EntryRow[];
      if (entries.length === 0) {
        return { ok: false as const, error: "No activity in this period yet — write a note first." };
      }

      const output = await callAi(
        buildPrompt({ scopeProject: null, entriesForScope: entries }),
        entries,
        null,
      );
      const title =
        data.mode === "task_update"
          ? `Task Update ${periodEnd.toISOString().slice(0, 10)}`
          : `Summary ${periodEnd.toISOString().slice(0, 10)}`;
      const summary = await insertSummary({
        mode: data.mode,
        scope_project: null,
        scope_task_id: data.scope_task_id ?? null,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        display_title: title,
        output,
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
