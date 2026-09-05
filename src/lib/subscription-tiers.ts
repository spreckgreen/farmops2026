// Subscription tiers: the bridge between the public pricing calculator
// (@/lib/farmops-pricing) and the real access system (@/lib/addons).
//
// A tier is one priced edition. Holding an active subscription on a tier is
// what UNLOCKS paid modules: the server writes one entitlement row per unlocked
// module, and every existing add-on gate keeps doing the actual enforcement.
// Nothing here charges anything — the money side is still a manual/Stripe step
// recorded on the subscription row (`provider`, `provider_ref`).
import { PRICED_EDITIONS, PRICED_MODULES, type Billing, type Deployment, type PricedEdition } from "@/lib/farmops-pricing";
import type { EditionKey } from "@/lib/product-architecture";

/** Module keys are also add-on keys, so a tier maps straight onto entitlements. */
export const MODULE_ADDON_KEYS = PRICED_MODULES.map((m) => m.key) as readonly string[];

export const SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due", "canceled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export type TierKey = EditionKey;

export interface SubscriptionRow {
  id?: string;
  user_id?: string;
  tier_key: string;
  deployment: string;
  billing: string;
  status: string;
  modules: string[] | null;
  seats: number;
  sites: number;
  contractor: boolean;
  current_period_end: string | null;
  provider?: string | null;
  provider_ref?: string | null;
  notes?: string | null;
}

export function tier(key: string): PricedEdition | undefined {
  return PRICED_EDITIONS.find((e) => e.key === key);
}

export function tierName(key: string): string {
  return tier(key)?.name ?? key;
}

/** The free tier every signed-in account may switch itself onto. */
export const FREE_TIER: TierKey = "free_kb";

/** Paid tiers need a payment or an administrator; the free tier never does. */
export function isPaidTier(key: string): boolean {
  const t = tier(key);
  if (!t) return false;
  return t.monthly > 0 || t.annual > 0 || t.oneTime > 0;
}

/**
 * A subscription grants access only while it is active or trialing and the paid
 * period has not run out. Unknown statuses fail closed.
 */
export function isSubscriptionActive(
  row: Pick<SubscriptionRow, "status" | "current_period_end"> | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!row) return false;
  const status = String(row.status ?? "").toLowerCase();
  if (status !== "active" && status !== "trialing") return false;
  if (!row.current_period_end) return true;
  const end = new Date(row.current_period_end);
  if (Number.isNaN(end.getTime())) return false;
  return end.getTime() > now.getTime();
}

/** How many paid modules a tier may switch on: a number, or every module. */
export function moduleAllowance(t: PricedEdition): number | "all" {
  if (t.paidModules === "all") return "all";
  // Self-host editions licence modules one at a time, so the count is open.
  if (t.perModuleOneTime > 0) return "all";
  return t.paidModules;
}

/**
 * The module add-on keys a subscription unlocks. Selection order decides which
 * modules win when a tier covers fewer modules than were picked, so the result
 * is always deterministic and never over-grants.
 */
export function unlockedModules(row: SubscriptionRow | null | undefined, now: Date = new Date()): string[] {
  if (!isSubscriptionActive(row, now)) return [];
  const t = tier(row!.tier_key);
  if (!t) return [];
  const allowance = moduleAllowance(t);
  const picked = (row!.modules ?? []).filter((k) => MODULE_ADDON_KEYS.includes(k));
  if (t.paidModules === "all") return [...MODULE_ADDON_KEYS];
  if (allowance === "all") return picked;
  return picked.slice(0, Math.max(0, allowance));
}

/** True when the tier itself can never unlock this module (over-selection). */
export function moduleOverSelected(row: SubscriptionRow, moduleKey: string): boolean {
  const picked = (row.modules ?? []).includes(moduleKey);
  return picked && !unlockedModules(row).includes(moduleKey);
}

export interface TierFit {
  fits: boolean;
  shortfalls: string[];
}

/** Whether a tier actually covers the requested shape (people, sites, rights). */
export function tierFit(
  t: PricedEdition,
  want: { seats: number; sites: number; contractor: boolean; modules: string[]; deployment: Deployment },
): TierFit {
  const shortfalls: string[] = [];
  const seatCap = t.seats === "unlimited" ? Number.POSITIVE_INFINITY : t.seats;
  const siteCap = t.sites === "unlimited" ? Number.POSITIVE_INFINITY : t.sites;
  if (t.deployment !== want.deployment) shortfalls.push("Different hosting choice.");
  if (want.seats > seatCap) shortfalls.push(`Covers ${t.seats} people.`);
  if (want.sites > siteCap) shortfalls.push(`Covers ${t.sites} site${t.sites === 1 ? "" : "s"}.`);
  if (want.contractor && !t.contractor) shortfalls.push("No customer-site rights.");
  const allowance = moduleAllowance(t);
  if (allowance !== "all" && want.modules.length > allowance) {
    shortfalls.push(allowance === 0 ? "Knowledge Base only." : `Unlocks ${allowance} paid module.`);
  }
  return { fits: shortfalls.length === 0, shortfalls };
}

/** Note written on every entitlement a subscription created, so sync can own it. */
export const SUBSCRIPTION_NOTE_PREFIX = "subscription:";

export function subscriptionNote(tierKey: string): string {
  return `${SUBSCRIPTION_NOTE_PREFIX}${tierKey}`;
}

export function isSubscriptionManaged(notes: string | null | undefined): boolean {
  return String(notes ?? "").startsWith(SUBSCRIPTION_NOTE_PREFIX);
}

/**
 * What the sync should write for one account: which module entitlements become
 * active, and which subscription-created ones must be switched off again.
 * Entitlements an administrator granted by hand are never touched.
 */
export interface SyncPlan {
  grant: string[];
  revoke: string[];
  expiresAt: string | null;
}

export function planEntitlementSync(
  row: SubscriptionRow | null | undefined,
  existing: { addon_key: string; status: string; notes: string | null }[],
  now: Date = new Date(),
): SyncPlan {
  const grant = unlockedModules(row, now);
  const revoke = existing
    .filter(
      (e) =>
        MODULE_ADDON_KEYS.includes(e.addon_key) &&
        isSubscriptionManaged(e.notes) &&
        !grant.includes(e.addon_key) &&
        e.status !== "disabled",
    )
    .map((e) => e.addon_key);
  return {
    grant,
    revoke,
    expiresAt: row?.current_period_end ?? null,
  };
}

export function billingLabel(billing: Billing | string): string {
  return billing === "annual" ? "Billed yearly" : "Billed monthly";
}

export function statusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Active";
    case "trialing":
      return "Trial";
    case "past_due":
      return "Payment overdue";
    case "canceled":
      return "Canceled";
    default:
      return status;
  }
}
