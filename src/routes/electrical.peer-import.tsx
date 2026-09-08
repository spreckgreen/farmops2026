// Cross-deployment sharing of field audits and verified locations.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { ElectricalGate } from "@/components/electrical/electrical-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  applyPeerBundleImport,
  exportPeerBundle,
  previewPeerBundleImport,
  pullPeerBundle,
  type PeerBundleImportPreview,
  type PeerBundleImportResult,
} from "@/lib/electrical-peer-bundle.functions";
import {
  BUNDLE_KINDS,
  DECISION_LABEL,
  DEPLOYMENT_SCOPE_NOTE,
  peerBundleFilename,
  type CanonicalDecision,
} from "@/lib/electrical-peer-bundle";

export const Route = createFileRoute("/electrical/peer-import")({
  component: PeerImportPage,
  head: () => ({
    meta: [
      { title: "Share Verified Locations Between Sites — Bostead Farms" },
      {
        name: "description",
        content:
          "Export applied field audits and field-verified locations from one FarmOps deployment and import them into another, with conflicts held for approval.",
      },
      { property: "og:title", content: "Share Verified Locations Between Sites — Bostead Farms" },
      {
        property: "og:description",
        content:
          "Move applied field audits and verified locations between FarmOps deployments without overwriting local evidence.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

const DECISION_TONE: Record<CanonicalDecision, string> = {
  create: "border-emerald-500 text-emerald-700",
  fill: "border-sky-500 text-sky-700",
  conflict: "border-amber-500 text-amber-700",
  no_change: "border-muted text-muted-foreground",
  not_verified: "border-muted text-muted-foreground",
};

function PeerImportPage() {
  return (
    <ElectricalGate>
      <PeerImportWorkspace />
    </ElectricalGate>
  );
}

function PeerImportWorkspace() {
  const runExport = useServerFn(exportPeerBundle);
  const runPreview = useServerFn(previewPeerBundleImport);
  const runApply = useServerFn(applyPeerBundleImport);
  const runPull = useServerFn(pullPeerBundle);

  const [bundleText, setBundleText] = useState("");
  const [peerUrl, setPeerUrl] = useState("");
  const [peerToken, setPeerToken] = useState("");
  const [preview, setPreview] = useState<PeerBundleImportPreview | null>(null);
  const [result, setResult] = useState<PeerBundleImportResult | null>(null);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = (key: string) => {
    setApproved((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const onExport = async () => {
    setBusy("export");
    try {
      const out = await runExport({
        data: { origin: window.location.origin, include_manifests: true },
      });
      const blob = new Blob([out.text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = peerBundleFilename(out.generated_at);
      a.click();
      URL.revokeObjectURL(url);
      toast.success(
        `Bundle ready — ${out.counts.records} verified locations, ${out.counts.batches} applied audits.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The bundle could not be built.");
    } finally {
      setBusy(null);
    }
  };

  const onCheck = async (text: string) => {
    if (!text.trim()) {
      toast.error("Paste or choose a bundle file first.");
      return;
    }
    setBusy("preview");
    setResult(null);
    try {
      const out = await runPreview({ data: { bundle: text } });
      setPreview(out);
      setApproved(new Set());
      if (!out.ok) toast.error(out.errors[0] ?? "The bundle was rejected.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The bundle could not be read.");
    } finally {
      setBusy(null);
    }
  };

  const onPull = async () => {
    setBusy("pull");
    try {
      const out = await runPull({ data: { peer_base_url: peerUrl, peer_token: peerToken } });
      if (!out.ok || !out.bundle_text) {
        toast.error(out.error ?? "The other deployment could not be reached.");
        return;
      }
      setBundleText(out.bundle_text);
      toast.success(
        `Received ${out.counts?.records ?? 0} verified locations and ${out.counts?.batches ?? 0} applied audits from ${out.origin}.`,
      );
      await onCheck(out.bundle_text);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The other deployment could not be reached.");
    } finally {
      setBusy(null);
    }
  };

  const onApply = async () => {
    setBusy("apply");
    try {
      const out = await runApply({
        data: {
          bundle: bundleText,
          approved_keys: [...approved],
          import_batches: true,
        },
      });
      setResult(out);
      if (out.ok) {
        toast.success(
          `${out.created} records created, ${out.updated} updated, ${out.batches_staged.length} audits staged for review.`,
        );
      } else {
        toast.error(out.errors[0] ?? "Some items could not be imported.");
      }
      await onCheck(bundleText);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The import failed.");
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    setBundleText(text);
    await onCheck(text);
  };

  const conflicts = (preview?.records ?? []).filter((r) => r.decision === "conflict");

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold">Share verified locations between sites</h1>
        <p className="text-sm text-muted-foreground">{DEPLOYMENT_SCOPE_NOTE}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Only field-verified locations travel — grid cells, posts, measured coordinates and the
          evidence behind them. Design coordinates, circuits, ratings and descriptions stay with the
          deployment that owns them. Records that do not exist here are created automatically and
          blank fields are filled in; anything that disagrees with a value already recorded here
          waits for your approval.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Send from this site</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Download a bundle of every applied field audit and every field-verified location here,
            then load it at the other site.
          </p>
          <Button onClick={onExport} disabled={busy !== null}>
            {busy === "export" ? "Building…" : "Download bundle"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pull directly from the other site</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="peer-url">Other site address</Label>
              <Input
                id="peer-url"
                placeholder="https://othersite.example.com"
                value={peerUrl}
                onChange={(e) => setPeerUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="peer-token">Read key from the other site</Label>
              <Input
                id="peer-token"
                type="password"
                autoComplete="off"
                placeholder="farmops_sk_…"
                value={peerToken}
                onChange={(e) => setPeerToken(e.target.value)}
              />
            </div>
          </div>
          <Button
            variant="secondary"
            onClick={onPull}
            disabled={busy !== null || !peerUrl.trim() || !peerToken.trim()}
          >
            {busy === "pull" ? "Fetching…" : "Fetch from other site"}
          </Button>
          <p className="text-xs text-muted-foreground">
            The other site must be reachable over the public internet and the key needs read access
            to its electrical records. Nothing is sent to the other site.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Load a bundle file</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            type="file"
            accept="application/json,.json"
            onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
          />
          <Textarea
            rows={5}
            placeholder="…or paste the bundle here"
            value={bundleText}
            onChange={(e) => setBundleText(e.target.value)}
            className="font-mono text-xs"
          />
          <Button
            variant="secondary"
            onClick={() => void onCheck(bundleText)}
            disabled={busy !== null}
          >
            {busy === "preview" ? "Checking…" : "Check bundle"}
          </Button>
        </CardContent>
      </Card>

      {preview && !preview.ok ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">This bundle was rejected</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">
              {preview.errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {preview?.ok ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              From {preview.origin} — {preview.summary.total} verified locations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">{preview.summary.create} new here</Badge>
              <Badge variant="outline">{preview.summary.fill} fill a blank</Badge>
              <Badge variant="outline">{preview.summary.conflict} need approval</Badge>
              <Badge variant="outline">{preview.summary.no_change} already match</Badge>
              <Badge variant="outline">{preview.summary.not_verified} without evidence</Badge>
            </div>

            <div className="space-y-2">
              <h2 className="text-sm font-semibold">Field audits in this bundle</h2>
              {preview.batches.length === 0 ? (
                <p className="text-sm text-muted-foreground">No audits are included.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {preview.batches.map((b) => (
                    <li key={b.batch_id} className="rounded border p-2">
                      <span className="font-medium">{b.batch_id}</span>
                      {b.title ? <span className="text-muted-foreground"> — {b.title}</span> : null}
                      <p className="text-xs text-muted-foreground">{b.message}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-2">
              <h2 className="text-sm font-semibold">Locations</h2>
              <div className="space-y-1">
                {preview.records.map((row) => (
                  <div key={row.key} className="rounded border p-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      {row.decision === "conflict" ? (
                        <Checkbox
                          checked={approved.has(row.key)}
                          onCheckedChange={() => toggle(row.key)}
                          aria-label={`Approve ${row.stable_id}`}
                        />
                      ) : null}
                      <span className="font-medium">{row.stable_id}</span>
                      <span className="text-xs text-muted-foreground">
                        {BUNDLE_KINDS[row.kind].label}
                      </span>
                      <Badge variant="outline" className={DECISION_TONE[row.decision]}>
                        {DECISION_LABEL[row.decision]}
                      </Badge>
                    </div>
                    {row.description || row.peer_description ? (
                      <p className="text-xs text-muted-foreground">
                        {row.description ?? row.peer_description}
                      </p>
                    ) : null}
                    {row.changes.length > 0 ? (
                      <ul className="mt-1 space-y-0.5 text-xs">
                        {row.changes.map((c) => (
                          <li key={c.column}>
                            <span className="font-mono">{c.column}</span>:{" "}
                            <span className="text-muted-foreground">
                              {c.before == null || c.before === "" ? "(blank)" : String(c.before)}
                            </span>{" "}
                            → <span className="font-medium">{String(c.after)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {row.note ? (
                      <p className="mt-1 text-xs text-muted-foreground">{row.note}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={onApply} disabled={busy !== null}>
                {busy === "apply" ? "Importing…" : "Import into this site"}
              </Button>
              <span className="text-xs text-muted-foreground">
                {preview.summary.auto_apply} applied automatically
                {conflicts.length > 0
                  ? `, ${approved.size} of ${conflicts.length} disagreements approved`
                  : ""}
                . Audits land as previews to approve on the audit batches page.
              </span>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Import result</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              {result.created} created, {result.updated} updated,{" "}
              {result.skipped_conflicts} disagreements left for approval,{" "}
              {result.batches_staged.length} audits staged for review.
            </p>
            {result.batches_staged.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Staged audits: {result.batches_staged.join(", ")}
              </p>
            ) : null}
            {result.failures.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-xs text-destructive">
                {result.failures.map((f) => (
                  <li key={f.key}>
                    {f.key}: {f.message}
                  </li>
                ))}
              </ul>
            ) : null}
            {result.batches_failed.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-xs text-destructive">
                {result.batches_failed.map((f) => (
                  <li key={f.batch_id}>
                    {f.batch_id}: {f.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
