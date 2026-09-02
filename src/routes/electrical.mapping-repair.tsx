// Phase 4.4 — Load_Master deterministic mapping repair gate.
//
// Preview writes nothing. Apply requires explicit owner confirmation plus
// per-mapping approval, re-hashes and re-parses the canonical workbook, and
// re-verifies every row immediately before its single-column write. The
// canonical ODS is never modified here.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, ShieldAlert, ShieldCheck, Wrench } from "lucide-react";
import { toast } from "sonner";

import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { PersistedSection } from "@/components/electrical/persisted-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { CANONICAL_ODS_PATH } from "@/lib/electrical-sor";
import { setCanonicalWorkbookSession } from "@/lib/electrical-canonical-workbook-session";
import { useCanonicalWorkbookSession } from "@/hooks/use-canonical-workbook-session";
import {
  applyLoadMappingRepair,
  previewLoadMappingRepair,
  type MappingRepairResult,
} from "@/lib/electrical-mapping-repair.functions";
import {
  repairKey,
  repairProposalsCsv,
  type RepairProposal,
  type RuleEffect,
} from "@/lib/electrical-mapping-repair-gate";

export const Route = createFileRoute("/electrical/mapping-repair")({
  component: MappingRepairPage,
  head: () => ({
    meta: [
      { title: "Load_Master Mapping Repair Gate — Bostead Farms" },
      {
        name: "description",
        content:
          "Preview and apply only deterministic Load_Master column mapping corrections, with per-field approval, pre-write re-verification and business-rule reconciliation against the canonical workbook.",
      },
      { property: "og:title", content: "Load_Master Mapping Repair Gate — Bostead Farms" },
      {
        property: "og:description",
        content:
          "SHA-bound repair gate for proven shifted-column and wrong-destination Load_Master mappings; schema gaps are reported, never forced into another field.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  return btoa(binary);
}

function download(name: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  would_change: "default",
  applied: "default",
  already_correct: "secondary",
  drifted: "destructive",
  newer_evidence: "destructive",
  schema_missing: "outline",
  not_approved: "outline",
  baseline_blocked: "destructive",
  failed: "destructive",
};

function EffectColumn({ title, e }: { title: string; e: RuleEffect }) {
  return (
    <div className="space-y-1 rounded-md border border-border p-2 text-sm">
      <p className="font-medium">{title}</p>
      <p>Critical physical rows: {e.criticalPhysicalRows}</p>
      <p>Critical logical circuits: {e.criticalLogicalCircuits}</p>
      <p>Logical circuits: {e.totalLogicalCircuits}</p>
      <p>Unresolved shared circuits: {e.unresolvedSharedCircuits}</p>
      <p className="text-muted-foreground">
        REQUIRED {e.circuitsByTier.REQUIRED} · OPTIONAL-1 {e.circuitsByTier["OPTIONAL-1"]} ·
        OPTIONAL-2 {e.circuitsByTier["OPTIONAL-2"]} · EXCLUDE {e.circuitsByTier.EXCLUDE} · REVIEW{" "}
        {e.circuitsByTier.REVIEW}
      </p>
      <div className="text-xs text-muted-foreground">
        {e.plannedCircuitsByPanel.length ? (
          e.plannedCircuitsByPanel.map((p) => (
            <div key={p.panel}>
              {p.panel}: {p.circuits} circuit(s)
            </div>
          ))
        ) : (
          <div>No planned circuits by Suggested Panel.</div>
        )}
      </div>
    </div>
  );
}

function MappingRepairPage() {
  const preview = useServerFn(previewLoadMappingRepair);
  const apply = useServerFn(applyLoadMappingRepair);
  const input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<{ file_name: string; base64: string } | null>(null);
  const [result, setResult] = useState<MappingRepairResult | null>(null);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState(false);
  const [filter, setFilter] = useState("");
  const { availability } = useCanonicalWorkbookSession();

  const previewMutation = useMutation({
    mutationFn: async (src: { file_name: string; base64: string }) =>
      (await preview({ data: src })) as unknown as MappingRepairResult,
    onSuccess: (r, src) => {
      setResult(r);
      setSource(src);
      setApproved(new Set());
      setConfirmed(false);
      setCanonicalWorkbookSession({
        file_name: r.baseline.ods_file_name,
        base64: src.base64,
        sha256: r.baseline.ods_sha256,
        parsed_at: r.generated_at,
        established_by: "load_adjudication",
      });
      toast.success(`${r.summary.would_change} deterministic mapping correction(s) proposed.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!source) throw new Error("Attach the canonical workbook first.");
      return (await apply({
        data: { ...source, approved: [...approved] },
      })) as unknown as MappingRepairResult;
    },
    onSuccess: (r) => {
      setResult(r);
      setConfirmed(false);
      toast.success(`${r.summary.applied} mapping correction(s) applied.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pending = useMemo(
    () => (result?.proposals ?? []).filter((p) => p.status === "would_change"),
    [result],
  );

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return result?.proposals ?? [];
    return (result?.proposals ?? []).filter((p) =>
      `${p.stable_id} ${p.semantic_field} ${p.destination} ${p.ods_header} ${p.status}`
        .toLowerCase()
        .includes(needle),
    );
  }, [result, filter]);

  const toggle = (p: RepairProposal) => {
    const key = repairKey(p);
    setApproved((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const busy = previewMutation.isPending || applyMutation.isPending;

  return (
    <ElectricalGate>
      <div className="space-y-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wrench className="h-4 w-4" /> Load_Master deterministic mapping repair gate
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Only mappings the SHA-bound audit proves deterministic —
              <span className="font-mono"> SHIFTED_COLUMN_MAPPING</span> and
              <span className="font-mono"> WRONG_DESTINATION_FIELD</span> at HIGH confidence — can be
              written. Field meaning comes from the physical column in{" "}
              <span className="font-mono">{CANONICAL_ODS_PATH}</span> plus its exact header, never
              from what FarmOps currently holds. The canonical workbook is re-hashed and re-parsed
              before the preview and before every single write, and it is never edited here.
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
                  previewMutation.mutate({ file_name: file.name, base64: await fileToBase64(file) });
                }}
              />
              <Button size="sm" onClick={() => input.current?.click()} disabled={busy}>
                {previewMutation.isPending ? "Previewing…" : "Select canonical .ods"}
              </Button>
              {availability.state === "available" && !result ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    previewMutation.mutate({
                      file_name: availability.meta.file_name,
                      base64: availability.base64,
                    })
                  }
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
                  <Badge variant={result.baseline.authorized ? "default" : "destructive"}>
                    {result.baseline.authorized ? (
                      <ShieldCheck className="mr-1 h-3 w-3" />
                    ) : (
                      <ShieldAlert className="mr-1 h-3 w-3" />
                    )}
                    {result.baseline.authorized
                      ? "Authorized canonical baseline SHA"
                      : "Baseline blocked — not the authorized SHA"}
                  </Badge>
                  <span className="break-all font-mono text-xs text-muted-foreground">
                    {result.baseline.ods_sha256}
                  </span>
                </div>
                <p className="text-muted-foreground">
                  {result.audit.sheet} · header row {result.audit.header_row} ·{" "}
                  {result.audit.ods_row_count} workbook row(s) · {result.audit.farmops_row_count}{" "}
                  FarmOps row(s) · {result.summary.proposals} proposal(s) ·{" "}
                  {result.summary.would_change} would change · {result.summary.applied} applied ·{" "}
                  {result.summary.drifted} drifted · {result.summary.newer_evidence} newer evidence ·{" "}
                  {result.summary.schema_extensions_required} schema extension(s) required
                </p>

                <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/40 p-2">
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={confirmed}
                      onCheckedChange={(v) => setConfirmed(Boolean(v))}
                    />
                    <span>
                      I am the owner and I authorize writing the {approved.size} approved mapping
                      correction(s).
                    </span>
                  </label>
                  <Button
                    size="sm"
                    disabled={
                      busy || !confirmed || approved.size === 0 || !result.baseline.authorized
                    }
                    onClick={() => applyMutation.mutate()}
                  >
                    {applyMutation.isPending ? "Applying…" : "Apply approved corrections"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !pending.length}
                    onClick={() => setApproved(new Set(pending.map(repairKey)))}
                  >
                    Approve all {pending.length} deterministic
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() =>
                      download("load-mapping-repair.csv", repairProposalsCsv(result.proposals))
                    }
                  >
                    <Download className="h-4 w-4" /> Proposals CSV
                  </Button>
                </div>
                <Input
                  placeholder="Filter by load ID, field, destination or status…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>

        {result ? (
          <>
            <PersistedSection
              storageKey="mapping-repair-rules"
              title="Business-rule effect — before / after / canonical ODS"
              defaultOpen
            >
              <div className="space-y-2 p-2">
                <div className="grid gap-2 md:grid-cols-3">
                  <EffectColumn title="Before repair (live FarmOps)" e={result.rules.before} />
                  <EffectColumn title="After approved repair" e={result.rules.after} />
                  <EffectColumn title="Canonical ODS-derived" e={result.rules.canonical} />
                </div>
                <p
                  className={
                    result.rules.reconciles
                      ? "rounded-md border border-border bg-muted/40 p-2 text-sm"
                      : "rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm font-medium"
                  }
                >
                  {result.rules.reconciles
                    ? "Post-repair business-rule output reconciles to the canonical ODS-derived view."
                    : `Post-repair output does NOT yet reconcile to the canonical view: ${result.rules.differences.join("; ")}`}
                </p>
              </div>
            </PersistedSection>

            <PersistedSection
              storageKey="mapping-repair-critical"
              title="Critical-load field mappings (explicit verification)"
              defaultOpen
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="p-2">Canonical field</th>
                      <th className="p-2">Col</th>
                      <th className="p-2">ODS header</th>
                      <th className="p-2">Destination</th>
                      <th className="p-2">Audit status</th>
                      <th className="p-2">Repairable</th>
                      <th className="p-2">Proposals</th>
                      <th className="p-2">Finding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.critical_fields.map((f) => (
                      <tr key={f.semantic_field} className="border-t border-border align-top">
                        <td className="p-2 font-mono text-xs">{f.semantic_field}</td>
                        <td className="p-2">{f.ods_physical_column ?? "—"}</td>
                        <td className="p-2">{f.ods_header || "—"}</td>
                        <td className="p-2 font-mono text-xs">{f.destination ?? "—"}</td>
                        <td className="p-2">
                          <Badge variant={f.eligible ? "default" : "outline"}>{f.audit_status}</Badge>
                        </td>
                        <td className="p-2">{f.eligible ? "Yes" : "No"}</td>
                        <td className="p-2">{f.proposals}</td>
                        <td className="p-2 text-xs text-muted-foreground">{f.finding}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </PersistedSection>

            <PersistedSection
              storageKey="mapping-repair-proposals"
              title={`Proposed writes (${rows.length}) — one column per row`}
              defaultOpen
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="p-2">Approve</th>
                      <th className="p-2">Stable ID</th>
                      <th className="p-2">Col</th>
                      <th className="p-2">ODS header</th>
                      <th className="p-2">Semantic field</th>
                      <th className="p-2">Destination</th>
                      <th className="p-2">Canonical raw</th>
                      <th className="p-2">Current FarmOps</th>
                      <th className="p-2">Proposed</th>
                      <th className="p-2">Defect</th>
                      <th className="p-2">Confidence</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr
                        key={`${p.stable_id}-${p.destination}-${p.ods_physical_column}`}
                        className="border-t border-border align-top"
                      >
                        <td className="p-2">
                          <Checkbox
                            checked={approved.has(repairKey(p))}
                            disabled={p.status !== "would_change"}
                            onCheckedChange={() => toggle(p)}
                          />
                        </td>
                        <td className="p-2 font-mono text-xs">{p.stable_id}</td>
                        <td className="p-2">{p.ods_physical_column}</td>
                        <td className="p-2 text-xs">{p.ods_header}</td>
                        <td className="p-2 font-mono text-xs">{p.semantic_field}</td>
                        <td className="p-2 font-mono text-xs">{p.destination}</td>
                        <td className="p-2">{p.canonical_raw || "(blank)"}</td>
                        <td className="p-2">{p.current_farmops_value || "(blank)"}</td>
                        <td className="p-2">
                          {p.proposed_value === null ? "(clear to blank)" : String(p.proposed_value)}
                        </td>
                        <td className="p-2 text-xs">{p.defect}</td>
                        <td className="p-2 text-xs">{p.confidence}</td>
                        <td className="p-2">
                          <Badge variant={STATUS_VARIANT[p.status] ?? "outline"}>{p.status}</Badge>
                        </td>
                        <td className="p-2 text-xs text-muted-foreground">{p.detail ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </PersistedSection>

            <PersistedSection
              storageKey="mapping-repair-schema"
              title={`Schema gaps (${result.schema_gaps.length}) — SCHEMA_EXTENSION_REQUIRED, never repaired`}
            >
              <div className="space-y-1 p-2 text-sm">
                {result.schema_gaps.length ? (
                  result.schema_gaps.map((g) => (
                    <p key={g.semantic_field}>
                      <span className="font-mono text-xs">{g.semantic_field}</span> — {g.finding}
                    </p>
                  ))
                ) : (
                  <p className="text-muted-foreground">
                    No canonical Load_Master field is missing a FarmOps destination.
                  </p>
                )}
              </div>
            </PersistedSection>

            <PersistedSection
              storageKey="mapping-repair-acceptance"
              title="Post-apply acceptance re-runs"
            >
              <div className="flex flex-wrap gap-2 p-2 text-sm">
                <Link to="/electrical/mapping-audit" className="underline">
                  Load_Master mapping audit
                </Link>
                <Link to="/electrical/critical-loads" className="underline">
                  Critical-load business-rule view
                </Link>
                <Link to="/electrical/panel-diagram" className="underline">
                  Panel topology view
                </Link>
                <Link to="/electrical/validation" className="underline">
                  Phase 4.4 parallel validation / convergence
                </Link>
              </div>
            </PersistedSection>
          </>
        ) : null}
      </div>
    </ElectricalGate>
  );
}
