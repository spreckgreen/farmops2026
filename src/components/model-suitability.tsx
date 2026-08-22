// UI for the model picker's context-window / parameter suitability warnings,
// plus the one-click remediation actions (raise num_ctx / switch model) that
// automatically rerun the AI test afterwards.
// Reads the pure heuristics in @/lib/ai-model-suitability so the rules stay
// testable and identical everywhere.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Gauge,
  HelpCircle,
  Loader2,
  Sparkles,
  Trash2,
  Undo2,
  XCircle,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  buildTagDeletionPlan,
  describeDeletionPlan,
  describeAutoRollback,
  shouldAutoRollback,
} from "@/lib/ai-model-rollback";
import {
  applyRecommendedContext,
  switchToSuggestedModel,
  rollbackAiModel,
  getAiModelRollback,
  runAiTest,
  type AiTestResult,
} from "@/lib/ai-models.functions";
import {
  evaluateModel,
  inferParamsB,
  overallLevel,
  recommendedContext,
  suggestedLargerModel,
  derivedContextModelId,
  LEVEL_LABEL,
  type ModelCapability,
  type SuitabilityLevel,
} from "@/lib/ai-model-suitability";


const LEVEL_BADGE: Record<SuitabilityLevel, string> = {
  good: "border-emerald-300 text-emerald-700 dark:text-emerald-400",
  marginal: "border-amber-300 text-amber-700 dark:text-amber-400",
  unsuitable: "border-destructive text-destructive",
  unknown: "border-muted-foreground/40 text-muted-foreground",
};

function LevelIcon({ level }: { level: SuitabilityLevel }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  if (level === "good") return <CheckCircle2 className={`${cls} text-emerald-600`} />;
  if (level === "marginal") return <AlertTriangle className={`${cls} text-amber-600`} />;
  if (level === "unsuitable") return <XCircle className={`${cls} text-destructive`} />;
  return <HelpCircle className={`${cls} text-muted-foreground`} />;
}

function fmtTokens(n: number | null | undefined): string {
  if (!n) return "unknown";
  return n >= 1024 ? `${Math.round(n / 1024)}k tokens` : `${n} tokens`;
}

/** Compact badge for a row inside the model dropdown. */
export function ModelSuitabilityBadge({ model }: { model: ModelCapability }) {
  const level = overallLevel(evaluateModel(model));
  return (
    <Badge variant="outline" className={`ml-2 text-[10px] ${LEVEL_BADGE[level]}`}>
      {LEVEL_LABEL[level]}
    </Badge>
  );
}

