// Phase 4.4b — House panel photo reconciliation UI.
//
// Upload → Parse → Resolve → Compare → Preview → explicit Apply.
// Preview issues no writes. The three columns are always labelled
// "Engineering / canonical", "FarmOps" and "Field observed": a panel label is
// evidence of the installed system, never automatically the correct value.
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  applyHousePanelFieldUpdates,
  previewHousePanelFieldReconciliation,
  type HousePanelPreview,
} from "@/lib/electrical-house-panel-field.functions";
import { FIELD_RECONCILIATION_CSV, type ReconciliationRow } from "@/lib/electrical-house-panel-field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Camera, Download, FileText, ShieldAlert } from "lucide-react";

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

type Filter =
  | "all"
  | "matches"
  | "conflicts"
  | "verification"
  | "updates"
  | "topology"
  | "low_confidence";

const rowKey = (r: ReconciliationRow, i: number) => `${r.key}#${r.field}#${i}`;

function download(name: string, body: string, mime: string) {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function HousePanelFieldReconciliation() {
  const preview = useServerFn(previewHousePanelFieldReconciliation);
  const apply = useServerFn(applyHousePanelFieldUpdates);
  const [result, setResult] = useState<HousePanelPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<string>("all");
  const [filter, setFilter] = useState<Filter>("all");

  const previewMutation = useMutation({
    mutationFn: async (file: File) => {
      const base64 = await readAsBase64(file);
      return preview({ data: { file_name: file.name, base64 } });
    },
    onSuccess: (r) => {
      setResult(r);
      const next = new Set<string>();
      r.rows.forEach((row, i) => {
        if (row.proposed_action === "propose_farmops_update" && row.target) next.add(rowKey(row, i));
      });
      setSelected(next);
      toast.success(
        `Preview only — no records changed. ${r.totals.logical_breakers} logical breaker(s), ${r.totals.eligible_farmops_updates} eligible FarmOps update(s).`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const applyMutation = useMutation({
    mutationFn: async (confirm: boolean) => {
      const rows = (result?.rows ?? []).filter((r, i) => selected.has(rowKey(r, i)));
      return apply({
        data: {
          confirm,
          fields: rows
            .filter((r) => r.target)
            .map((r) => ({
              panel_id: r.target!.panel_id,
              side: r.target!.side,
              position: r.target!.position,
              column: r.target!.column,
              expected_current: r.target!.expected_current,
              proposed_value: r.target!.proposed_value,
              positions_text: r.positions_text,
              poles: r.poles,
              observed_text: r.field_observed_text,
              canonical_value: r.canonical_value,
              classification: r.classification,
              confidence: r.confidence,
              workbook: r.provenance.workbook,
              worksheet: r.provenance.worksheet,
              source_row: r.provenance.source_row,
              source_column: r.provenance.source_column,
              source_photo: r.provenance.source_photo,
            })),
          topology: rows
            .filter((r) => r.topology)
            .map((r) => ({
              panel_id: r.topology!.panel_id,
              expected_current_parent: r.topology!.current_parent,
              proposed_parent: r.topology!.proposed_parent,
              evidence: r.topology!.evidence,
            })),
          observations: rows.map((r) => ({
            panel_id: r.panel_id ?? r.panel_source_name,
            field: r.field,
            side: r.side,
            position: r.position,
            positions_text: r.positions_text,
            poles: r.poles,
            observed_text: r.field_observed_text,
            interpreted_value: r.field_interpreted === null ? null : String(r.field_interpreted),
            canonical_value: r.canonical_value,
            farmops_value: r.farmops_value,
            classification: r.classification,
            proposed_action: r.proposed_action,
            confidence: r.confidence,
            disposition: r.verification_required ? ("needs_field_verification" as const) : ("accepted" as const),
            workbook: r.provenance.workbook,
            worksheet: r.provenance.worksheet,
            source_row: r.provenance.source_row,
            source_column: r.provenance.source_column,
            source_photo: r.provenance.source_photo,
          })),
        },
      });
    },
    onSuccess: (r) => {
      const drifted = [...r.fields, ...r.topology].filter((x) => x.status === "drifted").length;
      if (!r.applied) {
        toast.success(`Dry run: ${r.changed} would change, ${r.skipped} skipped.`);
        return;
      }
      toast.success(
        `Applied ${r.changed} change(s); ${r.skipped} skipped${drifted ? `, ${drifted} drifted and were not written` : ""}. Evidence rows kept: ${r.observations_recorded}.`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const panels = useMemo(
    () => [...new Set((result?.rows ?? []).map((r) => r.panel_id ?? r.panel_source_name))],
    [result],
  );

  const visible = useMemo(() => {
    const rows = (result?.rows ?? []).map((r, i) => ({ r, i }));
    return rows.filter(({ r }) => {
      if (panel !== "all" && (r.panel_id ?? r.panel_source_name) !== panel) return false;
      switch (filter) {
        case "matches":
          return r.classification === "MATCH";
        case "conflicts":
          return (
            r.classification === "THREE_WAY_CONFLICT" ||
            r.classification === "CANONICAL_DIFFERS_FROM_FIELD" ||
            r.classification === "FARMOPS_DIFFERS_FROM_FIELD"
          );
        case "verification":
          return r.verification_required;
        case "updates":
          return r.proposed_action === "propose_farmops_update";
        case "topology":
          return r.classification === "TOPOLOGY_PROPOSAL";
        case "low_confidence":
          return r.confidence === "low" || r.confidence === "unknown";
        default:
          return true;
      }
    });
  }, [result, panel, filter]);

  const totals = result?.totals;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Camera className="h-4 w-4" />
          House panel field-observation reconciliation
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Transcribed panel-directory photographs compared three ways: engineering / canonical,
          FarmOps and field observed. Field observation is evidence of the installed system — a
          panel label may itself be stale or wrong. Preview writes nothing and the canonical
          engineering workbook is never written.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept=".ods"
            className="text-sm"
            disabled={previewMutation.isPending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) previewMutation.mutate(file);
            }}
          />
          {previewMutation.isPending ? (
            <span className="text-sm text-muted-foreground">Parsing…</span>
          ) : null}
        </div>

        {result ? (
          <>
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="outline">{totals?.source_rows_read} source rows read</Badge>
              <Badge variant="outline">{totals?.unique_logical_breakers} logical breakers</Badge>
              <Badge variant="outline">{totals?.multipole_continuation_rows_merged} continuation rows merged</Badge>
              <Badge variant="outline">
                {totals?.duplicate_source_rows_suppressed} duplicate rows suppressed
              </Badge>
              <Badge variant="outline">{totals?.field_observations_emitted} observations</Badge>
              <Badge variant="outline">
                {totals?.sheets_recognized} sheets parsed / {totals?.sheets_skipped} skipped
              </Badge>
              <Badge variant="outline">{totals?.single_pole} single-pole</Badge>
              <Badge variant="outline">{totals?.multi_pole} multi-pole</Badge>
              <Badge variant="outline">{totals?.fields_compared_against_farmops} compared to FarmOps</Badge>
              <Badge variant="secondary">{totals?.farmops_record_absent} no FarmOps record</Badge>
              <Badge variant="secondary">{totals?.canonical_no_mapping} no canonical mapping</Badge>
              <Badge variant="outline">{totals?.exact_matches} exact matches</Badge>
              <Badge variant="secondary">{totals?.unresolved_observations} new / unresolved</Badge>
              <Badge variant={totals?.conflicts ? "destructive" : "outline"}>
                {totals?.conflicts} conflicts
              </Badge>
              <Badge variant={totals?.source_evidence_conflicts ? "destructive" : "outline"}>
                {totals?.source_evidence_conflicts} source conflicts
              </Badge>
              <Badge variant="secondary">{totals?.verification_required} verification required</Badge>
              <Badge variant="secondary">
                {totals?.topology_proposals} topology proposals / {totals?.topology_evidence_rows} evidence
              </Badge>
              <Badge variant="outline">{totals?.eligible_farmops_updates} eligible updates</Badge>
            </div>

            <p className="text-xs text-muted-foreground">
              Source rows are spreadsheet rows, not breakers: multi-pole continuation rows and
              duplicate representations of the same breaker on another sheet collapse into the
              logical-breaker count.
            </p>

            {result.diagnostics.sheets_skipped.length ? (
              <div className="text-xs text-muted-foreground">
                Sheets not parsed:{" "}
                {result.diagnostics.sheets_skipped
                  .map((s) => `${s.worksheet} (${s.reason})`)
                  .join("; ")}
              </div>
            ) : null}


            <div className="flex flex-wrap items-center gap-2">
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                value={panel}
                onChange={(e) => setPanel(e.target.value)}
              >
                <option value="all">All panels</option>
                {panels.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                value={filter}
                onChange={(e) => setFilter(e.target.value as Filter)}
              >
                <option value="all">Everything</option>
                <option value="matches">Matches</option>
                <option value="conflicts">Differences / conflicts</option>
                <option value="verification">Verification required</option>
                <option value="low_confidence">Low / unknown confidence</option>
                <option value="updates">Proposed FarmOps updates</option>
                <option value="topology">Topology proposals</option>
              </select>
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => download(FIELD_RECONCILIATION_CSV, result.csv, "text/csv")}
              >
                <Download className="h-4 w-4" /> CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() =>
                  download(
                    "phase-4.4b-house-panel-field-reconciliation.md",
                    result.markdown,
                    "text/markdown",
                  )
                }
              >
                <FileText className="h-4 w-4" /> Markdown report
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-1"> </th>
                    <th className="p-1">Panel</th>
                    <th className="p-1">Position(s)</th>
                    <th className="p-1">Field</th>
                    <th className="p-1">Engineering / canonical</th>
                    <th className="p-1">FarmOps</th>
                    <th className="p-1">Field observed</th>
                    <th className="p-1">Confidence</th>
                    <th className="p-1">Classification</th>
                    <th className="p-1">Proposed action</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(({ r, i }) => {
                    const k = rowKey(r, i);
                    const selectable =
                      r.proposed_action === "propose_farmops_update" ||
                      r.proposed_action === "propose_topology_update";
                    return (
                      <tr key={k} className="border-b border-border align-top">
                        <td className="p-1">
                          {selectable ? (
                            <Checkbox
                              checked={selected.has(k)}
                              onCheckedChange={(v) =>
                                setSelected((prev) => {
                                  const next = new Set(prev);
                                  if (v) next.add(k);
                                  else next.delete(k);
                                  return next;
                                })
                              }
                            />
                          ) : null}
                        </td>
                        <td className="p-1 font-mono">{r.panel_id ?? r.panel_source_name}</td>
                        <td className="p-1">
                          {r.positions_text || "—"}
                          {r.poles && r.poles > 1 ? (
                            <span className="ml-1 text-xs text-muted-foreground">
                              ({r.poles}-pole, {r.positions.length} positions)
                            </span>
                          ) : null}
                        </td>
                        <td className="p-1">{r.field_label}</td>
                        <td className="p-1">{r.canonical_value ?? "(silent)"}</td>
                        <td className="p-1">{r.farmops_value ?? "(none)"}</td>
                        <td className="p-1">
                          <span className="font-medium">{r.field_observed_text || "(blank)"}</span>
                          {r.field_interpreted !== null &&
                          String(r.field_interpreted) !== r.field_observed_text ? (
                            <span className="ml-1 text-xs text-muted-foreground">
                              → {String(r.field_interpreted)}
                            </span>
                          ) : null}
                        </td>
                        <td className="p-1">{r.confidence}</td>
                        <td className="p-1">
                          <Badge
                            variant={
                              r.classification === "MATCH"
                                ? "outline"
                                : r.classification === "THREE_WAY_CONFLICT"
                                  ? "destructive"
                                  : "secondary"
                            }
                          >
                            {r.classification}
                          </Badge>
                        </td>
                        <td className="p-1">
                          {r.proposed_action}
                          {r.detail ? (
                            <div className="text-xs text-muted-foreground">{r.detail}</div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {result.warnings.length ? (
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <ShieldAlert className="mt-0.5 h-4 w-4" />
                <div>
                  {result.warnings.map((w) => (
                    <div key={w}>{w}</div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={applyMutation.isPending || !selected.size}
                onClick={() => applyMutation.mutate(false)}
              >
                Dry run selected ({selected.size})
              </Button>
              <Button
                size="sm"
                disabled={applyMutation.isPending || !selected.size}
                onClick={() => {
                  if (
                    !window.confirm(
                      `Apply ${selected.size} explicitly selected field/topology change(s)? Only the selected fields are written; drifted rows are skipped.`,
                    )
                  )
                    return;
                  applyMutation.mutate(true);
                }}
              >
                Apply selected
              </Button>
              <span className="text-xs text-muted-foreground">
                Canonical ODS is never written. Proposed future revisions are never modified.
              </span>
            </div>

            {applyMutation.data ? (
              <div className="space-y-1 text-sm">
                {[...applyMutation.data.fields, ...applyMutation.data.topology].map((x, i) => (
                  <div key={i} className="flex flex-wrap gap-2">
                    <Badge
                      variant={
                        x.status === "changed" || x.status === "would_change"
                          ? "outline"
                          : x.status === "drifted" || x.status === "failed"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {x.status}
                    </Badge>
                    <span className="font-mono">{x.panel_id}</span>
                    <span className="text-muted-foreground">
                      {"column" in x ? `${x.side} ${x.position} · ${x.column}` : `parent → ${x.proposed_parent}`}
                    </span>
                    {x.detail ? <span className="text-muted-foreground">{x.detail}</span> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
