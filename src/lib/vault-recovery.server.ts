// Server-only helpers for the vault re-encryption / recovery workflow.
// Kept out of *.functions.ts so server-function splitting can't strip them.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function requireVaultAdmin(supabase: any, userId: string): Promise<void> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(`Role check failed: ${error.message}`);
  if (!data) throw new Error("Forbidden: admin role required");
}

/** Split a pasted blob of candidate keys into at most 10 trimmed candidates. */
export function parseRecoveryKeys(input: string | undefined): string[] {
  if (!input) return [];
  return input
    .split(/[\r\n,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
}

/** Deterministic key_version for the current primary key (mirrors the rotation tool). */
export async function computeCurrentKeyVersion(): Promise<number> {
  const { cryptoProvider, utf8encode } = await import("./crypto-provider.server");
  const raw = process.env.VAULT_ENCRYPTION_KEY;
  if (!raw) throw new Error("VAULT_ENCRYPTION_KEY is not configured");
  let bytes: Uint8Array;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) bytes[i] = parseInt(raw.substr(i * 2, 2), 16);
  } else {
    bytes = await cryptoProvider.sha256(utf8encode(raw));
  }
  const h = await cryptoProvider.sha256(bytes);
  const v = ((h[0] << 8) | h[1]) & 0x7fff;
  return v === 0 ? 1 : v;
}
