import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import {
  getMaintenanceForecast,
  getMaintenanceForecastNarrative,
} from "@/lib/maintenance-forecast.functions";
import type { AssetForecast, DueItem } from "@/lib/maintenance-forecast.server";
import { CalendarClock, Sparkles, AlertTriangle, ArrowLeft, Wrench } from "lucide-react";
import { AiProgressStages } from "@/components/ai-progress-stages";
import { useAiJobProgress } from "@/hooks/use-ai-job-progress";
import { toast } from "sonner";
import { handleAiJobInFlight } from "@/lib/ai-inflight-error";
import { AiFeatureGate } from "@/components/ai-feature-gate";
import { AiTruncationWarning } from "@/components/ai-truncation-warning";
import {
  EditMaintenanceDialog,
  type MaintenanceRow,
} from "@/components/edit-maintenance-dialog";
import type { UsageGap } from "@/lib/maintenance-forecast.functions";
import { supabase } from "@/integrations/supabase/client";
import { Gauge } from "lucide-react";


export const Route = createFileRoute("/maintenance/forecast")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Maintenance Forecast — Bostead Farms" },
      {
        name: "description",
        content:
          "Projected 30/60/90-day service list per asset, based on usage rate and past maintenance intervals.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <AiFeatureGate featureId="maintenance.forecast">
      <ForecastPage />
    </AiFeatureGate>
  ),
});

function DueCard({ asset, item }: { asset: AssetForecast; item: DueItem }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3 space-y-1">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-sm">{asset.itemName}</div>
        {item.overdue && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-destructive">
            Overdue
          </span>
        )}
      </div>
      <div className="text-xs text-muted-foreground">{item.serviceType}</div>
      <div className="text-xs">
        {item.dueDate ? (
          <>
            due <span className="font-medium text-foreground">{item.dueDate}</span>
            {item.daysOut != null && (
              <span className="text-muted-foreground"> · in {item.daysOut}d</span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">no date projected</span>
        )}
      </div>
      <div className="text-[11px] text-muted-foreground">{item.reason}</div>
    </div>
  );
}

