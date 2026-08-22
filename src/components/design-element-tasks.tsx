import { appDateString } from "@/lib/app-timezone";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Plus, CalendarPlus, Check } from "lucide-react";
import { toast } from "sonner";
import {
  listDesignElementTasks,
  createDesignElementTask,
  addTaskToToday,
  setTaskStatus,
} from "@/lib/log.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type ExecTask = {
  id: string;
  slug: string;
  title: string;
  status: string;
  start_at: string | null;
  percent_complete: number;
  project_tags: string[];
};

function todayLocalYMD() {
  return appDateString();
}

export function DesignElementTasksCount({
  designElementId,
}: {
  designElementId: string;
}) {
  const listFn = useServerFn(listDesignElementTasks);
  const q = useQuery({
    queryKey: ["design-element-tasks", designElementId],
    queryFn: () =>
      listFn({ data: { design_element_id: designElementId } }) as Promise<
        ExecTask[]
      >,
  });
  const tasks = q.data ?? [];
  const open = tasks.filter((t) => t.status !== "done").length;
  const total = tasks.length;
  return (
    <Badge variant="outline" className="font-mono text-[10px]">
      {open}/{total} tasks
    </Badge>
  );
}

export function DesignElementTasks({
  designElementId,
}: {
  designElementId: string;
}) {
  const listFn = useServerFn(listDesignElementTasks);
  const createFn = useServerFn(createDesignElementTask);
  const todayFn = useServerFn(addTaskToToday);
  const statusFn = useServerFn(setTaskStatus);
  const qc = useQueryClient();
  const key = ["design-element-tasks", designElementId];

  const q = useQuery({
    queryKey: key,
    queryFn: () =>
      listFn({ data: { design_element_id: designElementId } }) as Promise<
        ExecTask[]
      >,
  });

  const [draft, setDraft] = useState("");

  const create = useMutation({
    mutationFn: (title: string) =>
      createFn({ data: { design_element_id: designElementId, title } }),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["backlog"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const moveToday = useMutation({
    mutationFn: (taskId: string) =>
      todayFn({ data: { taskId, date: todayLocalYMD() } }),
    onSuccess: () => {
      toast.success("Added to today");
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["daily-note"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const complete = useMutation({
    mutationFn: (taskId: string) =>
      statusFn({ data: { id: taskId, status: "done" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const tasks = q.data ?? [];

  return (
    <div className="mt-2 ml-6 border-l border-border pl-3 space-y-1.5">
      {tasks.length === 0 && (
        <p className="text-[11px] text-muted-foreground italic">
          No execution tasks yet — add steps required to complete this element.
        </p>
      )}
      {tasks.map((t) => {
        const isDone = t.status === "done";
        const isToday = !!t.start_at;
        return (
          <div
            key={t.id}
            className="flex items-center gap-2 rounded border border-border/70 bg-background/60 px-2 py-1.5"
          >
            <div className="min-w-0 flex-1">
              <Link
                to="/tasks/$slug"
                params={{ slug: t.slug }}
                className={`text-xs ${isDone ? "line-through text-muted-foreground" : "hover:underline"}`}
              >
                {t.title}
              </Link>
              <div className="flex gap-1 mt-0.5">
                <Badge variant="secondary" className="font-mono text-[9px]">
                  {isDone ? "done" : t.status}
                </Badge>
                {isToday && (
                  <Badge variant="outline" className="font-mono text-[9px]">
                    scheduled
                  </Badge>
                )}
              </div>
            </div>
            {!isDone && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  title="Add to today"
                  onClick={() => moveToday.mutate(t.id)}
                  disabled={moveToday.isPending}
                >
                  <CalendarPlus className="h-3.5 w-3.5 mr-1" />
                  Today
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  title="Mark done"
                  onClick={() => complete.mutate(t.id)}
                  disabled={complete.isPending}
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        );
      })}

      <form
        className="flex gap-1.5 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          const v = draft.trim();
          if (!v) return;
          create.mutate(v);
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add execution task…"
          className="h-7 text-xs"
        />
        <Button
          type="submit"
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          disabled={create.isPending || !draft.trim()}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      </form>
    </div>
  );
}
