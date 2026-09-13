import { describe, expect, it } from "vitest";
import {
  createFourteenDayTrial,
  evaluateFeatureAvailability,
  type SiteEntitlements,
} from "../src/lib/desktop/entitlements";

describe("desktop entitlements", () => {
  const start = new Date("2026-09-13T12:00:00.000Z");

  it("keeps Procedures free for life even after a trial expires", () => {
    const site = createFourteenDayTrial("site-1", start);

    expect(
      evaluateFeatureAvailability({
        moduleId: "procedures",
        siteEntitlements: site,
        now: new Date("2036-09-13T12:00:00.000Z"),
      }),
    ).toEqual({
      state: "available",
      source: "free_for_life",
      expiresAt: null,
    });
  });

  it("unlocks every paid module for exactly fourteen days", () => {
    const site = createFourteenDayTrial("site-1", start);

    expect(
      evaluateFeatureAvailability({
        moduleId: "inventory",
        siteEntitlements: site,
        now: new Date("2026-09-27T11:59:59.999Z"),
      }).state,
    ).toBe("available");

    expect(
      evaluateFeatureAvailability({
        moduleId: "inventory",
        siteEntitlements: site,
        now: new Date("2026-09-27T12:00:00.000Z"),
      }),
    ).toMatchObject({
      state: "trial-expired",
      dataDisposition: "retained_locked",
      subscriptionRoute: "/admin/subscription",
    });
  });

  it("allows a signed-extension-compatible grant beyond the base trial", () => {
    const original = createFourteenDayTrial("site-1", start);
    const site: SiteEntitlements = {
      ...original,
      grants: [
        ...original.grants,
        {
          moduleId: "electrical",
          source: "trial_extension",
          startsAt: "2026-09-27T12:00:00.000Z",
          expiresAt: "2026-10-11T12:00:00.000Z",
        },
      ],
    };

    expect(
      evaluateFeatureAvailability({
        moduleId: "electrical",
        siteEntitlements: site,
        now: new Date("2026-10-01T12:00:00.000Z"),
      }),
    ).toMatchObject({
      state: "available",
      source: "trial_extension",
    });
  });

  it("reports configuration problems only after entitlement succeeds", () => {
    const site = createFourteenDayTrial("site-1", start);

    expect(
      evaluateFeatureAvailability({
        moduleId: "food",
        siteEntitlements: site,
        now: new Date("2026-09-14T12:00:00.000Z"),
        configurationProblem: {
          kind: "missing",
          settingKeys: ["food.usdaFdcApiKey"],
        },
      }),
    ).toEqual({
      state: "configuration-required",
      moduleId: "food",
      settingKeys: ["food.usdaFdcApiKey"],
    });
  });

  it("does not unlock a module merely because the base trial has not expired", () => {
    const site: SiteEntitlements = {
      siteId: "site-1",
      trialStartedAt: "2026-09-13T12:00:00.000Z",
      trialExpiresAt: "2026-09-27T12:00:00.000Z",
      grants: [],
    };

    expect(
      evaluateFeatureAvailability({
        moduleId: "maintenance",
        siteEntitlements: site,
        now: new Date("2026-09-14T12:00:00.000Z"),
      }),
    ).toEqual({
      state: "locked",
      moduleId: "maintenance",
      subscriptionRoute: "/admin/subscription",
    });
  });
});
