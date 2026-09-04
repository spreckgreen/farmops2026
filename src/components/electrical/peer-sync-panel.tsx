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
          max_batches_per_run: Number(limit) || 5,
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
            Batches per run
            <Input
              value={limit}
              onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
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
      </div>
    </PersistedSection>
  );
}
