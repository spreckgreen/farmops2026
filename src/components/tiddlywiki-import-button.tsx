import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { parseTiddlyWikiHtml, type TiddlyWikiImport } from "@/lib/tiddlywiki-import";
import { importSummariesFromTiddlers, importTasksFromTiddlers } from "@/lib/log.functions";

type Kind = "tasks" | "summaries";

export function TiddlyWikiImportButton({ kind }: { kind: Kind }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState<TiddlyWikiImport | null>(null);
  const [filename, setFilename] = useState<string>("");
  const qc = useQueryClient();
  const importTasksFn = useServerFn(importTasksFromTiddlers);
  const importSummariesFn = useServerFn(importSummariesFromTiddlers);

  const tasksMut = useMutation({
    mutationFn: (tasks: TiddlyWikiImport["tasks"]) =>
      importTasksFn({ data: { tasks } }),
    onSuccess: (res) => {
      toast.success(`Imported tasks · ${res.inserted} new, ${res.updated} updated`);
      qc.invalidateQueries({ queryKey: ["scheduled-tasks"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["project-tags"] });
      setOpen(false);
      setParsed(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Import failed"),
  });

  const summariesMut = useMutation({
    mutationFn: (summaries: TiddlyWikiImport["summaries"]) =>
      importSummariesFn({ data: { summaries } }),
    onSuccess: (res) => {
      toast.success(`Imported summaries · ${res.inserted} new, ${res.updated} updated`);
      qc.invalidateQueries({ queryKey: ["summaries"] });
      setOpen(false);
      setParsed(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Import failed"),
  });

  const onPick = async (file: File) => {
    setFilename(file.name);
    try {
      const text = await file.text();
      const result = parseTiddlyWikiHtml(text);
      setParsed(result);
      setOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not parse file");
    }
  };

  const isPending = tasksMut.isPending || summariesMut.isPending;
  const count =
    kind === "tasks" ? (parsed?.tasks.length ?? 0) : (parsed?.summaries.length ?? 0);

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".html,.htm,text/html"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
      <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
        <Upload className="h-4 w-4 mr-1.5" />
        Import TiddlyWiki
      </Button>

      <Dialog open={open} onOpenChange={(v) => !isPending && setOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import from TiddlyWiki</DialogTitle>
            <DialogDescription>
              {filename ? `File: ${filename}` : "Choose a TW5 .html file."}
            </DialogDescription>
          </DialogHeader>

          {parsed && (
            <div className="space-y-2 text-sm">
              <p>
                Parsed <strong>{parsed.tiddlers.length}</strong> tiddler
                {parsed.tiddlers.length === 1 ? "" : "s"}.
              </p>
              <p>
                {kind === "tasks" ? (
                  <>
                    <strong>{parsed.tasks.length}</strong> task
                    {parsed.tasks.length === 1 ? "" : "s"} ready to import.
                    Tasks are matched by <code>slug</code>; existing tasks are
                    updated, new ones are created.
                  </>
                ) : (
                  <>
                    <strong>{parsed.summaries.length}</strong> summar
                    {parsed.summaries.length === 1 ? "y" : "ies"} ready to
                    import. Matched by id, then by (mode, period). New rows are
                    created with status "draft".
                  </>
                )}
              </p>
              {count === 0 && (
                <p className="text-muted-foreground">
                  Nothing to import — the file has no Bostead{" "}
                  {kind === "tasks" ? "task" : "summary"} tiddlers.
                </p>
              )}
              {parsed.tasks.length > 0 && kind === "tasks" && (
                <ul className="max-h-40 overflow-auto text-xs bg-muted/40 rounded p-2 font-mono space-y-0.5">
                  {parsed.tasks.slice(0, 30).map((t) => (
                    <li key={t.slug}>
                      {t.slug} — {t.title}{" "}
                      <span className="text-muted-foreground">({t.status})</span>
                    </li>
                  ))}
                  {parsed.tasks.length > 30 && (
                    <li className="text-muted-foreground">
                      …{parsed.tasks.length - 30} more
                    </li>
                  )}
                </ul>
              )}
              {parsed.summaries.length > 0 && kind === "summaries" && (
                <ul className="max-h-40 overflow-auto text-xs bg-muted/40 rounded p-2 font-mono space-y-0.5">
                  {parsed.summaries.slice(0, 30).map((s, i) => (
                    <li key={i}>
                      {(s.created_at ?? "?").slice(0, 10)} · {s.mode}
                      {s.scope_project ? ` · #${s.scope_project}` : ""}
                    </li>
                  ))}
                  {parsed.summaries.length > 30 && (
                    <li className="text-muted-foreground">
                      …{parsed.summaries.length - 30} more
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              disabled={isPending || !parsed || count === 0}
              onClick={() => {
                if (!parsed) return;
                if (kind === "tasks") tasksMut.mutate(parsed.tasks);
                else summariesMut.mutate(parsed.summaries);
              }}
            >
              {isPending ? "Importing…" : `Import ${count}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
