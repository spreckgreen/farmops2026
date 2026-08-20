import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listTaskProjectLinks,
  setProjectDesignElementWeight,
  unlinkTaskFromProject,
} from "@/lib/log.functions";
import { DEFAULT_DESIGN_ELEMENT_WEIGHT, clampWeight } from "@/lib/design-weight";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

type Link_ = {
  id: string;
  project_id: string;
  title: string;
  weight: number;
  completed: boolean;
  project_total_weight: number;
  project?: { id: string; slug: string; name: string } | null;
};

/**
 * Shows every project this task contributes to as a design element, with an
 * inline editor for its weight (share of the project's 100 points).
 * Auto-attached tasks start at {DEFAULT_DESIGN_ELEMENT_WEIGHT}%.
 */
export function TaskProjectWeights({ taskId }: { taskId: string }) {
  const listFn = useServerFn(listTaskProjectLinks);
  const saveFn = useServerFn(setProjectDesignElementWeight);
  const unlinkFn = useServerFn(unlinkTaskFromProject);
  const qc = useQueryClient();

  const { data: links = [], isLoading } = useQuery({
    queryKey: ["task-project-links", taskId],
    queryFn: () => listFn({ data: { task_id: taskId } }) as Promise<Link_[]>,
  });

  const save = useMutation({
    mutationFn: (v: { id: string; weight: number }) => saveFn({ data: v }),
    onSuccess: (_r, v) => {
      toast.success(`Weight set to ${v.weight}%`);
      qc.invalidateQueries({ queryKey: ["task-project-links", taskId] });
      qc.invalidateQueries({ queryKey: ["project-design-elements"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unlink = useMutation({
    mutationFn: (v: { element_id: string; remove_tag: boolean }) => unlinkFn({ data: v }),
    onSuccess: (r: { project_slug: string | null; tag_removed: boolean }) => {
      toast.success(
        r.tag_removed
          ? `Unassigned and removed #project/${r.project_slug} from the task`
          : r.project_slug
            ? `Unassigned — #project/${r.project_slug} tag kept on the task`
            : "Unassigned from project",
      );
      qc.invalidateQueries({ queryKey: ["task-project-links", taskId] });
      qc.invalidateQueries({ queryKey: ["project-design-elements"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["task"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || links.length === 0) return null;

  return (
    <div className="mb-6 rounded-lg border border-border bg-card/40 px-4 py-3">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">Project contribution</h2>
        <span className="text-xs text-muted-foreground">
          default {DEFAULT_DESIGN_ELEMENT_WEIGHT}% when auto-assigned via #project/&lt;slug&gt;
        </span>
      </div>
      <ul className="space-y-2">
        {links.map((l) => (
          <WeightRow
            key={l.id}
            link={l}
            pending={save.isPending}
            onSave={(weight) => save.mutate({ id: l.id, weight })}
            unlinkPending={unlink.isPending}
            onUnlink={(remove_tag) => unlink.mutate({ element_id: l.id, remove_tag })}
          />
        ))}
      </ul>
    </div>
  );
}

function WeightRow({
  link,
  pending,
  onSave,
  onUnlink,
  unlinkPending,
}: {
  link: Link_;
  pending: boolean;
  onSave: (weight: number) => void;
  onUnlink: (removeTag: boolean) => void;
  unlinkPending: boolean;
}) {
  const [draft, setDraft] = useState(String(Number(link.weight)));
  useEffect(() => setDraft(String(Number(link.weight))), [link.weight]);

  const parsed = clampWeight(Number(draft));
  const others = Math.max(0, Number(link.project_total_weight) - Number(link.weight));
  const headroom = Math.max(0, 100 - others);
  const dirty = parsed !== Number(link.weight);
  const tooBig = parsed > headroom;

  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      {link.project ? (
        <Link to="/projects" className="font-medium hover:underline">
          {link.project.name}
        </Link>
      ) : (
        <span className="font-medium">Project</span>
      )}
      {link.completed && <Badge variant="secondary">complete</Badge>}
      <Input
        type="number"
        min={0}
        max={100}
        step={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="h-8 w-20"
        aria-label={`Weight for ${link.project?.name ?? "project"}`}
      />
      <span className="text-xs text-muted-foreground">
        % of project · {headroom.toFixed(0)}% available
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-8"
        disabled={!dirty || tooBig || pending}
        onClick={() => onSave(parsed)}
      >
        Save
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-8" disabled={unlinkPending}>
            Unassign
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>
            Remove from {link.project?.name ?? "project"}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onUnlink(false)}>
            Unassign, keep #project/{link.project?.slug ?? "slug"} tag
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => onUnlink(true)}
          >
            Unassign and remove the tag
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {tooBig && (
        <span className="text-xs text-destructive">
          Max {headroom.toFixed(0)}% — other elements use {others.toFixed(0)}%.
        </span>
      )}
    </li>
  );
}
