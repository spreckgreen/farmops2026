// Load_Master field-mapping audit — PREVIEW ONLY.
//
// Proves whether the live FarmOps load values are a deterministic import-column
// mapping defect. Field identity comes from the canonical workbook's physical
// column position + exact header text; FarmOps contents are never used to infer
// meaning. This route has no apply path.
import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, FileSearch, ShieldCheck, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { PersistedSection } from "@/components/electrical/persisted-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CANONICAL_ODS_PATH } from "@/lib/electrical-sor";
import { setCanonicalWorkbookSession } from "@/lib/electrical-canonical-workbook-session";
import { useCanonicalWorkbookSession } from "@/hooks/use-canonical-workbook-session";
import {
  auditLoadMasterFieldMapping,
  type LoadMappingAuditPayload,
} from "@/lib/electrical-load-mapping-audit.functions";
import {
  mappingAuditColumnsCsv,
  mappingAuditPreviewCsv,
  type MappingStatus,
} from "@/lib/electrical-load-mapping-audit";

const STATUS_VARIANT: Record<MappingStatus, "default" | "secondary" | "outline" | "destructive"> = {
  EXACT_MAPPING: "default",
  NORMALIZATION_ONLY: "secondary",
  SHIFTED_COLUMN_MAPPING: "destructive",
  WRONG_DESTINATION_FIELD: "destructive",
  DUPLICATE_HEADER_AMBIGUITY: "outline",
  UNMAPPED_CANONICAL_FIELD: "outline",
  REQUIRES_REVIEW: "outline",
};

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
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

