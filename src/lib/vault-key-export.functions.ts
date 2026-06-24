// Admin-only YubiKey-protected export of VAULT_ENCRYPTION_KEY.
//
// Flow:
//   1. Admin enrolls a YubiKey via WebAuthn (hmac-secret enabled).
//   2. To export: server returns assertion options; browser touches YubiKey
//      and gets back an hmac-secret output used as an AES-GCM wrapping key.
//   3. Server verifies the assertion and returns the raw VAULT_ENCRYPTION_KEY
//      over TLS. Browser immediately encrypts it locally with the wrapping
//      key, builds the export JSON, and triggers a download.
//
// The downloaded file is useless without the physical YubiKey.

import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requireAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(`Role check failed: ${error.message}`);
  if (!data) throw new Error("Forbidden: admin role required");
}

function getRpInfo() {
  // Prefer explicit env, fall back to request Origin header.
  const origin =
    process.env.WEBAUTHN_ORIGIN ||
    getRequestHeader("origin") ||
    getRequestHeader("referer") ||
    "";
  if (!origin) throw new Error("Unable to determine origin for WebAuthn");
  const url = new URL(origin);
  return {
    rpID: process.env.WEBAUTHN_RP_ID || url.hostname,
    rpName: "Bostead Farms",
    origin: `${url.protocol}//${url.host}`,
  };
}

function bytesToB64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  // btoa is available in Workers + Node 20+
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "==".slice((b64url.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Supabase bytea round-trips as a hex string with leading "\x".
function byteaToBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") {
    const hex = value.startsWith("\\x") ? value.slice(2) : value;
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  throw new Error("Unsupported bytea value");
}

function bytesToHex(bytes: Uint8Array): string {
  let s = "\\x";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function audit(supabase: any, userId: string, fields: {
  credential_id?: Uint8Array | null;
  action: string;
  detail?: string;
}) {
  await supabase.from("vault_key_export_audit").insert({
    user_id: userId,
    credential_id: fields.credential_id ? bytesToHex(fields.credential_id) : null,
    action: fields.action,
    user_agent: getRequestHeader("user-agent") ?? null,
    ip: getRequestIP({ xForwardedFor: true }) ?? null,
    detail: fields.detail ?? null,
  });
}

// ---------- List / delete -----------------------------------------------

export type EnrolledYubiKey = {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  transports: string[];
};

export const listEnrolledYubiKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EnrolledYubiKey[]> => {
    const { supabase, userId } = context;
    await requireAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("vault_key_wrap_credentials")
      .select("id, label, created_at, last_used_at, transports")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as EnrolledYubiKey[];
  });

export const deleteEnrolledYubiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireAdmin(supabase, userId);
    const { error } = await supabase
      .from("vault_key_wrap_credentials")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    await audit(supabase, userId, { action: "delete", detail: `id=${data.id}` });
    return { ok: true };
  });

// ---------- Enrollment --------------------------------------------------

export const startEnrollYubiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { label: string }) => data)
  .handler(async ({ data, context }): Promise<PublicKeyCredentialCreationOptionsJSON> => {
    const { supabase, userId, claims } = context;
    await requireAdmin(supabase, userId);
    const { rpID, rpName } = getRpInfo();

    const existing = await supabase
      .from("vault_key_wrap_credentials")
      .select("credential_id, transports")
      .eq("user_id", userId);
    const excludeCredentials = (existing.data ?? []).map((row: { credential_id: unknown; transports: string[] }) => ({
      id: bytesToB64url(byteaToBytes(row.credential_id)),
      transports: row.transports as AuthenticatorTransport[],
    }));

    const email = (claims as { email?: string }).email ?? userId;
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: new TextEncoder().encode(userId),
      userName: email,
      userDisplayName: email,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
      extensions: { hmacCreateSecret: true } as Record<string, unknown>,
      excludeCredentials,
    });

    // Persist challenge
    await supabase
      .from("webauthn_challenges")
      .delete()
      .eq("user_id", userId)
      .eq("purpose", "enroll");
    await supabase.from("webauthn_challenges").insert({
      user_id: userId,
      purpose: "enroll",
      challenge: bytesToHex(b64urlToBytes(options.challenge)),
      expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
    });

    // Stash label in a transient row so finish can pick it up
    return { ...options, _label: data.label } as unknown as PublicKeyCredentialCreationOptionsJSON;
  });

