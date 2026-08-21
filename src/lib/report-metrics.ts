// Pure helpers for the quantitative side of Reports: energy/productivity
// ratings and task counts per project, scoped to a report period.
//
// Kept free of server imports so both the server function and the React
// chart component can use the same shaping logic (and so it stays testable).

export type MetricsMode =
  | "daily_recap"
  | "weekly_report"
  | "monthly_rollup"
  | "quarter_review"
  | "yearly_rollup"
  | "project_rollup";

export type RatingPoint = {
  date: string; // YYYY-MM-DD
  energy: number | null;
  productivity: number | null;
};

export type ProjectTaskCount = {
  project: string;
  created: number;
  closed: number;
  open: number;
  total: number;
};

export type ReportMetrics = {
  mode: MetricsMode;
  period_start: string | null;
  period_end: string | null;
  ratings: RatingPoint[];
  projects: ProjectTaskCount[];
  /** Every project tag present in the window, before any project filter. */
  available_projects?: string[];
  totals: { created: number; closed: number; open: number; total: number };
  averages: { energy: number | null; productivity: number | null; days: number };
};

const iso = (d: Date) => d.toISOString();
const day = (d: Date) => d.toISOString().slice(0, 10);

/** UTC period window for a report mode. Portfolio = full history (null). */
export function metricsBounds(
  mode: MetricsMode,
  ref: Date = new Date(),
): { start: Date; end: Date } | null {
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth();
  const mk = (a: Date, b: Date) => {
    const end = new Date(b);
    end.setUTCMilliseconds(end.getUTCMilliseconds() - 1);
    return { start: a, end };
  };
  switch (mode) {
    case "daily_recap": {
      const start = new Date(Date.UTC(y, m, ref.getUTCDate()));
      return mk(start, new Date(Date.UTC(y, m, ref.getUTCDate() + 1)));
    }
    case "weekly_report": {
      // Monday–Sunday week ending on the most recent Sunday.
      const dow = ref.getUTCDay(); // 0 Sun … 6 Sat
      const endDay = new Date(Date.UTC(y, m, ref.getUTCDate() - (dow === 0 ? 0 : dow)));
      const start = new Date(endDay);
      start.setUTCDate(start.getUTCDate() - 6);
      const endExclusive = new Date(endDay);
      endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
      return mk(start, endExclusive);
    }
    case "monthly_rollup":
      return mk(new Date(Date.UTC(y, m, 1)), new Date(Date.UTC(y, m + 1, 1)));
    case "quarter_review": {
      const qStart = Math.floor(m / 3) * 3;
      return mk(new Date(Date.UTC(y, qStart, 1)), new Date(Date.UTC(y, qStart + 3, 1)));
    }
    case "yearly_rollup":
      return mk(new Date(Date.UTC(y, 0, 1)), new Date(Date.UTC(y + 1, 0, 1)));
    case "project_rollup":
      return null;
  }
}

/**
 * Inclusive custom day range, e.g. customBounds("2026-08-01", "2026-08-20")
 * -> start 2026-08-01T00:00:00Z, end 2026-08-20T23:59:59.999Z.
 */
export function customBounds(startDay: string, endDay: string): { start: Date; end: Date } {
  const start = new Date(`${startDay}T00:00:00.000Z`);
  const end = new Date(`${endDay}T23:59:59.999Z`);
  return start <= end ? { start, end } : { start: end, end: start };
}

export function boundsAsStrings(b: { start: Date; end: Date } | null) {
  if (!b) return { startDay: null, endDay: null, startIso: null, endIso: null };
  return {
    startDay: day(b.start),
    endDay: day(b.end),
    startIso: iso(b.start),
    endIso: iso(b.end),
  };
}

type NoteRow = {
  date: string;
  energy_level: number | null;
  productivity_level: number | null;
};

type TaskRow = {
  status: string;
  project_tags: string[] | null;
  created_at: string;
  closed_at: string | null;
};

/** Build the rating series (one point per day with a rating), oldest first. */
export function buildRatingSeries(notes: NoteRow[]): RatingPoint[] {
  return notes
    .filter((n) => n.energy_level != null || n.productivity_level != null)
    .map((n) => ({
      date: n.date,
      energy: n.energy_level ?? null,
      productivity: n.productivity_level ?? null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function avg(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
}

export function ratingAverages(ratings: RatingPoint[]) {
  return {
    energy: avg(ratings.map((r) => r.energy).filter((v): v is number => v != null)),
    productivity: avg(
      ratings.map((r) => r.productivity).filter((v): v is number => v != null),
    ),
    days: ratings.length,
  };
}

/**
 * Task counts bucketed by project tag. A task counts toward a project when it
 * carries that `#project/<tag>`; untagged tasks fall under "Unassigned".
 * `created` = created inside the window, `closed` = closed inside the window,
 * `open` = currently not done. `total` = distinct tasks touching the window.
 */
export function buildProjectCounts(
  tasks: TaskRow[],
  window: { startIso: string | null; endIso: string | null },
): ProjectTaskCount[] {
  const inWindow = (at: string | null | undefined) => {
    if (!at) return false;
    if (!window.startIso || !window.endIso) return true;
    return at >= window.startIso && at <= window.endIso;
  };

  const map = new Map<string, ProjectTaskCount>();
  for (const t of tasks) {
    const tags = (t.project_tags ?? []).filter(Boolean);
    const keys = tags.length ? tags : ["Unassigned"];
    for (const k of keys) {
      const row =
        map.get(k) ?? { project: k, created: 0, closed: 0, open: 0, total: 0 };
      row.total += 1;
      if (inWindow(t.created_at)) row.created += 1;
      if (inWindow(t.closed_at)) row.closed += 1;
      if (t.status !== "done") row.open += 1;
      map.set(k, row);
    }
  }
  return [...map.values()].sort(
    (a, b) => b.created + b.closed - (a.created + a.closed) || a.project.localeCompare(b.project),
  );
}

export function totalsFromProjects(rows: ProjectTaskCount[]) {
  return rows.reduce(
    (acc, r) => ({
      created: acc.created + r.created,
      closed: acc.closed + r.closed,
      open: acc.open + r.open,
      total: acc.total + r.total,
    }),
    { created: 0, closed: 0, open: 0, total: 0 },
  );
}
