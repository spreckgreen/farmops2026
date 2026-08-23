import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import { AppLayout } from "@/components/app-layout";
import { VaultReencryptCard } from "@/components/vault-reencrypt-card";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getVaultSecretMetadata,
  regenerateVaultSecret,
  revealMasterKey,
  type RegenerateFormat,
  type VaultSecretMetadata,
  type MasterKeyRevealResult,
} from "@/lib/vault-metadata.functions";

export const Route = createFileRoute("/admin/vault-secrets")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Encrypted secret metadata — Bostead" },
      {
        name: "description",
        content:
          "Admin view of encrypted vault metadata with one-click re-encryption and secret regeneration — no plaintext is ever displayed.",
      },
      { property: "og:title", content: "Encrypted secret metadata — Bostead" },
      {
        property: "og:description",
        content:
          "Inspect sealed vault rows, spot entries on a stale key, re-encrypt, and regenerate secret values without exposing plaintext.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VaultSecretsAdminPage,
});

function sealBadge(state: VaultSecretMetadata["sealState"]) {
  if (state === "current") return <Badge variant="secondary">Current key</Badge>;
  if (state === "old-key") return <Badge className="bg-amber-500 text-white">Old key</Badge>;
  return <Badge variant="destructive">Unreadable</Badge>;
}

