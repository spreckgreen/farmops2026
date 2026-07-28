// Reusable AI action preview dialog. Renders a plan grouped by action type,
// lets the user toggle actions off, edit interval values inline, and apply.
// First consumer: maintenance schedule generation.
import { useState, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { applyActionPlan } from "@/lib/ai-actions/apply.functions";
import type { Action, ActionPlan, ActionResult } from "@/lib/ai-actions/types";
import { CheckCircle2, XCircle, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  plan: ActionPlan;
  onApplied?: (result: {
    status: string;
    results: ActionResult[];
    reused: boolean;
  }) => void;
  onClose?: () => void;
}

export function AiActionPreview({ plan, onApplied, onClose }: Props) {
  // Local edit state: keyed by index into plan.actions.
  const [enabled, setEnabled] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(plan.actions.map((_, i) => [i, true])),
  );
  const [edits, setEdits] = useState<Record<number, Partial<Action>>>({});

  const applyFn = useServerFn(applyActionPlan);
  const [applied, setApplied] = useState<{
    results: ActionResult[];
    status: string;
    reused: boolean;
  } | null>(null);

  const finalActions = useMemo<Action[]>(() => {
    return plan.actions
      .map((a, i): Action | null => {
        if (!enabled[i]) return null;
        const patch = edits[i] ?? {};
        if (a.type === "maintenance.create_interval") {
          const trigger = (patch.trigger_type ?? a.trigger_type) as
            | "hours"
            | "miles"
            | "months";
          const value = Number(patch.interval_value ?? a.interval_value) || 1;
          return {
            ...a,
            trigger_type: trigger,
            interval_value: value,
            recurrence:
              trigger === "hours"
                ? `every ${value} hours`
                : trigger === "miles"
                  ? `every ${value} miles`
                  : value === 1
                    ? "every month"
                    : `every ${value} months`,
          };
        }
        return a;
      })
      .filter((a): a is Action => a !== null);
  }, [plan.actions, enabled, edits]);

  const applyMut = useMutation({
    mutationFn: async () => {
      return applyFn({
        data: {
          ...plan,
          actions: finalActions,
        },
      });
    },
    onSuccess: (res) => {
      setApplied(res);
      onApplied?.(res);
      const okCount = res.results.filter((r) => r.ok).length;
      const failCount = res.results.length - okCount;
      if (res.reused) {
        toast.info("This plan was already applied. Showing prior results.");
      } else if (failCount === 0) {
        toast.success(`Applied ${okCount} action${okCount === 1 ? "" : "s"}`);
      } else if (okCount === 0) {
        toast.error(`All ${failCount} action(s) failed`);
      } else {
        toast.warning(`Applied ${okCount}, ${failCount} failed`);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Apply failed"),
  });

  const resultByIndex = useMemo(() => {
    if (!applied) return null;
    const map = new Map<number, ActionResult>();
    const enabledIdx = plan.actions.map((_, i) => i).filter((i) => enabled[i]);
    applied.results.forEach((r, i) => {
      const originalIdx = enabledIdx[i];
      if (originalIdx !== undefined) map.set(originalIdx, r);
    });
    return map;
  }, [applied, plan.actions, enabled]);

  const enabledCount = Object.values(enabled).filter(Boolean).length;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-semibold">AI proposed schedule</span>
          <span className="text-xs text-muted-foreground">
            model: {plan.model}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{plan.summary}</p>
        {plan.citations.length > 0 && (
          <ul className="mt-2 text-xs text-muted-foreground list-disc pl-5">
            {plan.citations.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3">
        {plan.actions.map((a, i) => {
          if (a.type !== "maintenance.create_interval") return null;
          const patch = edits[i] ?? {};
          const trigger = (patch.trigger_type ?? a.trigger_type) as
            | "hours"
            | "miles"
            | "months";
          const value = Number(patch.interval_value ?? a.interval_value) || 1;
          const result = resultByIndex?.get(i);
          const disabled = !enabled[i];
          return (
            <div
              key={i}
              className={`rounded-lg border p-4 ${
                disabled
                  ? "border-border/50 bg-card/20 opacity-60"
                  : "border-border bg-card/40"
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={enabled[i]}
                  disabled={!!applied}
                  onChange={(e) =>
                    setEnabled((prev) => ({ ...prev, [i]: e.target.checked }))
                  }
                  className="mt-1 accent-[oklch(0.78_0.17_65)]"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{a.title}</span>
                    {result?.ok && (
                      <span className="inline-flex items-center gap-1 text-xs text-green-600">
                        <CheckCircle2 className="h-3 w-3" /> applied
                      </span>
                    )}
                    {result && !result.ok && (
                      <span className="inline-flex items-center gap-1 text-xs text-destructive">
                        <XCircle className="h-3 w-3" /> {result.error}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-sm flex-wrap">
                    <span className="text-muted-foreground">Every</span>
                    <Input
                      type="number"
                      min={1}
                      value={value}
                      disabled={!!applied}
                      onChange={(e) =>
                        setEdits((prev) => ({
                          ...prev,
                          [i]: {
                            ...prev[i],
                            interval_value: Number(e.target.value) || 1,
                          },
                        }))
                      }
                      className="h-8 w-24"
                    />
                    <select
                      value={trigger}
                      disabled={!!applied}
                      onChange={(e) =>
                        setEdits((prev) => ({
                          ...prev,
                          [i]: {
                            ...prev[i],
                            trigger_type: e.target.value as
                              | "hours"
                              | "miles"
                              | "months",
                          },
                        }))
                      }
                      className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                    >
                      <option value="hours">hours</option>
                      <option value="miles">miles</option>
                      <option value="months">months</option>
                    </select>
                  </div>
                  {a.description && (
                    <pre className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap font-sans">
                      {a.description}
                    </pre>
                  )}
                  {a.parts.length > 0 && (
                    <div className="mt-2 text-xs">
                      <span className="text-muted-foreground">Parts: </span>
                      {a.parts.map((p, pi) => (
                        <span
                          key={pi}
                          className={`inline-block mr-2 px-2 py-0.5 rounded ${
                            p.inventory_item_id
                              ? "bg-green-500/10 text-green-700 dark:text-green-400"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {p.name} × {p.quantity}
                          {p.inventory_item_id ? " ✓" : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 pt-2">
        <span className="text-sm text-muted-foreground">
          {enabledCount} of {plan.actions.length} selected
        </span>
        <div className="flex gap-2">
          {applied ? (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={() => applyMut.mutate()}
                disabled={applyMut.isPending || enabledCount === 0}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {applyMut.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Applying…
                  </>
                ) : (
                  `Apply ${enabledCount} action${enabledCount === 1 ? "" : "s"}`
                )}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
