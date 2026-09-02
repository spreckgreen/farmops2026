// Phase 4.4b — Demand VA placeholder semantic adjudication panel (read-only).
//
// Presentation only. Distinct source tokens are never collapsed, text is never
// shown as zero, and there is no apply button: no ODS change, no FarmOps write,
// no schema change.
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import {
  demandVaPlaceholderAdjudication,
  demandVaPlaceholderMarkdown,
  demandVaFindingsCsv,
  demandVaTokensCsv,
  DEMAND_VA_ADJUDICATION_LABELS,
  DEMAND_VA_STATE_LABELS,
} from "@/lib/electrical-demand-va-placeholder";
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

export function DemandVaPlaceholderPanel({ diag }: { diag: NumericDiagnosticsReport }) {
  const a = useMemo(() => demandVaPlaceholderAdjudication(diag), [diag]);
  const [showRows, setShowRows] = useState(false);

  if (a.in_scope === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-base">
          Demand VA placeholder semantic adjudication{" "}
          <span className="text-xs font-normal text-muted-foreground">
            read-only — no ODS change, no FarmOps write, no schema change
          </span>
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              download("phase-4.4b-demand-va-tokens.csv", demandVaTokensCsv(a), "text/csv")
            }
          >
            <Download className="mr-1 h-3 w-3" /> Tokens CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              download("phase-4.4b-demand-va-findings.csv", demandVaFindingsCsv(a), "text/csv")
            }
          >
            <Download className="mr-1 h-3 w-3" /> Findings CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              download(
                "phase-4.4b-demand-va-placeholder.md",
                demandVaPlaceholderMarkdown(a),
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
          <Badge variant="outline">Raw C {a.raw_c}</Badge>
          <Badge variant="outline">In scope (loads · demand_va) {a.in_scope}</Badge>
          <Badge variant="default">
            Placeholder-preserved-as-NULL {a.placeholder_preserved_as_null}
          </Badge>
          <Badge variant={a.still_unresolved_c ? "destructive" : "outline"}>
            Still unresolved C {a.still_unresolved_c}
          </Badge>
          <Badge variant="outline">Distinct source tokens {a.distinct_source_tokens}</Badge>
          <Badge variant="secondary">
            Semantic-status model required {a.semantic_status_model_required ? "yes" : "no"}
          </Badge>
        </div>

        <p className="text-xs text-muted-foreground">
          {a.semantic_status_model_reason} The exact canonical token is preserved verbatim;{" "}
          <code>TBD</code>, blank, <code>N/A</code>, <code>?</code>, <code>UNKNOWN</code>,{" "}
          <code>VERIFY</code> and numeric <code>0</code> are never merged into one semantic state,
          and a text placeholder is never coerced to zero. Numeric zero counts as an explicit value
          only where the cell truly holds numeric zero. Only unknown / not-yet-determined tokens
          whose FarmOps value is NULL are adjudicated{" "}
          <code>PLACEHOLDER_PRESERVED_AS_NULL</code>; N/A, verification-required, explicit zero and
          any other semantics stay unresolved for Phase 4.5. The raw Category-C findings and the
          workbook SHA binding are unchanged.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Source token</th>
                <th className="py-1 pr-3">Count</th>
                <th className="py-1 pr-3">Worksheets</th>
                <th className="py-1 pr-3">Representative stable IDs</th>
                <th className="py-1 pr-3">Semantic state</th>
                <th className="py-1 pr-3">FarmOps</th>
                <th className="py-1 pr-3">NULL lossless</th>
                <th className="py-1 pr-3">Adjudication</th>
              </tr>
            </thead>
            <tbody>
              {a.tokens.map((t) => (
                <tr key={t.token_display} className="border-t align-top">
                  <td className="py-1 pr-3 font-mono">{t.token_display}</td>
                  <td className="py-1 pr-3">{t.count}</td>
                  <td className="py-1 pr-3">{t.worksheets.join(", ") || "—"}</td>
                  <td className="py-1 pr-3 font-mono">
                    {t.representative_stable_ids.join(", ")}
                  </td>
                  <td className="py-1 pr-3">
                    <Badge variant="secondary">{t.semantic_state}</Badge>
                    <div className="mt-1 text-muted-foreground">
                      {DEMAND_VA_STATE_LABELS[t.semantic_state]}
                    </div>
                  </td>
                  <td className="py-1 pr-3 text-muted-foreground">
                    {t.farmops_all_null ? "NULL (absent)" : t.farmops_states.join(", ")}
                  </td>
                  <td className="py-1 pr-3">{t.null_lossless ? "yes" : "no"}</td>
                  <td className="py-1 pr-3 text-muted-foreground">
                    <Badge variant={t.resolved_for_phase_4_5 ? "outline" : "destructive"}>
                      {t.adjudication}
                    </Badge>
                    <div className="mt-1">{t.rationale}</div>
                    <div className="mt-1">{DEMAND_VA_ADJUDICATION_LABELS[t.adjudication]}</div>
                    <div className="mt-1">{t.loss_description}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-md border p-3 text-xs">
          <p className="font-medium">
            Proposed semantic-status model{" "}
            <span className="font-normal text-muted-foreground">
              proposal only — the field is not added in this phase
            </span>
          </p>
          <ul className="mt-1 list-disc pl-4 text-muted-foreground">
            <li>{a.model_proposal.value_field}</li>
            <li>{a.model_proposal.status_field}</li>
            <li>{a.model_proposal.provenance_field}</li>
            <li>Allowed status values: {a.model_proposal.status_values.join(", ")}</li>
          </ul>
        </div>

        <div>
          <Button size="sm" variant="ghost" onClick={() => setShowRows((v) => !v)}>
            {showRows ? "Hide" : "Show"} underlying findings ({a.in_scope})
          </Button>
          {showRows ? (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">Stable ID</th>
                    <th className="py-1 pr-3">Worksheet</th>
                    <th className="py-1 pr-3">Row</th>
                    <th className="py-1 pr-3">Source token</th>
                    <th className="py-1 pr-3">FarmOps</th>
                    <th className="py-1 pr-3">Raw cat</th>
                    <th className="py-1 pr-3">Adjudication</th>
                  </tr>
                </thead>
                <tbody>
                  {a.tokens.flatMap((t) =>
                    t.findings.map((f) => (
                      <tr key={`${f.stable_id}-${f.farmops_field}`} className="border-t">
                        <td className="py-1 pr-3 font-mono">{f.stable_id}</td>
                        <td className="py-1 pr-3">{f.ods_worksheet || "—"}</td>
                        <td className="py-1 pr-3">{f.ods_row ?? "—"}</td>
                        <td className="py-1 pr-3 font-mono">{t.token_display}</td>
                        <td className="py-1 pr-3 text-muted-foreground">
                          {f.farmops_raw || "NULL (absent)"}
                        </td>
                        <td className="py-1 pr-3">{f.raw_category}</td>
                        <td className="py-1 pr-3 text-muted-foreground">{t.adjudication}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
