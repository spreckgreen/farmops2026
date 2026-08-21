// Banner shown above an AI answer when it looks cut off (or nearly was).
// Always states the numbers behind the claim: estimated/reported input and
// output tokens, the total, and the context window that was hit.
import { AlertTriangle, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  formatTokens,
  truncationAdvice,
  truncationHeadline,
  type TruncationSignal,
} from "@/lib/ai-truncation";

export function AiTruncationWarning({
  signal,
  className,
}: {
  signal: TruncationSignal | null | undefined;
  className?: string;
}) {
  if (!signal || !signal.reason) return null;
  const caution = signal.reason === "context-pressure";
  const pct =
    signal.usedFraction != null ? `${Math.round(signal.usedFraction * 100)}%` : null;

  return (
    <Alert variant={caution ? "default" : "destructive"} className={className}>
      {caution ? <Info className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
      <AlertTitle className="text-sm">{truncationHeadline(signal)}</AlertTitle>
      <AlertDescription className="space-y-1 text-xs">
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono">
          <span>in {formatTokens(signal.inputTokens)}</span>
          <span>out {formatTokens(signal.outputTokens)}</span>
          <span>total {formatTokens(signal.totalTokens)}</span>
          <span>
            limit {formatTokens(signal.contextLimit)}
            {pct ? ` (${pct} used)` : ""}
          </span>
          {signal.model && <span>{signal.model}</span>}
          {signal.finishReason && <span>finish: {signal.finishReason}</span>}
        </div>
        {signal.estimated && (
          <div className="text-muted-foreground">
            Token counts are estimated at ~4 characters per token — the provider didn't report
            usage.
          </div>
        )}
        <div>{truncationAdvice(signal)}</div>
      </AlertDescription>
    </Alert>
  );
}
