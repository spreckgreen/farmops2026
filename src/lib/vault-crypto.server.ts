// Server-only AES-256-GCM helpers for the secrets vault.
// Key is provided by the VAULT_ENCRYPTION_KEY env var (64 hex chars = 32 bytes).
import {
  cryptoProvider,
  b64encode,
  b64decode,
  utf8encode,
  utf8decode,
  type SealedBlob,
} from "./crypto-provider.server";

export type { SealedBlob };

async function getKey(): Promise<Uint8Array> {
  const raw = process.env.VAULT_ENCRYPTION_KEY;
  if (!raw) throw new Error("VAULT_ENCRYPTION_KEY is not configured");
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = parseInt(raw.substr(i * 2, 2), 16);
    return out;
  }
  // Fallback: derive 32 bytes via SHA-256.
  return cryptoProvider.sha256(utf8encode(raw));
}

export async function seal(plaintext: string): Promise<SealedBlob> {
  const key = await getKey();
  const iv = cryptoProvider.randomBytes(12);
  const { ciphertext, tag } = await cryptoProvider.aesGcmEncrypt(
    key,
    iv,
    utf8encode(plaintext),
  );
  return {
    ciphertext: b64encode(ciphertext),
    iv: b64encode(iv),
    tag: b64encode(tag),
  };
}

export async function open(blob: SealedBlob): Promise<string> {
  const key = await getKey();
  const pt = await cryptoProvider.aesGcmDecrypt(
    key,
    b64decode(blob.iv),
    b64decode(blob.ciphertext),
    b64decode(blob.tag),
  );
  return utf8decode(pt);
}
