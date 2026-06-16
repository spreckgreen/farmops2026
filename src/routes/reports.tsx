import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { listSummaries, updateSummary, getLatestDataChange } from "@/lib/log.functions";
import { generateSummary } from "@/lib/summary.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { toast } from "sonner";
import { format } from "date-fns";
import { Download, RefreshCw } from "lucide-react";
import {
  assembleTiddlyWiki,
  downloadHtml,
  loadTemplate,
  tiddlersFromSummaries,
  type SummaryRow,
} from "@/lib/tiddlywiki-export";
import { TiddlyWikiImportButton } from "@/components/tiddlywiki-import-button";

export const Route = createFileRoute("/reports")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({ meta: [{ title: "Reports — Bostead Farms" }] }),
  component: ReportsPage,
});

type SummaryShape = {
  summary: string;
  key_decisions: string[];
  blockers: string[];
  next_steps: string[];
  by_project?: { project: string; summary: string; highlights: string[] }[];
};

type ReportMode =
  | "daily_recap"
  | "weekly_report"
  | "monthly_rollup"
  | "quarter_review"
  | "yearly_rollup"
  | "project_rollup";

const TABS: { mode: ReportMode; label: string }[] = [
  { mode: "daily_recap", label: "Daily" },
  { mode: "weekly_report", label: "Weekly" },
  { mode: "monthly_rollup", label: "Monthly" },
  { mode: "quarter_review", label: "Quarterly" },
  { mode: "yearly_rollup", label: "Yearly" },
  { mode: "project_rollup", label: "Portfolio" },
];

const LABELS: Record<ReportMode, string> = {
  daily_recap: "Daily Recap",
  weekly_report: "Weekly Status",
  monthly_rollup: "Monthly Projects",
  quarter_review: "Quarterly Projects",
  yearly_rollup: "Yearly Projects",
  project_rollup: "Portfolio",
};

