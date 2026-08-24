import { describe, expect, it } from "vitest";
import {
  AI_ENGINE_IDS,
  isEngineEnabled,
  parseEnginesConfig,
  serializeEnginesConfig,
} from "@/lib/ai-engines";

describe("three-engine configuration", () => {
  it("exposes only local, Ollama Cloud and other cloud", () => {
    expect(AI_ENGINE_IDS).toEqual(["local", "ollama_cloud", "other_cloud"]);
  });

  it("migrates an existing Lovable cloud default without blocking other keys", () => {
    const parsed = parseEnginesConfig(
      JSON.stringify({
        cloudDefault: "lovable",
        engines: {
          local: { baseUrl: null, apiKey: null, model: null },
          ollama_cloud: {
            baseUrl: "https://ollama.com/v1",
            apiKey: "ollama-cloud-key",
            model: "gpt-oss:120b",
          },
          lovable: { baseUrl: null, apiKey: "obsolete", model: null },
          other_cloud: {
            baseUrl: "https://api.openai.com/v1",
            apiKey: "openai-key",
            model: "gpt-4.1",
          },
        },
      }),
    );

    expect(parsed?.cloudDefault).toBe("other_cloud");
    expect(parsed?.engines.other_cloud.apiKey).toBe("openai-key");
    expect(Object.keys(parsed?.engines ?? {})).not.toContain("lovable");
  });

  it("defaults engines to on and round-trips a switched-off engine", () => {
    const legacy = parseEnginesConfig(
      JSON.stringify({
        cloudDefault: "other_cloud",
        engines: { ollama_cloud: { apiKey: "k", model: "gpt-oss:120b" } },
      }),
    );
    expect(legacy?.engines.ollama_cloud.enabled).toBe(true);

    const off = parseEnginesConfig(
      serializeEnginesConfig({
        cloudDefault: "other_cloud",
        engines: {
          local: { baseUrl: null, apiKey: null, model: null, enabled: true },
          ollama_cloud: {
            baseUrl: "https://ollama.com/v1",
            apiKey: "ollama-key",
            model: "gpt-oss:120b",
            enabled: false,
          },
          other_cloud: { baseUrl: null, apiKey: null, model: null, enabled: true },
        },
      }),
    );
    // Off, but every value is still stored.
    expect(off?.engines.ollama_cloud.enabled).toBe(false);
    expect(off?.engines.ollama_cloud.apiKey).toBe("ollama-key");
    expect(isEngineEnabled(off!, "ollama_cloud")).toBe(false);
    expect(isEngineEnabled(off!, "other_cloud")).toBe(true);
  });
});