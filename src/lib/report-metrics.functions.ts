import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  boundsAsStrings,
  customBounds,
  buildProjectCounts,
  buildRatingSeries,
  metricsBounds,
  ratingAverages,
  totalsFromProjects,
  type MetricsMode,
  type ReportMetrics,
} from "./report-metrics";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const Input = z.object({
  mode: z.enum([
    "daily_recap",
    "weekly_report",
    "monthly_rollup",
    "quarter_review",
    "yearly_rollup",
    "project_rollup",
  ]),
  // Optional custom window (inclusive days, e.g. 2026-08-01 … 2026-08-20).
  // When present it overrides the mode's default period.
  startDate: z.string().regex(DAY).optional(),
  endDate: z.string().regex(DAY).optional(),
  // Optional project tag filter, e.g. "boiler" for #project/boiler.
  project: z.string().min(1).optional(),
});

export const getReportMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<ReportMetrics> => {
    const mode = data.mode as MetricsMode;
    const custom =
      data.startDate && data.endDate
        ? customBounds(data.startDate, data.endDate)
        : undefined;
    const bounds = custom ?? metricsBounds(mode, new Date());
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
    const allProjects = buildProjectCounts(tasks.data ?? [], { startIso, endIso });
    const projects = data.project
      ? allProjects.filter((p) => p.project === data.project)
      : allProjects;


    return {
      mode,
      period_start: startIso,
      period_end: endIso,
      ratings,
      projects,
      available_projects: allProjects.map((p) => p.project),
      totals: totalsFromProjects(projects),
      averages: ratingAverages(ratings),
    };
  });
