// Phase 4.4b — final load semantic adjudication report (read-only UI).
// Nine findings, five load summaries, bucket totals, CSV + Markdown export.
// There is deliberately no Apply control: this view performs no writes.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CollapsibleSection } from "@/components/electrical/collapsible-section";
import { BUCKET_LABELS, type LoadSemanticBucket } from "@/lib/electrical-load-semantics";
import {
  adjudicateLoads,
  adjudicationCsv,
  adjudicationMarkdown,
  RECOMMENDATION_LABELS,
} from "@/lib/electrical-load-adjudication";
import { buildProductionAdjudicationInput } from "@/lib/electrical-load-adjudication-production";
import { listAdjudicatedLoads } from "@/lib/load-adjudication.functions";

const BUCKET_ORDER: LoadSemanticBucket[] = [
  "true_engineering_disagreement",
  "nominal_vs_nameplate_representation",
  "current_ocp_semantic_mismatch",
  "insufficient_provenance",
];

const BUCKET_CODE: Record<LoadSemanticBucket, string> = {
  true_engineering_disagreement: "TRUE_ENGINEERING_DISAGREEMENT",
  nominal_vs_nameplate_representation: "NOMINAL_VS_NAMEPLATE_REPRESENTATION",
  current_ocp_semantic_mismatch: "CURRENT_OCP_SEMANTIC_MISMATCH",
  insufficient_provenance: "INSUFFICIENT_PROVENANCE",
};

const KIND_LABEL: Record<string, string> = {
  observed: "observed",
  inferred_candidate: "inferred candidate",
  not_established: "not established",
};

const show = (v: number | null) => (v === null ? "not stated" : String(v));

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function LoadAdjudicationReport() {
  const fetchLoads = useServerFn(listAdjudicatedLoads);
  const rows = useQuery({ queryKey: ["load-adjudication"], queryFn: () => fetchLoads() });

  const report = useMemo(
    () => (rows.data ? adjudicateLoads(buildProductionAdjudicationInput(rows.data)) : null),
    [rows.data],
  );

  if (rows.isLoading) return <Skeleton className="h-72 w-full" />;
  if (rows.error || !report) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Couldn't load the adjudicated loads</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {rows.error instanceof Error ? rows.error.message : "Unknown error."}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4" /> Final load semantic adjudication
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Production classification of the {report.total_findings} former Category-B numeric
            findings across FS-034, FS-082, FS-083, FS-084 and FS-092. Canonical values come from the
            unchanged workbook; FarmOps values are read live. Read-only — no writes, no apply path.
            Recommendations are advisory.
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{report.total_findings} findings</Badge>
            {BUCKET_ORDER.map((b) => (
              <Badge key={b} variant="secondary">
                {BUCKET_CODE[b]}: {report.counts[b]}
              </Badge>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                download("load-adjudication.csv", adjudicationCsv(report), "text/csv")
              }
            >
              <Download className="mr-1 h-4 w-4" /> CSV
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                download(
                  "load-adjudication.md",
                  adjudicationMarkdown(report),
                  "text/markdown",
                )
              }
            >
              <Download className="mr-1 h-4 w-4" /> Markdown report
            </Button>
          </div>
        </CardContent>
      </Card>

      <CollapsibleSection
        title="Nine findings"
        subtitle="One row per differing field per load, with provenance, evidence, reason and recommended next action."
        badges={<Badge variant="outline">{report.findings.length}</Badge>}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="p-2">Load</th>
                <th className="p-2">Description</th>
                <th className="p-2">Field</th>
                <th className="p-2">ODS</th>
                <th className="p-2">FarmOps</th>
                <th className="p-2">Bucket</th>
                <th className="p-2">ODS provenance</th>
                <th className="p-2">FarmOps provenance</th>
                <th className="p-2">Evidence</th>
                <th className="p-2">Reason</th>
                <th className="p-2">Recommendation</th>
              </tr>
            </thead>
            <tbody>
              {report.findings.map((f) => (
                <tr key={`${f.stable_id}-${f.field}`} className="border-t border-border align-top">
                  <td className="p-2 font-mono">{f.stable_id}</td>
                  <td className="p-2">{f.description}</td>
                  <td className="p-2 font-mono">{f.field}</td>
                  <td className="p-2 font-mono">
                    {show(f.ods_value)} {f.unit}
                  </td>
                  <td className="p-2 font-mono">
                    {show(f.farmops_value)} {f.unit}
                  </td>
                  <td className="p-2">
                    <Badge variant="secondary">{BUCKET_CODE[f.bucket]}</Badge>
                  </td>
                  <td className="p-2 text-muted-foreground">{f.ods_provenance}</td>
                  <td className="p-2 text-muted-foreground">{f.farmops_provenance}</td>
                  <td className="p-2">
                    {f.evidence.length ? (
                      <ul className="list-disc space-y-1 pl-4">
                        {f.evidence.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-muted-foreground">
                        No affirmative provenance on file
                      </span>
                    )}
                    {f.supporting_only.length ? (
                      <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
                        {f.supporting_only.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                  <td className="p-2">
                    {f.reason}
                    {f.missing_evidence.length ? (
                      <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
                        {f.missing_evidence.map((m) => (
                          <li key={m}>Missing: {m}</li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                  <td className="p-2">
                    <Badge variant="outline">{f.recommendation}</Badge>
                    <p className="mt-1 text-muted-foreground">
                      {RECOMMENDATION_LABELS[f.recommendation]}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Load semantic summary"
        subtitle="Observed values, inferred semantic candidates and concepts that are not established."
        badges={<Badge variant="outline">{report.loads.length} loads</Badge>}
      >
        <div className="space-y-4">
          {report.loads.map((l) => (
            <div key={l.stable_id} className="rounded-md border border-border p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold">{l.stable_id}</span>
                <span>{l.description}</span>
                <span className="text-muted-foreground">Equipment: {l.equipment}</span>
                {l.buckets.map((b) => (
                  <Badge key={b} variant="secondary">
                    {BUCKET_LABELS[b]}
                  </Badge>
                ))}
              </div>
              <dl className="mt-2 grid gap-1 sm:grid-cols-2">
                {l.concepts.map((c) => (
                  <div key={c.concept} className="flex flex-wrap gap-1">
                    <dt className="text-muted-foreground">{c.concept}:</dt>
                    <dd className="font-medium">{c.value}</dd>
                    <Badge variant="outline">{KIND_LABEL[c.kind] ?? c.kind}</Badge>
                    <span className="text-muted-foreground">— {c.source}</span>
                  </div>
                ))}
              </dl>
              <p className="mt-2 font-medium">Unresolved questions</p>
              <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                {l.unresolved_questions.length ? (
                  l.unresolved_questions.map((q) => <li key={q}>{q}</li>)
                ) : (
                  <li>None.</li>
                )}
              </ul>
            </div>
          ))}
        </div>
      </CollapsibleSection>
    </div>
  );
}
