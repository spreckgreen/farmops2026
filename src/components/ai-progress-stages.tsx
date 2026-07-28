import { useEffect, useState } from "react";
import { Check, Loader2, Circle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ProgressStage = {
  id: string;
  label: string;
  /** Approx seconds this stage typically takes. Used to auto-advance. */
  estSeconds: number;
};

export const DEFAULT_AI_STAGES: ProgressStage[] = [
  { id: "prepare", label: "Preparing request & gathering context", estSeconds: 1 },
  { id: "ai", label: "Running AI model", estSeconds: 12 },
  { id: "format", label: "Formatting & validating output", estSeconds: 2 },
];

/**
 * Client-side progress indicator for long-running server calls that can't
 * stream real progress. Auto-advances through stages based on estSeconds
 * while `active` is true. When `active` flips to false and `done` is true,
 * every stage is marked complete.
 */
export function AiProgressStages({
  active,
  done = false,
  stages = DEFAULT_AI_STAGES,
}: {
  active: boolean;
  done?: boolean;
  stages?: ProgressStage[];
}) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) {
      setCurrentIdx(0);
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const secs = (Date.now() - startedAt) / 1000;
      setElapsed(secs);
      let acc = 0;
      let idx = 0;
      for (let i = 0; i < stages.length; i++) {
        acc += stages[i].estSeconds;
        if (secs < acc) {
          idx = i;
          break;
        }
        // Cap at final stage; keep it spinning until active flips off.
        idx = stages.length - 1;
      }
      setCurrentIdx(idx);
    }, 200);
    return () => clearInterval(timer);
  }, [active, stages]);

  if (!active && !done) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-lg border border-border bg-muted/30 p-4 space-y-2"
    >
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-medium">
          {done ? "Complete" : "Working on your request…"}
        </p>
        {active && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {elapsed.toFixed(0)}s
          </span>
        )}
      </div>
      <ul className="space-y-1.5">
        {stages.map((s, i) => {
          const isDone = done || i < currentIdx;
          const isActive = !done && i === currentIdx && active;
          return (
            <li
              key={s.id}
              className="flex items-center gap-2 text-sm"
              aria-current={isActive ? "step" : undefined}
            >
              {isDone ? (
                <Check className="h-4 w-4 text-primary shrink-0" />
              ) : isActive ? (
                <Loader2 className="h-4 w-4 text-primary shrink-0 animate-spin" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />
              )}
              <span
                className={
                  isDone
                    ? "text-muted-foreground line-through"
                    : isActive
                      ? "text-foreground"
                      : "text-muted-foreground"
                }
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
