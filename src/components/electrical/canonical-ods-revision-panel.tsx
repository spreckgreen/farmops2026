// Phase 4.4d — controlled canonical ODS revision generation (UI).
//
// Generate a candidate workbook from the authorized baseline plus the Phase 4.4c
// manifest, review the candidate SHA and cell diff, run the full Phase 4.4
// validation against the candidate, and only then promote it by explicit owner
// approval. Generation never overwrites the baseline artifact and never writes
// FarmOps.
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, CircleDashed, Download, ShieldAlert, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { previewCanonicalOdsRevision, type CandidateRevisionResult } from "@/lib/canonical-ods-revision.functions";
import { runElectricalParallelValidation } from "@/lib/electrical-parallel-validation.functions";
import type { ValidationReport } from "@/lib/electrical-parallel-validation";
import { buildAdjudicationBaseline } from "@/lib/electrical-adjudication-baseline.functions";
import type { AdjudicationBaseline } from "@/lib/electrical-adjudication-baseline";
import {
  candidateDiffCsv,
  candidateDiffMarkdown,
  CANONICAL_REVISION_VERSION,
} from "@/lib/electrical-ods-revision";
import {
  candidateRevisionChecks,
  checksPassed,
  type RevisionCheck,
} from "@/lib/electrical-revision-validation";
import {
  canonicalLineage,
  lineageChain,
  promoteCandidate,
  recordProposedRevision,
  type LineageEntry,
} from "@/lib/electrical-canonical-lineage";
import type { FarmOpsLoadRow } from "@/lib/electrical-load-adjudication-production";

