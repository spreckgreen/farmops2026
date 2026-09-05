// FARMOPS-ELEC-AUDIT-BATCH-V1 — bulk field-audit import, preview and apply UI.
//
// Nothing on this screen writes an electrical record until the owner ticks the
// individual items, types an approval statement and a reason, and confirms.
// Holds, conflicts, ODS candidates, temporary-unresolved and no-change rows can
// never be selected.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Download, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  FS_NW_AUDITED_BREAKERS,
  FS_NW_AUDIT_R1_BATCH_ID,
  FS_NW_AUDIT_R2_BATCH_ID,
  FS_NW_LINKS_BATCH_ID,
  FS_NW_R1_REJECTION_REASON,
  fsNwAuditManifestR2Text,
} from "@/lib/electrical-fs-nw-audit-r1";
import { resolveFsNwAuditedLoadLinks } from "@/lib/electrical-fs-nw-links.functions";
import { FS_NW_AUDIT_R3_BATCH_ID } from "@/lib/electrical-fs-nw-audit-r3";
import {
  FS_SWITCH_CONTROLS_BATCH_ID,
  fsSwitchControlsManifestText,
} from "@/lib/electrical-audit-switch-controls";
import { resolveFsNwAsBuiltReconciliation } from "@/lib/electrical-fs-nw-r3.functions";
import { resolveOutletMetadataR3 } from "@/lib/electrical-outlet-metadata-r3.functions";
import {
  R3_OUTLET_METADATA_BATCH_ID,
  outletCandidateCsv,
  type OutletCandidateReport,
} from "@/lib/electrical-outlet-metadata-r3";

import {
  buildPeerRegistration,
  generatePeerToken,
  maskPeerToken,
  type PeerRegistration,
} from "@/lib/electrical-peer-token";


import { PeerSyncPanel } from "@/components/electrical/peer-sync-panel";
import { PeerSyncSecretPanel } from "@/components/electrical/peer-sync-secret-panel";
import { PersistedSection } from "@/components/electrical/persisted-section";
import { RevisionDiffPanel } from "@/components/electrical/revision-diff-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { usePeerTokenState } from "@/components/electrical/use-peer-token-state";
import { Textarea } from "@/components/ui/textarea";
import {
  AUDIT_DISPOSITIONS,
  classifiedBreakerRelationship,
  holdCsv,
  isPendingRef,
  pendingRefItemKey,
  odsCandidateCsv,
  previewCsv,
  selectable,
  type AuditDisposition,
  type ClassifiedItem,
} from "@/lib/electrical-audit-batch";
import {
  applyElectricalAuditBatch,
  compensatingAuditBatchManifest,
  importElectricalAuditBatch,
  pullPeerAuditBatch,
  listElectricalAuditBatches,
  previewElectricalAuditBatch,
  rejectElectricalAuditBatch,

  setElectricalAuditItemApproval,
  type AuditBatchPreview,
} from "@/lib/electrical-audit-batch.functions";

const DISPOSITION_VARIANT: Record<
  AuditDisposition,
  "default" | "secondary" | "destructive" | "outline"
> = {
  ready: "default",
  no_change: "secondary",
  hold: "destructive",
  conflict: "destructive",
  ods_candidate: "outline",
  applied: "default",
  failed: "destructive",
};

