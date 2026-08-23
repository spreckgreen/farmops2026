// Server-only AES-256-GCM helpers for the secrets vault.
//
// Two keys can be loaded at once to support zero-downtime rotation:
//   - VAULT_ENCRYPTION_KEY      (primary — used for all new encryption)
//   - VAULT_ENCRYPTION_KEY_OLD  (fallback — only used for decryption while
//                                a rotation is being rolled through the data)
//
// `seal()` always uses the primary key. `open()` tries the primary first and
// falls back to the old key. The rotation admin tool re-seals rows with the
// primary key, so once every row has been re-encrypted the OLD var can be
// removed. See src/routes/admin.vault-rotation.tsx.
import {
  cryptoProvider,
  b64encode,
  b64decode,
  utf8encode,
  utf8decode,
  type SealedBlob,
} from "./crypto-provider.server";

export type { SealedBlob };

type ResolvedKey = { bytes: Uint8Array; raw: string };

/** Human-readable shape of a key var, e.g. "64-hex (32 bytes)" or
 *  "passphrase, 18 chars (SHA-256 derived)". Never includes the value. */
function describeKeyShape(raw: string): string {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return "64-hex (32 bytes)";
  return `passphrase, ${raw.length} chars (SHA-256 derived)`;
}

async function deriveKeyBytes(raw: string): Promise<Uint8Array> {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = parseInt(raw.substr(i * 2, 2), 16);
    return out;
  }
  // Fallback: derive 32 bytes via SHA-256 (matches historical behavior).
  return cryptoProvider.sha256(utf8encode(raw));
}

async function loadPrimary(): Promise<ResolvedKey> {
  const raw = process.env.VAULT_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "VAULT_ENCRYPTION_KEY is not set on the server. Set it to 64 hex characters " +
        "(e.g. `openssl rand -hex 32`) and restart the app.",
    );
  }
  if (raw.trim() !== raw) {
    throw new Error(
      "VAULT_ENCRYPTION_KEY has leading/trailing whitespace — quote it in .env " +
        '(VAULT_ENCRYPTION_KEY="abc…") or remove the stray spaces/newline.',
    );
  }
  return { bytes: await deriveKeyBytes(raw), raw };
}

async function loadOld(): Promise<ResolvedKey | null> {
  const raw = process.env.VAULT_ENCRYPTION_KEY_OLD;
  if (!raw) return null;
  return { bytes: await deriveKeyBytes(raw.trim()), raw: raw.trim() };
}


/** 8-char hex prefix of SHA-256(key bytes). Safe to display; not reversible. */
export async function fingerprintKey(bytes: Uint8Array): Promise<string> {
  const h = await cryptoProvider.sha256(bytes);
  let out = "";
  for (let i = 0; i < 4; i++) out += h[i].toString(16).padStart(2, "0");
  return out;
}

/** Returns primary + optional old fingerprints for status/UI use only. */
export async function getKeyFingerprints(): Promise<{
  primary: string;
  old: string | null;
}> {
  const p = await loadPrimary();
  const o = await loadOld();
  return {
    primary: await fingerprintKey(p.bytes),
    old: o ? await fingerprintKey(o.bytes) : null,
  };
}

async function encryptWith(key: Uint8Array, plaintext: string): Promise<SealedBlob> {
  const iv = cryptoProvider.randomBytes(12);
  const { ciphertext, tag } = await cryptoProvider.aesGcmEncrypt(
    key,
    iv,
    utf8encode(plaintext),
  );
  return { ciphertext: b64encode(ciphertext), iv: b64encode(iv), tag: b64encode(tag) };
}

async function decryptWith(key: Uint8Array, blob: SealedBlob): Promise<string> {
  const pt = await cryptoProvider.aesGcmDecrypt(
    key,
    b64decode(blob.iv),
    b64decode(blob.ciphertext),
    b64decode(blob.tag),
  );
  return utf8decode(pt);
}

/** Encrypt with the CURRENT primary key. */
export async function seal(plaintext: string): Promise<SealedBlob> {
  const p = await loadPrimary();
  return encryptWith(p.bytes, plaintext);
}

