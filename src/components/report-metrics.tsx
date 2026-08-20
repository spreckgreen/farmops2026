// Quantitative panel shown above each report: energy/productivity indicators
// (dots for a single day, plotted lines for week/month/quarter/year) plus a
// task-count-by-project table for the same period.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Battery, Gauge } from "lucide-react";
import { getReportMetrics } from "@/lib/report-metrics.functions";
import { RATING_LABELS, ratingSwatchClass } from "@/components/daily-rating";
import type { MetricsMode } from "@/lib/report-metrics";

const PLOTTED: MetricsMode[] = [
  "weekly_report",
  "monthly_rollup",
  "quarter_review",
  "yearly_rollup",
];

function RatingBadge({
  label,
  icon,
  level,
}: {
  label: string;
  icon: React.ReactNode;
  level: number | null;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={`h-3.5 w-3.5 rounded-full ${ratingSwatchClass(level ? Math.round(level) : null)}`}
        aria-hidden
      />
      <span className="text-xs font-mono">
        {level != null ? level : "—"}
        {level != null ? ` · ${RATING_LABELS[Math.round(level)] ?? ""}` : ""}
      </span>
    </div>
  );
}

export function ReportMetricsPanel({ mode }: { mode: MetricsMode }) {
  const fn = useServerFn(getReportMetrics);
  const q = useQuery({
    queryKey: ["report-metrics", mode],
    queryFn: () => fn({ data: { mode } }),
  });

  const data = q.data;
  const plotted = PLOTTED.includes(mode);
  const chartData = useMemo(
    () =>
      (data?.ratings ?? []).map((r) => ({
        day: r.date.slice(5),
        Energy: r.energy,
        Productivity: r.productivity,
      })),
    [data?.ratings],
  );

  if (q.isLoading) {
    return (
      <div className="mb-4 rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground font-mono">
        Loading indicators…
      </div>
    );
  }
  if (!data) return null;

  const hasRatings = data.ratings.length > 0;
  const hasProjects = data.projects.length > 0;
  if (!hasRatings && !hasProjects) return null;

  return (
    <div className="mb-4 rounded-lg border border-border bg-card p-4 space-y-5">
      <section>
        <h2 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
          Energy &amp; productivity
        </h2>
        {!hasRatings ? (
          <p className="text-xs text-muted-foreground">
            No energy or productivity ratings recorded in this period.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-2 mb-3">
              <RatingBadge
                label={plotted ? "Avg energy" : "Energy"}
                icon={<Battery className="h-3.5 w-3.5" />}
                level={data.averages.energy}
              />
              <RatingBadge
                label={plotted ? "Avg productivity" : "Productivity"}
                icon={<Gauge className="h-3.5 w-3.5" />}
                level={data.averages.productivity}
              />
              <span className="text-xs text-muted-foreground font-mono self-center">
                {data.averages.days} day{data.averages.days === 1 ? "" : "s"} rated
              </span>
            </div>
            {plotted && chartData.length > 1 && (
              <div className="h-48 -ml-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                      stroke="var(--border)"
                    />
                    <YAxis
                      domain={[1, 5]}
                      ticks={[1, 2, 3, 4, 5]}
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                      stroke="var(--border)"
                      width={24}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        fontSize: 12,
                        color: "var(--foreground)",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="Energy"
                      stroke="var(--chart-2)"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="Productivity"
                      stroke="var(--chart-3)"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            {plotted && chartData.length <= 1 && (
              <p className="text-xs text-muted-foreground">
                At least two rated days are needed to plot a trend.
              </p>
            )}
            {!plotted && (
              <div className="flex flex-wrap gap-2">
                {data.ratings.map((r) => (
                  <span
                    key={r.date}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-mono"
                  >
                    {r.date.slice(5)}
                    <span className={`h-2.5 w-2.5 rounded-full ${ratingSwatchClass(r.energy)}`} />
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${ratingSwatchClass(r.productivity)}`}
                    />
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section>
        <h2 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
          Tasks by project
        </h2>
        {!hasProjects ? (
          <p className="text-xs text-muted-foreground">No task activity in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  <th className="text-left py-1 pr-3">Project</th>
                  <th className="text-right py-1 px-2">Created</th>
                  <th className="text-right py-1 px-2">Closed</th>
                  <th className="text-right py-1 px-2">Open</th>
                  <th className="text-right py-1 pl-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.projects.map((p) => (
                  <tr key={p.project} className="border-t border-border">
                    <td className="py-1 pr-3 font-mono text-xs">
                      {p.project === "Unassigned" ? "Unassigned" : `#project/${p.project}`}
                    </td>
                    <td className="py-1 px-2 text-right font-mono text-xs">{p.created}</td>
                    <td className="py-1 px-2 text-right font-mono text-xs">{p.closed}</td>
                    <td className="py-1 px-2 text-right font-mono text-xs">{p.open}</td>
                    <td className="py-1 pl-2 text-right font-mono text-xs">{p.total}</td>
                  </tr>
                ))}
                <tr className="border-t border-border font-semibold">
                  <td className="py-1 pr-3 font-mono text-xs">All projects</td>
                  <td className="py-1 px-2 text-right font-mono text-xs">{data.totals.created}</td>
                  <td className="py-1 px-2 text-right font-mono text-xs">{data.totals.closed}</td>
                  <td className="py-1 px-2 text-right font-mono text-xs">{data.totals.open}</td>
                  <td className="py-1 pl-2 text-right font-mono text-xs">{data.totals.total}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
