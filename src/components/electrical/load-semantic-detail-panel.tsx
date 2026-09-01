// Phase 4.4b — Load voltage / current semantic review (read-only UI).
// Splits the load Category-B numeric findings into the four acceptance buckets
// and shows each load's canonical vs FarmOps values with provenance. There is
// deliberately no Apply control in this phase.
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/electrical/collapsible-section";
import type { NumericDiagnosticsReport } from "@/lib/electrical-numeric-diagnostics";
import type { ValidationReport } from "@/lib/electrical-parallel-validation";
import {
  BUCKET_LABELS,
  CURRENT_MEANING_LABELS,
  VA_BASIS_LABELS,
  VOLTAGE_BASIS_LABELS,
  loadSemanticsCsv,
  loadSemanticsMarkdown,
  loadVoltageCurrentReview,
  type LoadSemanticBucket,
} from "@/lib/electrical-load-semantics";

const BUCKET_ORDER: LoadSemanticBucket[] = [
  "true_engineering_disagreement",
  "nominal_vs_nameplate_representation",
  "current_ocp_semantic_mismatch",
  "insufficient_provenance",
];

const basisLabel = (b: string | null) =>
  b === null
    ? "—"
    : (VOLTAGE_BASIS_LABELS as Record<string, string>)[b] ??
      (VA_BASIS_LABELS as Record<string, string>)[b] ??
      (CURRENT_MEANING_LABELS as Record<string, string>)[b] ??
      b;

const show = (v: number | null) => (v === null ? "—" : String(v));

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function LoadSemanticDetailPanel({
  report,
  diag,
}: {
  report: ValidationReport;
  diag: NumericDiagnosticsReport;
}) {
  const review = useMemo(() => loadVoltageCurrentReview(report, diag), [report, diag]);
  const [bucket, setBucket] = useState<LoadSemanticBucket | "all">("all");

  const rows = review.findings.filter((f) => bucket === "all" || f.bucket === bucket);

  return (
    <CollapsibleSection
      title="Load voltage / current semantic review"
      subtitle="Read-only: reclassification of load Category-B findings. No writes and no apply path in this phase."
      badges={
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline">{review.findings.length} findings</Badge>
          {BUCKET_ORDER.map((b) => (
            <Badge key={b} variant="secondary">
              {BUCKET_LABELS[b]} {review.counts[b]}
            </Badge>
          ))}
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge
            variant={bucket === "all" ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setBucket("all")}
          >
            All {review.findings.length}
          </Badge>
          {BUCKET_ORDER.map((b) => (
            <Badge
              key={b}
              variant={bucket === b ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setBucket(bucket === b ? "all" : b)}
            >
              {BUCKET_LABELS[b]} {review.counts[b]}
            </Badge>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              download("phase-4.4b-load-semantics.csv", loadSemanticsCsv(review), "text/csv")
            }
          >
            <Download className="mr-1 h-3 w-3" /> Findings CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              download(
                "phase-4.4b-load-semantics.md",
                loadSemanticsMarkdown(review),
                "text/markdown",
              )
            }
          >
            <Download className="mr-1 h-3 w-3" /> Report
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="p-2">Load</th>
                <th className="p-2">Field</th>
                <th className="p-2">Canonical ODS</th>
                <th className="p-2">FarmOps</th>
                <th className="p-2">B →</th>
                <th className="p-2">Bucket</th>
                <th className="p-2">Basis (ODS / FarmOps)</th>
                <th className="p-2">Evidence &amp; disposition</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={`${f.stable_id}-${f.field}`} className="border-t align-top">
                  <td className="p-2 font-mono">{f.stable_id}</td>
                  <td className="p-2">
                    {f.label}
                    <div className="text-muted-foreground">{f.unit}</div>
                  </td>
                  <td className="p-2 font-mono">{show(f.ods_value)}</td>
                  <td className="p-2 font-mono">{show(f.farmops_value)}</td>
                  <td className="p-2">
                    <Badge variant={f.proposed_category === "B" ? "destructive" : "secondary"}>
                      {f.proposed_category}
                    </Badge>
                  </td>
                  <td className="p-2">
                    {BUCKET_LABELS[f.bucket]}
                    <div className="text-muted-foreground">
                      {f.basis_proven ? "basis proven" : "basis not yet proven"}
                    </div>
                  </td>
                  <td className="p-2">
                    <div>{basisLabel(f.ods_basis)}</div>
                    <div className="text-muted-foreground">{basisLabel(f.farmops_basis)}</div>
                  </td>
                  <td className="p-2">
                    <ul className="list-disc pl-4">
                      {f.proof.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                    <div className="mt-1 text-muted-foreground">{f.disposition}</div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-3 text-muted-foreground">
                    No load numeric findings in this bucket.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {review.loads.map((load) => (
          <CollapsibleSection
            key={load.stable_id}
            title={`${load.stable_id}${load.description ? ` — ${load.description}` : ""}`}
            subtitle={
              load.targeted_review
                ? "Targeted engineering review — do not semantically normalize."
                : load.buckets.map((b) => BUCKET_LABELS[b]).join(", ")
            }
            badges={
              <div className="flex flex-wrap gap-1">
                {load.equipment_model ? (
                  <Badge variant="outline">{load.equipment_model}</Badge>
                ) : null}
                <Badge variant="outline">
                  V {show(load.canonical_volts)} / {show(load.farmops_volts)}
                </Badge>
                <Badge variant="outline">
                  A {show(load.canonical_amps)} / {show(load.farmops_amps)}
                </Badge>
                <Badge variant="outline">
                  VA {show(load.canonical_connected_va)} / {show(load.farmops_connected_va)}
                </Badge>
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="p-2">Field</th>
                    <th className="p-2">Canonical ODS</th>
                    <th className="p-2">FarmOps</th>
                    <th className="p-2">ODS provenance</th>
                    <th className="p-2">FarmOps provenance</th>
                  </tr>
                </thead>
                <tbody>
                  {load.values.map((v) => (
                    <tr key={v.field} className={`border-t align-top ${v.differs ? "bg-muted/40" : ""}`}>
                      <td className="p-2">{v.label}</td>
                      <td className="p-2 font-mono">{v.ods_value || "—"}</td>
                      <td className="p-2 font-mono">{v.farmops_value || "—"}</td>
                      <td className="p-2 text-muted-foreground">
                        {v.ods_worksheet ?? "—"}
                        {v.ods_column ? ` · ${v.ods_column}` : ""}
                        {v.ods_row ? ` · row ${v.ods_row}` : ""}
                      </td>
                      <td className="p-2 text-muted-foreground">
                        {v.farmops_entity ?? "—"}
                        {v.farmops_field ? `.${v.farmops_field}` : ""}
                        {v.farmops_uuid ? ` · ${v.farmops_uuid.slice(0, 8)}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CollapsibleSection>
        ))}

        <div className="rounded-md border p-3 text-xs text-muted-foreground">
          <div className="mb-1 font-medium text-foreground">
            Proposed semantic fields (documentation only — nothing applied)
          </div>
          <ul className="list-disc space-y-1 pl-4">
            {review.proposed_fields.map((p) => (
              <li key={p.field}>
                <span className="font-mono">{p.field}</span> — {p.concept} {p.why}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </CollapsibleSection>
  );
}
