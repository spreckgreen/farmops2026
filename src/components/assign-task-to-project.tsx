import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FolderPlus } from "lucide-react";
import { toast } from "sonner";
import { listProjects, assignTaskToProjectAsDesignElement } from "@/lib/log.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Project = { id: string; slug: string; name: string };

export function AssignTaskToProject({
  taskId,
  taskTitle,
}: {
  taskId: string;
  taskTitle: string;
}) {
  const listFn = useServerFn(listProjects);
  const assignFn = useServerFn(assignTaskToProjectAsDesignElement);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState<string>("");
  const [weight, setWeight] = useState<string>("10");

  const projectsQ = useQuery({
    queryKey: ["projects"],
    queryFn: () => listFn() as Promise<Project[]>,
    enabled: open,
  });

  const assign = useMutation({
    mutationFn: () =>
      assignFn({
        data: {
          task_id: taskId,
          project_id: projectId,
          weight: Number(weight) || 0,
        },
      }),
    onSuccess: (res) => {
      if (res.already) toast.info("Already assigned to that project");
      else toast.success(`Added "${taskTitle}" as a design element`);
      qc.invalidateQueries({ queryKey: ["project-design-elements"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      setOpen(false);
      setProjectId("");
      setWeight("10");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" title="Assign to a project as a design element">
          <FolderPlus className="h-3.5 w-3.5 mr-1" />
          Assign
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3" align="end">
        <div>
          <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Project
          </label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="mt-1">
              <SelectValue
                placeholder={projectsQ.isLoading ? "Loading…" : "Pick a project"}
              />
            </SelectTrigger>
            <SelectContent>
              {(projectsQ.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}{" "}
                  <span className="text-muted-foreground font-mono text-xs">
                    #{p.slug}
                  </span>
                </SelectItem>
              ))}
              {projectsQ.data && projectsQ.data.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  No projects yet — create one first.
                </div>
              )}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Weight (% of design value)
          </label>
          <Input
            type="number"
            min={0}
            max={100}
            step={1}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="mt-1"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!projectId || assign.isPending}
            onClick={() => assign.mutate()}
          >
            {assign.isPending ? "Assigning…" : "Assign"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