function download(name: string, body: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function base64ToBlobPart(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer as ArrayBuffer;
}

const ICON: Record<RevisionCheck["status"], typeof CheckCircle2> = {
  pass: CheckCircle2,
  fail: XCircle,
  pending: CircleDashed,
};

export function CanonicalOdsRevisionPanel({
  baseline,
  baselineFileName,
  baselineBase64,
  farmopsLoads,
}: {
  baseline: AdjudicationBaseline;
  baselineFileName: string;
  baselineBase64: string;
  farmopsLoads: FarmOpsLoadRow[] | undefined;
}) {
  const generate = useServerFn(previewCanonicalOdsRevision);
  const validate = useServerFn(runElectricalParallelValidation);
  const rebuild = useServerFn(buildAdjudicationBaseline);

  const [result, setResult] = useState<CandidateRevisionResult | null>(null);
  const [candidateBaseline, setCandidateBaseline] = useState<AdjudicationBaseline | null>(null);
  const [baselineRun, setBaselineRun] = useState<ValidationReport | null>(null);
  const [candidateRun, setCandidateRun] = useState<ValidationReport | null>(null);
  const [lineage, setLineage] = useState<LineageEntry[]>(() => canonicalLineage());
  const [approver, setApprover] = useState("");

  const farmopsVolts = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const row of farmopsLoads ?? []) out[row.load_id] = row.volts ?? null;
    return out;
  }, [farmopsLoads]);

  const checks = useMemo(
    () =>
      candidateBaseline
        ? candidateRevisionChecks({
            baseline,
            candidate: candidateBaseline,
            farmopsVolts,
            baselineValidation: baselineRun,
            candidateValidation: candidateRun,
          })
        : [],
    [baseline, candidateBaseline, farmopsVolts, baselineRun, candidateRun],
  );

  const run = useMutation({
    mutationFn: async () => {
      const generated = (await generate({
        data: { file_name: baselineFileName, base64: baselineBase64 },
      })) as unknown as CandidateRevisionResult;

      // Immediately run the full Phase 4.4 validation on both workbooks so the
      // candidate is compared like-for-like against the previous baseline run.
      const candidate = (await rebuild({
        data: {
          file_name: generated.report.candidate_file_name,
          base64: generated.candidate_base64,
        },
      })) as unknown as AdjudicationBaseline;
      const before = (await validate({
        data: { file_name: baselineFileName, base64: baselineBase64 },
      })) as unknown as ValidationReport;
      const after = (await validate({
        data: {
          file_name: generated.report.candidate_file_name,
          base64: generated.candidate_base64,
        },
      })) as unknown as ValidationReport;
      return { generated, candidate, before, after };
    },
    onSuccess: ({ generated, candidate, before, after }) => {
      setResult(generated);
      setCandidateBaseline(candidate);
      setBaselineRun(before);
      setCandidateRun(after);
      setLineage(
        recordProposedRevision({
          sha256: generated.report.candidate_sha256,
          file_name: generated.report.candidate_file_name,
          parent_sha256: generated.report.baseline_sha256,
          notes: `Generated from manifest ${generated.report.manifest_version}.`,
        }),
      );
      toast.success("Candidate revision generated — not promoted.");
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Revision generation was refused."),
  });

  const report = result?.report ?? null;
  const validationPassed = checksPassed(checks);
  const acceptancePassed = report?.acceptance.status === "PASS";
  const promoted = lineage.find(
    (e) => e.sha256 === report?.candidate_sha256 && e.status === "CURRENT_CANONICAL_BASELINE",
  );

  const promote = () => {
    if (!report) return;
    const res = promoteCandidate({
      candidate_sha256: report.candidate_sha256,
      approved_by: approver,
      acceptance_passed: acceptancePassed,
      validation_passed: validationPassed,
      notes: `Owner approval after reviewing candidate SHA ${report.candidate_sha256}, the 2-cell diff and the complete Phase 4.4 validation.`,
    });
    if (!res.ok) {
      toast.error(res.reason);
      return;
    }
    setLineage(res.entries);
    toast.success("Candidate promoted to CURRENT_CANONICAL_BASELINE; prior baseline retired.");
  };

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="max-w-3xl space-y-1">
          <p className="text-sm font-medium">Preview new ODS revision</p>
          <p className="text-xs text-muted-foreground">
            Generates a candidate workbook from the authorized baseline plus the Phase 4.4c
            manifest. The input workbook is re-hashed and must be the authorized baseline; FS-082 and
            FS-083 are re-parsed and their raw Volts cells must still read 120; the manifest must
            carry exactly the two approved corrections and four withheld values. Exactly two source
            cells may differ — no other cell, formula, style, sheet, metadata structure, stable ID,
            row ordering or ods_extras content is altered. Revision <code>{CANONICAL_REVISION_VERSION}</code>.
          </p>
        </div>
        <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
          {run.isPending ? "Generating…" : "Preview new ODS revision"}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="secondary">Baseline preserved</Badge>
        <Badge variant="secondary">FarmOps writes 0</Badge>
        <Badge variant="outline">Lineage {lineageChain(lineage)}</Badge>
      </div>

      {report ? (
        <div className="space-y-3">
          <div className="grid gap-1 text-xs sm:grid-cols-2">
            <p>
              <span className="text-muted-foreground">Status: </span>
              <Badge variant={promoted ? "default" : "outline"}>
                {promoted ? "CURRENT_CANONICAL_BASELINE" : report.status}
              </Badge>
            </p>
            <p>
              <span className="text-muted-foreground">Generated: </span>
              {report.generated_at}
            </p>
            <p className="break-all">
              <span className="text-muted-foreground">Baseline SHA-256: </span>
              <span className="font-mono">{report.baseline_sha256}</span>
            </p>
            <p className="break-all">
              <span className="text-muted-foreground">Candidate SHA-256: </span>
              <span className="font-mono">{report.candidate_sha256}</span>
            </p>
            <p className="break-all">
              <span className="text-muted-foreground">Source manifest: </span>
              <span className="font-mono">{report.manifest_version}</span> ·{" "}
              <span className="font-mono">{report.manifest_sha256}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Lineage on promotion: </span>
              <span className="font-mono">
                {report.lineage.superseded_sha256.slice(0, 6)}…{report.lineage.superseded_sha256.slice(-4)}
              </span>{" "}
              →{" "}
              <span className="font-mono">
                {report.candidate_sha256.slice(0, 6)}…{report.candidate_sha256.slice(-4)}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant={report.counts.authorized_changed_cells === 2 ? "default" : "destructive"}>
              Authorized changed cells {report.counts.authorized_changed_cells}
            </Badge>
            <Badge variant={report.counts.unauthorized_changed_cells === 0 ? "secondary" : "destructive"}>
              Unauthorized changed cells {report.counts.unauthorized_changed_cells}
            </Badge>
            <Badge variant={report.counts.withheld_values_changed === 0 ? "secondary" : "destructive"}>
              Withheld values changed {report.counts.withheld_values_changed}
            </Badge>
            <Badge variant={acceptancePassed ? "default" : "destructive"}>
              Acceptance {report.acceptance.status}
            </Badge>
          </div>
          {report.acceptance.reasons.length ? (
            <ul className="list-disc space-y-1 pl-5 text-xs text-destructive">
              {report.acceptance.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Stable ID</th>
                  <th className="py-1 pr-3">Worksheet</th>
                  <th className="py-1 pr-3">Row</th>
                  <th className="py-1 pr-3">Field</th>
                  <th className="py-1 pr-3">Baseline value</th>
                  <th className="py-1 pr-3">Candidate value</th>
                  <th className="py-1 pr-3">Authorized?</th>
                </tr>
              </thead>
              <tbody>
                {report.changes.map((c) => (
                  <tr key={`${c.worksheet}|${c.row}|${c.column}`} className="border-t">
                    <td className="py-1 pr-3 font-mono">{c.stable_id ?? "—"}</td>
                    <td className="py-1 pr-3">{c.worksheet}</td>
                    <td className="py-1 pr-3">{c.row}</td>
                    <td className="py-1 pr-3 font-mono">{c.field}</td>
                    <td className="py-1 pr-3">{c.baseline_value}</td>
                    <td className="py-1 pr-3">{c.candidate_value}</td>
                    <td className="py-1 pr-3">
                      <Badge variant={c.authorized ? "secondary" : "destructive"}>
                        {c.authorized ? "yes" : "NO"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {report.target_traces.length ? (
            <div>
              <p className="text-xs font-medium">
                Pre-mutation target assertions (parser addressing)
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3">Stable ID</th>
                      <th className="py-1 pr-3">Logical row</th>
                      <th className="py-1 pr-3">Logical col / field</th>
                      <th className="py-1 pr-3">XML row</th>
                      <th className="py-1 pr-3">XML cell idx</th>
                      <th className="py-1 pr-3">Col-repeat offset</th>
                      <th className="py-1 pr-3">Value type</th>
                      <th className="py-1 pr-3">office:value</th>
                      <th className="py-1 pr-3">Display</th>
                      <th className="py-1 pr-3">Assertion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.target_traces.map((t) => (
                      <tr key={`${t.worksheet}|${t.logical_row}|${t.logical_column}`} className="border-t">
                        <td className="py-1 pr-3 font-mono">{t.stable_id ?? "—"}</td>
                        <td className="py-1 pr-3">{t.logical_row}</td>
                        <td className="py-1 pr-3">
                          {t.logical_column} / <span className="font-mono">{t.field ?? "—"}</span>
                        </td>
                        <td className="py-1 pr-3">{t.physical_xml_row ?? "—"}</td>
                        <td className="py-1 pr-3">{t.physical_xml_cell_index ?? "—"}</td>
                        <td className="py-1 pr-3">
                          {t.repeated_column_offset ?? "—"} of {t.column_repeat ?? "—"}
                        </td>
                        <td className="py-1 pr-3 font-mono">{t.value_type ?? "—"}</td>
                        <td className="py-1 pr-3 font-mono">{t.office_value ?? "—"}</td>
                        <td className="py-1 pr-3 font-mono">{t.display_text ?? "—"}</td>
                        <td className="py-1 pr-3">
                          <Badge variant={t.assertion === "PASS" ? "secondary" : "destructive"}>
                            {t.assertion}
                          </Badge>
                          {t.reason ? (
                            <span className="block text-muted-foreground">{t.reason}</span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}


          <div>
            <p className="text-xs font-medium">Withheld values (must remain unchanged)</p>
            <ul className="pt-1 text-xs text-muted-foreground">
              {report.withheld.map((w) => (
                <li key={`${w.stable_id}|${w.field}`}>
                  {w.stable_id} <span className="font-mono">{w.field}</span>:{" "}
                  {w.baseline_value ?? "not stated"} → {w.candidate_value ?? "not stated"}{" "}
                  {w.unchanged ? "(unchanged)" : "(CHANGED — acceptance fails)"}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-medium">
              Full Phase 4.4 validation of the candidate against the current FarmOps snapshot
            </p>
            <ul className="space-y-1 pt-1 text-xs">
              {checks.map((c) => {
                const Icon = ICON[c.status];
                return (
                  <li key={c.id} className="flex gap-2">
                    <Icon
                      className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                        c.status === "pass"
                          ? "text-primary"
                          : c.status === "fail"
                            ? "text-destructive"
                            : "text-muted-foreground"
                      }`}
                    />
                    <span>
                      {c.label} — <span className="text-muted-foreground">{c.detail}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                download(
                  report.candidate_file_name,
                  base64ToBlobPart(result!.candidate_base64),
                  "application/vnd.oasis.opendocument.spreadsheet",
                )
              }
            >
              <Download className="mr-1 h-3 w-3" /> Candidate .ods
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                download("phase-4.4d-candidate-diff.csv", candidateDiffCsv(report), "text/csv")
              }
            >
              <Download className="mr-1 h-3 w-3" /> Diff CSV
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                download(
                  "phase-4.4d-candidate-diff.md",
                  candidateDiffMarkdown(report),
                  "text/markdown",
                )
              }
            >
              <Download className="mr-1 h-3 w-3" /> Diff MD
            </Button>
          </div>

          <div className="rounded-md border border-dashed p-2">
            <p className="flex items-center gap-2 text-xs font-medium">
              <ShieldAlert className="h-3.5 w-3.5" /> Promotion to CURRENT_CANONICAL_BASELINE
            </p>
            <p className="pt-1 text-xs text-muted-foreground">
              Separate explicit owner approval, allowed only after the candidate SHA, the cell diff
              and the complete validation results have been reviewed. The previous baseline is
              retired as superseded — never deleted — and all prior reconciliation reports stay in
              place. Promotion does not authorize a Phase 4.5 cutover.
            </p>
            {promoted ? (
              <p className="pt-2 text-xs">
                Promoted by <span className="font-medium">{promoted.approved_by}</span> at{" "}
                {promoted.approved_at}.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Input
                  className="h-8 max-w-xs text-xs"
                  placeholder="Owner approval name"
                  value={approver}
                  onChange={(e) => setApprover(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={!acceptancePassed || !validationPassed || !approver.trim()}
                  onClick={promote}
                >
                  Promote candidate as canonical
                </Button>
                {!acceptancePassed || !validationPassed ? (
                  <span className="text-xs text-muted-foreground">
                    Promotion stays blocked until acceptance is 2 / 0 / 0 and every validation
                    confirmation passes.
                  </span>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}

      <div>
        <p className="text-xs font-medium">Baseline lineage (append-only, nothing deleted)</p>
        <ul className="pt-1 text-xs text-muted-foreground">
          {lineage.map((e) => (
            <li key={e.sha256} className="break-all">
              <span className="font-mono">{e.sha256}</span> — {e.status}
              {e.parent_sha256 ? (
                <>
                  {" "}
                  (from <span className="font-mono">{e.parent_sha256.slice(0, 12)}…</span>)
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
