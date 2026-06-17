import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Check, Square, CheckSquare, Calendar, Percent } from "lucide-react";

/**
 * Rendered preview of a daily-note markdown line.
 *
 * Designed to make ref lines like
 *   `- #task/follow-up-aep-ohio-electric-service-order-project Follow-up AEP Ohio Electric service order #project/bostead`
 * readable: the slug becomes a clickable task title, `#project/x` becomes a
 * small badge, `@start:` / `@progress:` become icon chips, and `- [ ] / - [x]`
 * become checkbox glyphs.
 *
 * Pure presentation — does not mutate the markdown. The textarea above
 * remains the source of truth.
 */

type TaskLite = { slug: string; title: string; status?: string };

type Props = {
  markdown: string;
  tasks: TaskLite[];
  /**
   * Compact mode hides secondary metadata (project badges, @start, @progress,
   * !entry-type badges) and keeps just checkboxes, plain text, and clickable
   * task titles. Useful for skimming a day at a glance.
   */
  compact?: boolean;
};

type Token =
  | { kind: "task-ref"; slug: string }
  | { kind: "project"; tag: string }
  | { kind: "start"; iso: string }
  | { kind: "progress"; pct: number }
  | { kind: "text"; text: string };

const TASK_RE = /#task\/([a-z0-9-]+)/g;
const PROJECT_RE = /#project\/([a-z0-9-_]+)/g;
const START_RE = /@start:([^\s]+)/g;
const PROGRESS_RE = /@progress:(\d+)/g;

function tokenize(raw: string): Token[] {
  // Strip the leading bullet marker; we render it as a checkbox or dot below.
  let s = raw.replace(/^\s*-\s*(\[[ xX]\]\s*)?/, "");

  // Pull out structured tokens, replacing each with a placeholder so the
  // remaining text reads naturally.
  const tokens: Token[] = [];
  s = s.replace(TASK_RE, (_, slug) => {
    tokens.push({ kind: "task-ref", slug });
    return "\u0000T\u0000";
  });
  s = s.replace(PROJECT_RE, (_, tag) => {
    tokens.push({ kind: "project", tag });
    return "\u0000P\u0000";
  });
  s = s.replace(START_RE, (_, iso) => {
    tokens.push({ kind: "start", iso });
    return "\u0000S\u0000";
  });
  s = s.replace(PROGRESS_RE, (_, pct) => {
    tokens.push({ kind: "progress", pct: Number(pct) });
    return "\u0000R\u0000";
  });

  // Re-walk the placeholder-stripped string and re-interleave tokens in order.
  const out: Token[] = [];
  let cursor = 0;
  let tokenIdx = 0;
  const placeholder = /\u0000[TPSR]\u0000/g;
  let m: RegExpExecArray | null;
  while ((m = placeholder.exec(s))) {
    const text = s.slice(cursor, m.index);
    if (text.trim()) out.push({ kind: "text", text: text.replace(/\s+/g, " ") });
    out.push(tokens[tokenIdx++]);
    cursor = m.index + m[0].length;
  }
  const tail = s.slice(cursor);
  if (tail.trim()) out.push({ kind: "text", text: tail.replace(/\s+/g, " ") });
  return out;
}

function getCheckbox(raw: string): "open" | "done" | null {
  const m = /^\s*-\s*\[([ xX])\]/.exec(raw);
  if (!m) return null;
  return m[1] === " " ? "open" : "done";
}

function getEntryTypePrefix(text: string): { type: string; rest: string } | null {
  const m = /^!(blocker|decision|commit|meeting)\b\s*(.*)/i.exec(text);
  if (!m) return null;
  return { type: m[1].toLowerCase(), rest: m[2] };
}

function formatStartLabel(iso: string): string {
  // Accept "2026-06-17T09:00:00" or "2026-06-17". Display compactly.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const hasTime = /T\d{2}:\d{2}/.test(iso);
  if (!hasTime) return dateStr;
  const timeStr = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${dateStr} ${timeStr}`;
}

export function DailyNotePreview({ markdown, tasks }: Props) {
  const tasksBySlug = new Map(tasks.map((t) => [t.slug, t]));
  const lines = markdown.split("\n");

  if (markdown.trim().length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic px-1">
        Preview will render task references, projects, and metadata as you type.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {lines.map((line, idx) => {
        if (line.trim().length === 0) {
          return <div key={idx} className="h-2" aria-hidden />;
        }

        // Heading-ish lines (lines that aren't bullets / refs) render as
        // plain paragraph text so freeform notes stay readable.
        const isBullet = /^\s*-\s/.test(line);
        const checkbox = getCheckbox(line);
        const tokens = tokenize(line);

        // If the line has no task ref AND no bullet, render as a paragraph.
        const hasTaskRef = tokens.some((t) => t.kind === "task-ref");
        if (!isBullet && !hasTaskRef) {
          return (
            <p key={idx} className="text-sm leading-relaxed whitespace-pre-wrap break-words">
              {line}
            </p>
          );
        }

        // Drop text tokens that just repeat the resolved task title (the
        // canonical refLine duplicates the title on disk for parser
        // resilience, but in the preview that reads as "Title  Title").
        const refTitles = new Set(
          tokens
            .filter((t): t is Extract<Token, { kind: "task-ref" }> => t.kind === "task-ref")
            .map((t) => (tasksBySlug.get(t.slug)?.title ?? t.slug).trim().toLowerCase())
            .filter(Boolean),
        );
        const displayTokens = tokens.filter(
          (t) => !(t.kind === "text" && refTitles.has(t.text.trim().toLowerCase())),
        );

        // Build the rendered row.
        return (
          <div key={idx} className="flex items-start gap-2 text-sm leading-relaxed">
            <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden>
              {checkbox === "done" ? (
                <CheckSquare className="h-4 w-4 text-foreground" />
              ) : checkbox === "open" ? (
                <Square className="h-4 w-4" />
              ) : (
                <Check className="h-4 w-4 opacity-0" />
              )}
            </span>
            <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              {displayTokens.map((tok, i) => {
                if (tok.kind === "task-ref") {
                  const task = tasksBySlug.get(tok.slug);
                  const label = task?.title ?? tok.slug;
                  return (
                    <Link
                      key={i}
                      to="/tasks/$slug"
                      params={{ slug: tok.slug }}
                      className={`font-medium underline-offset-2 hover:underline ${
                        checkbox === "done" ? "line-through text-muted-foreground" : ""
                      }`}
                      title={`#task/${tok.slug}`}
                    >
                      {label}
                    </Link>
                  );
                }
                if (tok.kind === "project") {
                  return (
                    <Badge
                      key={i}
                      variant="secondary"
                      className="text-[10px] font-mono uppercase tracking-wider"
                    >
                      {tok.tag}
                    </Badge>
                  );
                }
                if (tok.kind === "start") {
                  return (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 text-[11px] font-mono text-muted-foreground"
                    >
                      <Calendar className="h-3 w-3" />
                      {formatStartLabel(tok.iso)}
                    </span>
                  );
                }
                if (tok.kind === "progress") {
                  return (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 text-[11px] font-mono text-muted-foreground"
                    >
                      <Percent className="h-3 w-3" />
                      {tok.pct}%
                    </span>
                  );
                }
                // text
                const typed = getEntryTypePrefix(tok.text);
                if (typed) {
                  return (
                    <span key={i} className="inline-flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {typed.type}
                      </Badge>
                      {typed.rest && (
                        <span className="break-words">{typed.rest}</span>
                      )}
                    </span>
                  );
                }
                return (
                  <span key={i} className="break-words">
                    {tok.text}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