/** Decrypt using primary; on failure, fall back to VAULT_ENCRYPTION_KEY_OLD if set.
 *  Throws a message that names exactly which key var failed, its shape and
 *  fingerprint, and what to do next. `label` identifies the entry, e.g.
 *  `open(blob, 'shared env CUSTOM_AI_API_KEY')`. */
export async function open(blob: SealedBlob, label = "vault entry"): Promise<string> {
  const p = await loadPrimary();
  try {
    return await decryptWith(p.bytes, blob);
  } catch (primaryErr) {
    const primaryFp = await fingerprintKey(p.bytes);
    const primaryDesc = `VAULT_ENCRYPTION_KEY [fingerprint ${primaryFp}, ${describeKeyShape(p.raw)}]`;
    const o = await loadOld();
    if (!o) {
      throw new Error(
        `Could not decrypt ${label}: ${primaryDesc} is not the key this entry was encrypted with. ` +
          "VAULT_ENCRYPTION_KEY_OLD is not set, so there was no second key to try. " +
          "If you rotated the key, set VAULT_ENCRYPTION_KEY_OLD to the previous value and retry; " +
          "otherwise restore the original VAULT_ENCRYPTION_KEY. " +
          `(cause: ${(primaryErr as Error).message})`,
      );
    }
    const oldFp = await fingerprintKey(o.bytes);
    const oldDesc = `VAULT_ENCRYPTION_KEY_OLD [fingerprint ${oldFp}, ${describeKeyShape(o.raw)}]`;
    try {
      return await decryptWith(o.bytes, blob);
    } catch {
      const same = primaryFp === oldFp;
      throw new Error(
        `Could not decrypt ${label}: neither loaded key matches this entry. ` +
          `Tried ${primaryDesc} then ${oldDesc}. ` +
          (same
            ? "Both vars derive to the SAME key — VAULT_ENCRYPTION_KEY_OLD is a duplicate, so set it to the genuinely previous key. "
            : "Both keys are valid but wrong for this entry. ") +
          "Compare these fingerprints with the one shown on /admin/vault-rotation, or restore the key that was active when this entry was saved.",
      );
    }
  }
}


/** Which loaded key opened this blob, or null if neither can. Never throws. */
export async function tryOpenIdentify(
  blob: SealedBlob,
): Promise<{ plaintext: string; source: "primary" | "old" } | null> {
  const p = await loadPrimary();
  try {
    return { plaintext: await decryptWith(p.bytes, blob), source: "primary" };
  } catch {
    /* fall through */
  }
  const o = await loadOld();
  if (!o) return null;
  try {
    return { plaintext: await decryptWith(o.bytes, blob), source: "old" };
  } catch {
    return null;
  }
}

/** Same as tryOpenIdentify, but also tries operator-supplied recovery keys
 *  (raw 64-hex strings or passphrases) that are held in memory only and never
 *  written anywhere. Used by the recovery re-encrypt workflow so a stale key
 *  can be drained without editing .env or redeploying. Never throws. */
export async function tryOpenWithRecoveryKeys(
  blob: SealedBlob,
  recoveryKeysRaw: string[],
): Promise<{ plaintext: string; source: "primary" | "old" | "recovery"; fingerprint: string } | null> {
  const loaded = await tryOpenIdentify(blob);
  if (loaded) {
    const key = loaded.source === "primary" ? await loadPrimary() : await loadOld();
    return {
      ...loaded,
      fingerprint: key ? await fingerprintKey(key.bytes) : "unknown",
    };
  }
  for (const raw of recoveryKeysRaw) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const bytes = await deriveKeyBytes(trimmed);
    try {
      return {
        plaintext: await decryptWith(bytes, blob),
        source: "recovery",
        fingerprint: await fingerprintKey(bytes),
      };
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

/** Fingerprints for operator-supplied recovery keys, so the UI can show which
 *  candidate keys were loaded without ever echoing their values. */
export async function fingerprintRecoveryKeys(
  recoveryKeysRaw: string[],
): Promise<Array<{ fingerprint: string; shape: string }>> {
  const out: Array<{ fingerprint: string; shape: string }> = [];
  for (const raw of recoveryKeysRaw) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const bytes = await deriveKeyBytes(trimmed);
    out.push({ fingerprint: await fingerprintKey(bytes), shape: describeKeyShape(trimmed) });
  }
  return out;
}

