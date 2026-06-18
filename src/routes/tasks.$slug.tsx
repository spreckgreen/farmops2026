import { createFileRoute, useParams, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTaskBySlug, setTaskStatus, updateTask, deleteTask, addTaskNote, RECURRENCE_VALUES, type Recurrence } from "@/lib/log.functions";
import { Textarea } from "@/components/ui/textarea";
import { generateSummary } from "@/lib/summary.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Pencil, Trash2, Check, X } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/tasks/$slug")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({ meta: [{ title: "Task — Bostead Farms" }] }),
  component: TaskPage,
});

function TaskPage() {
  const { slug } = useParams({ from: "/tasks/$slug" });
  const navigate = useNavigate();
  const getFn = useServerFn(getTaskBySlug);
  const statusFn = useServerFn(setTaskStatus);
  const updateFn = useServerFn(updateTask);
  const deleteFn = useServerFn(deleteTask);
  const summarizeFn = useServerFn(generateSummary);
  const qc = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");

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

  const saveTitle = useMutation({
    mutationFn: (title: string) => updateFn({ data: { id: q.data!.task.id, title } }),
    onSuccess: () => {
      toast.success("Task updated");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["task", slug] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const saveRecurrence = useMutation({
    mutationFn: (recurrence: Recurrence) =>
      updateFn({ data: { id: q.data!.task.id, recurrence } }),
    onSuccess: () => {
      toast.success("Recurrence updated");
      qc.invalidateQueries({ queryKey: ["task", slug] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: () => deleteFn({ data: { id: q.data!.task.id } }),
    onSuccess: () => {
      toast.success("Task deleted");
      qc.invalidateQueries({ queryKey: ["tasks"] });
      navigate({ to: "/tasks" });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const summarize = useMutation({
    mutationFn: () =>
      summarizeFn({ data: { mode: "task_update", scope_task_id: q.data!.task.id, period_days: 14 } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Summary drafted");
      qc.invalidateQueries({ queryKey: ["summaries"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (q.isLoading) return <AppLayout><p className="p-8 text-sm text-muted-foreground">Loading…</p></AppLayout>;
  if (!q.data) return <AppLayout><p className="p-8 text-sm text-muted-foreground">Task not found.</p></AppLayout>;

  const { task, entries } = q.data;

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 py-8">
      <Link to="/tasks" className="text-xs text-muted-foreground hover:text-foreground font-mono">
        ← all tasks
      </Link>
      <div className="flex items-start justify-between gap-4 mt-2 mb-6">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && draftTitle.trim()) saveTitle.mutate(draftTitle.trim());
                  if (e.key === "Escape") setEditing(false);
                }}
                className="font-mono text-xl font-bold h-10"
              />
              <Button
                size="icon"
                variant="ghost"
                disabled={!draftTitle.trim() || saveTitle.isPending}
                onClick={() => saveTitle.mutate(draftTitle.trim())}
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => setEditing(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-mono font-bold truncate">{task.title}</h1>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => {
                  setDraftTitle(task.title);
                  setEditing(true);
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
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
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this task?</AlertDialogTitle>
                <AlertDialogDescription>
                  "{task.title}" will be removed. Activity log entries are preserved but unlinked.
                  This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => remove.mutate()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card/40 px-4 py-3">
        <Checkbox
          id="repeat-toggle"
          checked={(task.recurrence ?? "none") !== "none"}
          onCheckedChange={(v: boolean | "indeterminate") =>
            saveRecurrence.mutate(v ? ((task.recurrence as Recurrence) === "none" ? "weekly" : (task.recurrence as Recurrence)) : "none")
          }
        />
        <label htmlFor="repeat-toggle" className="text-sm font-medium cursor-pointer">
          Repeat this task
        </label>
        <Select
          value={(task.recurrence as Recurrence | null) ?? "none"}
          onValueChange={(v) => saveRecurrence.mutate(v as Recurrence)}
          disabled={(task.recurrence ?? "none") === "none"}
        >
          <SelectTrigger className="w-36"><SelectValue placeholder="Interval" /></SelectTrigger>
          <SelectContent>
            {RECURRENCE_VALUES.filter((r) => r !== "none").map((r) => (
              <SelectItem key={r} value={r}>{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(task.recurrence ?? "none") !== "none" && task.recurrence_next_at && (
          <span className="text-xs font-mono text-muted-foreground">
            next: {new Date(task.recurrence_next_at).toLocaleDateString()}
          </span>
        )}
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
    </AppLayout>
  );
}
