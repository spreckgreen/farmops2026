import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { runAiTest, type AiTestResult } from "@/lib/ai-models.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Zap } from "lucide-react";

function Row({
  label,
  value,
  ok,
}: {
  label: string;
  value: React.ReactNode;
  ok?: boolean | null;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b last:border-b-0">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2 text-sm font-mono">
        {ok === true && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
        {ok === false && <AlertTriangle className="h-4 w-4 text-amber-600" />}
        <span>{value}</span>
      </div>
    </div>
  );
}

/**
 * Admin-only diagnostic. Sends a short prompt through the currently-configured
 * AI provider (self-hosted CUSTOM_AI_* first, then Lovable, then bundled
 * Ollama) and reports which endpoint answered, latency, and HTTP status.
 *
 * When CUSTOM_AI_BASE_URL + CUSTOM_AI_API_KEY are set on the VPS, `provider`
 * will render as `custom` — that's the confirmation the self-hosted model is
 * doing the work and no traffic is leaving to ai.gateway.lovable.dev.
 */
export function RunAiTestCard({
  description,
}: {
  description?: string;
} = {}) {
  const testFn = useServerFn(runAiTest);
  const [result, setResult] = useState<AiTestResult | null>(null);

  const run = useMutation({
    mutationFn: () => testFn(),
    onSuccess: (r: AiTestResult) => {
      setResult(r);
      if (r.ok) toast.success(`AI responded in ${r.latencyMs} ms`);
      else toast.error(`AI test failed: ${r.error ?? `HTTP ${r.httpStatus}`}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="h-4 w-4" />
          Run AI test
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {description ??
            "Sends a short prompt through the currently-configured AI provider and reports which endpoint answered, the round-trip latency, and the HTTP status."}
        </p>
        <Button onClick={() => run.mutate()} disabled={run.isPending}>
          <Zap className="h-4 w-4 mr-1" />
          {run.isPending ? "Running…" : "Run AI test"}
        </Button>

        {result && (
          <div
            className={`rounded-md border p-3 text-sm space-y-2 ${
              result.ok
                ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30"
                : "border-red-300 bg-red-50 dark:bg-red-950/30"
            }`}
          >
            <div className="flex items-center gap-2 font-semibold">
              {result.ok ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-red-600" />
              )}
              {result.ok ? "AI test succeeded" : "AI test failed"}
            </div>
            <div>
              <Row label="Provider" value={result.provider} />
              <Row label="Endpoint" value={result.baseUrl} />
              <Row label="Model" value={result.model} />
              <Row
                label="Latency"
                value={`${result.latencyMs} ms`}
                ok={result.latencyMs < 10_000 ? true : null}
              />
              <Row
                label="HTTP status"
                value={result.httpStatus || "(no response)"}
                ok={result.ok}
              />
            </div>
            {result.reply && (
              <div className="pt-1">
                <div className="text-xs text-muted-foreground mb-1">Reply</div>
                <pre className="whitespace-pre-wrap break-words font-mono text-xs bg-background/60 rounded p-2">
                  {result.reply}
                </pre>
              </div>
            )}
            {result.error && (
              <div className="pt-1">
                <div className="text-xs text-muted-foreground mb-1">Error</div>
                <pre className="whitespace-pre-wrap break-words font-mono text-xs bg-background/60 rounded p-2">
                  {result.error}
                </pre>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
