// Load_Master Import Contract v2 — READ ONLY.
//
// Defines all 41 physical Load_Master columns by physical column number + exact
// header, then simulates a complete re-import of every canonical row and
// compares the resulting critical-load business-rule output against the
// canonical ODS-derived result. No FarmOps record is modified anywhere here.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, FileSpreadsheet, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { PersistedSection } from "@/components/electrical/persisted-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CANONICAL_ODS_PATH } from "@/lib/electrical-sor";
import { useCanonicalWorkbookSession } from "@/hooks/use-canonical-workbook-session";
import {
  loadMasterImportContract,
  type ImportContractPayload,
} from "@/lib/electrical-load-import-contract.functions";
import {
  CONTRACT_COLUMN_COUNT,
  LOAD_MASTER_CONTRACT_V2,
  contractCsv,
  simulationCsv,
  type ImportAction,
} from "@/lib/electrical-load-import-contract";
import {
  buildLossClosure,
  closureCsv,
  unresolvedCellCsv,
  unresolvedCellDetail,
} from "@/lib/electrical-load-loss-closure";
import { alignmentCsv } from "@/lib/electrical-load-contract-v3";

export const Route = createFileRoute("/electrical/import-contract")({
  component: ImportContractPage,
  head: () => ({
    meta: [
      { title: "Load_Master Import Contract v3 — Bostead Farms" },
      {
        name: "description",
        content:
          "Read-only Load_Master Import Contract v3: every physical column bound by position, exact observed header and canonical semantic identity from the SHA-authorized workbook, with registry alignment audit and lossless re-import simulation.",
      },
      { property: "og:title", content: "Load_Master Import Contract v3 — Bostead Farms" },
      {
        property: "og:description",
        content:
          "Contract-driven re-import simulation of every canonical load row, requiring semantic loss = 0 before any repair is authorized.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

const ACTION_VARIANT: Record<ImportAction, "default" | "secondary" | "outline" | "destructive"> = {
  IMPORT_DIRECT: "default",
  IMPORT_NORMALIZED: "secondary",
  DERIVED_REPRESENTATION_DO_NOT_IMPORT: "outline",
  SCHEMA_EXTENSION_REQUIRED: "outline",
  LEGACY_PRESERVE: "outline",
  AS_BUILT_FIELD: "outline",
  IGNORE_WITH_REASON: "outline",
  UNRESOLVED: "destructive",
};

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

function ImportContractPage() {
  const run = useServerFn(loadMasterImportContract);
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ImportContractPayload | null>(null);
  const [filter, setFilter] = useState("");
  const { availability } = useCanonicalWorkbookSession();

  const mutation = useMutation({
    mutationFn: (vars: { file_name: string; base64: string }): Promise<ImportContractPayload> =>
      run({ data: vars }) as Promise<ImportContractPayload>,
    onSuccess: (payload) => {
      setResult(payload);
      toast.success(
        `${payload.contract_version} simulated over ${payload.row_count} row(s) — semantic loss ${payload.totals.semantic_loss}.`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const rows = result
      ? result.binding.columns
      : LOAD_MASTER_CONTRACT_V2.map((c) => ({
          ...c,
          observed_header: "",
          binding_status: "COLUMN_ABSENT" as const,
          effective_action: c.import_action,
        }));
    if (!needle) return rows;
    return rows.filter((c) =>
      `${c.physical_column} ${c.exact_header} ${c.canonical_semantic} ${c.farmops_destination ?? ""} ${c.import_action}`
        .toLowerCase()
        .includes(needle),
    );
  }, [result, filter]);

  // Read-only closure plan over the columns that do not bind at their physical position.
  const closure = useMemo(
    () =>
      result
        ? buildLossClosure(
            result.binding,
            result.fields,
            result.row_count,
            result.contract_version,
          )
        : null,
    [result],
  );

  const unresolvedCells = useMemo(
    () => (result && closure ? unresolvedCellDetail(closure, result.unresolved_cells ?? []) : []),
    [result, closure],
  );

  return (
    <ElectricalGate>
      <div className="space-y-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheet className="h-4 w-4" /> Load_Master Import Contract v3 (read only)
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Contract v3 is materialised from the SHA-authorized{" "}
              <span className="font-mono">{CANONICAL_ODS_PATH}</span> header row itself: every
              physical column binds by position plus its exact observed header plus a registered
              canonical semantic identity. Contract v2's fixed {CONTRACT_COLUMN_COUNT}-column
              positional registry is retained unmodified for audit history and reported in the
              alignment audit below. A populated column whose observed header matches no registered
              canonical semantic stays UNRESOLVED rather than being slid onto a neighbour. Nothing
              on this page writes a FarmOps record, a schema migration or a re-import.
            </p>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={input}
                type="file"
                accept=".ods"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  mutation.mutate({ file_name: file.name, base64: await fileToBase64(file) });
                }}
              />
              <Button size="sm" onClick={() => input.current?.click()} disabled={mutation.isPending}>
                {mutation.isPending ? "Simulating…" : "Select canonical .ods"}
              </Button>
              {availability.state === "available" && !result ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    mutation.mutate({
                      file_name: availability.meta.file_name,
                      base64: availability.base64,
                    })
                  }
                  disabled={mutation.isPending}
                >
                  Use session workbook ({availability.meta.file_name})
                </Button>
              ) : null}
              {availability.state === "reattach_required" && !result ? (
                <span className="text-xs text-muted-foreground">
                  {availability.meta.file_name} was validated this session, but its bytes are not
                  retained across a reload — reattach the same file.
                </span>
              ) : null}
            </div>

            {result ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={result.sha_authorized ? "default" : "outline"}>
                    {result.sha_authorized ? (
                      <ShieldCheck className="mr-1 h-3 w-3" />
                    ) : (
                      <ShieldAlert className="mr-1 h-3 w-3" />
                    )}
                    {result.sha_authorized
                      ? "SHA-authorized canonical workbook"
                      : "Not the authorized baseline SHA"}
                  </Badge>
                  <span className="break-all font-mono text-xs text-muted-foreground">
                    {result.ods_sha256}
                  </span>
                </div>
                <p className="text-muted-foreground">
                  {result.binding.sheet} · header row {result.binding.header_row} ·{" "}
                  {result.binding.observed_column_count} observed column(s) ·{" "}
                  {result.binding.bound}/{result.binding.expected_column_count} contract columns
                  bound · {result.row_count} row(s) simulated · contract{" "}
                  <span className="font-mono">{result.contract_version}</span>
                </p>
                <p
                  className={
                    result.accepted
                      ? "rounded-md border border-border bg-muted/40 p-2 font-medium"
                      : "rounded-md border border-destructive/40 bg-destructive/10 p-2 font-medium"
                  }
                >
                  {result.accepted
                    ? `Acceptance met: semantic loss = 0. Every populated canonical cell is representable under ${result.contract_version}, either in a typed FarmOps destination or preserved verbatim under its source identity.`
                    : `Acceptance NOT met: semantic loss = ${result.totals.semantic_loss}. Repair stays blocked until every populated canonical cell is representable.`}
                </p>
                <p
                  className={
                    result.reproduces_canonical
                      ? "rounded-md border border-border bg-muted/40 p-2"
                      : "rounded-md border border-destructive/40 bg-destructive/10 p-2 font-medium"
                  }
                >
                  {result.reproduces_canonical
                    ? "Critical-load business rules computed from the simulated import reproduce the canonical ODS-derived result on every metric, with no expected values hard-coded."
                    : "Critical-load business rules do not yet reproduce the canonical ODS-derived result — see the reconciliation section."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() =>
                      download(
                        `load-master-import-contract-${result.contract_version}.csv`,
                        contractCsv(result.binding),
                        "text/csv",
                      )
                    }
                  >
                    <Download className="h-4 w-4" /> Contract CSV
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() =>
                      download(
                        "load-master-reimport-simulation.csv",
                        simulationCsv(result),
                        "text/csv",
                      )
                    }
                  >
                    <Download className="h-4 w-4" /> Simulation CSV
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {result ? (
          <PersistedSection
            storageKey="import-contract-alignment"
            title={`Contract registry alignment audit — ${result.alignment.from_version} → ${result.alignment.to_version}`}
            defaultOpen
          >
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Physical column by physical column: the header Contract v2 expected, the header the
                authorized workbook actually carries, the semantic identity the prior positional
                registry assigned, and the disposition v3 applies. A rebound column is a registry
                mismatch, not semantic loss — a known canonical field is never demoted to a
                structured extra just because v2 expected a different header at that position.
              </p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(result.alignment.totals)
                  .filter(([, n]) => n > 0)
                  .map(([k, n]) => (
                    <Badge key={k} variant={k === "ALIGNED" ? "default" : "outline"}>
                      {k}: {n}
                    </Badge>
                  ))}
                <Badge variant="secondary">
                  mismatched positions: {result.alignment.mismatched_positions}
                </Badge>
                <Badge
                  variant={
                    result.alignment.unknown_populated_columns ? "destructive" : "outline"
                  }
                >
                  genuinely unknown populated columns:{" "}
                  {result.alignment.unknown_populated_columns}
                </Badge>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() =>
                  download(
                    "load-master-contract-registry-alignment.csv",
                    alignmentCsv(result.alignment),
                    "text/csv",
                  )
                }
              >
                <Download className="h-4 w-4" /> Alignment audit CSV
              </Button>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="p-1">#</th>
                      <th className="p-1">v2 expected header</th>
                      <th className="p-1">observed header</th>
                      <th className="p-1">prior semantic identity</th>
                      <th className="p-1">v3 semantic identity</th>
                      <th className="p-1">populated</th>
                      <th className="p-1">disposition</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.alignment.rows.map((r) => (
                      <tr key={r.physical_column} className="border-t border-border/60 align-top">
                        <td className="p-1 font-mono">{r.physical_column}</td>
                        <td className="p-1 font-mono">{r.v2_expected_header}</td>
                        <td className="p-1 font-mono">{r.observed_header}</td>
                        <td className="p-1 font-mono">{r.prior_semantic_identity}</td>
                        <td className="p-1 font-mono">{r.v3_semantic_identity}</td>
                        <td className="p-1">{r.populated_cells}</td>
                        <td className="p-1">
                          <Badge
                            variant={
                              r.disposition === "ALIGNED"
                                ? "default"
                                : r.disposition === "UNKNOWN_HEADER_OWNER_REVIEW"
                                  ? "destructive"
                                  : "outline"
                            }
                          >
                            {r.disposition}
                          </Badge>
                          <p className="mt-1 text-muted-foreground">{r.note}</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </PersistedSection>
        ) : null}

        <PersistedSection
          storageKey="import-contract-columns"
          title={
            result
              ? `${result.contract_version} — ${result.binding.expected_column_count} physical columns`
              : `Contract v2 registry (retained for audit) — ${CONTRACT_COLUMN_COUNT} physical columns`
          }
          defaultOpen
        >
          <div className="space-y-2">
            <Input
              placeholder="Filter by column, header, semantic field, destination or action…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="max-w-md"
            />
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="p-1">#</th>
                    <th className="p-1">exact_header</th>
                    <th className="p-1">observed</th>
                    <th className="p-1">canonical_semantic</th>
                    <th className="p-1">type</th>
                    <th className="p-1">allowed_tokens</th>
                    <th className="p-1">FarmOps destination</th>
                    <th className="p-1">transformation</th>
                    <th className="p-1">authority</th>
                    <th className="p-1">import_action</th>
                  </tr>
                </thead>
                <tbody>
                  {columns.map((c) => (
                    <tr key={c.physical_column} className="border-t border-border/60 align-top">
                      <td className="p-1 font-mono">{c.physical_column}</td>
                      <td className="p-1 font-mono">{c.exact_header}</td>
                      <td className="p-1 font-mono">
                        {result ? c.observed_header || "(blank)" : "—"}
                      </td>
                      <td className="p-1 font-mono">{c.canonical_semantic}</td>
                      <td className="p-1">{c.data_type}</td>
                      <td className="p-1">{c.allowed_tokens.join(" | ") || "—"}</td>
                      <td className="p-1 font-mono">{c.farmops_destination ?? "(none)"}</td>
                      <td className="p-1 max-w-[28rem]">{c.transformation}</td>
                      <td className="p-1">{c.authority}</td>
                      <td className="p-1">
                        <Badge variant={ACTION_VARIANT[c.effective_action]}>
                          {c.effective_action}
                        </Badge>
                        {c.reason ? (
                          <p className="mt-1 text-muted-foreground">{c.reason}</p>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </PersistedSection>

        {result ? (
          <>
            <PersistedSection storageKey="import-contract-simulation" title="Re-import simulation" defaultOpen>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="p-1">field</th>
                      <th className="p-1">source populated</th>
                      <th className="p-1">representable</th>
                      <th className="p-1">would import</th>
                      <th className="p-1">normalization only</th>
                      <th className="p-1">schema blocked</th>
                      <th className="p-1">unresolved</th>
                      <th className="p-1">semantic loss</th>
                      <th className="p-1">note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.fields.map((f) => (
                      <tr key={f.physical_column} className="border-t border-border/60 align-top">
                        <td className="p-1 font-mono">
                          {f.field}
                          <span className="ml-1 text-muted-foreground">#{f.physical_column}</span>
                        </td>
                        <td className="p-1">{f.source_populated}</td>
                        <td className="p-1">{f.representable}</td>
                        <td className="p-1">{f.would_import}</td>
                        <td className="p-1">{f.normalization_only}</td>
                        <td className="p-1">{f.schema_blocked}</td>
                        <td className="p-1">{f.unresolved}</td>
                        <td className={f.semantic_loss ? "p-1 font-semibold text-destructive" : "p-1"}>
                          {f.semantic_loss}
                        </td>
                        <td className="p-1 max-w-[30rem] text-muted-foreground">{f.note}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-border font-medium">
                      <td className="p-1">TOTAL</td>
                      <td className="p-1">{result.totals.source_populated}</td>
                      <td className="p-1">{result.totals.representable}</td>
                      <td className="p-1">{result.totals.would_import}</td>
                      <td className="p-1">{result.totals.normalization_only}</td>
                      <td className="p-1">{result.totals.schema_blocked}</td>
                      <td className="p-1">{result.totals.unresolved}</td>
                      <td
                        className={
                          result.totals.semantic_loss ? "p-1 text-destructive" : "p-1"
                        }
                      >
                        {result.totals.semantic_loss}
                      </td>
                      <td className="p-1" />
                    </tr>
                  </tbody>
                </table>
              </div>
            </PersistedSection>

            <PersistedSection
              storageKey="import-contract-closure"
              title={`Semantic-loss closure plan — ${closure!.unbound_column_count} unbound physical columns`}
              defaultOpen
            >
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  A populated canonical cell counts as lossless only when its exact value, source
                  worksheet, physical column, observed header and row all stay recoverable from
                  FarmOps. Structured extras satisfy that, so a dedicated column is proposed only
                  where the field drives engineering or business logic and must be queryable.
                  Critical-load rules are untouched. Nothing here writes a record or a migration.
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ["loss before", closure!.totals.semantic_loss_before],
                    ["removed by FIRST_CLASS_FIELD", closure!.totals.by_method.FIRST_CLASS_FIELD],
                    [
                      "removed by AS_BUILT_FIRST_CLASS_FIELD",
                      closure!.totals.by_method.AS_BUILT_FIRST_CLASS_FIELD,
                    ],
                    [
                      "removed by STRUCTURED_ODS_EXTRA",
                      closure!.totals.by_method.STRUCTURED_ODS_EXTRA,
                    ],
                    ["removed by LEGACY_FIELD", closure!.totals.by_method.LEGACY_FIELD],
                    [
                      "removed by DERIVED_REPRESENTATION",
                      closure!.totals.by_method.DERIVED_REPRESENTATION,
                    ],
                    ["zero-content", closure!.totals.removed_with_zero_semantic_content],
                    ["remaining unresolved", closure!.totals.remaining_unresolved],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-md border border-border p-2">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="font-mono text-lg">{value}</p>
                    </div>
                  ))}
                </div>
                <p
                  className={
                    closure!.closes
                      ? "rounded-md border border-border bg-muted/40 p-2 text-sm"
                      : "rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm font-medium"
                  }
                >
                  {closure!.closes
                    ? "Every populated cell in the unbound columns has a lossless preservation route, so semantic loss reaches 0 once the proposals below are adopted."
                    : `${closure!.totals.remaining_unresolved} cell(s) remain UNRESOLVED and need owner review before loss can close.`}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() =>
                    download(
                      "load-master-semantic-loss-closure.csv",
                      closureCsv(closure!),
                      "text/csv",
                    )
                  }
                >
                  <Download className="h-4 w-4" /> Closure CSV
                </Button>
                {unresolvedCells.length > 0 && (
                  <div className="space-y-2 rounded-md border border-destructive/40 p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">
                        Remaining unresolved cells — {unresolvedCells.length}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        onClick={() =>
                          download(
                            "load-master-unresolved-cells.csv",
                            unresolvedCellCsv(unresolvedCells),
                            "text/csv",
                          )
                        }
                      >
                        <Download className="h-4 w-4" /> Unresolved cells CSV
                      </Button>
                    </div>
                    <div className="max-h-80 overflow-auto">
                      <table className="w-full text-xs">
                        <thead className="text-left text-muted-foreground">
                          <tr>
                            <th className="p-1">#</th>
                            <th className="p-1">observed_header</th>
                            <th className="p-1">row</th>
                            <th className="p-1">stable_id</th>
                            <th className="p-1">raw_value</th>
                            <th className="p-1">surrounding_headers</th>
                            <th className="p-1">proposed owner disposition</th>
                          </tr>
                        </thead>
                        <tbody>
                          {unresolvedCells.map((c) => (
                            <tr
                              key={`${c.physical_column}-${c.row}`}
                              className="border-t border-border/60 align-top"
                            >
                              <td className="p-1 font-mono">{c.physical_column}</td>
                              <td className="p-1 font-mono">
                                {c.observed_header || "(blank)"}
                              </td>
                              <td className="p-1 font-mono">{c.row}</td>
                              <td className="p-1 font-mono">{c.stable_id}</td>
                              <td className="p-1 font-mono">{c.raw_value}</td>
                              <td className="p-1 font-mono">{c.surrounding_headers}</td>
                              <td className="p-1">{c.proposed_owner_disposition}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-left text-muted-foreground">
                      <tr>
                        <th className="p-1">#</th>
                        <th className="p-1">exact_header</th>
                        <th className="p-1">observed</th>
                        <th className="p-1">populated</th>
                        <th className="p-1">canonical_semantic</th>
                        <th className="p-1">authority</th>
                        <th className="p-1">current action</th>
                        <th className="p-1">preservation method</th>
                        <th className="p-1">schema?</th>
                        <th className="p-1">loss cells</th>
                        <th className="p-1">preserved at</th>
                      </tr>
                    </thead>
                    <tbody>
                      {closure!.rows.map((r) => (
                        <tr key={r.physical_column} className="border-t border-border/60 align-top">
                          <td className="p-1 font-mono">{r.physical_column}</td>
                          <td className="p-1 font-mono">{r.exact_header}</td>
                          <td className="p-1 font-mono">{r.observed_header || "(blank)"}</td>
                          <td className="p-1">{r.populated_cells}</td>
                          <td className="p-1 font-mono">{r.canonical_semantic}</td>
                          <td className="p-1">{r.authority}</td>
                          <td className="p-1">{r.current_import_action}</td>
                          <td className="p-1">
                            <Badge
                              variant={
                                r.preservation_method === "UNRESOLVED" ? "destructive" : "outline"
                              }
                            >
                              {r.preservation_method}
                            </Badge>
                            <p className="mt-1 text-muted-foreground">{r.note}</p>
                          </td>
                          <td className="p-1">{r.schema_required ? "YES" : "NO"}</td>
                          <td className="p-1">{r.semantic_loss_cells}</td>
                          <td className="p-1 font-mono">{r.preserved_at}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    Proposed schema extensions ({closure!.schema_proposals.length})
                  </p>
                  <table className="w-full text-xs">
                    <thead className="text-left text-muted-foreground">
                      <tr>
                        <th className="p-1">proposed column</th>
                        <th className="p-1">data type</th>
                        <th className="p-1">allowed states</th>
                        <th className="p-1">tri-state</th>
                        <th className="p-1">rationale</th>
                      </tr>
                    </thead>
                    <tbody>
                      {closure!.schema_proposals.map((p) => (
                        <tr key={p.column} className="border-t border-border/60 align-top">
                          <td className="p-1 font-mono">{p.column}</td>
                          <td className="p-1">{p.data_type}</td>
                          <td className="p-1">{p.allowed_states.join(" | ")}</td>
                          <td className="p-1">{p.tri_state ? "YES" : "NO"}</td>
                          <td className="p-1 max-w-[28rem] text-muted-foreground">{p.rationale}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </PersistedSection>

            <PersistedSection
              storageKey="import-contract-rules"
              title="Critical-load rule reconciliation (simulated vs canonical)"
            >
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="p-1">metric</th>
                      <th className="p-1">simulated import</th>
                      <th className="p-1">canonical ODS-derived</th>
                      <th className="p-1">agrees</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rule_deltas.map((d) => (
                      <tr key={d.metric} className="border-t border-border/60 align-top">
                        <td className="p-1 font-mono">{d.metric}</td>
                        <td className="p-1 font-mono">{d.simulated}</td>
                        <td className="p-1 font-mono">{d.canonical}</td>
                        <td className="p-1">
                          <Badge variant={d.matches ? "default" : "destructive"}>
                            {d.matches ? "YES" : "NO"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </PersistedSection>

            <PersistedSection storageKey="import-contract-extra" title="Columns outside the contract">
              {result.binding.extra_populated_columns.length ? (
                <ul className="space-y-1 text-xs">
                  {result.binding.extra_populated_columns.map((c) => (
                    <li key={c.physical_column} className="font-mono">
                      column {c.physical_column}: {c.observed_header || "(unnamed, populated)"} —
                      UNRESOLVED, outside the contract registry
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No populated physical column exists beyond the {CONTRACT_COLUMN_COUNT} contract
                  columns.
                </p>
              )}
            </PersistedSection>
          </>
        ) : null}
      </div>
    </ElectricalGate>
  );
}
