// Per-user interface preferences, stored server-side so a reader's chosen
// layout follows them across browsers and devices. Values are small booleans /
// strings only (e.g. { "grid-map.design-vs-field": true }).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type UiPreferences = Record<string, string | number | boolean | null>;

export const getMyUiPreferences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UiPreferences> => {
    const { supabase, userId } = context;
    const res = await supabase
      .from("user_ui_preferences")
      .select("preferences")
      .eq("user_id", userId)
      .maybeSingle();
    if (res.error) throw new Error(res.error.message);
    return (res.data?.preferences as UiPreferences | null) ?? {};
  });

export const setMyUiPreference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { key: string; value: string | number | boolean | null }) => {
    if (!data || typeof data.key !== "string" || !data.key.trim()) {
      throw new Error("A preference key is required.");
    }
    if (data.key.length > 120) throw new Error("Preference key is too long.");
    const t = typeof data.value;
    if (data.value !== null && t !== "string" && t !== "number" && t !== "boolean") {
      throw new Error("Preference values must be a string, number, boolean, or null.");
    }
    return { key: data.key, value: data.value };
  })
  .handler(async ({ context, data }): Promise<UiPreferences> => {
    const { supabase, userId } = context;
    const current = await supabase
      .from("user_ui_preferences")
      .select("preferences")
      .eq("user_id", userId)
      .maybeSingle();
    if (current.error) throw new Error(current.error.message);

    const next: UiPreferences = {
      ...((current.data?.preferences as UiPreferences | null) ?? {}),
      [data.key]: data.value,
    };
    const saved = await supabase
      .from("user_ui_preferences")
      .upsert({ user_id: userId, preferences: next }, { onConflict: "user_id" })
      .select("preferences")
      .single();
    if (saved.error) throw new Error(saved.error.message);
    return (saved.data.preferences as UiPreferences | null) ?? {};
  });
