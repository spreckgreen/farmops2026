// Persist the per-feature AI routing blob in the shared vault, keyed by
// env_key CUSTOM_AI_FEATURE_ROUTING (same mechanism as CUSTOM_AI_MODEL), so it
// can change at runtime from the settings UI without a redeploy.
import { ROUTING_ENV_KEY } from "./ai-routing.server";

export async function persistSharedRouting(value: string, userId: string) {
  const { seal } = await import("./vault-crypto.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sealed = await seal(value);

  const { data: existing } = await supabaseAdmin
    .from("vault_secrets")
    .select("id")
    .eq("scope", "shared")
    .eq("env_key", ROUTING_ENV_KEY)
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
      title: "AI feature routing (CUSTOM_AI_FEATURE_ROUTING)",
      value_ciphertext: sealed.ciphertext,
      value_iv: sealed.iv,
      value_tag: sealed.tag,
      env_key: ROUTING_ENV_KEY,
    });
    if (error) throw new Error(error.message);
  }

  const { invalidateServerEnv } = await import("./server-env.server");
  invalidateServerEnv(ROUTING_ENV_KEY);
}
