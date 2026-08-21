// UI for the model picker's context-window / parameter suitability warnings,
// plus the one-click remediation actions (raise num_ctx / switch model) that
// automatically rerun the AI test afterwards.
// Reads the pure heuristics in @/lib/ai-model-suitability so the rules stay
// testable and identical everywhere.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Gauge,
  HelpCircle,
  Loader2,
  Sparkles,
  XCircle,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  applyRecommendedContext,
  switchToSuggestedModel,
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
export function ModelSuitabilityPanel({ model }: { model: ModelCapability }) {
  const verdicts = evaluateModel(model);
  const params = model.paramsB ?? inferParamsB(model.id);

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-mono text-foreground">{model.id}</span>
        <span>Context: {fmtTokens(model.contextLength)}</span>
        <span>Parameters: {params != null ? `${params}B` : "unknown"}</span>
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

      <p className="text-[11px] text-muted-foreground">
        Requirements are heuristics: reports need ~8k+ context (a week of tasks
        is 4k–12k tokens) and manuals need ~16k+ context with a 7B+ model.
        Context length comes from the provider; parameter size is read from the
        model tag when the provider doesn't report it.
      </p>
    </div>
  );
}
