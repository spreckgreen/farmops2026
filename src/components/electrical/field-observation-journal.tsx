// Phase 4.4b — read-only journal of recorded field observations.
//
// Each row is one photo-derived value with its provenance (workbook, worksheet,
// cell, photo) and the outcome of the FarmOps write, so a value that is now in
// FarmOps can always be traced back to the photograph it came from.
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, Eye, Loader2, NotebookPen, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isLinkedPhotoBucket } from "@/components/electrical/observation-photo-cell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  listFieldObservationJournal,
  type JournalEntry,
  type JournalResult,
} from "@/lib/electrical-field-journal.functions";

const SCOPES = [
  { value: "all", label: "House + Farm Shop" },
  { value: "house", label: "House" },
  { value: "farm_shop", label: "Farm Shop" },
] as const;

const APPLY_LABELS: Record<string, string> = {
  changed: "Written to FarmOps",
  already_correct: "FarmOps already matched",
  drifted: "Skipped — FarmOps drifted",
  not_found: "Skipped — record not found",
  failed: "Write failed",
  not_applied: "Evidence only",
};

function applyVariant(status: string | null): "default" | "secondary" | "outline" | "destructive" {
  if (status === "changed") return "default";
  if (status === "failed" || status === "drifted" || status === "not_found") return "destructive";
  if (status === "already_correct") return "secondary";
  return "outline";
}

const dash = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === "" ? "—" : String(v);

function provenance(e: JournalEntry) {
  const parts = [e.workbook];
  if (e.worksheet) parts.push(`sheet “${e.worksheet}”`);
  if (e.source_row) parts.push(`row ${e.source_row}`);
  if (e.source_column) parts.push(`column “${e.source_column}”`);
  if (e.source_photo) parts.push(`photo ${e.source_photo}`);
  return parts.join(" · ");
}

function csvCell(v: string | number | null | undefined) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function journalCsv(entries: JournalEntry[]) {
  const head = [
    "recorded_at",
    "scope",
    "panel",
    "positions",
    "side",
    "position",
    "field",
    "observed_text",
    "interpreted_value",
    "canonical_value",
    "farmops_value_before",
    "applied_value",
    "apply_status",
    "applied_at",
    "confidence",
    "classification",
    "disposition",
    "verification_status",
    "workbook",
    "worksheet",
    "source_row",
    "source_column",
    "source_photo",
    "photo_path",
  ];
  const lines = entries.map((e) =>
    [
      e.created_at,
      e.scope,
      e.panel_ref,
      e.positions_text,
      e.side,
      e.position,
      e.field,
      e.observed_text,
      e.interpreted_value,
      e.canonical_value,
      e.applied_previous_value ?? e.farmops_value,
      e.applied_value,
      e.apply_status ?? "not_applied",
      e.applied_at,
      e.confidence,
      e.classification,
      e.disposition,
      e.verification_status,
      e.workbook,
      e.worksheet,
      e.source_row,
      e.source_column,
      e.source_photo,
      e.photo_path,
    ]
      .map(csvCell)
      .join(","),
  );
  return [head.join(","), ...lines].join("\n");
}

