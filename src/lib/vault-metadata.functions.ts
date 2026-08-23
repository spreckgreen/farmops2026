// Admin-only metadata view over the encrypted vault.
//
// Returns ONLY metadata about each sealed row — never plaintext, never
// ciphertext. For each row we probe which loaded key can open it (primary /
// old / neither) so the operator can spot rows that are drifting onto a stale
// key, plus sizes, key_version and timestamps.
//
// It also exposes a "regenerate" action that mints a fresh cryptographically
// random value for a row and re-seals it with the current key. The new value is
// never returned to the browser; only a short SHA-256 fingerprint is, so the
// operator can confirm the value actually changed.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireVaultAdmin, computeCurrentKeyVersion } from "./vault-recovery.server";

export type SealState = "current" | "old-key" | "unreadable";

export interface VaultSecretMetadata {
  id: string;
  title: string;
  scope: string;
  envKey: string | null;
  keyVersion: number | null;
  hasNotes: boolean;
  /** Approximate size in bytes of the sealed value (base64 ciphertext decoded). */
  valueBytes: number;
  /** Length of the decrypted value in characters — a size hint, not the value. */
  valueLength: number | null;
  /** Short SHA-256 prefix of the plaintext, so changes are verifiable without reveal. */
  valueFingerprint: string | null;
  sealState: SealState;
  createdAt: string;
  updatedAt: string;
}

export interface VaultMetadataReport {
  keyConfigured: boolean;
  primaryFingerprint: string | null;
  oldFingerprint: string | null;
  targetKeyVersion: number | null;
  counts: { total: number; current: number; onOldKey: number; unreadable: number };
  items: VaultSecretMetadata[];
}

function b64Bytes(s: string | null | undefined): number {
  if (!s) return 0;
  const clean = s.replace(/=+$/, "");
  return Math.floor((clean.length * 3) / 4);
}

export const getVaultSecretMetadata = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<VaultMetadataReport> => {
    await requireVaultAdmin(context.supabase, context.userId);

    if (!process.env.VAULT_ENCRYPTION_KEY) {
      return {
        keyConfigured: false,
        primaryFingerprint: null,
        oldFingerprint: null,
        targetKeyVersion: null,
        counts: { total: 0, current: 0, onOldKey: 0, unreadable: 0 },
        items: [],
      };
    }

    const { getKeyFingerprints, tryOpenIdentify } = await import("./vault-crypto.server");
    const { cryptoProvider, utf8encode } = await import("./crypto-provider.server");
    const fp = await getKeyFingerprints();
    const targetKeyVersion = await computeCurrentKeyVersion();

    const { data: rows, error } = await context.supabase
      .from("vault_secrets")
      .select(
        "id, title, scope, env_key, key_version, created_at, updated_at, value_ciphertext, value_iv, value_tag, notes_ciphertext",
      )
      .order("title", { ascending: true });
    if (error) throw new Error(error.message);

    const items: VaultSecretMetadata[] = [];
    const counts = { total: 0, current: 0, onOldKey: 0, unreadable: 0 };

    for (const raw of rows ?? []) {
      const r = raw as {
        id: string;
        title: string;
        scope: string;
        env_key: string | null;
        key_version: number | null;
        created_at: string;
        updated_at: string;
        value_ciphertext: string;
        value_iv: string;
        value_tag: string;
        notes_ciphertext: string | null;
      };

      const opened = await tryOpenIdentify({
        ciphertext: r.value_ciphertext,
        iv: r.value_iv,
        tag: r.value_tag,
      });

      const sealState: SealState =
        opened == null ? "unreadable" : opened.source === "primary" ? "current" : "old-key";
      counts.total++;
      if (sealState === "current") counts.current++;
      else if (sealState === "old-key") counts.onOldKey++;
      else counts.unreadable++;

      let valueFingerprint: string | null = null;
      if (opened) {
        const digest = await cryptoProvider.sha256(utf8encode(opened.plaintext));
        valueFingerprint = Array.from(digest.slice(0, 4))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      }

      items.push({
        id: r.id,
        title: r.title,
        scope: r.scope,
        envKey: r.env_key ?? null,
        keyVersion: r.key_version ?? null,
        hasNotes: Boolean(r.notes_ciphertext),
        valueBytes: b64Bytes(r.value_ciphertext),
        valueLength: opened ? opened.plaintext.length : null,
        valueFingerprint,
        sealState,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      });
    }

    return {
      keyConfigured: true,
      primaryFingerprint: fp.primary,
      oldFingerprint: fp.old,
      targetKeyVersion,
      counts,
      items,
    };
  });

