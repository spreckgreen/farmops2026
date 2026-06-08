import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { format } from "date-fns";
import { listProjectTags, listScheduledTasks } from "@/lib/log.functions";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/reports")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({ meta: [{ title: "Reports — log.md" }] }),
  component: ReportsPage,
});

const ALL = "__all__";

function ReportsPage() {
  const tagsFn = useServerFn(listProjectTags);
  const tasksFn = useServerFn(listScheduledTasks);
  const [tag, setTag] = useState<string>(ALL);

  const tagsQ = useQuery({ queryKey: ["project-tags"], queryFn: () => tagsFn() });
  const tasksQ = useQuery({
    queryKey: ["scheduled-tasks", tag],
    queryFn: () => tasksFn({ data: { tag: tag === ALL ? null : tag } }),
  });

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-end justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h1 className="text-2xl font-mono font-bold">Scheduled tasks</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Tasks with a <code className="font-mono">@start:</code> date/time, optionally
              filtered by <code className="font-mono">#project/</code> tag.
            </p>
          </div>
          <div className="w-64">
            <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1 block">
              Project tag
            </label>
            <Select value={tag} onValueChange={setTag}>
              <SelectTrigger>
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All projects</SelectItem>
                {(tagsQ.data ?? []).map((t) => (
                  <SelectItem key={t} value={t}>
                    #project/{t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {tasksQ.isLoading && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
        {tasksQ.data && tasksQ.data.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No scheduled tasks{tag !== ALL ? ` for #project/${tag}` : ""} yet. Add a line
            like <code className="font-mono">- [ ] Ship beta #project/web @start:2026-06-12 09:00</code>{" "}
            in a daily note.
          </p>
        )}

        {tasksQ.data && tasksQ.data.length > 0 && (
          <ul className="divide-y divide-border border border-border rounded-lg overflow-hidden">
            {tasksQ.data.map((t) => (
              <li key={t.id}>
                <Link
                  to="/tasks/$slug"
                  params={{ slug: t.slug }}
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent transition-colors"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{t.title}</div>
                    <div className="text-xs text-muted-foreground font-mono flex gap-2 flex-wrap mt-0.5">
                      <span>#{t.slug}</span>
                      {(t.project_tags ?? []).map((pt) => (
                        <span key={pt}>· #project/{pt}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs font-mono text-muted-foreground">
                      {t.start_at
                        ? format(new Date(t.start_at), "MMM d, yyyy · HH:mm")
                        : ""}
                    </span>
                    <Badge
                      variant={
                        t.status === "done"
                          ? "secondary"
                          : t.status === "blocked"
                            ? "destructive"
                            : "outline"
                      }
                    >
                      {t.status}
                    </Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppLayout>
  );
}
