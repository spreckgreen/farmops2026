// Server functions for the add-on subscription framework.
// Thin wrappers only — logic lives in @/lib/addons and @/lib/addons.server.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  ENTITLEMENT_STATUSES,
  isEntitlementActive,
  isRevocationBlocked,
  isTestAccountEmail,
  nextRevocationState,
} from "@/lib/addons";

export interface AddonCatalogEntry {
  key: string;
  name: string;
  description: string | null;
  active: boolean;
}

export interface MyAddon {
  key: string;
  name: string;
  enabled: boolean;
  status: string | null;
  expires_at: string | null;
}

export interface AdminEntitlement {
  id: string;
  user_id: string;
  email: string | null;
  display_name: string | null;
  addon_key: string;
  status: string;
  expires_at: string | null;
  notes: string | null;
  enabled: boolean;
  revoked_count: number;
  blocked_until: string | null;
  blocked: boolean;
}

/** Add-ons available to the signed-in user, with their own entitlement state. */
export const getMyAddons = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyAddon[]> => {
    const { supabase, userId } = context;
    const [catalog, mine] = await Promise.all([
      supabase.from("app_addons").select("key, name, active").order("sort_order"),
      supabase
        .from("app_entitlements")
        .select("addon_key, status, expires_at")
        .eq("user_id", userId),
    ]);
    if (catalog.error) throw new Error(catalog.error.message);
    if (mine.error) throw new Error(mine.error.message);

    const rows = (mine.data ?? []) as {
      addon_key: string;
      status: string;
      expires_at: string | null;
    }[];
    return ((catalog.data ?? []) as { key: string; name: string; active: boolean }[]).map((a) => {
      const row = rows.find((r) => r.addon_key === a.key) ?? null;
      return {
        key: a.key,
        name: a.name,
        enabled: a.active && isEntitlementActive(row),
        status: row?.status ?? null,
        expires_at: row?.expires_at ?? null,
      };
    });
  });

/** Admin view: every user and their entitlement state for each add-on. */
export const listEntitlements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdminRole } = await import("@/lib/admin-role.server");
    await requireAdminRole(context.supabase, context.userId);

    const [addons, ents, profiles] = await Promise.all([
      context.supabase.from("app_addons").select("key, name, description, active").order("sort_order"),
      context.supabase
        .from("app_entitlements")
        .select("id, user_id, addon_key, status, expires_at, notes, revoked_count, blocked_until"),
      context.supabase.from("profiles").select("id, email, display_name").order("email"),
    ]);
    if (addons.error) throw new Error(addons.error.message);
    if (ents.error) throw new Error(ents.error.message);
    if (profiles.error) throw new Error(profiles.error.message);

    const people = (profiles.data ?? []) as {
      id: string;
      email: string | null;
      display_name: string | null;
    }[];
    const entitlements: AdminEntitlement[] = (
      (ents.data ?? []) as {
        id: string;
        user_id: string;
        addon_key: string;
        status: string;
        expires_at: string | null;
        notes: string | null;
        revoked_count: number | null;
        blocked_until: string | null;
      }[]
    ).map((e) => {
      const p = people.find((x) => x.id === e.user_id) ?? null;
      return {
        ...e,
        email: p?.email ?? null,
        display_name: p?.display_name ?? null,
        enabled: isEntitlementActive(e),
        revoked_count: Number(e.revoked_count ?? 0),
        blocked_until: e.blocked_until,
        blocked: isRevocationBlocked(e),
      };
    });

    return {
      addons: (addons.data ?? []) as AddonCatalogEntry[],
      users: people,
      entitlements,
    };
  });

const SetInput = z.object({
  user_id: z.string().uuid(),
  addon_key: z.string().min(1).max(64),
  status: z.enum(ENTITLEMENT_STATUSES),
  expires_at: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

/** Grant, trial, expire or disable an add-on for one user (admin only). */
export const setEntitlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SetInput.parse(d))
  .handler(async ({ context, data }) => {
    const { requireAdminRole } = await import("@/lib/admin-role.server");
    await requireAdminRole(context.supabase, context.userId);

    const expires = data.expires_at?.trim() ? new Date(data.expires_at).toISOString() : null;
    const { error } = await context.supabase.from("app_entitlements").upsert(
      {
        user_id: data.user_id,
        addon_key: data.addon_key,
        status: data.status,
        expires_at: expires,
        notes: data.notes?.trim() || null,
        granted_by: context.userId,
      } as never,
      { onConflict: "user_id,addon_key" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Remove an entitlement row entirely (admin only). */
export const revokeEntitlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAdminRole } = await import("@/lib/admin-role.server");
    await requireAdminRole(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("app_entitlements")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
