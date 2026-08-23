// Vault-backed env lookup. Looks for a Shared-scope vault_secrets row whose
// env_key matches the requested name; falls back to process.env. Cached for
// 60s per process. Server-only — never import from client code.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { open } from "./vault-crypto.server";

type CacheEntry = { value: string | undefined; expires: number };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

export async function getServerEnv(name: string): Promise<string | undefined> {
  const now = Date.now();
  const hit = cache.get(name);
  if (hit && hit.expires > now) return hit.value;

  let value: string | undefined;
  try {
    const { data: row } = await supabaseAdmin
      .from("vault_secrets")
      .select("value_ciphertext, value_iv, value_tag")
      .eq("scope", "shared")
      .eq("env_key", name)
      .maybeSingle();
    if (row?.value_ciphertext && row?.value_iv && row?.value_tag) {
      value = await open({
        ciphertext: row.value_ciphertext as string,
        iv: row.value_iv as string,
        tag: row.value_tag as string,
      }, `shared env "${name}" (vault-backed)`);
    }
  } catch (e) {
    console.warn(`[server-env] vault lookup failed for ${name}:`, e);
  }
  if (value === undefined) value = process.env[name];
  cache.set(name, { value, expires: now + TTL_MS });
  return value;
}

export function invalidateServerEnv(name?: string): void {
  if (name) cache.delete(name);
  else cache.clear();
}
