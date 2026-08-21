import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Merge, Play, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  reconcileDuplicateTasks,
  type ReconcileResult,
} from "@/lib/task-dedupe.functions";

export const Route = createFileRoute("/admin/task-dedupe")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Task Reconciliation — Bostead" },
      {
        name: "description",
        content:
          "Find duplicate tasks created by parsed daily-note checkboxes and merge their done status into the canonical #task entries.",
      },
      { property: "og:title", content: "Task Reconciliation — Bostead" },
      {
        property: "og:description",
        content: "Merge duplicate checkbox tasks back into their canonical #task entries.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TaskDedupePage,
});

function TaskDedupePage() {
  const run = useServerFn(reconcileDuplicateTasks);
  const [result, setResult] = useState<ReconcileResult | null>(null);

  const mutation = useMutation({
    mutationFn: (dryRun: boolean) => run({ data: { dryRun } }),
    onSuccess: (data) => {
      setResult(data);
      toast.success(
        data.dryRun
          ? `Scan complete — ${data.merges.length} duplicate(s) found`
          : `Merged ${data.deleted} duplicate(s), carried ${data.doneCarried} done state(s)`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const busy = mutation.isPending;
  const hasWork = (result?.merges.length ?? 0) + (result?.titleCleanups.length ?? 0) > 0;

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Merge className="h-6 w-6" /> Task Reconciliation
          </h1>
          <p className="text-sm text-muted-foreground">
            Scans your tasks for duplicates created by the old daily-note checkbox parser
            (titles still carrying <code>#task/&lt;slug&gt;</code>, or exact title twins),
            merges their done status into the canonical task, repoints activity log,
            design element and summary references, then deletes the stray.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Run</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onClick={() => mutation.mutate(true)}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              <span className="ml-2">Dry run (scan only)</span>
            </Button>
            <Button
              disabled={busy || !result || !result.dryRun || !hasWork}
              onClick={() => mutation.mutate(false)}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              <span className="ml-2">Apply merges</span>
            </Button>
            <Button asChild variant="ghost">
              <Link to="/admin">Back to admin</Link>
            </Button>
          </CardContent>
        </Card>

        {result ? <ResultCard result={result} /> : null}
      </div>
    </AppLayout>
  );
}

function ResultCard({ result }: { result: ReconcileResult }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">
          {result.dryRun ? "Scan result" : "Applied"}
        </CardTitle>
        <div className="flex gap-2 text-xs">
          <Badge variant="outline">{result.scannedTasks} scanned</Badge>
          <Badge variant="outline">{result.merges.length} duplicates</Badge>
          <Badge variant="outline">{result.doneCarried} done carried</Badge>
          {!result.dryRun ? <Badge>{result.deleted} deleted</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {result.merges.length === 0 && result.titleCleanups.length === 0 ? (
          <p className="text-muted-foreground">
            No duplicate tasks found — your <code>#task/&lt;slug&gt;</code> entries are canonical.
          </p>
        ) : null}

        {result.merges.map((m) => (
          <div key={m.duplicateId} className="rounded-md border p-3 space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant={m.carriesDone ? "default" : "secondary"} className="text-xs">
                {m.carriesDone ? "carries done" : "no status change"}
              </Badge>
              <span className="text-xs text-muted-foreground">{m.reason}</span>
            </div>
            <div className="font-mono text-xs break-all">
              <span className="text-destructive">− {m.duplicateTitle}</span>
              <br />
              <span className="text-muted-foreground">
                → #task/{m.canonicalSlug} · {m.canonicalTitle}
              </span>
            </div>
          </div>
        ))}

        {result.titleCleanups.length > 0 ? (
          <div className="space-y-2">
            <h2 className="font-medium">Title cleanups (no canonical twin)</h2>
            {result.titleCleanups.map((c) => (
              <div key={c.id} className="rounded-md border p-3 font-mono text-xs break-all">
                <span className="text-destructive">− {c.from}</span>
                <br />
                <span className="text-primary">+ {c.to}</span>
              </div>
            ))}
          </div>
        ) : null}

        {!result.dryRun ? (
          <p className="text-xs text-muted-foreground">
            Repointed {result.repointed.activityLog} activity log entries,{" "}
            {result.repointed.designElements} design elements, {result.repointed.summaries}{" "}
            summaries.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
