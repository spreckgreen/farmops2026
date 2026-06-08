import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDailyNote, saveDailyNote } from "@/lib/log.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { format } from "date-fns";

export const Route = createFileRoute("/notes/$date")({
  head: () => ({ meta: [{ title: "Daily note — log.md" }] }),
  component: NotePage,
});

const PLACEHOLDER = `# Daily note

- [ ] Start something
- [x] Finished a thing

#task/start-something Made progress on the parser
!blocker [[Start Something]] Stuck waiting on review
[[Start Something]] Decided to use Zod for input validation

Untagged thoughts stay here in the note and don't enter the activity log.
`;

function NotePage() {
  const { date } = useParams({ from: "/_authenticated/notes/$date" });
  const fetchNote = useServerFn(getDailyNote);
  const saveFn = useServerFn(saveDailyNote);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["daily-note", date],
    queryFn: () => fetchNote({ data: { date } }),
  });

  const [draft, setDraft] = useState<string>("");
  const lastSavedRef = useRef<string>("");

  useEffect(() => {
    if (query.data) {
      const md = query.data.note.markdown_content || "";
      setDraft(md);
      lastSavedRef.current = md;
    }
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: async (markdown: string) => {
      if (!query.data) return null;
      return saveFn({ data: { noteId: query.data.note.id, date, markdown } });
    },
    onSuccess: (res) => {
      if (res?.newEntries) {
        toast.success(`Saved · ${res.newEntries} new entr${res.newEntries === 1 ? "y" : "ies"} logged`);
        qc.invalidateQueries({ queryKey: ["tasks"] });
        qc.invalidateQueries({ queryKey: ["task"] });
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  // Autosave debounce
  useEffect(() => {
    if (!query.data) return;
    if (draft === lastSavedRef.current) return;
    const id = setTimeout(() => {
      lastSavedRef.current = draft;
      mutation.mutate(draft);
    }, 1200);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, query.data]);

  const tasks = query.data?.tasks ?? [];
  const openTasks = tasks.filter((t) => t.status !== "done");

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
      <section className="min-w-0">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h1 className="text-2xl font-mono font-bold">
              {format(new Date(date + "T00:00:00"), "EEEE, MMMM d")}
            </h1>
            <p className="text-xs text-muted-foreground font-mono">{date}</p>
          </div>
          <span className="text-xs text-muted-foreground">
            {mutation.isPending ? "saving…" : draft === lastSavedRef.current ? "saved" : "unsaved"}
          </span>
        </div>

        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          className="w-full min-h-[70vh] bg-card border border-border rounded-lg p-4 font-mono text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring resize-y"
        />

        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">Syntax cheatsheet</summary>
          <pre className="mt-2 bg-muted/40 p-3 rounded font-mono whitespace-pre-wrap">{`- [ ] New task title           → creates task
- [x] Title                    → marks task done
#task/<slug> entry text        → log entry on task
[[Task Name]] entry text       → log entry on task (by title)
!blocker / !decision / !commit / !meeting → entry_type prefix
Untagged lines stay in this note only.`}</pre>
        </details>
      </section>

      <aside className="lg:border-l lg:border-border lg:pl-6">
        <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">
          Open tasks · {openTasks.length}
        </h2>
        <ul className="space-y-1">
          {openTasks.length === 0 && (
            <li className="text-sm text-muted-foreground">None yet. Add a `- [ ]` line.</li>
          )}
          {openTasks.map((t) => (
            <li key={t.id}>
              <Link
                to="/tasks/$slug"
                params={{ slug: t.slug }}
                className="flex items-center justify-between gap-2 text-sm py-1.5 px-2 rounded hover:bg-accent group"
              >
                <span className="truncate">{t.title}</span>
                {t.status === "blocked" && (
                  <Badge variant="destructive" className="text-[10px]">blocked</Badge>
                )}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-6">
          <Button variant="outline" size="sm" asChild className="w-full">
            <Link to="/tasks">All tasks →</Link>
          </Button>
        </div>
      </aside>
    </div>
  );
}
