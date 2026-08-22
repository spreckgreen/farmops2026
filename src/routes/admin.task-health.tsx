import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Activity, AlertTriangle, CalendarClock, Loader2, PlayCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  getTaskHealthJobState,
  listTaskHealthRuns,
  resumeTaskHealthJob,
  runTaskHealthNow,
  recomputeTaskDayStamps,
} from "@/lib/task-health.functions";
import type { DayStampRecomputeResult } from "@/lib/task-health.functions";
import { APP_TIME_ZONE } from "@/lib/app-timezone";
import type { TaskHealthReport } from "@/lib/task-health.server";

export const Route = createFileRoute("/admin/task-health")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Task Health Monitor — Bostead" },
      {
        name: "description",
        content:
          "Nightly scan results for duplicate checkbox tasks and task status drift, with a manual re-run.",
      },
      { property: "og:title", content: "Task Health Monitor — Bostead" },
      {
        property: "og:description",
        content: "Review the nightly task-health job and re-run the duplicate/drift scan.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TaskHealthPage,
});

function TaskHealthPage() {
  const qc = useQueryClient();
  const runNow = useServerFn(runTaskHealthNow);
  const resume = useServerFn(resumeTaskHealthJob);
  const [report, setReport] = useState<TaskHealthReport | null>(null);
  const recomputeStamps = useServerFn(recomputeTaskDayStamps);
  const [stamps, setStamps] = useState<DayStampRecomputeResult | null>(null);

  const runs = useQuery({
    queryKey: ["task-health-runs"],
    queryFn: () => listTaskHealthRuns(),
  });

  const jobState = useQuery({
    queryKey: ["task-health-job"],
    queryFn: () => getTaskHealthJobState(),
    retry: false,
  });

  const scan = useMutation({
    mutationFn: (apply: boolean) => runNow({ data: { apply } }),
    onSuccess: (data) => {
      setReport(data);
      qc.invalidateQueries({ queryKey: ["task-health-runs"] });
      const findings = data.merges.length + data.titleCleanups.length + data.drift.length;
      toast.success(
        data.applied
          ? `Applied ${data.mergesApplied} merge(s) and fixed ${data.driftFixed} drift issue(s)`
          : findings === 0
            ? "No issues found"
            : `${findings} issue(s) found`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resumeJob = useMutation({
    mutationFn: () => resume({ data: undefined }),
    onSuccess: () => {
      toast.success("Nightly job resumed");
      qc.invalidateQueries({ queryKey: ["task-health-job"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const stampRun = useMutation({
    mutationFn: (apply: boolean) => recomputeStamps({ data: { apply } }),
    onSuccess: (data) => {
      setStamps(data);
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["daily-note"] });
      toast.success(
        data.applied
          ? `Restamped ${data.updated} task(s)`
          : data.fixes.length === 0
            ? "All day stamps already match their logged day"
            : `${data.fixes.length} stamp(s) landed on the wrong day`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const busy = scan.isPending;
  const stampsBusy = stampRun.isPending;

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6" /> Task Health Monitor
          </h1>
          <p className="text-sm text-muted-foreground">
            A nightly job scans every account for duplicate checkbox-derived tasks and for
            status drift (a task marked done with no close timestamp, or an open task that
            still carries one), applies the fixes, and records the outcome here.
          </p>
        </header>

        {jobState.data?.paused ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Nightly job is paused</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{jobState.data.pausedReason ?? "Paused after repeated failures."}</p>
              <Button size="sm" disabled={resumeJob.isPending} onClick={() => resumeJob.mutate()}>
                {resumeJob.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                <span className="ml-2">Resume job</span>
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">Run the scan now</CardTitle>
            {jobState.data?.lastRunAt ? (
              <span className="text-xs text-muted-foreground">
                nightly last ran {new Date(jobState.data.lastRunAt).toLocaleString()}
              </span>
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onClick={() => scan.mutate(false)}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              <span className="ml-2">Scan only</span>
            </Button>
            <Button disabled={busy} onClick={() => scan.mutate(true)}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              <span className="ml-2">Scan &amp; fix</span>
            </Button>
            <Button asChild variant="ghost">
              <Link to="/admin/task-dedupe">Manual reconciliation</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link to="/admin">Back to admin</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarClock className="h-4 w-4" /> Recompute day stamps
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Compares each task&apos;s close/start timestamp against the daily note its
              activity was logged in, and moves stamps that drifted onto the wrong day back
              onto the right one. Late-night edits used to stamp the next UTC date — e.g. a
              checkbox ticked 23:10 Friday landed on Saturday. Calendar: {APP_TIME_ZONE}.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={stampsBusy} onClick={() => stampRun.mutate(false)}>
                {stampsBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                <span className="ml-2">Preview drifted stamps</span>
              </Button>
              <Button disabled={stampsBusy} onClick={() => stampRun.mutate(true)}>
                {stampsBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                <span className="ml-2">Recompute &amp; fix</span>
              </Button>
            </div>
            {stamps ? (
              <div className="space-y-2 text-sm">
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline">{stamps.scannedTasks} scanned</Badge>
                  <Badge variant="outline">{stamps.fixes.length} drifted</Badge>
                  <Badge variant={stamps.applied ? "default" : "secondary"}>
                    {stamps.applied ? `${stamps.updated} task(s) restamped` : "preview only"}
                  </Badge>
                </div>
                {stamps.fixes.length === 0 ? (
                  <p className="text-muted-foreground">Nothing to fix.</p>
                ) : (
                  <ul className="space-y-1">
                    {stamps.fixes.map((f) => (
                      <li
                        key={`${f.taskId}-${f.field}`}
                        className="rounded-md border p-2 font-mono text-xs"
                      >
                        <span className="font-semibold">{f.title}</span>{" "}
                        <span className="text-muted-foreground">({f.slug})</span>
                        <div className="text-muted-foreground">
                          {f.field}: {f.fromDay} → {f.toDay}
                        </div>
                        <div className="text-muted-foreground break-all">
                          {f.from} → {f.to}
                        </div>
                        <div className="text-muted-foreground">{f.reason}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {report ? <ReportCard report={report} /> : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent runs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {runs.isLoading ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : (runs.data ?? []).length === 0 ? (
              <p className="text-muted-foreground">
                No runs recorded yet — the nightly job writes one row per account per run.
              </p>
            ) : (
              (runs.data ?? []).map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border p-3"
                >
                  <Badge
                    variant={
                      r.status === "error"
                        ? "destructive"
                        : r.status === "findings"
                          ? "default"
                          : "secondary"
                    }
                  >
                    {r.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(r.ran_at).toLocaleString()} · {r.trigger}
                    {r.applied ? " · applied" : " · scan only"}
                  </span>
                  <span className="ml-auto flex gap-2 text-xs">
                    <Badge variant="outline">{r.scanned_tasks} scanned</Badge>
                    <Badge variant="outline">{r.merges_applied} merged</Badge>
                    <Badge variant="outline">{r.drift_fixed} drift fixed</Badge>
                  </span>
                  {r.error ? (
                    <p className="w-full font-mono text-xs text-destructive break-all">{r.error}</p>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

function ReportCard({ report }: { report: TaskHealthReport }) {
  const findings = report.merges.length + report.titleCleanups.length + report.drift.length;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">
          {report.applied ? "Applied" : "Scan result"}
        </CardTitle>
        <div className="flex gap-2 text-xs">
          <Badge variant="outline">{report.scannedTasks} scanned</Badge>
          <Badge variant="outline">{report.merges.length} duplicates</Badge>
          <Badge variant="outline">{report.drift.length} drift</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {findings === 0 ? (
          <p className="text-muted-foreground">
            Clean — no duplicate checkbox tasks and no status drift.
          </p>
        ) : null}

        {report.merges.map((m) => (
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

        {report.titleCleanups.map((t) => (
          <div key={t.id} className="rounded-md border p-3 font-mono text-xs break-all">
            <span className="text-destructive">− {t.from}</span>
            <br />
            <span className="text-muted-foreground">+ {t.to}</span>
          </div>
        ))}

        {report.drift.map((d) => (
          <div key={`${d.taskId}-${d.kind}`} className="rounded-md border p-3 space-y-1">
            <Badge variant="outline" className="text-xs">
              {d.kind}
            </Badge>
            <p className="text-xs text-muted-foreground">{d.detail}</p>
            <p className="font-mono text-xs break-all">{d.taskId}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
