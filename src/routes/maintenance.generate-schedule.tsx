import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { listInventory } from "@/lib/inventory.functions";
import { planMaintenanceSchedule } from "@/lib/maintenance-schedule-planner.functions";
import { AiActionPreview } from "@/components/ai-action-preview";
import type { ActionPlan } from "@/lib/ai-actions/types";
import { Sparkles, Wrench, ArrowLeft, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { AiProgressStages } from "@/components/ai-progress-stages";
import { useAiJobProgress } from "@/hooks/use-ai-job-progress";
import { toast } from "sonner";
import { handleAiJobInFlight } from "@/lib/ai-inflight-error";
import { AiFeatureGate } from "@/components/ai-feature-gate";


export const Route = createFileRoute("/maintenance/generate-schedule")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Generate schedule — Bostead Farms" },
      {
        name: "description",
        content:
          "AI-drafted maintenance schedules for one or more assets. Review, edit, and apply to your records.",
      },
    ],
  }),
  component: () => (
    <AiFeatureGate featureId="maintenance.generate-schedule">
      <Page />
    </AiFeatureGate>
  ),
});

function Page() {
  const listInv = useServerFn(listInventory);
  const planFn = useServerFn(planMaintenanceSchedule);

  const { data: inventory = [] } = useQuery({
    queryKey: ["inventory"],
    queryFn: () => listInv(),
  });

  const isLikelyAsset = (i: (typeof inventory)[number]) =>
    i.item_type === "asset" ||
    Number(i.current_hours ?? 0) > 0 ||
    Number(i.current_miles ?? 0) > 0 ||
    (i.usage_tracking ?? "none") !== "none";

  const byName = (a: (typeof inventory)[number], b: (typeof inventory)[number]) =>
    (a.name ?? a.sku ?? "").localeCompare(b.name ?? b.sku ?? "");

  const trackedAssets = inventory.filter(isLikelyAsset).sort(byName);
  const otherItems = inventory.filter((i) => !isLikelyAsset(i)).sort(byName);
  const displayAssets = [...trackedAssets, ...otherItems];

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [usageContext, setUsageContext] = useState<string>("");
  const [plan, setPlan] = useState<ActionPlan | null>(null);
  const [runStatus, setRunStatus] = useState<
    Record<string, "pending" | "running" | "done" | "failed">
  >({});
  const [failures, setFailures] = useState<{ name: string; error: string }[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const jobProgress = useAiJobProgress("maintenance.generate-schedule");

  const matches = (a: (typeof inventory)[number]) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return `${a.name ?? ""} ${a.sku ?? ""} ${a.category ?? ""}`
      .toLowerCase()
      .includes(q);
  };

  const visibleTracked = useMemo(() => trackedAssets.filter(matches), [trackedAssets, filter]);
  const visibleOther = useMemo(() => otherItems.filter(matches), [otherItems, filter]);
  const visibleIds = useMemo(
    () => [...visibleTracked, ...visibleOther].map((a) => a.id),
    [visibleTracked, visibleOther],
  );

  const toggle = (id: string) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const nameOf = (id: string) => {
    const a = displayAssets.find((x) => x.id === id);
    return a?.name ?? a?.sku ?? "Unnamed";
  };

  const planMut = useMutation({
    mutationFn: async () => {
      if (selectedIds.length === 0) throw new Error("Pick at least one asset");
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      jobProgress.start();
      setFailures([]);
      setRunStatus(
        Object.fromEntries(selectedIds.map((id) => [id, "pending" as const])),
      );

      const merged: ActionPlan = {
        plan_id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : String(Date.now()),
        surface: "maintenance.generate_schedule",
        summary: "",
        actions: [],
        citations: [],
        model: "",
        escalation: null,
      };
      const errors: { name: string; error: string }[] = [];
      const models = new Set<string>();

      // Sequential: keeps local/hosted AI from being hammered in parallel and
      // lets one failing asset not kill the whole batch.
      for (const id of selectedIds) {
        if (controller.signal.aborted) break;
        setRunStatus((s) => ({ ...s, [id]: "running" }));
        try {
          const p = await planFn({
            data: { asset_id: id, usage_context: usageContext || undefined },
            signal: controller.signal,
          });
          merged.actions.push(...p.actions);
          merged.citations.push(...p.citations);
          if (p.model) models.add(p.model);
          if (p.escalation) merged.escalation = p.escalation;
          setRunStatus((s) => ({ ...s, [id]: "done" }));
        } catch (e) {
          if (
            controller.signal.aborted ||
            (e instanceof Error && (e.name === "AbortError" || /abort/i.test(e.message)))
          ) {
            throw e;
          }
          setRunStatus((s) => ({ ...s, [id]: "failed" }));
          errors.push({
            name: nameOf(id),
            error: e instanceof Error ? e.message : "Planner failed",
          });
        }
      }

      merged.citations = Array.from(new Set(merged.citations));
      merged.model = Array.from(models).join(", ");
      merged.summary = `${merged.actions.length} maintenance interval${
        merged.actions.length === 1 ? "" : "s"
      } across ${selectedIds.length - errors.length} asset${
        selectedIds.length - errors.length === 1 ? "" : "s"
      }`;
      setFailures(errors);
      return merged;
    },
    onSuccess: (p) => {
      jobProgress.stop();
      if (p.actions.length === 0) {
        toast.warning(
          "The model didn't return any intervals. Try adding more usage context.",
        );
        return;
      }
      setPlan(p);
      if (failures.length > 0) {
        toast.warning(
          `${failures.length} asset${failures.length === 1 ? "" : "s"} failed — review the draft for the rest.`,
        );
      }
    },
    onError: (e) => {
      if (e instanceof Error && (e.name === "AbortError" || /abort/i.test(e.message))) {
        jobProgress.stop();
        return;
      }
      if (handleAiJobInFlight(e)) return; // keep progress visible
      jobProgress.stop();
      toast.error(e instanceof Error ? e.message : "Planner failed");
    },
  });

  const cancelPlan = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    jobProgress.stop();
    planMut.reset();
    toast.message("Request canceled");
  };

  const statusIcon = (s?: string) =>
    s === "running" ? (
      <Loader2 className="h-3 w-3 animate-spin text-primary" />
    ) : s === "done" ? (
      <CheckCircle2 className="h-3 w-3 text-primary" />
    ) : s === "failed" ? (
      <XCircle className="h-3 w-3 text-destructive" />
    ) : null;

  const renderRow = (a: (typeof inventory)[number]) => (
    <label
      key={a.id}
      className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40 cursor-pointer"
    >
      <Checkbox
        checked={selectedIds.includes(a.id)}
        onCheckedChange={() => toggle(a.id)}
        disabled={planMut.isPending}
      />
      <span className="flex-1 truncate">
        {a.name ?? a.sku ?? "Unnamed"}
        {a.category ? (
          <span className="text-muted-foreground"> · {a.category}</span>
        ) : null}
      </span>
      {statusIcon(runStatus[a.id])}
    </label>
  );

  return (
    <AppLayout>
      <div className="min-h-[calc(100vh-3.5rem)] bg-background text-foreground">
        <div className="max-w-4xl mx-auto px-6 py-10">
          <Link
            to="/maintenance"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary mb-4"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Maintenance
          </Link>

          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary mb-3">
            <Sparkles className="h-3 w-3" /> AI Action
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2">
            Generate maintenance schedules
          </h1>
          <p className="text-muted-foreground mb-8 max-w-2xl">
            Select one or more assets, add any usage context, and the AI will
            draft recurring service schedules for each. Everything lands in a
            single review list — nothing is written until you approve it.
          </p>

          {!plan && (
            <div className="rounded-xl border border-border bg-card/40 p-6 space-y-4">
              <div>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <label className="text-sm font-medium">Assets</label>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={planMut.isPending || visibleIds.length === 0}
                      onClick={() =>
                        setSelectedIds((prev) =>
                          Array.from(new Set([...prev, ...visibleIds])),
                        )
                      }
                    >
                      Select all{filter ? " shown" : ""}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={planMut.isPending || selectedIds.length === 0}
                      onClick={() => setSelectedIds([])}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by name, SKU, or category…"
                  className="mb-2"
                />
                <div className="max-h-72 overflow-y-auto rounded-md border border-border bg-background divide-y divide-border/60">
                  {visibleTracked.length > 0 && (
                    <div>
                      <div className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground bg-muted/40">
                        Tracked assets
                      </div>
                      {visibleTracked.map(renderRow)}
                    </div>
                  )}
                  {visibleOther.length > 0 && (
                    <div>
                      <div className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground bg-muted/40">
                        Other inventory items
                      </div>
                      {visibleOther.map(renderRow)}
                    </div>
                  )}
                  {visibleIds.length === 0 && (
                    <p className="px-3 py-4 text-sm text-muted-foreground">
                      No inventory items match that filter.
                    </p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {selectedIds.length} selected of {displayAssets.length} item
                  {displayAssets.length === 1 ? "" : "s"} — {trackedAssets.length}{" "}
                  with usage tracking or an asset type.
                </p>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Usage context (optional, applies to all selected)
                </label>
                <Textarea
                  value={usageContext}
                  onChange={(e) => setUsageContext(e.target.value)}
                  placeholder="e.g. Used mostly for brush hogging in dry pastures, ~200 hrs/year."
                  rows={3}
                />
              </div>
              {failures.length > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs space-y-1">
                  {failures.map((f) => (
                    <p key={f.name}>
                      <span className="font-medium">{f.name}</span>: {f.error}
                    </p>
                  ))}
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  onClick={() => planMut.mutate()}
                  disabled={selectedIds.length === 0 || planMut.isPending}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  {planMut.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Asking
                      the AI…
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-1" /> Draft{" "}
                      {selectedIds.length > 1
                        ? `${selectedIds.length} schedules`
                        : "schedule"}
                    </>
                  )}
                </Button>
              </div>

              {(planMut.isPending || planMut.isSuccess || jobProgress.active) && (
                <AiProgressStages
                  active={planMut.isPending || jobProgress.active}
                  done={planMut.isSuccess}
                  startedAt={jobProgress.startedAt}
                  stages={[
                    { id: "prepare", label: "Loading asset & inventory context", estSeconds: 1 },
                    {
                      id: "ai",
                      label: `Researching intervals with AI (${Math.max(selectedIds.length, 1)} asset${selectedIds.length === 1 ? "" : "s"})`,
                      estSeconds: 14 * Math.max(selectedIds.length, 1),
                    },
                    { id: "match", label: "Matching parts to your inventory", estSeconds: 2 },
                    { id: "format", label: "Formatting draft schedule", estSeconds: 1 },
                  ]}
                  onCancel={cancelPlan}
                />
              )}

            </div>
          )}

          {plan && (
            <>
              <AiActionPreview plan={plan} onClose={() => setPlan(null)} />
              <div className="mt-6 text-xs text-muted-foreground flex items-center gap-2">
                <Wrench className="h-3 w-3" /> Applied entries land in your
                Maintenance records with the recurrence you approved.
              </div>
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
