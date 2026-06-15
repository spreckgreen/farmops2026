import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDailyNote, listProjects, saveDailyNote } from "@/lib/log.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { toast } from "sonner";
import { format, addDays, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";


export const Route = createFileRoute("/notes/$date")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({ meta: [{ title: "Daily note — Bostead Farms" }] }),
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
  const { date } = useParams({ from: "/notes/$date" });
  const navigate = useNavigate();
  const fetchNote = useServerFn(getDailyNote);
  const saveFn = useServerFn(saveDailyNote);
  const qc = useQueryClient();

  const today = format(new Date(), "yyyy-MM-dd");
  const shift = (days: number) => {
    const next = format(addDays(parseISO(date), days), "yyyy-MM-dd");
    navigate({ to: "/notes/$date", params: { date: next } });
  };

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

  // Keep a ref to the latest draft so the unmount-time flush sees current text.
  const draftRef = useRef<string>("");
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Defer saving (and any task creation) until the user leaves the Today tab.
  // Flush on unmount and also on browser tab close/refresh.
  useEffect(() => {
    if (!query.data) return;
    const noteId = query.data.note.id;

    const flush = () => {
      const current = draftRef.current;
      if (current === lastSavedRef.current) return;
      lastSavedRef.current = current;
      // Fire-and-forget; the route may already be unmounting.
      saveFn({ data: { noteId, date, markdown: current } }).catch(() => {});
    };

    const onBeforeUnload = () => flush();
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data?.note.id, date]);


  const tasks = query.data?.tasks ?? [];
  const openTasks = tasks.filter((t) => t.status !== "done");

  // ---- #project/ autocomplete ----
  const listProjectsFn = useServerFn(listProjects);
  const projectsQ = useQuery({ queryKey: ["projects"], queryFn: () => listProjectsFn() });
  const projects = (projectsQ.data ?? []) as { slug: string; name: string }[];

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [caret, setCaret] = useState(0);
  const [acIndex, setAcIndex] = useState(0);

  const acToken = useMemo(() => {
    if (!textareaRef.current) return null;
    const before = draft.slice(0, caret);
    const m = /#project\/([a-z0-9-_]*)$/i.exec(before);
    if (!m) return null;
    return { start: caret - m[1].length, query: m[1].toLowerCase() };
  }, [draft, caret]);

  const acMatches = useMemo(() => {
    if (!acToken) return [];
    const q = acToken.query;
    return projects
      .filter((p) => !q || p.slug.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [acToken, projects]);

  useEffect(() => {
    setAcIndex(0);
  }, [acToken?.query]);

  const applyCompletion = (slug: string) => {
    if (!acToken) return;
    const next = draft.slice(0, acToken.start) + slug + draft.slice(caret);
    const newCaret = acToken.start + slug.length;
    setDraft(next);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(newCaret, newCaret);
        setCaret(newCaret);
      }
    });
  };

  const onTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!acMatches.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAcIndex((i) => (i + 1) % acMatches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAcIndex((i) => (i - 1 + acMatches.length) % acMatches.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      applyCompletion(acMatches[acIndex].slug);
    } else if (e.key === "Escape") {
      e.preventDefault();
      // Move caret one back so the regex stops matching, dismissing the popup.
      setCaret(-1);
    }
  };

  const syncCaret = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    setCaret(e.currentTarget.selectionStart ?? 0);
  };

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
      <section className="min-w-0">
        <div className="flex items-baseline justify-between mb-4 gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => shift(-1)} aria-label="Previous day">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => shift(1)}
              aria-label="Next day"
              disabled={date >= today}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => {
                if (e.target.value) navigate({ to: "/notes/$date", params: { date: e.target.value } });
              }}
              className="bg-card border border-border rounded-md px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {date !== today && (
              <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/notes/$date", params: { date: today } })}>
                Today
              </Button>
            )}
            <div className="ml-2">
              <h1 className="text-2xl font-mono font-bold leading-tight">
                {format(parseISO(date), "EEEE, MMMM d")}
              </h1>
              <p className="text-xs text-muted-foreground font-mono">{date}</p>
            </div>
          </div>
          <span className="text-xs text-muted-foreground">
            {draft === lastSavedRef.current ? "saved" : "pending · saves on leave"}
          </span>
        </div>

        <div className="relative">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setCaret(e.target.selectionStart ?? 0);
            }}
            onKeyDown={onTextareaKeyDown}
            onKeyUp={syncCaret}
            onClick={syncCaret}
            onSelect={syncCaret}
            placeholder={PLACEHOLDER}
            spellCheck={false}
            className="w-full min-h-[70vh] bg-card border border-border rounded-lg p-4 font-mono text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring resize-y"
          />
          {acMatches.length > 0 && (
            <div className="absolute left-3 bottom-3 z-10 w-72 bg-popover border border-border rounded-md shadow-md overflow-hidden">
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider font-mono text-muted-foreground border-b border-border">
                #project/ — ↑↓ Enter
              </div>
              <ul>
                {acMatches.map((p, i) => (
                  <li key={p.slug}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyCompletion(p.slug);
                      }}
                      onMouseEnter={() => setAcIndex(i)}
                      className={`w-full text-left px-3 py-1.5 text-sm flex items-baseline justify-between gap-2 ${
                        i === acIndex ? "bg-accent text-accent-foreground" : ""
                      }`}
                    >
                      <span className="font-mono truncate">{p.slug}</span>
                      <span className="text-xs text-muted-foreground truncate">{p.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>


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
    </AppLayout>
  );
}