function download(name: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function FieldObservationJournal() {
  const list = useServerFn(listFieldObservationJournal);
  const [scope, setScope] = useState<(typeof SCOPES)[number]["value"]>("all");
  const [appliedOnly, setAppliedOnly] = useState(false);
  const [result, setResult] = useState<JournalResult | null>(null);

  const load = useMutation({
    mutationFn: () => list({ data: { scope, applied_only: appliedOnly, limit: 300 } }),
    onSuccess: setResult,
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not load the observation journal."),
  });

  const entries = useMemo(() => result?.entries ?? [], [result]);

  async function viewPhoto(e: JournalEntry) {
    if (!e.photo_path) return;
    // OneDrive / Google Drive evidence is a share link, not a stored object.
    if (isLinkedPhotoBucket(e.photo_bucket)) {
      window.open(e.photo_path, "_blank", "noopener,noreferrer");
      return;
    }
    const { data, error } = await supabase.storage
      .from(e.photo_bucket || "field-observations")
      .createSignedUrl(e.photo_path, 300);
    if (error || !data?.signedUrl) {
      toast.error(error?.message ?? "Could not open that photo.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <NotebookPen className="h-4 w-4" />
          Field-observation journal
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Every recorded photo-derived value with its provenance and the outcome of the FarmOps
          write. “Written to FarmOps” means the value is now in FarmOps; everything else is kept as
          evidence only. The canonical engineering workbook is never written from this journal.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={scope}
            onChange={(ev) => setScope(ev.target.value as typeof scope)}
          >
            {SCOPES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={appliedOnly}
              onChange={(ev) => setAppliedOnly(ev.target.checked)}
            />
            Only values now in FarmOps
          </label>
          <Button size="sm" className="gap-1" disabled={load.isPending} onClick={() => load.mutate()}>
            {load.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Load journal
          </Button>
          {entries.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={() =>
                download("phase-4.4b-field-observation-journal.csv", journalCsv(entries))
              }
            >
              <Download className="h-4 w-4" /> CSV
            </Button>
          )}
        </div>

        {result && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">{result.totals.entries} entries</Badge>
            <Badge>{result.totals.in_farmops} now in FarmOps</Badge>
            <Badge variant="secondary">{result.totals.already_correct} already matched</Badge>
            <Badge variant="outline">{result.totals.evidence_only} evidence only</Badge>
            <Badge variant={result.totals.not_written ? "destructive" : "outline"}>
              {result.totals.not_written} not written
            </Badge>
            <Badge variant="outline">
              {result.totals.awaiting_field_verification} awaiting field verification
            </Badge>
            <Badge variant="outline">{result.totals.with_photo} with photo</Badge>
            {result.truncated && (
              <Badge variant="destructive">Showing the newest 300 — narrow the filters</Badge>
            )}
          </div>
        )}

        {result && entries.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No recorded observations match these filters yet. Applying a panel photo reconciliation
            records its evidence rows here.
          </p>
        )}

        {entries.length > 0 && (
          <div className="max-h-[32rem] overflow-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr className="text-left">
                  <th className="p-2">Recorded</th>
                  <th className="p-2">Panel / position</th>
                  <th className="p-2">Field</th>
                  <th className="p-2">Observed</th>
                  <th className="p-2">FarmOps before → after</th>
                  <th className="p-2">Outcome</th>
                  <th className="p-2">Provenance</th>
                  <th className="p-2">Photo</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-t align-top">
                    <td className="whitespace-nowrap p-2">
                      {new Date(e.created_at).toLocaleString("en-US", {
                        timeZone: "America/New_York",
                      })}
                      <div className="text-muted-foreground">{dash(e.scope)}</div>
                    </td>
                    <td className="p-2">
                      <div className="font-medium">{e.panel_ref}</div>
                      <div className="text-muted-foreground">
                        {dash(e.positions_text)}
                        {e.side ? ` · ${e.side} ${dash(e.position)}` : ""}
                        {e.poles ? ` · ${e.poles}P` : ""}
                      </div>
                    </td>
                    <td className="p-2">
                      {e.field}
                      <div className="text-muted-foreground">{dash(e.confidence)}</div>
                    </td>
                    <td className="max-w-[16rem] p-2">
                      <div className="truncate" title={e.observed_text}>
                        {dash(e.observed_text)}
                      </div>
                      <div className="text-muted-foreground">
                        interpreted: {dash(e.interpreted_value)}
                      </div>
                      <div className="text-muted-foreground">
                        canonical: {dash(e.canonical_value)}
                      </div>
                    </td>
                    <td className="p-2">
                      {dash(e.applied_previous_value ?? e.farmops_value)} → {dash(e.applied_value)}
                      {e.applied_at && (
                        <div className="text-muted-foreground">
                          {new Date(e.applied_at).toLocaleString("en-US", {
                            timeZone: "America/New_York",
                          })}
                        </div>
                      )}
                    </td>
                    <td className="p-2">
                      <Badge variant={applyVariant(e.apply_status)}>
                        {APPLY_LABELS[e.apply_status ?? "not_applied"] ?? e.apply_status}
                      </Badge>
                      <div className="mt-1 text-muted-foreground">
                        {dash(e.classification)} · {e.disposition}
                      </div>
                    </td>
                    <td className="max-w-[18rem] p-2 text-muted-foreground">
                      <div className="truncate" title={provenance(e)}>
                        {provenance(e)}
                      </div>
                    </td>
                    <td className="p-2">
                      {e.photo_path ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 gap-1 px-1"
                          onClick={() => void viewPhoto(e)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span className="max-w-[7rem] truncate">{dash(e.photo_name)}</span>
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
