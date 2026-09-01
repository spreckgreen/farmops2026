// Server-side add-on gate. Every gated server function calls `requireAddon`
// first, so hiding the UI is never the only protection.
//
// Uses the caller's own user-scoped Supabase client (RLS applies): a user can
// read their own entitlement rows, and nobody can grant themselves one.
import { ADDON_NOT_ENABLED, SCAN_ADDON, isEntitlementActive, type AddonKey } from "@/lib/addons";

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

/** True when the caller holds any one of `keys` (used by scan-scoped pages). */
export async function hasAnyAddon(
  supabase: unknown,
  userId: string,
  keys: AddonKey[],
): Promise<boolean> {
  for (const key of keys) {
    if (await hasAddon(supabase, userId, key)) return true;
  }
  return false;
}

export async function requireAnyAddon(
  supabase: unknown,
  userId: string,
  keys: AddonKey[],
): Promise<void> {
  if (!(await hasAnyAddon(supabase, userId, keys))) {
    throw new Error(ADDON_NOT_ENABLED);
  }
}

/**
 * Self-provision the scan-scoped Electrical add-on for a signed-in viewer who
 * arrived from a printed panel label. Never touches the full `electrical`
 * entitlement, so this cannot widen anyone's access beyond scanned panels; the
 * write goes through the service role because a user may not grant themselves
 * entitlement rows under RLS.
 */
export async function ensureScanAddon(userId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as { from: (t: string) => any };

  await db.from("app_entitlements").upsert(
    {
      user_id: userId,
      addon_key: SCAN_ADDON,
      status: "active",
      expires_at: null,
      notes: "Auto-granted on panel QR scan. Scoped to scanned panels only.",
    },
    { onConflict: "user_id,addon_key" },
  );

  // A brand-new account has no role row at all; give it `viewer` so the rest of
  // the app treats it as a read-only user rather than an unclassified one.
  const { data: roles } = await db.from("user_roles").select("role").eq("user_id", userId).limit(1);
  if (!roles || (roles as unknown[]).length === 0) {
    await db.from("user_roles").insert({ user_id: userId, role: "viewer" });
  }
}
