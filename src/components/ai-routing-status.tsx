// Read-only badge strip showing where a feature area's next AI call will run.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { Cloud, HardDrive, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { getAreaRoutingStatus } from "@/lib/ai-routing.functions";
import type { AiAreaId } from "@/lib/ai-feature-areas";

interface Props {
  area: AiAreaId;
  /** Hosted model this feature uses by default, so the preview matches the run. */
  hostedDefaultModel?: string;
  className?: string;
}

export function AiRoutingStatus({ area, hostedDefaultModel, className }: Props) {
  const load = useServerFn(getAreaRoutingStatus);
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["area-routing-status", area, hostedDefaultModel ?? null],
    queryFn: () => load({ data: { area, hostedDefaultModel } }),
    staleTime: 60_000,
  });

  return (
    <div
      className={
        "rounded-lg border border-border bg-card/40 px-4 py-3 text-sm " + (className ?? "")
      }
    >
      {isLoading ? (
        <span className="inline-flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking engine routing…
        </span>
      ) : !data ? (
        <span className="text-muted-foreground">Engine routing unavailable.</span>
      ) : (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              This run will use
            </span>
            {data.ok ? (
              <>
                <Badge
                  variant={data.backend === "hosted" ? "default" : "secondary"}
                  className="inline-flex items-center gap-1"
                >
                  {data.backend === "hosted" ? (
                    <Cloud className="h-3 w-3" />
                  ) : (
                    <HardDrive className="h-3 w-3" />
                  )}
                  {data.backend === "hosted" ? "Cloud" : "Self-hosted"}
                </Badge>
                <Badge variant="outline">{data.engineLabel}</Badge>
                <Badge variant="outline" className="font-mono text-[11px]">
                  {data.modelId}
                </Badge>
              </>
            ) : (
              <Badge variant="destructive" className="inline-flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Not runnable
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw
                className={"h-3 w-3 " + (isFetching ? "animate-spin" : "")}
              />
            </Button>
          </div>

          {data.ok ? (
            <p className="text-xs text-muted-foreground">
              Routing choice: <span className="font-medium">{data.choice}</span>
              {data.backend === "local"
                ? data.autoFallback && data.hostedAvailable
                  ? ` — if the local model fails, it retries on cloud (${data.hostedModelId}).`
                  : " — no cloud fallback is configured, so a local failure ends the run."
                : " — cloud-routed features never fall back to self-hosted."}{" "}
              <Link to="/admin/ai-settings" className="underline hover:text-primary">
                Change routing
              </Link>
            </p>
          ) : (
            <p className="text-xs text-destructive">
              {data.error}{" "}
              <Link to="/admin/ai-engines" className="underline">
                Fix engines
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
