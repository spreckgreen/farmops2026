// Server functions for real subscription tiers.
//
// Self-service: an account may switch itself onto the free tier, and may start
// one time-boxed trial of a paid tier. Everything else — activating a paid tier,
// changing its modules, recording a payment reference, cancelling — is
// administrator work, because that is where money is confirmed today.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  FREE_TIER,
  MODULE_ADDON_KEYS,
  SUBSCRIPTION_STATUSES,
  isPaidTier,
  isSubscriptionActive,
  tier,
  tierFit,
  unlockedModules,
  type SubscriptionRow,
} from "@/lib/subscription-tiers";

export const TRIAL_DAYS = 14;
const TRIAL_NOTE = "trial-used";

const TierKeyInput = z.string().min(1).max(64);
const ModulesInput = z.array(z.enum(MODULE_ADDON_KEYS as [string, ...string[]])).max(8);

export interface MySubscription {
  tier_key: string;
  tier_name: string;
  deployment: string;
  billing: string;
  status: string;
  modules: string[];
  unlocked: string[];
  seats: number;
  sites: number;
  contractor: boolean;
  current_period_end: string | null;
  provider: string;
  active: boolean;
  trial_used: boolean;
}

function shape(row: SubscriptionRow & { notes?: string | null }): MySubscription {
  return {
    tier_key: row.tier_key,
    tier_name: tier(row.tier_key)?.name ?? row.tier_key,
    deployment: row.deployment,
    billing: row.billing,
    status: row.status,
    modules: row.modules ?? [],
    unlocked: unlockedModules(row),
    seats: row.seats,
    sites: row.sites,
    contractor: row.contractor,
    current_period_end: row.current_period_end,
    provider: row.provider ?? "manual",
    active: isSubscriptionActive(row),
    trial_used: String(row.notes ?? "").includes(TRIAL_NOTE),
  };
}

const SELECT_COLS =
  "id, user_id, tier_key, deployment, billing, status, modules, seats, sites, contractor, current_period_end, provider, provider_ref, notes";

/** The signed-in account's plan, or null when it has never chosen one. */
export const getMySubscription = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MySubscription | null> => {
    const { data, error } = await context.supabase
      .from("app_subscriptions")
      .select(SELECT_COLS)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return shape(data as unknown as SubscriptionRow & { notes?: string | null });
  });

/** Switch this account onto the free Knowledge Base tier (always allowed). */
export const chooseFreeTier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { syncSubscriptionEntitlements } = await import("@/lib/subscriptions.server");

    const existing = await supabaseAdmin
      .from("app_subscriptions")
      .select("notes")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);

    const { error } = await supabaseAdmin.from("app_subscriptions").upsert(
      {
        user_id: context.userId,
        tier_key: FREE_TIER,
        deployment: "cloud",
        billing: "monthly",
        status: "active",
        modules: [],
        seats: 1,
        sites: 1,
        contractor: false,
        current_period_end: null,
        provider: "manual",
        notes: (existing.data as { notes?: string | null } | null)?.notes ?? null,
        created_by: context.userId,
      } as never,
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    const sync = await syncSubscriptionEntitlements(supabaseAdmin, context.userId, context.userId);
    return { ok: true, ...sync };
  });

/**
 * Start the one allowed trial of a paid tier. This really does unlock the
 * chosen modules, for `TRIAL_DAYS` days, after which the entitlements expire on
 * their own — no background job needed.
 */
export const startTierTrial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        tier_key: TierKeyInput,
        modules: ModulesInput.default([]),
        seats: z.number().int().min(1).max(10000).default(1),
        sites: z.number().int().min(1).max(10000).default(1),
        contractor: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const t = tier(data.tier_key);
    if (!t) throw new Error("Unknown plan.");
    if (!isPaidTier(data.tier_key)) throw new Error("The free tier does not need a trial.");
    if (t.deployment !== "cloud") throw new Error("Self-hosted licences are arranged with an administrator.");

    const fit = tierFit(t, {
      seats: data.seats,
      sites: data.sites,
      contractor: data.contractor,
      modules: data.modules,
      deployment: "cloud",
    });
    if (!fit.fits) throw new Error(`That plan does not cover what you asked for: ${fit.shortfalls.join(" ")}`);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { syncSubscriptionEntitlements } = await import("@/lib/subscriptions.server");

    const existing = await supabaseAdmin
      .from("app_subscriptions")
      .select("status, notes")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    const row = existing.data as { status?: string; notes?: string | null } | null;
    if (row && String(row.notes ?? "").includes(TRIAL_NOTE)) {
      throw new Error("This account has already used its trial. An administrator can activate a paid plan.");
    }
    if (row && (row.status === "active" || row.status === "trialing") && row.status === "trialing") {
      throw new Error("A trial is already running on this account.");
    }

    const end = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabaseAdmin.from("app_subscriptions").upsert(
      {
        user_id: context.userId,
        tier_key: data.tier_key,
        deployment: "cloud",
        billing: "monthly",
        status: "trialing",
        modules: data.modules,
        seats: data.seats,
        sites: data.sites,
        contractor: data.contractor,
        current_period_end: end,
        provider: "manual",
        notes: TRIAL_NOTE,
        created_by: context.userId,
      } as never,
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    const sync = await syncSubscriptionEntitlements(supabaseAdmin, context.userId, context.userId);
    return { ok: true, ends_at: end, ...sync };
  });

