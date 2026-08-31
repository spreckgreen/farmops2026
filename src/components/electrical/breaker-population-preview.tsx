// Phase 4.4b — breaker-position population preview UI.
//
// Read-only by construction: uploading a workbook only runs Preview, which never
// writes. Apply stays disabled until the preview has been reviewed and the
// "Apply is armed" switch is explicitly turned on, and it creates only the
// records that are still selected and still missing in live FarmOps.
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, FileText, Loader2, ShieldAlert, Table2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ObservationPhotoCell,
  type ObservationPhoto,
} from "@/components/electrical/observation-photo-cell";

import {
  applyBreakerPopulation,
  previewBreakerPopulation,
  type BreakerPopulationPreview,
} from "@/lib/electrical-breaker-population.functions";
import {
  BREAKER_POPULATION_CSV,
  POPULATION_ACTION_LABELS,
  type BreakerPopulationRow,
  type PopulationAction,
} from "@/lib/electrical-breaker-population";
import {
  FIELD_RECONCILIATION_SCOPES,
  type FieldReconciliationScopeId,
} from "@/lib/electrical-house-panel-field";

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

function download(name: string, body: string, mime: string) {
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const ACTION_VARIANT: Record<PopulationAction, "default" | "secondary" | "outline" | "destructive"> = {
  propose_create: "default",
  already_exists: "secondary",
  requires_review: "outline",
  blocked_position_mismatch: "destructive",
  blocked_unresolved: "destructive",
  conflict_do_not_apply: "destructive",
};

type Filter = "all" | "create" | "exists" | "blocked" | "review" | "amps_unknown" | "verification";

export function BreakerPopulationPreview({
  scope: scopeId = "house",
}: {
  scope?: FieldReconciliationScopeId;
} = {}) {
  const scope = FIELD_RECONCILIATION_SCOPES[scopeId];
  const preview = useServerFn(previewBreakerPopulation);
  const apply = useServerFn(applyBreakerPopulation);

  const [result, setResult] = useState<BreakerPopulationPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("all");
  const [armed, setArmed] = useState(false);
  // One panel photo per panel in the workbook (e.g. PNL-H1, PNL-H2). Every
  // circuit observed in that panel links to it as evidence of observation.
  const [panelPhotos, setPanelPhotos] = useState<Record<string, ObservationPhoto | null>>({});

  const previewMutation = useMutation({
    mutationFn: async (file: File) => {
      const base64 = await readAsBase64(file);
      return preview({ data: { file_name: file.name, base64, scope: scopeId } });
    },
    onSuccess: (r) => {
      setResult(r);
      setArmed(false);
      setSelected(new Set(r.rows.filter((x) => x.action === "propose_create").map((x) => x.key)));
      toast.success(
        `Preview only — nothing was created. ${r.diagnostics.unique_breakers_considered} logical breaker(s), ${r.diagnostics.eligible_to_create} eligible to create.`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Circuits that can be linked to a panel photo (photo attached for their panel). */
  const evidenceFor = (onlySelected: boolean) =>
    (result?.rows ?? [])
      .filter((r) => {
        const photo = panelPhotos[r.panel_id ?? r.panel_source_name];
        if (!photo) return false;
        return onlySelected ? selected.has(r.key) : true;
      })
      .map((r) => ({
        panel_id: r.panel_id ?? null,
        panel_source_name: r.panel_source_name ?? "",
        positions_text: r.positions_text,
        poles: r.poles ?? null,
        observed_text: r.label_observed_text ?? r.label ?? r.positions_text,
        notes: r.evidence ?? null,
        confidence: r.confidence ?? null,
        verification_status: r.verification_required ? "verification_required" : "not_required",
        proposed_action: r.action,
        worksheet: null,
        workbook: result?.workbook ?? "",
        photo: panelPhotos[r.panel_id ?? r.panel_source_name]!,
      }));

  const applyMutation = useMutation({
    mutationFn: async ({ confirm, evidenceOnly }: { confirm: boolean; evidenceOnly?: boolean }) => {
      const records = evidenceOnly
        ? []
        : (result?.rows ?? [])
            .filter(
              (r) => r.action === "propose_create" && selected.has(r.key) && r.panel_id && r.poles,
            )
            .map((r) => ({
              panel_id: r.panel_id!,
              positions_text: r.positions_text,
              poles: r.poles!,
              ocp_amps: r.ocp_amps,
              label: r.label,
              slots: r.slots.map((s) => ({
                breaker_number: s.breaker_number,
                side: s.side,
                position: s.position,
              })),
            }));
      const evidence = evidenceFor(!evidenceOnly);
      if (!records.length && !evidence.length) {
        throw new Error(
          evidenceOnly
            ? "Attach at least one panel photo first."
            : "Select at least one eligible breaker first.",
        );
      }
      return apply({ data: { confirm, scope: scopeId, records, evidence } });
    },
    onSuccess: (r) => {
      if (!r.confirmed) {
        toast.success(`Dry run — nothing written. ${r.results.length} record(s) would be created.`);
        return;
      }
      toast.success(
        `${r.created} record group(s) created, ${r.blocked} blocked as now-occupied, ${r.failed} failed. ${r.evidence_recorded} circuit(s) linked to a panel photo.`,
      );
      for (const e of r.evidence_errors.slice(0, 2)) toast.warning(`Photo evidence: ${e}`);
      const failures = r.results.filter((x) => x.status !== "created");
      for (const f of failures.slice(0, 4)) toast.warning(`${f.panel_id} ${f.positions_text}: ${f.detail}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const rows = useMemo(() => {
    const all = result?.rows ?? [];
    switch (filter) {
      case "create":
        return all.filter((r) => r.action === "propose_create");
      case "exists":
        return all.filter((r) => r.action === "already_exists");
      case "blocked":
        return all.filter((r) => r.action.startsWith("blocked") || r.action === "conflict_do_not_apply");
      case "review":
        return all.filter((r) => r.action === "requires_review");
      case "amps_unknown":
        return all.filter((r) => r.amps_unknown);
      case "verification":
        return all.filter((r) => r.verification_required);
      default:
        return all;
    }
  }, [result, filter]);

  const d = result?.diagnostics;
  const selectable = (r: BreakerPopulationRow) => r.action === "propose_create";
  const selectedCount = (result?.rows ?? []).filter((r) => selectable(r) && selected.has(r.key)).length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Table2 className="h-4 w-4" />
          {scope.area} breaker-position population preview
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Groups the corrected field observations by logical breaker identity (panel + occupied
          positions) and proposes one missing breaker-position record per unique breaker. Unknown
          breaker amps stay unknown, uncertain directory text stays verification-required, and
          evidence-only material stays in the observation journal.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept=".ods"
            className="text-sm"
            disabled={previewMutation.isPending}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) previewMutation.mutate(f);
              e.target.value = "";
            }}
          />
          {previewMutation.isPending && (
            <span className="flex items-center gap-1 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Parsing…
            </span>
          )}
        </div>

        {d && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">{d.unique_breakers_considered} unique breakers considered</Badge>
            <Badge>{d.eligible_to_create} eligible to create</Badge>
            <Badge variant="outline">{d.positions_to_create} positions</Badge>
            <Badge variant="secondary">{d.already_existing} already existing</Badge>
            <Badge variant={d.blocked_position_mismatch ? "destructive" : "outline"}>
              {d.blocked_position_mismatch} position/pole mismatch
            </Badge>
            <Badge variant={d.blocked_unresolved ? "destructive" : "outline"}>
              {d.blocked_unresolved} unresolved
            </Badge>
            <Badge variant="outline">{d.breaker_amps_unknown} amps unknown</Badge>
            <Badge variant="outline">{d.verification_required} verification required</Badge>
            <Badge variant={d.conflicts ? "destructive" : "outline"}>{d.conflicts} conflicts</Badge>
            <Badge variant="outline">{d.requires_review} requires review</Badge>
          </div>
        )}

        {result && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={filter}
                onChange={(e) => setFilter(e.target.value as Filter)}
              >
                <option value="all">All rows</option>
                <option value="create">Eligible to create</option>
                <option value="exists">Already exists</option>
                <option value="blocked">Blocked / conflicts</option>
                <option value="review">Requires review</option>
                <option value="amps_unknown">Breaker amps unknown</option>
                <option value="verification">Verification required</option>
              </select>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => download(BREAKER_POPULATION_CSV, result.csv, "text/csv")}
              >
                <Download className="h-4 w-4" /> CSV
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() =>
                  download(
                    `phase-4.4b-${scopeId}-breaker-population.md`,
                    result.markdown,
                    "text/markdown",
                  )
                }
              >
                <FileText className="h-4 w-4" /> Markdown
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed p-3 text-sm">
              <ShieldAlert className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">
                Preview made no changes. {selectedCount} record(s) selected.
              </span>
              <label className="flex items-center gap-1.5">
                <Checkbox checked={armed} onCheckedChange={(v) => setArmed(v === true)} />
                Apply is armed
              </label>
              <Button
                size="sm"
                variant="outline"
                disabled={applyMutation.isPending || !selectedCount}
                onClick={() => applyMutation.mutate(false)}
              >
                Dry run
              </Button>
              <Button
                size="sm"
                disabled={!armed || applyMutation.isPending || !selectedCount}
                onClick={() => applyMutation.mutate(true)}
              >
                {applyMutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Create selected records
              </Button>
            </div>

            <div className="max-h-[34rem] overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                  <tr className="text-left">
                    <th className="p-2"> </th>
                    <th className="p-2">Panel</th>
                    <th className="p-2">Positions</th>
                    <th className="p-2">Poles</th>
                    <th className="p-2">Breaker amps</th>
                    <th className="p-2">Directory description</th>
                    <th className="p-2">Confidence</th>
                    <th className="p-2">Verification</th>
                    <th className="p-2">Existing FarmOps record</th>
                    <th className="p-2">Proposed action</th>
                    <th className="p-2">Blocking reason</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className="border-t align-top">
                      <td className="p-2">
                        <Checkbox
                          disabled={!selectable(r)}
                          checked={selected.has(r.key)}
                          onCheckedChange={(v) =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (v === true) next.add(r.key);
                              else next.delete(r.key);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="p-2 font-medium">{r.panel_id ?? r.panel_source_name}</td>
                      <td className="p-2">
                        {r.positions_text}
                        <div className="text-muted-foreground">
                          {r.slots.map((s) => `${s.side} ${s.position}`).join(", ") || "—"}
                        </div>
                      </td>
                      <td className="p-2">
                        {r.poles ?? "?"}
                        <div className="text-muted-foreground">{r.poles_source.replace(/_/g, " ")}</div>
                      </td>
                      <td className="p-2">
                        {r.ocp_amps !== null ? (
                          `${r.ocp_amps} A`
                        ) : (
                          <span className="text-muted-foreground">unknown — not inferred</span>
                        )}
                        {r.amps_observed_text && (
                          <div className="text-muted-foreground">“{r.amps_observed_text}”</div>
                        )}
                      </td>
                      <td className="max-w-[15rem] p-2">
                        <div className="truncate" title={r.label ?? ""}>
                          {r.label ?? <span className="text-muted-foreground">—</span>}
                        </div>
                        {r.label_observed_text && r.label_observed_text !== r.label && (
                          <div className="truncate text-muted-foreground" title={r.label_observed_text}>
                            observed: {r.label_observed_text}
                          </div>
                        )}
                      </td>
                      <td className="p-2">{r.confidence}</td>
                      <td className="p-2">
                        {r.verification_required ? (
                          <Badge variant="outline">required</Badge>
                        ) : (
                          <span className="text-muted-foreground">not required</span>
                        )}
                      </td>
                      <td className="p-2">
                        {r.existing ? (
                          <>
                            <div>
                              {r.existing.poles ?? "?"}P · {r.existing.ocp_amps ?? "?"}A
                            </div>
                            <div className="text-muted-foreground">{r.existing.label ?? "(blank)"}</div>
                            {r.differences.length > 0 && (
                              <div className="text-destructive">
                                {r.differences
                                  .map((x) => `${x.field}: ${x.existing ?? "(blank)"} vs ${x.observed ?? "(blank)"}`)
                                  .join("; ")}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground">absent</span>
                        )}
                      </td>
                      <td className="p-2">
                        <Badge variant={ACTION_VARIANT[r.action]}>
                          {POPULATION_ACTION_LABELS[r.action]}
                        </Badge>
                      </td>
                      <td className="max-w-[16rem] p-2 text-muted-foreground">
                        <div title={r.blocking_reason ?? ""}>{r.blocking_reason ?? "—"}</div>
                        {r.evidence && <div className="mt-1 text-[11px]">{r.evidence}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
