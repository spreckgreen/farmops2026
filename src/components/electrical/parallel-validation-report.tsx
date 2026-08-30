// Phase 4.4 — read-only parallel validation report.
//
// Upload the canonical workbook, get a semantic comparison against the FarmOps
// electrical model. Nothing is written: the workbook is read only and no
// electrical record is modified by running a comparison.
import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { runElectricalParallelValidation } from "@/lib/electrical-parallel-validation.functions";
import {
  CLASSIFICATIONS,
  CLASSIFICATION_LABELS,
  NORMALIZATION_RULES,
  serializeValidationReport,
  validationCsv,
  validationFilename,
  validationMarkdown,
  type Classification,
  type ValidationReport,
} from "@/lib/electrical-parallel-validation";
import {
  RECONCILIATION_FILES,
  conflictsCsv,
  lossDiagnosticsCsv,
  reconciliationJson,
  reconciliationMarkdown,
  unresolvedCsv,
} from "@/lib/electrical-reconciliation";
import {
  booleanDiagnostics,
  booleanDiagnosticsCsv,
  booleanRecordCsv,
  categoryACorrectionPlan,
  correctionPlanCsv,
} from "@/lib/electrical-boolean-diagnostics";
import { previewBooleanCorrection } from "@/lib/electrical-boolean-correction.functions";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

const BLOCKING: Classification[] = ["LOSS", "CONFLICT"];

