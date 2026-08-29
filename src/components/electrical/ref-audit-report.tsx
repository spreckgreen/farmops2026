// Migration audit panel: how every legacy text reference was handled when
// electrical relationships moved to database links. Read-only, downloadable as
// CSV or Markdown for the documentation record.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, FileText, RefreshCw } from "lucide-react";
import { electricalRefAudit } from "@/lib/electrical-ref-audit.functions";
import {
  refAuditToCsv,
  refAuditToMarkdown,
  type AuditDisposition,
  type RefAuditRow,
} from "@/lib/electrical-ref-audit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const DISPOSITION_LABELS: Record<AuditDisposition, string> = {
  exact_match: "Exact match",
  null_fk: "Null link",
  conflict: "Conflict",
};

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function RefAuditReport() {
  const run = useServerFn(electricalRefAudit);
  const [filter, setFilter] = useState<AuditDisposition | "actionable" | "all">("actionable");
  const q = useQuery({ queryKey: ["electrical", "ref-audit"], queryFn: () => run() });

  const rows = useMemo<RefAuditRow[]>(() => {
    const all = q.data?.rows ?? [];
    if (filter === "all") return all;
    if (filter === "actionable") {
      return all.filter((r) => r.reason !== "no_reference_present");
    }
    return all.filter((r) => r.disposition === filter);
  }, [q.data, filter]);

  const summary = q.data?.summary;
  const stamp = (q.data?.generatedAt ?? new Date().toISOString()).slice(0, 19).replace(/[:T]/g, "-");

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 pb-2">
        <div>
          <CardTitle className="text-base">Reference migration audit</CardTitle>
          <p className="text-sm text-muted-foreground">
            Every relationship slot on the electrical records, and how its legacy text
            reference was handled: linked on an exact match, left as a null link, or flagged as
            a conflict. Nothing here changes a record.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="gap-1"
            disabled={!q.data}
            onClick={() =>
              q.data &&
              download(
                `electrical-reference-audit-${stamp}.csv`,
                refAuditToCsv(q.data),
                "text/csv;charset=utf-8",
              )
            }
          >
            <Download className="h-4 w-4" />
            Download CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            disabled={!q.data}
            onClick={() =>
              q.data &&
              download(
                `electrical-reference-audit-${stamp}.md`,
                refAuditToMarkdown(q.data, q.data.generatedAt),
                "text/markdown;charset=utf-8",
              )
            }
          >
            <FileText className="h-4 w-4" />
            Download report
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            disabled={q.isFetching}
            onClick={() => void q.refetch()}
          >
            <RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />
            Re-run
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : q.error ? (
          <p className="text-sm text-destructive">{(q.error as Error).message}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="secondary">{summary?.total ?? 0} slots audited</Badge>
              <Badge variant="outline">{summary?.exact_match ?? 0} exact match</Badge>
              <Badge variant="outline">{summary?.null_fk ?? 0} null link</Badge>
              <Badge variant={summary?.conflict ? "destructive" : "outline"}>
                {summary?.conflict ?? 0} conflicts
              </Badge>
            </div>

            <div className="flex flex-wrap gap-2">
              {(["actionable", "conflict", "null_fk", "exact_match", "all"] as const).map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={filter === f ? "default" : "outline"}
                  onClick={() => setFilter(f)}
                >
                  {f === "actionable"
                    ? "Needs review"
                    : f === "all"
                      ? "Everything"
                      : DISPOSITION_LABELS[f]}
                </Button>
              ))}
            </div>

            {!rows.length ? (
              <p className="text-sm text-muted-foreground">
                No reference slots match this filter.
              </p>
            ) : (
              <div className="max-h-[28rem] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/90 text-left">
                    <tr>
                      <th className="px-2 py-1 font-medium">Record</th>
                      <th className="px-2 py-1 font-medium">Relationship</th>
                      <th className="px-2 py-1 font-medium">Reference</th>
                      <th className="px-2 py-1 font-medium">Linked</th>
                      <th className="px-2 py-1 font-medium">Handling</th>
                      <th className="px-2 py-1 font-medium">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr
                        key={`${r.id}-${r.fkColumn}-${i}`}
                        className="border-t border-border align-top"
                      >
                        <td className="px-2 py-1 font-mono whitespace-nowrap">
                          {r.stableId || "(no ID)"}
                          <span className="ml-1 font-sans text-muted-foreground">{r.kind}</span>
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap text-muted-foreground">
                          {r.fkColumn}
                        </td>
                        <td className="px-2 py-1 font-mono">{r.reference || "—"}</td>
                        <td className="px-2 py-1 font-mono">{r.fkTarget || "—"}</td>
                        <td className="px-2 py-1">
                          <Badge
                            variant={
                              r.disposition === "conflict"
                                ? "destructive"
                                : r.disposition === "exact_match"
                                  ? "outline"
                                  : "secondary"
                            }
                          >
                            {DISPOSITION_LABELS[r.disposition]}
                          </Badge>
                        </td>
                        <td className="px-2 py-1 text-muted-foreground">{r.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
