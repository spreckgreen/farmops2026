import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listBacklog,
  addTaskToToday,
  listDueMaintenance,
  addMaintenanceToToday,
  listReorderInventory,
  addReorderToToday,
} from "@/lib/log.functions";
import { AppLayout } from "@/components/app-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { toast } from "sonner";

export const Route = createFileRoute("/tasks/backlog")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({ meta: [{ title: "Backlog — Bostead Farms" }] }),
  component: BacklogPage,
});

function BacklogPage() {
  const listFn = useServerFn(listBacklog);
  const addFn = useServerFn(addTaskToToday);
  const listMaintFn = useServerFn(listDueMaintenance);
  const addMaintFn = useServerFn(addMaintenanceToToday);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["tasks", "backlog"],
    queryFn: () => listFn({ data: {} }),
  });

  const maint = useQuery({
    queryKey: ["tasks", "backlog", "maintenance-due"],
    queryFn: () => listMaintFn({ data: {} }),
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["tasks", "backlog"] });
    qc.invalidateQueries({ queryKey: ["tasks", "today"] });
  };

  const mutation = useMutation({
    mutationFn: (taskId: string) => addFn({ data: { taskId } }),
    onSuccess: () => {
      toast.success("Added to today");
      invalidateAll();
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Failed to add task");
    },
  });

  const maintMutation = useMutation({
    mutationFn: (maintenanceId: string) => addMaintFn({ data: { maintenanceId } }),
    onSuccess: () => {
      toast.success("Maintenance added to today");
      invalidateAll();
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Failed to add maintenance");
    },
  });

  const grouped = {
    open: (data ?? []).filter((t) => t.status === "open"),
    blocked: (data ?? []).filter((t) => t.status === "blocked"),
  };

  const dueItems = (maint.data ?? []).filter((m) => !m.alreadyQueued);

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-baseline justify-between mb-1">
          <h1 className="text-2xl font-mono font-bold">Backlog</h1>
          <Link to="/tasks" className="text-xs font-mono text-muted-foreground hover:text-foreground">
            Today's tasks →
          </Link>
        </div>
        <p className="text-xs text-muted-foreground font-mono mb-6">
          Queued tasks not yet pulled into today. Click "Add to today" to activate.
        </p>

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

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && (data?.length ?? 0) === 0 && dueItems.length === 0 && (
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
                      <div className="text-xs text-muted-foreground font-mono">
                        #{t.slug}
                      </div>
                    </Link>
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
