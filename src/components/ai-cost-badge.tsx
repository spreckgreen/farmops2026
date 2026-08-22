// Per-run cost estimate shown next to each AI option (local vs hosted).
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { Coins, Zap } from "lucide-react";
import {
  formatCredits,
  formatTokens,
  formatUsd,
  type CostEstimate,
} from "@/lib/ai-pricing";

export function AiCostBadge({
  estimate,
  label,
}: {
  estimate: CostEstimate;
  /** Prefix such as "Hosted" or "Local". */
  label?: string;
}) {
  const hosted = estimate.kind === "hosted";
  const text =
    hosted
      ? estimate.usd == null
        ? "cost unknown"
        : `${formatUsd(estimate.usd)}/run`
      : `${formatUsd(estimate.usd)}/run power`;

  return (
    <TooltipProvider delayDuration={150}>
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className="gap-1 font-normal cursor-help">
          {hosted ? <Coins className="h-3 w-3" /> : <Zap className="h-3 w-3" />}
          {label ? <span className="text-muted-foreground">{label}</span> : null}
          {text}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs space-y-1">
        <div className="font-medium">
          {hosted ? "Hosted AI (metered per token)" : "Local model (electricity only)"}
        </div>
        <div className="font-mono">{estimate.modelId}</div>
        <div>
          Typical run: {formatTokens(estimate.inputTokens)} in +{" "}
          {formatTokens(estimate.outputTokens)} out tokens
        </div>
        {hosted ? (
          estimate.usd == null ? (
            <div>No published price for this model id, so no estimate.</div>
          ) : (
            <div>
              {formatUsd(estimate.usd)} ≈ {formatCredits(estimate.credits ?? 0)} at list
              prices.
            </div>
          )
        ) : (
          <div>
            ≈ {estimate.seconds < 1 ? "<1" : Math.round(estimate.seconds)}s at 25 tok/s,
            250 W, $0.17/kWh → {estimate.kwh.toFixed(4)} kWh. No per-token billing.
          </div>
        )}
        <div className="text-muted-foreground">
          Estimate only — actual cost depends on prompt size and model pricing.
        </div>
      </TooltipContent>
    </Tooltip>
    </TooltipProvider>
  );
}
