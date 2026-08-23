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
 *  Throws a clear message when neither key can decrypt the blob. */
export async function open(blob: SealedBlob): Promise<string> {
  const p = await loadPrimary();
  try {
    return await decryptWith(p.bytes, blob);
  } catch (primaryErr) {
    const o = await loadOld();
    if (!o) {
      throw new Error(
        "Vault entry could not be decrypted with VAULT_ENCRYPTION_KEY. " +
          "If you recently rotated the key, set VAULT_ENCRYPTION_KEY_OLD to the previous value and retry. " +
          `(cause: ${(primaryErr as Error).message})`,
      );
    }
    try {
      return await decryptWith(o.bytes, blob);
    } catch (oldErr) {
      throw new Error(
        "Vault entry could not be decrypted with either VAULT_ENCRYPTION_KEY or VAULT_ENCRYPTION_KEY_OLD. " +
          "The key(s) currently loaded do not match the one used to encrypt this entry.",
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
