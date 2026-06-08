import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listTasks } from "@/lib/log.functions";
import { Badge } from "@/components/ui/badge";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";

export const Route = createFileRoute("/tasks/")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({ meta: [{ title: "Tasks — log.md" }] }),
  component: TasksPage,
});

function TasksPage() {
  const fn = useServerFn(listTasks);
  const { data, isLoading } = useQuery({ queryKey: ["tasks"], queryFn: () => fn() });

  const grouped = {
    open: (data ?? []).filter((t) => t.status === "open"),
    blocked: (data ?? []).filter((t) => t.status === "blocked"),
    done: (data ?? []).filter((t) => t.status === "done"),
  };

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-mono font-bold mb-6">Tasks</h1>
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
            {grouped[status].map((t) => (
              <li key={t.id}>
                <Link
                  to="/tasks/$slug"
                  params={{ slug: t.slug }}
                  className="flex items-center justify-between px-4 py-3 hover:bg-accent transition-colors"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{t.title}</div>
                    <div className="text-xs text-muted-foreground font-mono">#{t.slug}</div>
                  </div>
                  <Badge variant={status === "done" ? "secondary" : status === "blocked" ? "destructive" : "outline"}>
                    {status}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      </div>
    </AppLayout>
  );
}
