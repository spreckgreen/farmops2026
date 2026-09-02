// Phase 4.4b — connected_va zero-artifact correction gate UI.
//
// Preview re-reads the live loads and reports what would change. Apply requires
// explicit confirmation plus per-row approval and writes only
// `electrical_loads.connected_va` numeric 0 → NULL: removal of an unsupported
// assertion, never the calculation of a VA value.
import { useState } from "react";
import { Download } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  applyConnectedVaZeroCorrection,
  previewConnectedVaZeroCorrection,
  type ConnectedVaZeroGateResult,
} from "@/lib/electrical-connected-va-zero.functions";
import {
  CONNECTED_VA_ZERO_GATE_VERSION,
  connectedVaZeroGateCsv,
  connectedVaZeroGateKey,
  connectedVaZeroGateMarkdown,
  EXCLUDED_LOAD_IDS,
  EXPECTED_AUTHORIZED_ROWS,
} from "@/lib/electrical-connected-va-zero-gate";
import { useCanonicalWorkbookSession } from "@/hooks/use-canonical-workbook-session";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function ConnectedVaZeroGate({ onRevalidate }: { onRevalidate?: () => void }) {
  const runPreview = useServerFn(previewConnectedVaZeroCorrection);
  const runApply = useServerFn(applyConnectedVaZeroCorrection);
  const { availability } = useCanonicalWorkbookSession();
  const [result, setResult] = useState<ConnectedVaZeroGateResult | null>(null);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState(false);

  const workbook =
    availability.state === "available"
      ? {
          file_name: availability.meta.file_name,
          base64: availability.base64,
          authorized: availability.meta.baseline_authorized,
        }
      : null;

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!workbook) throw new Error("Attach the canonical .ods workbook first.");
      return runPreview({
        data: { file_name: workbook.file_name, base64: workbook.base64 },
      }) as unknown as Promise<ConnectedVaZeroGateResult>;
    },
    onSuccess: (r) => {
      setResult(r);
      setConfirmed(false);
      setApproved(
        new Set(
          r.rows
            .filter((row) => row.status === "would_change")
            .map((row) => connectedVaZeroGateKey({ table: row.table, stable_id: row.stable_id })),
        ),
      );
      toast.success(`${r.summary.would_change} row(s) would change, ${r.skipped} skipped.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!workbook?.authorized) {
        throw new Error(
          "Canonical evidence must come from the authorized Phase 4.4a baseline workbook.",
        );
      }
      return runApply({
        data: {
          file_name: workbook.file_name,
          base64: workbook.base64,
          confirm: true,
          approved: [...approved],
        },
      }) as unknown as Promise<ConnectedVaZeroGateResult>;
    },
    onSuccess: (r) => {
      setResult(r);
      setConfirmed(false);
      toast.success(`Removed ${r.summary.applied} unsupported zero(s); ${r.skipped} skipped.`);
      onRevalidate?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = result?.rows ?? [];
  const summary = result?.summary;

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="max-w-3xl">
          <p className="text-sm font-medium">
            connected VA zero-artifact correction gate{" "}
            <span className="text-xs font-normal text-muted-foreground">
              {result?.applied ? "applied" : "preview — nothing written yet"}
            </span>
          </p>
          <p className="pt-1 text-xs text-muted-foreground">
            Scope: the {EXPECTED_AUTHORIZED_ROWS} SHA-bound{" "}
            <code>electrical_loads.connected_va</code> findings whose canonical ODS cell is blank,
            whose FarmOps value is numeric 0, which were created in the same bulk batch with no
            source reference, no field-level audit evidence and no import snapshot establishing an
            explicit zero — zero origin{" "}
            <code>DEFAULTED_OR_COERCED_FROM_BLANK_NULL_OR_TEXT</code>, disposition{" "}
            <code>ZERO_DEFAULT_OR_COERCION_ARTIFACT</code>. The correction is{" "}
            <strong>0 → NULL</strong>: removal of an unsupported assertion, not the calculation of a
            load value. No VA is populated. Voltage, amps, demand VA, breaker data, equipment
            provenance, topology, notes, source references and the canonical ODS are never modified;{" "}
            {EXCLUDED_LOAD_IDS.join(", ")} and the PNL-H1 bus rating / spaces cases stay out of
            scope. Before each write the live row is re-read by UUID and the stable ID, the exact
            numeric 0, the blank canonical cell, the zero-origin adjudication and the absence of
            newer evidence are all re-verified. Each applied row keeps an audit record stating the
            removed zero was an unsupported import/default artifact; the raw finding and
            adjudication history are retained. Gate <code>{CONNECTED_VA_ZERO_GATE_VERSION}</code>.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!workbook || previewMutation.isPending}
            onClick={() => previewMutation.mutate()}
          >
            {previewMutation.isPending ? "Checking…" : "Preview against live data"}
          </Button>
          <Button
            size="sm"
            disabled={
              !workbook?.authorized ||
              !result ||
              !confirmed ||
              approved.size === 0 ||
              applyMutation.isPending
            }
            onClick={() => applyMutation.mutate()}
          >
            {applyMutation.isPending ? "Applying…" : `Apply ${approved.size} approved`}
          </Button>
          {rows.length ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  download(
                    `phase-4.4b-connected-va-zero-${result?.applied ? "apply" : "preview"}.csv`,
                    connectedVaZeroGateCsv(rows),
                    "text/csv",
                  )
                }
              >
                <Download className="mr-1 h-3 w-3" /> Report CSV
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  download(
                    `phase-4.4b-connected-va-zero-${result?.applied ? "apply" : "preview"}.md`,
                    connectedVaZeroGateMarkdown(rows, summary!, {
                      applied: Boolean(result?.applied),
                      generated_at: result?.generated_at ?? new Date().toISOString(),
                    }),
                    "text/markdown",
                  )
                }
              >
                <Download className="mr-1 h-3 w-3" /> Report MD
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {!workbook ? (
        <p className="mt-3 rounded-md border border-dashed p-2 text-xs text-muted-foreground">
          {availability.state === "reattach_required"
            ? `The workbook validated in this session (${availability.meta.file_name}) is known, but its bytes are gone after the reload. Reattach it under Parallel Validation or Load adjudication, then preview again.`
            : "Attach the canonical .ods workbook under Parallel Validation or Load adjudication. Without SHA-verified canonical evidence this gate will neither preview nor apply."}
        </p>
      ) : !workbook.authorized ? (
        <p className="mt-3 rounded-md border border-destructive/50 p-2 text-xs text-destructive">
          The attached workbook is not the authorized Phase 4.4a baseline. Preview is read-only and
          apply is refused.
        </p>
      ) : null}

      {result ? (
        <p className="mt-3 break-all text-xs text-muted-foreground">
          Canonical evidence: <span className="font-mono">{result.baseline.ods_file_name}</span>{" "}
          SHA-256 <span className="font-mono">{result.baseline.ods_sha256}</span>{" "}
          {result.baseline.authorized
            ? "— authorized Phase 4.4a baseline."
            : `— ${result.baseline.reason}`}
        </p>
      ) : null}

      {summary ? (
        <div className="flex flex-wrap gap-2 pt-3 text-xs">
          <Badge variant={summary.matches_reviewed_scope ? "outline" : "destructive"}>
            Authorized rows {summary.authorized_rows} / reviewed {summary.expected_authorized_rows}
          </Badge>
          <Badge variant="outline">Would change {summary.would_change}</Badge>
          <Badge variant="outline">Applied {summary.applied}</Badge>
          <Badge variant="outline">Already null {summary.already_null}</Badge>
          <Badge variant={summary.drifted ? "destructive" : "secondary"}>
            Drifted {summary.drifted}
          </Badge>
          <Badge variant={summary.newer_evidence ? "destructive" : "secondary"}>
            Newer evidence {summary.newer_evidence}
          </Badge>
          <Badge variant="secondary">Not found {summary.not_found}</Badge>
          <Badge variant="secondary">Not approved {summary.not_approved}</Badge>
          <Badge variant={summary.baseline_blocked ? "destructive" : "secondary"}>
            Baseline blocked {summary.baseline_blocked}
          </Badge>
          <Badge variant={summary.failed ? "destructive" : "secondary"}>
            Failed {summary.failed}
          </Badge>
          <Badge variant="outline">
            {summary.reconciles ? "Reconciles" : "Does not reconcile"}
          </Badge>
        </div>
      ) : null}

      {rows.length ? (
        <>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[900px] text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Approve</th>
                  <th className="py-1 pr-3">Stable ID</th>
                  <th className="py-1 pr-3">Canonical cell</th>
                  <th className="py-1 pr-3">FarmOps connected_va</th>
                  <th className="py-1 pr-3">Proposed</th>
                  <th className="py-1 pr-3">Zero origin / disposition</th>
                  <th className="py-1 pr-3">FarmOps provenance</th>
                  <th className="py-1 pr-3">Status</th>
                  <th className="py-1 pr-3">Applied at</th>
                  <th className="py-1 pr-3">Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const key = connectedVaZeroGateKey({ table: r.table, stable_id: r.stable_id });
                  const selectable = r.status === "would_change";
                  return (
                    <tr key={key} className="border-t align-top">
                      <td className="py-1 pr-3">
                        <Checkbox
                          checked={approved.has(key)}
                          disabled={!selectable}
                          onCheckedChange={(v) =>
                            setApproved((prev) => {
                              const next = new Set(prev);
                              if (v) next.add(key);
                              else next.delete(key);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="py-1 pr-3 font-mono">{r.stable_id}</td>
                      <td className="py-1 pr-3">
                        {r.ods_state}
                        {r.ods_raw ? ` (${r.ods_raw})` : " (blank)"}
                        {r.ods_worksheet ? (
                          <span className="ml-1 text-muted-foreground">
                            {r.ods_worksheet} row {r.ods_row ?? "?"}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1 pr-3 font-mono">{r.live_connected_va ?? "(null)"}</td>
                      <td className="py-1 pr-3">NULL (not stated)</td>
                      <td className="py-1 pr-3 text-muted-foreground">
                        <div className="font-mono">{r.zero_origin ?? "—"}</div>
                        <div>{r.disposition ?? "—"}</div>
                      </td>
                      <td className="py-1 pr-3 text-muted-foreground">{r.provenance}</td>
                      <td className="py-1 pr-3">
                        <Badge
                          variant={
                            r.status === "failed" ||
                            r.status === "drifted" ||
                            r.status === "newer_evidence"
                              ? "destructive"
                              : "outline"
                          }
                        >
                          {r.status}
                        </Badge>
                      </td>
                      <td className="py-1 pr-3">{r.applied_at ?? "—"}</td>
                      <td className="py-1 pr-3 text-muted-foreground">{r.detail ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!result?.applied && summary?.would_change ? (
            <label className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
              <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(Boolean(v))} />
              <span>
                I confirm the approved rows above should be written: only{" "}
                <code>electrical_loads.connected_va</code> changes from numeric 0 to NULL, no VA is
                populated, and the original finding plus adjudication history are preserved. After
                the apply, re-run the SHA-bound comparison and Category-D convergence — canonical
                blank ↔ FarmOps NULL is an agreement, not a numeric disagreement.
              </span>
            </label>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
