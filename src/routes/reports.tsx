import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listSummaries, updateSummary } from "@/lib/log.functions";
import { generateSummary } from "@/lib/summary.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { toast } from "sonner";
import { format } from "date-fns";
import { Download } from "lucide-react";
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

function ReportsPage() {
  const listFn = useServerFn(listSummaries);
  const updateFn = useServerFn(updateSummary);
  const generateFn = useServerFn(generateSummary);
  const qc = useQueryClient();

  const q = useQuery({ queryKey: ["summaries"], queryFn: () => listFn() });

  const runReport = useMutation({
    mutationFn: (mode: ReportMode) =>
      generateFn({ data: { mode, period_days: 7 } }),
    onSuccess: (res, mode) => {
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const labels: Record<ReportMode, string> = {
        daily_recap: "Daily Recap",
        weekly_report: "Weekly Status",
        monthly_rollup: "Monthly Projects",
        quarter_review: "Quarterly Projects",
        yearly_rollup: "Yearly Projects",
        project_rollup: "Portfolio",
      };
      const count = "summaries" in res && res.summaries ? res.summaries.length : 1;
      toast.success(`${labels[mode]} drafted (${count})`);
      qc.invalidateQueries({ queryKey: ["summaries"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "draft" | "reviewed" | "published" }) =>
      updateFn({ data: { id, status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["summaries"] }),
  });

  const pendingMode = runReport.isPending ? (runReport.variables as ReportMode) : null;
  const isAnyPending = runReport.isPending;

  const reportButtons: { mode: ReportMode; label: string }[] = [
    { mode: "daily_recap", label: "Daily Recap" },
    { mode: "weekly_report", label: "Weekly Status" },
    { mode: "monthly_rollup", label: "Monthly Projects" },
    { mode: "quarter_review", label: "Quarterly Projects" },
    { mode: "yearly_rollup", label: "Yearly Projects" },
    { mode: "project_rollup", label: "Portfolio" },
  ];

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
          <h1 className="text-2xl font-mono font-bold">Reports</h1>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              disabled={!q.data || q.data.length === 0}
              onClick={async () => {
                try {
                  const tpl = await loadTemplate();
                  const tiddlers = tiddlersFromSummaries((q.data ?? []) as SummaryRow[]);
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

        <div className="flex gap-2 flex-wrap mb-6">
          {reportButtons.map((b) => (
            <Button
              key={b.mode}
              variant={b.mode === "weekly_report" ? "default" : "outline"}
              disabled={isAnyPending}
              onClick={() => runReport.mutate(b.mode)}
            >
              {pendingMode === b.mode ? "…" : b.label}
            </Button>
          ))}
        </div>

        {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {q.data && q.data.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No reports yet. Pick a report type above once you've logged some activity.
          </p>
        )}

        <ul className="space-y-4">
          {q.data?.map((s) => {
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
                <p className="text-sm leading-relaxed mb-3">{body.summary}</p>

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
