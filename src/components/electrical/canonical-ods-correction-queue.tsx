// Phase 4.4b — canonical ODS correction queue (read-only UI).
//
// Findings where the canonical workbook is the record in error and the FarmOps
// as-built value is the supported engineering value. There is deliberately no
// apply control: this view neither writes FarmOps nor edits the ODS. Approved
// engineering corrections leave here as an export and are applied to the
// canonical workbook through the controlled ODS workflow.
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  buildCanonicalOdsCorrectionQueue,
  canonicalOdsCorrectionQueueCsv,
  canonicalOdsCorrectionQueueMarkdown,
  CANONICAL_ODS_CORRECTION_QUEUE_VERSION,
} from "@/lib/electrical-canonical-ods-correction-queue";
import type { AdjudicationBaseline } from "@/lib/electrical-adjudication-baseline";
import type { LoadAdjudicationReport } from "@/lib/electrical-load-adjudication";

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function CanonicalOdsCorrectionQueue({
  report,
  baseline,
}: {
  report: LoadAdjudicationReport;
  baseline: AdjudicationBaseline;
}) {
  const queue = buildCanonicalOdsCorrectionQueue(report, baseline);

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="max-w-3xl">
          <p className="text-sm font-medium">
            Canonical ODS correction queue{" "}
            <span className="text-xs font-normal text-muted-foreground">
              read-only — no FarmOps write, no ODS edit
            </span>
          </p>
          <p className="pt-1 text-xs text-muted-foreground">
            Items classified{" "}
            <code>CANONICAL_ODS_VALUE_INCOMPATIBLE_WITH_VERIFIED_EQUIPMENT</code> with disposition{" "}
            <code>CANONICAL_ODS_CORRECTION_REQUIRED</code>: the canonical workbook value is
            incompatible with the verified equipment while the FarmOps as-built value is the
            supported engineering value. The ODS observed value, the FarmOps as-built value, the
            equipment rating and the canonical correction candidate are preserved independently, with
            the workbook name, worksheet/row and SHA-256. Nothing here is applied — approved
            engineering corrections go to the canonical workbook through the controlled ODS
            workflow. Amperage findings are out of scope: no load current is inferred from an MOCP
            figure, and FS-084's ODS-versus-MOCP difference stays a separate semantic/provenance
            investigation. Queue <code>{CANONICAL_ODS_CORRECTION_QUEUE_VERSION}</code>.
          </p>
        </div>
        {queue.items.length ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                download(
                  "phase-4.4b-canonical-ods-correction-queue.csv",
                  canonicalOdsCorrectionQueueCsv(queue),
                  "text/csv",
                )
              }
            >
              <Download className="mr-1 h-3 w-3" /> Queue CSV
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                download(
                  "phase-4.4b-canonical-ods-correction-queue.md",
                  canonicalOdsCorrectionQueueMarkdown(queue),
                  "text/markdown",
                )
              }
            >
              <Download className="mr-1 h-3 w-3" /> Queue MD
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2 pt-3 text-xs">
        <Badge variant="outline">Items {queue.items.length}</Badge>
        <Badge variant="secondary">FarmOps writes 0</Badge>
        <Badge variant="secondary">ODS edits 0</Badge>
      </div>

      {queue.items.length ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Stable ID</th>
                <th className="py-1 pr-3">Field</th>
                <th className="py-1 pr-3">ODS observed</th>
                <th className="py-1 pr-3">FarmOps as-built</th>
                <th className="py-1 pr-3">Verified equipment rating</th>
                <th className="py-1 pr-3">Canonical correction candidate</th>
                <th className="py-1 pr-3">Workbook · worksheet/row · SHA-256</th>
                <th className="py-1 pr-3">Disposition</th>
              </tr>
            </thead>
            <tbody>
              {queue.items.map((i) => (
                <tr key={`${i.stable_id}|${i.field}`} className="border-t align-top">
                  <td className="py-1 pr-3 font-mono">{i.stable_id}</td>
                  <td className="py-1 pr-3 font-mono">{i.field}</td>
                  <td className="py-1 pr-3">
                    {i.ods_observed_value ?? "not stated"} {i.unit}
                  </td>
                  <td className="py-1 pr-3">
                    {i.farmops_as_built_value ?? "not stated"} {i.unit}{" "}
                    <span className="text-muted-foreground">(unchanged)</span>
                  </td>
                  <td className="py-1 pr-3">{i.equipment_rating}</td>
                  <td className="py-1 pr-3">
                    {i.canonical_correction_candidate ?? "not established"} {i.unit}
                  </td>
                  <td className="py-1 pr-3 break-all">
                    <span className="font-mono">{i.workbook_name}</span> ·{" "}
                    {i.worksheet ?? "worksheet not parsed"} row {i.worksheet_row ?? "?"} ·{" "}
                    <span className="font-mono">{i.workbook_sha256}</span>
                  </td>
                  <td className="py-1 pr-3">
                    <Badge variant="outline">{i.disposition}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 rounded-md border border-dashed p-2 text-xs text-muted-foreground">
          No canonical-source corrections are queued for the attached workbook.
        </p>
      )}
    </div>
  );
}
