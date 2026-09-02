// Phase 4.4b — Category-D resolution-source refinement panel (read-only).
//
// Presents the FarmOps zero-origin provenance question for loads.connected_va
// findings where the canonical ODS cell is blank and FarmOps holds 0. Nothing is
// written; no nonzero VA is inferred and no blank is turned into a zero.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download } from "lucide-react";
import { listConnectedVaProvenance } from "@/lib/zero-origin-provenance.functions";
import {
  zeroOriginReport,
  zeroOriginCsv,
  zeroOriginMarkdown,
  ZERO_ORIGIN_LABELS,
  ZERO_DISPOSITION_LABELS,
  NEXT_SOURCE_LABELS,
  type LoadProvenanceRow,
  type ZeroDisposition,
  type NextResolutionSource,
} from "@/lib/electrical-zero-origin-provenance";
import type { NumericDiagnosticsReport } from "@/lib/electrical-numeric-diagnostics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConnectedVaZeroGate } from "@/components/electrical/connected-va-zero-gate";

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function ZeroOriginPanel({
  diag,
  onRevalidate,
}: {
  diag: NumericDiagnosticsReport;
  onRevalidate?: () => void;
}) {
  const fetchProvenance = useServerFn(listConnectedVaProvenance);
  const { data, isLoading, error } = useQuery({
    queryKey: ["connected-va-provenance"],
    queryFn: () => fetchProvenance() as Promise<LoadProvenanceRow[]>,
  });

  const report = useMemo(
    () =>
      zeroOriginReport({
        findings: diag.findings,
        provenance: data ?? [],
        odsFileName: diag.generated_from_ods,
        odsSha256: diag.ods_sha256,
        comparedAt: diag.compared_at,
      }),
    [diag, data],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-base">
          Category D resolution-source refinement — connected VA zero origin{" "}
          <span className="text-xs font-normal text-muted-foreground">
            read-only — provenance of the FarmOps zero, not the equipment VA
          </span>
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!report.rows.length}
            onClick={() =>
              download(
                "phase-4.4b-connected-va-zero-origin.csv",
                zeroOriginCsv(report),
                "text/csv",
              )
            }
          >
            <Download className="mr-1 h-3 w-3" /> Rows CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              download(
                "phase-4.4b-connected-va-zero-origin.md",
                zeroOriginMarkdown(report),
                "text/markdown",
              )
            }
          >
            <Download className="mr-1 h-3 w-3" /> Report
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-xs">
        <p className="text-muted-foreground">
          {report.scope} The first question is whether the recorded zero was ever asserted;
          an equipment nameplate is only owed once that origin question is settled and the zero
          turns out not to be an assertion. A blank canonical cell is never read as zero and no
          nonzero connected VA is inferred. Bound to workbook SHA{" "}
          <code className="break-all">{report.ods_sha256}</code>. No FarmOps or ODS write.
        </p>

        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">Rows in scope = {report.rows.length}</Badge>
          {(Object.keys(report.counts_by_disposition) as ZeroDisposition[])
            .filter((d) => report.counts_by_disposition[d] > 0)
            .map((d) => (
              <Badge key={d} variant="secondary" title={ZERO_DISPOSITION_LABELS[d]}>
                {d} {report.counts_by_disposition[d]}
              </Badge>
            ))}
          {(Object.keys(report.counts_by_next_source) as NextResolutionSource[])
            .filter((d) => report.counts_by_next_source[d] > 0)
            .map((d) => (
              <Badge key={d} variant="outline" title={NEXT_SOURCE_LABELS[d]}>
                {d} {report.counts_by_next_source[d]}
              </Badge>
            ))}
        </div>

        {isLoading ? (
          <p className="text-muted-foreground">Reading FarmOps provenance…</p>
        ) : error ? (
          <p className="text-destructive">
            FarmOps provenance could not be read: {(error as Error).message}
          </p>
        ) : null}

        {report.rows.length === 0 ? (
          <p className="text-muted-foreground">
            No Category-D connected VA zero findings in this run.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="p-2">Stable ID</th>
                  <th className="p-2">ODS raw state</th>
                  <th className="p-2">FarmOps connected_va</th>
                  <th className="p-2">FarmOps creation / source provenance</th>
                  <th className="p-2">Zero origin</th>
                  <th className="p-2">Disposition</th>
                  <th className="p-2">Next resolution source</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={`${r.stable_id}-${r.field}`} className="border-b align-top">
                    <td className="p-2 font-medium">{r.stable_id}</td>
                    <td className="p-2">
                      {r.ods_state}
                      {r.ods_raw ? ` (${r.ods_raw})` : " (blank)"}
                    </td>
                    <td className="p-2">{r.farmops_connected_va ?? "(null)"}</td>
                    <td className="p-2 text-muted-foreground">
                      {r.farmops_provenance}
                      <ul className="mt-1 list-disc pl-4">
                        {r.evidence.map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    </td>
                    <td className="p-2" title={ZERO_ORIGIN_LABELS[r.zero_origin]}>
                      {r.zero_origin}
                    </td>
                    <td className="p-2" title={ZERO_DISPOSITION_LABELS[r.disposition]}>
                      <Badge variant="secondary">{r.disposition}</Badge>
                    </td>
                    <td
                      className="p-2"
                      title={NEXT_SOURCE_LABELS[r.next_resolution_source]}
                    >
                      {r.next_resolution_source}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ConnectedVaZeroGate onRevalidate={onRevalidate} />

        <div>
          <h4 className="mb-1 font-medium">Kept separate</h4>
          <ul className="space-y-1 text-muted-foreground">
            {report.separate_cases.map((c) => (
              <li key={`${c.stable_id}-${c.field}`}>
                <span className="font-medium text-foreground">
                  {c.stable_id} · {c.field}
                </span>{" "}
                — {c.reason} <em>Resolution source: {c.resolution_source}</em>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
