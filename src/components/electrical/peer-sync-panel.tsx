// Administrator controls for the scheduled, one-way, preview-only pull of
// applied audit batches from the self-hosted FarmOps instance.
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { PersistedSection } from "@/components/electrical/persisted-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  getPeerSyncState,
  resumePeerSyncJob,
  savePeerSyncConfig,
} from "@/lib/electrical-peer-sync.functions";

type Outcome = "success" | "partial" | "failed" | "skipped";

function outcomeLabel(outcome: Outcome): string {
  if (outcome === "success") return "clean";
  if (outcome === "partial") return "partly clean";
  if (outcome === "failed") return "failed";
  return "nothing to do";
}

function outcomeVariant(outcome: Outcome): "secondary" | "destructive" | "outline" {
  if (outcome === "success") return "secondary";
  if (outcome === "failed" || outcome === "partial") return "destructive";
  return "outline";
}

// The saved value is bounded server-side (1-10). Clamp here so an out-of-range
// entry is corrected in place instead of surfacing a validation crash.
function clampLimit(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 10);
}


export function PeerSyncPanel() {
  const readState = useServerFn(getPeerSyncState);
  const save = useServerFn(savePeerSyncConfig);
  const resume = useServerFn(resumePeerSyncJob);

  const state = useQuery({
    queryKey: ["electrical-peer-sync-state"],
    queryFn: async () => await readState({}),
  });

  const [peerUrl, setPeerUrl] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [limit, setLimit] = useState("5");

  useEffect(() => {
    const config = state.data?.config;
    if (!config) return;
    setPeerUrl(config.peer_base_url);
    setEnabled(config.enabled);
    setLimit(String(config.max_batches_per_run));
  }, [state.data?.config]);

  const saveMutation = useMutation({
    mutationFn: async () =>
      await save({
        data: {
          peer_base_url: peerUrl.trim(),
          enabled,
          max_batches_per_run: clampLimit(limit),
        },
      }),
    onSuccess: (r) => {
      toast.success(`Automatic pull saved for ${r.peer_origin}.`);
      state.refetch();
    },
    onError: (e) => toast.error(String(e)),
  });

  const resumeMutation = useMutation({
    mutationFn: async () => await resume({}),
    onSuccess: () => {
      toast.success("Automatic pull resumed. It will try again on the next run.");
      state.refetch();
    },
    onError: (e) => toast.error(String(e)),
  });

  const job = state.data?.job ?? null;
  const config = state.data?.config ?? null;
  const runs = state.data?.runs ?? [];
  // The list arrives newest first, so the first match in each case is the latest.
  const lastSuccess = runs.find((r) => r.outcome === "success") ?? null;
  const lastError = runs.find((r) => r.outcome === "failed" || r.outcome === "partial") ?? null;

  return (
    <PersistedSection
      storageKey="electrical.audit-batches.peer-sync"
      title="Automatic pull from your self-hosted instance"
      badges={
        <>
          <Badge variant="outline">preview only</Badge>
          {config?.enabled ? (
            <Badge variant="secondary">on</Badge>
          ) : (
            <Badge variant="outline">off</Badge>
          )}
          {job?.paused ? <Badge variant="destructive">paused</Badge> : null}
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          When this is on, batches your self-hosted instance has already applied appear here as
          previews on their own, without you pasting anything. Nothing is ever written here by the
          automatic pull: each staged item still needs your approval, and the change check still runs
          against this instance&apos;s own records. It never sends anything back, and it never
          touches the canonical workbook.
        </p>

        <Input
          value={peerUrl}
          onChange={(e) => setPeerUrl(e.target.value)}
          placeholder="https://electrical.example.com"
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs">
            <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(Boolean(v))} />
            Pull automatically
          </label>
          <label className="flex items-center gap-2 text-xs">
            Batches per run (1–10)
            <Input
              value={limit}
              onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
              onBlur={() => setLimit(String(clampLimit(limit)))}
              className="h-8 w-16"
              inputMode="numeric"
            />
          </label>

          <Button
            size="sm"
            disabled={!peerUrl.trim() || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            Save
          </Button>
          {job?.paused ? (
            <Button
              size="sm"
              variant="outline"
              disabled={resumeMutation.isPending}
              onClick={() => resumeMutation.mutate()}
            >
              Resume
            </Button>
          ) : null}
        </div>

        {state.data && !state.data.token_configured ? (
          <p className="text-xs text-destructive">
            The access key for your self-hosted instance is not saved yet, so the automatic pull
            cannot sign in there. Ask for it to be stored securely as{" "}
            <span className="font-mono">ELECTRICAL_PEER_SYNC_TOKEN</span>.
          </p>
        ) : null}

        {config ? (
          <div className="grid gap-1 rounded-md border border-border p-3 text-xs text-muted-foreground">
            <p>
              Last checked:{" "}
              {config.last_run_at ? new Date(config.last_run_at).toLocaleString() : "never"}
            </p>
            <p>
              Last clean run:{" "}
              {config.last_success_at ? new Date(config.last_success_at).toLocaleString() : "never"}
            </p>
            <p>Batches staged so far: {config.batches_staged_total}</p>
            {config.last_error ? (
              <p className="text-destructive">Last problem: {config.last_error}</p>
            ) : null}
            {job?.paused ? (
              <p className="text-destructive">
                Paused after repeated failures{job.paused_reason ? `: ${job.paused_reason}` : "."}
              </p>
            ) : null}
            {job?.running ? <p>A pull is running right now.</p> : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No self-hosted instance is configured yet.
          </p>
        )}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-medium">Recent runs</p>
            {lastSuccess ? (
              <Badge variant="secondary">
                last clean {new Date(lastSuccess.started_at).toLocaleString()}
              </Badge>
            ) : (
              <Badge variant="outline">no clean run recorded</Badge>
            )}
            {lastError ? (
              <Badge variant="destructive">
                last problem {new Date(lastError.started_at).toLocaleString()}
              </Badge>
            ) : (
              <Badge variant="outline">no problem recorded</Badge>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              disabled={state.isFetching}
              onClick={() => state.refetch()}
            >
              Refresh
            </Button>
          </div>
          {lastError?.error ? (
            <p className="text-xs text-destructive">
              Most recent problem: {lastError.error}
            </p>
          ) : null}
          {runs.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing has run yet. Entries appear here every time the automatic pull runs,
              including the runs that found nothing to do.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-2 py-1 font-medium">When</th>
                    <th className="px-2 py-1 font-medium">Result</th>
                    <th className="px-2 py-1 font-medium">Staged</th>
                    <th className="px-2 py-1 font-medium">Failed</th>
                    <th className="px-2 py-1 font-medium">Seen</th>
                    <th className="px-2 py-1 font-medium">Took</th>
                    <th className="px-2 py-1 font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-t border-border align-top">
                      <td className="px-2 py-1 whitespace-nowrap">
                        {new Date(run.started_at).toLocaleString()}
                      </td>
                      <td className="px-2 py-1">
                        <Badge variant={outcomeVariant(run.outcome)}>{outcomeLabel(run.outcome)}</Badge>
                      </td>
                      <td className="px-2 py-1">{run.staged}</td>
                      <td className="px-2 py-1">{run.failed}</td>
                      <td className="px-2 py-1">{run.peer_batches_seen}</td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        {run.duration_ms == null ? "—" : `${(run.duration_ms / 1000).toFixed(1)}s`}
                      </td>
                      <td className="px-2 py-1 text-muted-foreground">
                        {run.error ?? run.skipped_reason ?? (run.capped ? "hit the per-run limit" : "—")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </PersistedSection>
  );
}
