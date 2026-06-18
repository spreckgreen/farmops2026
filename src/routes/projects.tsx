import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { format } from "date-fns";
import { Pencil, Trash2, Plus } from "lucide-react";
import { listProjects, upsertProject, deleteProject } from "@/lib/log.functions";
import { slugify } from "@/lib/slug";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { CsvToolbar } from "@/components/csv-toolbar";
import { ProjectDesignElements } from "@/components/project-design-elements";

export const Route = createFileRoute("/projects")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({ meta: [{ title: "Projects — Bostead Farms" }] }),
  component: ProjectsPage,
});

type ProjectRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  start_date: string | null;
  updated_at: string;
};

type EditState = {
  id: string | null;
  slug: string;
  name: string;
  description: string;
  start_date: string;
};

const empty: EditState = { id: null, slug: "", name: "", description: "", start_date: "" };

function ProjectsPage() {
  const listFn = useServerFn(listProjects);
  const upsertFn = useServerFn(upsertProject);
  const deleteFn = useServerFn(deleteProject);
  const qc = useQueryClient();

  const q = useQuery({ queryKey: ["projects"], queryFn: () => listFn() });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<EditState>(empty);

  const save = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          id: draft.id,
          slug: slugify(draft.slug),
          name: draft.name.trim(),
          description: draft.description.trim() || null,
          start_date: draft.start_date || null,
        },
      }),
    onSuccess: () => {
      toast.success(draft.id ? "Project updated" : "Project added");
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project-tags"] });
      setOpen(false);
      setDraft(empty);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Project deleted");
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const startEdit = (p: ProjectRow) => {
    setDraft({
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description ?? "",
      start_date: p.start_date ?? "",
    });
    setOpen(true);
  };

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-end justify-between mb-6 gap-4">
          <div>
            <h1 className="text-2xl font-mono font-bold">Projects</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Lookup table for <code className="font-mono">#project/&lt;slug&gt;</code> tags in
              your notes. Add a description and start date for each one.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CsvToolbar
              filename="projects.csv"
              columns={[
                { key: "slug", label: "slug" },
                { key: "name", label: "name" },
                { key: "description", label: "description" },
                { key: "start_date", label: "start_date" },
              ]}
              rows={(q.data as ProjectRow[] | undefined ?? []).map((p) => ({
                slug: p.slug,
                name: p.name,
                description: p.description ?? "",
                start_date: p.start_date ?? "",
              }))}
              onImport={async (rows) => {
                let n = 0;
                for (const row of rows) {
                  const name = String(row.name ?? "").trim();
                  if (!name) continue;
                  await upsertFn({
                    data: {
                      id: null,
                      slug: slugify(String(row.slug ?? name)),
                      name,
                      description: String(row.description ?? "").trim() || null,
                      start_date: String(row.start_date ?? "").trim() || null,
                    },
                  });
                  n++;
                }
                qc.invalidateQueries({ queryKey: ["projects"] });
                toast.success(`Imported ${n} projects`);
              }}
            />
            <Button
              onClick={() => {
                setDraft(empty);
                setOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" /> New project
            </Button>
          </div>
        </div>

        {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {q.data && q.data.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No projects yet. Add one, then tag tasks with{" "}
            <code className="font-mono">#project/&lt;slug&gt;</code> in your daily notes.
          </p>
        )}

        <ul className="space-y-3">
          {(q.data as ProjectRow[] | undefined)?.map((p) => (
            <li
              key={p.id}
              className="border border-border rounded-lg p-4 bg-card"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <h2 className="font-medium">{p.name}</h2>
                    <code className="text-xs font-mono text-muted-foreground">
                      #project/{p.slug}
                    </code>
                  </div>
                  {p.start_date && (
                    <div className="text-xs font-mono text-muted-foreground mt-1">
                      Started {format(new Date(p.start_date), "MMM d, yyyy")}
                    </div>
                  )}
                  {p.description && (
                    <p className="text-sm mt-2 whitespace-pre-wrap">{p.description}</p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => startEdit(p)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (confirm(`Delete project "${p.name}"? This only removes metadata; tags on tasks are kept.`)) {
                        remove.mutate(p.id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <ProjectDesignElements projectId={p.id} />
            </li>
          ))}
        </ul>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft.id ? "Edit project" : "New project"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Marketing website"
              />
            </div>
            <div>
              <Label htmlFor="slug">Tag slug</Label>
              <Input
                id="slug"
                value={draft.slug}
                onChange={(e) => setDraft((d) => ({ ...d, slug: slugify(e.target.value) }))}
                placeholder="marketing-site"
                disabled={!!draft.id}
              />
              <p className="text-xs text-muted-foreground font-mono mt-1">
                Used as #project/{draft.slug || "<slug>"}
              </p>
            </div>
            <div>
              <Label htmlFor="start">Start date</Label>
              <Input
                id="start"
                type="date"
                value={draft.start_date}
                onChange={(e) => setDraft((d) => ({ ...d, start_date: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="desc">Description</Label>
              <Textarea
                id="desc"
                rows={4}
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="What this project is, who it's for, success criteria…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending || !draft.name.trim() || !draft.slug.trim()}
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
