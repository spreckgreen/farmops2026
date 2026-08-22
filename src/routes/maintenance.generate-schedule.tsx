import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { listInventory } from "@/lib/inventory.functions";
import { planMaintenanceSchedule } from "@/lib/maintenance-schedule-planner.functions";
import { AiActionPreview } from "@/components/ai-action-preview";
import type { ActionPlan } from "@/lib/ai-actions/types";
import { Sparkles, Wrench, ArrowLeft, Loader2 } from "lucide-react";
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
          "AI-drafted maintenance schedule for an asset. Review, edit, and apply to your records.",
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

  const [assetId, setAssetId] = useState<string>("");
  const [usageContext, setUsageContext] = useState<string>("");
  const [plan, setPlan] = useState<ActionPlan | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const jobProgress = useAiJobProgress("maintenance.generate-schedule");

  const planMut = useMutation({
    mutationFn: async () => {
      if (!assetId) throw new Error("Pick an asset first");
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      jobProgress.start();
      return planFn({
        data: { asset_id: assetId, usage_context: usageContext || undefined },
        signal: controller.signal,
      });
    },
    onSuccess: (p) => {
      jobProgress.stop();
      setPlan(p);
      if (p.actions.length === 0) {
        toast.warning(
          "The model didn't return any intervals. Try adding more usage context.",
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


  const selected = displayAssets.find((a) => a.id === assetId);

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
            Generate maintenance schedule
          </h1>
          <p className="text-muted-foreground mb-8 max-w-2xl">
            Pick an asset, add any usage context, and the AI will draft a
            recurring service schedule. You review every entry and click Apply
            — nothing is written until you approve it.
          </p>

          {!plan && (
            <div className="rounded-xl border border-border bg-card/40 p-6 space-y-4">
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Asset
                </label>
                <select
                  value={assetId}
                  onChange={(e) => setAssetId(e.target.value)}
                  className="w-full h-10 rounded-md border border-border bg-background px-3 text-sm"
                >
                  <option value="">— Select an asset —</option>
                  {trackedAssets.length > 0 && (
                    <optgroup label="Tracked assets">
                      {trackedAssets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name ?? a.sku ?? "Unnamed"}
                          {a.category ? ` · ${a.category}` : ""}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {otherItems.length > 0 && (
                    <optgroup label="Other inventory items">
                      {otherItems.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name ?? a.sku ?? "Unnamed"}
                          {a.category ? ` · ${a.category}` : ""}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  {displayAssets.length} item
                  {displayAssets.length === 1 ? "" : "s"} available —{" "}
                  {trackedAssets.length} with usage tracking or an asset type.
                </p>
                {selected && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Current hours: {selected.current_hours ?? 0} · miles:{" "}
                    {selected.current_miles ?? 0} · tracking:{" "}
                    {selected.usage_tracking ?? "none"}
                  </p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Usage context (optional)
                </label>
                <Textarea
                  value={usageContext}
                  onChange={(e) => setUsageContext(e.target.value)}
                  placeholder="e.g. Used mostly for brush hogging in dry pastures, ~200 hrs/year."
                  rows={3}
                />
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={() => planMut.mutate()}
                  disabled={!assetId || planMut.isPending}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  {planMut.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Asking
                      the AI…
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-1" /> Draft schedule
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
                    { id: "ai", label: "Researching intervals with AI", estSeconds: 14 },
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
