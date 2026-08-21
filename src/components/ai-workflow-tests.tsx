// Per-workflow AI test runner UI.
//
// Instead of one generic "Run AI test" button, each workflow (connection,
// weekly report, manual generation) gets its own run and its own verdict, so a
// model that answers a short probe but truncates a week of tasks reads as
// "Connection: pass / Weekly report: fail" rather than a single green check.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  XCircle,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { runAiTest, type AiTestResult } from "@/lib/ai-models.functions";
import { AI_WORKFLOW_TESTS, type AiWorkflowKey } from "@/lib/ai-workflow-tests";
import { LEVEL_LABEL, type SuitabilityLevel } from "@/lib/ai-model-suitability";
import { AiTruncationWarning } from "@/components/ai-truncation-warning";

const LEVEL_BADGE: Record<SuitabilityLevel, string> = {
  good: "border-emerald-300 text-emerald-700 dark:text-emerald-400",
  marginal: "border-amber-300 text-amber-700 dark:text-amber-400",
  unsuitable: "border-destructive text-destructive",
  unknown: "border-muted-foreground/40 text-muted-foreground",
};

export type AiTestResults = Partial<Record<AiWorkflowKey, AiTestResult>>;

/**
 * Runs each workflow test independently and renders one row per workflow.
 * `onResult` lets a parent (e.g. the suitability panel) observe runs it
 * triggered itself after a one-click fix.
 */
