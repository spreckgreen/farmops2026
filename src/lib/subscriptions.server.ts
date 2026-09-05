// Server-only subscription → entitlement sync.
//
// The subscription row is the record of what was bought; entitlement rows are
// what the add-on gates read. This module keeps them in step and is the ONLY
// place that turns a paid tier into access. Entitlements an administrator
// granted by hand carry no `subscription:` note and are never touched here.
import {
  MODULE_ADDON_KEYS,
  isSubscriptionActive,
  planEntitlementSync,
  subscriptionNote,
  type SubscriptionRow,
} from "@/lib/subscription-tiers";

type AdminClient = {
  from: (table: string) => any;
};

export interface SyncResult {
  granted: string[];
  revoked: string[];
  expiresAt: string | null;
}

/** Reads the account's subscription and rewrites its module entitlements. */
export async function syncSubscriptionEntitlements(
  admin: AdminClient,
  userId: string,
  actorId: string,
): Promise<SyncResult> {
  const sub = await admin
    .from("app_subscriptions")
    .select("tier_key, deployment, billing, status, modules, seats, sites, contractor, current_period_end")
    .eq("user_id", userId)
    .maybeSingle();
  if (sub.error) throw new Error(sub.error.message);
  const row = (sub.data ?? null) as SubscriptionRow | null;

  const current = await admin
    .from("app_entitlements")
    .select("addon_key, status, notes")
    .eq("user_id", userId)
    .in("addon_key", [...MODULE_ADDON_KEYS]);
  if (current.error) throw new Error(current.error.message);
  const existing = (current.data ?? []) as { addon_key: string; status: string; notes: string | null }[];

  const plan = planEntitlementSync(row, existing);

  if (plan.grant.length > 0) {
    const note = subscriptionNote(row?.tier_key ?? "");
    const status = String(row?.status ?? "").toLowerCase() === "trialing" ? "trialing" : "active";
    const rows = plan.grant.map((addon_key) => ({
      user_id: userId,
      addon_key,
      status,
      expires_at: plan.expiresAt,
      notes: note,
      granted_by: actorId,
    }));
    const up = await admin.from("app_entitlements").upsert(rows, { onConflict: "user_id,addon_key" });
    if (up.error) throw new Error(up.error.message);
  }

  for (const addon_key of plan.revoke) {
    // Subscription-driven loss of access is not an abuse revocation, so the
    // revoked_count / lockout counters are deliberately left alone.
    const off = await admin
      .from("app_entitlements")
      .update({ status: "disabled" })
      .eq("user_id", userId)
      .eq("addon_key", addon_key);
    if (off.error) throw new Error(off.error.message);
  }

  return { granted: plan.grant, revoked: plan.revoke, expiresAt: plan.expiresAt };
}

/** True when the account currently holds a usable subscription. */
export function subscriptionUsable(row: SubscriptionRow | null | undefined): boolean {
  return isSubscriptionActive(row);
}
