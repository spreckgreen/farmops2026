import type { FarmOpsModuleId } from "./entitlements";

/**
 * One registry for every feature prerequisite shown by the desktop and web UI.
 * Values and secrets are stored by adapters; this registry stores definitions only.
 * See GitHub issue #15.
 */

export type ConfigurationValueType =
  | "text"
  | "secret"
  | "url"
  | "number"
  | "boolean"
  | "select"
  | "directory";

export type ConfigurationScope =
  | "installation"
  | "profile"
  | "site";

export type ConfigurationClearBehavior =
  | "preserve"
  | "clear_with_profile"
  | "clear_with_site"
  | "clear_on_factory_purge";

export interface ConfigurationDefinition {
  key: string;
  moduleId: FarmOpsModuleId | "core";
  section:
    | "general"
    | "data"
    | "backup"
    | "ai"
    | "food"
    | "projects"
    | "inventory"
    | "maintenance"
    | "procedures"
    | "electrical"
    | "subscription"
    | "updates";
  label: string;
  description: string;
  valueType: ConfigurationValueType;
  requiredFor: readonly string[];
  setupRoute: string;
  sensitive: boolean;
  scope: ConfigurationScope;
  clearBehavior: ConfigurationClearBehavior;
  validationMethod?: "required" | "writable_directory" | "reachable_url" | "provider_credential";
}

export type ConfigurationStatus =
  | { state: "ready"; checkedAt?: string }
  | { state: "missing" }
  | { state: "untested" }
  | { state: "invalid"; reason: string }
  | { state: "unreachable"; reason: string };

export interface ConfigurationHealthItem {
  definition: ConfigurationDefinition;
  status: ConfigurationStatus;
  severity: "ready" | "warning" | "error";
  correction: {
    route: string;
    settingKey: string;
  };
}

function defineConfiguration(
  definition: ConfigurationDefinition,
): ConfigurationDefinition {
  if (!definition.setupRoute.includes(`setting=${encodeURIComponent(definition.key)}`)) {
    throw new Error(
      `Configuration route for ${definition.key} must deep-link to its setting`,
    );
  }

  if (definition.sensitive && definition.valueType !== "secret") {
    throw new Error(
      `Sensitive configuration ${definition.key} must use the secret value type`,
    );
  }

  return Object.freeze(definition);
}

export const CONFIGURATION_REGISTRY = [
  defineConfiguration({
    key: "backup.destination",
    moduleId: "core",
    section: "backup",
    label: "Backup destination",
    description: "Folder used for manual, scheduled, pre-update, and pre-clear backups.",
    valueType: "directory",
    requiredFor: ["backup", "update", "clear_site"],
    setupRoute: "/admin/configuration/backup?setting=backup.destination",
    sensitive: false,
    scope: "installation",
    clearBehavior: "clear_on_factory_purge",
    validationMethod: "writable_directory",
  }),
  defineConfiguration({
    key: "food.usdaFdcApiKey",
    moduleId: "food",
    section: "food",
    label: "USDA FoodData Central API key",
    description: "Enables USDA food lookup and nutrition matching.",
    valueType: "secret",
    requiredFor: ["food.usda_lookup", "food.nutrition_matching"],
    setupRoute: "/admin/configuration/food?setting=food.usdaFdcApiKey",
    sensitive: true,
    scope: "site",
    clearBehavior: "clear_with_site",
    validationMethod: "provider_credential",
  }),
  defineConfiguration({
    key: "ai.provider",
    moduleId: "core",
    section: "ai",
    label: "AI provider",
    description: "Selects disabled, BYOK, local, or FarmOps-hosted AI.",
    valueType: "select",
    requiredFor: ["ai"],
    setupRoute: "/admin/configuration/ai?setting=ai.provider",
    sensitive: false,
    scope: "profile",
    clearBehavior: "clear_with_profile",
    validationMethod: "required",
  }),
  defineConfiguration({
    key: "ai.openAiCompatibleApiKey",
    moduleId: "core",
    section: "ai",
    label: "OpenAI-compatible API key",
    description: "Credential stored in the operating-system credential vault.",
    valueType: "secret",
    requiredFor: ["ai.byok"],
    setupRoute: "/admin/configuration/ai?setting=ai.openAiCompatibleApiKey",
    sensitive: true,
    scope: "profile",
    clearBehavior: "clear_with_profile",
    validationMethod: "provider_credential",
  }),
  defineConfiguration({
    key: "ai.localEndpoint",
    moduleId: "core",
    section: "ai",
    label: "Local AI endpoint",
    description: "OpenAI-compatible or Ollama endpoint running on the local network.",
    valueType: "url",
    requiredFor: ["ai.local"],
    setupRoute: "/admin/configuration/ai?setting=ai.localEndpoint",
    sensitive: false,
    scope: "profile",
    clearBehavior: "clear_with_profile",
    validationMethod: "reachable_url",
  }),
] as const satisfies readonly ConfigurationDefinition[];

export type ConfigurationKey = (typeof CONFIGURATION_REGISTRY)[number]["key"];

export function getConfigurationDefinition(
  key: string,
): ConfigurationDefinition | undefined {
  return CONFIGURATION_REGISTRY.find((definition) => definition.key === key);
}

export function getRequiredConfiguration(
  featureId: string,
): readonly ConfigurationDefinition[] {
  return CONFIGURATION_REGISTRY.filter((definition) =>
    definition.requiredFor.includes(featureId),
  );
}

export function evaluateConfigurationHealth(
  statuses: Readonly<Record<string, ConfigurationStatus | undefined>>,
): readonly ConfigurationHealthItem[] {
  return CONFIGURATION_REGISTRY.map((definition) => {
    const status = statuses[definition.key] ?? { state: "missing" as const };
    const severity =
      status.state === "ready"
        ? "ready"
        : status.state === "invalid" || status.state === "unreachable"
          ? "error"
          : "warning";

    return {
      definition,
      status,
      severity,
      correction: {
        route: definition.setupRoute,
        settingKey: definition.key,
      },
    };
  });
}

export function getKeysClearedBy(
  operation: "reset_profile" | "clear_site" | "factory_purge",
): readonly ConfigurationKey[] {
  return CONFIGURATION_REGISTRY.filter((definition) => {
    if (operation === "factory_purge") return true;
    if (operation === "reset_profile") {
      return definition.clearBehavior === "clear_with_profile";
    }
    return definition.clearBehavior === "clear_with_site";
  }).map((definition) => definition.key);
}
