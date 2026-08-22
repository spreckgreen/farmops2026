import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { commitDailyNote, getDailyNote, listProjects, refreshDailyNoteFromLog, removeTaskFromToday, saveDailyNote } from "@/lib/log.functions";
import { TaskMoveDay } from "@/components/task-move-day";
import { getDailyForecast } from "@/lib/weather.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AppLayout } from "@/components/app-layout";
import { SlugChip } from "@/components/slug-chip";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { toast } from "sonner";
import { format, addDays, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight, Eye, EyeOff, Cloud, RefreshCw, Undo2 } from "lucide-react";
import { appDateString } from "@/lib/app-timezone";
import { DayWindowIndicator } from "@/components/day-window-indicator";
import { DailyNotePreview } from "@/components/daily-note-preview";
import { DailyRatingPanel } from "@/components/daily-rating";
import { NoteInterpretation } from "@/components/note-interpretation";

import {
  applyNoteFix,
  interpretNote,
  lineEndOffset,
  summarizeInterpretation,
  type NoteFix,
} from "@/lib/note-syntax";
import { useShowTaskSlugs } from "@/hooks/use-show-task-slugs";
import {
  classifyEditorLines,
  NoteEditorHighlightOverlay,
  NoteSyntaxLegend,
} from "@/components/note-editor-validation";



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
  const [showSlugs, toggleSlugs] = useShowTaskSlugs();

  const today = appDateString();
  const shift = (days: number) => {
    const next = format(addDays(parseISO(date), days), "yyyy-MM-dd");
    navigate({ to: "/notes/$date", params: { date: next } });
  };

  const query = useQuery({
    queryKey: ["daily-note", date],
    queryFn: () => fetchNote({ data: { date } }),
  });

  const fetchForecast = useServerFn(getDailyForecast);
  const weatherQuery = useQuery({
    queryKey: ["weather", date],
    queryFn: () => fetchForecast({ data: { date } }),
    staleTime: 5 * 60 * 1000,
  });
  const refreshWeather = useMutation({
    mutationFn: () => fetchForecast({ data: { date, refresh: true } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["weather", date] }),
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
    onSuccess: (res, markdown) => {
      if (res) {
        const { counts } = interpretNote(markdown, { tasks: query.data?.tasks ?? [] });
        toast.success(
          res.newEntries
            ? `Committed · ${res.newEntries} entr${res.newEntries === 1 ? "y" : "ies"} logged`
            : "Committed · nothing new to log",
          { description: summarizeInterpretation(counts) },
        );
        if (res.linkedElements) {
          toast.success(
            `${res.linkedElements} task${res.linkedElements === 1 ? "" : "s"} attached to a project`,
            {
              description:
                "A #project/<slug> tag matched a real project, so each task was added as a design element (10% weight, editable on /projects).",
            },
          );
        }
        if (counts.warnings) {
          toast.warning(
            `${counts.warnings} line${counts.warnings === 1 ? "" : "s"} did not produce a task or log entry`,
            { description: 'See "What \u201cCommit to log\u201d will do" below the note for the reason on each line.' },
          );
        }
        qc.invalidateQueries({ queryKey: ["tasks"] });
        qc.invalidateQueries({ queryKey: ["task"] });
        qc.invalidateQueries({ queryKey: ["daily-note", date] });
        qc.invalidateQueries({ queryKey: ["project-design-elements"] });
        qc.invalidateQueries({ queryKey: ["projects"] });

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
    const flushCommit = async () => {
      const current = draftRef.current;
      lastSavedRef.current = current;
      // Skip if the user has signed out — the server fn would 401 without a bearer.
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
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

  // Move a task off this day's note and back to the backlog.
  const removeFromDayFn = useServerFn(removeTaskFromToday);
  const toBacklog = useMutation({
    mutationFn: (taskId: string) => removeFromDayFn({ data: { taskId, date } }),
    onSuccess: () => {
      toast.success("Moved back to backlog");
      qc.invalidateQueries({ queryKey: ["daily-note"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Failed to move task"),
  });



  // ---- #project/ autocomplete ----
  const listProjectsFn = useServerFn(listProjects);
  const projectsQ = useQuery({ queryKey: ["projects"], queryFn: () => listProjectsFn() });
  const projects = (projectsQ.data ?? []) as { slug: string; name: string }[];

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [caret, setCaret] = useState(0);
  const [acIndex, setAcIndex] = useState(0);
  const [showSource, setShowSource] = useState(false);
  const [compactPreview, setCompactPreview] = useState(true);
  const [editorScrollTop, setEditorScrollTop] = useState(0);

  // Inline validation: per-line kind stripes painted behind the raw editor.
  const editorLines = useMemo(
    () => classifyEditorLines(draft, { tasks, projects }),
    [draft, tasks, projects],
  );
  const malformedCount = editorLines.kinds.filter((k) => k === "malformed").length;
  const taskLineCount = editorLines.kinds.filter((k) => k === "task" || k === "done").length;



  // Autocomplete for three reference kinds while typing:
  //   #project/<slug>   → project slugs
  //   #task/<slug>      → canonical task slugs
  //   [[Task Name]]     → task titles (closing brackets inserted for you)
  const acToken = useMemo(() => {
    const before = draft.slice(0, caret);
    const taskSlug = /#task\/([a-z0-9-_]*)$/i.exec(before);
    if (taskSlug) {
      return { kind: "task-slug" as const, start: caret - taskSlug[1].length, query: taskSlug[1].toLowerCase() };
    }
    const project = /#project\/([a-z0-9-_]*)$/i.exec(before);
    if (project) {
      return { kind: "project" as const, start: caret - project[1].length, query: project[1].toLowerCase() };
    }
    const title = /\[\[([^\[\]\n]*)$/.exec(before);
    if (title) {
      return { kind: "task-title" as const, start: caret - title[1].length, query: title[1].toLowerCase() };
    }
    return null;
  }, [draft, caret]);

  const acMatches = useMemo(() => {
    if (!acToken) return [];
    const q = acToken.query;
    if (acToken.kind === "project") {
      return projects
        .filter((p) => !q || p.slug.toLowerCase().includes(q) || (p.name ?? "").toLowerCase().includes(q))
        .slice(0, 6)
        .map((p) => ({ key: p.slug, insert: p.slug, primary: p.slug, secondary: p.name }));
    }
    const matched = tasks
      .filter((t) => !q || t.slug.toLowerCase().includes(q) || t.title.toLowerCase().includes(q))
      // Surface actionable tasks first, then most recently referenced titles.
      .sort((a, b) => Number(a.status === "done") - Number(b.status === "done"))
      .slice(0, 8);
    if (acToken.kind === "task-slug") {
      return matched.map((t) => ({ key: t.slug, insert: t.slug, primary: t.slug, secondary: t.title }));
    }
    return matched.map((t) => ({ key: t.slug, insert: `${t.title}]] `, primary: t.title, secondary: `#task/${t.slug}` }));
  }, [acToken, projects, tasks]);

  const acHint =
    acToken?.kind === "task-slug" ? "#task/" : acToken?.kind === "task-title" ? "[[Task Name]]" : "#project/";

  useEffect(() => {
    setAcIndex(0);
  }, [acToken?.query, acToken?.kind]);

  const applyCompletion = (insert: string) => {
    if (!acToken) return;
    // `[[` completions include the closing brackets, so swallow any the user
    // already typed to avoid `[[Title]]]]`.
    const after = draft.slice(caret);
    const trailing = insert.endsWith("]] ") ? /^\]\]\s?/.exec(after)?.[0].length ?? 0 : 0;
    const next = draft.slice(0, acToken.start) + insert + draft.slice(caret + trailing);
    const newCaret = acToken.start + insert.length;
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


  // Append an example line to the note and reveal the markdown editor so the
  // user can see exactly which text produced which interpretation.
  const insertExample = (line: string) => {
    setShowSource(true);
    setDraft((prev) => {
      const base = prev.replace(/\s*$/, "");
      return base ? `${base}\n${line}\n` : `${line}\n`;
    });
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
        setCaret(ta.value.length);
      }
    });
  };



  // One-click repair from a "needs attention" row: rewrite/insert the line,
  // reveal the editor and drop the caret at the end of that line.
  const applyFix = (lineNumber: number, fix: NoteFix) => {
    setShowSource(true);
    const { markdown: next, caretLine } = applyNoteFix(draft, lineNumber, fix);
    if (next !== draft) setDraft(next);
    const offset = lineEndOffset(next, caretLine);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(offset, offset);
        setCaret(offset);
      }
    });
    toast.success(
      fix.op.type === "focus-line-end"
        ? `Line ${lineNumber} ready — type the missing text`
        : `Fixed line ${lineNumber} · ${fix.label}`,
    );
  };

  const displayLogContent = (raw: string, task?: { slug: string; title: string } | null) => {
    if (showSlugs || !task) return raw;
    return raw
      .replace(new RegExp(`#task/${task.slug}\\b`, "g"), "")
      .replace(/\s+/g, " ")
      .trim();
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
      applyCompletion(acMatches[acIndex].insert);
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
              <DayWindowIndicator date={date} className="mt-1" />

            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {draft === lastSavedRef.current ? "saved" : "saving…"}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowSource((v) => !v)}
              title={showSource ? "Hide raw markdown" : "Edit raw markdown"}
            >
              {showSource ? (
                <><EyeOff className="h-3.5 w-3.5 mr-1.5" />Hide markdown</>
              ) : (
                <><Eye className="h-3.5 w-3.5 mr-1.5" />Edit markdown</>
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

        <section
          aria-label="Rendered preview"
          className="bg-card border border-border rounded-lg p-4"
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              Today
            </h2>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setCompactPreview((v) => !v)}
                className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                title={compactPreview ? "Show full metadata (projects, @start, @progress)" : "Hide secondary metadata, keep task titles"}
              >
                {compactPreview ? "compact ·on" : "compact ·off"}
              </button>
              <span className="text-[10px] font-mono text-muted-foreground">
                live · click task titles to open
              </span>
            </div>
          </div>
          <DailyNotePreview markdown={draft} tasks={tasks} compact={compactPreview} />
        </section>

        <div className="mt-4">
          <NoteInterpretation
            markdown={draft}
            tasks={tasks}
            projects={projects}
            onInsertExample={insertExample}
            onApplyFix={applyFix}
          />
        </div>


        {showSource && (
          <div className="relative mt-4">

            <div className="relative rounded-lg border border-border bg-card">
              <NoteEditorHighlightOverlay
                markdown={draft}
                kinds={editorLines.kinds}
                scrollTop={editorScrollTop}
              />
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
                onScroll={(e) => setEditorScrollTop(e.currentTarget.scrollTop)}
                placeholder={PLACEHOLDER}
                spellCheck={false}
                className="relative w-full min-h-[55vh] bg-transparent rounded-lg p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words focus:outline-none focus:ring-2 focus:ring-ring resize-y"
              />
            </div>
            <NoteSyntaxLegend malformedCount={malformedCount} taskCount={taskLineCount} />

            {acMatches.length > 0 && (
              <div className="absolute left-3 bottom-3 z-10 w-80 bg-popover border border-border rounded-md shadow-md overflow-hidden">
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider font-mono text-muted-foreground border-b border-border">
                  {acHint} — ↑↓ Enter
                </div>
                <ul>
                  {acMatches.map((m, i) => (
                    <li key={m.key}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          applyCompletion(m.insert);
                        }}
                        onMouseEnter={() => setAcIndex(i)}
                        className={`w-full text-left px-3 py-1.5 text-sm flex items-baseline justify-between gap-2 ${
                          i === acIndex ? "bg-accent text-accent-foreground" : ""
                        }`}
                      >
                        <span className="font-mono truncate">{m.primary}</span>
                        <span className="text-xs text-muted-foreground truncate">{m.secondary}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          </div>
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
        <DailyRatingPanel
          noteId={query.data?.note.id}
          date={date}
          energy={
            (query.data?.note as { energy_level?: number | null } | undefined)?.energy_level ?? null
          }
          productivity={
            (query.data?.note as { productivity_level?: number | null } | undefined)
              ?.productivity_level ?? null
          }
        />

        <div>
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Cloud className="h-3.5 w-3.5" /> Weather · BosteadFarmHouse
            </h2>
            <button
              type="button"
              onClick={() => refreshWeather.mutate()}
              disabled={refreshWeather.isPending}
              className="text-muted-foreground hover:text-foreground"
              title="Refresh forecast"
            >
              <RefreshCw className={`h-3 w-3 ${refreshWeather.isPending ? "animate-spin" : ""}`} />
            </button>
          </div>
          {weatherQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading forecast…</p>
          ) : weatherQuery.data ? (
            <div className="border border-border rounded p-2 bg-card text-xs font-mono space-y-1">
              <div className="text-sm font-semibold">{weatherQuery.data.conditions ?? "—"}</div>
              <div className="text-muted-foreground">
                High{" "}
                <span className="text-foreground">
                  {weatherQuery.data.high_temp_f != null
                    ? `${Math.round(Number(weatherQuery.data.high_temp_f))}°F`
                    : "—"}
                </span>
                {" · "}Low{" "}
                <span className="text-foreground">
                  {weatherQuery.data.low_temp_f != null
                    ? `${Math.round(Number(weatherQuery.data.low_temp_f))}°F`
                    : "—"}
                </span>
              </div>
              {(weatherQuery.data.feels_like_high_f != null ||
                weatherQuery.data.feels_like_low_f != null) && (
                <div className="text-muted-foreground">
                  Feels like{" "}
                  <span className="text-foreground">
                    {weatherQuery.data.feels_like_high_f != null
                      ? `${Math.round(Number(weatherQuery.data.feels_like_high_f))}°F`
                      : "—"}
                  </span>
                  {weatherQuery.data.feels_like_low_f != null && (
                    <>
                      {" / "}
                      <span className="text-foreground">
                        {`${Math.round(Number(weatherQuery.data.feels_like_low_f))}°F`}
                      </span>
                    </>
                  )}
                </div>
              )}
              {weatherQuery.data.humidity != null && (
                <div className="text-muted-foreground">
                  Humidity{" "}
                  <span className="text-foreground">
                    {Math.round(Number(weatherQuery.data.humidity))}%
                  </span>
                </div>
              )}
              {weatherQuery.data.precip_probability != null && (
                <div className="text-muted-foreground">
                  Precip {Math.round(Number(weatherQuery.data.precip_probability))}%
                  {weatherQuery.data.precip_type ? ` · ${weatherQuery.data.precip_type}` : ""}
                </div>
              )}

            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No forecast available.</p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              Today's log · {(query.data?.entries ?? []).length}
            </h2>
            <button
              type="button"
              onClick={toggleSlugs}
              className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1"
              title="Debug: show or hide #task slugs in today's log"
            >
              slugs · {showSlugs ? "on" : "off"}
            </button>
          </div>
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
                    <span className="flex items-center gap-1 min-w-0">
                      <SlugChip slug={e.tasks.slug} size="xs" />
                      <Link
                        to="/tasks/$slug"
                        params={{ slug: e.tasks.slug }}
                        className="text-[10px] font-mono text-muted-foreground hover:text-foreground truncate shrink-0"
                      >
                        {e.tasks.title}
                      </Link>
                    </span>
                  )}

                </div>
                <p className="text-xs font-mono whitespace-pre-wrap break-words">{displayLogContent(e.raw_content, e.tasks)}</p>
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
              <li key={t.id} className="rounded hover:bg-accent group">
                <Link
                  to="/tasks/$slug"
                  params={{ slug: t.slug }}
                  className="flex items-center justify-between gap-2 text-sm py-1.5 px-2"
                >
                  <span className="truncate">{t.title}</span>
                  {t.status === "blocked" && (
                    <Badge variant="destructive" className="text-[10px]">blocked</Badge>
                  )}
                </Link>
                <div className="flex items-center gap-1 px-1 pb-1.5">
                  <TaskMoveDay taskId={t.id} fromDate={date} />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    title="Move this task off this day and back to the backlog"
                    disabled={toBacklog.isPending && toBacklog.variables === t.id}
                    onClick={() => toBacklog.mutate(t.id)}
                  >
                    <Undo2 className="h-3.5 w-3.5 mr-1" />
                    {toBacklog.isPending && toBacklog.variables === t.id ? "Moving…" : "Backlog"}
                  </Button>
                </div>
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
