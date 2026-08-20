import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listTasks } from "@/lib/log.functions";
import { Badge } from "@/components/ui/badge";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { todayDateString } from "@/lib/slug";
import { useShowTaskSlugs } from "@/hooks/use-show-task-slugs";
import { CsvToolbar } from "@/components/csv-toolbar";

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
  const today = todayDateString();
  const [showSlugs, toggleSlugs] = useShowTaskSlugs();
  const { data, isLoading } = useQuery({
    queryKey: ["tasks", "today", today],
    queryFn: () => fn({ data: { date: today } }),
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
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <TaskQuickSearch />
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
                  <Link
                    to="/tasks/$slug"
                    params={{ slug: t.slug }}
                    className="flex items-center justify-between px-4 py-3 hover:bg-accent transition-colors"
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