export interface AdminSubscription extends MySubscription {
  id: string;
  user_id: string;
  email: string | null;
  display_name: string | null;
  provider_ref: string | null;
  notes: string | null;
}

/** Every account's plan (administrators only). */
export const listSubscriptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdminRole } = await import("@/lib/admin-role.server");
    await requireAdminRole(context.supabase, context.userId);

    const [subs, profiles] = await Promise.all([
      context.supabase.from("app_subscriptions").select(SELECT_COLS),
      context.supabase.from("profiles").select("id, email, display_name").order("email"),
    ]);
    if (subs.error) throw new Error(subs.error.message);
    if (profiles.error) throw new Error(profiles.error.message);

    const people = (profiles.data ?? []) as { id: string; email: string | null; display_name: string | null }[];
    const rows: AdminSubscription[] = (
      (subs.data ?? []) as unknown as (SubscriptionRow & {
        id: string;
        user_id: string;
        provider_ref: string | null;
        notes: string | null;
      })[]
    ).map((r) => {
      const p = people.find((x) => x.id === r.user_id) ?? null;
      return {
        ...shape(r),
        id: r.id,
        user_id: r.user_id,
        email: p?.email ?? null,
        display_name: p?.display_name ?? null,
        provider_ref: r.provider_ref,
        notes: r.notes,
      };
    });

    return { subscriptions: rows, users: people };
  });

const SetInput = z.object({
  user_id: z.string().uuid(),
  tier_key: TierKeyInput,
  deployment: z.enum(["cloud", "selfhost"]),
  billing: z.enum(["monthly", "annual"]),
  status: z.enum(SUBSCRIPTION_STATUSES),
  modules: ModulesInput.default([]),
  seats: z.number().int().min(1).max(10000).default(1),
  sites: z.number().int().min(1).max(10000).default(1),
  contractor: z.boolean().default(false),
  current_period_end: z.string().trim().max(40).optional().nullable(),
  provider: z.enum(["manual", "stripe"]).default("manual"),
  provider_ref: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

/**
 * Activate, change or downgrade one account's plan, then rewrite its module
 * access in the same call so the two can never drift apart.
 */
export const setSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SetInput.parse(d))
  .handler(async ({ context, data }) => {
    const { requireAdminRole } = await import("@/lib/admin-role.server");
    await requireAdminRole(context.supabase, context.userId);
    const t = tier(data.tier_key);
    if (!t) throw new Error("Unknown plan.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { syncSubscriptionEntitlements } = await import("@/lib/subscriptions.server");

    const end = data.current_period_end?.trim() ? new Date(data.current_period_end).toISOString() : null;
    const { error } = await supabaseAdmin.from("app_subscriptions").upsert(
      {
        user_id: data.user_id,
        tier_key: data.tier_key,
        deployment: data.deployment,
        billing: data.billing,
        status: data.status,
        modules: data.modules,
        seats: data.seats,
        sites: data.sites,
        contractor: data.contractor,
        current_period_end: end,
        provider: data.provider,
        provider_ref: data.provider_ref?.trim() || null,
        notes: data.notes?.trim() || null,
        created_by: context.userId,
      } as never,
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);

    const sync = await syncSubscriptionEntitlements(supabaseAdmin, data.user_id, context.userId);
    return { ok: true, ...sync };
  });

/** Cancel a plan: the row is kept as history and module access is withdrawn. */
export const cancelSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAdminRole } = await import("@/lib/admin-role.server");
    await requireAdminRole(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { syncSubscriptionEntitlements } = await import("@/lib/subscriptions.server");

    const { error } = await supabaseAdmin
      .from("app_subscriptions")
      .update({ status: "canceled" } as never)
      .eq("user_id", data.user_id);
    if (error) throw new Error(error.message);

    const sync = await syncSubscriptionEntitlements(supabaseAdmin, data.user_id, context.userId);
    return { ok: true, ...sync };
  });
