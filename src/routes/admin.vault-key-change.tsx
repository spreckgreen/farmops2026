import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import { AppLayout } from "@/components/app-layout";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getVaultKeyHealth,
  recordVaultKeyEvent,
  type VaultKeyEvent,
} from "@/lib/vault-key-journal.functions";

export const Route = createFileRoute("/admin/vault-key-change")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Change or reset the vault key — Bostead" },
      {
        name: "description",
        content:
          "Guided, logged workflow for changing or resetting the vault encryption key without losing stored secrets.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Change or reset the vault key" },
      {
        property: "og:description",
        content: "Guided, logged vault encryption key change for Bostead administrators.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VaultKeyChangePage,
});

function generateKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function VaultKeyChangePage() {
  const health = useServerFn(getVaultKeyHealth);
  const record = useServerFn(recordVaultKeyEvent);

  const q = useQuery({
    queryKey: ["vault-key-health"],
    queryFn: () => health({ data: {} }),
    refetchOnWindowFocus: false,
    retry: false,
  });

  const [candidate, setCandidate] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState<VaultKeyEvent | null>(null);

  async function log(event: VaultKeyEvent) {
    setSaving(event);
    try {
      await record({ data: { event, note } });
      setNote("");
      toast.success("Recorded in the key history.");
      await q.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record that.");
    } finally {
      setSaving(null);
    }
  }

  const d = q.data;

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-6 p-4">
        <header className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <KeyRound size={22} /> Change or reset the vault key
          </h1>
          <p className="text-sm text-muted-foreground">
            The vault key lives in server configuration, not in the database. This page
            records which key the server is running with, warns when that key changes
            unexpectedly, and walks a change through in the order that keeps your stored
            secrets readable.
          </p>
        </header>

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">Current key and stored entries</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => q.refetch()}
              disabled={q.isFetching}
            >
              {q.isFetching ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
              <span className="ml-2">Re-check</span>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {q.isLoading && <p className="text-muted-foreground">Checking…</p>}
            {q.error && (
              <p className="text-destructive">
                {q.error instanceof Error ? q.error.message : "Check failed."}
              </p>
            )}
            {d && (
              <>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                  <div>
                    <dt className="text-muted-foreground">Key in use</dt>
                    <dd className="font-mono">{d.primaryFingerprint ?? "not configured"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Key format</dt>
                    <dd>{d.primaryShape ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Previous key loaded</dt>
                    <dd>{d.oldKeyPresent ? `yes (${d.oldFingerprint})` : "no"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Entries stored</dt>
                    <dd>{d.rowsTotal}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Readable now</dt>
                    <dd>{d.rowsReadable}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Unreadable now</dt>
                    <dd className={d.rowsUnreadable > 0 ? "font-semibold text-destructive" : ""}>
                      {d.rowsUnreadable}
                    </dd>
                  </div>
                </dl>

                {d.keyChangedSinceLastRecord && (
                  <div className="flex items-start gap-2 rounded-md border-2 border-destructive bg-destructive/10 p-3">
                    <AlertTriangle className="mt-0.5 flex-shrink-0 text-destructive" size={18} />
                    <div>
                      <div className="font-semibold text-destructive">
                        The key changed without going through this page
                      </div>
                      <p className="mt-1">
                        The running key is <code className="font-mono">{d.primaryFingerprint}</code>,
                        but the last key recorded here was{" "}
                        <code className="font-mono">{d.lastJournalFingerprint}</code>. That change
                        has been logged with today's date. Nothing can decrypt entries sealed with
                        the earlier key except that earlier key.
                      </p>
                    </div>
                  </div>
                )}

                {d.rowsUnreadable > 0 && !d.keyChangedSinceLastRecord && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-500 bg-amber-500/10 p-3">
                    <AlertTriangle
                      className="mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-400"
                      size={18}
                    />
                    <p>
                      {d.rowsUnreadable} of {d.rowsTotal} entries cannot be opened with the keys
                      loaded right now. Recover them with the previous key before changing keys
                      again — see the recovery console below.
                    </p>
                  </div>
                )}

                {d.rowsTotal > 0 && d.rowsUnreadable === 0 && (
                  <div className="flex items-center gap-2 rounded-md border border-emerald-500 bg-emerald-500/10 p-3">
                    <CheckCircle2 className="text-emerald-600 dark:text-emerald-400" size={18} />
                    <p>Every stored entry opens with the keys loaded right now.</p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Change the key safely — in this order</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <ol className="ml-5 list-decimal space-y-3">
              <li>
                <strong>Confirm everything is readable first.</strong> The counts above must show
                zero unreadable entries. If they don't, stop and recover with the old key in the{" "}
                <a className="underline" href="/admin/vault-secrets">
                  recovery console
                </a>
                .
              </li>
              <li>
                <strong>Take a backup.</strong> Download a copy from the{" "}
                <a className="underline" href="/admin/vault-backup">
                  backup page
                </a>{" "}
                and keep the current key with it.
              </li>
              <li>
                <strong>Save the current key as the fallback.</strong> Copy today's key value into{" "}
                <code>VAULT_ENCRYPTION_KEY_OLD</code>. This is the step that prevents the failure
                you hit — without it, older entries go dark the moment the new key loads. You can
                read the current value on the{" "}
                <a className="underline" href="/admin/export-key">
                  key export page
                </a>
                .
              </li>
              <li>
                <strong>Generate the new key</strong> and put it in{" "}
                <code>VAULT_ENCRYPTION_KEY</code>:
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setCandidate(generateKey())}>
                    Generate a new 64-character key
                  </Button>
                  {candidate && (
                    <>
                      <code className="rounded bg-muted px-2 py-1 font-mono text-xs break-all">
                        {candidate}
                      </code>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void navigator.clipboard.writeText(candidate);
                          toast.success("Copied. Store it in your password manager now.");
                        }}
                      >
                        <Copy size={14} />
                      </Button>
                    </>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Generated in your browser and never sent anywhere. If you close this page without
                  saving it, it is gone.
                </p>
              </li>
              <li>
                <strong>Restart the app</strong> so both variables load, then press{" "}
                <em>Re-check</em> above. You should see the new fingerprint as the key in use, the
                old one as the loaded previous key, and zero unreadable entries.
              </li>
              <li>
                <strong>Re-seal every entry with the new key</strong> in the{" "}
                <a className="underline" href="/admin/vault-rotation">
                  rotation console
                </a>{" "}
                until nothing remains on the old key.
              </li>
              <li>
                <strong>Remove <code>VAULT_ENCRYPTION_KEY_OLD</code></strong>, restart once more,
                re-check here, and record the change below.
              </li>
            </ol>

            <div className="space-y-2 rounded-md border p-3">
              <Label htmlFor="key-note">Record what happened (kept in the key history)</Label>
              <Input
                id="key-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Planned rotation, old key stored in password manager"
              />
              <p className="text-xs text-muted-foreground">
                Never paste a key value here — notes are stored in the database in plain text.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={saving !== null}
                  onClick={() => log("change_started")}
                >
                  {saving === "change_started" ? <Loader2 className="animate-spin" size={14} /> : null}
                  <span className="ml-1">Log: change starting</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={saving !== null}
                  onClick={() => log("change_acknowledged")}
                >
                  {saving === "change_acknowledged" ? (
                    <Loader2 className="animate-spin" size={14} />
                  ) : null}
                  <span className="ml-1">Log: acknowledged an unexpected change</span>
                </Button>
                <Button
                  size="sm"
                  disabled={saving !== null}
                  onClick={() => log("change_completed")}
                >
                  {saving === "change_completed" ? (
                    <Loader2 className="animate-spin" size={14} />
                  ) : (
                    <ShieldCheck size={14} />
                  )}
                  <span className="ml-1">Log: change complete</span>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Key history</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {!d || d.journal.length === 0 ? (
              <p className="text-muted-foreground">No entries recorded yet.</p>
            ) : (
              <ul className="space-y-2">
                {d.journal.map((e) => (
                  <li key={e.id} className="rounded border p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{e.event.replace(/_/g, " ")}</span>
                      <code className="font-mono text-xs">{e.fingerprint}</code>
                      <span className="text-xs text-muted-foreground">
                        {new Date(e.createdAt).toLocaleString()}
                      </span>
                      {e.rowsTotal != null && (
                        <span className="text-xs text-muted-foreground">
                          {e.rowsReadable}/{e.rowsTotal} readable
                        </span>
                      )}
                    </div>
                    {e.note && <p className="mt-1 text-muted-foreground">{e.note}</p>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