export function ParallelValidationReport() {
  const run = useServerFn(runElectricalParallelValidation);
  const fileRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [cls, setCls] = useState<Classification | "all">("all");
  const [domain, setDomain] = useState<string>("all");
  const [search, setSearch] = useState("");

  const compare = useMutation({
    mutationFn: async (file: File) =>
      run({ data: { file_name: file.name, base64: await readAsBase64(file) } }) as unknown as Promise<ValidationReport>,
    onSuccess: (r) => {
      setReport(r);
      toast.success(
        `Compared ${r.records.length} engineering facts — ${r.summary.LOSS} semantic loss, ${r.summary.CONFLICT} conflict(s).`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo(() => {
    const all = report?.records ?? [];
    const q = search.trim().toLowerCase();
    return all.filter(
      (r) =>
        (cls === "all" || r.classification === cls) &&
        (domain === "all" || r.domain === domain) &&
        (!q ||
          r.stable_id.toLowerCase().includes(q) ||
          r.field.toLowerCase().includes(q) ||
          r.label.toLowerCase().includes(q) ||
          (r.ods_worksheet ?? "").toLowerCase().includes(q) ||
          r.authority.toLowerCase().includes(q)),
    );
  }, [report, cls, domain, search]);

  const domains = report ? Object.keys(report.by_domain) : [];

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 pb-2">
          <div>
            <CardTitle className="text-base">Phase 4.4 — Lossless parallel validation</CardTitle>
            <p className="text-sm text-muted-foreground">
              Select the canonical <span className="font-mono">PremoFarmElectrical.ods</span> to
              compare engineering meaning against the FarmOps electrical model. The workbook is read
              only, no electrical record is modified, and FarmOps remains the candidate System of
              Record.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".ods,application/vnd.oasis.opendocument.spreadsheet"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) compare.mutate(f);
                e.target.value = "";
              }}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={compare.isPending}
            >
              <FileSpreadsheet className="h-4 w-4 mr-1" />
              {compare.isPending ? "Comparing…" : "Choose .ods"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!report}
              onClick={() =>
                report &&
                download(
                  validationFilename(report.compared_at, "json"),
                  serializeValidationReport(report),
                  "application/json",
                )
              }
            >
              <Download className="h-4 w-4 mr-1" />
              JSON
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!report}
              onClick={() =>
                report &&
                download(
                  validationFilename(report.compared_at, "csv"),
                  validationCsv(report),
                  "text/csv",
                )
              }
            >
              <Download className="h-4 w-4 mr-1" />
              CSV
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!report}
              onClick={() =>
                report &&
                download(
                  validationFilename(report.compared_at, "md"),
                  validationMarkdown(report),
                  "text/markdown",
                )
              }
            >
              <Download className="h-4 w-4 mr-1" />
              Markdown
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!report}
              onClick={() => {
                if (!report) return;
                download(
                  RECONCILIATION_FILES.markdown,
                  reconciliationMarkdown(report),
                  "text/markdown",
                );
                download(RECONCILIATION_FILES.json, reconciliationJson(report), "application/json");
                download(RECONCILIATION_FILES.conflicts, conflictsCsv(report), "text/csv");
                download(RECONCILIATION_FILES.unresolved, unresolvedCsv(report), "text/csv");
                download(RECONCILIATION_FILES.loss, lossDiagnosticsCsv(report), "text/csv");
              }}
            >
              <Download className="h-4 w-4 mr-1" />
              Phase 4.4a artifacts
            </Button>

          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {!report ? (
            <p className="text-sm text-muted-foreground">
              No comparison yet. Running one performs no database writes and never modifies the
              canonical workbook.
            </p>
          ) : (
            <>
              <div className="grid gap-1 sm:grid-cols-2">
                <Row label="ODS baseline" value={report.ods.file_name} />
                <Row label="ODS SHA-256" value={report.ods.sha256} />
                <Row label="FarmOps snapshot" value={report.farmops.snapshot_generated_at} />
                <Row label="Snapshot schema" value={report.farmops.snapshot_schema_version} />
                <Row label="Report schema" value={report.schema_version} />
                <Row label="Mapping version" value={report.mapping_version} />
                <Row label="Normalization version" value={report.normalization_version} />
                <Row label="SOR authority" value={report.sor_authority} />
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                {CLASSIFICATIONS.map((c) => (
                  <Badge
                    key={c}
                    variant={
                      BLOCKING.includes(c) && report.summary[c] > 0 ? "destructive" : "outline"
                    }
                  >
                    {CLASSIFICATION_LABELS[c]}: {report.summary[c]}
                  </Badge>
                ))}
              </div>

              <div className="rounded-md border p-2 text-xs space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Phase 4.4a acceptance gate</span>
                  <Badge variant={report.gate.status === "PASS" ? "outline" : "destructive"}>
                    {report.gate.status}
                  </Badge>
                </div>
                <p className="text-muted-foreground">
                  Semantic loss {report.gate.loss} (must be 0) · unexplained ODS-only{" "}
                  {report.gate.unexplained_ods_only} (must be 0) · unexplained{" "}
                  {report.gate.unexplained} · awaiting a human decision{" "}
                  {report.gate.open_dispositions}
                </p>
                {report.gate.reasons.map((r) => (
                  <p key={r} className="text-destructive">
                    {r}
                  </p>
                ))}
                <p className="text-muted-foreground">
                  FarmOps-only buckets — A {report.farmops_only_by_category.A} · B{" "}
                  {report.farmops_only_by_category.B} · C {report.farmops_only_by_category.C} · D{" "}
                  {report.farmops_only_by_category.D} · E {report.farmops_only_by_category.E}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Semantic loss must be zero before a Phase 4.5 cutover can even be considered. Every
                conflict and every ODS-only value has to be dispositioned individually — this report
                does not decide either value for you.
              </p>

            </>
          )}
        </CardContent>
      </Card>

      {report ? (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Differences</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={cls === "all" ? "default" : "outline"}
                  onClick={() => setCls("all")}
                >
                  All ({report.records.length})
                </Button>
                {CLASSIFICATIONS.filter((c) => report.summary[c] > 0).map((c) => (
                  <Button
                    key={c}
                    size="sm"
                    variant={cls === c ? "default" : "outline"}
                    onClick={() => setCls(c)}
                  >
                    {CLASSIFICATION_LABELS[c]} ({report.summary[c]})
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={domain === "all" ? "secondary" : "ghost"}
                  onClick={() => setDomain("all")}
                >
                  All entities
                </Button>
                {domains.map((d) => (
                  <Button
                    key={d}
                    size="sm"
                    variant={domain === d ? "secondary" : "ghost"}
                    onClick={() => setDomain(d)}
                  >
                    {d}
                  </Button>
                ))}
              </div>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by stable ID, field, worksheet or authority…"
                className="max-w-md"
              />

              {rows.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr className="text-left">
                        <th className="py-1 pr-3">Entity</th>
                        <th className="py-1 pr-3">Stable ID</th>
                        <th className="py-1 pr-3">Field</th>
                        <th className="py-1 pr-3">ODS (worksheet / column / value)</th>
                        <th className="py-1 pr-3">FarmOps (entity / field / value)</th>
                        <th className="py-1 pr-3">Authority</th>
                        <th className="py-1 pr-3">Classification</th>
                        <th className="py-1">Explanation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 1000).map((r, i) => (
                        <tr key={`${r.domain}-${r.stable_id}-${r.field}-${i}`} className="border-t border-border align-top">
                          <td className="py-1 pr-3 font-mono">{r.domain}</td>
                          <td className="py-1 pr-3 font-mono">{r.stable_id}</td>
                          <td className="py-1 pr-3">{r.label}</td>
                          <td className="py-1 pr-3 font-mono">
                            {[r.ods_worksheet, r.ods_column].filter(Boolean).join(" / ") || "—"}
                            <div className="text-foreground">{r.ods_value || "(blank)"}</div>
                          </td>
                          <td className="py-1 pr-3 font-mono">
                            {[r.farmops_entity, r.farmops_field].filter(Boolean).join(" / ") || "—"}
                            <div className="text-foreground">{r.farmops_value || "(blank)"}</div>
                          </td>
                          <td className="py-1 pr-3">{r.authority}</td>
                          <td className="py-1 pr-3">
                            <Badge
                              variant={
                                BLOCKING.includes(r.classification) ? "destructive" : "outline"
                              }
                            >
                              {r.classification}
                            </Badge>
                          </td>
                          <td className="py-1 text-muted-foreground">
                            {r.note}
                            {r.rules.length ? (
                              <div className="font-mono">{r.rules.join(", ")}</div>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rows.length > 1000 ? (
                    <p className="pt-2 text-xs text-muted-foreground">
                      Showing the first 1000 of {rows.length} rows — download the JSON or CSV for
                      the complete report.
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No comparison rows match this filter.
                </p>
              )}
            </CardContent>
          </Card>

          <BooleanSemanticsPanel report={report} />

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Normalization rules applied</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {NORMALIZATION_RULES.map((r) => (
                  <li key={r.id}>
                    <span className="font-mono text-foreground">{r.id}</span> — {r.description}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

/**
 * Phase 4.4b Task 1B — group the boolean_or_default_semantics conflicts by
 * provenance and classify each as A (implementation artifact), B (engineering
 * disagreement), C (not representable as boolean) or D (provenance
 * insufficient). Only Category A is offered to the preview-first correction
 * tool; everything else is read-only.
 */
function BooleanSemanticsPanel({ report }: { report: ValidationReport }) {
  const diag = useMemo(() => booleanDiagnostics(report), [report]);
  const plan = useMemo(() => categoryACorrectionPlan(diag), [diag]);
  const preview = useServerFn(previewBooleanCorrection);
  const [previewed, setPreviewed] = useState<Awaited<ReturnType<typeof preview>> | null>(null);

  const run = useMutation({
    mutationFn: (confirm: boolean) =>
      preview({
        data: {
          confirm,
          entries: plan.entries.map((e) => ({
            table: e.table,
            stable_id: e.stable_id,
            column: e.column,
            expected_current: e.current_value === "true" ? true : e.current_value === "false" ? false : null,
            proposed_value: e.proposed_value,
            evidence: e.evidence.slice(0, 500),
          })),
        },
      }),
    onSuccess: (result) => {
      setPreviewed(result);
      toast.success(
        result.applied
          ? `Applied ${result.changed} Yes/No correction(s).`
          : `Preview: ${result.changed} record(s) would change, ${result.skipped} skipped.`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (diag.total_findings === 0) return null;
  const c = diag.counts_by_category;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-base">
          Yes/No semantics diagnostics ({diag.total_findings})
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              download("phase-4.4b-boolean-groups.csv", booleanDiagnosticsCsv(diag), "text/csv")
            }
          >
            <Download className="mr-1 h-4 w-4" />
            Groups CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              download("phase-4.4b-boolean-records.csv", booleanRecordCsv(diag), "text/csv")
            }
          >
            <Download className="mr-1 h-4 w-4" />
            Stable-ID CSV
          </Button>
          {plan.entries.length ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                download("phase-4.4b-category-a-plan.csv", correctionPlanCsv(plan), "text/csv")
              }
            >
              <Download className="mr-1 h-4 w-4" />
              Category-A plan
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="destructive">A implementation artifact: {c.A}</Badge>
          <Badge variant="outline">B engineering disagreement: {c.B}</Badge>
          <Badge variant="outline">C not representable as Yes/No: {c.C}</Badge>
          <Badge variant="outline">D provenance insufficient: {c.D}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Only Category A is eligible for automatic correction. Categories B, C and D stay
          untouched and require human disposition. Corrections are preview-first and change only
          the affected Yes/No column.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border text-left">
                <th className="px-2 py-1">Cat</th>
                <th className="px-2 py-1">Entity</th>
                <th className="px-2 py-1">Field</th>
                <th className="px-2 py-1">ODS</th>
                <th className="px-2 py-1">FarmOps</th>
                <th className="px-2 py-1">Provenance</th>
                <th className="px-2 py-1">Old default/coercion</th>
                <th className="px-2 py-1">Records</th>
                <th className="px-2 py-1">Proposed action</th>
              </tr>
            </thead>
            <tbody>
              {diag.groups.map((g) => (
                <tr
                  key={[g.domain, g.field, g.ods_value, g.farmops_value, g.default_source].join("|")}
                  className="border-b border-border last:border-0 align-top"
                >
                  <td className="px-2 py-1">
                    <Badge variant={g.category === "A" ? "destructive" : "outline"}>{g.category}</Badge>
                  </td>
                  <td className="px-2 py-1 font-mono">{g.domain}</td>
                  <td className="px-2 py-1 font-mono">{g.field}</td>
                  <td className="px-2 py-1">
                    {g.ods_value || <span className="text-muted-foreground">(blank)</span>}{" "}
                    <span className="text-muted-foreground">→ {g.ods_meaning}</span>
                  </td>
                  <td className="px-2 py-1 font-mono">{g.farmops_value}</td>
                  <td className="px-2 py-1 text-muted-foreground">{g.provenance}</td>
                  <td className="px-2 py-1 text-muted-foreground">{g.legacy_behavior}</td>
                  <td className="px-2 py-1 font-mono">{g.affected_records}</td>
                  <td className="px-2 py-1 text-muted-foreground">{g.proposed_correction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {plan.entries.length ? (
          <div className="space-y-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                Category-A correction set: {plan.entries.length} record(s) across{" "}
                {new Set(plan.entries.map((e) => `${e.table}.${e.column}`)).size} field(s).
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate(false)}>
                  Preview
                </Button>
                <Button
                  size="sm"
                  disabled={run.isPending || !previewed || previewed.applied || previewed.changed === 0}
                  onClick={() => run.mutate(true)}
                >
                  Apply {previewed && !previewed.applied ? previewed.changed : ""}
                </Button>
              </div>
            </div>
            {plan.unmappable.length ? (
              <p className="text-xs text-muted-foreground">
                Not correctable automatically (no writable column): {plan.unmappable.join(", ")}
              </p>
            ) : null}
            {previewed ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border text-left">
                      <th className="px-2 py-1">Stable ID</th>
                      <th className="px-2 py-1">Field</th>
                      <th className="px-2 py-1">Current</th>
                      <th className="px-2 py-1">ODS</th>
                      <th className="px-2 py-1">Proposed</th>
                      <th className="px-2 py-1">Status</th>
                      <th className="px-2 py-1">Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewed.rows.slice(0, 300).map((r, i) => (
                      <tr key={`${r.table}-${r.stable_id}-${r.column}-${i}`} className="border-b border-border last:border-0 align-top">
                        <td className="px-2 py-1 font-mono">{r.stable_id}</td>
                        <td className="px-2 py-1 font-mono">{r.column}</td>
                        <td className="px-2 py-1 font-mono">{String(r.live_value)}</td>
                        <td className="px-2 py-1">
                          {plan.entries.find((e) => e.stable_id === r.stable_id && e.column === r.column)
                            ?.ods_value || "(blank)"}
                        </td>
                        <td className="px-2 py-1 font-mono">
                          {r.proposed_value === null ? "null (not stated)" : String(r.proposed_value)}
                        </td>
                        <td className="px-2 py-1">
                          <Badge variant={r.status === "failed" || r.status === "drifted" ? "destructive" : "outline"}>
                            {r.status}
                          </Badge>
                        </td>
                        <td className="px-2 py-1 text-muted-foreground">{r.detail ?? r.evidence}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No Category-A records with provable implementation provenance — no production backfill
            is justified from this run.
          </p>
        )}
      </CardContent>
    </Card>
  );
}


function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-1 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="break-all font-mono text-xs text-foreground">{value}</span>
    </div>
  );
}
