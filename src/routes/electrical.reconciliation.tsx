// Load_Master Contract v3 — controlled reconciliation gate (PREVIEW ONLY).
//
// Freezes Contract v3 against the authorized canonical SHA and reports, for every
// stable ID and every v3 semantic field, how the canonical projection relates to
// current FarmOps electrical_loads. Canonical never automatically overwrites
// FarmOps: there is no write, no apply gate and no Phase 4.5 authorization here.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, FileSpreadsheet, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CANONICAL_ODS_PATH } from "@/lib/electrical-sor";
import {
  reconcileContractV3,
  type ReconciliationPayload,
} from "@/lib/electrical-contract-v3-reconciliation.functions";
import {
  CONTRACT_V3_FROZEN,
  reconciliationCsv,
  type ReconClassification,
} from "@/lib/electrical-contract-v3-reconciliation";

export const Route = createFileRoute("/electrical/reconciliation")({
  component: ReconciliationPage,
  head: () => ({
    meta: [
      { title: "Contract v3 Reconciliation Gate — Bostead Farms" },
      {
        name: "description",
        content:
          "Preview-only reconciliation between the frozen Load_Master Contract v3 canonical projection and current FarmOps electrical loads, with an explicit authority and disposition for every difference.",
      },
      { property: "og:title", content: "Contract v3 Reconciliation Gate — Bostead Farms" },
      {
        property: "og:description",
        content:
          "Field-by-field canonical vs FarmOps reconciliation under the authority model: no writes, no apply gate.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

const CLASSES: ReconClassification[] = [
  "MATCH",
  "NORMALIZATION_EQUIVALENT",
  "CANONICAL_VALUE_MISSING_IN_FARMOPS",
  "FARMOPS_VALUE_DIFFERS",
  "FARMOPS_AS_BUILT_AUTHORITY",
  "LEGACY_PRESERVED",
  "DERIVED_DO_NOT_IMPORT",
  "CURRENT_SEMANTICS_WITHHELD",
  "CANONICAL_CORRECTION_PENDING",
  "NEWER_FARMOPS_EVIDENCE",
  "NOT_REPRESENTABLE",
];

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buf.length; i += 8192) {
    binary += String.fromCharCode(...buf.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const MAX_VISIBLE = 400;

function ReconciliationPage() {
  const run = useServerFn(reconcileContractV3);
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ReconciliationPayload | null>(null);
  const [only, setOnly] = useState<ReconClassification | "all">("all");
  const [filter, setFilter] = useState("");

  const mutation = useMutation({
    mutationFn: (vars: { file_name: string; base64: string }) =>
      run({ data: vars }) as Promise<ReconciliationPayload>,
    onSuccess: (payload) => {
      setResult(payload);
      toast.success(
        `Compared ${payload.headline.total_compared} field(s) — not representable ${payload.headline.not_representable}, semantic loss ${payload.headline.semantic_loss}.`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo(() => {
    if (!result) return [];
    const needle = filter.trim().toLowerCase();
    return result.records.filter(
      (r) =>
        (only === "all" || r.classification === only) &&
        (!needle ||
          `${r.stable_id} ${r.semantic} ${r.header} ${r.canonical_raw} ${r.farmops_current}`
            .toLowerCase()
            .includes(needle)),
    );
  }, [result, only, filter]);

  const h = result?.headline;

  return (
    <ElectricalGate>
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 pb-2">
            <div>
              <CardTitle className="text-base">
                Load_Master Contract v3 — controlled reconciliation gate
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Contract v3 is frozen: {CONTRACT_V3_FROZEN.observed_columns} observed columns,{" "}
                {CONTRACT_V3_FROZEN.bound_columns} bound, {CONTRACT_V3_FROZEN.canonical_rows}{" "}
                canonical rows, semantic loss 0, critical-load rules PASS. Attach{" "}
                <span className="font-mono">{CANONICAL_ODS_PATH}</span> at authorized SHA{" "}
                <span className="font-mono">{CONTRACT_V3_FROZEN.authorized_sha256.slice(0, 12)}…</span>{" "}
                to preview the reconciliation. Nothing is written and no apply gate exists.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={input}
                type="file"
                accept=".ods,application/vnd.oasis.opendocument.spreadsheet"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  mutation.mutate({ file_name: f.name, base64: await fileToBase64(f) });
                }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => input.current?.click()}
                disabled={mutation.isPending}
              >
                <FileSpreadsheet className="h-4 w-4 mr-1" />
                {mutation.isPending ? "Reconciling…" : "Choose .ods"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!result}
                onClick={() =>
                  result &&
                  download(
                    `contract-v3-reconciliation-${result.generated_at.slice(0, 19).replace(/[:T]/g, "-")}.csv`,
                    reconciliationCsv(result),
                    "text/csv",
                  )
                }
              >
                <Download className="h-4 w-4 mr-1" />
                CSV
              </Button>
            </div>
          </CardHeader>
          {result ? (
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant={result.acceptance.sha_authorized ? "default" : "destructive"}>
                  {result.acceptance.sha_authorized ? (
                    <ShieldCheck className="h-3 w-3 mr-1" />
                  ) : (
                    <ShieldAlert className="h-3 w-3 mr-1" />
                  )}
                  {result.acceptance.sha_authorized ? "Authorized SHA" : "Unauthorized SHA"}
                </Badge>
                <Badge
                  variant={result.acceptance.frozen_baseline_reproduced ? "default" : "destructive"}
                >
                  Frozen v3 baseline{" "}
                  {result.acceptance.frozen_baseline_reproduced ? "reproduced" : "NOT reproduced"}
                </Badge>
                <Badge variant={result.ready_to_proceed ? "default" : "outline"}>
                  {result.ready_to_proceed
                    ? "Acceptance for proceeding met"
                    : "Acceptance for proceeding not met"}
                </Badge>
                <Badge variant="outline" className="font-mono">
                  {result.ods_sha256.slice(0, 12)}…
                </Badge>
                <Badge variant="outline">{result.farmops_row_count} FarmOps load(s)</Badge>
              </div>

              {h ? (
                <div className="grid gap-2 text-xs sm:grid-cols-3 lg:grid-cols-5">
                  {[
                    ["Total compared", h.total_compared],
                    ["Matches", h.matches],
                    ["Normalization equivalent", h.normalization_equivalent],
                    ["Canonical repair candidates", h.canonical_repair_candidates],
                    ["FarmOps / as-built retained", h.farmops_as_built_retained],
                    ["Withheld", h.withheld],
                    ["Newer FarmOps evidence", h.newer_evidence],
                    ["Not representable", h.not_representable],
                    ["Semantic loss", h.semantic_loss],
                    ["Legacy preserved", result.counts.LEGACY_PRESERVED],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-md border border-border p-2">
                      <div className="text-muted-foreground">{label}</div>
                      <div className="text-lg font-semibold tabular-nums">{value}</div>
                    </div>
                  ))}
                </div>
              ) : null}

              <p className="text-xs text-muted-foreground">
                Canonical ODS holds engineering / design intent; FarmOps holds verified as-built
                state. Newer field evidence is never overwritten by an older workbook value, derived
                representations are not imported, legacy duplicates never overwrite their
                authoritative semantic, the four unresolved current-semantic findings stay withheld,
                and the superseded FS-082 / FS-083 120 V values are never reintroduced.
              </p>

              {result.missing_in_farmops.length || result.farmops_only_ids.length ? (
                <div className="rounded-md border border-border p-2 text-xs space-y-1">
                  {result.missing_in_farmops.length ? (
                    <div>
                      Canonical only:{" "}
                      <span className="font-mono">{result.missing_in_farmops.join(", ")}</span>
                    </div>
                  ) : null}
                  {result.farmops_only_ids.length ? (
                    <div>
                      FarmOps only:{" "}
                      <span className="font-mono">{result.farmops_only_ids.join(", ")}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={only === "all" ? "default" : "outline"}
                  onClick={() => setOnly("all")}
                >
                  All ({result.records.length})
                </Button>
                {CLASSES.filter((c) => result.counts[c] > 0).map((c) => (
                  <Button
                    key={c}
                    size="sm"
                    variant={only === c ? "default" : "outline"}
                    onClick={() => setOnly(c)}
                  >
                    {c} ({result.counts[c]})
                  </Button>
                ))}
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by stable ID, field or value"
                  className="h-8 w-64"
                />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th className="py-1 pr-3">Stable ID</th>
                      <th className="py-1 pr-3">Col</th>
                      <th className="py-1 pr-3">Header</th>
                      <th className="py-1 pr-3">Semantic</th>
                      <th className="py-1 pr-3">Canonical raw</th>
                      <th className="py-1 pr-3">Canonical normalized</th>
                      <th className="py-1 pr-3">FarmOps current</th>
                      <th className="py-1 pr-3">Authority</th>
                      <th className="py-1 pr-3">Classification</th>
                      <th className="py-1 pr-3">Proposed action</th>
                      <th className="py-1">Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, MAX_VISIBLE).map((r, i) => (
                      <tr
                        key={`${r.stable_id}-${r.physical_column}-${i}`}
                        className="border-t border-border"
                      >
                        <td className="py-1 pr-3 font-mono">{r.stable_id}</td>
                        <td className="py-1 pr-3 tabular-nums">{r.physical_column}</td>
                        <td className="py-1 pr-3">{r.header}</td>
                        <td className="py-1 pr-3 font-mono">{r.semantic}</td>
                        <td className="py-1 pr-3 font-mono">{r.canonical_raw || "—"}</td>
                        <td className="py-1 pr-3 font-mono">{r.canonical_normalized || "—"}</td>
                        <td className="py-1 pr-3 font-mono">{r.farmops_current || "—"}</td>
                        <td className="py-1 pr-3">{r.authority}</td>
                        <td className="py-1 pr-3">{r.classification}</td>
                        <td className="py-1 pr-3">{r.proposed_action}</td>
                        <td className="py-1 text-muted-foreground">{r.evidence}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > MAX_VISIBLE ? (
                <p className="text-xs text-muted-foreground">
                  Showing the first {MAX_VISIBLE} of {rows.length} rows — download the CSV for the
                  complete record set.
                </p>
              ) : null}
            </CardContent>
          ) : (
            <CardContent>
              <p className="text-sm text-muted-foreground">
                No reconciliation yet. Contract v3 is not modified by this screen and the canonical
                workbook is read only.
              </p>
            </CardContent>
          )}
        </Card>
      </div>
    </ElectricalGate>
  );
}