export function AiWorkflowTests({
  /** Restrict to a subset, e.g. ["weekly_report", "manual"]. */
  only,
  onResult,
  className,
}: {
  only?: AiWorkflowKey[];
  onResult?: (result: AiTestResult) => void;
  className?: string;
}) {
  const testFn = useServerFn(runAiTest);
  const [results, setResults] = useState<AiTestResults>({});
  const [running, setRunning] = useState<AiWorkflowKey | "all" | null>(null);

  const workflows = AI_WORKFLOW_TESTS.filter((w) => !only || only.includes(w.key));
  const busy = running !== null;

  const run = async (key: AiWorkflowKey) => {
    const r = await testFn({ data: { workflow: key } });
    setResults((prev) => ({ ...prev, [key]: r }));
    onResult?.(r);
    if (r.ok && r.passed) toast.success(`${r.workflowLabel}: passed in ${r.latencyMs} ms`);
    else if (r.ok) toast.warning(`${r.workflowLabel}: reply didn't meet the requirements`);
    else toast.error(`${r.workflowLabel} failed: ${r.error ?? `HTTP ${r.httpStatus}`}`);
    return r;
  };

  const runOne = async (key: AiWorkflowKey) => {
    setRunning(key);
    try {
      await run(key);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(null);
    }
  };

  const runAll = async () => {
    setRunning("all");
    try {
      for (const w of workflows) {
        try {
          await run(w.key);
        } catch (e) {
          toast.error(`${w.label}: ${(e as Error).message}`);
        }
      }
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className={`space-y-3 ${className ?? ""}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">AI workflow tests</div>
        <Button size="sm" variant="secondary" className="h-7" disabled={busy} onClick={() => void runAll()}>
          {running === "all" ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Zap className="h-3.5 w-3.5 mr-1" />
          )}
          Run all
        </Button>
      </div>

      {workflows.map((w) => (
        <WorkflowRow
          key={w.key}
          label={w.label}
          description={w.description}
          result={results[w.key] ?? null}
          running={running === w.key || running === "all"}
          disabled={busy}
          onRun={() => void runOne(w.key)}
        />
      ))}

      <p className="text-[11px] text-muted-foreground">
        Each run sends that workflow's real prompt shape — the weekly report test
        feeds a full week of task lines, the manual test asks for a complete
        procedure — then checks the reply for the sections, steps, and detail the
        workflow needs. A pass here means that workflow works on this model.
      </p>
    </div>
  );
}

function WorkflowRow({
  label,
  description,
  result,
  running,
  disabled,
  onRun,
}: {
  label: string;
  description: string;
  result: AiTestResult | null;
  running: boolean;
  disabled: boolean;
  onRun: () => void;
}) {
  const [open, setOpen] = useState(false);
  const failedChecks = result?.checks.filter((c) => !c.ok) ?? [];

  return (
    <div className="rounded-md border bg-card p-3 space-y-2">
      <div className="flex items-start gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{label}</span>
            {result && (
              <Badge
                variant="outline"
                className={`text-[10px] ${
                  result.ok && result.passed
                    ? LEVEL_BADGE.good
                    : result.ok
                      ? LEVEL_BADGE.marginal
                      : LEVEL_BADGE.unsuitable
                }`}
              >
                {result.ok ? (result.passed ? "Passed" : "Fell short") : "Error"}
              </Badge>
            )}
            {result?.suitability && (
              <Badge variant="outline" className={`text-[10px] ${LEVEL_BADGE[result.suitability]}`}>
                Capability: {LEVEL_LABEL[result.suitability]}
              </Badge>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
        </div>

        <Button size="sm" variant="outline" className="h-7" disabled={disabled} onClick={onRun}>
          {running ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Zap className="h-3.5 w-3.5 mr-1" />
          )}
          {result ? "Rerun" : "Run"}
        </Button>
      </div>

      {running && (
        <p className="text-[11px] text-muted-foreground">
          Running — a long-form workflow on a local model can take a few minutes.
        </p>
      )}

      {result && (
        <>
          <div className="flex items-center gap-2 text-xs">
            {result.ok && result.passed ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : result.ok ? (
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            ) : (
              <XCircle className="h-4 w-4 text-destructive shrink-0" />
            )}
            <span className="font-mono truncate">
              {result.provider} · {result.model} · {result.latencyMs}ms
              {result.ok
                ? ` · ${result.checks.filter((c) => c.ok).length}/${result.checks.length} checks`
                : ` · ${result.error ?? `HTTP ${result.httpStatus}`}`}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 ml-auto"
              onClick={() => setOpen((o) => !o)}
            >
              {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
          </div>

          {!open && failedChecks.length > 0 && (
            <ul className="ml-5 list-disc text-[11px] text-muted-foreground">
              {failedChecks.map((c) => (
                <li key={c.label}>
                  {c.label} — {c.detail}
                </li>
              ))}
            </ul>
          )}

          {result.truncation && (
            <AiTruncationWarning truncation={result.truncation} className="mt-1" />
          )}

          {open && (
            <div className="space-y-2 border-t pt-2">
              {result.checks.length > 0 && (
                <ul className="space-y-1 text-xs">
                  {result.checks.map((c) => (
                    <li key={c.label} className="flex items-start gap-2">
                      {c.ok ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                      )}
                      <span>
                        {c.label}{" "}
                        <span className="text-muted-foreground">— {c.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {result.suitabilityReasons.length > 0 && (
                <div className="text-xs">
                  <div className="font-medium">Capability notes</div>
                  <ul className="mt-1 ml-5 list-disc text-muted-foreground space-y-0.5">
                    {result.suitabilityReasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  {result.suitabilityFix && (
                    <div className="mt-1 text-muted-foreground">
                      <span className="font-medium text-foreground">Fix: </span>
                      {result.suitabilityFix}
                    </div>
                  )}
                </div>
              )}

              <div className="text-xs font-mono space-y-1">
                <div>
                  <span className="text-muted-foreground">Endpoint:</span> {result.baseUrl}
                </div>
                <div>
                  <span className="text-muted-foreground">HTTP:</span>{" "}
                  {result.httpStatus || "(no response)"}
                </div>
                <div>
                  <span className="text-muted-foreground">Context limit:</span>{" "}
                  {result.contextLimit ? `${result.contextLimit} tokens` : "unknown"}
                </div>
              </div>

              {result.reply && (
                <pre className="whitespace-pre-wrap break-words bg-muted/50 rounded p-2 text-xs max-h-72 overflow-auto">
                  {result.reply}
                </pre>
              )}
              {result.error && (
                <pre className="whitespace-pre-wrap break-words bg-destructive/10 rounded p-2 text-xs">
                  {result.error}
                </pre>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
