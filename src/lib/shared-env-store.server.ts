// Shared-scope vault rows used as runtime env overrides (env_key = name).
// Server-only. Every write busts the 60s server-env cache so the next AI call
// picks the change up without a redeploy.

/** Upsert a shared vault row keyed by env_key. */
export async function persistSharedEnvValue(
  envKey: string,
  value: string,
  title: string,
  userId: string,
) {
  const { seal } = await import("./vault-crypto.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sealed = await seal(value);

  const { data: existing } = await supabaseAdmin
    .from("vault_secrets")
    .select("id")
    .eq("scope", "shared")
    .eq("env_key", envKey)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabaseAdmin
      .from("vault_secrets")
      .update({
        value_ciphertext: sealed.ciphertext,
        value_iv: sealed.iv,
        value_tag: sealed.tag,
      })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabaseAdmin.from("vault_secrets").insert({
      scope: "shared",
      owner_user_id: null,
      created_by: userId,
      title,
      value_ciphertext: sealed.ciphertext,
      value_iv: sealed.iv,
      value_tag: sealed.tag,
      env_key: envKey,
    });
    if (error) throw new Error(error.message);
  }

  const { invalidateServerEnv } = await import("./server-env.server");
  invalidateServerEnv(envKey);
}

/** Delete the shared vault row for an env_key, if present. Returns true when removed. */
export async function deleteSharedEnvValue(envKey: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("vault_secrets")
    .delete()
    .eq("scope", "shared")
    .eq("env_key", envKey)
    .select("id");
  if (error) throw new Error(error.message);
  const { invalidateServerEnv } = await import("./server-env.server");
  invalidateServerEnv(envKey);
  return Boolean(data && data.length > 0);
}
