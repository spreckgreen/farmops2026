// Server-side add-on gate. Every gated server function calls `requireAddon`
// first, so hiding the UI is never the only protection.
//
// Uses the caller's own user-scoped Supabase client (RLS applies): a user can
// read their own entitlement rows, and nobody can grant themselves one.
import { ADDON_NOT_ENABLED, isEntitlementActive, type AddonKey } from "@/lib/addons";

type GateClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (a: string, b: string) => {
        eq: (a: string, b: string) => {
          maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
        };
      };
    };
  };
};

export async function hasAddon(
  supabase: unknown,
  userId: string,
  key: AddonKey,
): Promise<boolean> {
  const { data, error } = await (supabase as GateClient)
    .from("app_entitlements")
    .select("status, expires_at")
    .eq("user_id", userId)
    .eq("addon_key", key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return isEntitlementActive(data as { status: string; expires_at: string | null } | null);
}

export async function requireAddon(
  supabase: unknown,
  userId: string,
  key: AddonKey,
): Promise<void> {
  if (!(await hasAddon(supabase, userId, key))) {
    throw new Error(ADDON_NOT_ENABLED);
  }
}
