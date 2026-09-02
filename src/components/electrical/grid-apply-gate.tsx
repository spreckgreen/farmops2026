// Farm Shop physical-location migration — apply gate UI.
//
// Preview is loaded read-only. Nothing is written until the owner ticks the
// confirmation box and approves individual records; INTERVAL, UNRESOLVED and the
// two corner panels are shown but cannot be approved.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Download, RefreshCw, ShieldCheck } from "lucide-react";

import { PersistedSection } from "@/components/electrical/persisted-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  applyFarmShopGridMigration,
  previewFarmShopGridApply,
  type GridApplyPayload,
} from "@/lib/electrical-grid-apply.functions";
import {
  applyKey,
  applyProposalsCsv,
  type GridApplyProposal,
  type GridApplyStatus,
} from "@/lib/electrical-grid-apply-gate";

const STATUS_VARIANT: Record<GridApplyStatus, "default" | "secondary" | "destructive" | "outline"> = {
  would_change: "default",
  already_correct: "secondary",
  withheld_interval: "destructive",
  withheld_unresolved: "destructive",
  field_confirmation_required: "destructive",
  non_fixed: "outline",
  drifted: "destructive",
  newer_evidence: "destructive",
  not_approved: "secondary",
  failed: "destructive",
  applied: "default",
};

const APPROVABLE: GridApplyStatus[] = ["would_change", "non_fixed"];