function VaultSecretsAdminPage() {
  const fetchMeta = useServerFn(getVaultSecretMetadata);
  const regenerate = useServerFn(regenerateVaultSecret);
  const reveal = useServerFn(revealMasterKey);

  const report = useQuery({
    queryKey: ["vault-secret-metadata"],
    queryFn: () => fetchMeta({ data: undefined }),
    refetchOnWindowFocus: false,
  });

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [format, setFormat] = useState<RegenerateFormat>("hex");
  const [byteLength, setByteLength] = useState(32);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revealState, setRevealState] = useState<{
    open: boolean;
    reason: string;
    revealed: MasterKeyRevealResult | null;
    busy: boolean;
  }>({ open: false, reason: "", revealed: null, busy: false });

  async function runRegenerate(id: string) {
    setBusyId(id);
    try {
      const r = await regenerate({ data: { id, format, byteLength, confirm: true } });
      toast.success(
        `Regenerated "${r.title}" — new value fingerprint ${r.newValueFingerprint} (${r.newValueLength} chars)` +
          (r.envCacheInvalidated ? `, ${r.envKey} cache refreshed` : ""),
      );
      setPendingId(null);
      await report.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function runReveal() {
    setRevealState((s) => ({ ...s, busy: true }));
    try {
      const r = await reveal({ data: { confirm: true, reason: revealState.reason } });
      setRevealState((s) => ({ ...s, revealed: r, open: false }));
      toast.success("Master key revealed. Copy it now — it will not be shown again on refresh.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRevealState((s) => ({ ...s, busy: false }));
    }
  }

  function copyRevealedKey() {
    if (!revealState.revealed) return;
    navigator.clipboard.writeText(revealState.revealed.value).then(
      () => toast.success("Copied to clipboard"),
      () => toast.error("Could not copy automatically — select and copy manually"),
    );
  }

  const d = report.data;

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <KeyRound className="h-6 w-6" />
            Encrypted secret metadata
          </h1>
          <p className="text-sm text-muted-foreground">
            Inspect every sealed vault row — which key opens it, how big it is, when it changed —
            then re-encrypt or mint a fresh random value. Nothing on this page ever displays a
            plaintext secret; values are identified only by a short fingerprint.
          </p>
        </header>

        <div className="rounded-md border bg-muted/40 p-3 text-sm flex gap-2">
          <EyeOff className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
          <div>
            Fingerprints are the first 4 bytes of SHA-256 of the value (for example{" "}
            <code>9f3ac1d0</code>). Two rows with the same fingerprint hold the same secret; a
            changed fingerprint proves a regeneration took effect.
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Fingerprint className="h-4 w-4" /> Key state
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => report.refetch()}
                disabled={report.isFetching}
              >
                {report.isFetching ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <>
                    <RefreshCw className="h-3 w-3 mr-1" /> Refresh
                  </>
                )}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            {report.isLoading && <div className="text-muted-foreground">Loading…</div>}
            {report.error && (
              <div className="text-destructive">{(report.error as Error).message}</div>
            )}
            {d && !d.keyConfigured && (
              <div className="rounded-md border-2 border-destructive bg-destructive/10 p-3 flex gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-destructive">
                    VAULT_ENCRYPTION_KEY is not configured
                  </div>
                  Set it on the server (<code>openssl rand -hex 32</code>) and restart before
                  inspecting or regenerating secrets.
                </div>
              </div>
            )}
            {d && d.keyConfigured && (
              <div className="grid gap-1.5 sm:grid-cols-2">
                <MetaRow label="Primary key fingerprint" value={<code>{d.primaryFingerprint}</code>} />
                <MetaRow
                  label="Old key fingerprint"
                  value={
                    d.oldFingerprint ? (
                      <code>{d.oldFingerprint}</code>
                    ) : (
                      <span className="text-muted-foreground">not loaded</span>
                    )
                  }
                />
                <MetaRow label="Target key_version" value={<code>{d.targetKeyVersion}</code>} />
                <MetaRow label="Rows visible" value={d.counts.total} />
                <MetaRow
                  label="On current key"
                  value={
                    <span className="text-emerald-600 dark:text-emerald-400">
                      {d.counts.current}
                    </span>
                  }
                />
                <MetaRow
                  label="On old key / unreadable"
                  value={
                    <span
                      className={
                        d.counts.onOldKey + d.counts.unreadable === 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-amber-600 dark:text-amber-400"
                      }
                    >
                      {d.counts.onOldKey} / {d.counts.unreadable}
                    </span>
                  }
                />
              </div>
            )}
            {d && d.keyConfigured && d.counts.onOldKey + d.counts.unreadable === 0 && d.counts.total > 0 && (
              <div className="mt-2 rounded-md border border-emerald-500/50 bg-emerald-500/10 p-3 flex gap-2 text-emerald-800 dark:text-emerald-200">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
                Every visible row is sealed with the current key.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Regeneration settings
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Format</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as RegenerateFormat)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hex">hex (e.g. 64 chars from 32 bytes)</SelectItem>
                  <SelectItem value="base64url">base64url (URL-safe, no padding)</SelectItem>
                  <SelectItem value="alphanumeric">alphanumeric (A–Z a–z 0–9)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="byteLength">
                Length ({format === "alphanumeric" ? "characters" : "random bytes"})
              </Label>
              <Input
                id="byteLength"
                type="number"
                min={16}
                max={128}
                value={byteLength}
                onChange={(e) => setByteLength(Number(e.target.value) || 32)}
              />
              <p className="text-xs text-muted-foreground">
                32 bytes of hex gives the 64-hex-char shape used by{" "}
                <code>VAULT_ENCRYPTION_KEY</code>-style secrets.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sealed rows</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>env_key</TableHead>
                  <TableHead>Seal</TableHead>
                  <TableHead>Fingerprint</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(d?.items ?? []).map((it) => (
                  <TableRow key={it.id}>
                    <TableCell className="font-medium">
                      {it.title}
                      {it.hasNotes && (
                        <span className="ml-2 text-xs text-muted-foreground">+ notes</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{it.scope}</TableCell>
                    <TableCell className="text-xs font-mono">
                      {it.envKey ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>{sealBadge(it.sealState)}</TableCell>
                    <TableCell className="text-xs font-mono">
                      {it.valueFingerprint ?? "—"}
                      <div className="text-muted-foreground">v{it.keyVersion ?? "?"}</div>
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {it.valueLength != null ? `${it.valueLength} ch` : "—"}
                      <div className="text-muted-foreground">{it.valueBytes} B sealed</div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {new Date(it.updatedAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {pendingId === it.id ? (
                        <div className="flex gap-1 justify-end">
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={busyId === it.id}
                            onClick={() => runRegenerate(it.id)}
                          >
                            {busyId === it.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              "Confirm replace"
                            )}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setPendingId(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setPendingId(it.id)}>
                          <Sparkles className="h-3 w-3 mr-1" /> Regenerate
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {d && d.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">
                      No vault rows visible to your account.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {pendingId && (
          <div className="rounded-md border-2 border-destructive bg-destructive/10 p-3 text-sm flex gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              Regenerating <strong>replaces</strong> the stored value with a new random one. The
              old value is gone and any external service using it (an API provider, webhook, or
              integration) must be updated with the new value from the vault page.
            </div>
          </div>
        )}

        <VaultReencryptCard onDone={() => report.refetch()} />
      </div>
    </AppLayout>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b py-1 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
