// Admin-only: enroll a YubiKey (FIDO2 hmac-secret) and use it to wrap the
// server's VAULT_ENCRYPTION_KEY for offline transport to a self-hosted
// Docker instance. See scripts/unwrap-vault-key/unwrap.html for the
// recipient-side step.

import { createFileRoute, Link } from "@tanstack/react-router";
import { requireAuthenticatedUser } from "@/lib/auth-route";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, KeyRound, ShieldCheck, Trash2, Usb } from "lucide-react";
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";

import { AppLayout } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrentProfile } from "@/hooks/use-current-profile";
import {
  startEnrollYubiKey,
  finishEnrollYubiKey,
  listEnrolledYubiKeys,
  deleteEnrolledYubiKey,
  startExportVaultKey,
  finishExportVaultKey,
  listExportAudit,
  type EnrolledYubiKey,
  type ExportAuditRow,
} from "@/lib/vault-key-export.functions";

export const Route = createFileRoute("/admin/export-key")({
  ssr: false,
  beforeLoad: requireAuthenticatedUser,
  head: () => ({ meta: [{ title: "Export encryption key — Bostead Farms" }] }),
  component: ExportKeyPage,
});

// ---- helpers -----------------------------------------------------------

function b64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "==".slice((b64url.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function deriveAesKeyFromHmacSecret(hmacSecret: ArrayBuffer): Promise<CryptoKey> {
  // The hmac-secret output is 32 bytes; import directly as AES-GCM key.
  return crypto.subtle.importKey("raw", hmacSecret, { name: "AES-GCM" }, false, ["encrypt"]);
}

function downloadBlob(filename: string, data: string, mime: string) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---- page --------------------------------------------------------------

function ExportKeyPage() {
  const profile = useCurrentProfile();
  const qc = useQueryClient();

  const listFn = useServerFn(listEnrolledYubiKeys);
  const startEnrollFn = useServerFn(startEnrollYubiKey);
  const finishEnrollFn = useServerFn(finishEnrollYubiKey);
  const deleteFn = useServerFn(deleteEnrolledYubiKey);
  const startExportFn = useServerFn(startExportVaultKey);
  const finishExportFn = useServerFn(finishExportVaultKey);
  const auditFn = useServerFn(listExportAudit);

  const credsQuery = useQuery<EnrolledYubiKey[]>({
    queryKey: ["vault-key-credentials"],
    queryFn: () => listFn(),
    enabled: profile.data?.isAdmin === true,
  });
  const auditQuery = useQuery<ExportAuditRow[]>({
    queryKey: ["vault-key-audit"],
    queryFn: () => auditFn(),
    enabled: profile.data?.isAdmin === true,
  });

  const [label, setLabel] = useState("");

  const enrollMut = useMutation({
    mutationFn: async () => {
      if (!browserSupportsWebAuthn()) {
        throw new Error("This browser does not support WebAuthn. Use a recent Chrome, Edge, or Safari.");
      }
      const trimmedLabel = label.trim() || "YubiKey";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const options: any = await startEnrollFn({ data: { label: trimmedLabel } });
      const attestation = await startRegistration({ optionsJSON: options });
      const ext = attestation.clientExtensionResults as { hmacCreateSecret?: boolean } | undefined;
      if (!ext?.hmacCreateSecret) {
        throw new Error(
          "Your authenticator did not grant the hmac-secret extension. A FIDO2 YubiKey (5 series or newer) is required."
        );
      }
      await finishEnrollFn({ data: { attestation, label: trimmedLabel } });
    },
    onSuccess: () => {
      toast.success("YubiKey enrolled.");
      setLabel("");
      qc.invalidateQueries({ queryKey: ["vault-key-credentials"] });
      qc.invalidateQueries({ queryKey: ["vault-key-audit"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Removed.");
      qc.invalidateQueries({ queryKey: ["vault-key-credentials"] });
      qc.invalidateQueries({ queryKey: ["vault-key-audit"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const exportMut = useMutation({
    mutationFn: async () => {
      if (!browserSupportsWebAuthn()) {
        throw new Error("This browser does not support WebAuthn.");
      }
      // 1. Get assertion options + the salt we'll use for hmac-secret.
      const start = await startExportFn();
      const saltBytes = b64urlToBytes(start.saltB64url);

      // 2. Run WebAuthn ceremony. Pass options through unchanged; the
      //    server already filled extensions.hmacGetSecret.salt1.
      const assertion = await startAuthentication({ optionsJSON: start.options });
      const ext = assertion.clientExtensionResults as
        | { hmacGetSecret?: { output1?: string } }
        | undefined;
      const output1B64 = ext?.hmacGetSecret?.output1;
      if (!output1B64) {
        throw new Error(
          "Your authenticator did not return an hmac-secret. A FIDO2 YubiKey (5 series or newer) is required."
        );
      }
      // simplewebauthn returns base64url
      const hmacSecret = b64urlToBytes(output1B64);
      if (hmacSecret.byteLength < 32) {
        throw new Error("hmac-secret output is too short.");
      }

      // 3. Verify server-side and receive raw VAULT_ENCRYPTION_KEY.
      const finish = await finishExportFn({ data: { assertion } });

      // 4. Encrypt locally with AES-GCM using the YubiKey-derived key.
      const wrappingKey = await deriveAesKeyFromHmacSecret(hmacSecret.buffer.slice(0, 32) as ArrayBuffer);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const plaintext = new TextEncoder().encode(finish.vaultKeyB64);
      const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrappingKey, plaintext)
      );

      const payload = {
        version: 1,
        kdf: "webauthn-hmac-secret",
        credentialId: assertion.id,
        salt: bytesToB64url(saltBytes),
        rpId: finish.rpId,
        iv: bytesToB64url(iv),
        ciphertext: bytesToB64url(ciphertext),
        keyFingerprint: finish.keyFingerprintB64,
        exportedAt: finish.exportedAt,
        exportedBy: finish.exportedBy,
        note: "Open scripts/unwrap-vault-key/unwrap.html on the recipient host and touch the same YubiKey.",
      };

      const stamp = finish.exportedAt.replace(/[:.]/g, "-");
      const fp = finish.keyFingerprintB64.replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
      downloadBlob(
        `vault-key-export-${fp}-${stamp}.json`,
        JSON.stringify(payload, null, 2),
        "application/json"
      );
    },
    onSuccess: () => {
      toast.success("Encryption key exported. Store the file securely.");
      qc.invalidateQueries({ queryKey: ["vault-key-credentials"] });
      qc.invalidateQueries({ queryKey: ["vault-key-audit"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (profile.data && !profile.data.isAdmin) {
    return (
      <AppLayout>
        <div className="p-8">
          <h1 className="text-2xl font-bold">Export encryption key</h1>
          <p className="text-muted-foreground mt-2">Admin role required.</p>
        </div>
      </AppLayout>
    );
  }

  const creds = credsQuery.data ?? [];
  const audit = auditQuery.data ?? [];

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl p-6 space-y-6">
        <header className="space-y-2">
          <div className="flex items-center gap-2">
            <KeyRound className="size-5" />
            <h1 className="text-2xl font-bold">Export encryption key</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            Wrap the server's <code className="font-mono">VAULT_ENCRYPTION_KEY</code> with a YubiKey
            so it can be re-seeded on a self-hosted Docker instance. The downloaded file is useless
            without the same physical YubiKey.
          </p>
          <div className="flex gap-3 text-sm">
            <Link to="/admin/restore" className="text-primary hover:underline">← Restore snapshot</Link>
            <Link to="/admin/export" className="text-primary hover:underline">Export snapshot →</Link>
          </div>
        </header>

        <Card className="border-amber-300 bg-amber-50/40 dark:bg-amber-950/20">
          <CardHeader className="flex flex-row items-start gap-3 space-y-0">
            <AlertTriangle className="size-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <CardTitle className="text-base">Read before exporting</CardTitle>
              <CardDescription className="space-y-1 mt-2 text-foreground/80">
                <p>• Anyone with this file <strong>and</strong> your YubiKey can recover the key.</p>
                <p>• Lose every enrolled YubiKey and the file is unrecoverable — enroll at least two.</p>
                <p>• Store the file in offline / secure storage. Do not commit it to git.</p>
                <p>• Requires a FIDO2 YubiKey (5 series or newer) and a recent Chrome / Edge / Safari.</p>
              </CardDescription>
            </div>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Usb className="size-4" /> Enrolled YubiKeys</CardTitle>
            <CardDescription>Each YubiKey can independently unwrap the exported key.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
              <div className="flex-1 space-y-1">
                <Label htmlFor="yk-label">Label for new YubiKey</Label>
                <Input
                  id="yk-label"
                  placeholder="e.g. Primary YubiKey 5C"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
              <Button
                onClick={() => enrollMut.mutate()}
                disabled={enrollMut.isPending}
              >
                {enrollMut.isPending ? "Touch your YubiKey…" : "Enroll YubiKey"}
              </Button>
            </div>

            {credsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : creds.length === 0 ? (
              <p className="text-sm text-muted-foreground">No YubiKeys enrolled yet.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {creds.map((c) => (
                  <li key={c.id} className="flex items-center justify-between p-3">
                    <div>
                      <div className="font-medium">{c.label}</div>
                      <div className="text-xs text-muted-foreground">
                        Enrolled {new Date(c.created_at).toLocaleString()}
                        {c.last_used_at && ` · Last used ${new Date(c.last_used_at).toLocaleString()}`}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm(`Remove "${c.label}"? You'll need to re-enroll to use it again.`)) {
                          deleteMut.mutate(c.id);
                        }
                      }}
                      disabled={deleteMut.isPending}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4" /> Export wrapped key</CardTitle>
            <CardDescription>
              Generates <code className="font-mono">vault-key-export-*.json</code>. Open
              <code className="font-mono"> scripts/unwrap-vault-key/unwrap.html</code> on the
              recipient host to decrypt it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => exportMut.mutate()}
              disabled={exportMut.isPending || creds.length === 0}
              size="lg"
            >
              {exportMut.isPending ? "Touch your YubiKey…" : "Export encryption key"}
            </Button>
            {creds.length === 0 && (
              <p className="text-xs text-muted-foreground mt-2">Enroll a YubiKey first.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {auditQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : audit.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {audit.map((a) => (
                  <li key={a.id} className="flex items-center gap-2">
                    <Badge variant={a.action.includes("failed") ? "destructive" : "secondary"}>
                      {a.action}
                    </Badge>
                    <span className="text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
                    {a.detail && <span className="text-xs text-muted-foreground truncate">— {a.detail}</span>}
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