export const finishEnrollYubiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { attestation: RegistrationResponseJSON; label: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requireAdmin(supabase, userId);
    const { rpID, origin } = getRpInfo();

    const ch = await supabase
      .from("webauthn_challenges")
      .select("challenge, expires_at")
      .eq("user_id", userId)
      .eq("purpose", "enroll")
      .maybeSingle();
    if (ch.error) throw new Error(ch.error.message);
    if (!ch.data) throw new Error("No pending enrollment challenge");
    if (new Date(ch.data.expires_at).getTime() < Date.now()) {
      throw new Error("Enrollment challenge expired");
    }

    const expectedChallenge = bytesToB64url(byteaToBytes(ch.data.challenge));

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: data.attestation,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: false,
      });
    } catch (err) {
      await audit(supabase, userId, { action: "enroll_failed", detail: String(err) });
      throw err;
    }

    if (!verification.verified || !verification.registrationInfo) {
      await audit(supabase, userId, { action: "enroll_failed", detail: "not verified" });
      throw new Error("Attestation did not verify");
    }

    // Confirm hmac-secret was actually granted
    const ext = data.attestation.clientExtensionResults as { hmacCreateSecret?: boolean } | undefined;
    if (!ext?.hmacCreateSecret) {
      await audit(supabase, userId, { action: "enroll_failed", detail: "hmac-secret not granted" });
      throw new Error(
        "This authenticator did not grant the hmac-secret extension. A FIDO2 YubiKey (5 series or newer) is required."
      );
    }

    const info = verification.registrationInfo;
    const cred = info.credential;
    const credentialIdBytes = typeof cred.id === "string" ? b64urlToBytes(cred.id) : new Uint8Array(cred.id as ArrayBuffer);
    const publicKeyBytes = cred.publicKey instanceof Uint8Array ? cred.publicKey : new Uint8Array(cred.publicKey as ArrayBuffer);
    const salt = crypto.getRandomValues(new Uint8Array(32));

    await supabase.from("vault_key_wrap_credentials").insert({
      user_id: userId,
      credential_id: bytesToHex(credentialIdBytes),
      public_key: bytesToHex(publicKeyBytes),
      sign_count: cred.counter ?? 0,
      salt: bytesToHex(salt),
      transports: (cred.transports ?? []) as string[],
      label: data.label || "YubiKey",
    });

    await supabase.from("webauthn_challenges").delete().eq("user_id", userId).eq("purpose", "enroll");
    await audit(supabase, userId, { credential_id: credentialIdBytes, action: "enroll" });

    return { ok: true };
  });

// ---------- Export ------------------------------------------------------

export type ExportStartResponse = {
  options: PublicKeyCredentialRequestOptionsJSON;
  saltB64url: string;
};

export const startExportVaultKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ExportStartResponse> => {
    const { supabase, userId } = context;
    await requireAdmin(supabase, userId);
    const { rpID } = getRpInfo();

    const creds = await supabase
      .from("vault_key_wrap_credentials")
      .select("credential_id, salt, transports")
      .eq("user_id", userId);
    if (creds.error) throw new Error(creds.error.message);
    if (!creds.data || creds.data.length === 0) {
      throw new Error("No YubiKey enrolled. Enroll one first.");
    }

    // All enrolled credentials share the same hmac salt for this export.
    // We use the salt from the first credential; if there are multiple, all
    // were enrolled with their own salts. We pick the most recent and only
    // allow assertion from the matching credential.
    const newest = creds.data[0];
    const saltBytes = byteaToBytes(newest.salt);
    const credIdBytes = byteaToBytes(newest.credential_id);

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "preferred",
      allowCredentials: [
        {
          id: bytesToB64url(credIdBytes),
          transports: (newest.transports ?? []) as AuthenticatorTransport[],
        },
      ],
      extensions: { hmacGetSecret: { salt1: saltBytes } } as Record<string, unknown>,
    });

    await supabase.from("webauthn_challenges").delete().eq("user_id", userId).eq("purpose", "export");
    await supabase.from("webauthn_challenges").insert({
      user_id: userId,
      purpose: "export",
      challenge: bytesToHex(b64urlToBytes(options.challenge)),
      expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
    });

    await audit(supabase, userId, { credential_id: credIdBytes, action: "export_started" });

    return { options, saltB64url: bytesToB64url(saltBytes) };
  });

