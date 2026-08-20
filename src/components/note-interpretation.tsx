import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SlugChip } from "@/components/slug-chip";

import {
  AlertTriangle,
  CheckCircle2,
  CirclePlus,
  FileText,
  MessageSquare,
} from "lucide-react";
import {
  interpretNote,
  noteFixes,
  summarizeInterpretation,
  type InterpretedLine,
  type NoteFix,
} from "@/lib/note-syntax";

type TaskLite = { slug: string; title: string; status?: string };
type ProjectLite = { slug: string; name?: string };

type Props = {
  markdown: string;
  tasks: TaskLite[];
  projects?: ProjectLite[];
  /** Appends an example line to the note so the user can see it interpreted live. */
  onInsertExample?: (line: string) => void;
  /** Applies a one-click repair to the line that needs attention. */
  onApplyFix?: (lineNumber: number, fix: NoteFix) => void;
};


const EXAMPLES: { label: string; line: (projectSlug: string) => string }[] = [
  {
    label: "Random task",
    line: () => "- [ ] Grease the loader pins",
  },
  {
    label: "Task in a project",
    line: (p) => `- [ ] Order cement for the shop slab #project/${p}`,
  },
  {
    label: "Scheduled task",
    line: () => "- [ ] Winterize the hose bibs @start:2026-10-15 08:00 @progress:0",
  },
  {
    label: "Log entry on a task",
    line: () => "#task/grease-the-loader-pins used 2 tubes of moly grease",
  },
  {
    label: "Blocker",
    line: () => "!blocker [[Order cement for the shop slab]] supplier is out until Friday",
  },
  {
    label: "Mark done",
    line: () => "- [x] Grease the loader pins",
  },
];

function rowStyle(action: InterpretedLine["action"]) {
  switch (action) {
    case "create-task":
      return {
        icon: CirclePlus,
        badge: "default" as const,
        tint: "border-l-2 border-l-primary",
      };
    case "complete-task":
      return {
        icon: CheckCircle2,
        badge: "secondary" as const,
        tint: "border-l-2 border-l-primary/50",
      };
    case "log-entry":
      return {
        icon: MessageSquare,
        badge: "secondary" as const,
        tint: "border-l-2 border-l-muted-foreground/40",
      };
    case "warning":
      return {
        icon: AlertTriangle,
        badge: "destructive" as const,
        tint: "border-l-2 border-l-destructive",
      };
    default:
      return {
        icon: FileText,
        badge: "outline" as const,
        tint: "border-l-2 border-l-border",
      };
  }
}

export function NoteInterpretation({ markdown, tasks, projects = [], onInsertExample }: Props) {
  const { lines, counts } = useMemo(
    () => interpretNote(markdown, { tasks, projects }),
    [markdown, tasks, projects],
  );
  const exampleProject = projects[0]?.slug ?? "bosteadfarmshop";

  return (
    <section
      aria-label="How this note will be interpreted"
      className="bg-card border border-border rounded-lg p-4"
    >
      <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
        <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          What "Commit to log" will do
        </h2>
        <span className="text-[11px] font-mono text-muted-foreground">
          {summarizeInterpretation(counts)}
        </span>
      </div>

      {lines.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          Nothing typed yet. Try one of the examples below — each line shows up here explained
          before anything is saved.
        </p>
      ) : (
        <ul className="space-y-2">
          {lines.map((l) => {
            const { icon: Icon, badge, tint } = rowStyle(l.action);
            return (
              <li key={l.lineNumber} className={`pl-3 ${tint}`}>
                <div className="flex items-start gap-2">
                  <Icon
                    className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${
                      l.action === "warning"
                        ? "text-destructive"
                        : l.action === "ignored"
                          ? "text-muted-foreground"
                          : "text-foreground"
                    }`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={badge} className="text-[10px] uppercase font-mono">
                        {l.label}
                      </Badge>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        line {l.lineNumber}
                      </span>
                      {l.taskSlug && !l.unresolvedRef && (
                        <span className="flex items-center gap-1 min-w-0">
                          <SlugChip slug={l.taskSlug} size="xs" />
                          <Link
                            to="/tasks/$slug"
                            params={{ slug: l.taskSlug }}
                            className="text-[10px] font-mono text-muted-foreground hover:text-foreground underline-offset-2 hover:underline shrink-0"
                          >
                            open
                          </Link>
                        </span>
                      )}

                    </div>
                    <p className="text-sm mt-0.5 break-words">{l.summary}</p>
                    <p className="text-[11px] font-mono text-muted-foreground/80 mt-0.5 break-words">
                      {l.raw}
                    </p>
                    {l.details.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {l.details.map((d, i) => (
                          <li key={i} className="text-[11px] text-muted-foreground break-words">
                            · {d}
                          </li>
                        ))}
                      </ul>
                    )}
                    {onApplyFix && l.action === "warning" && (() => {
                      const fixes = noteFixes(l, tasks);
                      if (fixes.length === 0) return null;
                      return (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                            fix
                          </span>
                          {fixes.map((f) => (
                            <Button
                              key={f.kind + f.label}
                              size="sm"
                              variant="outline"
                              className="h-6 text-[11px] px-2"
                              title={f.description}
                              onClick={() => onApplyFix(l.lineNumber, f)}
                            >
                              <Wrench className="h-3 w-3 mr-1" aria-hidden />
                              {f.label}
                            </Button>
                          ))}
                        </div>
                      );
                    })()}

                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {onInsertExample && (
        <div className="mt-4 pt-3 border-t border-border">
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
            Insert an example line
          </p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <Button
                key={ex.label}
                size="sm"
                variant="outline"
                className="text-xs h-7"
                onClick={() => onInsertExample(ex.line(exampleProject))}
                title={ex.line(exampleProject)}
              >
                {ex.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
