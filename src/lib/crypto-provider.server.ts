// Crypto provider wrapper. Uses ESM imports only — no `require` — so it works
// in both Node ESM and the server-function Worker runtime (which has
// nodejs_compat for `node:crypto`). If `node:crypto` isn't available, falls
// back to the Web Crypto API (`globalThis.crypto.subtle`).
//
// Consumers should import from this module instead of `crypto` directly.

import * as nodeCrypto from "node:crypto";

export type SealedBlob = {
  ciphertext: string; // base64
  iv: string;         // base64 (12 bytes)
  tag: string;        // base64 (16 bytes)
};

type Provider = {
  randomBytes: (size: number) => Uint8Array;
  sha256: (data: Uint8Array) => Promise<Uint8Array>;
  aesGcmEncrypt: (
    key: Uint8Array,
    iv: Uint8Array,
    plaintext: Uint8Array,
  ) => Promise<{ ciphertext: Uint8Array; tag: Uint8Array }>;
  aesGcmDecrypt: (
    key: Uint8Array,
    iv: Uint8Array,
    ciphertext: Uint8Array,
    tag: Uint8Array,
  ) => Promise<Uint8Array>;
};

function hasNodeCrypto(): boolean {
  return (
    typeof (nodeCrypto as { createCipheriv?: unknown }).createCipheriv ===
    "function"
  );
}

const nodeProvider: Provider = {
  randomBytes: (size) => new Uint8Array(nodeCrypto.randomBytes(size)),
  sha256: async (data) =>
    new Uint8Array(nodeCrypto.createHash("sha256").update(data).digest()),
  aesGcmEncrypt: async (key, iv, plaintext) => {
    const cipher = nodeCrypto.createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { ciphertext: new Uint8Array(ct), tag: new Uint8Array(cipher.getAuthTag()) };
  },
  aesGcmDecrypt: async (key, iv, ciphertext, tag) => {
    const decipher = nodeCrypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return new Uint8Array(pt);
  },
};

const webProvider: Provider = {
  randomBytes: (size) => {
    const buf = new Uint8Array(size);
    globalThis.crypto.getRandomValues(buf);
    return buf;
  },
  sha256: async (data) =>
    new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", data as BufferSource)),
  aesGcmEncrypt: async (key, iv, plaintext) => {
    const ck = await globalThis.crypto.subtle.importKey(
      "raw",
      key as BufferSource,
      "AES-GCM",
      false,
      ["encrypt"],
    );
    const out = new Uint8Array(
      await globalThis.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv as BufferSource },
        ck,
        plaintext as BufferSource,
      ),
    );
    // WebCrypto appends the 16-byte tag to the ciphertext.
    return {
      ciphertext: out.slice(0, out.length - 16),
      tag: out.slice(out.length - 16),
    };
  },
  aesGcmDecrypt: async (key, iv, ciphertext, tag) => {
    const ck = await globalThis.crypto.subtle.importKey(
      "raw",
      key as BufferSource,
      "AES-GCM",
      false,
      ["decrypt"],
    );
    const joined = new Uint8Array(ciphertext.length + tag.length);
    joined.set(ciphertext, 0);
    joined.set(tag, ciphertext.length);
    return new Uint8Array(
      await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv as BufferSource },
        ck,
        joined as BufferSource,
      ),
    );
  },
};

export const cryptoProvider: Provider = hasNodeCrypto() ? nodeProvider : webProvider;

// Convenience codecs (no `Buffer` dependency for callers).
export function b64encode(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function b64decode(s: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "base64"));
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function utf8encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function utf8decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
