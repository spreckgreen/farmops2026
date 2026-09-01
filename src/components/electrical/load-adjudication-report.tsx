// Phase 4.4b — final load semantic adjudication report (read-only UI).
// Nine findings, five load summaries, bucket totals, CSV + Markdown export.
// There is deliberately no Apply control: this view performs no writes.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CollapsibleSection } from "@/components/electrical/collapsible-section";
import {
  adjudicateLoads,
  adjudicationCsv,
  adjudicationMarkdown,
  ADJUDICATION_BUCKET_CODES,
  ADJUDICATION_BUCKET_LABELS,
  ADJUDICATION_BUCKET_ORDER,
  RECOMMENDATION_LABELS,
} from "@/lib/electrical-load-adjudication";
import { buildProductionAdjudicationInput } from "@/lib/electrical-load-adjudication-production";
import { listAdjudicatedLoads } from "@/lib/load-adjudication.functions";
import { BryantVoltageApplyGate } from "@/components/electrical/bryant-voltage-apply-gate";
import {
  AdjudicationBaselinePicker,
  type AttachedBaseline,
} from "@/components/electrical/adjudication-baseline-picker";

const BUCKET_ORDER = ADJUDICATION_BUCKET_ORDER;
const BUCKET_CODE = ADJUDICATION_BUCKET_CODES;
const BUCKET_LABELS = ADJUDICATION_BUCKET_LABELS;

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
  const queryClient = useQueryClient();
  const rows = useQuery({ queryKey: ["load-adjudication"], queryFn: () => fetchLoads() });

  // After an apply, re-run load adjudication and the numeric semantics
  // diagnostics against the freshly written values.
  const revalidate = () => {
    void rows.refetch();
    void queryClient.invalidateQueries({ queryKey: ["electrical-numeric-diagnostics"] });
    void queryClient.invalidateQueries({ queryKey: ["electrical-validation"] });
  };

  // Canonical values are never stored here: they come only from the attached
  // SHA-verified workbook, so with no baseline there are no canonical findings.
  const report = useMemo(
    () =>
      rows.data && attached
        ? adjudicateLoads(buildProductionAdjudicationInput(rows.data, attached.baseline))
        : null,
    [rows.data, attached],
  );

  if (rows.isLoading) return <Skeleton className="h-72 w-full" />;
  if (rows.error) {
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

  const gateBaseline = attached
    ? {
        file_name: attached.file_name,
        base64: attached.base64,
        authorized: attached.baseline.is_phase_44a_baseline,
      }
    : null;

  return (
    <div className="space-y-4">
      <AdjudicationBaselinePicker attached={attached} onAttach={setAttached} />

      <CollapsibleSection
        title="Bryant nominal supply voltage correction (FS-082, FS-083)"
        subtitle="Preview-first, per-row approved correction of electrical_loads.volts 120 → 240, authorized only by the Phase 4.4a baseline workbook. Nothing else is written; adjudication history is preserved."
        badges={<Badge variant="secondary">Apply gate</Badge>}
      >
        <BryantVoltageApplyGate baseline={gateBaseline} onRevalidate={revalidate} />
      </CollapsibleSection>

      {!report ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Canonical evidence required</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Attach the canonical <code>PremoFarmElectrical.ods</code> above to compute the
            adjudication. Hard-coded canonical values are never substituted for the SHA-verified
            workbook.
          </CardContent>
        </Card>
      ) : (
    <>
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
        title="Bryant nominal supply voltage correction (FS-082, FS-083)"
        subtitle="Preview-first, per-row approved correction of electrical_loads.volts 120 → 240. Nothing else is written; adjudication history is preserved."
        badges={<Badge variant="secondary">Apply gate</Badge>}
      >
        <BryantVoltageApplyGate onRevalidate={revalidate} />
      </CollapsibleSection>

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
                <th className="p-2">Equipment evidence</th>
                <th className="p-2">Semantic reading</th>
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
                    {f.equipment_evidence.length ? (
                      <ul className="list-disc space-y-1 pl-4">
                        {f.equipment_evidence.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-muted-foreground">
                        No equipment identity established
                      </span>
                    )}
                  </td>
                  <td className="p-2">
                    <span className="font-medium">{f.semantic_interpretation}</span>
                    {f.proposed_representation.length ? (
                      <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
                        {f.proposed_representation.map((r) => (
                          <li key={r.field}>
                            <span className="font-mono">{r.field}</span> = {r.value} — {r.source}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
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

      {report.groups.length ? (
        <CollapsibleSection
          title="Same-equipment comparison groups"
          subtitle="One equipment configuration, several installations. Differences here are installation or record differences, not specification differences."
          badges={<Badge variant="outline">{report.groups.length}</Badge>}
        >
          <div className="space-y-4">
            {report.groups.map((g) => (
              <div key={g.id} className="rounded-md border border-border p-3 text-xs">
                <p className="font-semibold">{g.label}</p>
                <p className="mt-1 text-muted-foreground">{g.description}</p>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-left text-muted-foreground">
                      <tr>
                        <th className="p-2">Load</th>
                        <th className="p-2">ODS V / A / VA</th>
                        <th className="p-2">FarmOps V / A / VA</th>
                        <th className="p-2">Buckets</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.loads.map((m) => (
                        <tr key={m.stable_id} className="border-t border-border align-top">
                          <td className="p-2 font-mono">
                            {m.stable_id}
                            <div className="text-muted-foreground">{m.description}</div>
                          </td>
                          <td className="p-2 font-mono">
                            {show(m.ods.volts ?? null)} / {show(m.ods.amps ?? null)} /{" "}
                            {show(m.ods.connected_va ?? null)}
                          </td>
                          <td className="p-2 font-mono">
                            {show(m.farmops.volts ?? null)} / {show(m.farmops.amps ?? null)} /{" "}
                            {show(m.farmops.connected_va ?? null)}
                          </td>
                          <td className="p-2">
                            {m.buckets.map((b) => (
                              <Badge key={b} variant="secondary" className="mr-1">
                                {BUCKET_LABELS[b]}
                              </Badge>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      ) : null}

      {report.discrepancies.length ? (
        <CollapsibleSection
          title="Preserved evidence discrepancies"
          subtitle="Conflicting evidence is retained side by side; nothing is silently selected."
          badges={<Badge variant="destructive">{report.discrepancies.length}</Badge>}
        >
          <div className="space-y-3">
            {report.discrepancies.map((d) => (
              <div key={d.code} className="rounded-md border border-border p-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="font-mono">
                    {d.code}
                  </Badge>
                  {d.stable_ids.map((id) => (
                    <Badge key={id} variant="secondary" className="font-mono">
                      {id}
                    </Badge>
                  ))}
                </div>
                <p className="mt-2">{d.detail}</p>
                <p className="mt-2 font-medium">Resolves with</p>
                <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                  {d.resolves_with.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      ) : null}

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
