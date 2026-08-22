import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { listTasks, removeTaskFromToday } from "@/lib/log.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { todayDateString } from "@/lib/slug";
import { DayWindowIndicator } from "@/components/day-window-indicator";
import { useShowTaskSlugs } from "@/hooks/use-show-task-slugs";
import { CsvToolbar } from "@/components/csv-toolbar";
import { TaskQuickSearch } from "@/components/task-quick-search";



export const Route = createFileRoute("/tasks/")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({ meta: [{ title: "Tasks — Bostead Farms" }] }),
  component: TasksPage,
});

function taskGroup(title: string): string {
  const first = title.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]+$/, "") ?? "";
  return first;
}

function sortByGroupThenTitle<T extends { title: string }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const ga = taskGroup(a.title);
    const gb = taskGroup(b.title);
    if (ga !== gb) return ga.localeCompare(gb);
    return a.title.localeCompare(b.title);
  });
}

function TasksPage() {
  const fn = useServerFn(listTasks);
  const removeFn = useServerFn(removeTaskFromToday);
  const qc = useQueryClient();
  const today = todayDateString();
  const [showSlugs, toggleSlugs] = useShowTaskSlugs();
  const { data, isLoading } = useQuery({
    queryKey: ["tasks", "today", today],
    queryFn: () => fn({ data: { date: today } }),
  });

  const toBacklog = useMutation({
    mutationFn: (taskId: string) => removeFn({ data: { taskId, date: today } }),
    onSuccess: () => {
      toast.success("Moved back to backlog");
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["daily-note"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Failed to move task"),
  });


  const grouped = {
    open: sortByGroupThenTitle((data ?? []).filter((t) => t.status === "open")),
    blocked: sortByGroupThenTitle((data ?? []).filter((t) => t.status === "blocked")),
    done: sortByGroupThenTitle((data ?? []).filter((t) => t.status === "done")),
  };

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between mb-6 gap-3">
        <div>
          <h1 className="text-2xl font-mono font-bold mb-1">Today's tasks</h1>
          <p className="text-xs text-muted-foreground font-mono">Tasks delivered or touched today</p>
          <DayWindowIndicator date={today} className="mt-1" />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <TaskQuickSearch />
          <Link
            to="/tasks/refs"
            className="text-xs font-mono px-2 py-1 border border-border rounded hover:bg-accent"
          >
            Check note references
          </Link>

          <CsvToolbar

            filename={`tasks-today-${today}.csv`}
            columns={[
              { key: "title", label: "title" },
              { key: "slug", label: "slug" },
              { key: "status", label: "status" },
              { key: "recurrence", label: "recurrence" },
            ]}
            rows={(data ?? []).map((t) => ({
              title: t.title,
              slug: t.slug,
              status: t.status,
              recurrence: (t as { recurrence?: string }).recurrence ?? "none",
            }))}
          />
          <button
            type="button"
            onClick={toggleSlugs}
            className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1"
            title="Debug: show or hide the #task-slug under each title"
          >
            slugs · {showSlugs ? "on" : "off"}
          </button>
        </div>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {(["open", "blocked", "done"] as const).map((status) => (
        <section key={status} className="mb-8">
          <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">
            {status} · {grouped[status].length}
          </h2>
          <ul className="divide-y divide-border border border-border rounded-lg overflow-hidden">
            {grouped[status].length === 0 && (
              <li className="px-4 py-3 text-sm text-muted-foreground">None</li>
            )}
            {grouped[status].map((t, i) => {
              const prev = grouped[status][i - 1];
              const group = taskGroup(t.title);
              const showHeader = !prev || taskGroup(prev.title) !== group;
              return (
                <li key={t.id}>
                  {showHeader && group && (
                    <div className="px-4 pt-2 pb-0.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60">
                      {group}
                    </div>
                  )}
                  <div className="flex items-center gap-2 px-4 py-3 hover:bg-accent transition-colors">
                    <Link
                      to="/tasks/$slug"
                      params={{ slug: t.slug }}
                      className="flex min-w-0 flex-1 items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate">{t.title}</div>
                        {showSlugs && (
                          <div className="text-xs text-muted-foreground font-mono">#{t.slug}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {t.recurrence && t.recurrence !== "none" && (
                          <Badge variant="outline" className="text-[10px] uppercase">↻ {t.recurrence}</Badge>
                        )}
                        <Badge variant={status === "done" ? "secondary" : status === "blocked" ? "destructive" : "outline"}>
                          {status}
                        </Badge>
                      </div>
                    </Link>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="shrink-0"
                      title="Move back to backlog"
                      disabled={toBacklog.isPending && toBacklog.variables === t.id}
                      onClick={() => toBacklog.mutate(t.id)}
                    >
                      <Undo2 className="h-3.5 w-3.5 mr-1" />
                      {toBacklog.isPending && toBacklog.variables === t.id
                        ? "Moving…"
                        : "Backlog"}
                    </Button>
                  </div>

                </li>
              );
            })}
          </ul>
        </section>
      ))}
      </div>
    </AppLayout>
  );
}
