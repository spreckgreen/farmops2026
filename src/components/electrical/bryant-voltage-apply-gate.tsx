// Phase 4.4b — Bryant nominal supply voltage apply gate UI.
//
// Preview re-reads the live FS-082/FS-083 rows and reports what would change.
// Apply requires explicit per-row approval and writes only
// `electrical_loads.volts` (120 → 240). After a successful apply the caller
// re-runs the load adjudication and numeric diagnostics.
import { useState } from "react";
import { Download } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  applyBryantVoltageCorrection,
  previewBryantVoltageCorrection,
  type BryantVoltageGateResult,
} from "@/lib/electrical-bryant-voltage.functions";
import {
  BRYANT_VOLTAGE_GATE_VERSION,
  BRYANT_VOLTAGE_LOAD_IDS,
  bryantVoltageGateCsv,
  bryantVoltageGateKey,
  bryantVoltageGateMarkdown,
} from "@/lib/electrical-bryant-voltage-gate";
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

export function BryantVoltageApplyGate({ onRevalidate }: { onRevalidate?: () => void }) {
  const runPreview = useServerFn(previewBryantVoltageCorrection);
  const runApply = useServerFn(applyBryantVoltageCorrection);
  const [result, setResult] = useState<BryantVoltageGateResult | null>(null);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState(false);

  const previewMutation = useMutation({
    mutationFn: async () => runPreview({ data: {} }) as unknown as Promise<BryantVoltageGateResult>,
    onSuccess: (r) => {
      setResult(r);
      setConfirmed(false);
      setApproved(
        new Set(
          r.rows
            .filter((row) => row.status === "would_change")
            .map((row) => bryantVoltageGateKey({ table: row.table, stable_id: row.stable_id })),
        ),
      );
      toast.success(`${r.summary.would_change} load(s) would change, ${r.skipped} skipped.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const applyMutation = useMutation({
    mutationFn: async () =>
      runApply({ data: { confirm: true, approved: [...approved] } }) as unknown as Promise<BryantVoltageGateResult>,
    onSuccess: (r) => {
      setResult(r);
      setConfirmed(false);
      toast.success(`Applied ${r.summary.applied} voltage correction(s); ${r.skipped} skipped.`);
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
            Bryant nominal supply voltage apply gate{" "}
            <span className="text-xs font-normal text-muted-foreground">
              {result?.applied ? "applied" : "preview — nothing written yet"}
            </span>
          </p>
          <p className="pt-1 text-xs text-muted-foreground">
            Corrects <code>electrical_loads.volts</code> from 120 to 240 on exactly two verified
            Bryant mini-split loads ({BRYANT_VOLTAGE_LOAD_IDS.join(", ")}). Rated equipment voltage
            208/230 VAC, 1Ø, 60 Hz is preserved separately as provenance and is never collapsed to a
            scalar 230. Amps, connected/demand VA, notes, source references, equipment provenance,
            ODS capture, stable IDs, relationships, MCA/MOCP values, breaker data,
            services/topology, Boolean reconciliation, FS-084, FS-034, FS-092 and every other load
            are never modified. Each write re-reads the live row by UUID and re-verifies the stable
            ID, the 120 V starting value, the verified Bryant equipment configuration and the live
            adjudication provenance. Gate <code>{BRYANT_VOLTAGE_GATE_VERSION}</code>.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={previewMutation.isPending}
            onClick={() => previewMutation.mutate()}
          >
            {previewMutation.isPending ? "Checking…" : "Preview against live data"}
          </Button>
          <Button
            size="sm"
            disabled={!result || !confirmed || approved.size === 0 || applyMutation.isPending}
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
                    `phase-4.4b-bryant-voltage-${result?.applied ? "apply" : "preview"}-report.csv`,
                    bryantVoltageGateCsv(rows),
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
                    `phase-4.4b-bryant-voltage-${result?.applied ? "apply" : "preview"}-report.md`,
                    bryantVoltageGateMarkdown(rows, summary!, {
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

      {summary ? (
        <div className="flex flex-wrap gap-2 pt-3 text-xs">
          <Badge variant="outline">Would change {summary.would_change}</Badge>
          <Badge variant="outline">Applied {summary.applied}</Badge>
          <Badge variant="outline">Already correct {summary.already_correct}</Badge>
          <Badge variant={summary.drifted ? "destructive" : "secondary"}>
            Drifted {summary.drifted}
          </Badge>
          <Badge variant={summary.conflict ? "destructive" : "secondary"}>
            Conflict {summary.conflict}
          </Badge>
          <Badge variant="secondary">Not found {summary.not_found}</Badge>
          <Badge variant="secondary">Not approved {summary.not_approved}</Badge>
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
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Approve</th>
                  <th className="py-1 pr-3">Stable ID</th>
                  <th className="py-1 pr-3">Old volts</th>
                  <th className="py-1 pr-3">New volts</th>
                  <th className="py-1 pr-3">Preserved equipment rating</th>
                  <th className="py-1 pr-3">Status</th>
                  <th className="py-1 pr-3">Applied at</th>
                  <th className="py-1 pr-3">Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const key = bryantVoltageGateKey({ table: r.table, stable_id: r.stable_id });
                  const selectable = r.status === "would_change";
                  return (
                    <tr key={key} className="border-t">
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
                      <td className="py-1 pr-3">{r.live_volts ?? "not stated"}</td>
                      <td className="py-1 pr-3">{r.proposed_volts}</td>
                      <td className="py-1 pr-3">
                        {r.rated_equipment_voltage} VAC, {r.phase}Ø, {r.frequency_hz} Hz
                      </td>
                      <td className="py-1 pr-3">
                        <Badge
                          variant={
                            r.status === "failed" || r.status === "drifted" || r.status === "conflict"
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
              <Checkbox
                checked={confirmed}
                onCheckedChange={(v) => setConfirmed(Boolean(v))}
              />
              <span>
                I confirm the approved rows above should be written: only{" "}
                <code>electrical_loads.volts</code> changes from 120 to 240, and the original
                finding and adjudication history is preserved.
              </span>
            </label>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
