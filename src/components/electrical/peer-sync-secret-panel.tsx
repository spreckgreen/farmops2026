// Administrator rotation of the scheduling credential used by the automatic,
// preview-only peer pull.
//
// The scheduled job looks up the current credential when it runs, so rotating
// here takes effect immediately with no schedule edit. A rotation may leave the
// previous credential usable for a short grace window so a run already in
// flight is not cut off; "Invalidate now" ends every older credential at once.
// Plaintext credentials are never shown or returned — only a fingerprint.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { PersistedSection } from "@/components/electrical/persisted-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listPeerSyncCronSecrets,
  revokeRetiringPeerSyncCronSecrets,
  rotatePeerSyncCronSecret,
} from "@/lib/electrical-peer-sync.functions";

const GRACE_DEFAULT = "15";

export function PeerSyncSecretPanel() {
  const read = useServerFn(listPeerSyncCronSecrets);
  const rotate = useServerFn(rotatePeerSyncCronSecret);
  const revoke = useServerFn(revokeRetiringPeerSyncCronSecrets);

  const [grace, setGrace] = useState(GRACE_DEFAULT);
  const [confirming, setConfirming] = useState(false);

  const secrets = useQuery({
    queryKey: ["electrical-peer-sync-cron-secrets"],
    queryFn: async () => await read({}),
  });

  const rotateMutation = useMutation({
    mutationFn: async () =>
      await rotate({ data: { grace_minutes: Math.min(1440, Number(grace) || 0) } }),
    onSuccess: (r) => {
      setConfirming(false);
      toast.success(
        r.retire_after
          ? `New key ${r.fingerprint} is live. The previous key stops working at ${new Date(r.retire_after).toLocaleTimeString()}.`
          : `New key ${r.fingerprint} is live and the previous key was invalidated straight away.`,
      );
      secrets.refetch();
    },
    onError: (e) => toast.error(String(e)),
  });

  const revokeMutation = useMutation({
    mutationFn: async () => await revoke({}),
    onSuccess: (r) => {
      toast.success(
        r.revoked > 0
          ? `${r.revoked} older key${r.revoked === 1 ? "" : "s"} invalidated.`
          : "There were no older keys left to invalidate.",
      );
      secrets.refetch();
    },
    onError: (e) => toast.error(String(e)),
  });

  const rows = secrets.data?.secrets ?? [];
  const active = rows.find((r) => r.status === "active") ?? null;
  const retiring = rows.filter((r) => r.status === "retiring");

  return (
    <PersistedSection
      storageKey="electrical.audit-batches.peer-sync-secret"
      title="Automatic pull key"
      badges={
        <>
          {active ? (
            <Badge variant="secondary">active {active.fingerprint}</Badge>
          ) : (
            <Badge variant="destructive">no active key</Badge>
          )}
          {retiring.length > 0 ? (
            <Badge variant="outline">{retiring.length} expiring</Badge>
          ) : null}
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          This key only lets the timer start a pull; it gives no access to records. Replacing it
          takes effect at once — the timer looks up the current key each time it runs. The full key
          is never shown here, only a short fingerprint so you can tell them apart.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs">
            Keep the old key working for
            <Input
              value={grace}
              onChange={(e) => setGrace(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
              className="h-8 w-16"
              inputMode="numeric"
            />
            minutes
          </label>
          {confirming ? (
            <>
              <Button
                size="sm"
                variant="destructive"
                disabled={rotateMutation.isPending}
                onClick={() => rotateMutation.mutate()}
              >
                Confirm replace key
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => setConfirming(true)}>
              Replace key
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={retiring.length === 0 || revokeMutation.isPending}
            onClick={() => revokeMutation.mutate()}
          >
            Invalidate older keys now
          </Button>
        </div>

        {Number(grace) === 0 ? (
          <p className="text-xs text-muted-foreground">
            With no overlap, a pull that is already running may fail once. That is safe: nothing is
            written by a pull, and the timer simply tries again.
          </p>
        ) : null}

        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-2 py-1">Fingerprint</th>
                <th className="px-2 py-1">State</th>
                <th className="px-2 py-1">Started</th>
                <th className="px-2 py-1">Stops working</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-2 py-2 text-muted-foreground" colSpan={4}>
                    {secrets.isLoading ? "Loading…" : "No keys recorded yet."}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-2 py-1 font-mono">{r.fingerprint}</td>
                    <td className="px-2 py-1">
                      {r.status === "active" ? (
                        <Badge variant="secondary">in use</Badge>
                      ) : r.status === "retiring" ? (
                        <Badge variant="outline">expiring</Badge>
                      ) : (
                        <Badge variant="outline">invalidated</Badge>
                      )}
                    </td>
                    <td className="px-2 py-1">{new Date(r.activated_at).toLocaleString()}</td>
                    <td className="px-2 py-1">
                      {r.revoked_at
                        ? new Date(r.revoked_at).toLocaleString()
                        : r.retire_after
                          ? new Date(r.retire_after).toLocaleString()
                          : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PersistedSection>
  );
}
