import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTaskBySlug, setTaskStatus } from "@/lib/log.functions";
import { generateSummary } from "@/lib/summary.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/tasks/$slug")({
  head: () => ({ meta: [{ title: "Task — log.md" }] }),
  component: TaskPage,
});

function TaskPage() {
  const { slug } = useParams({ from: "/_authenticated/tasks/$slug" });
  const getFn = useServerFn(getTaskBySlug);
  const statusFn = useServerFn(setTaskStatus);
  const summarizeFn = useServerFn(generateSummary);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["task", slug],
    queryFn: () => getFn({ data: { slug } }),
  });

  const setStatus = useMutation({
    mutationFn: (status: "open" | "blocked" | "done") =>
      statusFn({ data: { id: q.data!.task.id, status } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", slug] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const summarize = useMutation({
    mutationFn: () =>
      summarizeFn({ data: { mode: "task_update", scope_task_id: q.data!.task.id, period_days: 14 } }),
    onSuccess: () => {
      toast.success("Summary drafted");
      qc.invalidateQueries({ queryKey: ["summaries"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (q.isLoading) return <p className="p-8 text-sm text-muted-foreground">Loading…</p>;
  if (!q.data) return <p className="p-8 text-sm text-muted-foreground">Task not found.</p>;

  const { task, entries } = q.data;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link to="/tasks" className="text-xs text-muted-foreground hover:text-foreground font-mono">
        ← all tasks
      </Link>
      <div className="flex items-start justify-between gap-4 mt-2 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-mono font-bold truncate">{task.title}</h1>
          <p className="text-xs text-muted-foreground font-mono">#{task.slug}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={task.status} onValueChange={(v) => setStatus.mutate(v as "open" | "blocked" | "done")}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">open</SelectItem>
              <SelectItem value="blocked">blocked</SelectItem>
              <SelectItem value="done">done</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => summarize.mutate()} disabled={summarize.isPending || entries.length === 0}>
            {summarize.isPending ? "Summarizing…" : "Summarize"}
          </Button>
        </div>
      </div>

      <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">
        Activity log · {entries.length}
      </h2>
      <ul className="space-y-2">
        {entries.length === 0 && (
          <li className="text-sm text-muted-foreground">
            No entries yet. In today's note, write{" "}
            <code className="font-mono bg-muted px-1 py-0.5 rounded">#task/{task.slug} did the thing</code>.
          </li>
        )}
        {entries.map((e) => (
          <li key={e.id} className="border border-border rounded-lg p-3 bg-card">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground mb-1">
              <Badge variant="outline" className="text-[10px] font-mono uppercase">
                {e.entry_type}
              </Badge>
              <span className="font-mono">
                {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
              </span>
            </div>
            <p className="font-mono text-sm whitespace-pre-wrap">{e.raw_content}</p>
            {e.ai_summary && (
              <p className="text-sm text-muted-foreground mt-2 italic">→ {e.ai_summary}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
