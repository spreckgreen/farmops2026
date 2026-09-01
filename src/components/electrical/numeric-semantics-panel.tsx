// Phase 4.4b — numeric semantics diagnostics panel (read-only).
//
// Displays the numeric field registry (with ownership), the category A–D
// findings and the preview-only correction plan. There is no apply button:
// this phase performs no production writes and never writes the canonical ODS.
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import {
  numericDiagnostics,
  numericFindingsCsv,
  numericRegistryCsv,
  numericDiagnosticsMarkdown,
  numericReconciliation,
  NUMERIC_ARTIFACT_LABELS,
  type NumericCategory,
} from "@/lib/electrical-numeric-diagnostics";
import type { ValidationReport } from "@/lib/electrical-parallel-validation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const CATEGORY_LABELS: Record<NumericCategory, string> = {
  A: "A — implementation artifact (schema default)",
  B: "B — engineering disagreement",
  C: "C — not representable as a number",
  D: "D — provenance insufficient",
  E: "E — representation / schema-semantic gap (system voltage)",
};

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function NumericSemanticsPanel({ report }: { report: ValidationReport }) {
  const diag = useMemo(() => numericDiagnostics(report), [report]);
  const recon = useMemo(() => numericReconciliation(diag), [diag]);
  const [category, setCategory] = useState<NumericCategory | "all">("all");
  const [showRegistry, setShowRegistry] = useState(false);

  const rows = diag.findings.filter((f) => category === "all" || f.category === category);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-base">
          Numeric semantics diagnostics{" "}
          <span className="text-xs font-normal text-muted-foreground">
            preview only — no writes
          </span>
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              download("phase-4.4b-numeric-registry.csv", numericRegistryCsv(diag), "text/csv")
            }
          >
            <Download className="mr-1 h-3 w-3" /> Registry CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              download("phase-4.4b-numeric-findings.csv", numericFindingsCsv(diag), "text/csv")
            }
          >
            <Download className="mr-1 h-3 w-3" /> Findings CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              download(
                "phase-4.4b-numeric-diagnostics.md",
                numericDiagnosticsMarkdown(diag),
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
          <Badge variant="outline">Compared cells {diag.compared_cells}</Badge>
          <Badge variant="outline">Agreements {diag.agreements}</Badge>
          {(["A", "B", "C", "D", "E"] as NumericCategory[]).map((c) => (
            <Badge
              key={c}
              variant={category === c ? "default" : "secondary"}
              className="cursor-pointer"
              onClick={() => setCategory(category === c ? "all" : c)}
            >
              {c} {diag.counts_by_category[c]}
            </Badge>
          ))}
          <Badge variant="outline">Correctable {diag.plan.length}</Badge>
          <Badge variant="outline">Blocked (NOT NULL) {diag.blocked.length}</Badge>
        </div>

        <p className="text-xs text-muted-foreground">
          {recon.balanced && recon.category_a_balanced
            ? `Reconciled: ${recon.agreements} agreements + ${recon.categorized} categorized = ${recon.compared_cells} compared cells; category A = ${recon.plan} correctable + ${recon.blocked} blocked.`
            : "Reconciliation arithmetic does not balance — investigate before acting on this report."}{" "}
          Canonical system-voltage notation such as 120/240 is reported as
          category E — a representation gap in the FarmOps scalar column, not a
          failed numeric parse and not a Category-C unresolved value. It is
          never normalized to 240 and the canonical ODS is never edited to suit
          the column.{" "}
          Ownership decides eligibility: only canonical engineering-owned numeric
          fields are compared. Field observations, derived values, structural
          ordinals and FarmOps-native infrastructure are excluded by rule.
        </p>

        {diag.findings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No numeric differences found in the compared engineering fields.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Cat</th>
                  <th className="py-1 pr-3">Entity</th>
                  <th className="py-1 pr-3">Stable ID</th>
                  <th className="py-1 pr-3">Field</th>
                  <th className="py-1 pr-3">ODS</th>
                  <th className="py-1 pr-3">FarmOps</th>
                  <th className="py-1 pr-3">Δ</th>
                  <th className="py-1 pr-3">Disposition</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 300).map((f, i) => (
                  <tr key={`${f.domain}-${f.stable_id}-${f.farmops_field}-${i}`} className="border-t">
                    <td className="py-1 pr-3">
                      <Badge variant="secondary">{f.category}</Badge>
                    </td>
                    <td className="py-1 pr-3">{f.domain}</td>
                    <td className="py-1 pr-3 font-mono">{f.stable_id}</td>
                    <td className="py-1 pr-3">
                      {f.label}
                      <span className="ml-1 text-muted-foreground">({f.unit})</span>
                    </td>
                    <td className="py-1 pr-3">
                      {f.ods_raw || <span className="text-muted-foreground">not stated</span>}
                      {f.ods_state !== "value" && f.ods_state !== "absent" ? (
                        <span className="ml-1 text-muted-foreground">[{f.ods_state}]</span>
                      ) : null}
                      {f.ods_row ? (
                        <span className="ml-1 text-muted-foreground">row {f.ods_row}</span>
                      ) : null}
                    </td>
                    <td className="py-1 pr-3">
                      {f.farmops_raw || <span className="text-muted-foreground">not stated</span>}
                    </td>
                    <td className="py-1 pr-3">{f.delta === null ? "—" : f.delta}</td>
                    <td className="py-1 pr-3 text-muted-foreground">
                      {f.artifact_type ? `${NUMERIC_ARTIFACT_LABELS[f.artifact_type]} · ` : ""}
                      {f.proposed_action}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 300 ? (
              <p className="pt-2 text-xs text-muted-foreground">
                Showing the first 300 of {rows.length} rows — export the CSV for the full set.
              </p>
            ) : null}
          </div>
        )}

        <div>
          <Button size="sm" variant="ghost" onClick={() => setShowRegistry((v) => !v)}>
            {showRegistry ? "Hide" : "Show"} numeric field registry ({diag.registry.length} fields,{" "}
            {diag.registry.filter((e) => e.comparable).length} compared)
          </Button>
          {showRegistry ? (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">Table</th>
                    <th className="py-1 pr-3">Field</th>
                    <th className="py-1 pr-3">Unit</th>
                    <th className="py-1 pr-3">DB</th>
                    <th className="py-1 pr-3">Ownership</th>
                    <th className="py-1 pr-3">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {diag.registry.map((e) => (
                    <tr key={`${e.table}.${e.field}`} className="border-t">
                      <td className="py-1 pr-3 font-mono">{e.table}</td>
                      <td className="py-1 pr-3 font-mono">{e.field}</td>
                      <td className="py-1 pr-3">{e.unit}</td>
                      <td className="py-1 pr-3 text-muted-foreground">
                        {e.db_type}
                        {e.nullable ? "" : " NOT NULL"}
                        {e.db_default ? ` DEFAULT ${e.db_default}` : ""}
                      </td>
                      <td className="py-1 pr-3">
                        <Badge variant={e.comparable ? "default" : "secondary"}>{e.ownership}</Badge>
                      </td>
                      <td className="py-1 pr-3 text-muted-foreground">{e.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="pt-2 text-xs text-muted-foreground">
                Numeric columns outside the compared entities (breaker positions,
                field observations, panel exits, raceway waypoints, service and
                intertie configuration revisions) are excluded deliberately and
                listed in the exported registry report.
              </p>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
