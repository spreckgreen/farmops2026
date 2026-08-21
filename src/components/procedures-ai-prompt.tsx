// Ask-AI prompt bar rendered above the Procedures list. Sends the user's
// question through askProceduresAi (which routes via createAiProvider, so
// self-host / Lovable / bundled-Ollama all just work) and shows the answer,
// which sources the model saw, model id, and round-trip latency.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { askProceduresAi, type ProceduresAiAnswer } from "@/lib/procedures.functions";
import { AiTruncationWarning } from "@/components/ai-truncation-warning";


export function ProceduresAiPrompt() {
  const askFn = useServerFn(askProceduresAi);
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<ProceduresAiAnswer | null>(null);

  const ask = useMutation({
    mutationFn: (p: string) => askFn({ data: { prompt: p } }),
    onSuccess: (r) => setResult(r),
    onError: (e: Error) => toast.error(e.message),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = prompt.trim();
    if (!p) return;
    setResult(null);
    ask.mutate(p);
  };

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <form onSubmit={onSubmit} className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Ask AI about your procedures
          </label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. What's the winter shutdown checklist for the orchard sprayer?"
            rows={2}
            maxLength={2000}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") onSubmit(e);
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Answers use only your saved procedures.{" "}
              <kbd className="px-1 py-0.5 rounded border text-[10px]">⌘/Ctrl</kbd>+
              <kbd className="px-1 py-0.5 rounded border text-[10px]">Enter</kbd> to send.
            </p>
            <Button type="submit" disabled={ask.isPending || !prompt.trim()}>
              {ask.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Thinking…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-1" /> Ask
                </>
              )}
            </Button>
          </div>
        </form>

        {ask.error && (
          <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
            <span>{(ask.error as Error).message}</span>
          </div>
        )}

        {result && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="whitespace-pre-wrap text-sm">{result.answer}</div>
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t text-xs text-muted-foreground">
              <Badge variant="secondary" className="font-mono">{result.model}</Badge>
              <span>{result.latencyMs} ms</span>
              {result.sources.length > 0 && (
                <span>
                  · saw {result.sources.length} procedure
                  {result.sources.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
