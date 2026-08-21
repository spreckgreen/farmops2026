import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { runAiTest, type AiTestResult } from "@/lib/ai-models.functions";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Zap, ChevronDown, ChevronUp } from "lucide-react";

/**
 * Compact admin-only diagnostic. Sends a short prompt through the configured
 * AI provider and shows a one-line result. Expand for full details.
 */
export function RunAiTestCard({
  description: _description,
}: {
  description?: string;
} = {}) {
  const testFn = useServerFn(runAiTest);
  const [result, setResult] = useState<AiTestResult | null>(null);
  const [open, setOpen] = useState(false);

  const run = useMutation({
    mutationFn: () => testFn({ data: { workflow: "smoke" as const } }),
    onSuccess: (r: AiTestResult) => {
      setResult(r);
      if (r.ok) toast.success(`AI responded in ${r.latencyMs} ms`);
      else toast.error(`AI test failed: ${r.error ?? `HTTP ${r.httpStatus}`}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-md border bg-card px-3 py-2 text-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          variant="outline"
          onClick={() => run.mutate()}
          disabled={run.isPending}
          className="h-7 px-2"
        >
          <Zap className="h-3.5 w-3.5 mr-1" />
          {run.isPending ? "Testing…" : "Run AI test"}
        </Button>

        {result && (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {result.ok ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
            )}
            <span className="font-mono text-xs truncate">
              {result.provider} · {result.model} · {result.latencyMs}ms
              {result.ok ? "" : ` · ${result.error ?? `HTTP ${result.httpStatus}`}`}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setOpen((o) => !o)}
              className="h-6 px-1.5 ml-auto"
            >
              {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
          </div>
        )}
      </div>

      {result && open && (
        <div className="mt-2 pt-2 border-t space-y-1 text-xs font-mono">
          <div><span className="text-muted-foreground">Endpoint:</span> {result.baseUrl}</div>
          <div><span className="text-muted-foreground">HTTP:</span> {result.httpStatus || "(no response)"}</div>
          {result.reply && (
            <pre className="whitespace-pre-wrap break-words bg-muted/50 rounded p-2 mt-1">
              {result.reply}
            </pre>
          )}
          {result.error && (
            <pre className="whitespace-pre-wrap break-words bg-red-50 dark:bg-red-950/30 rounded p-2 mt-1">
              {result.error}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
