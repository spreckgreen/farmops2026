import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
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
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { toast } from "sonner";
import { todayDateString } from "@/lib/slug";
import { useShowTaskSlugs } from "@/hooks/use-show-task-slugs";
import { CsvToolbar } from "@/components/csv-toolbar";

export const Route = createFileRoute("/tasks/backlog")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({ meta: [{ title: "Backlog — Bostead Farms" }] }),
  component: BacklogPage,
});

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

  const grouped = {
    open: (data ?? []).filter((t) => t.status === "open"),
    blocked: (data ?? []).filter((t) => t.status === "blocked"),
  };

  const dueItems = (maint.data ?? []).filter((m) => !m.alreadyQueued);
  const reorderItems = (reorder.data ?? []).filter((r) => !r.alreadyQueued);

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
                      {showSlugs && (
                        <div className="text-xs text-muted-foreground font-mono">
                          #{t.slug}
                        </div>
                      )}
                    </Link>
                    {t.recurrence && t.recurrence !== "none" && (
                      <Badge variant="outline" className="text-[10px] uppercase">↻ {t.recurrence}</Badge>
                    )}
                    <Badge
                      variant={status === "blocked" ? "destructive" : "outline"}
                    >
                      {status}
                    </Badge>
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