function download(name: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function GridApplyGate() {
  const preview = useServerFn(previewFarmShopGridApply);
  const apply = useServerFn(applyFarmShopGridMigration);
  const [confirmed, setConfirmed] = useState(false);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<GridApplyPayload | null>(null);

  const query = useQuery({
    queryKey: ["farm-shop-grid-apply-preview"],
    queryFn: async () => (await preview({ data: { confirm: false, approved: [] } })) as unknown as GridApplyPayload,
  });

  const payload = result ?? query.data ?? null;
  const proposals = payload?.proposals ?? [];

  const approvable = useMemo(
    () => proposals.filter((p) => APPROVABLE.includes(p.status)),
    [proposals],
  );

  const mutation = useMutation({
    mutationFn: async () =>
      (await apply({
        data: { confirm: true, approved: [...approved] },
      })) as unknown as GridApplyPayload,
    onSuccess: (data) => {
      setResult(data);
      setApproved(new Set());
      setConfirmed(false);
      void query.refetch();
    },
  });

  const toggle = (key: string) =>
    setApproved((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const canApply = confirmed && approved.size > 0 && !mutation.isPending;

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" /> Physical-location apply gate (controlled)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            The frozen coordinate transformation is not recomputed here. Only EXACT and NEAREST
            records write coordinates; NON_FIXED records write their classification, provenance and
            legacy grid only. Every INTERVAL and UNRESOLVED record, plus PNL-FS-NW and PNL-FS-NE,
            is withheld until its owner/field confirmation is completed. Writes are limited to{" "}
            <span className="font-mono">{(payload?.writable_columns ?? []).join(", ")}</span> — no
            circuit, load, panel, topology, equipment, ODS or engineering value is touched.
          </p>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={() => {
                setResult(null);
                void query.refetch();
              }}
              disabled={query.isFetching || mutation.isPending}
            >
              <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} /> Refresh
              preview
            </Button>
            {payload ? (
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() =>
                  download("farm-shop-location-apply.csv", applyProposalsCsv(payload.proposals))
                }
              >
                <Download className="h-4 w-4" /> Gate CSV
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setApproved(new Set(approvable.map((p) => applyKey(p))))}
              disabled={!approvable.length}
            >
              Approve all {approvable.length} deterministic record(s)
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setApproved(new Set())}>
              Clear approvals
            </Button>
          </div>

          {payload ? (
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["would_change", payload.summary.would_change],
                  ["already_correct", payload.summary.already_correct],
                  ["non_fixed", payload.summary.non_fixed],
                  ["withheld_interval", payload.summary.withheld_interval],
                  ["withheld_unresolved", payload.summary.withheld_unresolved],
                  ["field_confirmation_required", payload.summary.field_confirmation_required],
                  ["drifted", payload.summary.drifted],
                  ["newer_evidence", payload.summary.newer_evidence],
                  ["not_approved", payload.summary.not_approved],
                  ["failed", payload.summary.failed],
                  ["applied", payload.summary.applied],
                ] as [GridApplyStatus, number][]
              ).map(([label, n]) => (
                <Badge key={label} variant={STATUS_VARIANT[label]} className="font-mono">
                  {label} · {n}
                </Badge>
              ))}
            </div>
          ) : null}

          <label className="flex items-start gap-2">
            <Checkbox
              checked={confirmed}
              onCheckedChange={(v) => setConfirmed(v === true)}
              aria-label="Confirm the deterministic migration set"
            />
            <span className="text-muted-foreground">
              I confirm the approved deterministic migration set ({approved.size} record(s)) may be
              written to the physical-location fields. Withheld records stay untouched.
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={!canApply} onClick={() => mutation.mutate()}>
              {mutation.isPending ? "Applying…" : `Apply ${approved.size} approved record(s)`}
            </Button>
            <span className="text-xs text-muted-foreground">
              Transformation fingerprint:{" "}
              <span className="font-mono">{payload?.transform_fingerprint ?? "—"}</span>
            </span>
          </div>

          {query.isPending ? <p className="text-muted-foreground">Loading gate preview…</p> : null}
          {query.error ? (
            <p className="text-destructive">{(query.error as Error).message}</p>
          ) : null}
          {mutation.error ? (
            <p className="text-destructive">{(mutation.error as Error).message}</p>
          ) : null}
        </CardContent>
      </Card>

      {payload?.validation ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4" /> Post-apply validation (full {payload.validation.rows}
              -record re-run)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <p>
              already_correct {payload.validation.already_correct} · still would_change{" "}
              {payload.validation.would_change}
            </p>
            <p>
              INTERVAL untouched {payload.validation.interval_untouched} · UNRESOLVED untouched{" "}
              {payload.validation.unresolved_untouched} · field confirmation required{" "}
              {payload.validation.field_confirmation_required}
            </p>
            <p>
              NON_FIXED with NULL X/Y and no fixed grid{" "}
              {payload.validation.non_fixed_with_null_xy}
              {payload.validation.non_fixed_violations.length
                ? ` · violations: ${payload.validation.non_fixed_violations.join(", ")}`
                : ""}
            </p>
            <p>
              Withheld records that gained a stored location:{" "}
              {payload.validation.newly_resolved_without_evidence.length
                ? payload.validation.newly_resolved_without_evidence.join(", ")
                : "none"}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {payload ? (
        <PersistedSection
          storageKey="grid-apply-gate-rows"
          title={`Apply gate records (${proposals.length})`}
          defaultOpen
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-2">Approve</th>
                  <th className="p-2">Stable ID</th>
                  <th className="p-2">Description</th>
                  <th className="p-2">Legacy grid</th>
                  <th className="p-2">Current FarmOps grid</th>
                  <th className="p-2">x ft</th>
                  <th className="p-2">y ft</th>
                  <th className="p-2">Proposed grid</th>
                  <th className="p-2">Precision</th>
                  <th className="p-2">Evidence</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((p: GridApplyProposal) => {
                  const key = applyKey(p);
                  const canApprove = APPROVABLE.includes(p.status);
                  return (
                    <tr key={key} className="border-t border-border align-top">
                      <td className="p-2">
                        <Checkbox
                          checked={approved.has(key)}
                          disabled={!canApprove}
                          onCheckedChange={() => toggle(key)}
                          aria-label={`Approve ${p.stable_id}`}
                        />
                      </td>
                      <td className="p-2 font-mono text-xs">{p.stable_id}</td>
                      <td className="p-2">{p.description || "—"}</td>
                      <td className="p-2 font-mono text-xs">{p.legacy_grid || "—"}</td>
                      <td className="p-2 font-mono text-xs">{p.current_farmops_grid || "—"}</td>
                      <td className="p-2 font-mono text-xs">{p.location_x_ft ?? "—"}</td>
                      <td className="p-2 font-mono text-xs">{p.location_y_ft ?? "—"}</td>
                      <td className="p-2 font-mono text-xs">{p.grid_reference ?? "—"}</td>
                      <td className="p-2 font-mono text-xs">{p.grid_reference_precision}</td>
                      <td className="p-2 text-xs text-muted-foreground">
                        {p.supporting_evidence.length ? p.supporting_evidence.join(" | ") : "—"}
                      </td>
                      <td className="p-2 text-xs">
                        <Badge variant={STATUS_VARIANT[p.status]}>{p.status}</Badge>
                        {p.detail ? (
                          <span className="mt-1 block text-muted-foreground">{p.detail}</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </PersistedSection>
      ) : null}
    </div>
  );
}
