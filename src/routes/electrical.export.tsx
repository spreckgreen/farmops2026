import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { electricalSnapshot } from "@/lib/electrical-snapshot.functions";
import {
  SNAPSHOT_COLLECTIONS,
  SNAPSHOT_SCHEMA_VERSION,
  serializeSnapshot,
  snapshotFilename,
  type ElectricalSnapshot,
} from "@/lib/electrical-snapshot";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/electrical/export")({
  component: ExportPage,
  head: () => ({
    meta: [
      { title: "Electrical Reconciliation Export — Bostead Farms" },
      {
        name: "description",
        content:
          "Download the deterministic, read-only electrical as-built snapshot used to reconcile FarmOps field records against the engineering workbook.",
      },
      { property: "og:title", content: "Electrical Reconciliation Export — Bostead Farms" },
      {
        property: "og:description",
        content: "Read-only versioned electrical snapshot for external reconciliation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function ExportPage() {
  return (
    <ElectricalGate>
      <SnapshotExport />
    </ElectricalGate>
  );
}

function download(snapshot: ElectricalSnapshot) {
  const blob = new Blob([serializeSnapshot(snapshot)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = snapshotFilename(snapshot.generated_at);
  a.click();
  URL.revokeObjectURL(url);
}

function SnapshotExport() {
  const fetcher = useServerFn(electricalSnapshot);
  const q = useQuery({
    queryKey: ["electrical", "snapshot"],
    queryFn: () => fetcher() as unknown as Promise<ElectricalSnapshot>,
  });
  const snapshot = q.data;

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Reconciliation snapshot{" "}
            <Badge variant="secondary" className="ml-1 font-mono">
              v{SNAPSHOT_SCHEMA_VERSION}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            A deterministic, read-only export of the electrical records for the external
            BosteadFarmsBuildDocs reconciler. FarmOps is the authority for as-installed field
            data; <span className="font-mono">PremoFarmElectrical.ods</span> remains the
            engineering system of record and is never written by this app.
          </p>
          <p>
            Every relationship is exported as an explicit UUID plus stable ID pair. Missing
            topology stays <span className="font-mono">null</span> — nothing is guessed.
          </p>
          <p>
            Machine endpoint:{" "}
            <span className="font-mono text-foreground">GET /api/electrical/snapshot</span> with{" "}
            <span className="font-mono">Authorization: Bearer &lt;access_token&gt;</span>.
          </p>
          <div className="flex gap-2">
            <Button
              onClick={() => snapshot && download(snapshot)}
              disabled={!snapshot || q.isFetching}
            >
              Download JSON snapshot
            </Button>
            <Button variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
              Regenerate
            </Button>
          </div>
          {q.error ? (
            <p className="text-destructive">
              Couldn&apos;t build the snapshot: {(q.error as Error).message}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Contents</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {q.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : snapshot ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {SNAPSHOT_COLLECTIONS.map((c) => (
                  <div key={c} className="rounded-md border p-2">
                    <div className="font-mono text-xs text-muted-foreground">{c}</div>
                    <div className="text-lg">{snapshot.counts[c]}</div>
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground">
                Generated <span className="font-mono">{snapshot.generated_at}</span> · QA{" "}
                {snapshot.qa.errors} error{snapshot.qa.errors === 1 ? "" : "s"},{" "}
                {snapshot.qa.warnings} warning{snapshot.qa.warnings === 1 ? "" : "s"} (reported,
                not blocking).
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground">No snapshot generated yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
