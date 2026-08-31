// Phase 4.4b — preview-first population of continuous-raceway topology.
//
// Preview writes nothing. Apply writes only the parent-raceway link, the
// position and the derived reference, and only for boxes that are still
// unlinked. Existing relationships, stable IDs and engineering values are never
// overwritten.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { pathProposalCsv } from "@/lib/electrical-raceway-path";
import {
  previewRacewayPathPopulation,
  type PathPopulationResult,
} from "@/lib/electrical-raceway-path.functions";

export function RacewayPathPopulation() {
  const run = useServerFn(previewRacewayPathPopulation);
  const qc = useQueryClient();
  const [result, setResult] = useState<PathPopulationResult | null>(null);

  const m = useMutation({
    mutationFn: (confirm: boolean) => run({ data: { jbox_ids: [], confirm } }),
    onSuccess: (r) => {
      setResult(r);
      if (r.applied) {
        toast.success(`Linked ${r.changed} junction box${r.changed === 1 ? "" : "es"}.`);
        void qc.invalidateQueries({ queryKey: ["electrical"] });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const eligible = (result?.rows ?? []).filter((r) => r.outcome === "would_change");

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Continuous raceway topology</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Proposes the parent raceway and physical position for junction boxes that are not linked
          yet. Preview first: nothing is written until you apply, and boxes that already have a
          different parent, an ambiguous path or a taken position are left untouched for manual
          review.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={m.isPending} onClick={() => m.mutate(false)}>
            Preview proposals
          </Button>
          <Button size="sm" disabled={m.isPending || !eligible.length} onClick={() => m.mutate(true)}>
            Apply {eligible.length || ""} link{eligible.length === 1 ? "" : "s"}
          </Button>
          {result?.rows.length ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const blob = new Blob([pathProposalCsv(result.rows)], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "raceway-path-proposals.csv";
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Download CSV
            </Button>
          ) : null}
        </div>

        {result ? (
          <div className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground space-y-1">
            <p>
              Read {result.diagnostics.jboxRows} junction box
              {result.diagnostics.jboxRows === 1 ? "" : "es"} ({result.diagnostics.linkedJboxes}{" "}
              already linked) and {result.diagnostics.racewayRows} raceway
              {result.diagnostics.racewayRows === 1 ? "" : "s"}.
            </p>
            <p>
              Complete read verified: {result.diagnostics.jboxRows}/
              {result.diagnostics.databaseTotals.jboxes} junction boxes and {result.diagnostics.racewayRows}/
              {result.diagnostics.databaseTotals.raceways} raceways.
            </p>
            <p>
              Resolver states:{" "}
              {Object.entries(result.diagnostics.resolutionCounts)
                .map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`)
                .join(", ")}
              .
            </p>
            {result.diagnostics.racewaysByPath.length ? (
              <p className="font-mono">
                Paths:{" "}
                {result.diagnostics.racewaysByPath
                  .map((p) => `${p.path} → ${p.raceways.join(" / ")}`)
                  .join("  •  ")}
              </p>
            ) : (
              <p>No raceway records encode a canonical CON-### path number.</p>
            )}
          </div>
        ) : null}

        {/* Per-record decisions. Shown even when nothing is eligible, so a
            junction box is never invisible in this report. */}
        {result ? (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-2">J-box</th>
                  <th className="p-2">Path</th>
                  <th className="p-2">Parent raceway UUID</th>
                  <th className="p-2">Position</th>
                  <th className="p-2">Matching raceways</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {!result.diagnostics.resolutions.length ? (
                  <tr>
                    <td colSpan={7} className="p-2 text-muted-foreground">
                      No junction-box records were visible to this account, so there is nothing to
                      resolve.
                    </td>
                  </tr>
                ) : (
                  result.diagnostics.resolutions.map((d) => (
                    <tr key={d.jbox_id} className="border-t align-top">
                      <td className="p-2 font-mono">{d.jbox_id}</td>
                      <td className="p-2 font-mono">{d.extracted_path ?? "—"}</td>
                      <td className="p-2 font-mono">{d.raceway_uuid ?? "null"}</td>
                      <td className="p-2 font-mono">{d.sequence ?? "null"}</td>
                      <td className="p-2 font-mono">
                        {d.matching_raceways.length ? d.matching_raceways.join(", ") : "none"}
                      </td>
                      <td className="p-2">
                        <Badge variant={d.status === "proposed" ? "default" : "secondary"}>
                          {d.status.replace(/_/g, " ")}
                        </Badge>
                        {d.proposed_raceway ? (
                          <span className="ml-1 font-mono text-muted-foreground">
                            → {d.proposed_raceway} / {d.proposed_sequence}
                          </span>
                        ) : null}
                      </td>
                      <td className="p-2 text-muted-foreground">{d.rejection_reason}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : null}

        {result ? (
          !result.rows.length ? null : (
            <div className="space-y-1.5">
              {result.rows.map((r) => (
                <div key={r.jbox_id} className="flex flex-wrap items-center gap-2 border-b py-1">
                  <Badge variant="outline" className="font-mono">
                    {r.jbox_id}
                  </Badge>
                  <span className="text-muted-foreground">
                    {r.current_raceway ?? "not linked"}
                    {r.current_sequence == null ? "" : ` @ ${r.current_sequence}`} →{" "}
                    {r.proposed_raceway ?? "—"}
                    {r.proposed_sequence == null ? "" : ` @ ${r.proposed_sequence}`}
                  </span>
                  <Badge
                    variant={
                      r.outcome === "applied" || r.outcome === "would_change"
                        ? "default"
                        : r.outcome === "failed" || r.outcome === "drifted"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {r.outcome.replace("_", " ")}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{r.detail ?? r.evidence}</span>
                </div>
              ))}
            </div>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
