// Phase 4.4b — FS-084 60 A provenance adjudication panel (read-only).
//
// Traces where canonical FS-084 Amps = 60 came from and, separately, what the
// FarmOps amps value establishes. Nothing is written. MOCP is never presented as
// a load current, MCA is never inferred, and the derived 14,400 VA is shown as
// excluded evidence rather than corroboration.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download } from "lucide-react";
import { fetchFs084Provenance } from "@/lib/fs084-provenance.functions";
import {
  traceFs084AmpProvenance,
  fs084TraceCsv,
  fs084ProvenanceMarkdown,
  ODS_AMP_CLASS_LABELS,
  FARMOPS_AMP_SEMANTIC_LABELS,
  PROVENANCE_STRENGTH_LABELS,
  FS084_STABLE_ID,
  type Fs084FarmOpsProvenance,
} from "@/lib/electrical-fs084-amp-provenance";
import { VA_BASIS_LABELS } from "@/lib/electrical-amp-semantics";
import type { AdjudicationBaseline } from "@/lib/electrical-adjudication-baseline";
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

const n = (v: number | null) => (v === null ? "not stated" : String(v));

export function Fs084ProvenancePanel({ baseline }: { baseline: AdjudicationBaseline }) {
  const fetchProvenance = useServerFn(fetchFs084Provenance);
  const { data, isLoading, error } = useQuery({
    queryKey: ["fs084-amp-provenance"],
    queryFn: () => fetchProvenance({ data: {} }) as Promise<Fs084FarmOpsProvenance[]>,
  });

  const report = useMemo(
    () =>
      traceFs084AmpProvenance({
        baseline,
        provenance: data ?? [],
        generatedAt: baseline.parsed_at,
      }),
    [baseline, data],
  );

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Reading FarmOps provenance signals…</p>;
  }
  if (error) {
    return (
      <p className="text-sm text-destructive">
        Unable to read FarmOps provenance: {(error as Error).message}
      </p>
    );
  }
  if (!report) {
    return (
      <p className="text-sm text-muted-foreground">
        The attached workbook does not contain {FS084_STABLE_ID}, so no canonical value can be
        traced. No value is assumed from any stored copy.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base">
            {report.stable_id} — canonical Amps provenance trace{" "}
            <span className="text-xs font-normal text-muted-foreground">
              read-only · no ODS edit · no FarmOps write
            </span>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={report.is_phase_44a_baseline ? "outline" : "destructive"}>
              {report.is_phase_44a_baseline ? "Phase 4.4a baseline" : "Not the Phase 4.4a baseline"}
            </Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                download(`fs084-provenance-${report.generated_at}.csv`, fs084TraceCsv(report), "text/csv")
              }
            >
              <Download className="mr-1 h-3.5 w-3.5" /> CSV
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                download(
                  `fs084-provenance-${report.generated_at}.md`,
                  fs084ProvenanceMarkdown(report),
                  "text/markdown",
                )
              }
            >
              <Download className="mr-1 h-3.5 w-3.5" /> Markdown
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border p-3">
              <p className="font-medium">Canonical (SHA-bound workbook)</p>
              <p className="text-muted-foreground">
                {report.worksheet ?? "—"} row {report.worksheet_row ?? "—"} · {n(report.ods_volts)} V ·{" "}
                {n(report.ods_amps)} A · {n(report.ods_va)} VA
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                VA basis: {VA_BASIS_LABELS[report.va_basis]} — {report.va_basis_proof} Excluded from
                the evidence supporting the amps value.
              </p>
            </div>
            <div className="rounded-md border p-3">
              <p className="font-medium">FarmOps (live, unchanged)</p>
              <p className="text-muted-foreground">
                {n(report.farmops_volts)} V · {n(report.farmops_amps)} A · connected VA{" "}
                {n(report.farmops_connected_va)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Equipment {report.equipment_model ?? "not established"} ·{" "}
                {report.equipment_voltage_class ?? "—"} VAC · MOCP {n(report.equipment_mocp)} A · RCA{" "}
                {n(report.rca)} A · RLA {n(report.rla)} A · MCA{" "}
                {report.mca === null ? report.mca_status : report.mca}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem] text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="p-2">Stable ID</th>
                  <th className="p-2">Value</th>
                  <th className="p-2">Source</th>
                  <th className="p-2">Source type</th>
                  <th className="p-2">Semantic claim</th>
                  <th className="p-2">Independent evidence</th>
                  <th className="p-2">Provenance strength</th>
                </tr>
              </thead>
              <tbody>
                {report.trace.map((t, i) => (
                  <tr key={`${t.source_type}-${i}`} className="border-t align-top">
                    <td className="p-2 font-mono">{t.stable_id}</td>
                    <td className="p-2 font-mono">{t.value}</td>
                    <td className="p-2">{t.source}</td>
                    <td className="p-2 font-mono text-[11px]">{t.source_type}</td>
                    <td className="p-2 text-muted-foreground">{t.semantic_claim}</td>
                    <td className="p-2">
                      <Badge variant={t.independent_evidence ? "outline" : "secondary"}>
                        {t.independent_evidence ? "yes" : "no"}
                      </Badge>
                      <span className="ml-2 text-muted-foreground">{t.independent_evidence_note}</span>
                    </td>
                    <td className="p-2">{PROVENANCE_STRENGTH_LABELS[t.provenance_strength]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border p-3">
              <p className="font-medium">Canonical 60 A classification</p>
              <p className="mt-1">
                <Badge variant="secondary" className="font-mono">
                  {report.ods_amp_class}
                </Badge>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {ODS_AMP_CLASS_LABELS[report.ods_amp_class]}
              </p>
              <p className="mt-2 text-muted-foreground">{report.ods_amp_class_rationale}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Strength: {PROVENANCE_STRENGTH_LABELS[report.ods_amp_provenance_strength]}
              </p>
            </div>
            <div className="rounded-md border p-3">
              <p className="font-medium">FarmOps amps — independent trace</p>
              <p className="mt-1">
                <Badge variant="secondary" className="font-mono">
                  {report.farmops_amp_semantic}
                </Badge>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {FARMOPS_AMP_SEMANTIC_LABELS[report.farmops_amp_semantic]}
              </p>
              <p className="mt-2 text-muted-foreground">{report.farmops_amp_semantic_rationale}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Strength: {PROVENANCE_STRENGTH_LABELS[report.farmops_amp_provenance_strength]}
              </p>
            </div>
          </div>

          <div className="rounded-md border p-3">
            <p className="font-medium">Relationship to FS-082 / FS-083</p>
            <p className="mt-1 text-muted-foreground">{report.peer_relationship}</p>
          </div>

          <div className="rounded-md border p-3">
            <p className="font-medium">Preserved state</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>{report.preserved_raw_finding}</li>
              <li>{report.preserved_current_semantic_disposition}</li>
              {report.open_questions.map((q) => (
                <li key={q}>Open question retained: {q}</li>
              ))}
              {report.expectation_notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-md border p-3">
            <p className="font-medium">Evidence required next</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
              {report.next_evidence_required.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
