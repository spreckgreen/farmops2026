import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { format } from "date-fns";
import { Check } from "lucide-react";
import { listProjectTags, listScheduledTasks } from "@/lib/log.functions";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/reports")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({ meta: [{ title: "Reports — Bostead Farms" }] }),
  component: ReportsPage,
});

const ALL = "__all__";
const fmt = (d: string | null | undefined) =>
  d ? format(new Date(d), "MMM d, yyyy · HH:mm") : "—";

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
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-end justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h1 className="text-2xl font-mono font-bold">Scheduled tasks</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Tasks with a <code className="font-mono">@start:</code> date/time. Use{" "}
              <code className="font-mono">@progress:NN</code> to set % complete and{" "}
              <code className="font-mono">#project/&lt;tag&gt;</code> to group.
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
            like{" "}
            <code className="font-mono">
              - [ ] Ship beta #project/web @start:2026-06-12 09:00 @progress:25
            </code>{" "}
            in a daily note.
          </p>
        )}

        {tasksQ.data && tasksQ.data.length > 0 && (
          <div className="border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-44">% Complete</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>Last update</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasksQ.data.map((t) => {
                  const done = t.status === "done";
                  return (
                    <TableRow key={t.id}>
                      <TableCell>
                        <span
                          className={
                            "inline-flex h-5 w-5 items-center justify-center rounded border " +
                            (done
                              ? "bg-primary border-primary text-primary-foreground"
                              : "border-border")
                          }
                          aria-label={done ? "Completed" : "Not completed"}
                        >
                          {done && <Check className="h-3.5 w-3.5" />}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Link
                          to="/tasks/$slug"
                          params={{ slug: t.slug }}
                          className="hover:underline"
                        >
                          <div className="font-medium">{t.title}</div>
                          <div className="text-xs text-muted-foreground font-mono flex gap-2 flex-wrap mt-0.5">
                            <span>#{t.slug}</span>
                            {(t.project_tags ?? []).map((pt) => (
                              <span key={pt}>· #project/{pt}</span>
                            ))}
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            done
                              ? "secondary"
                              : t.status === "blocked"
                                ? "destructive"
                                : "outline"
                          }
                        >
                          {t.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={t.percent_complete ?? 0} className="h-2" />
                          <span className="text-xs font-mono text-muted-foreground w-9 text-right">
                            {t.percent_complete ?? 0}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {fmt(t.start_at)}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {fmt(t.closed_at)}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {fmt(t.updated_at)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