function ReportsPage() {
  const listFn = useServerFn(listSummaries);
  const updateFn = useServerFn(updateSummary);
  const generateFn = useServerFn(generateSummary);
  const freshnessFn = useServerFn(getLatestDataChange);
  const qc = useQueryClient();

  const [activeMode, setActiveMode] = useState<ReportMode>("daily_recap");

  const summariesQ = useQuery({ queryKey: ["summaries"], queryFn: () => listFn() });
  const freshnessQ = useQuery({
    queryKey: ["reports", "latest-data-change"],
    queryFn: () => freshnessFn(),
  });

  const runReport = useMutation({
    mutationFn: (mode: ReportMode) => generateFn({ data: { mode, period_days: 7 } }),
    onSuccess: (res, mode) => {
      if (!res.ok) {
        toast.info(res.error);
        return;
      }
      const count = "summaries" in res && res.summaries ? res.summaries.length : 1;
      toast.success(`${LABELS[mode]} drafted (${count})`);
      qc.invalidateQueries({ queryKey: ["summaries"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "draft" | "reviewed" | "published" }) =>
      updateFn({ data: { id, status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["summaries"] }),
  });

  // Filter summaries to the active tab.
  const visible = useMemo(
    () => (summariesQ.data ?? []).filter((s) => s.mode === activeMode),
    [summariesQ.data, activeMode],
  );

  // Newest summary for this mode (summaries are listed in desc order already).
  const latestForMode = visible[0];
  const latestDataChange = freshnessQ.data?.latest_at ?? null;
  const sources = freshnessQ.data?.sources ?? { today_at: null, tasks_at: null, projects_at: null };

  const baseline = latestForMode ? new Date(latestForMode.created_at).getTime() : 0;
  const SOURCE_LABELS: Record<keyof typeof sources, string> = {
    today_at: "Today",
    tasks_at: "Tasks",
    projects_at: "Projects",
  };
  const newerSources = (Object.keys(sources) as Array<keyof typeof sources>)
    .map((k) => ({ key: k, label: SOURCE_LABELS[k], at: sources[k] }))
    .filter((s): s is { key: keyof typeof sources; label: string; at: string } =>
      typeof s.at === "string" && new Date(s.at).getTime() > baseline,
    )
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const isStale = !latestForMode
    ? true
    : latestDataChange
      ? new Date(latestDataChange).getTime() > baseline
      : false;

  // Auto-generate-on-tab-switch when stale. Guard against re-firing while a
  // generation is in flight and against re-running for the same mode after the
  // user dismisses it.
  const autoFiredRef = useRef<Set<ReportMode>>(new Set());
  useEffect(() => {
    if (summariesQ.isLoading || freshnessQ.isLoading) return;
    if (runReport.isPending) return;
    if (!isStale) return;
    if (autoFiredRef.current.has(activeMode)) return;
    autoFiredRef.current.add(activeMode);
    runReport.mutate(activeMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMode, isStale, summariesQ.isLoading, freshnessQ.isLoading]);

  // When underlying data changes, allow auto-fire to run again per tab.
  useEffect(() => {
    autoFiredRef.current.clear();
  }, [latestDataChange]);

  const pendingForActive = runReport.isPending && runReport.variables === activeMode;

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
          <h1 className="text-2xl font-mono font-bold">Reports</h1>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              disabled={!summariesQ.data || summariesQ.data.length === 0}
              onClick={async () => {
                try {
                  const tpl = await loadTemplate();
                  const tiddlers = tiddlersFromSummaries((summariesQ.data ?? []) as SummaryRow[]);
                  const html = assembleTiddlyWiki(tpl, tiddlers, {
                    siteTitle: "Bostead Farms — Reports",
                    subtitle: "Activity reports export",
                    defaultTiddlers: ["Summaries"],
                  });
                  const stamp = format(new Date(), "yyyyMMdd-HHmm");
                  downloadHtml(`bostead-reports-${stamp}.html`, html);
                  toast.success("TiddlyWiki export downloaded");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Export failed");
                }
              }}
            >
              <Download className="h-4 w-4 mr-1.5" />
              Export TiddlyWiki
            </Button>
            <TiddlyWikiImportButton kind="summaries" />
          </div>
        </div>

        <Tabs value={activeMode} onValueChange={(v) => setActiveMode(v as ReportMode)}>
          <TabsList className="flex flex-wrap h-auto mb-4">
            {TABS.map((t) => {
              const latest = (summariesQ.data ?? []).find((s) => s.mode === t.mode);
              const tabStale = !latest
                ? true
                : latestDataChange
                  ? new Date(latestDataChange).getTime() > new Date(latest.created_at).getTime()
                  : false;
              return (
                <TabsTrigger key={t.mode} value={t.mode} className="gap-1.5">
                  {t.label}
                  {tabStale && (
                    <span
                      aria-label="stale"
                      className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
                    />
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        {isStale && !pendingForActive && (
          <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                  <span className="font-mono text-xs uppercase tracking-wider">
                    {latestForMode ? "Out of date" : "Not generated yet"}
                  </span>
                </div>
                {latestForMode && (
                  <p className="text-xs text-muted-foreground">
                    Last {LABELS[activeMode]} generated{" "}
                    <span className="font-mono">
                      {format(new Date(latestForMode.created_at), "MMM d, HH:mm")}
                    </span>
                    .
                  </p>
                )}
                {newerSources.length > 0 ? (
                  <ul className="text-xs space-y-0.5">
                    {newerSources.map((s) => (
                      <li key={s.key}>
                        <span className="font-mono uppercase tracking-wider">{s.label}</span>{" "}
                        changed{" "}
                        <span className="font-mono">
                          {format(new Date(s.at), "MMM d, HH:mm")}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  !latestForMode && (
                    <p className="text-xs text-muted-foreground">
                      Log activity in Today, Tasks, or Projects and this report will generate.
                    </p>
                  )
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={pendingForActive}
                onClick={() => {
                  autoFiredRef.current.add(activeMode);
                  runReport.mutate(activeMode);
                }}
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${pendingForActive ? "animate-spin" : ""}`} />
                {pendingForActive ? "Generating…" : "Regenerate"}
              </Button>
            </div>
          </div>
        )}

        {!isStale && (
          <div className="flex items-center justify-between mb-4 text-xs text-muted-foreground font-mono">
            <span>
              {LABELS[activeMode]} · up to date
              {latestForMode && ` · ${format(new Date(latestForMode.created_at), "MMM d, HH:mm")}`}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={pendingForActive}
              onClick={() => {
                autoFiredRef.current.add(activeMode);
                runReport.mutate(activeMode);
              }}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${pendingForActive ? "animate-spin" : ""}`} />
              Regenerate
            </Button>
          </div>
        )}

        {pendingForActive && visible.length === 0 && (
          <p className="text-sm text-muted-foreground">Generating {LABELS[activeMode]}…</p>
        )}
        {!pendingForActive && visible.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No {LABELS[activeMode]} yet. Log activity first, then it will generate automatically.
          </p>
        )}

        <ul className="space-y-4">
          {visible.map((s) => {
            const body = (s.edited_summary ?? s.generated_summary) as SummaryShape;
            const scope = (s as { scope_task?: { slug?: string; title?: string } | null }).scope_task;
            return (
              <li key={s.id} className="border border-border rounded-lg p-5 bg-card">
                {(s as { display_title?: string | null }).display_title && (
                  <h2 className="text-lg font-mono font-semibold mb-2">
                    {(s as { display_title?: string }).display_title}
                  </h2>
                )}
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-[10px] uppercase">{s.mode}</Badge>
                    {(s as { scope_project?: string | null }).scope_project && (
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        #project/{(s as { scope_project?: string }).scope_project}
                      </Badge>
                    )}
                    {scope?.title && <span className="text-xs text-muted-foreground">→ {scope.title}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={s.status === "published" ? "default" : "secondary"}>{s.status}</Badge>
                    <span className="text-xs text-muted-foreground font-mono">
                      {format(new Date(s.created_at), "MMM d")}
                    </span>
                  </div>
                </div>
                <p className="text-sm leading-relaxed mb-3 whitespace-pre-line">{body.summary}</p>

                {body.by_project && body.by_project.length > 0 && (
                  <div className="mb-3 space-y-3 border-l-2 border-border pl-3">
                    {body.by_project.map((p, i) => (
                      <div key={i}>
                        <h3 className="text-xs font-mono uppercase tracking-wider mb-1">
                          #project/{p.project}
                        </h3>
                        <p className="text-sm leading-relaxed mb-1">{p.summary}</p>
                        {p.highlights?.length > 0 && (
                          <ul className="list-disc list-inside text-sm space-y-0.5 marker:text-muted-foreground">
                            {p.highlights.map((h, j) => <li key={j}>{h}</li>)}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {body.key_decisions?.length > 0 && (
                  <ReportSection title="Decisions" items={body.key_decisions} />
                )}
                {body.blockers?.length > 0 && (
                  <ReportSection title="Blockers" items={body.blockers} />
                )}
                {body.next_steps?.length > 0 && (
                  <ReportSection title="Next" items={body.next_steps} />
                )}

                <div className="flex gap-2 mt-4">
                  {s.status === "draft" && (
                    <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: s.id, status: "reviewed" })}>
                      Mark reviewed
                    </Button>
                  )}
                  {s.status !== "published" && (
                    <Button size="sm" onClick={() => setStatus.mutate({ id: s.id, status: "published" })}>
                      Publish
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </AppLayout>
  );
}

function ReportSection({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mb-2">
      <h3 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">{title}</h3>
      <ul className="list-disc list-inside text-sm space-y-0.5 marker:text-muted-foreground">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
}