function download(name: string, body: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function ItemRow({
  item,
  approved,
  onToggle,
}: {
  item: ClassifiedItem;
  approved: boolean;
  onToggle: () => void;
}) {
  const can = selectable(item.disposition);
  return (
    <div className="border-b border-border py-2 text-sm last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <Checkbox checked={approved} disabled={!can} onCheckedChange={onToggle} aria-label={`Approve ${item.item_key}`} />
        <span className="font-mono text-xs">{item.target_stable_id ?? item.item_key}</span>
        <Badge variant="outline">{item.entity_kind}</Badge>
        <Badge variant="secondary">{item.observation_class}</Badge>
        <Badge variant={DISPOSITION_VARIANT[item.disposition]}>{item.disposition}</Badge>
        <span className="text-xs text-muted-foreground">{item.operation}</span>
        {item.pole_token ? (
          <span className="text-xs text-muted-foreground">pole {item.pole_token}</span>
        ) : null}
        {classifiedBreakerRelationship(item) ? (
          <span className="font-mono text-xs text-muted-foreground">
            {classifiedBreakerRelationship(item)}
          </span>
        ) : null}
      </div>
      {item.changes.length ? (
        <ul className="mt-1 ml-6 space-y-0.5 text-xs text-muted-foreground">
          {item.changes.map((c) => (
            <li key={c.column}>
              <span className="font-mono">{c.column}</span>: {c.before ?? "—"} →{" "}
              {c.after == null
                ? "—"
                : isPendingRef(c.after)
                  ? `new record from ${pendingRefItemKey(c.after)} (linked at apply)`
                  : c.after}
            </li>
          ))}
        </ul>
      ) : null}

      {item.messages.length ? (
        <ul className="mt-1 ml-6 space-y-0.5 text-xs">
          {item.messages.map((m, idx) => (
            <li
              key={idx}
              className={m.level === "error" ? "text-destructive" : "text-muted-foreground"}
            >
              {m.text}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-1 ml-6 text-xs text-muted-foreground">Evidence: {item.evidence}</p>
    </div>
  );
}

export function AuditBatchPanel() {
  const runImport = useServerFn(importElectricalAuditBatch);
  const runPreview = useServerFn(previewElectricalAuditBatch);
  const runApprove = useServerFn(setElectricalAuditItemApproval);
  const runApply = useServerFn(applyElectricalAuditBatch);
  const runCompensate = useServerFn(compensatingAuditBatchManifest);
  const list = useServerFn(listElectricalAuditBatches);
  const runPeerPull = useServerFn(pullPeerAuditBatch);
  const resolveLinks = useServerFn(resolveFsNwAuditedLoadLinks);
  const resolveReconciliation = useServerFn(resolveFsNwAsBuiltReconciliation);
  const resolveOutletMetadata = useServerFn(resolveOutletMetadataR3);
  const runReject = useServerFn(rejectElectricalAuditBatch);


  const [manifestText, setManifestText] = useState("");
  const [payload, setPayload] = useState<AuditBatchPreview | null>(null);
  const [peerUrl, setPeerUrl] = useState("");
  const [peerBatchId, setPeerBatchId] = useState("");
  const { peerToken, setPeerToken, generatedPeerToken, setGeneratedPeerToken, clearPeerToken } =
    usePeerTokenState();

  const [peerNote, setPeerNote] = useState<string | null>(null);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<AuditDisposition | "all">("all");
  const [statement, setStatement] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const batches = useQuery({
    queryKey: ["electrical-audit-batches"],
    queryFn: async () => await list({}),
  });

  const adopt = (data: AuditBatchPreview) => {
    setPayload(data);
    setApproved(new Set(data.approved));
    setError(null);
  };

  const importMutation = useMutation({
    mutationFn: async () => await runImport({ data: { manifest: manifestText } }),
    onSuccess: (data) => {
      adopt(data as AuditBatchPreview);
      batches.refetch();
    },
    onError: (e) => setError(String(e)),
  });

  // Build the follow-up links batch from the approved circuit groups. Read
  // only: it fills the import box, and every item still needs approval.
  const linkBuildMutation = useMutation({
    mutationFn: async () => await resolveLinks({}),
    onSuccess: (r) => {
      setManifestText(r.manifest_text);
      setError(null);
      if (!r.resolvedGroups.length) {
        toast.error(
          `No approved circuit group found for the audited PNL-FS-NW breakers yet. Approve and apply ${FS_NW_AUDIT_R1_BATCH_ID} first; the held items explain each gap.`,
        );
        return;
      }
      const parts = [
        `${r.linkCount} load link(s) using ${r.resolvedGroups.length} approved CG-FS-### group(s)`,
      ];
      if (r.skippedAlreadyLinked.length) parts.push(`${r.skippedAlreadyLinked.length} already linked`);
      if (r.loadsNotFound.length) parts.push(`${r.loadsNotFound.length} load(s) not found (held)`);
      if (r.groupsNotApproved.length)
        parts.push(`${r.groupsNotApproved.length} breaker(s) without an approved group (held)`);
      toast.success(`${FS_NW_LINKS_BATCH_ID} built — ${parts.join(", ")}. Import to preview; nothing is written yet.`);
    },
    onError: (e) => setError(String(e)),
  });

  // Build the R3 as-built metadata reconciliation for the loads whose
  // relationship-only links were applied in R2. R2 itself is left untouched.
  const reconcileBuildMutation = useMutation({
    mutationFn: async () => await resolveReconciliation({}),
    onSuccess: (r) => {
      setManifestText(r.manifest_text);
      setError(null);
      if (!r.reconciled.length) {
        toast.error(
          `No approved circuit group and load pair could be reconciled yet. The held items in ${FS_NW_AUDIT_R3_BATCH_ID} explain each gap.`,
        );
        return;
      }
      const parts = [
        `${r.reconciled.length} load(s) staged with relationship, installed state, ${r.sharedCircuitLoads.length} shared / ${r.dedicatedCircuitLoads.length} dedicated classification`,
        r.building_from_panel
          ? `building "${r.building_from_panel}" from the panel chain`
          : "building context unresolved (left as a gap)",
      ];
      if (r.loadsNotFound.length) parts.push(`${r.loadsNotFound.length} load(s) not found (held)`);
      if (r.groupsNotApproved.length)
        parts.push(`${r.groupsNotApproved.length} breaker(s) without an approved group (held)`);
      if (r.gapCount) parts.push(`${r.gapCount} explicit gap note(s)`);
      toast.success(
        `${FS_NW_AUDIT_R3_BATCH_ID} built — ${parts.join(", ")}. Import to preview every affected field; nothing is written yet.`,
      );
    },
    onError: (e) => setError(String(e)),
  });

  // Build the preview-only receptacle-outlet metadata correction. Read only:
  // it fills the import box with exact before/after values and reports the nine
  // unaudited candidate records without staging anything for them.
  const [outletCandidates, setOutletCandidates] = useState<OutletCandidateReport[] | null>(null);
  const outletBuildMutation = useMutation({
    mutationFn: async () => await resolveOutletMetadata({}),
    onSuccess: (r) => {
      setManifestText(r.manifest_text);
      setOutletCandidates(r.candidates);
      setError(null);
      const parts = [`${r.itemCount} metadata-only item(s)`];
      if (r.alreadyCorrect.length) parts.push(`${r.alreadyCorrect.length} already corrected`);
      if (r.loadsNotFound.length) parts.push(`${r.loadsNotFound.length} load(s) not found (held)`);
      toast.success(
        `${r.batch_id} built — ${parts.join(", ")}. Circuit groups, breakers and 20 A ratings are untouched; import to preview, nothing is written yet.`,
      );
    },
    onError: (e) => setError(String(e)),
  });

  const peerPullMutation = useMutation({
    mutationFn: async () =>
      await runPeerPull({
        data: {
          peer_base_url: peerUrl.trim(),
          batch_id: peerBatchId.trim(),
          peer_token: peerToken.trim(),
        },
      }),
    onSuccess: (result) => {
      if (!result.preview) {
        setPeerNote(null);
        setError(result.error ?? "The peer instance refused the pull. Nothing was staged.");
        return;
      }
      adopt(result.preview as AuditBatchPreview);
      clearPeerToken();
      setPeerNote(
        `Staged ${result.peer.batch_id} from ${result.peer.base_url} (there: ${result.peer.status ?? "unknown"}${
          result.peer.applied_at ? `, applied ${result.peer.applied_at}` : ""
        }). Checksum ${result.checksum.matches ? "matched" : "unverified"}. Nothing has been written here yet.`,
      );
      batches.refetch();
    },
    onError: (e) => setError(String(e)),
  });

  const previewMutation = useMutation({
    mutationFn: async (batchId: string) => await runPreview({ data: { batch_id: batchId } }),
    onSuccess: (data) => adopt(data as AuditBatchPreview),
    onError: (e) => setError(String(e)),
  });

  const applyMutation = useMutation({
    mutationFn: async () =>
      await runApply({
        data: {
          batch_id: payload!.batch.batch_id,
          statement,
          reason,
          confirm: true as const,
        },
      }),
    onSuccess: (data) => {
      adopt(data as AuditBatchPreview);
      setConfirmed(false);
      batches.refetch();
    },
    onError: (e) => setError(String(e)),
  });

  const rejectMutation = useMutation({
    mutationFn: async (input: { batch_id: string; reason: string }) =>
      await runReject({ data: input }),
    onSuccess: (r: { batch_id: string; already: boolean }) => {
      setError(null);
      toast.success(
        r.already
          ? `${r.batch_id} was already rejected. Its stored manifest and fingerprint are unchanged.`
          : `${r.batch_id} marked rejected. The stored manifest and its fingerprint are unchanged.`,
      );
      batches.refetch();
      if (payload?.batch.batch_id === r.batch_id) previewMutation.mutate(r.batch_id);
    },
    onError: (e) => setError(String(e)),
  });

  const items = payload?.items ?? [];
  const shown = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.disposition === filter)),
    [items, filter],
  );
  const readyKeys = useMemo(
    () => items.filter((i) => selectable(i.disposition)).map((i) => i.item_key),
    [items],
  );

  // A built-in batch that already carries its own load-link items must never be
  // followed by the links-only builder: that would stage a duplicate -LINKS batch
  // for the same relationships.
  const manifestAlreadyHasLoadLinks = useMemo(() => {
    const hasLinks = (arr: unknown) =>
      Array.isArray(arr) &&
      arr.some(
        (i) =>
          i && typeof i === "object" &&
          (i as Record<string, unknown>)["operation"] === "LINK" &&
          (i as Record<string, unknown>)["entity_kind"] === "load",
      );
    const text = manifestText.trim();
    if (text.startsWith("{")) {
      try {
        const parsed = JSON.parse(text) as { items?: unknown };
        if (hasLinks(parsed.items)) return true;
      } catch {
        /* incomplete paste — fall through to the staged preview */
      }
    }
    return items.some((i) => i.operation === "LINK" && i.entity_kind === "load");
  }, [manifestText, items]);


  const persistApproval = async (keys: string[], value: boolean) => {
    if (!payload || !keys.length) return;
    try {
      await runApprove({
        data: { batch_id: payload.batch.batch_id, item_keys: keys, approved: value },
      });
    } catch (e) {
      setError(String(e));
    }
  };

  const toggle = (key: string) => {
    const next = new Set(approved);
    const value = !next.has(key);
    if (value) next.add(key);
    else next.delete(key);
    setApproved(next);
    void persistApproval([key], value);
  };

  const selectAllReady = () => {
    setApproved(new Set(readyKeys));
    void persistApproval(readyKeys, true);
  };

  return (
    <div className="space-y-3">
      {error ? (
        <Card className="border-destructive">
          <CardContent className="flex items-start gap-2 py-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-words">{error}</span>
          </CardContent>
        </Card>
      ) : null}

      <PersistedSection
        storageKey="electrical.audit-batches.import"
        title="Import an audit manifest"
        defaultOpen
        badges={<Badge variant="outline">farmops.electrical.audit-batch.v1</Badge>}
      >
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Import parses and validates the manifest, resolves every reference against a single
            database snapshot and produces exact before/after diffs. Nothing is written until you
            approve individual items below.
          </p>
          <Input
            type="file"
            accept="application/json,.json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) setManifestText(await file.text());
            }}
          />
          <Textarea
            rows={6}
            value={manifestText}
            onChange={(e) => setManifestText(e.target.value)}
            placeholder='{"schema_version":"farmops.electrical.audit-batch.v1","batch_id":"FA-FS-2026-09-03-PM", …}'
            className="font-mono text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!manifestText.trim() || importMutation.isPending}
              onClick={() => importMutation.mutate()}
            >
              <Upload className="mr-1 h-4 w-4" />
              Import &amp; preview
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setManifestText(fsNwAuditManifestR2Text());
                toast.success(
                  `${FS_NW_AUDIT_R2_BATCH_ID} loaded — ${FS_NW_AUDITED_BREAKERS.length} circuit groups, ${FS_NW_AUDITED_BREAKERS.length} breaker positions, 20 relationship-only load links and 1 hold (35 items). Supersedes ${FS_NW_AUDIT_R1_BATCH_ID}; import to preview, nothing is written yet.`,
                );
              }}
            >
              Load {FS_NW_AUDIT_R2_BATCH_ID}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setManifestText(fsSwitchControlsManifestText());
                toast.success(
                  `${FS_SWITCH_CONTROLS_BATCH_ID} loaded — 2 observed switch banks, 2 wiring segments, 1 design-only control group and 4 holds. R2 and R3 are untouched; import to preview, nothing is written yet.`,
                );
              }}
              title="Loads the Farm Shop switching observation: the northeast (A8) and southwest (E1) enclosures, the cables between them, and explicit holds for device counts, conductor functions, controlled targets and functional operation."
            >
              Load {FS_SWITCH_CONTROLS_BATCH_ID}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={reconcileBuildMutation.isPending}
              onClick={() => reconcileBuildMutation.mutate()}
              title="Stages the outstanding as-built consequences (installed state, shared/dedicated, building context, explicitly observed grid and post) for the 20 loads audited in R2. R2 stays unchanged."
            >
              <RefreshCw className="mr-1 h-4 w-4" />
              Build {FS_NW_AUDIT_R3_BATCH_ID} metadata reconciliation
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={outletBuildMutation.isPending}
              onClick={() => outletBuildMutation.mutate()}
              title="Corrects legacy receptacle-outlet metadata for the 18 audited outlets: shared circuit class, and removal of the branch-circuit amperage and the VA derived from it. Relationships, 20 A ratings, descriptions, locations, voltage and lifecycle state are preserved."
            >
              <RefreshCw className="mr-1 h-4 w-4" />
              Build {R3_OUTLET_METADATA_BATCH_ID}
            </Button>
            {outletCandidates?.length ? (
              <div className="w-full rounded-md border p-3 text-xs">
                <p className="font-medium">
                  Outlet-like records not covered by this audit ({outletCandidates.length})
                </p>
                <p className="mt-1 text-muted-foreground">
                  Read-only. Nothing is staged for these records: they need their own field evidence
                  before any metadata changes.
                </p>
                <ul className="mt-2 space-y-1">
                  {outletCandidates.map((c) => (
                    <li key={c.load_id} className="font-mono">
                      {c.load_id} — {c.found ? "in record" : "no record"}, class{" "}
                      {c.dedicated_shared ?? "not recorded"}, amps{" "}
                      {c.amps === null ? "not recorded" : c.amps}, VA{" "}
                      {c.connected_va === null ? "not recorded" : c.connected_va}
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const blob = new Blob([outletCandidateCsv(outletCandidates)], {
                      type: "text/csv",
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${R3_OUTLET_METADATA_BATCH_ID}-candidates.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download className="mr-1 h-4 w-4" />
                  Candidate report CSV
                </Button>
              </div>
            ) : null}
            {manifestAlreadyHasLoadLinks ? (
              <p className="w-full text-xs text-muted-foreground">
                This batch already contains its audited load links, so the links-only follow-up
                builder is not offered — it would stage a duplicate{" "}
                <span className="font-mono">{FS_NW_LINKS_BATCH_ID}</span> for the same
                relationships.
              </p>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={linkBuildMutation.isPending}
                onClick={() => linkBuildMutation.mutate()}
                title="Reads the approved PNL-FS-NW circuit groups and the existing FS-### loads, then builds the links-only follow-up batch."
              >
                <RefreshCw className="mr-1 h-4 w-4" />
                Build load links from approved groups
              </Button>
            )}

            {payload ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => previewMutation.mutate(payload.batch.batch_id)}
                disabled={previewMutation.isPending}
              >
                <RefreshCw className="mr-1 h-4 w-4" />
                Re-preview
              </Button>
            ) : null}
          </div>
        </div>
      </PersistedSection>

      <PersistedSection
        storageKey="electrical.audit-batches.peer-pull"
        title="Pull a batch from another FarmOps instance"
        badges={<Badge variant="outline">preview only</Badge>}
      >
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Reads one stored manifest from a peer deployment&apos;s read-only API
            (<span className="font-mono">GET /api/v1/electrical/audit-batches/&#123;batch_id&#125;/manifest</span>),
            verifies its checksum after transfer and stages it here as a preview. Approvals are never
            carried over: every item still needs your explicit approval, and the conflict check runs
            against this instance&apos;s records. The canonical workbook is never touched.
          </p>
          <Input
            value={peerUrl}
            onChange={(e) => setPeerUrl(e.target.value)}
            placeholder="https://electrical.example.com"
          />
          <Input
            value={peerBatchId}
            onChange={(e) => setPeerBatchId(e.target.value)}
            placeholder="FA-FS-2026-09-03-PM"
            className="font-mono text-xs"
          />
          <Input
            type="password"
            value={peerToken}
            onChange={(e) => setPeerToken(e.target.value)}
            placeholder="Peer access token or farmops_sk_ key with electrical:audit-batches:read"
            autoComplete="off"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const token = generatePeerToken();
                setGeneratedPeerToken(await buildPeerRegistration(token));
                setPeerToken(token);
              }}
            >
              Generate a token
            </Button>
            {generatedPeerToken ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard?.writeText(generatedPeerToken.token);
                  toast.success("Key copied. Register it on the peer, then discard the copy.");
                }}
              >
                Copy key
              </Button>
            ) : null}
            {generatedPeerToken || peerToken ? (
              <Button size="sm" variant="ghost" onClick={clearPeerToken}>
                Clear
              </Button>
            ) : null}
          </div>
          {generatedPeerToken ? (
            <div className="space-y-2 rounded-md border border-border p-3 text-xs">
              <p className="text-muted-foreground">
                A pull authenticates against the peer, so this key must be registered{" "}
                <strong>there</strong>. The key below is filled into the field above and is not
                stored here — only its fingerprint is ever stored on the peer. Run this on your
                self-hosted instance, replacing the owner id with your peer account:
              </p>
              <p className="font-mono break-all">{maskPeerToken(generatedPeerToken.token)}</p>
              <pre className="overflow-x-auto rounded bg-muted p-2 font-mono whitespace-pre">
                {generatedPeerToken.sql}
              </pre>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(generatedPeerToken.sql);
                  toast.success("Registration statement copied.");
                }}
              >
                Copy registration statement
              </Button>
              <p className="text-muted-foreground">
                Scope granted: <span className="font-mono">{generatedPeerToken.scope}</span> — read
                only. Nothing on this instance changes until you approve each staged item.
              </p>
            </div>
          ) : null}
          <Button
            size="sm"
            disabled={
              !peerUrl.trim() ||
              !peerBatchId.trim() ||
              !peerToken.trim() ||
              peerPullMutation.isPending
            }
            onClick={() => peerPullMutation.mutate()}
          >
            <Upload className="mr-1 h-4 w-4" />
            Pull &amp; stage preview
          </Button>
          {peerNote ? <p className="text-xs text-muted-foreground">{peerNote}</p> : null}

        </div>
      </PersistedSection>

      <PeerSyncPanel />
      <PeerSyncSecretPanel />

      <PersistedSection
        storageKey="electrical.audit-batches.list"
        title="Audit batches"
        badges={<Badge variant="secondary">{batches.data?.length ?? 0}</Badge>}
      >
        <div className="space-y-1 text-sm">
          {(batches.data ?? []).map((b) => (
            <div
              key={b.id}
              className="flex w-full flex-wrap items-center gap-2 rounded-md px-2 py-1 hover:bg-accent"
            >
              <button
                type="button"
                className="flex flex-1 flex-wrap items-center gap-2 text-left"
                onClick={() => previewMutation.mutate(b.batch_id)}
              >
                <span className="font-mono text-xs">{b.batch_id}</span>
                <span className="text-muted-foreground">{b.title}</span>
                <Badge variant="outline">{b.status}</Badge>
                {b.observed_date ? (
                  <span className="text-xs text-muted-foreground">{b.observed_date}</span>
                ) : null}
              </button>
              {["draft", "validated", "approved"].includes(b.status) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={rejectMutation.isPending}
                  title="Marks this stored batch rejected. The manifest and its fingerprint are left unchanged; nothing is written or reversed."
                  onClick={() => {
                    const suggested =
                      b.batch_id === FS_NW_AUDIT_R1_BATCH_ID ? FS_NW_R1_REJECTION_REASON : "";
                    const reason = window.prompt(
                      `Reject ${b.batch_id} without applying it. Reason:`,
                      suggested,
                    );
                    if (reason && reason.trim().length >= 5) {
                      rejectMutation.mutate({ batch_id: b.batch_id, reason: reason.trim() });
                    }
                  }}
                >
                  Reject
                </Button>
              ) : null}
            </div>
          ))}

          {!batches.data?.length ? (
            <p className="text-xs text-muted-foreground">No audit batches imported yet.</p>
          ) : null}
        </div>
      </PersistedSection>

      {payload ? (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {payload.batch.batch_id}
                <Badge variant="outline">{payload.batch.status}</Badge>
                <Badge variant="secondary">{payload.gate_version}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">{payload.batch.scope}</p>
              <p className="text-xs text-muted-foreground">
                Building {payload.batch.building ?? "—"} · observed{" "}
                {payload.batch.observed_date ?? "—"} ({payload.batch.observed_time_precision ?? "—"},{" "}
                {payload.batch.timezone ?? "—"}) · manifest SHA-256{" "}
                <span className="font-mono">{payload.batch.manifest_sha256.slice(0, 16)}…</span>
              </p>
              {payload.batch.evidence.length ? (
                <p className="text-xs text-muted-foreground">
                  Evidence:{" "}
                  {payload.batch.evidence
                    .map((e) => `${e.name}${e.subject ? ` (${e.subject})` : ""}`)
                    .join(", ")}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {(["ready", "no_change", "hold", "conflict", "ods_candidate", "applied", "failed"] as AuditDisposition[]).map(
                  (d) => (
                    <Badge key={d} variant={DISPOSITION_VARIANT[d]}>
                      {d}: {payload.summary.by_disposition[d] ?? 0}
                    </Badge>
                  ),
                )}
              </div>
              {payload.refused_reason ? (
                <p className="text-sm text-destructive">{payload.refused_reason}</p>
              ) : null}
              {payload.qa_before || payload.qa ? (
                <p className="text-xs text-muted-foreground">
                  QA errors before {payload.qa_before?.error ?? "—"} → after{" "}
                  {payload.qa?.error ?? "—"} (total {payload.qa_before?.total ?? "—"} →{" "}
                  {payload.qa?.total ?? "—"})
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    download(`${payload.batch.batch_id}-manifest.json`, JSON.stringify(payload.batch, null, 2), "application/json")
                  }
                >
                  <Download className="mr-1 h-4 w-4" /> Normalized batch
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => download(`${payload.batch.batch_id}-preview.csv`, previewCsv(items))}
                >
                  <Download className="mr-1 h-4 w-4" /> Preview report
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => download(`${payload.batch.batch_id}-holds.csv`, holdCsv(items))}
                >
                  <Download className="mr-1 h-4 w-4" /> Hold report
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    download(
                      `${payload.batch.batch_id}-ods-candidates.csv`,
                      odsCandidateCsv(payload.batch.batch_id, items),
                    )
                  }
                >
                  <Download className="mr-1 h-4 w-4" /> ODS candidates
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      const res = await runCompensate({
                        data: { batch_id: payload.batch.batch_id },
                      });
                      download(
                        `${payload.batch.batch_id}-compensating.json`,
                        JSON.stringify(res.manifest, null, 2),
                        "application/json",
                      );
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  <Download className="mr-1 h-4 w-4" /> Compensating batch
                </Button>
              </div>
            </CardContent>
          </Card>

          <RevisionDiffPanel
            revisionBatchId={payload.batch.batch_id}
            batches={batches.data ?? []}
          />

          <PersistedSection
            storageKey="electrical.audit-batches.items"
            title="Proposed changes"
            defaultOpen
            badges={<Badge variant="secondary">{shown.length}</Badge>}
          >
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1">
                {(["all", ...AUDIT_DISPOSITIONS] as (AuditDisposition | "all")[]).map((d) => (
                  <Button
                    key={d}
                    size="sm"
                    variant={filter === d ? "default" : "outline"}
                    onClick={() => setFilter(d)}
                  >
                    {d}
                  </Button>
                ))}
                <Button size="sm" variant="secondary" onClick={selectAllReady}>
                  Select all ready ({readyKeys.length})
                </Button>
              </div>
              {shown.map((i) => (
                <ItemRow
                  key={i.item_key}
                  item={i}
                  approved={approved.has(i.item_key)}
                  onToggle={() => toggle(i.item_key)}
                />
              ))}
              {!shown.length ? (
                <p className="text-xs text-muted-foreground">Nothing matches this filter.</p>
              ) : null}
            </div>
          </PersistedSection>

          <PersistedSection
            storageKey="electrical.audit-batches.apply"
            title="Approve and apply"
            defaultOpen
            badges={<Badge variant="default">{approved.size} approved</Badge>}
          >
            <div className="space-y-2 text-sm">
              <Input
                placeholder="Approval statement (required)"
                value={statement}
                onChange={(e) => setStatement(e.target.value)}
              />
              <Textarea
                rows={2}
                placeholder="Reason for approving this apply (required)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={confirmed}
                  onCheckedChange={() => setConfirmed((v) => !v)}
                  aria-label="Confirm apply"
                />
                I approve writing the {approved.size} selected field observations. Holds, conflicts
                and ODS candidates stay unapplied.
              </label>
              <Button
                size="sm"
                disabled={
                  !confirmed ||
                  approved.size === 0 ||
                  statement.trim().length < 10 ||
                  reason.trim().length < 3 ||
                  applyMutation.isPending
                }
                onClick={() => applyMutation.mutate()}
              >
                <ShieldCheck className="mr-1 h-4 w-4" />
                Apply approved items
              </Button>
            </div>
          </PersistedSection>
        </>
      ) : null}
    </div>
  );
}
