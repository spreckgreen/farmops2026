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
import { CONVERGENCE_DISPOSITION_LABELS } from "@/lib/electrical-convergence";
import { systemVoltagePreviewCsv } from "@/lib/electrical-system-voltage";
import { SystemVoltageApplyGate } from "@/components/electrical/system-voltage-apply-gate";
import { LoadSemanticDetailPanel } from "@/components/electrical/load-semantic-detail-panel";
import { RepresentationProposalPanel } from "@/components/electrical/representation-proposal-panel";
import { CategoryCAnalysisPanel } from "@/components/electrical/category-c-analysis-panel";
import { CategoryDAnalysisPanel } from "@/components/electrical/category-d-analysis-panel";
import { ZeroOriginPanel } from "@/components/electrical/zero-origin-panel";
import { DemandVaPlaceholderPanel } from "@/components/electrical/demand-va-placeholder-panel";
import { ConvergenceAccountingPanel } from "@/components/electrical/convergence-accounting-panel";
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
  F: "F — semantic representation difference (nominal vs nameplate voltage, VA calculation basis)",
};

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function NumericSemanticsPanel({
  report,
  onRevalidate,
}: {
  report: ValidationReport;
  onRevalidate?: () => void;
}) {

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
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              download(
                "phase-4.4b-system-voltage-migration-preview.csv",
                systemVoltagePreviewCsv(diag.system_voltage_preview),
                "text/csv",
              )
            }
          >
            <Download className="mr-1 h-3 w-3" /> System-voltage preview CSV
          </Button>
        </div>

      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">Compared cells {diag.compared_cells}</Badge>
          <Badge variant="outline">Agreements {diag.agreements}</Badge>
          {(["A", "B", "C", "D", "E", "F"] as NumericCategory[]).map((c) => (
            <Badge
              key={c}
              variant={category === c ? "default" : "secondary"}
              className="cursor-pointer"
              onClick={() => setCategory(category === c ? "all" : c)}
              title={`Raw ${diag.counts_by_category[c]} · adjudicated ${diag.adjudicated_counts_by_category[c]} · unresolved ${diag.unresolved_counts_by_category[c]}`}
            >
              Raw {c} {diag.counts_by_category[c]} · unresolved{" "}
              {diag.unresolved_counts_by_category[c]}
            </Badge>
          ))}
          <Badge variant="outline">Correctable {diag.plan.length}</Badge>
          <Badge variant="outline">Blocked (NOT NULL) {diag.blocked.length}</Badge>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">
            Canonical corrections pending {diag.disposition_counts.canonical_corrections_pending}
          </Badge>
          <Badge variant="outline">
            Current semantics unresolved {diag.disposition_counts.current_semantics_unresolved}
          </Badge>
          <Badge variant="outline">
            FarmOps corrections pending {diag.disposition_counts.farmops_corrections_pending}
          </Badge>
          <Badge variant="outline">
            Category F representation differences{" "}
            {diag.disposition_counts.semantic_representation_differences}
          </Badge>
          <Badge variant="outline">
            Verification pending{" "}
            {diag.disposition_counts.provenance_or_field_verification_pending}
          </Badge>
          {diag.stale_adjudications.length ? (
            <Badge variant="destructive">
              Stale adjudications {diag.stale_adjudications.length}
            </Badge>
          ) : null}
        </div>

        <div className="rounded-md border p-3 text-xs text-muted-foreground">
          Raw categories are the immutable historical classification; SHA-bound adjudications are
          overlaid as a separate disposition measure and never rewrite the raw comparison. The
          amperage findings are not ordinary engineering disagreements — the canonical{" "}
          <code>Amps</code> field&apos;s electrical meaning is not yet established. MOCP is never
          read as load current (numeric equality with 25 A does not establish semantic identity) and
          MCA is never derived. Verified equipment quantities stay independent:{" "}
          {diag.verified_bryant_quantities.map((q) => `${q.quantity} = ${q.value}`).join("; ")}. No
          writes: neither FarmOps nor the canonical ODS is modified.
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
                  <th className="py-1 pr-3">Raw cat</th>
                  <th className="py-1 pr-3">Entity</th>
                  <th className="py-1 pr-3">Stable ID</th>
                  <th className="py-1 pr-3">Field</th>
                  <th className="py-1 pr-3">ODS</th>
                  <th className="py-1 pr-3">FarmOps</th>
                  <th className="py-1 pr-3">Δ</th>
                  <th className="py-1 pr-3">Adjudication</th>
                  <th className="py-1 pr-3">Current disposition</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 300).map((f, i) => (
                  <tr key={`${f.domain}-${f.stable_id}-${f.farmops_field}-${i}`} className="border-t">
                    <td className="py-1 pr-3">
                      <Badge variant="secondary">{f.raw_category}</Badge>
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
                      {f.adjudicated ? (
                        <>
                          <span className="font-mono">{f.adjudication_classification}</span>
                          {f.preserved.length ? (
                            <ul className="mt-1 list-disc pl-4">
                              {f.preserved.map((p) => (
                                <li key={p}>{p}</li>
                              ))}
                            </ul>
                          ) : null}
                        </>
                      ) : f.stale_adjudication ? (
                        "stale — different workbook SHA, reduces nothing"
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-1 pr-3 text-muted-foreground">
                      <Badge variant={f.unresolved ? "destructive" : "outline"}>
                        {CONVERGENCE_DISPOSITION_LABELS[f.convergence_disposition]}
                      </Badge>
                      <div className="mt-1">
                        {f.artifact_type ? `${NUMERIC_ARTIFACT_LABELS[f.artifact_type]} · ` : ""}
                        {f.adjudication_rationale ?? f.proposed_action}
                      </div>
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

        {diag.system_voltage_preview.rows.length ? (
          <div className="rounded-md border p-3">
            <p className="text-sm font-medium">
              System-voltage migration preview{" "}
              <span className="text-xs font-normal text-muted-foreground">
                read-only — nothing is applied
              </span>
            </p>
            <p className="pt-1 text-xs text-muted-foreground">
              Panel/feeder/branch-run voltage is a <em>system designation</em> (two nominal
              voltages plus phase and wire configuration); a load voltage stays a single
              utilization scalar. Below is each affected record&apos;s current representation next
              to the proposed <code>{diag.system_voltage_preview.proposed_column}</code>{" "}
              representation. Applying it requires explicit authorization; Category E stays
              visible until production data is migrated. Model{" "}
              <code>{diag.system_voltage_preview.model_version}</code>.
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">Stable ID</th>
                    <th className="py-1 pr-3">Entity</th>
                    <th className="py-1 pr-3">ODS</th>
                    <th className="py-1 pr-3">Current FarmOps</th>
                    <th className="py-1 pr-3">Proposed designation</th>
                    <th className="py-1 pr-3">L-N</th>
                    <th className="py-1 pr-3">L-L</th>
                    <th className="py-1 pr-3">φ</th>
                    <th className="py-1 pr-3">Wires</th>
                    <th className="py-1 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {diag.system_voltage_preview.rows.map((p) => (
                    <tr key={`${p.farmops_entity}-${p.stable_id}-${p.farmops_field}`} className="border-t">
                      <td className="py-1 pr-3 font-mono">{p.stable_id}</td>
                      <td className="py-1 pr-3 font-mono">{p.farmops_entity}</td>
                      <td className="py-1 pr-3">{p.ods_raw}</td>
                      <td className="py-1 pr-3">{p.current_representation}</td>
                      <td className="py-1 pr-3">{p.proposed.designation}</td>
                      <td className="py-1 pr-3">{p.proposed.line_neutral_volts}</td>
                      <td className="py-1 pr-3">{p.proposed.line_line_volts}</td>
                      <td className="py-1 pr-3">{p.proposed.phases ?? "—"}</td>
                      <td className="py-1 pr-3">{p.proposed.wires ?? "—"}</td>
                      <td className="py-1 pr-3 text-muted-foreground">{p.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3">
              <SystemVoltageApplyGate
                preview={diag.system_voltage_preview}
                onRevalidate={onRevalidate}
              />
            </div>
          </div>
        ) : null}

        <ConvergenceAccountingPanel diag={diag} />

        <CategoryCAnalysisPanel diag={diag} />

        <DemandVaPlaceholderPanel diag={diag} />

        <CategoryDAnalysisPanel diag={diag} />

        <ZeroOriginPanel diag={diag} onRevalidate={onRevalidate} />


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
        <div className="rounded-md border p-3">
          <p className="text-sm font-medium">
            FS-034 / FS-092 voltage &amp; VA representation proposal{" "}
            <span className="text-xs font-normal text-muted-foreground">
              read-only — nothing is applied
            </span>
          </p>
          <div className="mt-2">
            <RepresentationProposalPanel />
          </div>
        </div>
        <LoadSemanticDetailPanel report={report} diag={diag} />
      </CardContent>
    </Card>
  );
}