function Column({
  title,
  color,
  items,
}: {
  title: string;
  color: string;
  items: { asset: AssetForecast; item: DueItem }[];
}) {
  return (
    <Card className="flex-1 min-w-[240px]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
          {title}
          <span className="text-muted-foreground font-normal ml-auto">
            {items.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Nothing due.</p>
        ) : (
          items.map((p, i) => <DueCard key={`${p.asset.itemId}-${i}`} asset={p.asset} item={p.item} />)
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Assets that track hours/miles but don't have two readings yet can't be
 * forecast. Show them explicitly with a one-click way to log the first reading
 * through the maintenance edit dialog.
 */
function UsageGapsCard({ gaps }: { gaps: UsageGap[] }) {
  const [record, setRecord] = useState<MaintenanceRow | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const openReading = async (gap: UsageGap) => {
    if (!gap.recordId) return;
    setLoadingId(gap.itemId);
    const { data, error } = await supabase
      .from("maintenance_records")
      .select(
        "id, asset_id, asset_name, title, service_type, status, description, performed_at, due_at, scheduled_date, cost, vendor, notes",
      )
      .eq("id", gap.recordId)
      .maybeSingle();
    setLoadingId(null);
    if (error || !data) {
      toast.error(error?.message ?? "Could not open that maintenance record");
      return;
    }
    setRecord(data as MaintenanceRow);
  };

  return (
    <Card className="border-yellow-500/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Gauge className="h-4 w-4 text-yellow-500" />
          Missing usage readings ({gaps.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Forecasting needs two hours/miles readings per asset to work out a usage rate.
          Log the current reading now, then again in a few weeks.
        </p>
        {gaps.map((gap) => (
          <div
            key={gap.itemId}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/50 p-3"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{gap.itemName}</div>
              <div className="text-xs text-muted-foreground">
                tracks {gap.usageTracking} ·{" "}
                {gap.snapshotCount === 0
                  ? "no readings yet"
                  : `${gap.snapshotCount} reading — needs 1 more`}
              </div>
            </div>
            {gap.recordId ? (
              <Button
                size="sm"
                variant="outline"
                className="gap-2 shrink-0"
                disabled={loadingId === gap.itemId}
                onClick={() => openReading(gap)}
              >
                <Gauge className="h-4 w-4" />
                {loadingId === gap.itemId ? "Opening…" : "Add reading"}
              </Button>
            ) : (
              <Button asChild size="sm" variant="outline" className="gap-2 shrink-0">
                <Link to="/maintenance">
                  <Wrench className="h-4 w-4" /> Log a service first
                </Link>
              </Button>
            )}
          </div>
        ))}
      </CardContent>
      <EditMaintenanceDialog
        record={record}
        onOpenChange={(open) => {
          if (!open) setRecord(null);
        }}
      />
    </Card>
  );
}

function ForecastPage() {
  const qc = useQueryClient();
  const fetchForecast = useServerFn(getMaintenanceForecast);
  const fetchNarrative = useServerFn(getMaintenanceForecastNarrative);

  const { data, isLoading, error } = useQuery({
    queryKey: ["maintenance", "forecast"],
    queryFn: () => fetchForecast(),
  });

  const abortRef = useRef<AbortController | null>(null);
  const jobProgress = useAiJobProgress("maintenance.forecast");
  const narrativeMut = useMutation({
    mutationFn: () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      jobProgress.start();
      return fetchNarrative({ data: { regenerate: true }, signal: controller.signal });
    },
    onSuccess: (res) => {
      jobProgress.stop();
      qc.setQueryData(
        ["maintenance", "forecast"],
        (prev: Awaited<ReturnType<typeof fetchForecast>> | undefined) =>
          prev ? { ...prev, narrative: res.narrative, model: res.model } : prev,
      );
      toast.success("AI briefing ready");
    },
    onError: (e) => {
      if (e instanceof Error && (e.name === "AbortError" || /abort/i.test(e.message))) {
        jobProgress.stop();
        return;
      }
      if (handleAiJobInFlight(e)) return; // keep progress visible
      jobProgress.stop();
      toast.error(e instanceof Error ? e.message : "Could not generate briefing");
    },
  });
  const cancelNarrative = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    jobProgress.stop();
    narrativeMut.reset();
    toast.message("Request canceled");
  };



  const buckets = data?.buckets;
  const assets = data?.assets ?? [];
  const withHistory = assets.filter((a) => a.dueItems.length > 0);
  const usageGaps = data?.usageGaps ?? [];
  const emptyState = !isLoading && assets.length === 0;

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-6 py-10 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-2">
              <Link to="/maintenance" className="hover:text-foreground inline-flex items-center gap-1">
                <ArrowLeft className="h-3 w-3" /> Maintenance
              </Link>
              <span>·</span>
              <Link to="/maintenance/diagnose" className="hover:text-foreground">
                Symptom → procedure
              </Link>
            </div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <CalendarClock className="h-7 w-7 text-primary" />
              Maintenance Forecast
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Projected 30 / 60 / 90-day service list from usage rate and past intervals.
            </p>
          </div>
          <Button
            onClick={() => narrativeMut.mutate()}
            disabled={narrativeMut.isPending || emptyState}
            className="gap-2"
          >
            <Sparkles className="h-4 w-4" />
            {narrativeMut.isPending ? "Generating…" : "AI briefing"}
          </Button>
        </div>

        {(narrativeMut.isPending || narrativeMut.isSuccess || jobProgress.active) && (
          <AiProgressStages
            active={narrativeMut.isPending || jobProgress.active}
            done={narrativeMut.isSuccess}
            startedAt={jobProgress.startedAt}
            stages={[
              { id: "prepare", label: "Reading usage history & intervals", estSeconds: 1 },
              { id: "ai", label: "Generating 30/60/90-day briefing", estSeconds: 12 },
              { id: "format", label: "Formatting narrative", estSeconds: 1 },
            ]}
            onCancel={cancelNarrative}
          />
        )}


        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error instanceof Error ? error.message : "Failed to load forecast."}
          </div>
        )}

        {data?.narrative && (
          <Card className="border-primary/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> AI briefing
                {data.model && (
                  <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                    {data.model}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <AiTruncationWarning signal={narrativeMut.data?.truncation ?? null} />
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{data.narrative}</p>
            </CardContent>

          </Card>
        )}

        {usageGaps.length > 0 && <UsageGapsCard gaps={usageGaps} />}

        {isLoading ? (
          <div className="rounded-lg border border-border bg-card/40 p-8 text-center text-muted-foreground text-sm">
            Loading forecast…
          </div>
        ) : emptyState ? (
          <div className="rounded-lg border border-border bg-card/40 p-8 text-center">
            <Wrench className="h-8 w-8 text-primary mx-auto mb-2" />
            <h2 className="font-semibold">No assets to forecast yet</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Add inventory items that track hours or miles, and log a couple of completed
              maintenance records, to see projections here.
            </p>
          </div>
        ) : (
          <>
            {buckets && buckets.overdue.length > 0 && (
              <Card className="border-destructive/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-4 w-4" /> Overdue ({buckets.overdue.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {buckets.overdue.map((p, i) => (
                    <DueCard key={`over-${i}`} asset={p.asset} item={p.item} />
                  ))}
                </CardContent>
              </Card>
            )}

            <div className="flex gap-3 flex-wrap">
              <Column
                title="Next 30 days"
                color="bg-primary"
                items={buckets?.h30 ?? []}
              />
              <Column
                title="31 – 60 days"
                color="bg-yellow-500"
                items={buckets?.h60 ?? []}
              />
              <Column
                title="61 – 90 days"
                color="bg-muted-foreground"
                items={buckets?.h90 ?? []}
              />
            </div>

            {buckets && buckets.later.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    Beyond 90 days & unscheduled ({buckets.later.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {buckets.later.map((p, i) => (
                    <DueCard key={`later-${i}`} asset={p.asset} item={p.item} />
                  ))}
                </CardContent>
              </Card>
            )}

            {withHistory.length === 0 && (
              <div className="text-xs text-muted-foreground italic">
                No assets have 2+ completed services yet — log more history to unlock projections.
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
