// Phase 4.4b — Category C pattern analysis panel (read-only).
//
// Presentation only: groups the immutable Category-C findings so a reader can
// tell whether C is many engineering decisions or a few systematic modeling
// gaps. Nothing here reclassifies a finding or writes anything.
import { useMemo, useState } from "react";
import { ChevronDown, Download } from "lucide-react";
import {
  categoryCAnalysis,
  categoryCAnalysisMarkdown,
  categoryCFindingsCsv,
  categoryCGroupsCsv,
  CATEGORY_C_CAUSE_LABELS,
  ODS_PATTERN_LABELS,
  type CategoryCLikelyCause,
} from "@/lib/electrical-category-c-analysis";
import type { NumericDiagnosticsReport } from "@/lib/electrical-numeric-diagnostics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function CategoryCAnalysisPanel({ diag }: { diag: NumericDiagnosticsReport }) {
  const analysis = useMemo(() => categoryCAnalysis(diag), [diag]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [cause, setCause] = useState<CategoryCLikelyCause | "all">("all");

  const groups = analysis.groups.filter((g) => cause === "all" || g.likely_cause === cause);
  const causes = (Object.keys(analysis.counts_by_cause) as CategoryCLikelyCause[]).filter(
    (c) => analysis.counts_by_cause[c] > 0,
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-base">
          Category C pattern analysis{" "}
          <span className="text-xs font-normal text-muted-foreground">
            read-only — no reclassification, no schema, no writes
          </span>
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              download(
                "phase-4.4b-category-c-groups.csv",
                categoryCGroupsCsv(analysis),
                "text/csv",
              )
            }
          >
            <Download className="mr-1 h-3 w-3" /> Groups CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              download(
                "phase-4.4b-category-c-findings.csv",
                categoryCFindingsCsv(analysis),
                "text/csv",
              )
            }
          >
            <Download className="mr-1 h-3 w-3" /> Findings CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              download(
                "phase-4.4b-category-c-analysis.md",
                categoryCAnalysisMarkdown(analysis),
                "text/markdown",
              )
            }
          >
            <Download className="mr-1 h-3 w-3" /> Report
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">Raw C = {analysis.raw_c}</Badge>
          <Badge variant="outline">
            Systematic groups = {analysis.systematic_groups_count}
          </Badge>
          <Badge variant="outline">
            Explained by systematic groups = {analysis.rows_explained_by_systematic_pattern}
          </Badge>
          <Badge variant={analysis.rows_requiring_individual_review ? "destructive" : "outline"}>
            Requiring individual review = {analysis.rows_requiring_individual_review}
          </Badge>
          <Badge variant="secondary">Total groups {analysis.groups_count}</Badge>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          {causes.map((c) => (
            <Badge
              key={c}
              variant={cause === c ? "default" : "secondary"}
              className="cursor-pointer"
              title={CATEGORY_C_CAUSE_LABELS[c]}
              onClick={() => setCause(cause === c ? "all" : c)}
            >
              {c} {analysis.counts_by_cause[c]}
            </Badge>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Likely cause is a hypothesis about the shape of the work, not a disposition: every row
          below is still Category C. Groups stay bound to workbook SHA{" "}
          <code className="break-all">{analysis.ods_sha256}</code> so a future adjudication applies
          to this baseline only. No mapping or normalization rule is added by this analysis.
        </p>

        {analysis.raw_c === 0 ? (
          <p className="text-sm text-muted-foreground">No Category-C findings in this run.</p>
        ) : (
          <div className="space-y-2">
            {groups.map((g, i) => (
              <div key={g.group_id} className="rounded-md border">
                <button
                  type="button"
                  aria-expanded={Boolean(open[g.group_id])}
                  onClick={() => setOpen((o) => ({ ...o, [g.group_id]: !o[g.group_id] }))}
                  className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-xs"
                >
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                      open[g.group_id] ? "" : "-rotate-90",
                    )}
                  />
                  <span className="font-medium">
                    {i + 1}. {g.entity_type} · {g.field}
                  </span>
                  <Badge variant="outline">{g.count} rows</Badge>
                  <Badge variant="secondary" title={ODS_PATTERN_LABELS[g.ods_pattern]}>
                    {g.ods_pattern}
                  </Badge>
                  <Badge variant="outline">FarmOps {g.farmops_state}</Badge>
                  <Badge variant="secondary" title={CATEGORY_C_CAUSE_LABELS[g.likely_cause]}>
                    {g.likely_cause}
                  </Badge>
                  <Badge variant={g.systematic ? "outline" : "destructive"}>
                    {g.systematic ? "systematic" : "individual review"}
                  </Badge>
                </button>
                {open[g.group_id] ? (
                  <div className="space-y-2 border-t p-3 text-xs">
                    <dl className="grid gap-1 sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">C reason (parser state)</dt>
                        <dd>{g.c_reason}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Source worksheet(s)</dt>
                        <dd>{g.source_worksheets.join(", ") || "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Mapping rule</dt>
                        <dd className="font-mono break-all">{g.mapping_rule}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Normalization rule</dt>
                        <dd>{g.normalization_rule}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Representative ODS values</dt>
                        <dd>{g.representative_ods_values.join(" · ") || "(blank)"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Representative FarmOps values</dt>
                        <dd>{g.representative_farmops_values.join(" · ")}</dd>
                      </div>
                    </dl>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-left text-muted-foreground">
                          <tr>
                            <th className="py-1 pr-3">Stable ID</th>
                            <th className="py-1 pr-3">Worksheet</th>
                            <th className="py-1 pr-3">Row</th>
                            <th className="py-1 pr-3">ODS value</th>
                            <th className="py-1 pr-3">FarmOps value</th>
                            <th className="py-1 pr-3">Raw category</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.findings.map((f, j) => (
                            <tr key={`${f.stable_id}-${f.farmops_field}-${j}`} className="border-t">
                              <td className="py-1 pr-3 font-mono">{f.stable_id}</td>
                              <td className="py-1 pr-3">{f.ods_worksheet || "—"}</td>
                              <td className="py-1 pr-3">{f.ods_row ?? "—"}</td>
                              <td className="py-1 pr-3">{f.ods_raw || "(blank)"}</td>
                              <td className="py-1 pr-3">
                                {f.farmops_raw || (
                                  <span className="text-muted-foreground">not stated</span>
                                )}
                              </td>
                              <td className="py-1 pr-3">
                                <Badge variant="secondary">{f.raw_category}</Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
