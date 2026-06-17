import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { commitDailyNote, getDailyNote, listProjects, refreshDailyNoteFromLog, saveDailyNote } from "@/lib/log.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { toast } from "sonner";
import { format, addDays, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight, Eye, EyeOff } from "lucide-react";
import { DailyNotePreview } from "@/components/daily-note-preview";


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
  const commitFn = useServerFn(commitDailyNote);
  const refreshFn = useServerFn(refreshDailyNoteFromLog);
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

  // Only seed the editor from the server when the note id changes (initial
  // load or date switch). Background refetches after autosave must NOT
  // clobber in-progress edits — e.g. a trailing "\n" the user just typed to
  // start a new entry would be wiped by the refetched (trimmed) markdown.
  const loadedNoteIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!query.data) return;
    const noteId = query.data.note.id;
    const md = query.data.note.markdown_content || "";
    if (loadedNoteIdRef.current !== noteId) {
      loadedNoteIdRef.current = noteId;
      setDraft(md);
      lastSavedRef.current = md;
      return;
    }
    // Same note, background refetch: only adopt server content if the user
    // has no unsaved local edits (draft matches what we last saved).
    if (draftRef.current === lastSavedRef.current && md !== lastSavedRef.current) {
      setDraft(md);
      lastSavedRef.current = md;
    }
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: async (markdown: string) => {
      if (!query.data) return null;
      return saveFn({ data: { noteId: query.data.note.id, date, markdown } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const commitMutation = useMutation({
    mutationFn: async (markdown: string) => {
      if (!query.data) return null;
      return commitFn({ data: { noteId: query.data.note.id, date, markdown } });
    },
    onSuccess: (res) => {
      if (res) {
        toast.success(
          res.newEntries
            ? `Committed · ${res.newEntries} entr${res.newEntries === 1 ? "y" : "ies"} logged`
            : "Committed",
        );
        qc.invalidateQueries({ queryKey: ["tasks"] });
        qc.invalidateQueries({ queryKey: ["task"] });
        qc.invalidateQueries({ queryKey: ["daily-note", date] });
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Commit failed"),
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      if (!query.data) return null;
      return refreshFn({
        data: {
          noteId: query.data.note.id,
          currentMarkdown: draftRef.current,
        },
      });
    },
    onSuccess: (res) => {
      if (!res) return;
      setDraft(res.markdown);
      lastSavedRef.current = res.markdown;
      const parts: string[] = [];
      if (res.restored)
        parts.push(`${res.restored} from log`);
      if (res.preserved)
        parts.push(`${res.preserved} kept from editor`);
      if (res.deduped)
        parts.push(`${res.deduped} duplicate${res.deduped === 1 ? "" : "s"} removed`);
      toast.success(parts.length ? `Refreshed · ${parts.join(" · ")}` : "Log is empty for today");
      qc.invalidateQueries({ queryKey: ["daily-note", date] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Refresh failed"),
  });

  // Keep a ref to the latest draft so flush callbacks see current text.
  const draftRef = useRef<string>("");
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Debounced auto-save: persist changes ~800ms after the user stops typing.
  // This avoids the race where navigating away fires an in-flight save and
  // the next mount refetches stale content before the save lands.
  useEffect(() => {
    if (!query.data) return;
    if (draft === lastSavedRef.current) return;
    const noteId = query.data.note.id;
    const snapshot = draft;
    const t = setTimeout(() => {
      mutation.mutate(snapshot, {
        onSuccess: () => {
          lastSavedRef.current = snapshot;
          qc.invalidateQueries({ queryKey: ["daily-note", date] });
        },
      });
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, query.data?.note.id, date]);

  // Commit on unmount / tab close: persist the latest markdown AND parse it
  // into tasks + activity_log. This is the only path that mutates Tasks and
  // the activity log, so mid-typing autosaves stay quiet.
  useEffect(() => {
    if (!query.data) return;
    const noteId = query.data.note.id;
    const flushCommit = () => {
      const current = draftRef.current;
      lastSavedRef.current = current;
      commitFn({ data: { noteId, date, markdown: current } })
        .then(() => {
          qc.invalidateQueries({ queryKey: ["daily-note", date] });
          qc.invalidateQueries({ queryKey: ["tasks"] });
          qc.invalidateQueries({ queryKey: ["task"] });
        })
        .catch(() => {});
    };
    const onBeforeUnload = () => flushCommit();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      flushCommit();
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
  const [showPreview, setShowPreview] = useState(true);

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
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {draft === lastSavedRef.current ? "saved" : "saving…"}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowPreview((v) => !v)}
              title={showPreview ? "Hide rendered preview" : "Show rendered preview"}
            >
              {showPreview ? (
                <><EyeOff className="h-3.5 w-3.5 mr-1.5" />Hide preview</>
              ) : (
                <><Eye className="h-3.5 w-3.5 mr-1.5" />Show preview</>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending || !query.data}
              title="Rebuild this note's markdown from today's activity log"
            >
              {refreshMutation.isPending ? "Refreshing…" : "Refresh from log"}
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={() => commitMutation.mutate(draftRef.current)}
              disabled={commitMutation.isPending || !query.data}
              title="Persist tasks and activity log entries from today's note"
            >
              {commitMutation.isPending ? "Committing…" : "Commit to log"}
            </Button>
          </div>
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

        {showPreview && (
          <section
            aria-label="Rendered preview"
            className="mt-4 bg-card border border-border rounded-lg p-4"
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                Preview
              </h2>
              <span className="text-[10px] font-mono text-muted-foreground">
                live · click task titles to open
              </span>
            </div>
            <DailyNotePreview markdown={draft} tasks={tasks} />
          </section>
        )}




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

      <aside className="lg:border-l lg:border-border lg:pl-6 space-y-6">
        <div>
          <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">
            Today's log · {(query.data?.entries ?? []).length}
          </h2>
          <ul className="space-y-2">
            {(query.data?.entries ?? []).length === 0 && (
              <li className="text-xs text-muted-foreground">
                Nothing committed yet. Press "Commit to log" to persist today's entries.
              </li>
            )}
            {(query.data?.entries ?? []).map((e: {
              id: string;
              entry_type: string;
              raw_content: string;
              created_at: string;
              tasks: { slug: string; title: string } | null;
            }) => (
              <li key={e.id} className="border border-border rounded p-2 bg-card">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <Badge variant="outline" className="text-[10px] font-mono uppercase">
                    {e.entry_type}
                  </Badge>
                  {e.tasks && (
                    <Link
                      to="/tasks/$slug"
                      params={{ slug: e.tasks.slug }}
                      className="text-[10px] font-mono text-muted-foreground hover:text-foreground truncate"
                    >
                      #{e.tasks.slug}
                    </Link>
                  )}
                </div>
                <p className="text-xs font-mono whitespace-pre-wrap break-words">{e.raw_content}</p>
              </li>
            ))}
          </ul>
        </div>

        <div>
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
          <div className="mt-4">
            <Button variant="outline" size="sm" asChild className="w-full">
              <Link to="/tasks">All tasks →</Link>
            </Button>
          </div>
        </div>
      </aside>
      </div>
    </AppLayout>
  );
}
