// Phase 4.4b — convergence accounting panel (read-only).
//
// Presentation only. Shows the raw comparison, adjudication and Phase 4.5
// disposition as three separate columns so "adjudicated" is never read as
// "resolved", and names every member of the current-semantics-unresolved set.
import { useMemo } from "react";
import { Download } from "lucide-react";
import {
  convergenceAccounting,
  convergenceAccountingCsv,
  convergenceAccountingMarkdown,
  UNRESOLVED_REASON_LABELS,
} from "@/lib/electrical-convergence-accounting";
import type { NumericDiagnosticsReport } from "@/lib/electrical-numeric-diagnostics";
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

export function ConvergenceAccountingPanel({ diag }: { diag: NumericDiagnosticsReport }) {
  const acc = useMemo(() => convergenceAccounting(diag), [diag]);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-base">
          Convergence accounting{" "}
          <span className="text-xs font-normal text-muted-foreground">
            read-only — three distinct layers, no counts adjusted
          </span>
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              download(
                "phase-4.4b-convergence-accounting.csv",
                convergenceAccountingCsv(acc),
                "text/csv",
              )
            }
          >
            <Download className="mr-1 h-3 w-3" /> Accounting CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              download(
                "phase-4.4b-convergence-accounting.md",
                convergenceAccountingMarkdown(acc),
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
          <Badge variant="outline">Raw B {acc.raw_b}</Badge>
          <Badge variant="outline">Adjudicated B {acc.adjudicated_b}</Badge>
          <Badge variant={acc.unresolved_b ? "destructive" : "outline"}>
            Unresolved B (Phase 4.5) {acc.unresolved_b}
          </Badge>
          <Badge variant="outline">Closed B {acc.closed_b}</Badge>
          <Badge variant="outline">
            Current semantics unresolved {acc.current_semantics_unresolved}
          </Badge>
        </div>

        <p className="text-xs text-muted-foreground">
          Adjudicated is not resolved. All {acc.raw_b} raw-B findings carry an adjudication record,
          yet {acc.unresolved_b} remain Phase 4.5 blockers because their adjudications state that
          the electrical meaning of the source field is not established. The raw comparison layer,
          the adjudication layer and the Phase 4.5 disposition layer are reported separately and
          none of them is rewritten to make the other two reconcile.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">stable_id</th>
                <th className="py-1 pr-3">field</th>
                <th className="py-1 pr-3">raw_category</th>
                <th className="py-1 pr-3">adjudication</th>
                <th className="py-1 pr-3">disposition</th>
                <th className="py-1 pr-3">unresolved for 4.5</th>
                <th className="py-1 pr-3">unresolved_reason</th>
              </tr>
            </thead>
            <tbody>
              {acc.category_b_rows.map((r) => (
                <tr key={`${r.stable_id}-${r.field}`} className="border-t align-top">
                  <td className="py-1 pr-3 font-mono">{r.stable_id}</td>
                  <td className="py-1 pr-3 font-mono">{r.field}</td>
                  <td className="py-1 pr-3">
                    <Badge variant="secondary">{r.raw_category}</Badge>
                  </td>
                  <td className="py-1 pr-3 font-mono text-muted-foreground">{r.adjudication}</td>
                  <td className="py-1 pr-3">{r.disposition_label}</td>
                  <td className="py-1 pr-3">
                    <Badge variant={r.unresolved_for_phase_4_5 ? "destructive" : "outline"}>
                      {r.unresolved_for_phase_4_5 ? "yes" : "no"}
                    </Badge>
                  </td>
                  <td className="py-1 pr-3 text-muted-foreground">
                    <span className="font-mono">{r.unresolved_reason}</span>
                    <div className="mt-1">{UNRESOLVED_REASON_LABELS[r.unresolved_reason]}</div>
                    {r.preserved.length ? (
                      <ul className="mt-1 list-disc pl-4">
                        {r.preserved.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                </tr>
              ))}
              {acc.category_b_rows.length === 0 ? (
                <tr>
                  <td className="py-2 text-muted-foreground" colSpan={7}>
                    No raw Category-B findings in this run.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="rounded-md border p-3">
          <p className="text-sm font-medium">
            Current semantics unresolved — full membership (
            {acc.current_semantics_unresolved})
          </p>
          <p className="pt-1 text-xs text-muted-foreground">
            Beyond the three established Bryant amperage findings,{" "}
            {acc.current_semantics_beyond_bryant_amperage.length === 0
              ? "no further rows contribute."
              : `${acc.current_semantics_beyond_bryant_amperage
                  .map((e) => `${e.stable_id}.${e.field}`)
                  .join(", ")} also carries this disposition.`}
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">stable_id</th>
                  <th className="py-1 pr-3">field</th>
                  <th className="py-1 pr-3">raw_category</th>
                  <th className="py-1 pr-3">adjudication</th>
                  <th className="py-1 pr-3">inclusion basis</th>
                </tr>
              </thead>
              <tbody>
                {acc.current_semantics_rows.map((r) => (
                  <tr key={`cs-${r.stable_id}-${r.field}`} className="border-t align-top">
                    <td className="py-1 pr-3 font-mono">{r.stable_id}</td>
                    <td className="py-1 pr-3 font-mono">{r.field}</td>
                    <td className="py-1 pr-3">
                      <Badge variant="secondary">{r.raw_category}</Badge>
                    </td>
                    <td className="py-1 pr-3 font-mono text-muted-foreground">{r.adjudication}</td>
                    <td className="py-1 pr-3 text-muted-foreground">
                      {r.expected_bryant_amperage ? null : (
                        <Badge variant="outline" className="mr-1">
                          fourth / propagated
                        </Badge>
                      )}
                      {r.inclusion_basis}
                    </td>
                  </tr>
                ))}
                {acc.current_semantics_rows.length === 0 ? (
                  <tr>
                    <td className="py-2 text-muted-foreground" colSpan={5}>
                      No findings carry the current-semantics-unresolved disposition.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {acc.reconciliation_notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
