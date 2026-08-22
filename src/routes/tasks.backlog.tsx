import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  listBacklog,
  addTaskToToday,
  listDueMaintenance,
  addMaintenanceToToday,
  listReorderInventory,
  addReorderToToday,
  createBacklogTask,
} from "@/lib/log.functions";
import { AppLayout } from "@/components/app-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { toast } from "sonner";
import { todayDateString } from "@/lib/slug";
import { useShowTaskSlugs } from "@/hooks/use-show-task-slugs";
import { CsvToolbar } from "@/components/csv-toolbar";
import { AssignTaskToProject } from "@/components/assign-task-to-project";
import { CalendarDays, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_TIME_ZONE } from "@/lib/app-timezone";

export const Route = createFileRoute("/tasks/backlog")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({ meta: [{ title: "Backlog — Bostead Farms" }] }),
  component: BacklogPage,
});

/** `Date` from the calendar is local-midnight; read its own Y/M/D, no UTC shift. */
function calendarDayString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

type SortMode = "newest" | "oldest" | "alpha" | "status";

function BacklogPage() {
  const listFn = useServerFn(listBacklog);
  const [showSlugs, toggleSlugs] = useShowTaskSlugs();
  const addFn = useServerFn(addTaskToToday);
  const listMaintFn = useServerFn(listDueMaintenance);
  const addMaintFn = useServerFn(addMaintenanceToToday);
  const listReorderFn = useServerFn(listReorderInventory);
  const addReorderFn = useServerFn(addReorderToToday);
  const createFn = useServerFn(createBacklogTask);
  const qc = useQueryClient();
  const [newTitle, setNewTitle] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("alpha");
  const today = todayDateString();

  const { data, isLoading } = useQuery({
    queryKey: ["tasks", "backlog", today],
    queryFn: () => listFn({ data: { date: today } }),
  });

  const maint = useQuery({
    queryKey: ["tasks", "backlog", "maintenance-due", today],
    queryFn: () => listMaintFn({ data: { date: today } }),
  });

  const reorder = useQuery({
    queryKey: ["tasks", "backlog", "reorder"],
    queryFn: () => listReorderFn(),
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["tasks", "backlog"] });
    qc.invalidateQueries({ queryKey: ["tasks", "today"] });
    qc.invalidateQueries({ queryKey: ["tasks", "backlog", "reorder"] });
    qc.invalidateQueries({ queryKey: ["daily-note"] });
  };

  const mutation = useMutation({
    mutationFn: (taskId: string) => addFn({ data: { taskId, date: today } }),
    onSuccess: () => {
      toast.success("Added to today");
      invalidateAll();
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Failed to add task");
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: ({ taskId, date }: { taskId: string; date: string }) =>
      addFn({ data: { taskId, date } }),
    onSuccess: (_, vars) => {
      toast.success(`Scheduled for ${vars.date}`);
      invalidateAll();
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Failed to schedule task");
    },
  });

  const maintMutation = useMutation({
    mutationFn: (maintenanceId: string) => addMaintFn({ data: { maintenanceId, date: today } }),
    onSuccess: () => {
      toast.success("Maintenance added to today");
      invalidateAll();
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Failed to add maintenance");
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (vars: { kind: "inventory" | "consumable"; itemId: string }) =>
      addReorderFn({ data: { ...vars, date: today } }),
    onSuccess: () => {
      toast.success("Re-order added to today");
      invalidateAll();
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Failed to add re-order");
    },
  });

  const createMutation = useMutation({
    mutationFn: (title: string) => createFn({ data: { title } }),
    onSuccess: () => {
      toast.success("Task added to backlog");
      setNewTitle("");
      qc.invalidateQueries({ queryKey: ["tasks", "backlog"] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Failed to create task");
    },
  });

  const submitNew = () => {
    const t = newTitle.trim();
    if (!t) return;
    createMutation.mutate(t);
  };

  const searchLower = search.trim().toLowerCase();
  const filteredTasks = useMemo(() => {
    const tasks = data ?? [];
    if (!searchLower) return tasks;
    return tasks.filter((t) => {
      const haystack = [
        t.title,
        t.slug,
        (t.project_tags ?? []).join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(searchLower);
    });
  }, [data, searchLower]);

  const sortedTasks = useMemo(() => {
    const tasks = [...filteredTasks];
    switch (sort) {
      case "alpha":
        return tasks.sort((a, b) => a.title.localeCompare(b.title));
      case "oldest":
        return tasks.sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
      case "status":
        return tasks.sort((a, b) => {
          const byStatus = a.status.localeCompare(b.status);
          return byStatus !== 0 ? byStatus : a.title.localeCompare(b.title);
        });
      case "newest":
      default:
        return tasks.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
    }
  }, [filteredTasks, sort]);

  const grouped = {
    open: sortedTasks.filter((t) => t.status === "open"),
    blocked: sortedTasks.filter((t) => t.status === "blocked"),
  };

  const dueItems = (maint.data ?? []).filter((m) => !m.alreadyQueued);
  const reorderItems = (reorder.data ?? []).filter((r) => !r.alreadyQueued);

  const resultCount = sortedTasks.length;
  const totalCount = (data ?? []).length;

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-baseline justify-between mb-1">
          <h1 className="text-2xl font-mono font-bold">Backlog</h1>
          <div className="flex items-center gap-3">
            <CsvToolbar
              filename="tasks-backlog.csv"
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
              onImport={async (rows) => {
                let n = 0;
                for (const row of rows) {
                  const title = String(row.title ?? "").trim();
                  if (!title) continue;
                  await createFn({ data: { title } });
                  n++;
                }
                invalidateAll();
                toast.success(`Imported ${n} tasks`);
              }}
            />
            <button
              type="button"
              onClick={toggleSlugs}
              className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1"
              title="Debug: show or hide the #task-slug under each title"
            >
              slugs · {showSlugs ? "on" : "off"}
            </button>
            <Link to="/tasks" className="text-xs font-mono text-muted-foreground hover:text-foreground">
              Today's tasks →
            </Link>
          </div>
        </div>
        <p className="text-xs text-muted-foreground font-mono mb-6">
          Queued tasks not yet pulled into today. Click "Add to today" to activate.
        </p>

        <div className="flex gap-2 mb-6">
          <Input
            placeholder="New backlog task…"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitNew();
              }
            }}
          />
          <Button
            onClick={submitNew}
            disabled={createMutation.isPending || !newTitle.trim()}
          >
            {createMutation.isPending ? "Adding…" : "Add"}
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search backlog by title, slug, or project tag…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                title="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="Sort by…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="alpha">Alphabetical</SelectItem>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="status">Status</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {search && (
          <p className="text-xs text-muted-foreground font-mono mb-4">
            {resultCount} of {totalCount} task{totalCount === 1 ? "" : "s"}
            {resultCount !== totalCount ? " match" : ""}
          </p>
        )}

        {dueItems.length > 0 && (
          <section className="mb-8">
            <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">
              Maintenance due this month · {dueItems.length}
            </h2>
            <ul className="divide-y divide-border border border-border rounded-lg overflow-hidden">
              {dueItems.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent/40 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{m.title}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {m.due_at ? `due ${m.due_at}` : "no due date"}
                      {m.asset_name ? ` · ${m.asset_name}` : ""}
                    </div>
                  </div>
                  <Badge variant="outline">maintenance</Badge>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={maintMutation.isPending && maintMutation.variables === m.id}
                    onClick={() => maintMutation.mutate(m.id)}
                  >
                    {maintMutation.isPending && maintMutation.variables === m.id
                      ? "Adding…"
                      : "Add to today"}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {reorderItems.length > 0 && (
          <section className="mb-8">
            <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">
              Re-orders (low stock) · {reorderItems.length}
            </h2>
            <ul className="divide-y divide-border border border-border rounded-lg overflow-hidden">
              {reorderItems.map((r) => {
                const pending =
                  reorderMutation.isPending && reorderMutation.variables?.itemId === r.id;
                return (
                  <li
                    key={`${r.kind}-${r.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent/40 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">Order {r.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {r.quantity} {r.unit ?? ""} in stock
                        {r.vendor ? ` · ${r.vendor}` : ""}
                      </div>
                    </div>
                    <Badge variant="destructive">low</Badge>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => reorderMutation.mutate({ kind: r.kind, itemId: r.id })}
                    >
                      {pending ? "Adding…" : "Add to today"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && (data?.length ?? 0) === 0 && dueItems.length === 0 && reorderItems.length === 0 && (
          <p className="text-sm text-muted-foreground">Backlog is empty.</p>
        )}
        {!isLoading && (data?.length ?? 0) > 0 && resultCount === 0 && (
          <p className="text-sm text-muted-foreground">No tasks match your search.</p>
        )}
        {(["open", "blocked"] as const).map((status) =>
          grouped[status].length === 0 ? null : (
            <section key={status} className="mb-8">
              <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">
                {status} · {grouped[status].length}
              </h2>
              <ul className="divide-y divide-border border border-border rounded-lg overflow-hidden">
                {grouped[status].map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent/40 transition-colors"
                  >
                    <Link
                      to="/tasks/$slug"
                      params={{ slug: t.slug }}
                      className="min-w-0 flex-1"
                    >
                      <div className="font-medium truncate">{t.title}</div>
                      <div className="text-xs text-muted-foreground font-mono flex gap-2 flex-wrap">
                        {showSlugs && <span>#{t.slug}</span>}
                        {(t.project_tags ?? []).map((pt, i) => (
                          <span key={pt}>{showSlugs || i > 0 ? "· " : ""}#project/{pt}</span>
                        ))}
                      </div>
                    </Link>
                    {t.recurrence && t.recurrence !== "none" && (
                      <Badge variant="outline" className="text-[10px] uppercase">↻ {t.recurrence}</Badge>
                    )}
                    <Badge
                      variant={status === "blocked" ? "destructive" : "outline"}
                    >
                      {status}
                    </Badge>
                    <AssignTaskToProject taskId={t.id} taskTitle={t.title} />
                    <BacklogSchedulePopover
                      taskId={t.id}
                      today={today}
                      onSelect={(date) => scheduleMutation.mutate({ taskId: t.id, date })}
                      isPending={scheduleMutation.isPending && scheduleMutation.variables?.taskId === t.id}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={mutation.isPending && mutation.variables === t.id}
                      onClick={() => mutation.mutate(t.id)}
                    >
                      {mutation.isPending && mutation.variables === t.id
                        ? "Adding…"
                        : "Add to today"}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ),
        )}
      </div>
    </AppLayout>
  );
}

function BacklogSchedulePopover({
  taskId,
  today,
  onSelect,
  isPending,
}: {
  taskId: string;
  today: string;
  onSelect: (date: string) => void;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0"
          title={`Schedule this task for a specific farm day (${APP_TIME_ZONE})`}
          disabled={isPending}
        >
          <CalendarDays className="h-3.5 w-3.5 mr-1" />
          {isPending ? "Moving…" : "Schedule…"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <div className="px-3 pt-3 text-[11px] font-mono text-muted-foreground">
          schedule for · {APP_TIME_ZONE}
        </div>
        <Calendar
          mode="single"
          defaultMonth={new Date(`${today}T12:00:00`)}
          onSelect={(d) => {
            if (!d) return;
            const target = calendarDayString(d);
            if (target === today) {
              toast.info("Use Add to today for today's date");
              setOpen(false);
              return;
            }
            onSelect(target);
            setOpen(false);
          }}
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );
}
