// Peer token generator for one-way audit-batch pulls.
//
// A pull authenticates against the PEER deployment, so the credential must be
// registered there — not here. This module generates a candidate key locally,
// never stores it, and produces the exact registration statement to run on the
// self-hosted instance. Only the SHA-256 is ever registered; the plaintext is
// pasted into the pull field once and then discarded.

export const PEER_TOKEN_PREFIX = "farmops_sk_";
export const PEER_TOKEN_SCOPE = "electrical:audit-batches:read";
export const PEER_TOKEN_RE = /^farmops_sk_[0-9a-f]{48}$/;

/** Generate a well-formed candidate peer key (24 random bytes, hex-encoded). */
export function generatePeerToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `${PEER_TOKEN_PREFIX}${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** SHA-256 hex of a key — the only value that is ever stored on the peer. */
export async function peerTokenSha256(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function peerTokenPrefix(token: string): string {
  return token.slice(0, 18);
}

export function isPeerTokenShape(token: string): boolean {
  return PEER_TOKEN_RE.test(token.trim());
}

/** Mask a key for display: keep the prefix and the last four characters. */
export function maskPeerToken(token: string): string {
  const t = token.trim();
  if (t.length <= 22) return t;
  return `${t.slice(0, 18)}…${t.slice(-4)}`;
}

export interface PeerRegistration {
  /** Plaintext key — paste into the pull field, then discard. */
  token: string;
  /** Registration statement to run on the peer (self-hosted) instance. */
  sql: string;
  sha256: string;
  prefix: string;
  scope: string;
}

/**
 * Build the registration bundle for a generated key. `ownerUserId` is the peer
 * account that should own the principal; when unknown the statement keeps a
 * clearly marked placeholder rather than inventing an ID.
 */
export async function buildPeerRegistration(
  token: string,
  options: { name?: string; ownerUserId?: string | null } = {},
): Promise<PeerRegistration> {
  const sha256 = await peerTokenSha256(token);
  const prefix = peerTokenPrefix(token);
  const name = (options.name ?? "").trim() || "cloud audit-batch pull";
  const owner = (options.ownerUserId ?? "").trim() || "<peer owner user id>";
  const sql =
    `insert into public.electrical_api_principals\n` +
    `  (user_id, name, key_prefix, key_sha256, scopes, note)\n` +
    `values (\n` +
    `  '${owner}',\n` +
    `  '${name.replace(/'/g, "''")}',\n` +
    `  '${prefix}',\n` +
    `  '${sha256}',\n` +
    `  array['${PEER_TOKEN_SCOPE}'],\n` +
    `  'Read-only peer pull credential. Plaintext key is never stored.'\n` +
    `);`;
  return { token, sql, sha256, prefix, scope: PEER_TOKEN_SCOPE };
}
