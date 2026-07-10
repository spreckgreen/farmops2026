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
import { useAiUnavailable } from "@/hooks/use-self-host-config";
import { toast } from "sonner";
import { format } from "date-fns";
import { Download, Eye, RefreshCw } from "lucide-react";
import {
  assembleTiddlyWiki,
  downloadHtml,
  loadTemplate,
  tiddlersFromSummaries,
  type SummaryRow,
} from "@/lib/tiddlywiki-export";
import { TiddlyWikiImportButton } from "@/components/tiddlywiki-import-button";
import { CsvToolbar } from "@/components/csv-toolbar";
import { renderSummaryFile } from "@/lib/obsidian-markdown";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { SendToGhostButton } from "@/components/send-to-ghost-button";
import { activitySummaryToGhost } from "@/lib/report-html";

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
  const aiOff = useAiUnavailable();

  const [activeMode, setActiveMode] = useState<ReportMode>("daily_recap");
  const [previewOpen, setPreviewOpen] = useState(false);

  const summariesQ = useQuery({ queryKey: ["summaries"], queryFn: () => listFn() });
  const freshnessQ = useQuery({
    queryKey: ["reports", "latest-data-change"],
    queryFn: () => freshnessFn(),
  });

  // Per-mode snapshot of `latestDataChange` for which regen returned
  // "no activity". Used to suppress the stale banner — otherwise modes whose
  // period has no activity (e.g. weekly with nothing logged this week) loop
  // forever: stale → regen → ok:false → still stale.
  const [noDataAt, setNoDataAt] = useState<Partial<Record<ReportMode, string | null>>>({});
  // Snapshot of `latestDataChange` captured at the moment a mode was
  // successfully (re)generated. Used as a freshness baseline so that clock
  // skew between `summary.created_at` and source-table timestamps can't make
  // a just-regen'd report read as stale.
  const [coveredAt, setCoveredAt] = useState<Partial<Record<ReportMode, string | null>>>({});

  const runReport = useMutation({
    mutationFn: (mode: ReportMode) => generateFn({ data: { mode, period_days: 7 } }),
    onSuccess: async (res, mode) => {
      if (!res.ok) {
        toast.info(res.error);
        setNoDataAt((m) => ({ ...m, [mode]: latestDataChange ?? null }));
        return;
      }
      const count = "summaries" in res && res.summaries ? res.summaries.length : 1;
      toast.success(`${LABELS[mode]} drafted (${count})`);
      setNoDataAt((m) => ({ ...m, [mode]: undefined }));
      // Re-read freshness AFTER regen, then snapshot it as the covered marker
      // so subsequent isStale checks compare against this exact data state.
      await qc.invalidateQueries({ queryKey: ["reports", "latest-data-change"] });
      const fresh = await qc.fetchQuery({
        queryKey: ["reports", "latest-data-change"],
        queryFn: () => freshnessFn(),
      });
      setCoveredAt((m) => ({ ...m, [mode]: fresh?.latest_at ?? null }));
      qc.invalidateQueries({ queryKey: ["summaries"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "draft" | "reviewed" | "published" }) =>
      updateFn({ data: { id, status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["summaries"] }),
  });

  // Show only the freshest report(s) for the active tab — older runs for
  // prior periods stay in history but should not clutter the active view.
  // Portfolio (project_rollup) shows the latest entry per project; every
  // other mode shows just the single most recent report for the current
  // period.
  const visible = useMemo(() => {
    const all = (summariesQ.data ?? []).filter((s) => s.mode === activeMode);
    if (activeMode === "project_rollup") {
      const byProject = new Map<string, (typeof all)[number]>();
      for (const s of all) {
        const key = s.scope_project ?? "__none__";
        if (!byProject.has(key)) byProject.set(key, s);
      }
      return Array.from(byProject.values());
    }
    return all.slice(0, 1);
  }, [summariesQ.data, activeMode]);


  // Newest summary for this mode (summaries are listed in desc order already).
  const latestForMode = visible[0];
  const latestDataChange = freshnessQ.data?.latest_at ?? null;
  const sources = freshnessQ.data?.sources ?? { today_at: null, tasks_at: null, projects_at: null };

  // Baseline = MAX(summary.created_at, post-regen covered snapshot). The
  // covered snapshot wins when source-table `updated_at` values drift past the
  // summary's own `created_at` for reasons unrelated to new user activity.
  const summaryBaseline = latestForMode ? new Date(latestForMode.created_at).getTime() : 0;
  const coveredSnapshot = coveredAt[activeMode];
  const coveredBaseline = coveredSnapshot ? new Date(coveredSnapshot).getTime() : 0;
  const baseline = Math.max(summaryBaseline, coveredBaseline);
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

  const rawStale = !latestForMode
    ? true
    : latestDataChange
      ? new Date(latestDataChange).getTime() > baseline
      : false;
  // If a prior regen for this mode returned "no activity" against the current
  // data snapshot, the mode is as fresh as it can be — don't show "out of date".
  const isStale =
    rawStale && noDataAt[activeMode] !== (latestDataChange ?? null);
  const noActivity =
    noDataAt[activeMode] !== undefined &&
    noDataAt[activeMode] === (latestDataChange ?? null);

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
            <Button
              variant="outline"
              disabled={visible.length === 0}
              onClick={() => setPreviewOpen(true)}
              title="Preview the Obsidian markdown that will be written for this tab's reports"
            >
              <Eye className="h-4 w-4 mr-1.5" />
              Preview Markdown
            </Button>
            <CsvToolbar
              filename={`reports-${format(new Date(), "yyyyMMdd")}.csv`}
              columns={[
                { key: "mode", label: "mode" },
                { key: "period_start", label: "period_start" },
                { key: "period_end", label: "period_end" },
                { key: "created_at", label: "created_at" },
                { key: "summary", label: "summary" },
              ]}
              rows={(summariesQ.data ?? []).map((s) => {
                const body = (s as { body?: SummaryShape }).body;
                return {
                  mode: s.mode,
                  period_start: s.period_start ?? "",
                  period_end: s.period_end ?? "",
                  created_at: s.created_at ?? "",
                  summary: body?.summary ?? "",
                };
              })}
            />
            <TiddlyWikiImportButton kind="summaries" />
          </div>
        </div>

        <Tabs value={activeMode} onValueChange={(v) => setActiveMode(v as ReportMode)}>
          <TabsList className="flex flex-wrap h-auto mb-4">
            {TABS.map((t) => {
              const latest = (summariesQ.data ?? []).find((s) => s.mode === t.mode);
              const tabSummaryBase = latest ? new Date(latest.created_at).getTime() : 0;
              const tabCovered = coveredAt[t.mode]
                ? new Date(coveredAt[t.mode] as string).getTime()
                : 0;
              const tabBaseline = Math.max(tabSummaryBase, tabCovered);
              const tabRawStale = !latest
                ? true
                : latestDataChange
                  ? new Date(latestDataChange).getTime() > tabBaseline
                  : false;
              const tabStale = tabRawStale && noDataAt[t.mode] !== (latestDataChange ?? null);
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
        {!pendingForActive && visible.length === 0 && noActivity && (
          <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
            <p className="font-mono text-xs uppercase tracking-wider mb-1">
              No activity this {activeMode === "weekly_report" ? "week" : "period"}
            </p>
            <p className="text-muted-foreground">
              Nothing was logged in Today, Tasks, or Projects for the current {LABELS[activeMode]} window.
              This report is up to date — it will regenerate automatically once new activity is logged.
            </p>
          </div>
        )}
        {!pendingForActive && visible.length === 0 && !noActivity && (
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
                        <p className="text-sm leading-relaxed mb-1 whitespace-pre-line">{p.summary}</p>
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

                <div className="flex flex-wrap gap-2 mt-4">
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
                  <SendToGhostButton
                    build={() =>
                      activitySummaryToGhost({
                        modeLabel: LABELS[s.mode as ReportMode] ?? s.mode,
                        body,
                        periodStart: s.period_start,
                        periodEnd: s.period_end,
                        displayTitle: (s as { display_title?: string | null }).display_title ?? null,
                        scopeProject: (s as { scope_project?: string | null }).scope_project ?? null,
                      })
                    }
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <ObsidianPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        label={LABELS[activeMode]}
        rows={visible}
      />
    </AppLayout>
  );
}

function ObsidianPreviewDialog({
  open,
  onOpenChange,
  label,
  rows,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  label: string;
  rows: Array<{
    id: string;
    mode: string;
    status: string;
    period_start: string;
    period_end: string;
    scope_project: string | null;
    edited_summary: unknown;
    generated_summary: unknown;
  }>;
}) {
  const files = rows.map((r) => {
    const tag = r.scope_project ?? null;
    const base =
      r.mode === "weekly_report"
        ? `${r.period_start} ${tag ?? "weekly"}`.trim()
        : r.mode === "daily_recap"
          ? `${r.period_start.slice(0, 10)} recap`
          : `${r.period_start.slice(0, 10)} ${tag ?? r.mode}`.trim();
    const name = base.replace(/[\\/:*?"<>|]/g, "-").trim();
    return { name: `${name}.md`, content: renderSummaryFile(r) };
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Obsidian markdown preview — {label}</DialogTitle>
          <DialogDescription>
            Exactly what will be written to your vault on export or sync. {files.length} file
            {files.length === 1 ? "" : "s"}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-auto space-y-4">
          {files.map((f) => (
            <div key={f.name} className="border border-border rounded-md">
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-muted/40">
                <code className="text-xs font-mono truncate">{f.name}</code>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      navigator.clipboard.writeText(f.content);
                      toast.success("Copied markdown");
                    }}
                  >
                    Copy
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const blob = new Blob([f.content], { type: "text/markdown;charset=utf-8" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = f.name;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    }}
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    .md
                  </Button>
                </div>
              </div>
              <pre className="text-xs font-mono p-3 overflow-auto whitespace-pre-wrap break-words max-h-[50vh]">
                {f.content}
              </pre>
            </div>
          ))}
          {files.length === 0 && (
            <p className="text-sm text-muted-foreground">No reports in this tab yet.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
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
