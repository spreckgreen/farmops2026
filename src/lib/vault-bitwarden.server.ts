// Server-only helpers for the Bitwarden mirror.
//
// The bridge authenticates with a long random token that FarmOps only ever
// stores as a SHA-256 hash, plus a short fingerprint for display. The token
// itself is shown exactly once, when it is generated.
import { fingerprintPayload, type MirrorScope } from "./vault-bitwarden";

export async function sha256Hex(input: string): Promise<string> {
  const { cryptoProvider, utf8encode } = await import("./crypto-provider.server");
  const bytes = await cryptoProvider.sha256(utf8encode(input));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-256 of value+notes, used to detect "changed since the last run". */
export async function mirrorFingerprint(value: string, notes?: string | null): Promise<string> {
  return sha256Hex(fingerprintPayload(value, notes));
}

export async function hashBridgeToken(token: string): Promise<string> {
  return sha256Hex(`vault-bridge:${token}`);
}

export function tokenFingerprint(hash: string): string {
  return hash.slice(0, 8);
}

/** Constant-time-ish comparison of two equal-length hex digests. */
export function digestsMatch(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface BridgeConfigRow {
  id: string;
  owner_user_id: string;
  mirror_personal: boolean;
  mirror_shared: boolean;
  folder_name: string;
  bw_folder_id: string | null;
  paused: boolean;
  paused_reason: string | null;
  bridge_token_hash: string | null;
  bridge_token_fingerprint: string | null;
}

/**
 * Resolve the bridge token presented on a request to its owner's config row.
 * Returns null when the token is missing, unknown, or mirroring is paused.
 */
export async function authorizeBridge(
  request: Request,
): Promise<
  | { ok: true; config: BridgeConfigRow; admin: Awaited<ReturnType<typeof adminClient>> }
  | { ok: false; status: number; message: string }
> {
  const provided =
    request.headers.get("x-vault-bridge-token") ??
    (request.headers.get("authorization") ?? "").replace(/^Bearer /i, "");
  if (!provided || provided.length < 20) {
    return { ok: false, status: 401, message: "Missing bridge token" };
  }

  const admin = await adminClient();
  const hash = await hashBridgeToken(provided.trim());

  const { data, error } = await admin
    .from("vault_bitwarden_config")
    .select(
      "id, owner_user_id, mirror_personal, mirror_shared, folder_name, bw_folder_id, paused, paused_reason, bridge_token_hash, bridge_token_fingerprint",
    )
    .eq("bridge_token_hash", hash)
    .maybeSingle();

  if (error) {
    console.error(`[vault-bridge] token lookup failed: ${error.message}`);
    return { ok: false, status: 500, message: "Bridge token lookup failed" };
  }
  const config = data as unknown as BridgeConfigRow | null;
  if (!config?.bridge_token_hash || !digestsMatch(config.bridge_token_hash, hash)) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }
  if (config.paused) {
    return { ok: false, status: 423, message: config.paused_reason || "Mirroring is paused" };
  }

  await admin
    .from("vault_bitwarden_config")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", config.id);

  return { ok: true, config, admin };
}

export async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export function scopesFor(config: BridgeConfigRow): MirrorScope[] {
  const scopes: MirrorScope[] = [];
  if (config.mirror_personal) scopes.push("personal");
  if (config.mirror_shared) scopes.push("shared");
  return scopes;
}

export interface DecryptedVaultRow {
  id: string;
  scope: MirrorScope;
  title: string;
  env_key: string | null;
  value: string | null;
  notes: string | null;
  fingerprint: string | null;
  updated_at: string;
}

/**
 * Read the mirrorable vault rows for one owner and decrypt them. Rows that no
 * key can open come back with `value: null` and `fingerprint: null` — they are
 * reported as "cannot read", never silently skipped and never overwritten.
 */
export async function loadMirrorableRows(
  ownerUserId: string,
  scopes: MirrorScope[],
): Promise<DecryptedVaultRow[]> {
  if (scopes.length === 0) return [];
  const admin = await adminClient();
  const { open } = await import("./vault-crypto.server");

  const { data, error } = await admin
    .from("vault_secrets")
    .select(
      "id, scope, title, env_key, owner_user_id, updated_at, value_ciphertext, value_iv, value_tag, notes_ciphertext, notes_iv, notes_tag",
    )
    .in("scope", scopes);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<Record<string, string | null>>;
  const out: DecryptedVaultRow[] = [];

  for (const row of rows) {
    const scope = (row["scope"] ?? "personal") as MirrorScope;
    // Personal entries belong to their owner only; shared entries are shared.
    if (scope === "personal" && row["owner_user_id"] !== ownerUserId) continue;

    let value: string | null = null;
    let notes: string | null = null;
    try {
      value = await open({
        ciphertext: row["value_ciphertext"] as string,
        iv: row["value_iv"] as string,
        tag: row["value_tag"] as string,
      });
      if (row["notes_ciphertext"] && row["notes_iv"] && row["notes_tag"]) {
        notes = await open({
          ciphertext: row["notes_ciphertext"] as string,
          iv: row["notes_iv"] as string,
          tag: row["notes_tag"] as string,
        });
      }
    } catch {
      value = null;
      notes = null;
    }

    out.push({
      id: row["id"] as string,
      scope,
      title: (row["title"] as string) ?? "Untitled",
      env_key: (row["env_key"] as string | null) ?? null,
      value,
      notes,
      fingerprint: value === null ? null : await mirrorFingerprint(value, notes),
      updated_at: (row["updated_at"] as string) ?? new Date().toISOString(),
    });
  }

  return out;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