export type RegenerateFormat = "hex" | "base64url" | "alphanumeric";

export interface RegenerateResult {
  id: string;
  title: string;
  /** Short SHA-256 prefix of the NEW value — proves it changed, reveals nothing. */
  newValueFingerprint: string;
  newValueLength: number;
  format: RegenerateFormat;
  envKey: string | null;
  /** True when the runtime env override cache was invalidated for envKey. */
  envCacheInvalidated: boolean;
}

const ALPHANUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

function mintValue(format: RegenerateFormat, byteLength: number): string {
  const bytes = randomBytes(byteLength);
  if (format === "hex") {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  if (format === "base64url") {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  // alphanumeric: rejection-free modulo bias is acceptable here given 62 vs 256,
  // so draw extra bytes and index with a uniform rejection loop instead.
  let out = "";
  while (out.length < byteLength) {
    for (const b of randomBytes(byteLength)) {
      if (b >= 248) continue; // 248 = 4 * 62, keeps the mapping uniform
      out += ALPHANUM[b % 62];
      if (out.length >= byteLength) break;
    }
  }
  return out;
}

/**
 * Mint a brand-new random value for an existing vault row and re-seal it with
 * the current VAULT_ENCRYPTION_KEY. The plaintext never leaves the server.
 * Notes are preserved (re-sealed with the current key when readable).
 */
export const regenerateVaultSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; format?: RegenerateFormat; byteLength?: number; confirm: boolean }) => {
    if (!d?.confirm) throw new Error("Confirmation required before regenerating a secret value");
    const id = String(d?.id ?? "");
    if (!id) throw new Error("id is required");
    const format: RegenerateFormat =
      d.format === "base64url" || d.format === "alphanumeric" ? d.format : "hex";
    const byteLength = Math.max(16, Math.min(128, Number(d.byteLength ?? 32)));
    return { id, format, byteLength, confirm: true };
  })
  .handler(async ({ context, data }): Promise<RegenerateResult> => {
    await requireVaultAdmin(context.supabase, context.userId);
    if (!process.env.VAULT_ENCRYPTION_KEY) {
      throw new Error(
        "VAULT_ENCRYPTION_KEY is not set on the server, so a new value cannot be sealed. " +
          "Set it (64 hex chars, e.g. `openssl rand -hex 32`) and restart the app first.",
      );
    }

    const { seal, tryOpenIdentify } = await import("./vault-crypto.server");
    const { cryptoProvider, utf8encode } = await import("./crypto-provider.server");

    const { data: row, error } = await context.supabase
      .from("vault_secrets")
      .select("id, title, env_key, notes_ciphertext, notes_iv, notes_tag")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);

    const newValue = mintValue(data.format, data.byteLength);
    const v = await seal(newValue);

    const update: {
      value_ciphertext: string;
      value_iv: string;
      value_tag: string;
      key_version: number;
      notes_ciphertext?: string;
      notes_iv?: string;
      notes_tag?: string;
    } = {
      value_ciphertext: v.ciphertext,
      value_iv: v.iv,
      value_tag: v.tag,
      key_version: await computeCurrentKeyVersion(),
    };

    // Keep notes intact, re-sealed with the current key when we can read them.
    const nc = row.notes_ciphertext as string | null;
    const ni = row.notes_iv as string | null;
    const nt = row.notes_tag as string | null;
    if (nc && ni && nt) {
      const openedNotes = await tryOpenIdentify({ ciphertext: nc, iv: ni, tag: nt });
      if (openedNotes) {
        const n = await seal(openedNotes.plaintext);
        update.notes_ciphertext = n.ciphertext;
        update.notes_iv = n.iv;
        update.notes_tag = n.tag;
      }
    }

    const { error: upErr } = await context.supabase
      .from("vault_secrets")
      .update(update)
      .eq("id", data.id);
    if (upErr) throw new Error(upErr.message);

    const envKey = (row.env_key as string | null) ?? null;
    let envCacheInvalidated = false;
    if (envKey) {
      const { invalidateServerEnv } = await import("./server-env.server");
      invalidateServerEnv(envKey);
      envCacheInvalidated = true;
    }

    const digest = await cryptoProvider.sha256(utf8encode(newValue));
    const newValueFingerprint = Array.from(digest.slice(0, 4))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return {
      id: row.id as string,
      title: row.title as string,
      newValueFingerprint,
      newValueLength: newValue.length,
      format: data.format,
      envKey,
      envCacheInvalidated,
    };
  });
