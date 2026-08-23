import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Loader2, ShieldAlert, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  reencryptVaultWithCurrentKey,
  purgeUnrecoverableVaultRows,
  type ReencryptResult,
} from "@/lib/vault-recovery.functions";

/**
 * One-click recovery: re-seal every vault row with the CURRENT
 * VAULT_ENCRYPTION_KEY, optionally using pasted candidate old keys that are
 * held in memory for the request only.
 */
export function VaultReencryptCard({ onDone }: { onDone?: () => void }) {
  const reencrypt = useServerFn(reencryptVaultWithCurrentKey);
  const purge = useServerFn(purgeUnrecoverableVaultRows);

  const [keys, setKeys] = useState("");
  const [running, setRunning] = useState(false);
  const [purging, setPurging] = useState(false);
  const [result, setResult] = useState<ReencryptResult | null>(null);

  async function run() {
    setRunning(true);
    try {
      const r = await reencrypt({ data: { recoveryKeys: keys, limit: 500 } });
      setResult(r);
      setKeys(""); // never keep candidate keys around after use
      toast.success(
        r.resealed > 0
          ? `Re-encrypted ${r.resealed} entr${r.resealed === 1 ? "y" : "ies"} with the current key`
          : "Every readable entry is already on the current key",
      );
      onDone?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  async function purgeAll() {
    if (!result?.unrecoverable.length) return;
    if (
      !window.confirm(
        `Permanently delete ${result.unrecoverable.length} entr${result.unrecoverable.length === 1 ? "y" : "ies"} that no key can decrypt? You will need to re-enter these values.`,
      )
    )
      return;
    setPurging(true);
    try {
      const r = await purge({
        data: { ids: result.unrecoverable.map((u) => u.id), confirm: true },
      });
      toast.success(`Deleted ${r.deleted} unrecoverable entr${r.deleted === 1 ? "y" : "ies"}`);
      setResult({ ...result, unrecoverable: [] });
      onDone?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPurging(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Wand2 className="h-4 w-4" /> Re-encrypt with current VAULT_ENCRYPTION_KEY
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Use this when entries were sealed with a key that is no longer loaded (a rotation
          done without setting <code>VAULT_ENCRYPTION_KEY_OLD</code>). Every row that can be
          opened — with the current key, the OLD env key, or a candidate key you paste below —
          is immediately re-sealed with the current key. Safe to run repeatedly.
        </p>

        <div className="space-y-2">
          <Label htmlFor="recovery-keys">
            Candidate old keys (optional, one per line)
          </Label>
          <Textarea
            id="recovery-keys"
            value={keys}
            onChange={(e) => setKeys(e.target.value)}
            rows={3}
            autoComplete="off"
            spellCheck={false}
            placeholder={"3f9a…64 hex chars…\nprevious-passphrase"}
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            Used in memory for this run only — never stored, logged, or returned. The field is
            cleared automatically when the run finishes.
          </p>
        </div>

        <Button onClick={run} disabled={running}>
          {running ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Re-encrypting…
            </>
          ) : (
            <>
              <Wand2 className="h-4 w-4 mr-2" /> Re-encrypt everything now
            </>
          )}
        </Button>

        {result && (
          <div className="space-y-3 pt-3 border-t text-sm">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <Stat label="Entries scanned" value={result.scanned} />
              <Stat label="Recovered & re-sealed" value={result.resealed} />
              <Stat label="Already on current key" value={result.alreadyCurrent} />
              <Stat
                label="Unrecoverable"
                value={
                  <span className={result.unrecoverable.length ? "text-destructive" : ""}>
                    {result.unrecoverable.length}
                  </span>
                }
              />
            </div>

            <div className="text-xs text-muted-foreground">
              Current key fingerprint <code>{result.primaryFingerprint}</code>
              {result.recoveryKeyFingerprints.length > 0 && (
                <>
                  {" · candidate keys "}
                  {result.recoveryKeyFingerprints
                    .map((k) => `${k.fingerprint} (${k.shape})`)
                    .join(", ")}
                </>
              )}
            </div>

            {result.keysUsed.length > 0 && (
              <ul className="text-xs space-y-0.5">
                {result.keysUsed.map((k) => (
                  <li key={`${k.source}:${k.fingerprint}`}>
                    <span className="font-medium">{k.source}</span> key{" "}
                    <code>{k.fingerprint}</code> opened {k.rows} row(s)
                  </li>
                ))}
              </ul>
            )}

            {result.errors.length > 0 && (
              <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3">
                <div className="flex items-center gap-2 text-destructive text-sm font-medium mb-1">
                  <AlertTriangle className="h-4 w-4" /> {result.errors.length} write error(s)
                </div>
                <ul className="text-xs font-mono max-h-32 overflow-auto space-y-0.5">
                  {result.errors.map((e, i) => (
                    <li key={i}>
                      <span className="text-muted-foreground">{e.id.slice(0, 8)}…</span>{" "}
                      {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.unrecoverable.length > 0 && (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ShieldAlert className="h-4 w-4" /> No available key can open these entries
                </div>
                <ul className="text-xs space-y-0.5 max-h-40 overflow-auto">
                  {result.unrecoverable.map((u) => (
                    <li key={u.id}>
                      <span className="font-medium">{u.title}</span>{" "}
                      <span className="text-muted-foreground">
                        ({u.scope}
                        {u.envKey ? ` · ${u.envKey}` : ""})
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Paste the key that was active when they were saved and rerun, or delete them
                  and re-enter the values.
                </p>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={purgeAll}
                  disabled={purging}
                >
                  {purging ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" /> Deleting…
                    </>
                  ) : (
                    "Delete unrecoverable entries"
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