/** Full per-task breakdown for the currently selected model. */
export function ModelSuitabilityPanel({
  model,
  /** Show the one-click fix buttons (Ollama endpoints only). */
  showActions = false,
  /** Called with the new active model id after a fix is applied. */
  onModelChanged,
}: {
  model: ModelCapability;
  showActions?: boolean;
  onModelChanged?: (model: string) => void;
}) {
  const verdicts = evaluateModel(model);
  const params = model.paramsB ?? inferParamsB(model.id);

  return (
    <div className="rounded-md border p-3 space-y-3">

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-mono text-foreground">{model.id}</span>
        <span>
          Context: {fmtTokens(model.contextLength)}
          {model.contextSource === "num_ctx" && " (num_ctx)"}
          {model.contextSource === "runtime-default" && " (runtime default)"}
        </span>
        {model.trainedContextLength != null &&
          model.trainedContextLength !== model.contextLength && (
            <span>Trained window: {fmtTokens(model.trainedContextLength)}</span>
          )}
        <span>
          Parameters: {params != null ? `${params}B` : "unknown"}
          {model.paramsB == null && params != null && " (from tag)"}
        </span>
      </div>


      <div className="space-y-2">
        {verdicts.map((v) => (
          <div key={v.task.key} className="text-xs">
            <div className="flex items-center gap-2">
              <LevelIcon level={v.level} />
              <span className="font-medium">{v.task.label}</span>
              <Badge variant="outline" className={`text-[10px] ${LEVEL_BADGE[v.level]}`}>
                {LEVEL_LABEL[v.level]}
              </Badge>
            </div>
            {v.reasons.length > 0 && (
              <ul className="mt-1 ml-5 list-disc space-y-0.5 text-muted-foreground">
                {v.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
            {v.fix && (
              <div className="mt-1 ml-5 text-muted-foreground">
                <span className="font-medium text-foreground">Fix: </span>
                {v.fix}
              </div>
            )}
            {v.level === "good" && (
              <div className="mt-1 ml-5 text-muted-foreground">
                Enough context and capacity for this job.
              </div>
            )}
          </div>
        ))}
      </div>

      {showActions && (
        <SuitabilityActions model={model} onModelChanged={onModelChanged} />
      )}

      <p className="text-[11px] text-muted-foreground">
        Requirements are heuristics: reports need ~8k+ context (a week of tasks
        is 4k–12k tokens) and manuals need ~16k+ context with a 7B+ model.
        Context length comes from the provider; parameter size is read from the
        model tag when the provider doesn't report it.
      </p>
    </div>
  );
}

/**
 * One-click fixes. Each action persists the new active model, then immediately
 * reruns the AI test so you can see the change actually works end to end.
 *
 * "Set num_ctx" creates a derived Ollama model (e.g. llama3.2:3b + 32768 ->
 * llama3.2-3b-ctx32k) because Ollama's OpenAI-compatible endpoint ignores a
 * per-request num_ctx — baking it into the model is what makes it stick.
 */
function SuitabilityActions({
  model,
  onModelChanged,
}: {
  model: ModelCapability;
  onModelChanged?: (model: string) => void;
}) {
  const applyCtxFn = useServerFn(applyRecommendedContext);
  const switchFn = useServerFn(switchToSuggestedModel);
  const testFn = useServerFn(runAiTest);
  const rollbackFn = useServerFn(rollbackAiModel);
  const [tests, setTests] = useState<AiTestResult[]>([]);
  const [testing, setTesting] = useState(false);
  const [deleteTag, setDeleteTag] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [autoReverted, setAutoReverted] = useState<string | null>(null);
  const queryClient = useQueryClient();


  // Rollback point recorded by the last model change (server-persisted, so it
  // survives reloads and restarts).
  const rollback = useQuery({
    queryKey: ["ai-model-rollback"],
    queryFn: () => getAiModelRollback(),
  });

  const targetCtx = recommendedContext(model);
  const largerModel = suggestedLargerModel(model);
  const alreadyDerived = /-ctx\d+k$/.test(model.id);


  // After a fix, rerun the workflows the fix was meant to unblock — a weekly
  // report and a manual are graded separately, so you see which one now works.
  // Returns the results so the caller can auto-roll-back on failure.
  const rerunTest = async (): Promise<AiTestResult[]> => {
    setTesting(true);
    setTests([]);
    const results: AiTestResult[] = [];
    try {
      for (const workflow of ["weekly_report", "manual"] as const) {
        const r = await testFn({ data: { workflow } });
        results.push(r);
        setTests([...results]);
        if (r.ok && r.passed) toast.success(`${r.workflowLabel} passed in ${r.latencyMs} ms`);
        else if (r.ok) toast.warning(`${r.workflowLabel}: reply fell short of the requirements`);
        else toast.error(`${r.workflowLabel} failed: ${r.error ?? `HTTP ${r.httpStatus}`}`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTesting(false);
    }
    return results;
  };

  // Automatic rollback: if a post-change weekly_report or manual run fails, put
  // the previous model back straight away. The created tag is intentionally
  // kept — deleting it still requires the explicit confirmation below.
  const verifyOrRollback = async (previousModel: string | null) => {
    const results = await rerunTest();
    if (!previousModel || !shouldAutoRollback(results)) return;
    toast.warning(describeAutoRollback(results, previousModel));
    setAutoReverted(describeAutoRollback(results, previousModel));
    try {
      const r = await rollbackFn({ data: { deleteCreatedTag: false } });
      toast.success(`Automatically restored ${r.model} (was ${r.restoredFrom})`);
      onModelChanged?.(r.model);
    } catch (e) {
      toast.error(`Automatic rollback failed: ${(e as Error).message}`);
    }
    await queryClient.invalidateQueries({ queryKey: ["ai-model-rollback"] });
  };

  const applyCtx = useMutation({
    mutationFn: () =>
      applyCtxFn({ data: { baseModel: model.id, numCtx: targetCtx ?? 32768 } }),
    onSuccess: async (r) => {
      toast.success(`Active model is now ${r.model} (num_ctx ${r.numCtx})`);
      onModelChanged?.(r.model);
      setAutoReverted(null);
      await queryClient.invalidateQueries({ queryKey: ["ai-model-rollback"] });
      await verifyOrRollback(r.previousModel ?? null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const switchModel = useMutation({
    mutationFn: () => switchFn({ data: { model: largerModel ?? "qwen2.5:7b" } }),
    onSuccess: async (r) => {
      toast.success(
        r.pulled ? `Pulled and activated ${r.model}` : `Active model is now ${r.model}`,
      );
      onModelChanged?.(r.model);
      setAutoReverted(null);
      await queryClient.invalidateQueries({ queryKey: ["ai-model-rollback"] });
      await verifyOrRollback(r.previousModel ?? null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const undo = useMutation({
    mutationFn: (opts: { deleteCreatedTag: boolean }) =>
      rollbackFn({ data: { deleteCreatedTag: opts.deleteCreatedTag } }),
    onSuccess: async (r) => {
      toast.success(
        r.deletedTag
          ? `Restored ${r.model} and deleted ${r.deletedTag}`
          : `Restored ${r.model} (was ${r.restoredFrom})`,
      );
      onModelChanged?.(r.model);
      setTests([]);
      setConfirmOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["ai-model-rollback"] });
      await rerunTest();
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const point = rollback.data;
  const deletionPlan = buildTagDeletionPlan(point?.point ?? null, point?.currentModel ?? null);
  const busy = applyCtx.isPending || switchModel.isPending || undo.isPending || testing;

  return (
    <div className="pt-2 border-t space-y-2">
      <div className="text-xs font-medium">One-click fixes</div>

      <div className="flex flex-wrap gap-2">
        {targetCtx && !alreadyDerived && (
          <Button
            size="sm"
            variant="secondary"
            className="h-7"
            disabled={busy}
            onClick={() => applyCtx.mutate()}
            title={`Creates ${derivedContextModelId(model.id, targetCtx)} with PARAMETER num_ctx ${targetCtx} and activates it`}
          >
            {applyCtx.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Gauge className="h-3.5 w-3.5 mr-1" />
            )}
            Set num_ctx to {Math.round(targetCtx / 1024)}k
          </Button>
        )}

        {largerModel && (
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={busy}
            onClick={() => switchModel.mutate()}
            title={`Pulls ${largerModel} if missing, then makes it the active model`}
          >
            {switchModel.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 mr-1" />
            )}
            Switch to {largerModel}
          </Button>
        )}

        <Button
          size="sm"
          variant="ghost"
          className="h-7"
          disabled={busy}
          onClick={() => void rerunTest()}
        >
          {testing ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Zap className="h-3.5 w-3.5 mr-1" />
          )}
          Rerun workflow tests
        </Button>
      </div>

      {autoReverted && (
        <p className="text-[11px] text-destructive">
          Automatic rollback: {autoReverted} The tag created by the change was kept — deleting it
          needs explicit approval.
        </p>
      )}

      {point?.available && point.point && (
        <div className="rounded-md border border-amber-300/60 bg-amber-50/50 dark:bg-amber-950/20 p-2 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={busy}
              onClick={() => {
                if (deleteTag && deletionPlan.remove.length > 0) setConfirmOpen(true);
                else undo.mutate({ deleteCreatedTag: false });
              }}
              title={`Restores ${point.point.previousModel} as the active model`}
            >
              {undo.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Undo2 className="h-3.5 w-3.5 mr-1" />
              )}
              Roll back to {point.point.previousModel}
            </Button>
            {point.deletableTag && (
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-3 w-3 accent-current"
                  checked={deleteTag}
                  disabled={busy}
                  onChange={(e) => setDeleteTag(e.target.checked)}
                />
                Also delete <span className="font-mono">{point.deletableTag}</span> from Ollama
              </label>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {point.label} · changed{" "}
            {new Date(point.point.changedAt).toLocaleString()}
          </p>

          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete these Ollama models?</AlertDialogTitle>
                <AlertDialogDescription>
                  {describeDeletionPlan(deletionPlan)} Rolling back to{" "}
                  <span className="font-mono">{point.point.previousModel}</span> happens either way.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-2 text-xs">
                <div>
                  <div className="font-medium text-destructive">Will be removed</div>
                  <ul className="mt-1 space-y-0.5">
                    {deletionPlan.remove.map((tag) => (
                      <li key={tag} className="font-mono flex items-center gap-1.5">
                        <Trash2 className="h-3 w-3 text-destructive shrink-0" />
                        {tag}
                      </li>
                    ))}
                  </ul>
                </div>
                {deletionPlan.keep.length > 0 && (
                  <div>
                    <div className="font-medium">Kept</div>
                    <ul className="mt-1 space-y-0.5 text-muted-foreground">
                      {deletionPlan.keep.map((k) => (
                        <li key={k.tag}>
                          <span className="font-mono">{k.tag}</span> — {k.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={undo.isPending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={undo.isPending}
                  onClick={(e) => {
                    e.preventDefault();
                    undo.mutate({ deleteCreatedTag: true });
                  }}
                >
                  {undo.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                  Roll back and delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}



      {(applyCtx.isPending || switchModel.isPending) && (
        <p className="text-[11px] text-muted-foreground">
          {applyCtx.isPending
            ? "Creating the derived model in Ollama — this takes a few seconds."
            : "Pulling the model if it isn't local yet — a few GB can take several minutes."}
        </p>
      )}

      {tests.map((test) => {
        const failed = test.checks.filter((c) => !c.ok).map((c) => c.label);
        const summary = test.ok
          ? `${test.checks.length - failed.length}/${test.checks.length} checks` +
            (failed.length ? ` — failed: ${failed.join(", ")}` : "")
          : test.error ?? `HTTP ${test.httpStatus}`;
        return (
          <div key={test.workflow} className="flex items-start gap-2 text-xs">
            {test.ok && test.passed ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle
                className={`h-4 w-4 shrink-0 ${test.ok ? "text-amber-600" : "text-destructive"}`}
              />
            )}
            <span className="font-mono break-all">
              {test.workflowLabel} · {test.model} · {test.latencyMs}ms · {summary}
            </span>
          </div>
        );
      })}



      {!targetCtx && !largerModel && (
        <p className="text-[11px] text-muted-foreground">
          Nothing to fix — this model already has enough context and capacity.
        </p>
      )}
    </div>
  );
}

