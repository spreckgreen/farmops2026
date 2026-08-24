// Vault-backed env lookup. Looks for a Shared-scope vault_secrets row whose
// env_key matches the requested name; falls back to process.env. Cached for
// 60s per process. Server-only — never import from client code.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { open } from "./vault-crypto.server";

type CacheEntry = { value: string | undefined; expires: number };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

export async function getServerEnv(
  name: string,
  client?: SupabaseClient<Database>,
): Promise<string | undefined> {
  const now = Date.now();
  // Request-scoped authenticated clients must read the vault directly. A
  // previous service-client/RLS failure may have cached an undefined fallback;
  // reusing that entry would make a newly saved engine key look missing until
  // the TTL expires.
  if (!client) {
    const hit = cache.get(name);
    if (hit && hit.expires > now) return hit.value;
  }

  let value: string | undefined;
  try {
    const db = client ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;
    const { data: row, error } = await db
      .from("vault_secrets")
      .select("value_ciphertext, value_iv, value_tag")
      .eq("scope", "shared")
      .eq("env_key", name)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (row?.value_ciphertext && row?.value_iv && row?.value_tag) {
      value = await open({
        ciphertext: row.value_ciphertext as string,
        iv: row.value_iv as string,
        tag: row.value_tag as string,
      }, `shared env "${name}" (vault-backed)`);
    }
  } catch (e) {
    console.warn(
      `[server-env] vault lookup failed for ${name}: ${e instanceof Error ? e.message : String(e)}`,
    );

  }
  if (value === undefined) value = process.env[name];
  if (!client) cache.set(name, { value, expires: now + TTL_MS });
  return value;
}

export function invalidateServerEnv(name?: string): void {
  if (name) cache.delete(name);
  else cache.clear();
}
