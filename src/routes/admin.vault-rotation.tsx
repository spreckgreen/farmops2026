import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, RefreshCw, ShieldCheck } from "lucide-react";

import { AppLayout } from "@/components/app-layout";
import { VaultReencryptCard } from "@/components/vault-reencrypt-card";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getRotationStatus,
  rotateVaultKey,
  type RotationRunResult,
} from "@/lib/vault-rotation.functions";

export const Route = createFileRoute("/admin/vault-rotation")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({
    meta: [
      { title: "Rotate vault key — Bostead" },
      {
        name: "description",
        content:
          "Admin workflow to safely rotate VAULT_ENCRYPTION_KEY by re-encrypting every vault entry with the new key.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VaultRotationPage,
});

function VaultRotationPage() {
  const getStatus = useServerFn(getRotationStatus);
  const rotate = useServerFn(rotateVaultKey);

  const status = useQuery({
    queryKey: ["vault-rotation-status"],
    queryFn: () => getStatus(),
    refetchOnWindowFocus: false,
  });

  const [running, setRunning] = useState(false);
  const [totalProcessed, setTotalProcessed] = useState(0);
  const [totalFailed, setTotalFailed] = useState(0);
  const [lastRun, setLastRun] = useState<RotationRunResult | null>(null);
  const [errorLog, setErrorLog] = useState<Array<{ id: string; message: string }>>([]);

  async function runRotation() {
    if (running) return;
    setRunning(true);
    setTotalProcessed(0);
    setTotalFailed(0);
    setErrorLog([]);
    try {
      // Loop batches until remaining stops decreasing or hits 0.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const r = await rotate({ data: { batchSize: 50 } });
        setLastRun(r);
        setTotalProcessed((n) => n + r.processed);
        setTotalFailed((n) => n + r.failed);
        if (r.errors.length) setErrorLog((prev) => [...prev, ...r.errors]);
        if (r.remaining === 0) break;
        // If nothing moved this batch, stop — otherwise we'd loop forever on unrecoverable rows.
        if (r.processed === 0) break;
      }
      await status.refetch();
      toast.success("Rotation batch complete");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const s = status.data;

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <KeyRound className="h-6 w-6" />
            Rotate vault encryption key
          </h1>
          <p className="text-sm text-muted-foreground">
            Safely replace <code>VAULT_ENCRYPTION_KEY</code> without losing data. Every vault
            entry gets re-encrypted with the new key while the old key stays loaded as a
            fallback so nothing goes dark during the roll.
          </p>
          <p className="text-sm">
            <a href="/admin/vault-key-change" className="underline font-medium">
              Key change &amp; history console →
            </a>{" "}
            <span className="text-muted-foreground">
              — start here to see which key the server is running, whether it changed
              unexpectedly, and the full order of operations.
            </span>
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Step-by-step
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-3">
            <ol className="list-decimal ml-5 space-y-2">
              <li>
                Generate a new 32-byte key on the server:
                <pre className="mt-1 bg-muted border rounded px-2 py-1 text-xs font-mono">openssl rand -hex 32</pre>
              </li>
              <li>
                Edit <code>.env.local</code> — set the new value as{" "}
                <code>VAULT_ENCRYPTION_KEY</code> and move the current value to{" "}
                <code>VAULT_ENCRYPTION_KEY_OLD</code>:
                <pre className="mt-1 bg-muted border rounded px-2 py-1 text-xs font-mono whitespace-pre-wrap">{`VAULT_ENCRYPTION_KEY=<new 64-hex chars>
VAULT_ENCRYPTION_KEY_OLD=<current 64-hex chars>`}</pre>
              </li>
              <li>
                Restart the stack so both keys are loaded:
                <pre className="mt-1 bg-muted border rounded px-2 py-1 text-xs font-mono">./scripts/refresh.sh --no-pull --force</pre>
              </li>
              <li>
                Click <strong>Re-encrypt now</strong> below. The status card confirms both
                fingerprints changed and the "rows on other key" number will drop to 0.
              </li>
              <li>
                Once <strong>Rows on other key = 0</strong>, remove{" "}
                <code>VAULT_ENCRYPTION_KEY_OLD</code> from <code>.env.local</code> and restart
                once more.
              </li>
              <li className="text-destructive">
                Back up the new key in a password manager <strong>before</strong> deleting the
                old one — if you lose it, every vault entry becomes unrecoverable.
              </li>
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <RefreshCw className="h-4 w-4" /> Current state
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => status.refetch()}
                disabled={status.isFetching}
              >
                {status.isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : "Refresh"}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            {status.isLoading && <div className="text-muted-foreground">Loading…</div>}
            {status.error && (
              <div className="text-destructive">{(status.error as Error).message}</div>
            )}
            {s && !s.configured && (
              <div className="rounded-md border-2 border-destructive bg-destructive/10 p-3 flex gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-destructive">
                    VAULT_ENCRYPTION_KEY is not configured
                  </div>
                  <p>Set it in <code>.env.local</code> before rotating.</p>
                </div>
              </div>
            )}
            {s && s.configured && (
              <div className="space-y-1.5">
                <Row label="Primary key fingerprint" value={<code>{s.primaryFingerprint}</code>} />
                <Row
                  label="Old key fingerprint (fallback)"
                  value={s.oldFingerprint ? <code>{s.oldFingerprint}</code> : <span className="text-muted-foreground">not loaded</span>}
                />
                <Row label="Target key_version" value={<code>{s.targetVersion}</code>} />
                <Row label="Total rows" value={s.rowsTotal} />
                <Row
                  label="Rows on current key"
                  value={<span className="text-emerald-600 dark:text-emerald-400">{s.rowsOnTarget}</span>}
                />
                <Row
                  label="Rows on other key (need rotation)"
                  value={
                    <span className={s.rowsOnOther === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                      {s.rowsOnOther}
                    </span>
                  }
                />
                {s.versionBreakdown.length > 1 && (
                  <div className="text-xs text-muted-foreground pt-1">
                    Version breakdown: {s.versionBreakdown.map((v) => `${v.key_version}:${v.count}`).join(", ")}
                  </div>
                )}

                {s.rowsOnOther === 0 && s.oldKeyPresent && (
                  <div className="mt-3 rounded-md border border-emerald-500/50 bg-emerald-500/10 p-3 flex gap-2 text-emerald-800 dark:text-emerald-200">
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium">All rows on the new key.</div>
                      Remove <code>VAULT_ENCRYPTION_KEY_OLD</code> from <code>.env.local</code>{" "}
                      and restart to complete rotation.
                    </div>
                  </div>
                )}
                {s.rowsOnOther === 0 && !s.oldKeyPresent && (
                  <div className="mt-3 rounded-md border border-emerald-500/50 bg-emerald-500/10 p-3 flex gap-2 text-emerald-800 dark:text-emerald-200">
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    Vault is fully on a single key. No rotation needed.
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Re-encrypt now</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Runs in batches of 50 rows. Safe to interrupt and resume — progress is stored per
              row. Rerunning after completion is a no-op.
            </p>
            <Button onClick={runRotation} disabled={running || !s?.configured}>
              {running ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Rotating…
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" /> Re-encrypt all entries
                </>
              )}
            </Button>
            {(running || lastRun) && (
              <div className="text-sm space-y-1 pt-2 border-t">
                <Row label="Processed (this session)" value={totalProcessed} />
                <Row label="Failed (this session)" value={<span className={totalFailed ? "text-destructive" : ""}>{totalFailed}</span>} />
                {lastRun && <Row label="Remaining" value={lastRun.remaining} />}
              </div>
            )}
            {errorLog.length > 0 && (
              <div className="mt-2 rounded-md border border-destructive/50 bg-destructive/5 p-3">
                <div className="text-sm font-medium text-destructive mb-1">
                  {errorLog.length} row(s) could not be re-encrypted
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  These are usually entries encrypted with a third, unloaded key. Set{" "}
                  <code>VAULT_ENCRYPTION_KEY_OLD</code> to the correct previous value and rerun,
                  or delete the unrecoverable rows manually.
                </p>
                <ul className="text-xs font-mono max-h-40 overflow-auto space-y-0.5">
                  {errorLog.map((e, i) => (
                    <li key={i}><span className="text-muted-foreground">{e.id.slice(0, 8)}…</span> {e.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <VaultReencryptCard onDone={() => void status.refetch()} />
      </div>

    </AppLayout>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
