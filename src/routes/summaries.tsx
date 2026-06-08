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

export const Route = createFileRoute("/summaries")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({ meta: [{ title: "Summaries — log.md" }] }),
  component: SummariesPage,
});

type SummaryShape = {
  summary: string;
  key_decisions: string[];
  blockers: string[];
  next_steps: string[];
};

function SummariesPage() {
  const listFn = useServerFn(listSummaries);
  const updateFn = useServerFn(updateSummary);
  const generateFn = useServerFn(generateSummary);
  const qc = useQueryClient();

  const q = useQuery({ queryKey: ["summaries"], queryFn: () => listFn() });

  const weekly = useMutation({
    mutationFn: () => generateFn({ data: { mode: "weekly_report", period_days: 7 } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Weekly report drafted");
      qc.invalidateQueries({ queryKey: ["summaries"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const rollup = useMutation({
    mutationFn: () => generateFn({ data: { mode: "project_rollup", period_days: 14 } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Project rollup drafted");
      qc.invalidateQueries({ queryKey: ["summaries"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "draft" | "reviewed" | "published" }) =>
      updateFn({ data: { id, status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["summaries"] }),
  });

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-mono font-bold">Summaries</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => rollup.mutate()} disabled={rollup.isPending}>
            {rollup.isPending ? "…" : "Project rollup"}
          </Button>
          <Button onClick={() => weekly.mutate()} disabled={weekly.isPending}>
            {weekly.isPending ? "…" : "Weekly report"}
          </Button>
        </div>
      </div>

      {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {q.data && q.data.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No summaries yet. Click "Weekly report" once you've logged some activity.
        </p>
      )}

      <ul className="space-y-4">
        {q.data?.map((s) => {
          const body = (s.edited_summary ?? s.generated_summary) as SummaryShape;
          const scope = (s as { scope_task?: { slug?: string; title?: string } | null }).scope_task;
          return (
            <li key={s.id} className="border border-border rounded-lg p-5 bg-card">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-[10px] uppercase">{s.mode}</Badge>
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

              {body.key_decisions?.length > 0 && (
                <SummarySection title="Decisions" items={body.key_decisions} />
              )}
              {body.blockers?.length > 0 && (
                <SummarySection title="Blockers" items={body.blockers} />
              )}
              {body.next_steps?.length > 0 && (
                <SummarySection title="Next" items={body.next_steps} />
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

function SummarySection({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mb-2">
      <h3 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">{title}</h3>
      <ul className="list-disc list-inside text-sm space-y-0.5 marker:text-muted-foreground">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
}
