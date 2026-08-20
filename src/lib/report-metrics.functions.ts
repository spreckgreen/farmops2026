import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  boundsAsStrings,
  buildProjectCounts,
  buildRatingSeries,
  metricsBounds,
  ratingAverages,
  totalsFromProjects,
  type MetricsMode,
  type ReportMetrics,
} from "./report-metrics";

const Input = z.object({
  mode: z.enum([
    "daily_recap",
    "weekly_report",
    "monthly_rollup",
    "quarter_review",
    "yearly_rollup",
    "project_rollup",
  ]),
});

export const getReportMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<ReportMetrics> => {
    const mode = data.mode as MetricsMode;
    const bounds = metricsBounds(mode, new Date());
    const { startDay, endDay, startIso, endIso } = boundsAsStrings(bounds);
    const sb = context.supabase;

    let notesQ = sb
      .from("daily_notes")
      .select("date, energy_level, productivity_level")
      .order("date");
    if (startDay && endDay) notesQ = notesQ.gte("date", startDay).lte("date", endDay);

    let tasksQ = sb.from("tasks").select("status, project_tags, created_at, closed_at");
    if (startIso && endIso) {
      tasksQ = tasksQ.or(
        `and(created_at.gte.${startIso},created_at.lte.${endIso}),and(closed_at.gte.${startIso},closed_at.lte.${endIso})`,
      );
    }

    const [notes, tasks] = await Promise.all([notesQ, tasksQ]);
    if (notes.error) throw new Error(notes.error.message);
    if (tasks.error) throw new Error(tasks.error.message);

    const ratings = buildRatingSeries(notes.data ?? []);
    const projects = buildProjectCounts(tasks.data ?? [], { startIso, endIso });

    return {
      mode,
      period_start: startIso,
      period_end: endIso,
      ratings,
      projects,
      totals: totalsFromProjects(projects),
      averages: ratingAverages(ratings),
    };
  });
