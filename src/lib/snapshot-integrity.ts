// Canonical JSON + SHA-256 helpers used by the backup/restore flow to
// detect accidental edits or partial downloads of a snapshot file.
//
// "Canonical" here means:
//   - object keys sorted alphabetically at every depth
//   - no whitespace (matches JSON.stringify(value) without spaces)
//   - arrays preserve order (row order matters for restore)
//   - undefined values dropped (matches JSON.stringify default)
//
// We then hash the resulting bytes with SHA-256 via the Web Crypto API,
// which is available in browsers, Node 20+, Bun, and the Workerd SSR
// runtime — so the same code runs on both sides of the wire.

export const INTEGRITY_ALGO = "sha-256" as const;

export type IntegrityEnvelope = {
  algo: typeof INTEGRITY_ALGO;
  /** Lowercase hex digest of `canonicalStringify(payload)`. */
  value: string;
  /**
   * Names of the top-level fields covered by the digest, in the order
   * passed to the canonical stringifier. Stored for forward-compat so a
   * future schema can extend what is hashed without silently changing
   * what an old verifier checks.
   */
  covered: string[];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function canonicalize(value: any): any {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value).sort()) {
    const v = (value as Record<string, unknown>)[k];
    if (v === undefined) continue;
    out[k] = canonicalize(v);
  }
  return out;
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Compute the digest for the subset of a snapshot that should remain
 * stable across export → download → upload → import.
 *
 * Pass an object whose keys are the field names you want covered; the
 * helper sorts them, canonicalizes the values, and returns an
 * IntegrityEnvelope ready to be embedded in the snapshot itself.
 */
export async function computeIntegrity(
  payload: Record<string, unknown>,
): Promise<IntegrityEnvelope> {
  const covered = Object.keys(payload).sort();
  const subset: Record<string, unknown> = {};
  for (const k of covered) subset[k] = payload[k];
  const value = await sha256Hex(canonicalStringify(subset));
  return { algo: INTEGRITY_ALGO, value, covered };
}

export async function verifyIntegrity(
  payload: Record<string, unknown>,
  integrity: IntegrityEnvelope,
): Promise<{ ok: true } | { ok: false; reason: string; expected: string; actual: string }> {
  if (integrity.algo !== INTEGRITY_ALGO) {
    return {
      ok: false,
      reason: `Unsupported checksum algorithm: ${integrity.algo}`,
      expected: integrity.value,
      actual: "",
    };
  }
  const subset: Record<string, unknown> = {};
  for (const k of integrity.covered) subset[k] = payload[k];
  const actual = await sha256Hex(canonicalStringify(subset));
  if (actual !== integrity.value) {
    return {
      ok: false,
      reason:
        "Checksum mismatch — the snapshot file has been modified or was not fully downloaded.",
      expected: integrity.value,
      actual,
    };
  }
  return { ok: true };
}
