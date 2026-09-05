// Phase 4.4b — apply gate UI for the system-voltage semantic migration.
//
// Preview re-reads live panel rows and reports what would change. Apply writes
// only the `system_voltage` designation for explicitly approved, authorized
// panels; the legacy scalar `voltage` is preserved. Immediately after a
// successful apply the numeric diagnostics are re-run against the same,
// unchanged canonical workbook.
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  applySystemVoltageMigration,
  previewSystemVoltageMigration,
  type SystemVoltageGateResult,
} from "@/lib/electrical-system-voltage.functions";
import {
  AUTHORIZED_PANELS,
  AUTHORIZED_PANEL_SET,
  SYSTEM_VOLTAGE_GATE_VERSION,
  systemVoltageGateCsv,
  systemVoltageGateKey,
  systemVoltageGateMarkdown,
} from "@/lib/electrical-system-voltage-gate";
import type { SystemVoltageMigrationPreview } from "@/lib/electrical-system-voltage";
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

export function SystemVoltageApplyGate({
  preview,
  onRevalidate,
}: {
  preview: SystemVoltageMigrationPreview;
  onRevalidate?: () => void;
}) {
  const runPreview = useServerFn(previewSystemVoltageMigration);
  const runApply = useServerFn(applySystemVoltageMigration);
  const [result, setResult] = useState<SystemVoltageGateResult | null>(null);
  const [approved, setApproved] = useState<Set<string>>(new Set());

  // Only the seven authorized panels are ever sent to the server.
  const entries = useMemo(
    () =>
      preview.rows
        .filter((r) => r.farmops_entity === "electrical_panels" && AUTHORIZED_PANEL_SET.has(r.stable_id))
        .map((r) => ({
          stable_id: r.stable_id,
          ods_value: r.ods_raw,
          expected_scalar: r.current_scalar,
        })),
    [preview],
  );

  const previewMutation = useMutation({
    mutationFn: async () =>
      runPreview({ data: { entries, confirm: false, approved: [] } }) as unknown as Promise<SystemVoltageGateResult>,
    onSuccess: (r) => {
      setResult(r);
      setApproved(
        new Set(
          r.rows
            .filter((row) => row.status === "would_change")
            .map((row) => systemVoltageGateKey({ table: row.table, stable_id: row.stable_id })),
        ),
      );
      toast.success(`${r.summary.would_change} panel(s) would change, ${r.skipped} skipped.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const applyMutation = useMutation({
    mutationFn: async () =>
      runApply({
        data: { entries, confirm: true, approved: [...approved] },
      }) as unknown as Promise<SystemVoltageGateResult>,
    onSuccess: (r) => {
      setResult(r);
      toast.success(`Applied ${r.summary.applied} designation(s); ${r.skipped} skipped.`);
      onRevalidate?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = result?.rows ?? [];
  const summary = result?.summary;

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">
            System-voltage migration apply gate{" "}
            <span className="text-xs font-normal text-muted-foreground">
              {result?.applied ? "applied" : "preview — nothing written yet"}
            </span>
          </p>
          <p className="pt-1 text-xs text-muted-foreground">
            Writes only the <code>system_voltage</code> designation on the seven authorized panels
            ({AUTHORIZED_PANELS.join(", ")}). The legacy scalar <code>voltage</code> column is
            preserved for backwards compatibility, so existing consumers are unaffected. Panel IDs,
            service identities and revisions, feeder/branch-run topology, breaker positions, loads,
            Boolean reconciliation, House field observations, the canonical ODS and every unrelated
            numeric field are never modified. Each write re-reads the live row and re-verifies the
            stable ID, the scalar voltage, the absence of a conflicting designation and the
            canonical ODS value. Gate <code>{SYSTEM_VOLTAGE_GATE_VERSION}</code>.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!entries.length || previewMutation.isPending}
            onClick={() => previewMutation.mutate()}
          >
            {previewMutation.isPending ? "Checking…" : "Preview against live data"}
          </Button>
          <Button
            size="sm"
            disabled={!result || approved.size === 0 || applyMutation.isPending}
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
                    `phase-4.4b-system-voltage-${result?.applied ? "apply" : "preview"}-report.csv`,
                    systemVoltageGateCsv(rows),
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
                    `phase-4.4b-system-voltage-${result?.applied ? "apply" : "preview"}-report.md`,
                    systemVoltageGateMarkdown(rows, summary!, {
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
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Approve</th>
                <th className="py-1 pr-3">Stable ID</th>
                <th className="py-1 pr-3">Old representation</th>
                <th className="py-1 pr-3">New system_voltage</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1 pr-3">Applied at</th>
                <th className="py-1 pr-3">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = systemVoltageGateKey({ table: r.table, stable_id: r.stable_id });
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
                    <td className="py-1 pr-3">
                      {r.live_representation || `scalar ${r.live_scalar ?? "not stated"}`}
                    </td>
                    <td className="py-1 pr-3">
                      {r.proposed.designation} (L-N {r.proposed.line_neutral_volts}, L-L{" "}
                      {r.proposed.line_line_volts}, {r.proposed.phases ?? "?"}φ,{" "}
                      {r.proposed.wires ?? "?"}-wire)
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
                    <td className="py-1 pr-3 font-mono">{r.applied_at ?? "—"}</td>
                    <td className="py-1 pr-3 text-muted-foreground">{r.detail ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="pt-2 text-xs text-muted-foreground">
          Run Preview to revalidate every authorized panel against live FarmOps state. Drifted or
          conflicting rows are never written.
        </p>
      )}
    </div>
  );
}
