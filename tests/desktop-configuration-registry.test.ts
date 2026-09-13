import { describe, expect, it } from "vitest";
import {
  CONFIGURATION_REGISTRY,
  evaluateConfigurationHealth,
  getKeysClearedBy,
  getRequiredConfiguration,
} from "../src/lib/desktop/configuration-registry";

describe("desktop configuration registry", () => {
  it("gives every definition a direct correction link", () => {
    for (const definition of CONFIGURATION_REGISTRY) {
      expect(definition.setupRoute).toContain(
        `setting=${encodeURIComponent(definition.key)}`,
      );
    }
  });

  it("maps missing, invalid, and ready values to consistent visual severity", () => {
    const health = evaluateConfigurationHealth({
      "backup.destination": { state: "ready" },
      "food.usdaFdcApiKey": {
        state: "invalid",
        reason: "The provider rejected the credential.",
      },
    });

    expect(
      health.find((item) => item.definition.key === "backup.destination"),
    ).toMatchObject({ severity: "ready" });

    expect(
      health.find((item) => item.definition.key === "food.usdaFdcApiKey"),
    ).toMatchObject({
      severity: "error",
      correction: {
        settingKey: "food.usdaFdcApiKey",
      },
    });

    expect(
      health.find((item) => item.definition.key === "ai.provider"),
    ).toMatchObject({ severity: "warning", status: { state: "missing" } });
  });

  it("returns only settings required by a requested feature", () => {
    expect(
      getRequiredConfiguration("food.usda_lookup").map(({ key }) => key),
    ).toEqual(["food.usdaFdcApiKey"]);
  });

  it("clears site and profile configuration without erasing installation backup setup", () => {
    expect(getKeysClearedBy("clear_site")).toEqual(["food.usdaFdcApiKey"]);
    expect(getKeysClearedBy("reset_profile")).toEqual([
      "ai.provider",
      "ai.openAiCompatibleApiKey",
      "ai.localEndpoint",
    ]);
    expect(getKeysClearedBy("factory_purge")).toHaveLength(
      CONFIGURATION_REGISTRY.length,
    );
  });

  it("marks all secret definitions as sensitive", () => {
    for (const definition of CONFIGURATION_REGISTRY) {
      if (definition.valueType === "secret") {
        expect(definition.sensitive).toBe(true);
      }
    }
  });
});
