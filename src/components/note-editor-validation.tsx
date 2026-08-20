import { useMemo } from "react";
import { AlertTriangle, CheckSquare, Square } from "lucide-react";
import { interpretNote, type NoteInterpretation } from "@/lib/note-syntax";

type TaskLite = { slug: string; title: string; status?: string };
type ProjectLite = { slug: string; name?: string };

export type EditorLineKind = "task" | "done" | "malformed" | "ref" | "warning" | "note";

/** Per-line kinds, indexed by 0-based line index of the raw markdown. */
export function classifyEditorLines(
  markdown: string,
  opts: { tasks?: TaskLite[]; projects?: ProjectLite[] } = {},
): { kinds: EditorLineKind[]; interpretation: NoteInterpretation } {
  const interpretation = interpretNote(markdown, opts);
  const total = markdown.split("\n").length;
  const kinds: EditorLineKind[] = Array.from({ length: total }, () => "note");
  for (const line of interpretation.lines) {
    const i = line.lineNumber - 1;
    if (i < 0 || i >= total) continue;
    if (line.action === "create-task") kinds[i] = "task";
    else if (line.action === "complete-task") kinds[i] = "done";
    else if (line.action === "warning")
      kinds[i] = line.label === "almost a task" ? "malformed" : "warning";
    else if (line.action === "log-entry") kinds[i] = "ref";
  }
  return { kinds, interpretation };
}

const KIND_CLASS: Record<EditorLineKind, string> = {
  // Backgrounds only — the overlay text itself is invisible.
  task: "bg-primary/10 border-l-2 border-primary/60",
  done: "bg-muted border-l-2 border-muted-foreground/50",
  malformed: "bg-destructive/15 border-l-2 border-destructive",
  ref: "bg-accent/40 border-l-2 border-accent-foreground/30",
  warning: "bg-destructive/10 border-l-2 border-destructive/50",
  note: "",
};

/**
 * Invisible mirror of the textarea content that paints a background stripe per
 * line. Must share the textarea's exact font, padding and wrapping so the
 * stripes line up even when a line wraps.
 */
export function NoteEditorHighlightOverlay({
  markdown,
  kinds,
  scrollTop,
  className = "",
}: {
  markdown: string;
  kinds: EditorLineKind[];
  scrollTop: number;
  className?: string;
}) {
  const lines = useMemo(() => markdown.split("\n"), [markdown]);
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 overflow-hidden rounded-lg ${className}`}
    >
      <div
        className="p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words text-transparent"
        style={{ transform: `translateY(${-scrollTop}px)` }}
      >
        {lines.map((line, i) => (
          <div key={i} className={`${KIND_CLASS[kinds[i] ?? "note"]} -ml-1 pl-1`}>
            {line === "" ? "\u200b" : line}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Legend + the required checkbox syntax, shown under the editor. */
export function NoteSyntaxLegend({
  malformedCount,
  taskCount,
}: {
  malformedCount: number;
  taskCount: number;
}) {
  return (
    <div className="mt-2 space-y-2 text-[11px] font-mono text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-primary/30 border-l-2 border-primary" />
          <Square className="h-3 w-3" /> becomes a task
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-muted border-l-2 border-muted-foreground/50" />
          <CheckSquare className="h-3 w-3" /> marks done
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-accent/60 border-l-2 border-accent-foreground/40" />
          logs onto an existing task
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-destructive/25 border-l-2 border-destructive" />
          <AlertTriangle className="h-3 w-3" /> needs attention
        </span>
        <span>unhighlighted = note text only</span>
      </div>

      {malformedCount > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold">
              {malformedCount} line{malformedCount === 1 ? "" : "s"} look{malformedCount === 1 ? "s" : ""} like a task but won&apos;t create one.
            </p>
            <p className="text-foreground/80">
              A task line needs a dash, a space, <code>[ ]</code> or <code>[x]</code>, then a
              space, then the title:
            </p>
            <pre className="whitespace-pre-wrap text-foreground/90">{`- [ ] Boiler pipe test ends      ✓ creates a task
- [x] Grease the loader pins     ✓ creates it and marks done
[ ]Boiler pipe test ends         ✗ no "- " and no space after "]"
* [ ] Boiler pipe test ends      ✗ bullet must be "-"
- [] Boiler pipe test ends       ✗ brackets need a space: [ ]`}</pre>
            <p className="text-foreground/70">
              Use the fix buttons in “What ‘Commit to log’ will do” to rewrite them
              automatically.
            </p>
          </div>
        </div>
      ) : taskCount > 0 ? (
        <p>
          {taskCount} checkbox line{taskCount === 1 ? "" : "s"} will create or complete a task on
          commit.
        </p>
      ) : (
        <p>
          Start a line with <code>- [ ] </code> (dash, space, brackets, space) to turn it into a
          task.
        </p>
      )}
    </div>
  );
}
