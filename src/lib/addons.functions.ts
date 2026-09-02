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

/**
 * Grant, trial, expire or disable an add-on for one user (admin only).
 *
 * Taking access away (`disabled`) is recoverable — the user may ask again or
 * re-scan a label — but each removal is counted. Past the limit the account is
 * locked out of self-service access for a year. Re-enabling clears the lockout
 * without erasing the history, and the shared test account never accrues one.
 */
export const setEntitlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SetInput.parse(d))
  .handler(async ({ context, data }) => {
    const { requireAdminRole } = await import("@/lib/admin-role.server");
    await requireAdminRole(context.supabase, context.userId);

    const [{ data: current }, { data: profile }] = await Promise.all([
      context.supabase
        .from("app_entitlements")
        .select("status, revoked_count, blocked_until")
        .eq("user_id", data.user_id)
        .eq("addon_key", data.addon_key)
        .maybeSingle(),
      context.supabase.from("profiles").select("email").eq("id", data.user_id).maybeSingle(),
    ]);
    const row = current as
      | { status: string; revoked_count: number | null; blocked_until: string | null }
      | null;
    const email = (profile as { email?: string | null } | null)?.email ?? null;

    const wasActive = !row || row.status === "active" || row.status === "trialing";
    const isRemoval = data.status === "disabled" && wasActive;
    const counters = isRemoval
      ? nextRevocationState(row, { email })
      : {
          revoked_count: Math.max(0, Number(row?.revoked_count ?? 0) || 0),
          // An explicit admin grant lifts an existing lockout.
          blocked_until:
            data.status === "active" || data.status === "trialing"
              ? null
              : (row?.blocked_until ?? null),
        };

    const expires = data.expires_at?.trim() ? new Date(data.expires_at).toISOString() : null;
    const { error } = await context.supabase.from("app_entitlements").upsert(
      {
        user_id: data.user_id,
        addon_key: data.addon_key,
        status: data.status,
        expires_at: expires,
        notes: data.notes?.trim() || null,
        granted_by: context.userId,
        revoked_count: counters.revoked_count,
        blocked_until: counters.blocked_until,
      } as never,
      { onConflict: "user_id,addon_key" },
    );
    if (error) throw new Error(error.message);
    return {
      ok: true,
      revoked_count: counters.revoked_count,
      blocked_until: counters.blocked_until,
      test_account: isTestAccountEmail(email),
    };
  });

/**
 * Revoke an add-on (admin only). The row is kept in a `disabled` state rather
 * than deleted so the user can try again and so the revocation history — the
 * basis for the one-year lockout past the limit — is not lost.
 */
export const revokeEntitlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAdminRole } = await import("@/lib/admin-role.server");
    await requireAdminRole(context.supabase, context.userId);

    const { data: current, error: readError } = await context.supabase
      .from("app_entitlements")
      .select("user_id, status, revoked_count, blocked_until")
      .eq("id", data.id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!current) return { ok: true, revoked_count: 0, blocked_until: null };
    const row = current as unknown as {
      user_id: string;
      status: string;
      revoked_count: number | null;
      blocked_until: string | null;
    };

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("email")
      .eq("id", row.user_id)
      .maybeSingle();
    const email = (profile as { email?: string | null } | null)?.email ?? null;

    const wasActive = row.status === "active" || row.status === "trialing";
    const counters = wasActive
      ? nextRevocationState(row, { email })
      : {
          revoked_count: Math.max(0, Number(row.revoked_count ?? 0) || 0),
          blocked_until: row.blocked_until,
        };

    const { error } = await context.supabase
      .from("app_entitlements")
      .update({
        status: "disabled",
        revoked_count: counters.revoked_count,
        blocked_until: counters.blocked_until,
      } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return {
      ok: true,
      revoked_count: counters.revoked_count,
      blocked_until: counters.blocked_until,
      test_account: isTestAccountEmail(email),
    };
  });
