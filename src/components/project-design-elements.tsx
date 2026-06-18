import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Plus, Trash2, ArrowRight, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import {
  listProjectDesignElements,
  upsertProjectDesignElement,
  setProjectDesignElementCompleted,
  deleteProjectDesignElement,
  promoteDesignElementToBacklog,
} from "@/lib/log.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";

type Element = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  weight: number;
  completed: boolean;
  task_id: string | null;
  sort_order: number;
  task?: { id: string; slug: string; status: string; percent_complete: number } | null;
};

export function ProjectDesignElements({ projectId }: { projectId: string }) {
  const listFn = useServerFn(listProjectDesignElements);
  const upsertFn = useServerFn(upsertProjectDesignElement);
  const toggleFn = useServerFn(setProjectDesignElementCompleted);
  const deleteFn = useServerFn(deleteProjectDesignElement);
  const promoteFn = useServerFn(promoteDesignElementToBacklog);
  const qc = useQueryClient();

  const key = ["project-design-elements", projectId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { project_id: projectId } }) as Promise<Element[]>,
  });

  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftWeight, setDraftWeight] = useState<string>("10");

  const reset = () => {
    setAdding(false);
    setEditId(null);
    setDraftTitle("");
    setDraftDesc("");
    setDraftWeight("10");
  };

  const save = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          id: editId,
          project_id: projectId,
          title: draftTitle.trim(),
          description: draftDesc.trim() || null,
          weight: Number(draftWeight) || 0,
        },
      }),
    onSuccess: () => {
      toast.success(editId ? "Element updated" : "Element added");
      qc.invalidateQueries({ queryKey: key });
      reset();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const toggle = useMutation({
    mutationFn: (v: { id: string; completed: boolean }) =>
      toggleFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Element removed");
      qc.invalidateQueries({ queryKey: key });
    },
  });

  const promote = useMutation({
    mutationFn: (id: string) => promoteFn({ data: { id } }),
    onSuccess: (res) => {
      if (res.already) toast.info("Already in backlog");
      else toast.success("Added to backlog");
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const elements = q.data ?? [];

  const { totalWeight, completedWeight, pct, otherWeight, remaining } = useMemo(() => {
    const total = elements.reduce((s, e) => s + Number(e.weight ?? 0), 0);
    const done = elements
      .filter((e) => e.completed || e.task?.status === "done")
      .reduce((s, e) => s + Number(e.weight ?? 0), 0);
    const other = elements
      .filter((e) => e.id !== editId)
      .reduce((s, e) => s + Number(e.weight ?? 0), 0);
    return {
      totalWeight: total,
      completedWeight: done,
      pct: total > 0 ? Math.round((done / total) * 100) : 0,
      otherWeight: other,
      remaining: Math.max(0, 100 - other),
    };
  }, [elements, editId]);

  const draftWeightNum = Number(draftWeight) || 0;
  const overCap = draftWeightNum > remaining;


  const startEdit = (el: Element) => {
    setEditId(el.id);
    setAdding(true);
    setDraftTitle(el.title);
    setDraftDesc(el.description ?? "");
    setDraftWeight(String(el.weight));
  };

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Design elements · {elements.length}
          </h3>
          {elements.length > 0 && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {pct}% complete · {completedWeight.toFixed(0)}/{totalWeight.toFixed(0)} pts
            </Badge>
          )}
          <Badge
            variant="outline"
            className={`font-mono text-[10px] ${totalWeight > 100 ? "border-destructive text-destructive" : ""}`}
          >
            {totalWeight.toFixed(0)}/100 allocated
          </Badge>
        </div>
        {!adding && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setAdding(true);
              // Default new element to whatever capacity is left (cap 10).
              setDraftWeight(String(Math.min(10, Math.max(0, 100 - totalWeight))));
            }}
            disabled={totalWeight >= 100}
            title={totalWeight >= 100 ? "Design weight is fully allocated (100%)" : undefined}
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Add element
          </Button>
        )}

      </div>

      {elements.length > 0 && (
        <div className="h-1.5 w-full rounded bg-muted overflow-hidden mb-3">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {adding && (
        <div className="rounded-md border border-dashed border-border p-3 mb-3 space-y-2 bg-muted/20">
          <Input
            autoFocus
            placeholder="Element title (e.g. Drip irrigation zone 1)"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
          />
          <Textarea
            placeholder="What this element covers, acceptance criteria, notes…"
            rows={2}
            value={draftDesc}
            onChange={(e) => setDraftDesc(e.target.value)}
          />
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs font-mono text-muted-foreground">
              Weight (% of design value)
            </label>
            <Input
              type="number"
              min={0}
              max={remaining}
              step={1}
              className="w-24"
              value={draftWeight}
              onChange={(e) => setDraftWeight(e.target.value)}
            />
            <span
              className={`text-[10px] font-mono ${overCap ? "text-destructive" : "text-muted-foreground"}`}
            >
              {remaining.toFixed(0)}% remaining (others: {otherWeight.toFixed(0)}%)
            </span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" onClick={reset}>
                <X className="h-3.5 w-3.5 mr-1" /> Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => save.mutate()}
                disabled={save.isPending || !draftTitle.trim() || overCap}
                title={overCap ? `Exceeds remaining ${remaining.toFixed(0)}%` : undefined}
              >
                <Check className="h-3.5 w-3.5 mr-1" />
                {save.isPending ? "Saving…" : editId ? "Save" : "Add"}
              </Button>
            </div>
          </div>
          {overCap && (
            <p className="text-[10px] font-mono text-destructive">
              Total design weight cannot exceed 100%. Reduce this element or lower others first.
            </p>
          )}

        </div>
      )}

      {elements.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground italic">
          No design elements yet. Add features, deliverables, or success criteria —
          each with a weight — to track completeness.
        </p>
      )}

      <ul className="space-y-1.5">
        {elements.map((el) => {
          const doneByTask = el.task?.status === "done";
          const isDone = el.completed || doneByTask;
          return (
            <li
              key={el.id}
              className="flex items-start gap-2 rounded-md border border-border bg-card/40 px-3 py-2"
            >
              <Checkbox
                checked={isDone}
                onCheckedChange={(v) =>
                  toggle.mutate({ id: el.id, completed: !!v })
                }
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span
                    className={`text-sm font-medium ${isDone ? "line-through text-muted-foreground" : ""}`}
                  >
                    {el.title}
                  </span>
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    {Number(el.weight).toFixed(0)} pts
                  </Badge>
                  {el.task?.slug && (
                    <Link
                      to="/tasks/$slug"
                      params={{ slug: el.task.slug }}
                      className="text-[10px] font-mono text-muted-foreground hover:text-foreground"
                    >
                      → #task/{el.task.slug}
                      {doneByTask ? " (done)" : ""}
                    </Link>
                  )}
                </div>
                {el.description && (
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap mt-0.5">
                    {el.description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!el.task_id && (
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Move to backlog as a task"
                    onClick={() => promote.mutate(el.id)}
                    disabled={promote.isPending}
                  >
                    <ArrowRight className="h-3.5 w-3.5 mr-1" />
                    Backlog
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => startEdit(el)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => {
                    if (confirm(`Delete element "${el.title}"?`)) remove.mutate(el.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
