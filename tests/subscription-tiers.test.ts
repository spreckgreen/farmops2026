import { describe, it, expect } from "vitest";
import {
  FREE_TIER,
  MODULE_ADDON_KEYS,
  isPaidTier,
  isSubscriptionActive,
  moduleAllowance,
  moduleOverSelected,
  planEntitlementSync,
  subscriptionNote,
  tier,
  tierFit,
  unlockedModules,
  type SubscriptionRow,
} from "@/lib/subscription-tiers";

const base: SubscriptionRow = {
  tier_key: "cloud_pro",
  deployment: "cloud",
  billing: "monthly",
  status: "active",
  modules: ["electrical"],
  seats: 3,
  sites: 1,
  contractor: false,
  current_period_end: null,
};

describe("subscription state", () => {
  it("only active or trialing plans grant access", () => {
    expect(isSubscriptionActive(base)).toBe(true);
    expect(isSubscriptionActive({ ...base, status: "trialing" })).toBe(true);
    expect(isSubscriptionActive({ ...base, status: "past_due" })).toBe(false);
    expect(isSubscriptionActive({ ...base, status: "canceled" })).toBe(false);
    expect(isSubscriptionActive({ ...base, status: "weird" })).toBe(false);
    expect(isSubscriptionActive(null)).toBe(false);
  });

  it("an expired paid period revokes access without any background job", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(isSubscriptionActive({ ...base, current_period_end: past })).toBe(false);
    expect(unlockedModules({ ...base, current_period_end: past })).toEqual([]);
  });

  it("the free tier is free and paid tiers are paid", () => {
    expect(isPaidTier(FREE_TIER)).toBe(false);
    expect(isPaidTier("cloud_pro")).toBe(true);
    expect(isPaidTier("selfhost_standard")).toBe(true);
  });
});

describe("what a tier unlocks", () => {
  it("free tier unlocks no paid module", () => {
    expect(unlockedModules({ ...base, tier_key: FREE_TIER, modules: ["electrical"] })).toEqual([]);
  });

  it("pro and contractor tiers unlock every module", () => {
    expect(unlockedModules({ ...base, tier_key: "cloud_pro", modules: [] }).sort()).toEqual(
      [...MODULE_ADDON_KEYS].sort(),
    );
    expect(unlockedModules({ ...base, tier_key: "cloud_contractor", modules: [] }).length).toBe(
      MODULE_ADDON_KEYS.length,
    );
  });

  it("homestead unlocks exactly one, in the order chosen", () => {
    const row = { ...base, tier_key: "cloud_homestead", modules: ["inventory", "electrical"] };
    expect(unlockedModules(row)).toEqual(["inventory"]);
    expect(moduleOverSelected(row, "electrical")).toBe(true);
    expect(moduleOverSelected(row, "inventory")).toBe(false);
  });

  it("self-host standard licences modules one at a time", () => {
    const t = tier("selfhost_standard")!;
    expect(moduleAllowance(t)).toBe("all");
    expect(
      unlockedModules({ ...base, tier_key: "selfhost_standard", deployment: "selfhost", modules: ["food", "inventory"] }),
    ).toEqual(["food", "inventory"]);
  });

  it("never grants a module key that is not in the catalogue", () => {
    expect(unlockedModules({ ...base, tier_key: "selfhost_standard", modules: ["admin", "everything"] })).toEqual([]);
  });
});

describe("tier fit", () => {
  it("reports what a small tier cannot cover", () => {
    const fit = tierFit(tier("cloud_homestead")!, {
      seats: 30,
      sites: 4,
      contractor: true,
      modules: ["electrical", "food"],
      deployment: "cloud",
    });
    expect(fit.fits).toBe(false);
    expect(fit.shortfalls.length).toBeGreaterThanOrEqual(4);
  });

  it("accepts a shape the tier covers", () => {
    expect(
      tierFit(tier("cloud_pro")!, { seats: 5, sites: 2, contractor: false, modules: ["electrical", "food"], deployment: "cloud" })
        .fits,
    ).toBe(true);
  });
});

describe("entitlement sync plan", () => {
  it("grants the unlocked modules and withdraws the ones the plan dropped", () => {
    const existing = [
      { addon_key: "food", status: "active", notes: subscriptionNote("cloud_pro") },
      { addon_key: "electrical", status: "active", notes: "granted by hand for the electrician" },
    ];
    const plan = planEntitlementSync({ ...base, tier_key: "cloud_homestead", modules: ["inventory"] }, existing);
    expect(plan.grant).toEqual(["inventory"]);
    // Subscription-created food access is withdrawn…
    expect(plan.revoke).toEqual(["food"]);
    // …but the hand-granted electrical entitlement is never touched.
    expect(plan.revoke).not.toContain("electrical");
  });

  it("a canceled plan withdraws every module it had granted", () => {
    const existing = MODULE_ADDON_KEYS.map((k) => ({
      addon_key: k,
      status: "active",
      notes: subscriptionNote("cloud_pro"),
    }));
    const plan = planEntitlementSync({ ...base, status: "canceled" }, existing);
    expect(plan.grant).toEqual([]);
    expect(plan.revoke.sort()).toEqual([...MODULE_ADDON_KEYS].sort());
  });

  it("carries the paid period end onto the entitlements", () => {
    const end = new Date(Date.now() + 86400000).toISOString();
    expect(planEntitlementSync({ ...base, current_period_end: end }, []).expiresAt).toBe(end);
  });

  it("no plan at all grants nothing", () => {
    expect(planEntitlementSync(null, []).grant).toEqual([]);
  });
});
