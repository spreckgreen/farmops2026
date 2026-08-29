// Load_Master field-by-field comparison. Read-only: FarmOps is not the
// authority for engineering values, so mismatches are reported for review and
// released through the ODS import — never written from this panel.
import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import {
  compareLoadMaster,
  type LoadComparePayload,
} from "@/lib/electrical-load-compare.functions";
import {
  loadCompareCsv,
  loadCompareMarkdown,
  type CompareVerdict,
} from "@/lib/electrical-load-compare";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

const VERDICT_LABEL: Record<CompareVerdict, string> = {
  match: "Matches",
  mismatch: "Different value",
  farmops_blank: "Blank in FarmOps",
  ods_blank: "Blank in workbook",
  invalid_ods_value: "Invalid workbook value",
};

type Filter = "all" | "mismatch" | "engineering";

export function LoadCompareReport() {
  const compare = useServerFn(compareLoadMaster);
  const fileRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<LoadComparePayload | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const run = useMutation({
    mutationFn: async (file: File) =>
      compare({ data: { file_name: file.name, base64: await readAsBase64(file) } }),
    onSuccess: (r) => {
      setReport(r);
      toast.success(
        `Compared ${r.odsRowCount} workbook load(s) against ${r.farmOpsRowCount} FarmOps load(s): ${r.cells.length} field difference(s).`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo(() => {
    const all = report?.cells ?? [];
    if (filter === "mismatch") return all.filter((c) => c.verdict === "mismatch");
    if (filter === "engineering") return all.filter((c) => c.engineering);
    return all;
  }, [report, filter]);

  const stamp = (report?.generatedAt ?? new Date().toISOString())
    .slice(0, 19)
    .replace(/[:T]/g, "-");

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 pb-2">
        <div>
          <CardTitle className="text-base">Load_Master field-by-field comparison</CardTitle>
          <p className="text-sm text-muted-foreground">
            Select the canonical workbook to compare every ODS-owned Load field against FarmOps.
            Nothing is written: Grid has its own targeted correction above, and every other
            engineering value is released through the reviewed ODS import.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".ods,application/vnd.oasis.opendocument.spreadsheet"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) run.mutate(f);
              e.target.value = "";
            }}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={run.isPending}
          >
            <FileSpreadsheet className="h-4 w-4 mr-1" />
            {run.isPending ? "Comparing…" : "Choose .ods"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!report}
            onClick={() =>
              report &&
              download(`load-master-comparison-${stamp}.csv`, loadCompareCsv(report), "text/csv")
            }
          >
            <Download className="h-4 w-4 mr-1" />
            CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!report}
            onClick={() =>
              report &&
              download(
                `load-master-comparison-${stamp}.md`,
                loadCompareMarkdown(report),
                "text/markdown",
              )
            }
          >
            <Download className="h-4 w-4 mr-1" />
            Markdown
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!report ? (
          <p className="text-sm text-muted-foreground">
            No comparison yet. The workbook is read only — FarmOps never writes back to
            PremoFarmElectrical.ods.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">
                {report.sheetName} · {report.comparedFields.length} fields compared
              </Badge>
              <Badge variant={report.counts.mismatch ? "destructive" : "outline"}>
                {report.counts.mismatch} different
              </Badge>
              <Badge variant="outline">{report.counts.farmops_blank} blank in FarmOps</Badge>
              <Badge variant="outline">{report.counts.ods_blank} blank in workbook</Badge>
              <Badge variant={report.counts.invalid_ods_value ? "destructive" : "outline"}>
                {report.counts.invalid_ods_value} invalid workbook values
              </Badge>
              <Badge variant="outline">{report.counts.match} matching fields</Badge>
            </div>

            {(report.missingInFarmOps.length ||
              report.missingInOds.length ||
              report.duplicateOdsIds.length) > 0 ? (
              <div className="rounded-md border border-border p-2 text-xs space-y-1">
                {report.missingInFarmOps.length ? (
                  <div>
                    In workbook only: <span className="font-mono">{report.missingInFarmOps.join(", ")}</span>
                  </div>
                ) : null}
                {report.missingInOds.length ? (
                  <div>
                    In FarmOps only: <span className="font-mono">{report.missingInOds.join(", ")}</span>
                  </div>
                ) : null}
                {report.duplicateOdsIds.length ? (
                  <div>
                    Duplicated in workbook:{" "}
                    <span className="font-mono">{report.duplicateOdsIds.join(", ")}</span>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex gap-2">
              {(["all", "mismatch", "engineering"] as Filter[]).map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={filter === f ? "default" : "outline"}
                  onClick={() => setFilter(f)}
                >
                  {f === "all"
                    ? `All differences (${report.cells.length})`
                    : f === "mismatch"
                      ? `Conflicting (${report.counts.mismatch})`
                      : "Engineering fields"}
                </Button>
              ))}
            </div>

            {rows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th className="py-1 pr-3">Load ID</th>
                      <th className="py-1 pr-3">Field</th>
                      <th className="py-1 pr-3">Owner</th>
                      <th className="py-1 pr-3">Load_Master</th>
                      <th className="py-1 pr-3">FarmOps</th>
                      <th className="py-1 pr-3">Verdict</th>
                      <th className="py-1">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c, i) => (
                      <tr key={`${c.loadId}-${c.field}-${i}`} className="border-t border-border">
                        <td className="py-1 pr-3 font-mono">{c.loadId}</td>
                        <td className="py-1 pr-3">{c.label}</td>
                        <td className="py-1 pr-3">{c.engineering ? "engineering" : "descriptive"}</td>
                        <td className="py-1 pr-3 font-mono">{c.ods || "—"}</td>
                        <td className="py-1 pr-3 font-mono">{c.farmops || "—"}</td>
                        <td className="py-1 pr-3">{VERDICT_LABEL[c.verdict]}</td>
                        <td className="py-1 text-muted-foreground">{c.reason ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Every compared field agrees with the workbook.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
