// Planning view: per-AI-feature cloud cost and observed usage, so you can
// decide which features are worth leaving enabled on cloud engines.
//
// Two number families are shown side by side and must not be confused:
//   estimated  — list-price math for one run (ai-pricing.ts token profiles)
//   actual     — what was really recorded in ai_usage_events over the window
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Coins, Cpu, Cloud, RefreshCw } from "lucide-react";
import { AI_FEATURE_AREAS, type AiAreaDef } from "@/lib/ai-feature-areas";
import {
  estimateHostedCost,
  estimateLocalCost,
  formatTokens,
  formatUsd,
  hostedModelForArea,
} from "@/lib/ai-pricing";
import { formatBillUsd, type AiAreaUsageRow } from "@/lib/ai-usage";
import { getAiAreaUsage, getAiFeatureToggles } from "@/lib/ai-usage.functions";

export const Route = createFileRoute("/admin/ai-costs")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "AI feature costs — Bostead Admin" },
      {
        name: "description",
        content:
          "Cloud cost per run and recorded usage for every Bostead AI feature, to plan which ones stay enabled.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AiCostsPage,
});

const WINDOWS = [7, 30, 90] as const;

/** 30-day run rate projected from the observed window. */
function monthlyProjection(row: AiAreaUsageRow | undefined, days: number): number {
  if (!row || row.meteredRuns === 0) return 0;
  return (row.costUsd / days) * 30;
}

function AiCostsPage() {
  const [days, setDays] = useState<number>(30);
  const usageFn = useServerFn(getAiAreaUsage);
  const togglesFn = useServerFn(getAiFeatureToggles);

  const usage = useQuery({
    queryKey: ["ai-area-usage", days],
    queryFn: () => usageFn({ data: { days } }),
  });
  const toggles = useQuery({
    queryKey: ["ai-feature-toggles"],
    queryFn: () => togglesFn({ data: undefined as never }),
  });

  const byArea = useMemo(
    () => new Map((usage.data?.rows ?? []).map((r) => [r.area, r])),
    [usage.data],
  );
  const enabled = useMemo(
    () => new Map((toggles.data ?? []).map((t) => [t.area, t.enabled])),
    [toggles.data],
  );

  const groups = useMemo(() => {
    const map = new Map<string, AiAreaDef[]>();
    for (const area of AI_FEATURE_AREAS) {
      map.set(area.group, [...(map.get(area.group) ?? []), area]);
    }
    // Heaviest projected spend first inside each group.
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          monthlyProjection(byArea.get(b.id), days) - monthlyProjection(byArea.get(a.id), days) ||
          (estimateHostedCost(b.id, hostedModelForArea(b.id)).usd ?? 0) -
            (estimateHostedCost(a.id, hostedModelForArea(a.id)).usd ?? 0),
      );
    }
    return Array.from(map.entries());
  }, [byArea, days]);

  const projectedMonthly = (usage.data?.rows ?? []).reduce(
    (n, r) => n + monthlyProjection(r, days),
    0,
  );

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Coins className="h-6 w-6" />
            AI feature costs
          </h1>
          <p className="text-sm text-muted-foreground">
            Cloud cost per run and what each feature actually used, so you can decide
            what to enable. Turn features on or off under{" "}
            <Link to="/admin/ai-runtime" className="underline underline-offset-2">
              AI runtime
            </Link>
            .
          </p>
        </header>

        <Card>
          <CardHeader className="space-y-1">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle className="text-base">
                Recorded usage · last {days} days
                {usage.data && !usage.data.allUsers ? " · your runs only" : ""}
              </CardTitle>
              <div className="flex items-center gap-2">
                {WINDOWS.map((w) => (
                  <Button
                    key={w}
                    size="sm"
                    variant={w === days ? "default" : "outline"}
                    onClick={() => setDays(w)}
                  >
                    {w}d
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => usage.refetch()}
                  disabled={usage.isFetching}
                  aria-label="Refresh usage"
                >
                  <RefreshCw className={`h-4 w-4 ${usage.isFetching ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-4 text-sm">
            <Stat label="Runs" value={usage.data ? usage.data.totalRuns.toLocaleString() : "—"} />
            <Stat
              label="Cloud runs (billed)"
              value={usage.data ? usage.data.totalMeteredRuns.toLocaleString() : "—"}
            />
            <Stat
              label="Cloud spend in window"
              value={usage.data ? formatBillUsd(usage.data.totalCostUsd) : "—"}
            />
            <Stat
              label="At this rate / 30 days"
              value={usage.data ? formatBillUsd(projectedMonthly) : "—"}
            />
          </CardContent>
        </Card>

        {usage.isError ? (
          <p className="text-sm text-destructive">
            Could not load usage: {(usage.error as Error).message}
          </p>
        ) : null}

        {groups.map(([group, areas]) => (
          <Card key={group}>
            <CardHeader>
              <CardTitle className="text-base">{group}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {areas.map((area) => {
                const row = byArea.get(area.id);
                const hostedModel = hostedModelForArea(area.id);
                const hosted = estimateHostedCost(area.id, hostedModel);
                const local = estimateLocalCost(area.id, "self-hosted model");
                const isOn = enabled.get(area.id) !== false;
                const projected = monthlyProjection(row, days);
                return (
                  <div
                    key={area.id}
                    className="rounded-lg border p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{area.label}</span>
                          <Badge variant={isOn ? "default" : "secondary"}>
                            {isOn ? "Enabled" : "Off"}
                          </Badge>
                          <Badge variant="outline">{area.load} prompt</Badge>
                          <Badge variant="outline" className="gap-1">
                            {area.recommended === "local" ? (
                              <Cpu className="h-3 w-3" />
                            ) : (
                              <Cloud className="h-3 w-3" />
                            )}
                            suggests {area.recommended === "local" ? "self-hosted" : "cloud"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground max-w-xl">
                          {area.description}
                        </p>
                      </div>
                      <div className="text-right text-sm">
                        <div className="font-mono">
                          {hosted.usd == null ? "cost unknown" : `${formatUsd(hosted.usd)} / cloud run`}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {formatUsd(local.usd)} power / self-hosted run
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-4 text-xs">
                      <Cell
                        label="Runs"
                        value={
                          row
                            ? `${row.runs} (${row.meteredRuns} cloud / ${row.localRuns} local)`
                            : "none yet"
                        }
                      />
                      <Cell
                        label="Actual cloud spend"
                        value={row ? formatBillUsd(row.costUsd) : "$0.00"}
                      />
                      <Cell
                        label="Avg / cloud run"
                        value={
                          row && row.meteredRuns
                            ? formatBillUsd(row.avgMeteredCostUsd)
                            : "no cloud runs"
                        }
                      />
                      <Cell
                        label="Projected / 30 days"
                        value={projected > 0 ? formatBillUsd(projected) : "$0.00"}
                      />
                    </div>

                    <p className="text-xs text-muted-foreground font-mono">
                      typical prompt {formatTokens(hosted.inputTokens)} in /{" "}
                      {formatTokens(hosted.outputTokens)} out · cloud model {hostedModel}
                      {row?.models.length ? ` · seen on ${row.models.join(", ")}` : ""}
                      {row?.anyEstimated ? " · some runs priced from estimated tokens" : ""}
                    </p>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}

        <p className="text-xs text-muted-foreground">
          Per-run figures are published list prices applied to this feature's typical
          prompt size; self-hosted runs cost electricity only and never appear on a
          cloud bill. Projections extrapolate the selected window to 30 days.
        </p>
      </div>
    </AppLayout>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold font-mono">{value}</div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-muted/40 px-2 py-1">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
}
