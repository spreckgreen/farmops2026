// Phase 4.4b — Current-semantics closure plan panel (read-only).
//
// Shows whether the canonical unqualified `Amps` column means one concept or is
// historically overloaded, scored per candidate meaning across the whole
// population, plus the minimum additive schema and the exit criteria for
// FS-082 / FS-083 / FS-084. Nothing is written.
import { useMemo } from "react";
import { Download } from "lucide-react";
import {
  planCurrentSemanticsClosure,
  closureCsv,
  closureMarkdown,
  VERDICT_LABELS,
  USAGE_SIGNATURE_LABELS,
} from "@/lib/electrical-current-semantics-closure";
import { CONFIDENCE_LABELS } from "@/lib/electrical-current-semantic-migration";
import type { AdjudicationBaseline } from "@/lib/electrical-adjudication-baseline";
import type { FarmOpsLoadRow } from "@/lib/electrical-load-adjudication-production";
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

export function CurrentSemanticsClosurePanel({
  baseline,
  rows,
}: {
  baseline: AdjudicationBaseline;
  rows: FarmOpsLoadRow[];
}) {
  const plan = useMemo(
    () => planCurrentSemanticsClosure({ baseline, rows, generatedAt: baseline.parsed_at }),
    [baseline, rows],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base">
            Canonical Amps concept — closure plan{" "}
            <span className="text-xs font-normal text-muted-foreground">
              read-only · no writes · no ODS edit · no numeric corrections
            </span>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={plan.is_phase_44a_baseline ? "outline" : "destructive"}>
              {plan.is_phase_44a_baseline ? "Phase 4.4a baseline" : "Not the Phase 4.4a baseline"}
            </Badge>
            <Badge variant="secondary" className="font-mono">
              {plan.verdict}
            </Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={() => download(`current-semantics-closure.csv`, closureCsv(plan), "text/csv")}
            >
              <Download className="mr-1 h-3.5 w-3.5" /> CSV
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                download(`current-semantics-closure.md`, closureMarkdown(plan), "text/markdown")
              }
            >
              <Download className="mr-1 h-3.5 w-3.5" /> Markdown
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="rounded-md border p-3">
            <p className="font-medium">{VERDICT_LABELS[plan.verdict]}</p>
            <p className="mt-1 text-muted-foreground">{plan.verdict_rationale}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Population: {plan.rows_examined} canonical load rows · {plan.rows_with_amps} with an amps
              value · {plan.rows_with_stated_concept} with a stated concept.
            </p>
          </div>

          <div className="rounded-md border p-3">
            <p className="font-medium">Mutually exclusive usages observed in the same column</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
              {plan.conflicting_usages.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[60rem] text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="p-2">Semantic candidate</th>
                  <th className="p-2">Supporting rows</th>
                  <th className="p-2">Contradictory rows</th>
                  <th className="p-2">Indeterminate rows</th>
                  <th className="p-2">Representative stable IDs</th>
                  <th className="p-2">Confidence</th>
                  <th className="p-2">Migration impact</th>
                </tr>
              </thead>
              <tbody>
                {plan.candidates.map((c) => (
                  <tr key={c.candidate} className="border-t align-top">
                    <td className="p-2">
                      <span className="font-mono">{c.candidate}</span>
                      <p className="text-muted-foreground">{c.label}</p>
                    </td>
                    <td className="p-2">
                      {c.supporting_rows.length ? c.supporting_rows.join(", ") : "none"}
                      <p className="text-muted-foreground">{c.supporting_basis}</p>
                      {c.coincident_rows.length ? (
                        <p className="mt-1 text-muted-foreground">
                          Numeric coincidence only (not evidence): {c.coincident_rows.join(", ")}
                        </p>
                      ) : null}
                    </td>
                    <td className="p-2">
                      {c.contradictory_rows.length ? c.contradictory_rows.join(", ") : "none"}
                      <p className="text-muted-foreground">{c.contradictory_basis}</p>
                    </td>
                    <td className="p-2">
                      {c.indeterminate_rows.length}
                      <p className="text-muted-foreground">{c.indeterminate_basis}</p>
                    </td>
                    <td className="p-2 font-mono">
                      {c.representative_stable_ids.join(", ") || "none"}
                    </td>
                    <td className="p-2">{CONFIDENCE_LABELS[c.confidence]}</td>
                    <td className="p-2 text-muted-foreground">{c.migration_impact}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-md border p-3">
            <p className="font-medium">Bryant evidence preserved independently</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {plan.bryant_evidence.equipment_model} · applies to{" "}
              {plan.bryant_evidence.applies_to.join(", ")}
            </p>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {plan.bryant_evidence.quantities.map((q) => (
                <li key={q.quantity}>
                  <span className="font-mono text-foreground">
                    {q.quantity} = {q.value === null ? "NULL / unverified" : `${q.value} A`}
                  </span>{" "}
                  → <span className="font-mono">{q.field ?? "none"}</span> — {q.status}
                </li>
              ))}
            </ul>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {plan.bryant_evidence.preservation_rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-md border p-3">
            <p className="font-medium">
              Current semantics unresolved findings ({plan.unresolved_findings.length})
            </p>
            <div className="mt-2 space-y-3">
              {plan.unresolved_findings.map((f) => (
                <div key={f.finding_id} className="rounded-md bg-muted/40 p-3">
                  <p className="font-mono text-sm">
                    {f.finding_id} · {f.stable_id} ·{" "}
                    {f.system === "canonical_ods" ? "canonical ODS" : "FarmOps"}
                  </p>
                  <p className="text-xs">
                    <span className="font-mono">{f.field}</span> = {f.value === null ? "blank" : f.value}{" "}
                    <Badge variant="secondary" className="ml-1 font-mono">
                      {f.classification}
                    </Badge>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{f.why_open}</p>
                  <p className="mt-1 text-xs font-medium">Required to resolve</p>
                  <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                    {f.required_to_resolve.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs font-medium">Excluded as evidence</p>
                  <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                    {f.excluded_as_evidence.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>


          <div className="rounded-md border p-3">
            <p className="font-medium">Minimum additive target schema</p>
            <p className="mt-1 text-muted-foreground">{plan.minimum_additive_schema_summary}</p>
            <ul className="mt-2 space-y-2 text-xs text-muted-foreground">
              {plan.additive_schema.map((a) => (
                <li key={a.element}>
                  <Badge variant={a.required_now ? "secondary" : "outline"} className="mr-2">
                    {a.required_now ? "Required now" : "Deferred"}
                  </Badge>
                  <span className="font-mono">{a.element}</span> — {a.purpose} Consumer safety:{" "}
                  {a.consumer_safety} {a.why_required_now}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-md border p-3">
            <p className="font-medium">Leaving CURRENT_SEMANTICS_UNRESOLVED</p>
            <div className="mt-2 space-y-3">
              {plan.exit_criteria.map((e) => (
                <div key={e.stable_id} className="rounded-md bg-muted/40 p-3">
                  <p className="font-mono text-sm">{e.stable_id}</p>
                  <p className="text-xs text-muted-foreground">{e.current_disposition}</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                    {e.must_become_true.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Proposed target field: {e.proposed_target_field ?? "none"} — {e.why_no_assignment}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <details className="rounded-md border p-3">
            <summary className="cursor-pointer font-medium">
              Row usage signatures ({plan.signatures.length})
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[52rem] text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="p-2">Stable ID</th>
                    <th className="p-2">ODS V / A / VA</th>
                    <th className="p-2">FarmOps A</th>
                    <th className="p-2">Usage signature</th>
                    <th className="p-2">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.signatures.map((s) => (
                    <tr key={s.stable_id} className="border-t align-top">
                      <td className="p-2 font-mono">
                        {s.stable_id}
                        {s.is_fixture ? <Badge className="ml-1" variant="outline">fixture</Badge> : null}
                      </td>
                      <td className="p-2 font-mono">
                        {s.ods_volts ?? "—"} / {s.ods_amps ?? "—"} / {s.ods_va ?? "—"}
                      </td>
                      <td className="p-2 font-mono">{s.farmops_amps ?? "—"}</td>
                      <td className="p-2">
                        {s.signatures.map((sig) => (
                          <p key={sig} className="text-muted-foreground">
                            {USAGE_SIGNATURE_LABELS[sig]}
                          </p>
                        ))}
                      </td>
                      <td className="p-2 text-muted-foreground">{s.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
