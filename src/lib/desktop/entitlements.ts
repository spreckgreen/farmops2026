/**
 * Canonical FarmOps module and entitlement model.
 *
 * This file deliberately contains no Electron, React, Supabase, or billing-provider
 * dependencies. Both web and desktop shells can consume the same decisions.
 * See GitHub issue #13.
 */

export const FARMOPS_MODULE_IDS = [
  "procedures",
  "food",
  "projects",
  "inventory",
  "maintenance",
  "electrical",
] as const;

export type FarmOpsModuleId = (typeof FARMOPS_MODULE_IDS)[number];

export const PAID_MODULE_IDS = FARMOPS_MODULE_IDS.filter(
  (moduleId): moduleId is Exclude<FarmOpsModuleId, "procedures"> =>
    moduleId !== "procedures",
);

export type EntitlementSource =
  | "free_for_life"
  | "site_trial"
  | "trial_extension"
  | "subscription"
  | "manual_grant";

export interface ModuleGrant {
  moduleId: FarmOpsModuleId;
  source: EntitlementSource;
  startsAt: string;
  expiresAt: string | null;
}

export interface SiteEntitlements {
  siteId: string;
  trialStartedAt: string;
  trialExpiresAt: string;
  grants: readonly ModuleGrant[];
}

export type ConfigurationProblem =
  | {
      kind: "missing";
      settingKeys: readonly string[];
    }
  | {
      kind: "invalid";
      settingKeys: readonly string[];
      reason: string;
    };

export type FeatureAvailability =
  | {
      state: "available";
      source: EntitlementSource;
      expiresAt: string | null;
    }
  | {
      state: "locked";
      moduleId: FarmOpsModuleId;
      subscriptionRoute: "/admin/subscriptions";
    }
  | {
      state: "trial-expired";
      moduleId: FarmOpsModuleId;
      expiredAt: string;
      subscriptionRoute: "/admin/subscriptions";
      dataDisposition: "retained_locked";
    }
  | {
      state: "configuration-required";
      moduleId: FarmOpsModuleId;
      settingKeys: readonly string[];
    }
  | {
      state: "configuration-invalid";
      moduleId: FarmOpsModuleId;
      settingKeys: readonly string[];
      reason: string;
    }
  | {
      state: "temporarily-unavailable";
      moduleId: FarmOpsModuleId;
      reason: string;
    };

export interface EvaluateFeatureInput {
  moduleId: FarmOpsModuleId;
  siteEntitlements: SiteEntitlements;
  now: Date;
  configurationProblem?: ConfigurationProblem;
  temporaryFailure?: string;
}

const PROCEDURES_GRANT: ModuleGrant = {
  moduleId: "procedures",
  source: "free_for_life",
  startsAt: "1970-01-01T00:00:00.000Z",
  expiresAt: null,
};

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid entitlement timestamp: ${value}`);
  }
  return parsed;
}

function isGrantActive(grant: ModuleGrant, now: number): boolean {
  return instant(grant.startsAt) <= now &&
    (grant.expiresAt === null || now < instant(grant.expiresAt));
}

function latestActiveGrant(
  grants: readonly ModuleGrant[],
  moduleId: FarmOpsModuleId,
  now: number,
): ModuleGrant | undefined {
  return grants
    .filter((grant) => grant.moduleId === moduleId && isGrantActive(grant, now))
    .sort((left, right) => {
      const leftExpiry = left.expiresAt === null ? Number.POSITIVE_INFINITY : instant(left.expiresAt);
      const rightExpiry = right.expiresAt === null ? Number.POSITIVE_INFINITY : instant(right.expiresAt);
      return rightExpiry - leftExpiry;
    })[0];
}

export function createFourteenDayTrial(
  siteId: string,
  startedAt: Date,
): SiteEntitlements {
  const trialStartedAt = startedAt.toISOString();
  const trialExpiresAt = new Date(
    startedAt.getTime() + 14 * 24 * 60 * 60 * 1000,
  ).toISOString();

  return {
    siteId,
    trialStartedAt,
    trialExpiresAt,
    grants: PAID_MODULE_IDS.map((moduleId) => ({
      moduleId,
      source: "site_trial" as const,
      startsAt: trialStartedAt,
      expiresAt: trialExpiresAt,
    })),
  };
}

export function evaluateFeatureAvailability({
  moduleId,
  siteEntitlements,
  now,
  configurationProblem,
  temporaryFailure,
}: EvaluateFeatureInput): FeatureAvailability {
  const nowValue = now.getTime();
  const grant =
    moduleId === "procedures"
      ? PROCEDURES_GRANT
      : latestActiveGrant(siteEntitlements.grants, moduleId, nowValue);

  if (!grant) {
    const trialExpiredAt = instant(siteEntitlements.trialExpiresAt);
    if (nowValue >= trialExpiredAt) {
      return {
        state: "trial-expired",
        moduleId,
        expiredAt: siteEntitlements.trialExpiresAt,
        subscriptionRoute: "/admin/subscriptions",
        dataDisposition: "retained_locked",
      };
    }

    return {
      state: "locked",
      moduleId,
      subscriptionRoute: "/admin/subscriptions",
    };
  }

  if (configurationProblem?.kind === "missing") {
    return {
      state: "configuration-required",
      moduleId,
      settingKeys: configurationProblem.settingKeys,
    };
  }

  if (configurationProblem?.kind === "invalid") {
    return {
      state: "configuration-invalid",
      moduleId,
      settingKeys: configurationProblem.settingKeys,
      reason: configurationProblem.reason,
    };
  }

  if (temporaryFailure) {
    return {
      state: "temporarily-unavailable",
      moduleId,
      reason: temporaryFailure,
    };
  }

  return {
    state: "available",
    source: grant.source,
    expiresAt: grant.expiresAt,
  };
}
