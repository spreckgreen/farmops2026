// FARMOPS-ELEC-AUDIT-BATCH-V1 — revision diff preview.
//
// Read-only: compares the staged revision against an earlier revision of the
// same audit so the owner can see exactly what changed before approving.
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { GitCompare } from "lucide-react";

import { PersistedSection } from "@/components/electrical/persisted-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { diffElectricalAuditManifests } from "@/lib/electrical-audit-batch.functions";
import type { AuditBatchRecord } from "@/lib/electrical-audit-batch.functions";
import {
  revisionRoot,
  sameRevisionFamily,
  type ManifestDiff,
  type ManifestDiffStatus,
} from "@/lib/electrical-audit-manifest-diff";

const STATUS_VARIANT: Record<ManifestDiffStatus, "default" | "secondary" | "outline" | "destructive"> =
  {
    added: "default",
    removed: "destructive",
    changed: "secondary",
    unchanged: "outline",
  };

function val(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v || "—";
  return JSON.stringify(v);
}

export function RevisionDiffPanel({
  revisionBatchId,
  batches,
}: {
  revisionBatchId: string;
  batches: AuditBatchRecord[];
}) {
  const runDiff = useServerFn(diffElectricalAuditManifests);
  const [baseId, setBaseId] = useState("");
  const [diff, setDiff] = useState<ManifestDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);

  const candidates = useMemo(() => {
    const family = batches.filter((b) => sameRevisionFamily(b.batch_id, revisionBatchId));
    const others = batches.filter(
      (b) => b.batch_id !== revisionBatchId && !family.some((f) => f.batch_id === b.batch_id),
    );
    return [...family, ...others];
  }, [batches, revisionBatchId]);

  const selected = baseId || candidates[0]?.batch_id || "";

  const mutation = useMutation({
    mutationFn: async () =>
      await runDiff({ data: { base_batch_id: selected, revision_batch_id: revisionBatchId } }),
    onSuccess: (d) => {
      setDiff(d);
      setError(null);
    },
    onError: (e) => {
      setDiff(null);
      setError(String(e));
    },
  });

  const rows = (diff?.items ?? []).filter((i) => showUnchanged || i.status !== "unchanged");

  return (
    <PersistedSection
      storageKey="electrical.audit-batches.revision-diff"
      title="Revision diff"
      badges={<Badge variant="outline">read only</Badge>}
    >
      <div className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          Compares <span className="font-mono">{revisionBatchId}</span> (revision family{" "}
          <span className="font-mono">{revisionRoot(revisionBatchId)}</span>) with an earlier stored
          manifest. Nothing is approved, written or applied by comparing.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            aria-label="Base revision"
            value={selected}
            onChange={(e) => setBaseId(e.target.value)}
          >
            {candidates.map((b) => (
              <option key={b.id} value={b.batch_id}>
                {b.batch_id} — {b.status}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            disabled={!selected || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            <GitCompare className="mr-1 h-4 w-4" />
            Compare revisions
          </Button>
          {diff ? (
            <Button size="sm" variant="outline" onClick={() => setShowUnchanged((v) => !v)}>
              {showUnchanged ? "Hide unchanged" : `Show unchanged (${diff.counts.unchanged})`}
            </Button>
          ) : null}
        </div>

        {!candidates.length ? (
          <p className="text-xs text-muted-foreground">
            No other stored manifest is available to compare against yet.
          </p>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {diff ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="default">added: {diff.counts.added}</Badge>
              <Badge variant="destructive">removed: {diff.counts.removed}</Badge>
              <Badge variant="secondary">changed: {diff.counts.changed}</Badge>
              <Badge variant="outline">unchanged: {diff.counts.unchanged}</Badge>
              <Badge variant="outline">header fields: {diff.counts.header_changes}</Badge>
            </div>
            {diff.identical ? (
              <p className="text-xs text-muted-foreground">
                <span className="font-mono">{diff.base_batch_id}</span> and{" "}
                <span className="font-mono">{diff.revision_batch_id}</span> describe the same items
                and header values.
              </p>
            ) : null}

            {diff.header_changes.length ? (
              <div className="rounded-md border p-2">
                <p className="mb-1 text-xs font-medium">Batch header</p>
                <ul className="space-y-1">
                  {diff.header_changes.map((c) => (
                    <li key={c.path} className="text-xs">
                      <span className="font-mono">{c.path}</span>:{" "}
                      <span className="text-destructive line-through">{val(c.before)}</span>{" "}
                      <span aria-hidden>→</span>{" "}
                      <span className="text-foreground">{val(c.after)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="space-y-2">
              {rows.map((i) => (
                <div key={i.item_key} className="rounded-md border p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={STATUS_VARIANT[i.status]}>{i.status}</Badge>
                    <span className="font-mono text-xs">{i.item_key}</span>
                    <span className="text-xs text-muted-foreground">
                      {i.entity_kind ?? "—"} · {i.operation ?? "—"} ·{" "}
                      {i.target_stable_id ?? "unallocated"}
                    </span>
                  </div>
                  {i.changes.length ? (
                    <ul className="mt-1 space-y-1">
                      {i.changes.map((c) => (
                        <li key={c.path} className="text-xs">
                          <span className="font-mono">{c.path}</span>:{" "}
                          <span className="text-destructive line-through">{val(c.before)}</span>{" "}
                          <span aria-hidden>→</span>{" "}
                          <span className="text-foreground">{val(c.after)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
              {!rows.length ? (
                <p className="text-xs text-muted-foreground">
                  No item differences to show with the current filter.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </PersistedSection>
  );
}
