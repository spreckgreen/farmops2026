// Phase 4.4b — Category D provenance pattern analysis panel (read-only).
//
// Presentation only: groups the immutable Category-D findings by their provenance
// deficiency before any individual adjudication happens. Nothing here
// reclassifies, resolves or writes anything.
import { useMemo, useState } from "react";
import { ChevronDown, Download } from "lucide-react";
import {
  categoryDAnalysis,
  categoryDAnalysisMarkdown,
  categoryDFindingsCsv,
  categoryDGroupsCsv,
  MISSING_PROVENANCE_LABELS,
  D_SIDE_LABELS,
  type MissingProvenance,
} from "@/lib/electrical-category-d-analysis";
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

export function CategoryDAnalysisPanel({ diag }: { diag: NumericDiagnosticsReport }) {
  const analysis = useMemo(() => categoryDAnalysis(diag), [diag]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<MissingProvenance | "all">("all");

  const groups = analysis.groups.filter(
    (g) => filter === "all" || g.missing_provenance === filter,
  );
  const kinds = (
    Object.keys(analysis.counts_by_missing_provenance) as MissingProvenance[]
  ).filter((c) => analysis.counts_by_missing_provenance[c] > 0);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-base">
          Category D provenance analysis{" "}
          <span className="text-xs font-normal text-muted-foreground">
            read-only — grouping only, no reclassification or resolution
          </span>
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              download(
                "phase-4.4b-category-d-groups.csv",
                categoryDGroupsCsv(analysis),
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
                "phase-4.4b-category-d-findings.csv",
                categoryDFindingsCsv(analysis),
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
                "phase-4.4b-category-d-analysis.md",
                categoryDAnalysisMarkdown(analysis),
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
          <Badge variant="outline">Raw D = {analysis.raw_d}</Badge>
          <Badge variant="outline">
            Resolved by adjudication = {analysis.rows_resolved_by_adjudication}
          </Badge>
          <Badge variant={analysis.rows_open ? "secondary" : "outline"}>
            Open for Phase 4.5 = {analysis.rows_open}
          </Badge>
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
          {kinds.map((c) => (
            <Badge
              key={c}
              variant={filter === c ? "default" : "secondary"}
              className="cursor-pointer"
              title={MISSING_PROVENANCE_LABELS[c]}
              onClick={() => setFilter(filter === c ? "all" : c)}
            >
              {c} {analysis.counts_by_missing_provenance[c]}
            </Badge>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Missing provenance states what evidence is owed before a finding can be adjudicated — it
          is not a disposition. Rows marked{" "}
          <code>PROVENANCE_ESTABLISHED_NO_FURTHER_EVIDENCE_REQUIRED</code> already carry a
          SHA-bound adjudication: they stay Category D in raw/historical reporting and simply owe
          nothing further. Exact source values, worksheet/row and stable IDs are preserved, bound to
          workbook SHA <code className="break-all">{analysis.ods_sha256}</code>. No schema,
          normalization, ODS or FarmOps change is made by this analysis.
        </p>


        {analysis.raw_d === 0 ? (
          <p className="text-sm text-muted-foreground">No Category-D findings in this run.</p>
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
                  <Badge variant="secondary" title={D_SIDE_LABELS[g.side]}>
                    {g.side}
                  </Badge>
                  <Badge variant="secondary" title={MISSING_PROVENANCE_LABELS[g.missing_provenance]}>
                    {g.missing_provenance}
                  </Badge>
                  <Badge variant={g.systematic ? "outline" : "destructive"}>
                    {g.systematic ? "systematic" : "individual review"}
                  </Badge>
                </button>
                {open[g.group_id] ? (
                  <div className="space-y-2 border-t p-3 text-xs">
                    <dl className="grid gap-1 sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">ODS representation</dt>
                        <dd>{g.ods_representation}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">FarmOps representation</dt>
                        <dd>{g.farmops_representation}</dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-muted-foreground">Provenance deficiency</dt>
                        <dd>{g.provenance_deficiency}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Missing provenance</dt>
                        <dd>{MISSING_PROVENANCE_LABELS[g.missing_provenance]}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Likely resolution source</dt>
                        <dd>{g.likely_resolution_source}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">ODS values</dt>
                        <dd>{g.ods_values.join(" · ") || "(blank)"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">FarmOps values</dt>
                        <dd>{g.farmops_values.join(" · ") || "(blank)"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Worksheet(s) / row(s)</dt>
                        <dd>
                          {g.source_worksheets.join(", ") || "—"}
                          {g.source_rows.length ? ` · rows ${g.source_rows.join(", ")}` : ""}
                        </dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-muted-foreground">Mapping rule</dt>
                        <dd className="font-mono break-all">{g.mapping_rule}</dd>
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
                            <th className="py-1 pr-3">Disposition</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.findings.map((f, j) => (
                            <tr key={`${f.stable_id}-${f.farmops_field}-${j}`} className="border-t">
                              <td className="py-1 pr-3 font-mono">{f.stable_id}</td>
                              <td className="py-1 pr-3">{f.ods_worksheet || "—"}</td>
                              <td className="py-1 pr-3">{f.ods_row ?? "—"}</td>
                              <td className="py-1 pr-3">
                                {f.ods_raw || <span className="text-muted-foreground">blank</span>}
                              </td>
                              <td className="py-1 pr-3">
                                {f.farmops_raw || (
                                  <span className="text-muted-foreground">not stated</span>
                                )}
                              </td>
                              <td className="py-1 pr-3">
                                <Badge variant="secondary">{f.raw_category}</Badge>
                              </td>
                              <td className="py-1 pr-3">{f.convergence_disposition}</td>
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
