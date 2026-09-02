// Phase 4.4b — Bryant amperage semantic adjudication (read-only UI).
// No Apply control exists: this view never writes FarmOps and never edits the
// canonical workbook.
import { useMemo } from "react";
import { Download } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AMP_DISPOSITION_LABELS,
  AMP_SEMANTIC_LOAD_IDS,
  VA_BASIS_LABELS,
  adjudicateAmpSemantics,
  ampSemanticsCsv,
  ampSemanticsMarkdown,
} from "@/lib/electrical-amp-semantics";
import type { AdjudicationBaseline } from "@/lib/electrical-adjudication-baseline";
import type { FarmOpsLoadRow } from "@/lib/electrical-load-adjudication-production";

const n = (v: number | null) => (v === null ? "not stated" : String(v));

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function AmpSemanticsReport({
  baseline,
  rows,
}: {
  baseline: AdjudicationBaseline;
  rows: FarmOpsLoadRow[];
}) {
  const report = useMemo(() => adjudicateAmpSemantics({ baseline, rows }), [baseline, rows]);

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        Read-only adjudication of the canonical <code>Amps</code> and{" "}
        <code>Connected VA</code> values for {AMP_SEMANTIC_LOAD_IDS.join(", ")} against{" "}
        {report.workbook_name} (SHA-256 <span className="font-mono">{report.workbook_sha256}</span>).
        MOCP is never used as a load current, the ODS value is never replaced with 25 A, MCA is never
        derived, and 0 A is not read as a verified zero-load condition.
      </p>
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{report.rows.length} rows</Badge>
        <Badge variant="secondary">{report.unresolved_count} unresolved</Badge>
        <Badge variant={report.is_phase_44a_baseline ? "outline" : "destructive"}>
          {report.is_phase_44a_baseline ? "Phase 4.4a baseline" : "Not the Phase 4.4a baseline"}
        </Badge>
        {report.missing_load_ids.length ? (
          <Badge variant="destructive">
            Not in workbook: {report.missing_load_ids.join(", ")}
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => download("amp-semantics.csv", ampSemanticsCsv(report), "text/csv")}
        >
          <Download className="mr-1 h-4 w-4" /> CSV
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            download("amp-semantics.md", ampSemanticsMarkdown(report), "text/markdown")
          }
        >
          <Download className="mr-1 h-4 w-4" /> Markdown
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1400px] text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="p-2">Stable ID</th>
              <th className="p-2">Workbook / worksheet / row</th>
              <th className="p-2">ODS volts</th>
              <th className="p-2">ODS amps</th>
              <th className="p-2">ODS VA</th>
              <th className="p-2">FarmOps amps</th>
              <th className="p-2">MOCP</th>
              <th className="p-2">RCA</th>
              <th className="p-2">RLA</th>
              <th className="p-2">MCA</th>
              <th className="p-2">Inferred ODS amp semantic</th>
              <th className="p-2">VA basis</th>
              <th className="p-2">Disposition</th>
              <th className="p-2">Recommended action</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.stable_id} className="border-t border-border align-top">
                <td className="p-2 font-mono">{r.stable_id}</td>
                <td className="p-2 text-muted-foreground">
                  {r.workbook_name} · {r.worksheet ?? "—"} · row {r.worksheet_row ?? "—"}
                </td>
                <td className="p-2 font-mono">{n(r.ods_volts)}</td>
                <td className="p-2 font-mono">{n(r.ods_amps)}</td>
                <td className="p-2 font-mono">{n(r.ods_va)}</td>
                <td className="p-2 font-mono">{n(r.farmops_amps)}</td>
                <td className="p-2 font-mono">{n(r.equipment_mocp)}</td>
                <td className="p-2 font-mono">{n(r.rca)}</td>
                <td className="p-2 font-mono">{n(r.rla)}</td>
                <td className="p-2 text-muted-foreground">
                  {r.mca === null ? r.mca_status : r.mca}
                </td>
                <td className="p-2">
                  {r.inferred_ods_amp_semantic}
                  {r.excluded_concepts.length ? (
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
                      {r.excluded_concepts.map((e) => (
                        <li key={e.concept}>
                          <span className="font-mono">{e.concept}</span> ruled out — {e.because}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </td>
                <td className="p-2">
                  <span className="font-medium">{VA_BASIS_LABELS[r.va_basis]}</span>
                  <div className="mt-1 text-muted-foreground">{r.va_basis_proof}</div>
                </td>
                <td className="p-2">
                  <Badge variant="secondary">{r.disposition}</Badge>
                  <div className="mt-1 text-muted-foreground">
                    {AMP_DISPOSITION_LABELS[r.disposition]}
                  </div>
                  {r.additional_dispositions.map((d) => (
                    <div key={d} className="mt-1">
                      <Badge variant="outline">{d}</Badge>
                    </div>
                  ))}
                </td>
                <td className="p-2 text-muted-foreground">{r.recommended_action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {report.rows.map((r) => (
        <Card key={r.stable_id}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {r.stable_id} — evidence interrogated for the amps column
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            {r.probes.map((p) => (
              <div key={p.source}>
                <span className="font-mono">{p.source}</span>
                {p.proves_semantic ? (
                  <Badge className="ml-2" variant="outline">
                    proves semantic
                  </Badge>
                ) : (
                  <Badge className="ml-2" variant="secondary">
                    does not prove semantic
                  </Badge>
                )}
                <div>{p.states}</div>
              </div>
            ))}
            <div>ODS provenance: {r.ods_provenance}</div>
            <div>FarmOps provenance: {r.farmops_provenance} (unchanged)</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
