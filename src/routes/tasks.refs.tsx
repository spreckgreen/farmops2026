import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { scanNoteTaskRefs } from "@/lib/note-refs.functions";
import { repairNoteTaskRefs } from "@/lib/note-ref-repair.functions";
import { toast } from "sonner";


export const Route = createFileRoute("/tasks/refs")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Broken task references — Bostead Farms" },
      {
        name: "description",
        content:
          "Scan every daily note for #task/<slug> references that no longer resolve to a task, with suggested fixes.",
      },
      { property: "og:title", content: "Broken task references — Bostead Farms" },
      {
        property: "og:description",
        content: "Audit daily notes for unresolved #task/<slug> and [[Title]] references.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RefsPage,
});

function RefsPage() {
  const scanFn = useServerFn(scanNoteTaskRefs);
  const scan = useMutation({
    mutationFn: () => scanFn(),
    onSuccess: (r) =>
      toast.success(
        r.unresolvedCount === 0
          ? `All ${r.refCount} references resolve across ${r.scannedNotes} notes`
          : `${r.unresolvedCount} unresolved reference${r.unresolvedCount === 1 ? "" : "s"} in ${r.notes.length} note${r.notes.length === 1 ? "" : "s"}`,
      ),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Scan failed"),
  });

  const result = scan.data;

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-start justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-mono font-bold mb-1">Broken task references</h1>
            <p className="text-xs text-muted-foreground font-mono">
              Scans every daily note for <code>#task/&lt;slug&gt;</code> and{" "}
              <code>[[Task Name]]</code> references that no longer resolve
            </p>
          </div>
          <Button
            onClick={() => scan.mutate()}
            disabled={scan.isPending}
            className="font-mono text-xs"
          >
            {scan.isPending ? "Scanning…" : "Scan daily notes"}
          </Button>
        </div>

        {!result && !scan.isPending && (
          <p className="text-sm text-muted-foreground font-mono">
            Run the scan to check every note in one pass. Nothing is modified — this is a report.
          </p>
        )}

        {result && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Notes scanned" value={result.scannedNotes} />
              <Stat label="References found" value={result.refCount} />
              <Stat label="Tasks known" value={result.taskCount} />
              <Stat
                label="Unresolved"
                value={result.unresolvedCount}
                tone={result.unresolvedCount > 0 ? "bad" : "good"}
              />
            </div>

            {result.unresolvedCount === 0 ? (
              <div className="border border-border rounded p-4 text-sm font-mono">
                Every reference resolves. Renames stay safe because slugs are immutable.
              </div>
            ) : (
              <div className="space-y-4">
                {result.notes.map((note) => (
                  <div key={note.noteId} className="border border-border rounded">
                    <div className="flex items-center justify-between px-4 py-2 border-b border-border">
                      <Link
                        to="/notes/$date"
                        params={{ date: note.date }}
                        className="font-mono text-sm underline"
                      >
                        {note.date}
                      </Link>
                      <Badge variant="destructive" className="font-mono text-[10px]">
                        {note.unresolved.length} unresolved
                      </Badge>
                    </div>
                    <ul className="divide-y divide-border">
                      {note.unresolved.map((ref, i) => (
                        <li key={`${note.noteId}-${i}`} className="px-4 py-3 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="font-mono text-[10px]">
                              line {ref.line}
                            </Badge>
                            <code className="text-xs font-mono">{ref.token}</code>
                          </div>
                          <p className="text-xs text-muted-foreground font-mono truncate">
                            {ref.lineText.trim()}
                          </p>
                          {ref.suggestion ? (
                            <p className="text-xs font-mono">
                              Closest match:{" "}
                              <Link
                                to="/tasks/$slug"
                                params={{ slug: ref.suggestion.slug }}
                                className="underline"
                              >
                                #task/{ref.suggestion.slug}
                              </Link>{" "}
                              <span className="text-muted-foreground">
                                ({ref.suggestion.title}, {Math.round(ref.suggestion.score * 100)}%
                                similar)
                              </span>
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground font-mono">
                              No close match — create the task or remove the reference.
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground font-mono">
              Scanned {new Date(result.scannedAt).toLocaleString()}
            </p>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "good" | "bad";
}) {
  return (
    <div className="border border-border rounded p-3">
      <div
        className={`text-xl font-mono font-bold ${
          tone === "bad" ? "text-destructive" : tone === "good" ? "text-primary" : ""
        }`}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-mono">
        {label}
      </div>
    </div>
  );
}