export function MappingAuditPanel() {
  const run = useServerFn(auditLoadMasterFieldMapping);
  const input = useRef<HTMLInputElement>(null);
  const [audit, setAudit] = useState<LoadMappingAuditPayload | null>(null);
  const [filter, setFilter] = useState("");
  const [onlyStatus, setOnlyStatus] = useState<MappingStatus | "">("");
  const { availability } = useCanonicalWorkbookSession();

  const mutation = useMutation({
    mutationFn: async (src: { file_name: string; base64: string }) =>
      (await run({ data: src })) as unknown as LoadMappingAuditPayload,
    onSuccess: (a, src) => {
      setAudit(a);
      setCanonicalWorkbookSession({
        file_name: a.file_name,
        base64: src.base64,
        sha256: a.ods_sha256,
        parsed_at: a.generated_at,
        established_by: "load_adjudication",
      });
      toast.success(`Audited ${a.columns.length} physical column(s) of ${a.sheet}.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns = useMemo(() => {
    if (!audit) return [];
    const needle = filter.trim().toLowerCase();
    return audit.columns.filter(
      (c) =>
        (!onlyStatus || c.status === onlyStatus) &&
        (!needle ||
          `${c.ods_header} ${c.semantic_field ?? ""} ${c.farmops_destination ?? ""} ${c.expected_destination ?? ""}`
            .toLowerCase()
            .includes(needle)),
    );
  }, [audit, filter, onlyStatus]);

  const preview = useMemo(() => {
    if (!audit) return [];
    const needle = filter.trim().toLowerCase();
    return audit.preview.filter(
      (r) =>
        (!onlyStatus || r.mapping_defect === onlyStatus) &&
        (!needle || `${r.stable_id} ${r.field}`.toLowerCase().includes(needle)),
    );
  }, [audit, filter, onlyStatus]);

  return (
    <>
      <div className="space-y-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSearch className="h-4 w-4" /> Load_Master field-mapping audit (preview only)
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Field identity comes from the canonical workbook{" "}
              <span className="font-mono">{CANONICAL_ODS_PATH}</span> — physical column position plus
              exact header text, never header text alone and never FarmOps contents. The workbook is
              parsed and hashed in memory only. Nothing on this page writes to any record.
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
                {mutation.isPending ? "Auditing…" : "Select canonical .ods"}
              </Button>
              {availability.state === "available" && !audit ? (
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
              {availability.state === "reattach_required" && !audit ? (
                <span className="text-xs text-muted-foreground">
                  {availability.meta.file_name} was validated this session, but its bytes are not
                  retained across a reload — reattach the same file.
                </span>
              ) : null}
            </div>

            {audit ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={audit.is_phase_44a_baseline ? "default" : "outline"}>
                    {audit.is_phase_44a_baseline ? (
                      <ShieldCheck className="mr-1 h-3 w-3" />
                    ) : (
                      <ShieldAlert className="mr-1 h-3 w-3" />
                    )}
                    {audit.is_phase_44a_baseline
                      ? "Authorized Phase 4.4a baseline SHA"
                      : "Not the authorized baseline SHA"}
                  </Badge>
                  <span className="break-all font-mono text-xs text-muted-foreground">
                    {audit.ods_sha256}
                  </span>
                </div>
                <p className="text-muted-foreground">
                  {audit.sheet} · header row {audit.header_row} · {audit.ods_row_count} workbook
                  row(s) · {audit.farmops_row_count} FarmOps row(s) · {audit.preview.length} row-level
                  preview item(s)
                </p>
                <p
                  className={
                    audit.deterministic_shift_detected
                      ? "rounded-md border border-destructive/40 bg-destructive/10 p-2 font-medium"
                      : "rounded-md border border-border bg-muted/40 p-2"
                  }
                >
                  {audit.deterministic_shift_detected
                    ? "Verdict: a deterministic import-column mapping defect is proven — at least one FarmOps destination is fed by the wrong physical column or by the wrong canonical field."
                    : "Verdict: no column shift or wrong-destination binding was proven from this workbook. Remaining items are reported as REQUIRES_REVIEW / UNMAPPED and need human disposition."}
                </p>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(audit.counts) as MappingStatus[]).map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={onlyStatus === s ? "default" : "outline"}
                      onClick={() => setOnlyStatus(onlyStatus === s ? "" : s)}
                    >
                      {s} · {audit.counts[s]}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() =>
                      download(
                        "load-master-mapping-audit.csv",
                        mappingAuditColumnsCsv(audit),
                        "text/csv",
                      )
                    }
                  >
                    <Download className="h-4 w-4" /> Columns CSV
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() =>
                      download(
                        "load-master-mapping-preview.csv",
                        mappingAuditPreviewCsv(audit),
                        "text/csv",
                      )
                    }
                  >
                    <Download className="h-4 w-4" /> Row preview CSV
                  </Button>
                </div>
                <Input
                  placeholder="Filter by header, semantic field, destination or load ID…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>

        {audit ? (
          <>
            <PersistedSection storageKey="mapping-audit-required" title="Required field verdicts" defaultOpen>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="p-2">Canonical field</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Finding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.required_verdicts.map((v) => (
                      <tr key={v.semantic_field} className="border-t border-border">
                        <td className="p-2 font-mono text-xs">{v.semantic_field}</td>
                        <td className="p-2">
                          <Badge variant={STATUS_VARIANT[v.status]}>{v.status}</Badge>
                        </td>
                        <td className="p-2 text-muted-foreground">{v.finding}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </PersistedSection>

            <PersistedSection
              storageKey="mapping-audit-columns"
              title={`Physical column mapping (${columns.length})`}
              defaultOpen
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="p-2">Col</th>
                      <th className="p-2">ODS header</th>
                      <th className="p-2">Semantic field</th>
                      <th className="p-2">FarmOps destination</th>
                      <th className="p-2">Expected</th>
                      <th className="p-2">Sample ODS</th>
                      <th className="p-2">Sample FarmOps</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Confidence</th>
                      <th className="p-2">Finding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {columns.map((c) => (
                      <tr key={c.physical_column} className="border-t border-border align-top">
                        <td className="p-2">{c.physical_column}</td>
                        <td className="p-2">{c.ods_header || <em>(unnamed)</em>}</td>
                        <td className="p-2 font-mono text-xs">{c.semantic_field ?? "—"}</td>
                        <td className="p-2 font-mono text-xs">{c.farmops_destination ?? "—"}</td>
                        <td className="p-2 font-mono text-xs">{c.expected_destination ?? "—"}</td>
                        <td className="p-2 text-xs">{c.sample_ods_values.join(" | ") || "—"}</td>
                        <td className="p-2 text-xs">{c.sample_farmops_values.join(" | ") || "—"}</td>
                        <td className="p-2">
                          <Badge variant={STATUS_VARIANT[c.status]}>{c.status}</Badge>
                        </td>
                        <td className="p-2 text-xs">{c.confidence}</td>
                        <td className="p-2 text-xs text-muted-foreground">{c.finding}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </PersistedSection>

            <PersistedSection
              storageKey="mapping-audit-preview"
              title={`Row-level correction preview (${preview.length}) — nothing is written`}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="p-2">Stable ID</th>
                      <th className="p-2">Field</th>
                      <th className="p-2">Canonical value</th>
                      <th className="p-2">Current FarmOps</th>
                      <th className="p-2">Proposed</th>
                      <th className="p-2">Mapping defect</th>
                      <th className="p-2">Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r, i) => (
                      <tr key={`${r.stable_id}-${r.field}-${i}`} className="border-t border-border">
                        <td className="p-2 font-mono text-xs">{r.stable_id}</td>
                        <td className="p-2 font-mono text-xs">{r.field}</td>
                        <td className="p-2">{r.canonical_value}</td>
                        <td className="p-2">{r.current_farmops_value}</td>
                        <td className="p-2">{r.proposed_farmops_value}</td>
                        <td className="p-2">
                          <Badge variant={STATUS_VARIANT[r.mapping_defect]}>{r.mapping_defect}</Badge>
                        </td>
                        <td className="p-2 text-xs">{r.confidence}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </PersistedSection>

            <PersistedSection
              storageKey="mapping-audit-structure"
              title="Duplicate headers and unnamed populated columns"
            >
              <div className="space-y-1 p-2 text-sm text-muted-foreground">
                <p>
                  Duplicate header text:{" "}
                  {audit.duplicate_headers.length ? audit.duplicate_headers.join(", ") : "none"}
                </p>
                <p>
                  Unnamed but populated physical columns:{" "}
                  {audit.unnamed_populated_columns.length
                    ? audit.unnamed_populated_columns.join(", ")
                    : "none"}
                </p>
              </div>
            </PersistedSection>
          </>
        ) : null}
      </div>
    </>
  );
}