export type ExportFinishResponse = {
  vaultKeyB64: string;
  keyFingerprintB64: string;
  rpId: string;
  exportedAt: string;
  exportedBy: string;
};

export const finishExportVaultKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { assertion: AuthenticationResponseJSON }) => data)
  .handler(async ({ data, context }): Promise<ExportFinishResponse> => {
    const { supabase, userId, claims } = context;
    await requireAdmin(supabase, userId);
    const { rpID, origin } = getRpInfo();

    const ch = await supabase
      .from("webauthn_challenges")
      .select("challenge, expires_at")
      .eq("user_id", userId)
      .eq("purpose", "export")
      .maybeSingle();
    if (ch.error) throw new Error(ch.error.message);
    if (!ch.data) throw new Error("No pending export challenge");
    if (new Date(ch.data.expires_at).getTime() < Date.now()) {
      throw new Error("Export challenge expired");
    }
    const expectedChallenge = bytesToB64url(byteaToBytes(ch.data.challenge));

    const credentialIdBytes = b64urlToBytes(data.assertion.id);
    const stored = await supabase
      .from("vault_key_wrap_credentials")
      .select("id, public_key, sign_count, transports")
      .eq("user_id", userId)
      .eq("credential_id", bytesToHex(credentialIdBytes))
      .maybeSingle();
    if (stored.error) throw new Error(stored.error.message);
    if (!stored.data) {
      await audit(supabase, userId, { credential_id: credentialIdBytes, action: "export_failed", detail: "unknown credential" });
      throw new Error("Unknown credential");
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: data.assertion,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: bytesToB64url(credentialIdBytes),
          publicKey: byteaToBytes(stored.data.public_key),
          counter: Number(stored.data.sign_count ?? 0),
          transports: (stored.data.transports ?? []) as AuthenticatorTransport[],
        },
        requireUserVerification: false,
      });
    } catch (err) {
      await audit(supabase, userId, { credential_id: credentialIdBytes, action: "export_failed", detail: String(err) });
      throw err;
    }

    if (!verification.verified) {
      await audit(supabase, userId, { credential_id: credentialIdBytes, action: "export_failed", detail: "not verified" });
      throw new Error("Assertion did not verify");
    }

    // Update sign count + last used
    await supabase
      .from("vault_key_wrap_credentials")
      .update({
        sign_count: verification.authenticationInfo.newCounter,
        last_used_at: new Date().toISOString(),
      })
      .eq("id", stored.data.id);

    await supabase.from("webauthn_challenges").delete().eq("user_id", userId).eq("purpose", "export");

    // Load + return the raw vault key
    const raw = process.env.VAULT_ENCRYPTION_KEY;
    if (!raw) throw new Error("VAULT_ENCRYPTION_KEY is not configured on the server");

    // Normalize: hex (32 bytes) or arbitrary string -> 32 bytes via SHA-256 (matches vault-crypto.server.ts)
    let keyBytes: Uint8Array;
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      keyBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) keyBytes[i] = parseInt(raw.substr(i * 2, 2), 16);
    } else {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
      keyBytes = new Uint8Array(digest);
    }

    const fingerprint = new Uint8Array(await crypto.subtle.digest("SHA-256", keyBytes));

    await audit(supabase, userId, { credential_id: credentialIdBytes, action: "export_completed" });

    // Return the actual env-var string (not the derived bytes) so the unwrap
    // step produces the exact value the operator needs to paste into Docker.
    const vaultKeyB64 = btoa(raw);

    return {
      vaultKeyB64,
      keyFingerprintB64: bytesToB64url(fingerprint),
      rpId: rpID,
      exportedAt: new Date().toISOString(),
      exportedBy: (claims as { email?: string }).email ?? userId,
    };
  });

// ---------- Recent audit ------------------------------------------------

export type ExportAuditRow = {
  id: string;
  action: string;
  detail: string | null;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
};

export const listExportAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ExportAuditRow[]> => {
    const { supabase, userId } = context;
    await requireAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("vault_key_export_audit")
      .select("id, action, detail, user_agent, ip, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return (data ?? []) as ExportAuditRow[];
  });
