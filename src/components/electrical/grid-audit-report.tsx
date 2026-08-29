// Grid QA report: canonical ODS Grid vs FarmOps Grid for every load, with a
// Grid-only correction action. Grid is ODS engineering-owned, so this panel
// never touches any other column and never invents a coordinate.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, RefreshCw, Wand2 } from "lucide-react";
import { toast } from "sonner";
import {
  applyGridCorrections,
  electricalGridAudit,
} from "@/lib/electrical-grid.functions";
import { gridAuditCsv, type GridAuditRow } from "@/lib/electrical-grid";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

type Filter = "problems" | "all";

export function GridAuditReport() {
  const run = useServerFn(electricalGridAudit);
  const apply = useServerFn(applyGridCorrections);
  const [filter, setFilter] = useState<Filter>("problems");
  const q = useQuery({ queryKey: ["electrical", "grid-audit"], queryFn: () => run({ data: {} }) });

  const rows = useMemo<GridAuditRow[]>(() => {
    const all = q.data?.rows ?? [];
    return filter === "all" ? all : all.filter((r) => r.action !== "ok");
  }, [q.data, filter]);

  const fix = useMutation({
    mutationFn: async () => {
      const pending = (q.data?.rows ?? []).filter((r) => r.action === "correct" || r.action === "clear");
      if (!pending.length) return { updated: 0, errors: [] as { load_id: string; message: string }[] };
      return apply({ data: { rows: pending.map((r) => ({ load_id: r.load_id, grid: r.corrected_grid })) } });
    },
    onSuccess: (res) => {
      toast.success(`Grid corrected on ${res.updated} load(s).`);
      if (res.errors.length) toast.error(`${res.errors.length} load(s) could not be corrected.`);
      void q.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const summary = q.data?.summary;
  const stamp = (q.data?.generatedAt ?? new Date().toISOString()).slice(0, 19).replace(/[:T]/g, "-");
  const pending = (summary?.correct ?? 0) + (summary?.clear ?? 0);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 pb-2">
        <div>
          <CardTitle className="text-base">Grid field audit</CardTitle>
          <p className="text-sm text-muted-foreground">
            Grid is owned by the canonical electrical ODS. This compares every load&apos;s stored
            Grid against the grid-coordinate convention (A6 is the Farm Shop NE corner) and lists
            values that drifted in from other columns — percents, ratings, notes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            disabled={!q.data}
            onClick={() =>
              q.data &&
              download(`electrical-grid-audit-${stamp}.csv`, gridAuditCsv(q.data), "text/csv;charset=utf-8")
            }
          >
            <Download className="h-4 w-4" />
            Download CSV
          </Button>
          <Button
            size="sm"
            className="gap-1"
            disabled={!pending || fix.isPending}
            onClick={() => fix.mutate()}
          >
            <Wand2 className="h-4 w-4" />
            Correct Grid ({pending})
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() => void q.refetch()}
            disabled={q.isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />
            Re-run
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : q.error ? (
          <p className="text-sm text-destructive">{(q.error as Error).message}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline">{summary?.total ?? 0} loads</Badge>
              <Badge variant="secondary">{summary?.ok ?? 0} already correct</Badge>
              <Badge variant={summary?.correct ? "default" : "outline"}>
                {summary?.correct ?? 0} to correct
              </Badge>
              <Badge variant={summary?.clear ? "destructive" : "outline"}>
                {summary?.clear ?? 0} invalid to clear
              </Badge>
              <Badge variant="outline">{summary?.unresolved ?? 0} unresolved</Badge>
              <Button variant="ghost" size="sm" onClick={() => setFilter(filter === "all" ? "problems" : "all")}>
                {filter === "all" ? "Show problems only" : "Show all loads"}
              </Button>
            </div>
            {!q.data?.odsSupplied ? (
              <p className="text-xs text-muted-foreground">
                No workbook Grid values supplied in this run, so the ODS Grid column is blank and
                corrections are limited to rejecting values that cannot be a grid coordinate.
                Run an ODS dry run on the import page to compare against Load_Master.Grid.
              </p>
            ) : null}

            {!rows.length ? (
              <p className="text-sm text-muted-foreground">Every Grid value matches the convention.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3">Load ID</th>
                      <th className="py-1 pr-3">ODS Grid</th>
                      <th className="py-1 pr-3">Previous</th>
                      <th className="py-1 pr-3">Corrected</th>
                      <th className="py-1 pr-3">Action</th>
                      <th className="py-1">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.load_id} className="border-t border-border">
                        <td className="py-1 pr-3 font-mono">{r.load_id}</td>
                        <td className="py-1 pr-3 font-mono">{r.ods_grid ?? "—"}</td>
                        <td className="py-1 pr-3 font-mono">{r.previous_grid ?? "—"}</td>
                        <td className="py-1 pr-3 font-mono">{r.corrected_grid ?? "(blank)"}</td>
                        <td className="py-1 pr-3">
                          <Badge variant={r.action === "clear" ? "destructive" : "secondary"}>
                            {r.action}
                          </Badge>
                        </td>
                        <td className="py-1 text-muted-foreground">{r.reason ?? ""}</td>
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
